// Тест нативных адаптеров Anthropic + Google Gemini (CR-017): unit-слой (экстракция,
// SSE-аккумуляторы, usage-маппинг, конфиг) + живые прогоны движка против моков
// :3098 (Messages API) и :3097 (generateContent) — полный LLM-прогон, provenance,
// стриминг исполнителя, usage, probe-валидация (включая честный 401), маскирование
// ключа и его отсутствие в артефактах прогона (runs.json). Паттерн — test-avizis-byok.ts.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import * as anthropic from '../mini-services/avizis-agent/anthropic-client'
import * as gemini from '../mini-services/avizis-agent/gemini-client'
import { sanitizeConfigInput, mergeSavedApiKey, adapterUsesApiKey } from '../mini-services/avizis-agent/llm-config'
import { start as startMockAnthropic, stop as stopMockAnthropic, stats as statsAnthropic, reset as resetAnthropic } from './mock-anthropic'
import { start as startMockGemini, stop as stopMockGemini, stats as statsGemini, reset as resetGemini } from './mock-gemini'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const CONFIG_FILE = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data', 'llm-config.json')
const RUNS_FILE = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data', 'runs.json')
const GOOD_KEY = 'sk-test-native-key-777'
const WRONG_KEY = 'sk-wrong-key-000'
const MASK = 'sk-…-777'

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

/** Поток из строк — для юнит-тестов SSE-аккумуляторов */
function sseOf(chunks: string[]): ReadableStream {
  return new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder()
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      },
    })
  ).body as ReadableStream
}

// ───────────── A. Юнит-слой (движок не нужен) ─────────────

function unitTests() {
  // A1. extractAnthropicContent: склейка text-блоков, не-text пропуски
  const joined = anthropic.extractAnthropicContent({
    content: [
      { type: 'text', text: ' Блок 1. ' },
      { type: 'tool_use' },
      { type: 'text', text: 'Блок 2' },
    ],
  })
  push('A1 extractAnthropicContent: text-блоки склеиваются, не-text пропуски', joined === 'Блок 1.\n\nБлок 2', [`got=${JSON.stringify(joined)}`])
  push(
    'A2 extractAnthropicContent: пустой/чужой ответ → null',
    anthropic.extractAnthropicContent({ content: [{ type: 'tool_use' }] }) === null && anthropic.extractAnthropicContent({}) === null
  )

  // A3. consumeAnthropicSse: дельты, снапшоты, usage из message_start + message_delta
  const snapshots: string[] = []
  const stream = anthropic.consumeAnthropicSse(
    sseOf([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Привет"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":", мир!"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]),
    (t) => snapshots.push(t)
  )
  return stream.then((result) => {
    push(
      'A3 consumeAnthropicSse: контент, снапшоты, usage (input из start, output из delta)',
      snapshots.length === 2 && snapshots[1] === 'Привет, мир!',
      [`snapshots=${JSON.stringify(snapshots)}`]
    )
    return result
  })
}

function unitTests2(antResult: { content: string; usage?: { promptTokens?: number; completionTokens?: number } }) {
  push(
    'A4 consumeAnthropicSse: usage {promptTokens:25, completionTokens:15}',
    antResult.content === 'Привет, мир!' && antResult.usage?.promptTokens === 25 && antResult.usage?.completionTokens === 15,
    [`result=${JSON.stringify(antResult)}`]
  )

  // A5. Gemini: extractGeminiContent + geminiUsageOf
  const gJoined = gemini.extractGeminiContent({
    candidates: [{ content: { parts: [{ text: 'X' }, { text: 'Y' }] } }],
  })
  const gUsage = gemini.geminiUsageOf({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } })
  push(
    'A5 extractGeminiContent/geminiUsageOf: parts склеиваются, usageMetadata маппится',
    gJoined === 'X\n\nY' && gUsage?.promptTokens === 10 && gUsage?.completionTokens === 20 && gemini.geminiUsageOf({}) === undefined,
    [`joined=${JSON.stringify(gJoined)} usage=${JSON.stringify(gUsage)}`]
  )

  // A6. consumeGeminiSse: несколько parts в чанке, usageMetadata финального чанка
  const gsnapshots: string[] = []
  return gemini
    .consumeGeminiSse(
      sseOf([
        'data: {"candidates":[{"content":{"parts":[{"text":"При"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"вет, "},{"text":"мир!"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":30,"candidatesTokenCount":6,"totalTokenCount":36}}\n\n',
      ]),
      (t) => gsnapshots.push(t)
    )
    .then((gres) => {
      push(
        'A6 consumeGeminiSse: снапшоты после каждого чанка, usage из финального чанка',
        gsnapshots.length === 2 && gsnapshots[1] === 'Привет, мир!' && gres.content === 'Привет, мир!' && gres.usage?.promptTokens === 30 && gres.usage?.completionTokens === 6,
        [`snapshots=${JSON.stringify(gsnapshots)} usage=${JSON.stringify(gres.usage)}`]
      )
    })
}

