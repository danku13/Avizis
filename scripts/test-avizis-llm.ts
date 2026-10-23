// Тест LLM-режима Avizis (реальные вызовы z-ai-web-dev-sdk)
import { io } from 'socket.io-client'

const socket = io('http://localhost:3003', { path: '/', transports: ['websocket'] })
const events = []
let runId = null

socket.on('connect', () => {
  console.log('[test] подключено; запускаю LLM-режим…')
  socket.emit('run:start', {
    task: 'Составь короткий обзор трёх самых популярных языков программирования 2026 года',
    mode: 'llm',
  })
})

socket.on('run:created', (d) => (runId = d.runId))
socket.on('error:server', ({ message }) => console.log(`[test] ОШИБКА: ${message}`))

socket.on('run:event', ({ runId: rid, event }) => {
  if (rid !== runId) return
  events.push(event)
  if (event.type === 'graph:init') {
    console.log(`[test] план LLM (${event.nodes.length} узлов): ${event.nodes.map((n) => n.title).join(' → ')}`)
  } else if (event.type === 'node:update') {
    console.log(`[test]   «${event.node.title}» → ${event.node.status}${event.node.output ? ` (вых. ${event.node.output.length} симв.)` : ''}`)
  } else if (event.type === 'graph:adapt') {
    console.log(`[test] СУПЕРВАЙЗЕР добавил узел: ${event.nodes[0].title} — ${event.reason.slice(0, 80)}`)
  } else if (event.type === 'run:summary') {
    console.log(`[test] ИТОГ: ${event.summary.slice(0, 120)}…`)
  } else if (event.type === 'log' && event.entry.kind === 'info') {
    console.log(`[test] info: ${event.entry.message}`)
  }
})

setTimeout(() => {
  const doneNodes = events.filter((e) => e.type === 'node:update' && e.node.status === 'done')
  const plan = events.find((e) => e.type === 'graph:init')
  const ok = !!plan && doneNodes.length >= 3
  console.log(`\n[test] узлов выполнено: ${doneNodes.length}; есть план: ${!!plan}`)
  console.log(ok ? '✅ LLM-РЕЖИМ РАБОТАЕТ' : '❌ LLM-РЕЖИМ ПРОВАЛЕН')
  socket.disconnect()
  process.exit(ok ? 0 : 1)
}, 120000)
