// Диагностика: что реально получает фронтенд при запуске агента (demo-режим)
// Воспроизводит действия HistoryPanel: emit('run:start') + слушает все события.
import { io } from 'socket.io-client'

const PORT = process.argv[2] || '3003'
const MODE = process.argv[3] || 'demo'
const TASK = process.argv[4] || 'Проанализируй данные о продажах за Q3 и найди аномалии'

const socket = io(`http://127.0.0.1:${PORT}`, { path: '/', transports: ['websocket', 'polling'] })

const seen: string[] = []
let runCreated = false
let historyUpdates = 0

socket.on('connect', () => {
  console.log(`[client] подключён, socket.id=${socket.id}`)
  console.log('[client] → run:start', { mode: MODE })
  socket.emit('run:start', { task: TASK, mode: MODE, decisionMode: 'auto' })
})

socket.on('run:created', (d) => {
  runCreated = true
  seen.push(`run:created runId=${d?.runId} task="${String(d?.task).slice(0, 40)}"`)
  console.log(`[client] ← run:created runId=${d?.runId}`)
})

socket.on('run:started', (d) => seen.push(`run:started runId=${d?.runId}`))
socket.on('run:event', (d) => {
  const t = d?.event?.type
  if (!seen.some((s) => s.startsWith(`run:event:${t}`))) seen.push(`run:event:${t}`)
  if (t === 'run:status') console.log(`[client] ← run:event run:status=${d.event.status} progress=${d.event.progress}`)
})
socket.on('history:list', (d) => {
  historyUpdates++
  const runs = d?.runs ?? []
  console.log(`[client] ← history:list #${historyUpdates}: ${runs.length} прогонов, статусы: ${runs.map((r) => `${String(r.task).slice(0, 12)}:${r.status}`).join(' | ')}`)
})
socket.on('error:server', (d) => console.log(`[client] ← error:server: ${d?.message}`))
socket.on('connected', (d) => console.log('[client] ← connected (приветствие)'))

const t = setTimeout(() => {
  console.log('\n===== ИТОГ ДИАГНОСТИКИ =====')
  console.log(`run:created получен: ${runCreated ? 'ДА' : 'НЕТ'}`)
  console.log(`history:list получен раз: ${historyUpdates}`)
  console.log('последовательность событий:', seen.join(' → '))
  console.log('ВЕРДИКТ: история при старте ' + (historyUpdates > 0 ? 'обновляется' : 'НЕ обновляется до терминального статуса'))
  socket.disconnect()
  process.exit(0)
}, 25000)

socket.on('run:event', (d) => {
  if (d?.event?.type === 'run:status' && ['completed', 'stopped', 'error'].includes(d.event.status)) {
    clearTimeout(t)
    setTimeout(() => {
      console.log('\n===== ИТОГ ДИАГНОСТИКИ (по терминальному статусу) =====')
      console.log(`run:created получен: ${runCreated ? 'ДА' : 'НЕТ'}`)
      console.log(`history:list получен раз: ${historyUpdates}`)
      console.log('последовательность:', seen.join(' → '))
      socket.disconnect()
      process.exit(0)
    }, 1500)
  }
})
