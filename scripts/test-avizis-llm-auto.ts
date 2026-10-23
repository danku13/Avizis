// Тест LLM-режима Avizis с decisionMode=auto: развилки закрывает агент (decider),
// супервайзер не ограничен по числу вопросов (ADR-011).
import { io } from 'socket.io-client'

const socket = io('http://localhost:3003', { path: '/', transports: ['websocket'] })
const events: any[] = []
let runId: string | null = null

socket.on('connect', () => {
  console.log('[test] подключено; запускаю LLM-режим (auto)…')
  socket.emit('run:start', {
    task: 'Составь короткий обзор трёх самых популярных языков программирования 2026 года',
    mode: 'llm',
    decisionMode: 'auto',
  })
})

socket.on('run:created', (d: any) => (runId = d.runId))
socket.on('error:server', ({ message }: any) => console.log(`[test] ОШИБКА: ${message}`))

let decisionsSeen = 0
socket.on('run:event', ({ runId: rid, event }: any) => {
  if (rid !== runId) return
  events.push(event)
  if (event.type === 'graph:init') {
    console.log(`[test] план LLM (${event.nodes.length} узлов): ${event.nodes.map((n: any) => n.title).join(' → ')}`)
  } else if (event.type === 'node:update') {
    console.log(`[test]   «${event.node.title}» → ${event.node.status}${event.node.output ? ` (вых. ${event.node.output.length} симв.)` : ''}`)
  } else if (event.type === 'graph:adapt') {
    console.log(`[test] СУПЕРВАЙЗЕР: ${event.nodes[0]?.kind === 'decision' ? 'вопрос-развилка' : 'новый узел'} — ${String(event.reason).slice(0, 80)}`)
  } else if (event.type === 'decision:resolved') {
    decisionsSeen++
    console.log(`[test] РЕШЕНИЕ #${decisionsSeen} агентом: ${event.optionIds} · обоснование: ${String(event.reasoning || '').slice(0, 70)}`)
  } else if (event.type === 'run:summary') {
    console.log(`[test] ИТОГ: ${String(event.summary).slice(0, 120)}`)
  }
})

setTimeout(() => {
  const doneNodes = events.filter((e) => e.type === 'node:update' && e.node.status === 'done')
  const plan = events.find((e) => e.type === 'graph:init')
  const ok = !!plan && doneNodes.length >= 3
  console.log(`\n[test] узлов выполнено: ${doneNodes.length}; решений агентом: ${decisionsSeen}; есть план: ${!!plan}`)
  console.log(ok ? '✅ LLM-AUTO РЕЖИМ РАБОТАЕТ' : '❌ LLM-AUTO ПРОВАЛЕН')
  socket.disconnect()
  process.exit(ok ? 0 : 1)
}, 150000)
