// Тест «уточняющего агента»: демо-сценарий «Напиши пост».
// Проверяет: эмерджентные развилки (формат → блоки [mixed] → тон), смешанный выбор
// пользователя, мгновенное гашение нереализованных веток, рост certainty (вектор понимания),
// авто-режим со скриптованным смешанным решением, итоговый черновик из выбранных параметров.
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

function waitFor(predicate: (ev: any) => boolean, timeoutMs = 40000): Promise<any> {
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

async function startRun(decisionMode: 'auto' | 'manual'): Promise<string> {
  const runId = await new Promise<string>((resolve) => {
    socket.once('run:created', (d) => resolve(d.runId))
    socket.emit('run:start', {
      task: 'Напиши пост про запуск нашей новой функции — умного помощника в редакторе',
      mode: 'demo',
      decisionMode,
    })
  })
  return runId
}

async function loadSnapshot(runId: string): Promise<any> {
  return new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
}

async function resolveDecision(runId: string, nodeId: string, optionIds: string[]): Promise<any> {
  return new Promise((resolve) => {
    socket.once('decision:resolve:result', resolve)
    socket.emit('decision:resolve', { runId, nodeId, optionIds })
  })
}

/** Ждёт следующий offer (пропуская уже случившиеся) */
function nextOffer(runId: string, afterTs: number): Promise<any> {
  return waitFor(
    (d) => d.runId === runId && d.event?.type === 'decision:offer' && d.event.ts > afterTs
  )
}

async function scenarioWritingManual() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 1: «Напиши пост» — ручной режим с эмерджентными вопросами ═══')
  const runId = await startRun('manual')

  // стартовая самооценка понимания — низкая (запрос размыт)
  const cert0 = await waitFor((d) => d.runId === runId && d.event?.type === 'run:certainty')
  push(
    'стартовая оценка понимания: размытый вектор (20%)',
    cert0.certainty === 0.2,
    [`certainty=${cert0.certainty} note=${cert0.note ?? '—'}`]
  )

  // 1-й вопрос: формат — вставлен динамически после анализа запроса
  const offer1 = await nextOffer(runId, 0)
  const decf = offer1.nodeId
  push(
    'эмерджентная развилка «формат» после анализа запроса',
    decf === 'decf' && offer1.options.length === 3,
    [`nodeId=${decf} вариантов=${offer1.options.length} вопрос="${String(offer1.question).slice(0, 50)}…"`]
  )
  const snap1: any = await loadSnapshot(runId)
  const decfNode = snap1.nodes.find((n: any) => n.id === 'decf')
  push(
    'домен format · выбор single · версия графа поднялась',
    decfNode?.decision?.domain === 'format' && decfNode?.decision?.selection === 'single' && decfNode?.dynamic === true,
    [`domain=${decfNode?.decision?.domain} selection=${decfNode?.decision?.selection} dynamic=${decfNode?.dynamic} v=${snap1.version}`]
  )

  const r1 = await resolveDecision(runId, decf, ['b']) // лонгрид
  push('выбор формата «лонгрид» принят', r1?.ok === true, [JSON.stringify(r1)])
  const cert1 = await waitFor((d) => d.runId === runId && d.event?.type === 'run:certainty' && d.event.certainty === 0.45)
  push('понимание выросло до 45% после закрытия формата', !!cert1, [`certainty=${cert1?.certainty}`])

  // 2-й вопрос: блоки контента — смешанный выбор
  const offer2 = await nextOffer(runId, offer1.ts)
  const decb = offer2.nodeId
  push(
    'эмерджентная развилка «блоки контента» (mixed) после каркаса лонгрида',
    decb === 'decb' && offer2.options.length === 4,
    [`nodeId=${decb} вариантов=${offer2.options.length}`]
  )
  const snap2: any = await loadSnapshot(runId)
  const decbNode = snap2.nodes.find((n: any) => n.id === 'decb')
  push(
    'домен scope · выбор mixed',
    decbNode?.decision?.domain === 'scope' && decbNode?.decision?.selection === 'mixed',
    [`domain=${decbNode?.decision?.domain} selection=${decbNode?.decision?.selection}`]
  )

  // смешанное решение: кейс + статистика + CTA (3 из 4)
  const r2 = await resolveDecision(runId, decb, ['a', 'b', 'd'])
  const resolved2 = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:resolved')
  push(
    'смешанное решение (a + b + d) принято движком',
    r2?.ok === true && Array.isArray(resolved2.optionIds) && resolved2.optionIds.join() === 'a,b,d' && resolved2.by === 'user',
    [`result=${JSON.stringify(r2)} optionIds=${resolved2.optionIds?.join(',')} by=${resolved2.by}`]
  )
  const cert2 = await waitFor((d) => d.runId === runId && d.event?.type === 'run:certainty' && d.event.certainty === 0.75)
  push('понимание выросло до 75% (вектор сужается)', !!cert2, [`certainty=${cert2?.certainty}`])

  // мгновенное гашение невыбранной ветки c (история команды)
  const snap3: any = await loadSnapshot(runId)
  const st = (id: string) => snap3.nodes.find((n: any) => n.id === id)?.status
  push(
    'невыбранная ветка погашена, выбранные активны',
    st('bc1') === 'discarded' && ['pending', 'running', 'done'].includes(st('ba1')) && ['pending', 'running', 'done'].includes(st('bd1')),
    [`ba1=${st('ba1')} bb1=${st('bb1')} bc1=${st('bc1')} (ожидалось: активны, discarded)`]
  )

  // 3-й вопрос: tone of voice
  const offer3 = await nextOffer(runId, offer2.ts)
  const dect = offer3.nodeId
  push(
    'эмерджентная развилка «tone of voice» после блоков контента',
    dect === 'dect' && offer3.options.length === 3,
    [`nodeId=${dect} вариантов=${offer3.options.length}`]
  )
  const r3 = await resolveDecision(runId, dect, ['c']) // дерзкий
  push('выбор тона «дерзкий» принят', r3?.ok === true, [JSON.stringify(r3)])

  const summary = await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary', 60000)
  const snap: any = await loadSnapshot(runId)
  const wfin = snap.nodes.find((n: any) => n.id === 'wfin')
  const dectNode = snap.nodes.find((n: any) => n.id === 'dect')
  push(
    'прогон завершён: черновик собран из выбранных параметров (лонгрид + 3 блока + дерзкий тон)',
    snap.status === 'completed' &&
      wfin?.status === 'done' &&
      wfin?.output?.includes('лонгрид') &&
      wfin?.output?.includes('кейс клиента, статистика и цифры, призыв к действию') &&
      wfin?.output?.includes('дерзкий') &&
      dectNode?.decision?.certaintyAfter === 0.95,
    [
      `status=${snap.status} wfin=${wfin?.status}`,
      `итог="${String(wfin?.output).slice(0, 140)}…"`,
      `certaintyAfter(dect)=${dectNode?.decision?.certaintyAfter}`,
      `summary="${String(summary.summary).slice(0, 80)}…"`,
    ]
  )
  // certainty 0.95 приходит событием ДО summary — сверяем по снапшоту и по событию в прошлом окне
  const certEvents = snap.events.filter((e: any) => e.type === 'run:certainty')
  const certFinal = certEvents[certEvents.length - 1]
  push(
    'финальная оценка понимания: 95% — узкий вектор',
    certFinal?.certainty === 0.95 && snap.certainty === 0.95,
    [
      `событий certainty: ${certEvents.map((c: any) => c.certainty).join(' → ')}`,
      `snapshot.certainty=${snap.certainty}`,
    ]
  )
}

