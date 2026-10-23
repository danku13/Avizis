// Тест аудита токенов (ADR-015 / CR-009): захват usage из openai-compatible,
// событие llm:usage в потоке (replay!), сводка RunSnapshot.usage, атрибуция узлам,
// записи журнала «· токены: ↑N / ↓M», итог запуска, персистентность в runs.json,
// отсутствие ключа в артефактах. Паттерн — test-avizis-byok.ts (мок :3099, сокет :3003).
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'
import { foldEvents } from '../src/lib/avizis/fold'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const RUNS_FILE = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data', 'runs.json')
const TEST_KEY = 'sk-test-usage-key-8181'

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

async function restoreDefault() {
  try {
    const r = await saveConfig({ default: { adapter: 'zai' } })
    console.log(`[test] восстановление дефолта zai: ${r?.ok ? 'ок' : `ошибка: ${r?.error}`}`)
  } catch (e: any) {
    console.error('[test] не удалось восстановить дефолт:', e?.message || e)
  }
}

// ─────────────────────── A. Unit: foldEvents копит usage ───────────────────────

function unitFold() {
  const mkNode = (id: string, status = 'pending') => ({ id, title: `Узел ${id}`, description: '', status, dependsOn: [], dynamic: false })
  const events: any[] = [
    { type: 'graph:init', ts: 1, nodes: [mkNode('n1'), mkNode('n2')] },
    { type: 'llm:usage', ts: 2, role: 'planner', inputTokens: 100, outputTokens: 20 },
    { type: 'node:update', ts: 3, node: { ...mkNode('n1', 'running'), input: 'задача' } },
    { type: 'llm:usage', ts: 4, role: 'executor', nodeId: 'n1', inputTokens: 100, outputTokens: 20 },
    { type: 'node:update', ts: 5, node: { ...mkNode('n1', 'done'), output: 'результат', usage: { input: 100, output: 20 } } },
    { type: 'llm:usage', ts: 6, role: 'supervisor', inputTokens: 50, outputTokens: 10 },
    { type: 'llm:usage', ts: 7, role: 'executor', nodeId: 'n2', inputTokens: 100, outputTokens: 20 },
    { type: 'llm:usage', ts: 8, role: 'decider', nodeId: 'n2', inputTokens: 30, outputTokens: 5 },
    { type: 'node:update', ts: 9, node: { ...mkNode('n2', 'done'), usage: { input: 130, output: 25 } } },
    { type: 'run:status', ts: 10, status: 'completed', progress: 100 },
  ]

  const view = foldEvents(events)
  push(
    'A1 unit fold: итоги и разбивка по ролям',
    view.usage?.calls === 5 && view.usage?.inputTokens === 380 && view.usage?.outputTokens === 75 &&
      view.usage.byRole.planner?.calls === 1 && view.usage.byRole.planner?.inputTokens === 100 &&
      view.usage.byRole.executor?.calls === 2 && view.usage.byRole.supervisor?.calls === 1 && view.usage.byRole.decider?.calls === 1,
    [
      `calls=${view.usage?.calls} (ожид. 5)`,
      `input=${view.usage?.inputTokens} (ожид. 380)`,
      `output=${view.usage?.outputTokens} (ожид. 75)`,
      `executor.calls=${view.usage?.byRole.executor?.calls} (ожид. 2)`,
    ]
  )

  const n1 = view.nodes.find((n: any) => n.id === 'n1')
  const n2 = view.nodes.find((n: any) => n.id === 'n2')
  push(
    'A2 unit fold: атрибуция токенов узлам',
    n1?.usage?.input === 100 && n1?.usage?.output === 20 && n2?.usage?.input === 130 && n2?.usage?.output === 25,
    [`n1.usage=${JSON.stringify(n1?.usage)}`, `n2.usage=${JSON.stringify(n2?.usage)}`]
  )

  // replay: свёртка до курсора (события 0..4) — только planner + executor(n1)
  const mid = foldEvents(events.slice(0, 5))
  const midN1 = mid.nodes.find((n: any) => n.id === 'n1')
  push(
    'A3 unit fold: replay до курсора считает только прошлые вызовы',
    mid.usage?.calls === 2 && mid.usage?.inputTokens === 200 && midN1?.usage?.input === 100,
    [`calls=${mid.usage?.calls} (ожид. 2)`, `input=${mid.usage?.inputTokens} (ожид. 200)`, `n1=${midN1?.usage?.input}`]
  )

  const empty = foldEvents([])
  push('A4 unit fold: пустой поток — usage не определён', empty.usage === undefined, [`usage=${empty.usage}`])
}

