// Отладка: авто-прогон сценария «Напиши пост» — печать всех событий
import { io } from 'socket.io-client'

const socket = io('http://localhost:3003', { path: '/', transports: ['websocket'] })

socket.on('connect', () => {
  console.log('[dbg] подключён, запускаю авто-прогон «Напиши пост»')
  socket.emit('run:start', {
    task: 'Напиши пост про запуск нашей новой функции — умного помощника в редакторе',
    mode: 'demo',
    decisionMode: 'auto',
  })
})

socket.on('run:created', (d: any) => console.log(`[dbg] run:created ${d.runId}`))

socket.on('run:event', (d: any) => {
  const ev = d.event
  const t = ev?.type
  if (t === 'node:update') {
    const n = ev.node
    const dec = n.decision
    const decInfo = dec ? ` [${dec.status}${dec.chosen ? ` chosen=${JSON.stringify(dec.chosen)}` : ''}]` : ''
    console.log(`[dbg] node:update ${n.id} → ${n.status}${decInfo}`)
  } else if (t === 'log') {
    console.log(`[dbg] log: ${ev.entry.message.slice(0, 110)}`)
  } else if (t === 'run:status') {
    console.log(`[dbg] status: ${ev.status} ${ev.progress}%`)
  } else if (t === 'run:certainty') {
    console.log(`[dbg] certainty: ${ev.certainty} (${ev.note ?? ''})`)
  } else if (t === 'decision:offer' || t === 'decision:resolved' || t === 'decision:mode') {
    console.log(`[dbg] ${t}: ${JSON.stringify(ev).slice(0, 180)}`)
  } else {
    console.log(`[dbg] ${t}: ${JSON.stringify(ev).slice(0, 120)}`)
  }
  if (t === 'run:summary' || (t === 'run:status' && ['completed', 'error', 'stopped'].includes(ev.status))) {
    console.log('[dbg] ФИНАЛ — отключаюсь')
    setTimeout(() => process.exit(0), 400)
  }
})

socket.on('error:server', (e: any) => console.log('[dbg] ERROR:', e))

setTimeout(() => {
  console.log('[dbg] ⏱ 90с прошло без финала — принудительный выход')
  process.exit(1)
}, 90000)
