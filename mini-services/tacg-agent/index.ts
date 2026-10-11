// TACG Agent Engine — socket.io мини-сервис (порт 3003)
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { AgentEngine } from './engine'
import { store } from './store'
import { RunMode } from './types'

const httpServer = createServer()
const io = new Server(httpServer, {
  // Путь '/' обязателен — по нему Caddy проксирует запросы к сервису
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

const engine = new AgentEngine(io)

io.on('connection', (socket) => {
  console.log(`[tacg] клиент подключился: ${socket.id}`)
  socket.emit('connected', { ok: true, ts: Date.now(), service: 'tacg-agent' })
  socket.emit('history:list', { runs: store.history() })

  socket.on('run:start', async (data: any) => {
    try {
      const task = typeof data?.task === 'string' ? data.task : ''
      const mode: RunMode = data?.mode === 'llm' ? 'llm' : 'demo'
      const run = await engine.start(task, mode)
      socket.emit('run:started', { runId: run.id })
    } catch (e: any) {
      console.error('[tacg] ошибка запуска:', e)
      socket.emit('error:server', { message: e?.message || 'Не удалось запустить агента' })
    }
  })

  socket.on('run:control', (data: any) => {
    const action = data?.action
    if (['pause', 'resume', 'stop'].includes(action)) {
      engine.control(String(data?.runId || ''), action)
    }
  })

  socket.on('node:override', (data: any) => {
    const result = engine.overrideNode(String(data?.runId || ''), String(data?.nodeId || ''), String(data?.output || ''))
    socket.emit('node:override:result', result)
  })

  socket.on('node:retry', (data: any) => {
    const result = engine.retryNode(String(data?.runId || ''), String(data?.nodeId || ''))
    socket.emit('node:retry:result', result)
  })

  socket.on('history:list', () => {
    socket.emit('history:list', { runs: store.history() })
  })

  socket.on('run:load', (data: any) => {
    const run = engine.getRun(String(data?.runId || ''))
    if (run) socket.emit('run:snapshot', { run })
  })

  socket.on('run:delete', (data: any) => {
    engine.deleteRun(String(data?.runId || ''))
  })

  socket.on('disconnect', () => {
    console.log(`[tacg] клиент отключился: ${socket.id}`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[tacg] Движок агента TACG запущен на порту ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
