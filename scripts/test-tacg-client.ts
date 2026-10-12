// Тестовый клиент TACG agent engine: полный прогон демо-сценария
import { io } from 'socket.io-client'

const socket = io('http://localhost:3003', { path: '/', transports: ['websocket'] })

const events = []
let runId = null

socket.on('connect', () => {
  console.log('[test] подключено к движку')
  socket.emit('run:start', { task: 'Проанализируй данные о продажах за Q3 и найди аномалии', mode: 'demo' })
})

socket.on('run:created', (d) => {
  runId = d.runId
  console.log(`[test] run создан: ${d.runId}`)
})

socket.on('run:event', ({ runId: rid, event }) => {
  if (rid !== runId) return
  events.push(event)
  switch (event.type) {
    case 'graph:init':
      console.log(`[test] план: ${event.nodes.map((n) => n.title).join(' → ')}`)
      break
    case 'node:update':
      console.log(`[test]   узел «${event.node.title}» → ${event.node.status}`)
      break
    case 'graph:adapt':
      console.log(`[test] АДАПТАЦИЯ v${event.version}: +${event.nodes[0].title} — ${event.reason.slice(0, 60)}…`)
      break
    case 'run:status':
      console.log(`[test] статус: ${event.status} (${event.progress}%)`)
      break
    case 'log':
      break
    case 'run:summary':
      console.log(`[test] ИТОГ: ${event.summary.slice(0, 100)}…`)
      break
  }
})

// Проверка паузы: на 4-й секунде ставим на паузу, через 2.5с снимаем
setTimeout(() => {
  if (runId) {
    console.log('[test] === ПАУЗА ===')
    socket.emit('run:control', { runId, action: 'pause' })
  }
}, 4000)

setTimeout(() => {
  if (runId) {
    console.log('[test] === РЕЗЮМЕ ===')
    socket.emit('run:control', { runId, action: 'resume' })
  }
}, 6500)

// Проверка вмешательства после завершения
setTimeout(() => {
  if (!runId) return
  const done = events.some((e) => e.type === 'run:summary')
  if (!done) {
    console.log('[test] прогон ещё не завершён — пропускаю тест override')
    return
  }
  console.log('[test] === OVERRIDE узла n1 (Сбор данных) ===')
  socket.emit('node:override', {
    runId,
    nodeId: 'n1',
    output: 'Пользователь подменил данные: загружен очищенный датасет вручную, 3000 записей, пропусков нет.',
  })
}, 20000)

socket.on('node:override:result', (r) => {
  console.log(`[test] override результат: ${JSON.stringify(r)}`)
})

socket.on('history:list', ({ runs }) => {
  if (runs.length) console.log(`[test] история: ${runs.length} запусков, последний: ${runs[0].status}`)
})

socket.on('error:server', ({ message }) => console.log(`[test] ОШИБКА СЕРВЕРА: ${message}`))

setTimeout(() => {
  const nodeEvents = events.filter((e) => e.type === 'node:update' && e.node.status === 'done')
  const adapts = events.filter((e) => e.type === 'graph:adapt')
  const overrides = events.filter((e) => e.type === 'node:update' && e.node.overridden)
  const reruns = events.filter((e) => e.type === 'node:update' && (e.node.runs ?? 0) > 1)
  console.log('\n[test] ─── ИТОГИ ПРОВЕРКИ ───')
  console.log(`всего событий: ${events.length}`)
  console.log(`выполненных узлов: ${nodeEvents.length}`)
  console.log(`адаптаций графа: ${adapts.length} (ожидалось 2)`)
  console.log(`override-событий: ${overrides.length}, пересчётов: ${reruns.length}`)
  const ok = adapts.length === 2 && nodeEvents.length >= 7 && reruns.length >= 4
  console.log(ok ? '✅ ТЕСТ ПРОЙДЕН' : '❌ ТЕСТ ПРОВАЛЕН')
  socket.disconnect()
  process.exit(ok ? 0 : 1)
}, 30000)