function configUnitTests() {
  // A7. sanitizeConfigInput: новые адаптеры в белом списке, мусор отсекается
  const sane = sanitizeConfigInput({ default: { adapter: 'anthropic', baseUrl: 'http://127.0.0.1:3098', model: 'claude-3-5-sonnet', apiKey: GOOD_KEY } })
  const saneGem = sanitizeConfigInput({ default: { adapter: 'google-gemini', model: 'gemini-2.5-flash', apiKey: GOOD_KEY } })
  push(
    'A7 sanitizeConfigInput: anthropic/google-gemini валидны, неизвестный адаптер → null',
    sane?.default?.adapter === 'anthropic' && saneGem?.default?.adapter === 'google-gemini' && sanitizeConfigInput({ default: { adapter: 'nope' } }) === null,
    [`anthropic=${sane?.default?.adapter} gemini=${saneGem?.default?.adapter}`]
  )

  // A8. adapterUsesApiKey: ключевые адаптеры против zai
  push(
    'A8 adapterUsesApiKey: openai-compatible/anthropic/google-gemini — да, zai — нет',
    adapterUsesApiKey('openai-compatible') && adapterUsesApiKey('anthropic') && adapterUsesApiKey('google-gemini') && !adapterUsesApiKey('zai')
  )

  // A9. mergeSavedApiKey: пустой ключ в поле сохраняет прежний для anthropic (смена модели не сбрасывает)
  const saved = { default: { adapter: 'anthropic', baseUrl: 'http://127.0.0.1:3098', model: 'claude-3-5-sonnet', apiKey: 'SECRET-OLD' } }
  const merged = mergeSavedApiKey({ default: { adapter: 'anthropic', baseUrl: 'http://127.0.0.1:3098', model: 'claude-sonnet-4-5' } } as any, saved as any)
  const zaiMerged = mergeSavedApiKey({ default: { adapter: 'zai' } } as any, saved as any)
  push(
    'A9 mergeSavedApiKey: ключ anthropic сохраняется при пустом поле; переход на zai сбрасывает',
    merged?.default?.apiKey === 'SECRET-OLD' && zaiMerged?.default?.apiKey === undefined,
    [`merged=${JSON.stringify(merged?.default?.apiKey)} zai=${JSON.stringify(zaiMerged?.default)}`]
  )
}

// ───────────── B. Живые прогоны через движок (:3003) ─────────────

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

async function ensureMock(start: () => Promise<void>, reset: () => Promise<void>, probeUrl: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(probeUrl)
    if (res.ok) {
      await reset()
      console.log(`[test] мок ${name} уже запущен (внешний) — статистика сброшена`)
      return false
    }
  } catch {
    /* не запущен — стартуем в процессе */
  }
  await start()
  console.log(`[test] мок ${name} запущен в процессе`)
  return true
}