// ─────────────────────── B. Интеграция: мок-провайдер → движок ───────────────────────

socket.on('connect', async () => {
  let mockOwn = false
  try {
    // A: юнит-проверки fold (без движка)
    unitFold()

    // B1: мок + конфигурация openai-compatible
    mockOwn = await ensureMock()
    const saved = await saveConfig({
      default: { adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:3099/v1', model: 'mock-model', apiKey: TEST_KEY },
    })
    push('B1 конфигурация openai-compatible (мок) сохранена', !!saved?.ok, [saved?.error ?? ''])

    // B2: запуск LLM-прогона в авто-режиме до завершения
    // (подписка на run:created — ДО emit, чтобы не пропустить broadcast)
    const runIdPromise = new Promise<string>((resolve) => {
      const h = (d: any) => {
        if (d?.runId) {
          socket.off('run:created', h)
          resolve(d.runId)
        }
      }
      socket.on('run:created', h)
    })
    socket.emit('run:start', { task: 'Тест токенов: аудит использования LLM', mode: 'llm', decisionMode: 'auto' })
    await waitFor((d) => d?.event?.type === 'run:status' && d.event.status === 'completed')
    const id = await runIdPromise

    const snap: any = await loadSnapshot(id)

    // B3: сводка по запуску. Ожидаемая арифметика мока после CR-016 (исполнитель — стрим,
    // usage его SSE-хвоста 111/42 на вызов; остальные роли — полный вызов 100/20):
    // planner 1×(100/20) + executor 3×(111/42) + supervisor 2×(100/20) + decider 1×(100/20)
    // = 7 вызовов, ↑733 / ↓206
    const u = snap?.usage
    push(
      'B3 сводка usage: итоги и разбивка по ролям',
      u?.calls === 7 && u?.inputTokens === 733 && u?.outputTokens === 206 &&
        u.byRole?.planner?.calls === 1 && u.byRole?.executor?.calls === 3 &&
        u.byRole?.supervisor?.calls === 2 && u.byRole?.decider?.calls === 1,
      [
        `calls=${u?.calls} (ожид. 7)`,
        `input=${u?.inputTokens} (ожид. 733)`,
        `output=${u?.outputTokens} (ожид. 206)`,
        `roles=${JSON.stringify(u?.byRole)}`,
      ]
    )

    // B4: события llm:usage в потоке (для replay): исполнитель — 111/42 (стрим-хвост), прочие — 100/20
    const usageEvents = (snap?.events ?? []).filter((e: any) => e.type === 'llm:usage')
    const sumIn = usageEvents.reduce((acc: number, e: any) => acc + (e.inputTokens || 0), 0)
    const sumOut = usageEvents.reduce((acc: number, e: any) => acc + (e.outputTokens || 0), 0)
    push(
      'B4 события llm:usage в потоке прогона',
      usageEvents.length === 7 && sumIn === 733 && sumOut === 206 && usageEvents.every((e: any) => e.inputTokens > 0 && e.outputTokens > 0),
      [`событий=${usageEvents.length} (ожид. 7), Σin=${sumIn} Σout=${sumOut}`]
    )

    // B5: атрибуция узлам: исполнитель n1/ba1/nfin — 111/42 (стрим), decider dec1 — 100/20;
    //     гаснут ветки — без usage
    const byId = new Map<string, any>((snap?.nodes ?? []).map((n: any) => [n.id, n] as [string, any]))
    const expStream = ['n1', 'ba1', 'nfin']
    const expFull = ['dec1']
    const nodesOk =
      expStream.every((nid) => byId.get(nid)?.usage?.input === 111 && byId.get(nid)?.usage?.output === 42) &&
      expFull.every((nid) => byId.get(nid)?.usage?.input === 100 && byId.get(nid)?.usage?.output === 20)
    const discardedClean = ['bb1', 'bb2', 'bc1'].every((nid) => !byId.get(nid)?.usage)
    push(
      'B5 атрибуция usage узлам (исполнитель/решатель)',
      nodesOk && discardedClean,
      [...expStream, ...expFull].map((nid) => `${nid}=${JSON.stringify(byId.get(nid)?.usage)}`),
    )

    // B6: журнал — токены в записях шагов (исполнитель — стрим 111/42), плана и итога
    const logs: any[] = snap?.logs ?? []
    const doneLogs = logs.filter((l: any) => l.kind === 'node-done')
    const planLog = logs.find((l: any) => l.kind === 'plan' && l.message.includes('Планировщик:'))
    const finalLog = logs.find((l: any) => l.kind === 'run' && l.message.includes('Задача выполнена'))
    push(
      'B6 журнал: «· токены: ↑N / ↓M» в шагах/плане/итоге',
      doneLogs.length === 3 && doneLogs.every((l: any) => l.message.includes('· токены: ↑111 / ↓42')) &&
        !!planLog?.message.includes('· токены: ↑100 / ↓20') &&
        !!finalLog?.message.includes('токены: ↑733 / ↓206 (7 вызов. LLM)'),
      [
        `node-done с токенами: ${doneLogs.filter((l: any) => l.message.includes('токены')).length}/3`,
        `план: ${planLog?.message.slice(0, 80)}`,
        `итог: ${finalLog?.message}`,
      ]
    )

    // B7: summary прогона содержит итог
    push(
      'B7 summary прогона с итогом токенов',
      !!snap?.summary?.includes('токены: ↑733 / ↓206 (7 вызов. LLM)'),
      [snap?.summary?.slice(0, 120)]
    )

    // B8: replay через fold по снапшоту (движок и фронтенд сходятся в цифрах)
    const view = foldEvents(snap.events)
    push(
      'B8 fold по событиям снапшота = сводка движка',
      view.usage?.calls === 7 && view.usage?.inputTokens === 733 && view.usage?.outputTokens === 206 &&
        view.nodes.find((n: any) => n.id === 'n1')?.usage?.input === 111,
      [`fold.calls=${view.usage?.calls}`, `fold.input=${view.usage?.inputTokens}`]
    )

    // B9: персистентность в runs.json (debounce store — 600 мс) и ключ не утёк
    await sleep(1100)
    const raw = fs.readFileSync(RUNS_FILE, 'utf-8')
    const persisted = JSON.parse(raw)
    const persistedRun = (Array.isArray(persisted) ? persisted : persisted.runs ?? []).find((r: any) => r.id === id)
    push(
      'B9 runs.json: usage сохранён, ключа нет',
      persistedRun?.usage?.calls === 7 && persistedRun?.usage?.inputTokens === 733 && !raw.includes(TEST_KEY),
      [`usage.calls=${persistedRun?.usage?.calls}`, `ключ в runs.json: ${raw.includes(TEST_KEY)}`]
    )

    // B10: provenance остался (роль → адаптер/модель) — регрессия BYOK
    push(
      'B10 регрессия provenance: snapshot.llm и node.llm на месте',
      snap?.llm?.planner?.adapter === 'openai-compatible' && snap?.llm?.planner?.model === 'mock-model' && !!byId.get('n1')?.llm?.model,
      [JSON.stringify(snap?.llm)]
    )
  } catch (e: any) {
    push('интеграционный прогон упал', false, [e?.message || String(e)])
  } finally {
    await restoreDefault()
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