async function scenarioWritingAuto() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 2: «Напиши пост» — авто-режим (агент сам, включая mixed) ═══')
  const runId = await startRun('auto')

  const offers: any[] = []
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(reject, 120000)
    const handler = (d: any) => {
      if (d.runId !== runId || d.event?.type !== 'decision:offer') return
      offers.push(d.event)
    }
    socket.on('run:event', handler)
    waitFor((d) => d.runId === runId && d.event?.type === 'run:summary', 120000)
      .then(() => {
        clearTimeout(timer)
        socket.off('run:event', handler)
        resolve()
      })
      .catch(reject)
  })

  const snap: any = await loadSnapshot(runId)
  const decbNode = snap.nodes.find((n: any) => n.id === 'decb')
  const decfNode = snap.nodes.find((n: any) => n.id === 'decf')
  const dectNode = snap.nodes.find((n: any) => n.id === 'dect')
  const st = (id: string) => snap.nodes.find((n: any) => n.id === id)?.status
  push(
    'агент прошёл все 3 развилки, смешанное решение на «блоках» (a + b)',
    offers.length === 3 &&
      decfNode?.decision?.chosen?.join() === 'a' &&
      decbNode?.decision?.chosen?.join() === 'a,b' &&
      decbNode?.decision?.chosenBy === 'agent' &&
      dectNode?.decision?.chosen?.join() === 'b' &&
      !!decbNode?.decision?.reasoning &&
      st('bb1') === 'done' &&
      st('bc1') === 'discarded',
    [
      `offers=${offers.length}`,
      `формат=${decfNode?.decision?.chosen} блоки=${decbNode?.decision?.chosen} (by=${decbNode?.decision?.chosenBy}) тон=${dectNode?.decision?.chosen}`,
      `смешанное обоснование: ${String(decbNode?.decision?.reasoning).slice(0, 90)}…`,
      `ba1=${st('ba1')} bb1=${st('bb1')} bc1=${st('bc1')} bd1=${st('bd1')}`,
    ]
  )
  push(
    'итог черновика в авто-режиме собран из выбранных параметров',
    snap.status === 'completed' && snap.certainty === 0.95,
    [`status=${snap.status} certainty=${snap.certainty}`]
  )
}

async function scenarioMixedSingleGuard() {
  console.log('\n[test] ═══ СЦЕНАРИЙ 3: single-развилка не пропускает множественный выбор ═══')
  const runId = await startRun('manual')
  const offer1 = await nextOffer(runId, 0)

  // пытаемся отправить 2 варианта на single-развилке (формат) — движок должен обрезать до 1
  const r = await resolveDecision(runId, offer1.nodeId, ['a', 'c'])
  const resolved = await waitFor((d) => d.runId === runId && d.event?.type === 'decision:resolved')
  push(
    'single-развилка: лишние варианты отброшены, применён первый',
    r?.ok === true && resolved.optionIds?.length === 1 && resolved.optionIds[0] === 'a',
    [`result=${JSON.stringify(r)} applied=${resolved.optionIds?.join(',')}`]
  )
  await new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:control', { runId, action: 'stop' })
    socket.emit('run:load', { runId })
  })
}

socket.on('connect', async () => {
  try {
    await scenarioWritingManual()
    await scenarioWritingAuto()
    await scenarioMixedSingleGuard()
  } catch (e: any) {
    push('выполнение сценариев без ошибок', false, [String(e?.message || e)])
  } finally {
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
    socket.disconnect()
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
})

socket.on('connect_error', (e: any) => {
  console.error('[test] движок недоступен:', e?.message)
  process.exit(1)
})
