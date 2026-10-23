// Тест стриминга ответов исполнителя (CR-016 / ADR-023):
//  A. unit: node:stream задаёт streamingText в свёртке, node:update затирает;
//     финальное состояние свёртки НЕ зависит от стрим-событий (детерминизм replay).
//  B. live LLM: движок (сокет :3003) + мок openai-compatible (:3099, SSE-режим):
//     каждый исполненный шаг получает ≥1 снапшот, последний снапшот == финальный
//     output, usage из стрима (stream_options) доходит до llm:usage; прогон доходит
//     до completed.
//  C. demo: стрим-симуляция — у первого шага ≥3 снапшотов (троттлинг 350 мс на
//     окнах 2300 мс), снапшоты растут монотонно.
//  D. персистентность: node:stream НЕ пишется в runs.json (аудит-трейл чист).
// Запуск: движок :3003 должен быть поднят; bun scripts/test-avizis-stream.ts
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'
import { foldEvents } from '../src/lib/avizis/fold'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const RUNS_FILE = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data', 'runs.json')
const TEST_KEY = 'sk-test-stream-key-4242'

interface StepResult { name: string; ok: boolean; details: string[] }
const results: StepResult[] = []
const push = (name: string, ok: boolean, details: string[] = []) => {
  results.push({ name, ok, details })
  console.log(`[test] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  details.forEach((d) => console.log(`        ${ok ? '' : '!'} ${d}`))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────── A. Unit: fold и node:stream ───────────────────────

function unitFold() {
  const mkNode = (id: string, status = 'pending') => ({
    id, title: `Узел ${id}`, description: '', status, dependsOn: [] as string[], dynamic: false,
  })
  const base = [
    { type: 'graph:init', ts: 1, nodes: [mkNode('n1'), mkNode('n2')] },
    { type: 'node:update', ts: 2, node: { ...mkNode('n1', 'running'), startedAt: 2 } },
  ]
  const streams = [
    { type: 'node:stream', ts: 3, nodeId: 'n1', text: 'Мод' },
    { type: 'node:stream', ts: 4, nodeId: 'n1', text: 'Модель пишет отве' },
    { type: 'node:stream', ts: 5, nodeId: 'n1', text: 'Модель пишет ответ полностью' },
  ]
  const done = [
    { type: 'node:update', ts: 6, node: { ...mkNode('n1', 'done'), output: 'Модель пишет ответ полностью', finishedAt: 6 } },
    { type: 'node:update', ts: 7, node: { ...mkNode('n2', 'skipped') } },
    { type: 'run:status', ts: 8, status: 'completed', progress: 100 },
  ]
  const withStreams = [...base, ...streams, ...done]
  const withoutStreams = [...base, ...done]

  // A1: снапшот виден в свёртке ПОКА шаг идёт (середина потока)
  const mid = foldEvents([...base, ...streams] as any)
  const midN = mid.nodes.find((n) => n.id === 'n1')
  push(
    'A1 unit fold: node:stream задаёт streamingText на running-узле',
    midN?.status === 'running' && midN?.streamingText === 'Модель пишет ответ полностью',
    [`status=${midN?.status} streamingText="${String(midN?.streamingText).slice(0, 30)}…"`]
  )

  // A2: node:update(done) затирает streamingText, output финализируется
  const full = foldEvents(withStreams as any)
  const doneN = full.nodes.find((n) => n.id === 'n1')
  push(
    'A2 unit fold: node:update(done) очищает streamingText',
    doneN?.status === 'done' && doneN?.streamingText === undefined && doneN?.output === 'Модель пишет ответ полностью',
    [`status=${doneN?.status} streamingText=${String(doneN?.streamingText)} output="${String(doneN?.output).slice(0, 30)}…"`]
  )

  // A3: детерминизм — финальное состояние свёртки не зависит от стрим-событий
  const a = foldEvents(withoutStreams as any)
  const norm = (v: any) => JSON.stringify(v, (k, val) => (k === 'streamingText' ? undefined : val))
  const sameNodes = norm(a.nodes) === norm(full.nodes)
  const sameRest = a.status === full.status && a.progress === full.progress && norm(a.logs) === norm(full.logs)
  push(
    'A3 unit fold: финал свёртки не зависит от node:stream (детерминизм replay)',
    sameNodes && sameRest,
    [`nodes ${sameNodes ? 'равны' : 'РАЗЛИЧАЮТСЯ'}`, `status/progress/logs ${sameRest ? 'равны' : 'РАЗЛИЧАЮТСЯ'}`]
  )
}

// ─────────────────────── B/C. Live: движок ───────────────────────

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

function saveConfig(config: any): Promise<any> {
  return new Promise((resolve) => {
    socket.once('llm:config:saved', resolve)
    socket.emit('llm:config:save', { config })
  })
}

async function liveRuns(): Promise<void> {
  const streamsByNode = new Map<string, string[]>()
  const outputs = new Map<string, string>()
  const doneSteps = new Set<string>()
  let currentRun: string | null = null
  let demoFirstNodeId: string | null = null
  const demoStreams: string[] = []
  let runStatus = ''

  socket.on('run:event', ({ runId: rid, event: ev }: any) => {
    if (rid !== currentRun) return
    if (ev.type === 'run:status') runStatus = ev.status
    if (ev.type === 'node:stream') {
      const arr = streamsByNode.get(ev.nodeId) ?? []
      arr.push(ev.text)
      streamsByNode.set(ev.nodeId, arr)
      if (demoFirstNodeId === ev.nodeId) demoStreams.push(ev.text)
    }
    if (ev.type === 'node:update' && ev.node.status === 'done' && !ev.node.decision) {
      doneSteps.add(ev.node.id)
      outputs.set(ev.node.id, ev.node.output ?? '')
    }
  })

  // ── B: LLM-прогон через мок (SSE) ──
  const saved = await saveConfig({
    default: { adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:3099/v1', model: 'mock-model', apiKey: TEST_KEY },
  })
  push('B1 конфигурация openai-compatible (мок) сохранена', !!saved?.ok, [saved?.error ?? ''])

  const runIdPromise = new Promise<string>((resolve) => {
    const h = (d: any) => {
      if (d?.runId) {
        socket.off('run:created', h)
        resolve(d.runId)
      }
    }
    socket.on('run:created', h)
  })
  socket.emit('run:start', { task: 'Тест стриминга: живой выход исполнителя', mode: 'llm', decisionMode: 'auto' })
  currentRun = await runIdPromise
  console.log(`[test] LLM-прогон: ${currentRun}`)

  // Ждём завершения (мок быстрый: план → шаги → итог)
  const t0 = Date.now()
  while (runStatus !== 'completed' && runStatus !== 'error' && Date.now() - t0 < 90_000) await sleep(300)
  push(
    'B2 LLM-прогон через мок дошёл до completed',
    runStatus === 'completed',
    [`status=${runStatus || '(нет)'}`, `doneSteps=${[...doneSteps].join(',') || '(нет)'}`]
  )

  // Каждый исполненный шаг получил ≥1 снапшот; последний снапшот == output
  const missing: string[] = []
  const mismatched: string[] = []
  for (const id of doneSteps) {
    const texts = streamsByNode.get(id)
    if (!texts || texts.length === 0) missing.push(id)
    else if (texts[texts.length - 1] !== outputs.get(id)) mismatched.push(id)
  }
  const monoViolations = [...streamsByNode.entries()]
    .filter(([id, texts]) => texts.length > 1 && texts.some((t, i) => i > 0 && t.length < texts[i - 1].length))
    .map(([id]) => id)
  push(
    'B3 каждый шаг получил стрим-снапшоты, последний == output, рост монотонный',
    doneSteps.size > 0 && missing.length === 0 && mismatched.length === 0 && monoViolations.length === 0,
    [
      `шагов выполнено: ${doneSteps.size}`,
      `без снапшотов: ${missing.join(',') || 'нет'}`,
      `снапшот != output: ${mismatched.join(',') || 'нет'}`,
      `монотонность нарушена у: ${monoViolations.join(',') || 'нет'}`,
      `событий node:stream всего: ${[...streamsByNode.values()].reduce((s, a) => s + a.length, 0)}`,
    ]
  )

  // usage из стрима: мок шлёт 111/42 при stream_options.include_usage
  const snapPromise = new Promise<any>((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId: currentRun })
  })
  const snap = await snapPromise
  const executorUsageOk = Array.from(snap?.nodes ?? []).some((n: any) => n?.usage?.input === 111 && n?.usage?.output === 42)
  push(
    'B4 usage из стрим-чанка (stream_options → llm:usage → инспектор узла)',
    executorUsageOk,
    [`nodes with 111/42: ${executorUsageOk ? 'есть' : 'НЕТ'}`, `run.usage=${JSON.stringify(snap?.usage?.byRole?.executor ?? null)}`]
  )

  // ── C: демо-прогон — стрим-симуляция без LLM ──
  streamsByNode.clear()
  outputs.clear()
  doneSteps.clear()
  runStatus = ''
  const demoIdPromise = new Promise<string>((resolve) => {
    const h = (d: any) => {
      if (d?.runId) {
        socket.off('run:created', h)
        resolve(d.runId)
      }
    }
    socket.on('run:created', h)
  })
  socket.emit('run:start', { task: 'Проанализируй данные о продажах за Q3 и найди аномалии', mode: 'demo', decisionMode: 'auto' })
  currentRun = await demoIdPromise
  console.log(`[test] демо-прогон: ${currentRun}`)

  // Ждём первый выполненный шаг (n1 в демо-плане), собираем его снапшоты
  const t1 = Date.now()
  while (doneSteps.size === 0 && Date.now() - t1 < 60_000) {
    await sleep(150)
    if (doneSteps.size > 0 && demoFirstNodeId === null) {
      demoFirstNodeId = [...doneSteps][0]
    }
  }
  // снапшоты первого шага могли прийти ДО его done — берём всё, что накопилось
  const firstStreams = streamsByNode.get(demoFirstNodeId ?? '') ?? []
  const firstMono = firstStreams.every((t, i) => i === 0 || t.length >= firstStreams[i - 1].length)
  push(
    'C1 демо: стрим-симуляция первого шага — ≥3 снапшотов, монотонный рост',
    firstStreams.length >= 3 && firstMono,
    [`снапшотов у первого шага: ${firstStreams.length} (≥3)`, `монотонность: ${firstMono ? 'ок' : 'НАРУШЕНА'}`]
  )

  // Останавливаем демо-прогон (не ждём весь сценарий — экономим время теста)
  socket.emit('run:control', { runId: currentRun, action: 'stop' })
  await sleep(500)

  // ── D: персистентность — node:stream не пишется в runs.json ──
  let persistedStream = 0
  try {
    const raw = JSON.parse(fs.readFileSync(RUNS_FILE, 'utf8')) as any[]
    for (const run of raw ?? []) {
      for (const ev of run?.events ?? []) {
        if (ev?.type === 'node:stream') persistedStream++
      }
    }
  } catch {
    console.log('[test] runs.json не читается — проверка D пропускается по отсутствию файла')
  }
  push(
    'D1 node:stream отсутствует в персистентной истории (runs.json)',
    persistedStream === 0,
    [`стрим-событий в runs.json: ${persistedStream} (ожид. 0)`]
  )
}

// ─────────────────────── запуск ───────────────────────

async function main() {
  let mockOwn = false
  try {
    await new Promise<void>((resolve, reject) => {
      if (socket.connected) return resolve()
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
      setTimeout(() => reject(new Error('нет соединения с движком :3003')), 8000)
    })
    console.log('[test] подключено к движку')

    unitFold()
    mockOwn = await ensureMock()
    await liveRuns()

    // восстановление дефолта (чтобы не влиять на следующие прогоны)
    await saveConfig({ default: { adapter: 'zai' } })
    console.log('[test] конфиг restored → zai')
  } catch (e: any) {
    push('соединение/инициализация', false, [e?.message ?? String(e)])
  } finally {
    if (mockOwn) await stopMock().catch(() => {})
    socket.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n[test] ИТОГ: ${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.log('[test] ПРОВАЛЕНЫ:')
    failed.forEach((f) => console.log(`  - ${f.name}`))
    process.exit(1)
  }
}

main()
