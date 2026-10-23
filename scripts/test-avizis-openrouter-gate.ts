// Тест обхода гейта OpenRouter «agentic harnesses» (inkling:free) + UX истории.
// Часть A (unit, без движка): openai-client — 403-гейт → повтор с tools →
// разворачивание tool_calls; кэш гейта; NonRetryable/транзиентные ошибки;
// 200-inline-гейт; extractMessageContent; validateProvider.
// Часть B (integration, движок :3003): сохранение конфига с gated-моделью,
// полный LLM-прогон через tools, мгновенная запись в историю при старте.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock, stats as mockStats, reset as mockReset } from './mock-openai'
import {
  chatCompletionsRequest,
  extractMessageContent,
  NonRetryableProviderError,
  resetGateCacheForTests,
  validateProvider,
} from '../mini-services/avizis-agent/openai-client'
import { chatTextDetailed } from '../mini-services/avizis-agent/llm'

const HERE = (import.meta as any).dir as string
const CONFIG_FILE = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data', 'llm-config.json')

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

const GATED_CFG = {
  adapter: 'openai-compatible' as const,
  baseUrl: 'http://127.0.0.1:3099/v1',
  model: 'thinkingmachines/inkling:free',
  apiKey: 'sk-or-v1-gate-test',
}

async function partA() {
  process.env.MOCK_MODE = 'agentic-gate'
  resetGateCacheForTests()
  mockReset()
  // Конфиг тест-процесса: 404-база для A6 (чат через несуществующий путь мока)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ default: { adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:3099/v2', model: 'missing/model', apiKey: 'k' } }, null, 2),
    'utf-8'
  )

  // A1: гейт → повтор с tools → tool_calls разворачиваются в текст
  const r1 = await chatCompletionsRequest(GATED_CFG, {
    model: GATED_CFG.model,
    messages: [{ role: 'system', content: 'модуль планирования' }, { role: 'user', content: 'задача' }],
    stream: false,
  }, 5000)
  const text1 = extractMessageContent(r1.data) ?? ''
  const reqs1 = mockStats()
  push(
    'A1: 403-гейт → повтор с tools → ответ через tool_calls',
    r1.usedTools && text1.includes('certainty') && reqs1.length === 2 && reqs1[0].toolsCount === 0 && reqs1[1].toolsCount === 1,
    [`запросов: ${reqs1.length} (tools: ${reqs1.map((r) => r.toolsCount).join('→')})`, `текст содержит JSON плана: ${text1.slice(0, 60)}…`]
  )

  // A2: кэш гейта — следующий запрос сразу с tools (1 запрос)
  mockReset()
  const r2 = await chatCompletionsRequest(GATED_CFG, {
    model: GATED_CFG.model,
    messages: [{ role: 'user', content: 'ping' }],
    stream: false,
  }, 5000)
  const reqs2 = mockStats()
  push(
    'A2: кэш гейта — сразу с tools, без лишнего 403',
    r2.usedTools && reqs2.length === 1 && reqs2[0].toolsCount === 1,
    [`запросов: ${reqs2.length}, tools: ${reqs2[0]?.toolsCount}`]
  )

  // A3: 200-inline-гейт (ошибка внутри успешного ответа)
  process.env.MOCK_MODE = 'agentic-inline'
  resetGateCacheForTests()
  mockReset()
  const r3 = await chatCompletionsRequest(GATED_CFG, { model: GATED_CFG.model, messages: [{ role: 'user', content: 'x' }] }, 5000)
  const reqs3 = mockStats()
  push(
    'A3: 200 с error-телом → гейт тоже обходится',
    r3.usedTools && reqs3.length === 2 && reqs3[0].toolsCount === 0 && reqs3[1].toolsCount === 1 && !!extractMessageContent(r3.data),
    [`запросов: ${reqs3.length} (tools: ${reqs3.map((r) => r.toolsCount).join('→')})`]
  )

  // A4: 404 → NonRetryableProviderError
  let err404: any = null
  try {
    await chatCompletionsRequest({ ...GATED_CFG, baseUrl: 'http://127.0.0.1:3099/v2' }, { model: GATED_CFG.model, messages: [] }, 5000)
  } catch (e: any) {
    err404 = e
  }
  push(
    'A4: 404 → NonRetryableProviderError (ретраи бессмысленны)',
    err404 instanceof NonRetryableProviderError && /HTTP 404/.test(err404?.message || ''),
    [err404?.message]
  )

  // A5: 429 → обычная ошибка (транзиентная, ретраится уровнем выше)
  process.env.MOCK_MODE = 'reject-429'
  resetGateCacheForTests()
  let err429: any = null
  try {
    await chatCompletionsRequest(GATED_CFG, { model: GATED_CFG.model, messages: [] }, 5000)
  } catch (e: any) {
    err429 = e
  }
  push(
    'A5: 429 → обычная Error (транзиентная)',
    err429 instanceof Error && !(err429 instanceof NonRetryableProviderError) && /HTTP 429/.test(err429?.message || ''),
    [err429?.message]
  )

  // A6: chatTextDetailed не ретраит NonRetryable (404) — ошибка сразу, без 900мс-задержек
  const t0 = Date.now()
  let errNoRetry: any = null
  try {
    await chatTextDetailed('sys', 'user', 5000, 2)
  } catch (e: any) {
    errNoRetry = e
  }
  const dur = Date.now() - t0
  push(
    'A6: 4xx не ретраится уровнем llm.ts — ошибка сразу',
    errNoRetry instanceof NonRetryableProviderError && /HTTP 404/.test(errNoRetry?.message || '') && dur < 800,
    [`длительность: ${dur}мс (с ретраями было бы ≥1800мс)`, errNoRetry?.message]
  )

  // A7: extractMessageContent — варианты
  const c1 = extractMessageContent({ choices: [{ message: { content: 'привет' } }] })
  const c2 = extractMessageContent({
    choices: [{ message: { content: null, tool_calls: [{ function: { name: 'submit_final_answer', arguments: JSON.stringify({ answer: 'ответ-1' }) } }] } }],
  })
  const c3 = extractMessageContent({
    choices: [{ message: { content: null, tool_calls: [{ function: { name: 'x', arguments: JSON.stringify({ result: 'рез' }) } }] } }],
  })
  const c4 = extractMessageContent({
    choices: [{ message: { content: null, tool_calls: [{ function: { name: 'x', arguments: 'сырой-текст' } }] } }],
  })
  const c5 = extractMessageContent({
    choices: [{ message: { content: null, tool_calls: [
      { function: { name: 'a', arguments: JSON.stringify({ answer: 'часть-1' }) } },
      { function: { name: 'b', arguments: JSON.stringify({ answer: 'часть-2' }) } },
    ] } }],
  })
  const c6 = extractMessageContent({ choices: [{ message: { content: '   ' } }] })
  const c7 = extractMessageContent({})
  push(
    'A7: extractMessageContent — content/answer/result/raw/мульти/пусто',
    c1 === 'привет' && c2 === 'ответ-1' && c3 === 'рез' && c4 === 'сырой-текст' && c5 === 'часть-1\n\nчасть-2' && c6 === null && c7 === null,
    [JSON.stringify({ c1, c2, c3, c4, c5, c6, c7 })]
  )

  // A8: validateProvider проходит гейт
  process.env.MOCK_MODE = 'agentic-gate'
  resetGateCacheForTests()
  mockReset()
  const v1 = await validateProvider(GATED_CFG, 5000)
  const vReqs = mockStats()
  push(
    'A8: validateProvider — проба проходит гейт (настройки inkling сохраняемы)',
    v1.ok === true && v1.agentic === true && vReqs.length === 2 && vReqs[0].toolsCount === 0 && vReqs[1].toolsCount === 1,
    [JSON.stringify({ ok: v1.ok, agentic: v1.agentic, latency: v1.latencyMs })]
  )

  // A9: валидация без гейта — обычный режим без tools
  process.env.MOCK_MODE = 'normal'
  resetGateCacheForTests()
  mockReset()
  const v2 = await validateProvider(GATED_CFG, 5000)
  const v2Reqs = mockStats()
  push(
    'A9: validateProvider обычный провайдер — без tools',
    v2.ok === true && v2.agentic === undefined && v2Reqs.length === 1 && v2Reqs[0].toolsCount === 0,
    [JSON.stringify({ ok: v2.ok, agentic: v2.agentic })]
  )
}

