// Тест динамического прайсинга и стоимости (ADR-016 / CR-011): источники цен
// (OpenRouter /models, каталог LiteLLM), приоритет manual > OpenRouter > LiteLLM,
// нормализация id (префикс, :free), арифметика стоимости, офлайн-устойчивость,
// кэш на диске, unpricedCalls; интеграция: стоимость в снапшоте/событиях/журнале
// (мок :3099 + manual-прайс для mock-model, сокет :3003). Паттерн — test-tacg-usage.ts.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'
import { foldEvents } from '../src/lib/tacg/fold'
import { fmtUsd } from '../mini-services/tacg-agent/engine'
import { pricing } from '../mini-services/tacg-agent/pricing'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const DATA_DIR = path.join(HERE, '..', 'mini-services', 'tacg-agent', 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'llm-config.json')
const CACHE_FILE = path.join(DATA_DIR, 'pricing-cache.json')
const RUNS_FILE = path.join(DATA_DIR, 'runs.json')
const TEST_KEY = 'sk-test-pricing-key-4242'

interface StepResult {
  name: string
  ok: boolean
  details: string[]
}

const results: StepResult[] = []
const push = (name: string, ok: boolean, details: string[] = []) => {
  results.push({ name, ok, details })
  console.log(`[test] ${ok ? '✅' : '❌'} ${name}`)
  details.forEach((d) => console.log(`        ${ok ? '' : '!'} ${d}`))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function waitFor(predicate: (ev: any) => boolean, timeoutMs = 90000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('таймаут ожидания события')), timeoutMs)
    const handler = (data: any) => {
      if (!predicate(data)) return
      clearTimeout(timer)
      socket.off('run:event', handler)
      resolve(data.event)
    }
    socket.on('run:event', handler)
  })
}

async function loadSnapshot(runId: string): Promise<any> {
  return new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
}

async function saveConfig(config: any): Promise<any> {
  return new Promise((resolve) => {
    socket.once('llm:config:saved', resolve)
    socket.emit('llm:config:save', { config })
  })
}

async function pricingStatus(): Promise<any> {
  return new Promise((resolve) => {
    socket.once('pricing:status', resolve)
    socket.emit('pricing:get')
  })
}

async function ensureMock(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:3099/__stats')
    if (res.ok) {
      await fetch('http://127.0.0.1:3099/__reset', { method: 'POST' })
      console.log('[test] мок уже запущен (внешний) — статистика сброшена')
      return false
    }
  } catch {
    /* не запущен — стартуем в процессе */
  }
  await startMock()
  console.log('[test] мок-провайдер запущен в процессе (127.0.0.1:3099)')
  return true
}

const near = (a: number | undefined | null, b: number, eps = 1e-9) =>
  typeof a === 'number' && Math.abs(a - b) < eps

// ─────────────────────── Фикстуры источников ───────────────────────