/** Сбор потоковых событий прогона (node:stream/llm:usage) параллельно ожиданию summary */
function collectStreamStats(runId: string) {
  const seen = { stream: 0, usage: 0 }
  const handler = (d: any) => {
    if (d?.runId !== runId) return
    if (d?.event?.type === 'node:stream') seen.stream++
    if (d?.event?.type === 'llm:usage') seen.usage++
  }
  socket.on('run:event', handler)
  return {
    done: () => socket.off('run:event', handler),
    seen,
  }
}

interface NativeScenario {
  label: string
  adapter: 'anthropic' | 'google-gemini'
  baseUrl: string
  model: string
  stats: () => Promise<{ apiKey: string; model: string; maxTokens?: number; stream: boolean }[]>
  reset: () => Promise<void>
}

async function liveScenario(sc: NativeScenario): Promise<void> {
  await sc.reset()

  // 1. сохранение конфига (probe-валидация мимо реального API не пройдёт — мок отвечает)
  const saved = await saveConfig({ default: { adapter: sc.adapter, baseUrl: sc.baseUrl, model: sc.model, apiKey: GOOD_KEY } })
  push(
    `${sc.label}: конфиг сохранён (probe-валидация пройдена, latency=${saved?.latencyMs ?? '—'} мс)`,
    saved?.ok === true && saved?.config?.default?.adapter === sc.adapter && typeof saved?.latencyMs === 'number',
    [`result=${JSON.stringify(saved).slice(0, 200)}`]
  )

  // 2. маска ключа в публичном конфиге
  push(`${sc.label}: llm:config отдаёт маску (${MASK}), не ключ`, saved?.config?.default?.apiKey === MASK, [`apiKey=${saved?.config?.default?.apiKey}`])

  // 3. LLM-прогон до завершения (сбор стрим-статистики параллельно)
  const runId = await new Promise<string>((resolve) => {
    socket.once('run:created', (d) => resolve(d.runId))
    socket.emit('run:start', { task: `Нативный прогон ${sc.label}`, mode: 'llm', decisionMode: 'auto' })
  })
  const collector = collectStreamStats(runId)
  const summary = await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary')
  collector.done()
  push(`${sc.label}: LLM-прогон завершён`, !!summary, [`summary="${String(summary?.summary).slice(0, 80)}…"`])

  // 4. стриминг исполнителя + usage событий
  push(
    `${sc.label}: стриминг исполнителя живой (node:stream ≥3) и usage посчитан (llm:usage ≥4)`,
    collector.seen.stream >= 3 && collector.seen.usage >= 4,
    [`node:stream=${collector.seen.stream} llm:usage=${collector.seen.usage}`]
  )

  // 5. provenance снапшота
  const snap = await loadSnapshot(runId)
  const llm = snap?.llm ?? {}
  const rolesOk = ['planner', 'executor', 'supervisor', 'decider'].every((r) => llm[r]?.adapter === sc.adapter && llm[r]?.model === sc.model)
  push(`${sc.label}: snapshot.llm — все 4 роли ${sc.adapter} · ${sc.model}`, rolesOk, [`llm=${JSON.stringify(llm)}`])
  const doneNodes = (snap?.nodes ?? []).filter((n: any) => n.status === 'done')
  const nodesOk = doneNodes.length >= 3 && doneNodes.every((n: any) => n?.llm?.adapter === sc.adapter && n?.llm?.model === sc.model)
  push(
    `${sc.label}: выполненные узлы несут node.llm (${doneNodes.length} шт.)`,
    nodesOk,
    [`done=${doneNodes.length}`]
  )
  const snapRaw = JSON.stringify(snap)
  push(`${sc.label}: снапшот не содержит ключ API`, !snapRaw.includes(GOOD_KEY))

  // 6. мок видел правильный ключ/модель/протокол (probe-запрос тоже честный: max_tokens 16)
  const st = await sc.stats()
  const withKey = st.filter((r: any) => r.apiKey === GOOD_KEY && r.model === sc.model)
  const streamed = st.filter((r: any) => r.stream)
  const probeReqs = sc.adapter === 'anthropic' ? st.filter((r: any) => r.maxTokens === 16) : []
  const chatReqs = sc.adapter === 'anthropic' ? st.filter((r: any) => r.maxTokens > 16) : st
  const maxTokensOk = sc.adapter === 'anthropic' ? chatReqs.length > 0 && chatReqs.every((r: any) => r.maxTokens === 8192) && probeReqs.length === 1 : true
  push(
    `${sc.label}: мок получил запросы с ключом, моделью ${sc.model}${sc.adapter === 'anthropic' ? ', чат max_tokens=8192 + probe 16' : ''}; среди них стриминговые`,
    withKey.length > 0 && streamed.length > 0 && maxTokensOk,
    [`всего=${st.length} с ключом=${withKey.length} стрим=${streamed.length} probe=${probeReqs.length}`]
  )

  // 7. БЕЗОПАСНОСТЬ: runs.json без ключа
  await sleep(1500)
  const runsRaw = fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf-8') : ''
  push(`${sc.label}: runs.json не содержит ключ API`, !runsRaw.includes(GOOD_KEY), [`размер runs.json=${runsRaw.length}`])

  // 8. честный отказ: неверный ключ → save отклонён probe (401)
  const badSave = await saveConfig({ default: { adapter: sc.adapter, baseUrl: sc.baseUrl, model: sc.model, apiKey: WRONG_KEY } })
  push(
    `${sc.label}: неверный ключ → сохранение отклонено с человекочитаемой ошибкой (401)`,
    badSave?.ok === false && /401/.test(String(badSave?.error || '')),
    [`error="${String(badSave?.error || '').slice(0, 120)}"`]
  )
}