// ─────────────────────── Часть B: интеграция с движком ───────────────────────

async function partB(savedConfig: any) {
  const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })
  const waitConn = new Promise<void>((r) => socket.on('connect', () => r()))
  await Promise.race([waitConn, sleep(8000)])

  const saveConfig = (config: any): Promise<any> =>
    new Promise((resolve) => {
      socket.once('llm:config:saved', resolve)
      socket.emit('llm:config:save', { config })
    })
  const testConfig = (config: any): Promise<any> =>
    new Promise((resolve) => {
      socket.once('llm:config:test:result', resolve)
      socket.emit('llm:config:test', { config })
    })

  try {
    // B1: llm:config:test с гейтом — ok (конфиг оборачивается в default, как из UI)
    process.env.MOCK_MODE = 'agentic-gate'
    mockReset()
    const t1 = await testConfig({ default: GATED_CFG })
    push(
      'B1: llm:config:test с inkling:free — гейт обходится',
      t1?.ok === true && t1?.agentic === true,
      [JSON.stringify({ ok: t1?.ok, agentic: t1?.agentic, error: t1?.error })]
    )

    // B2: сохранение конфига (валидация пробой) — ok
    const s1 = await saveConfig({ default: GATED_CFG })
    push(
      'B2: llm:config:save с inkling:free — сохраняется',
      s1?.ok === true && s1?.config?.default?.model === GATED_CFG.model,
      [JSON.stringify({ ok: s1?.ok, error: s1?.error })]
    )

    // B3: полный LLM-прогон через гейт: история при старте + завершение
    mockReset()
    const createdPromise = new Promise<string>((resolve) => {
      const h = (d: any) => {
        if (d?.task?.includes('гейт-тест')) {
          socket.off('run:created', h)
          resolve(d.runId as string)
        }
      }
      socket.on('run:created', h)
    })
    const historyAtStart = new Promise<any[]>((resolve) => {
      const h = (d: any) => {
        const hit = (d?.runs ?? []).some((r: any) => r.task?.includes('гейт-тест') && (r.status === 'planning' || r.status === 'running'))
        if (hit) {
          socket.off('history:list', h)
          resolve(d.runs)
        }
      }
      socket.on('history:list', h)
    })
    socket.emit('run:start', { task: 'Интеграционный гейт-тест inkling', mode: 'llm', decisionMode: 'auto' })

    const createdRunId = await Promise.race([createdPromise, sleep(15000)])
    const hist = await Promise.race([historyAtStart, sleep(15000)])
    push(
      'B3: история содержит новый прогон сразу при старте (planning)',
      !!createdRunId && Array.isArray(hist) && hist.some((r: any) => r.task?.includes('гейт-тест') && r.status === 'planning'),
      [`runId: ${createdRunId}`, Array.isArray(hist) ? `верх истории: ${hist[0]?.task?.slice(0, 30)} · ${hist[0]?.status}` : 'history:list не пришёл']
    )

    const terminalEv = await new Promise<any>((resolve) => {
      const h = (d: any) => {
        if (d?.runId !== createdRunId) return
        const ev = d?.event
        if (ev?.type === 'run:status' && ['completed', 'stopped', 'error'].includes(ev.status)) {
          socket.off('run:event', h)
          resolve(ev)
        }
      }
      socket.on('run:event', h)
    })
    const terminal = await Promise.race([terminalEv, sleep(120000)])
    const finalReqs = mockStats()
    const withTools = finalReqs.filter((r) => r.toolsCount >= 1).length
    // CR-016: исполнитель идёт стримом БЕЗ tools (мок стримы не гейтит; реальный
    // провайдер ответил бы 403 — llm.ts откатывается на полный вызов с гейт-циклом,
    // ADR-023). Контракт гейта: все НЕстрид-вызовы после первого — с tools (кэш).
    const nonStream = finalReqs.filter((r) => !r.stream)
    const nonStreamNoTools = nonStream.filter((r) => r.toolsCount < 1).length
    push(
      'B4: LLM-прогон через гейт завершается (нестрид-вызовы после первого — с tools; стрим-попытки исполнителя — без tools, ADR-023)',
      terminal?.status === 'completed' &&
        !!createdRunId &&
        nonStream.length > 0 &&
        nonStreamNoTools <= 1 &&
        finalReqs.some((r) => r.stream),
      [
        `статус: ${terminal?.status}`,
        `запросов к моку: ${finalReqs.length}, с tools: ${withTools}, стрим: ${finalReqs.filter((r) => r.stream).length}`,
        `нестрид без tools: ${nonStreamNoTools} (допуск 1 — первичный прогрев кэша гейта)`,
        `runId: ${createdRunId}`,
      ]
    )

    // B5: provenance прогона — inkling:free
    const snapshot: any = await new Promise((resolve) => {
      socket.once('run:snapshot', (d: any) => resolve(d.run))
      socket.emit('run:load', { runId: createdRunId })
    })
    push(
      'B5: provenance прогона — thinkingmachines/inkling:free',
      snapshot?.llm?.planner?.model === GATED_CFG.model,
      [JSON.stringify(snapshot?.llm?.planner)]
    )
  } finally {
    // восстановление исходного конфига: через API (llm:config:save), чтобы
    // инвалидировать кэш движка — прямой файл-запись движок не видит, и
    // следующий за тестом LLM-прогон уходит в протухший baseUrl мока
    // (zai-адаптер сохраняется без пробного запроса — офлайн-безопасно)
    try {
      const restored = await saveConfig(savedConfig)
      if (restored?.ok !== true) {
        // фолбэк: файл + перезапуск кэша через повторный save недоступен —
        // хотя бы файл, чтобы не оставить движку мок-конфиг на диске
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(savedConfig, null, 2), 'utf-8')
        console.log('[test] ВНИМАНИЕ: конфиг восстановлен только в файле:', restored?.error)
      }
    } catch {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(savedConfig, null, 2), 'utf-8')
    }
    socket.disconnect()
  }
}

async function main() {
  const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  await startMock()
  try {
    await partA()
    await partB(savedConfig)
  } finally {
    await stopMock()
  }
  const failed = results.filter((r) => !r.ok)
  console.log('\n════════════ ИТОГ ════════════')
  console.log(`Пройдено: ${results.length - failed.length}/${results.length}`)
  if (failed.length) {
    console.log('Провалены:')
    failed.forEach((f) => console.log(`  ❌ ${f.name}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('[test] фатальная ошибка:', e)
  process.exit(1)
})