const OPENROUTER_FIXTURE = {
  data: [
    { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001', request: '0' } },
    { id: 'deepseek/deepseek-chat', pricing: { prompt: '0.00000027', completion: '0.0000011' } },
    { id: 'vendor-a/llama', pricing: { prompt: '0.0000005', completion: '0.0000015' } },
    { id: 'vendor-b/llama', pricing: { prompt: '0.0000006', completion: '0.0000018' } },
    { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
  ],
}

const LITELLM_FIXTURE: Record<string, any> = {
  'gpt-4o': { input_cost_per_token: 0.0000035, output_cost_per_token: 0.000014 },
  'deepseek-chat': { input_cost_per_token: 0.00000027, output_cost_per_token: 0.0000011 },
  'text-embedding-3-small': { input_cost_per_token: 0.00000002 },
  'no-cost-model': { max_tokens: 100 },
}

const fakeFetch = async (url: string) => {
  if (url.includes('openrouter')) return new Response(JSON.stringify(OPENROUTER_FIXTURE), { status: 200 })
  if (url.includes('model_prices') || url.includes('litellm')) {
    return new Response(JSON.stringify(LITELLM_FIXTURE), { status: 200 })
  }
  throw new Error('неожиданный url: ' + url)
}

const offlineFetch = async () => {
  throw new Error('сеть недоступна (тест)')
}

// ─────────────────────── A. Unit: модуль прайсинга ───────────────────────

async function unitPricing() {
  // снимки артефактов на диске — восстановим в конце
  const configBackup = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : null
  const cacheBackup = fs.existsSync(CACHE_FILE) ? fs.readFileSync(CACHE_FILE, 'utf-8') : null

  // конфиг с ручной ценой для 'gpt-4o' (приоритет над каталогами)
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({
      default: { adapter: 'zai' },
      pricing: { models: { 'gpt-4o': { inputPer1M: 1, outputPer1M: 2 } } },
    }),
    'utf-8'
  )

  try {
    pricing.resetForTests({ wipeCacheFile: true })
    const refresh = await pricing.refresh({ fetcher: fakeFetch })
    push('A1 refresh: оба источника загружены', refresh.ok === true, [JSON.stringify(refresh)])

    const st = pricing.status()
    push(
      'A2 status: источники и счётчики моделей',
      st.sources.length === 3 &&
        st.sources.find((s: any) => s.id === 'manual')?.models === 1 &&
        st.sources.find((s: any) => s.id === 'openrouter')?.models === 4 && // free/model отфильтрован
        st.sources.find((s: any) => s.id === 'litellm')?.models === 3, // no-cost-model отфильтрован
      [JSON.stringify(st.sources.map((s: any) => [s.id, s.models]))]
    )

    const manual = pricing.priceFor('gpt-4o')
    push(
      'A3 приоритет: manual перекрывает каталоги',
      manual?.source === 'manual' && manual.inputPer1M === 1 && manual.outputPer1M === 2,
      [JSON.stringify(manual)]
    )

    const or = pricing.priceFor('openai/gpt-4o')
    push(
      'A4 OpenRouter: точное совпадение id (USD/токен → USD/1M)',
      or?.source === 'openrouter' && near(or.inputPer1M, 2.5) && near(or.outputPer1M, 10),
      [JSON.stringify(or)]
    )

    const ll = pricing.priceFor('deepseek-chat')
    push(
      'A5 LiteLLM: точное совпадение по базовому id',
      ll?.source === 'litellm' && near(ll.inputPer1M, 0.27) && near(ll.outputPer1M, 1.1),
      [JSON.stringify(ll)]
    )

    const viaSuffix = pricing.priceFor('deepseek/deepseek-chat:free')
    push(
      'A6 нормализация: суффикс :free отбрасывается',
      viaSuffix?.source === 'openrouter' && near(viaSuffix.inputPer1M, 0.27),
      [JSON.stringify(viaSuffix)]
    )

    push(
      'A7 неизвестная модель → null (стоимость честно не оценена)',
      pricing.priceFor('totally-unknown-model') === null && pricing.priceFor('') === null,
      [JSON.stringify(pricing.priceFor('totally-unknown-model'))]
    )

    push(
      'A8 неоднозначный базовый id (2 вендора) → null, а не случайная цена',
      pricing.priceFor('x/llama') === null,
      [JSON.stringify(pricing.priceFor('x/llama'))]
    )

    const cost = pricing.costFor('openai/gpt-4o', 100, 20)
    push(
      'A9 арифметика: 100/20 токенов × 2.5/10 $/1M = $0,00045',
      near(cost?.costUsd, 0.00045) && cost?.price.source === 'openrouter',
      [`costUsd=${cost?.costUsd} (ожид. 0.00045)`]
    )

    push(
      'A10 fmtUsd: $1,23 / $0,0123 / $0,00045 (запятая, 3 значащих в малых)',
      fmtUsd(1.234) === '$1,23' && fmtUsd(0.01234) === '$0,0123' && fmtUsd(0.00045) === '$0,00045' && fmtUsd(0) === '$0',
      [fmtUsd(1.234), fmtUsd(0.01234), fmtUsd(0.00045)]
    )

    // офлайн: refresh падает — кэш в памяти сохраняется, статус фиксирует ошибку
    const offline = await pricing.refresh({ fetcher: offlineFetch })
    const stOffline = pricing.status()
    const stillPriced = pricing.priceFor('openai/gpt-4o')
    push(
      'A11 офлайн: обновление не удалось, но кэш жив и ничего не падает',
      offline.ok === false &&
        stOffline.sources.find((s: any) => s.id === 'openrouter')?.ok === false &&
        stillPriced?.source === 'openrouter',
      [`refresh=${JSON.stringify(offline)}`, `цена после офлайна=${JSON.stringify(stillPriced)}`]
    )

    // кэш на диске: сброс памяти → init() поднимает цены из файла
    pricing.resetForTests()
    push('A12 сброс памяти → цены пусты', pricing.priceFor('openai/gpt-4o') === null, [])
    pricing.init()
    const fromCache = pricing.priceFor('openai/gpt-4o')
    push(
      'A13 init(): подъём цен из дискового кэша',
      fromCache?.source === 'openrouter' && near(fromCache.inputPer1M, 2.5),
      [JSON.stringify(fromCache)]
    )
  } finally {
    // восстановление артефактов диска (конфиг вернём через сокет в B-части)
    if (configBackup !== null) fs.writeFileSync(CONFIG_FILE, configBackup, 'utf-8')
    else fs.rmSync(CONFIG_FILE, { force: true })
    if (cacheBackup !== null) fs.writeFileSync(CACHE_FILE, cacheBackup, 'utf-8')
    else fs.rmSync(CACHE_FILE, { force: true })
    pricing.resetForTests()
  }
}

// ─────────────────────── B. Unit: fold копит стоимость ───────────────────────

function unitFold() {
  const mkNode = (id: string, status = 'pending') => ({ id, title: `Узел ${id}`, description: '', status, dependsOn: [], dynamic: false })
  const events: any[] = [
    { type: 'graph:init', ts: 1, nodes: [mkNode('n1'), mkNode('n2')] },
    { type: 'llm:usage', ts: 2, role: 'planner', inputTokens: 100, outputTokens: 20, adapter: 'openai-compatible', model: 'mock-model', costUsd: 0.00045, priceSource: 'manual' },
    { type: 'node:update', ts: 3, node: { ...mkNode('n1', 'running'), input: 'задача' } },
    { type: 'llm:usage', ts: 4, role: 'executor', nodeId: 'n1', inputTokens: 100, outputTokens: 20, adapter: 'openai-compatible', model: 'mock-model', costUsd: 0.00045, priceSource: 'manual' },
    { type: 'node:update', ts: 5, node: { ...mkNode('n1', 'done'), output: 'результат', usage: { input: 100, output: 20, costUsd: 0.00045 } } },
    { type: 'llm:usage', ts: 6, role: 'executor', nodeId: 'n2', inputTokens: 100, outputTokens: 20 }, // старый формат: без прайса
    { type: 'run:status', ts: 7, status: 'completed', progress: 100 },
  ]
  const view = foldEvents(events)
  push(
    'B1 fold: итоговая стоимость и разбивка по ролям',
    near(view.usage?.costUsd, 0.0009) &&
      near(view.usage?.byRole.planner?.costUsd, 0.00045) &&
      near(view.usage?.byRole.executor?.costUsd, 0.00045) &&
      view.usage?.unpricedCalls === 1,
    [`cost=${view.usage?.costUsd}`, `unpriced=${view.usage?.unpricedCalls}`]
  )
  const n1 = view.nodes.find((n: any) => n.id === 'n1')
  const n2 = view.nodes.find((n: any) => n.id === 'n2')
  push(
    'B2 fold: атрибуция стоимости узлам',
    near(n1?.usage?.costUsd, 0.00045) && n2?.usage?.costUsd === undefined && n2?.usage?.input === 100,
    [`n1=${JSON.stringify(n1?.usage)}`, `n2=${JSON.stringify(n2?.usage)}`]
  )
}

// ─────────────────────── C. Интеграция: мок-провайдер → движок ───────────────────────

socket.on('connect', async () => {
  let mockOwn = false
  try {
    unitFold()
    await unitPricing()

    // C1: статус прайсинга по сокету
    const st1 = await pricingStatus()
    push(
      'C1 pricing:status по сокету: manual + сетевые источники',
      Array.isArray(st1?.sources) && st1.sources.length >= 1 && typeof st1.ttlHours === 'number',
      [JSON.stringify(st1)]
    )

    // C2: конфигурация с ручной ценой для mock-model
    mockOwn = await ensureMock()
    const saved = await saveConfig({
      default: { adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:3099/v1', model: 'mock-model', apiKey: TEST_KEY },
      pricing: { models: { 'mock-model': { inputPer1M: 2.5, outputPer1M: 10 } } },
    })
    push(
      'C2 конфигурация openai-compatible + прайс mock-model сохранена',
      !!saved?.ok && saved?.config?.pricing?.models?.['mock-model']?.inputPer1M === 2.5,
      [JSON.stringify(saved?.config?.pricing), saved?.error ?? '']
    )

    // C3: LLM-прогон авто-режимом до завершения
    const runIdPromise = new Promise<string>((resolve) => {
      const h = (d: any) => {
        if (d?.runId) {
          socket.off('run:created', h)
          resolve(d.runId)
        }
      }
      socket.on('run:created', h)
    })
    socket.emit('run:start', { task: 'Тест прайсинга: стоимость прогонов LLM', mode: 'llm', decisionMode: 'auto' })
    await waitFor((d) => d?.event?.type === 'run:status' && d.event.status === 'completed')
    const id = await runIdPromise

    const snap: any = await loadSnapshot(id)

    // C4: сводка. Мок после CR-016: полный вызов 100/20 → $0,00045 (планировщик ×1, супервайзер ×2, решатель ×1);
    //     стрим исполнителя 111/42 → $0,0006975 за вызов (×3): 0,0018 + 0,0020925 = $0,0038925 ≈ $0,00389
    const u = snap?.usage
    push(
      'C4 сводка: costUsd запуска = 4×$0,00045 + 3×$0,0006975 ≈ $0,00389',
      u?.calls === 7 && near(u?.costUsd, 0.0038925, 1e-12) && u?.unpricedCalls === undefined,
      [`calls=${u?.calls}`, `cost=${u?.costUsd} (ожид. 0.0038925)`, `unpriced=${u?.unpricedCalls}`]
    )

    // C5: разбивка по ролям (1/3/2/1 вызовов; исполнитель — стрим)
    push(
      'C5 разбивка costUsd по ролям',
      near(u?.byRole?.planner?.costUsd, 0.00045) &&
        near(u?.byRole?.executor?.costUsd, 0.0020925) &&
        near(u?.byRole?.supervisor?.costUsd, 0.0009) &&
        near(u?.byRole?.decider?.costUsd, 0.00045),
      [JSON.stringify(u?.byRole)]
    )

    // C6: события llm:usage несут provenance и стоимость (исполнитель — стрим-цена)
    const usageEvents = (snap?.events ?? []).filter((e: any) => e.type === 'llm:usage')
    push(
      'C6 события llm:usage: adapter/model/costUsd/priceSource',
      usageEvents.length === 7 &&
        usageEvents.every(
          (e: any) =>
            e.adapter === 'openai-compatible' && e.model === 'mock-model' && e.priceSource === 'manual' &&
            near(e.costUsd, e.role === 'executor' ? 0.0006975 : 0.00045)
        ),
      [`событий=${usageEvents.length}`, JSON.stringify(usageEvents[0])]
    )

    // C7: атрибуция узлам (исполнитель — стрим-цена, decider — полный вызов)
    const byId = new Map<string, any>((snap?.nodes ?? []).map((n: any) => [n.id, n] as [string, any]))
    const expStream = ['n1', 'ba1', 'nfin']
    const expFull = ['dec1']
    push(
      'C7 атрибуция стоимости узлам',
      expStream.every((nid) => near(byId.get(nid)?.usage?.costUsd, 0.0006975)) &&
        expFull.every((nid) => near(byId.get(nid)?.usage?.costUsd, 0.00045)) &&
        !byId.get('bb1')?.usage,
      [...expStream, ...expFull].map((nid) => `${nid}=${byId.get(nid)?.usage?.costUsd}`)
    )

    // C8: журнал — стоимость в записях шагов (исполнитель ≈$0,000698) и итога (≈$0,00389)
    const logs: any[] = snap?.logs ?? []
    const doneLogs = logs.filter((l: any) => l.kind === 'node-done')
    const finalLog = logs.find((l: any) => l.kind === 'run' && l.message.includes('Задача выполнена'))
    push(
      'C8 журнал: «· ≈$0,000697» в шагах, ≈$0,00389 в итоге',
      doneLogs.length === 3 && doneLogs.every((l: any) => l.message.includes('· ≈$0,000697')) &&
        !!finalLog?.message.includes('≈$0,00389'),
      [`шаг: ${doneLogs[0]?.message.slice(-60)}`, `итог: ${finalLog?.message}`]
    )

    // C9: summary содержит стоимость
    push('C9 summary: стоимость в итоге запуска', !!snap?.summary?.includes('≈$0,00389'), [snap?.summary?.slice(0, 160)])

    // C10: fold по событиям = сводка движка (replay-честность)
    const view = foldEvents(snap.events)
    push(
      'C10 fold = сводка движка: стоимость воспроизводится из потока',
      near(view.usage?.costUsd, 0.0038925, 1e-12) && near(view.nodes.find((n: any) => n.id === 'n1')?.usage?.costUsd, 0.0006975),
      [`fold.cost=${view.usage?.costUsd}`]
    )

    // C11: персистентность в runs.json; ключ не утёк
    await sleep(1100)
    const raw = fs.readFileSync(RUNS_FILE, 'utf-8')
    const persisted = JSON.parse(raw)
    const persistedRun = (Array.isArray(persisted) ? persisted : persisted.runs ?? []).find((r: any) => r.id === id)
    push(
      'C11 runs.json: costUsd сохранён, ключа нет',
      near(persistedRun?.usage?.costUsd, 0.0038925, 1e-12) && !raw.includes(TEST_KEY),
      [`cost=${persistedRun?.usage?.costUsd}`, `ключ в runs.json: ${raw.includes(TEST_KEY)}`]
    )

    // C12: refresh по сокету — событие результата и обновлённый статус (сеть может быть недоступна)
    const refreshResult: any = await new Promise((resolve) => {
      socket.once('pricing:refresh:result', resolve)
      socket.emit('pricing:refresh')
    })
    const st2 = await pricingStatus()
    push(
      'C12 pricing:refresh по сокету: результат + статус обновились',
      refreshResult && typeof refreshResult.ok === 'boolean' && Array.isArray(st2?.sources),
      [`result=${JSON.stringify(refreshResult)}`]
    )
  } catch (e: any) {
    push('интеграционный прогон упал', false, [e?.message || String(e)])
  } finally {
    // восстановление дефолта zai + снятие прайса mock-model (файл восстановлен в unit-части)
    try {
      const r = await saveConfig({ default: { adapter: 'zai' } })
      console.log(`[test] восстановление дефолта zai: ${r?.ok ? 'ок' : `ошибка: ${r?.error}`}`)
      // merge мог сохранить override 'mock-model' — возвращаем исходный файл на диск
      const want = fs.existsSync(path.join(DATA_DIR, 'llm-config.json'))
        ? JSON.stringify({ default: { adapter: 'zai' } })
        : JSON.stringify({ default: { adapter: 'zai' } })
      fs.writeFileSync(path.join(DATA_DIR, 'llm-config.json'), want, 'utf-8')
    } catch (e: any) {
      console.error('[test] не удалось восстановить дефолт:', e?.message || e)
    }
    if (mockOwn) await stopMock()
    socket.close()
    const failed = results.filter((r) => !r.ok)
    console.log(`\n[test] Итог: ${results.length - failed.length}/${results.length} ✅`)
    process.exit(failed.length ? 1 : 0)
  }
})

socket.on('connect_error', (e: any) => {
  console.error('[test] нет соединения с движком :3003 —', e?.message)
  process.exit(1)
})
