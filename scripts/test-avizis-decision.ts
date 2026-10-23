// Тест ветвлений решений Avizis: ручной выбор, авто-режим, переключение на ходу
import { io } from 'socket.io-client'

const socket = io('http://localhost:3003', { path: '/', transports: ['websocket'] })

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

/** Ожидание события определённого типа для конкретного запуска */
function waitFor(predicate: (ev: any) => boolean, timeoutMs = 30000): Promise<any> {
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

/** Запуск и ожидание предложения развилки */
async function startRun(decisionMode: 'auto' | 'manual'): Promise<string> {
  const runId = await new Promise<string>((resolve) => {
    socket.once('run:created', (d) => resolve(d.runId))
    socket.emit('run:start', {
      task: 'Проанализируй данные о продажах за Q3 и найди аномалии',
      mode: 'demo',
      decisionMode,
    })
  })
  return runId
}

async function scenarioManual() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 1: ручной выбор варианта ═══')
  const runId = await startRun('manual')
  const offer = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:offer')
  console.log(`[test] развилка предложена: «${offer.question.slice(0, 60)}…» · вариантов: ${offer.options.length}`)

  const resolveResult = await new Promise<any>((resolve) => {
    socket.once('decision:resolve:result', resolve)
    socket.emit('decision:resolve', { runId, nodeId: offer.nodeId, optionIds: ['a'] })
  })
  push('вариант a принят движком', resolveResult?.ok === true, [JSON.stringify(resolveResult)])

  const done = await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary')
  const snapshot: any = await new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
  const byId = new Map<string, any>(snapshot.nodes.map((n: any) => [n.id, n]))
  const dec = byId.get('dec1')
  const chosen = Array.isArray(dec?.decision?.chosen) ? dec.decision.chosen.join() : dec?.decision?.chosen
  const b1a = byId.get('b1a')?.status
  const b1b = byId.get('b1b')?.status
  const b2b = byId.get('b2b')?.status
  const b1c = byId.get('b1c')?.status
  const n3 = byId.get('n3')?.status
  const ok =
    chosen === 'a' &&
    dec?.decision?.chosenBy === 'user' &&
    b1a === 'done' &&
    b1b === 'discarded' &&
    b2b === 'discarded' &&
    b1c === 'discarded' &&
    n3 === 'done' &&
    snapshot.status === 'completed'
  push(
    'ветка a выполнена, ветки b/c погашены, итог собран',
    ok,
    [
      `chosen=${chosen} by=${dec?.decision?.chosenBy}`,
      `b1a=${b1a} b1b=${b1b} b2b=${b2b} b1c=${b1c} n3=${n3}`,
      `прогресс=${snapshot.progress}% итог="${String(done.summary).slice(0, 80)}…"`,
      `n3.output затрагивает стратегию: ${byId.get('n3')?.output?.includes('быстрой стратегии') ? 'да' : 'НЕТ'}`,
    ]
  )
}

async function scenarioAuto() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 2: авто-режим (агент решает сам) ═══')
  const runId = await startRun('auto')
  const offer = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:offer')
  const resolved = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:resolved')
  console.log(`[test] агент выбрал: ${(resolved.optionIds ?? []).join(',')} · обоснование: ${String(resolved.reasoning).slice(0, 80)}…`)
  await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary')

  const snapshot: any = await new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
  const byId = new Map<string, any>(snapshot.nodes.map((n: any) => [n.id, n]))
  const dec = byId.get('dec1')
  const ok =
    Array.isArray(dec?.decision?.chosen) && dec?.decision?.chosen.join() === 'b' &&
    dec?.decision?.chosenBy === 'agent' &&
    !!dec?.decision?.reasoning &&
    byId.get('b1b')?.status === 'done' &&
    byId.get('b2b')?.status === 'done' &&
    byId.get('b1a')?.status === 'discarded' &&
    byId.get('b1c')?.status === 'discarded'
  push(
    'агент выбрал b (глубокое расследование) с обоснованием, ветка b выполнена',
    ok,
    [
      `chosen=${dec?.decision?.chosen} by=${dec?.decision?.chosenBy} reasoning=${dec?.decision?.reasoning ? 'есть' : 'НЕТ'}`,
      `b1b=${byId.get('b1b')?.status} b2b=${byId.get('b2b')?.status} (ожидалось done/done)`,
      `предложение развилки: вариантов ${offer.options.length}`,
    ]
  )
}

async function scenarioSwitchToAuto() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 3: ожидание прервано переключением в «авто» ═══')
  const runId = await startRun('manual')
  const offer = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:offer')

  // ждём 1.5с в режиме ожидания, затем переключаем на авто — агент должен решить сам
  await new Promise((r) => setTimeout(r, 1500))
  const modeResult = await new Promise<any>((resolve) => {
    socket.once('decision:mode:result', resolve)
    socket.emit('decision:mode', { runId, mode: 'auto' })
  })
  const resolved = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:resolved')
  await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary')

  const snapshot: any = await new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
  const dec = snapshot.nodes.find((n: any) => n.id === 'dec1')
  const ok =
    modeResult?.ok === true &&
    resolved.by === 'agent' &&
    dec?.decision?.chosenBy === 'agent' &&
    snapshot.status === 'completed'
  push(
    'переключение в «авто» во время ожидания: агент принял решение за пользователя',
    ok,
    [
      `decision:mode result=${JSON.stringify(modeResult)}`,
      `resolved by=${resolved.by} option=${(resolved.optionIds ?? []).join(',')}`,
      `snapshot: chosenBy=${dec?.decision?.chosenBy} status=${snapshot.status}`,
    ]
  )
}

socket.on('connect', async () => {
  console.log('[test] подключено к движку Avizis')
  try {
    await scenarioManual()
    await scenarioAuto()
    await scenarioSwitchToAuto()
  } catch (e: any) {
    push('выполнение сценариев', false, [e?.message || String(e)])
  }
  const failed = results.filter((r) => !r.ok)
  console.log('\n[test] ─── ИТОГИ ───')
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}`))
  console.log(failed.length === 0 ? '✅ ВСЕ СЦЕНАРИИ ПРОЙДЕНЫ' : `❌ ПРОВАЛЕНО: ${failed.length}`)
  socket.disconnect()
  process.exit(failed.length === 0 ? 0 : 1)
})

socket.on('error:server', ({ message }: any) => console.log(`[test] ОШИБКА СЕРВЕРА: ${message}`))

setTimeout(() => {
  console.log('[test] глобальный таймаут — выход')
  process.exit(1)
}, 120000)