socket.on('connect', async () => {
  let antOwn = false
  let gemOwn = false
  try {
    // A. юнит-слой
    const antStream = await unitTests()
    await unitTests2(antStream)
    configUnitTests()

    // B. живые прогоны
    antOwn = await ensureMock(startMockAnthropic, resetAnthropic, 'http://127.0.0.1:3098/__stats', 'anthropic')
    await liveScenario({
      label: 'Anthropic',
      adapter: 'anthropic',
      baseUrl: 'http://127.0.0.1:3098',
      model: 'claude-3-5-sonnet-mock',
      stats: async () => (await statsAnthropic()) as any,
      reset: resetAnthropic,
    })
    gemOwn = await ensureMock(startMockGemini, resetGemini, 'http://127.0.0.1:3097/__stats', 'gemini')
    await liveScenario({
      label: 'Gemini',
      adapter: 'google-gemini',
      baseUrl: 'http://127.0.0.1:3097',
      model: 'gemini-2.5-flash-mock',
      stats: async () => (await statsGemini()) as any,
      reset: resetGemini,
    })
  } catch (e: any) {
    push('выполнение сценария без ошибок', false, [String(e?.message || e)])
  } finally {
    // восстановить дефолт zai (ключ уходит из файла)
    try {
      const restored = await saveConfig({ default: { adapter: 'zai' } })
      console.log(`[test] восстановление дефолта zai: ${restored?.ok ? 'ок' : `ошибка: ${restored?.error}`}`)
      const restoredRaw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      push(
        'дефолт zai восстановлен, тестовые ключи из файла удалены',
        restoredRaw.includes('"zai"') && !restoredRaw.includes(GOOD_KEY) && !restoredRaw.includes(WRONG_KEY),
        [`файл=${restoredRaw.trim()}`]
      )
    } catch {
      push('дефолт zai восстановлен, тестовые ключи из файла удалены', false, ['файл не читается'])
    }
    if (antOwn) await stopMockAnthropic()
    if (gemOwn) await stopMockGemini()
    socket.disconnect()
    const failed = results.filter((r) => !r.ok)
    console.log('\n════════════ ИТОГ ════════════')
    console.log(`Пройдено: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
      console.log('Провалено:')
      failed.forEach((f) => console.log(`  ❌ ${f.name}`))
      process.exitCode = 1
    } else {
      console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ✅')
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
})

socket.on('connect_error', (e: any) => {
  console.error('[test] движок недоступен (нужен :3003):', e?.message)
  process.exit(1)
})
