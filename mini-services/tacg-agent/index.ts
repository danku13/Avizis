// TACG Agent Engine — socket.io мини-сервис (порт 3003)
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { AgentEngine } from './engine'
import { store } from './store'
import { DecisionMode, RunMode } from './types'
import { pricing } from './pricing'
import {
  LlmConfig,
  loadConfig,
  mergeSavedApiKey,
  publicConfig,
  resolveRole,
  sanitizeConfigInput,
  saveConfig,
  validateProvider,
} from './llm-config'

const httpServer = createServer()

// CORS: по умолчанию открыт (веб-превью через Caddy-шлюз). В десктоп-режиме
// (Tauri sidecar, ADR-018) оболочка передаёт TACG_CORS_ORIGINS с точными
// origin'ами webview (tauri://localhost, http://tauri.localhost) — защита от
// drive-by подключений к локальному движку из браузера пользователя.
const corsOrigins = (process.env.TACG_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const io = new Server(httpServer, {
  // Путь '/' обязателен — по нему Caddy проксирует запросы к сервису
  path: '/',
  cors: { origin: corsOrigins.length ? corsOrigins : '*', methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

const engine = new AgentEngine(io)

// Динамический прайсинг (ADR-016): дисковый кэш сразу, устаревшие источники — фоном
pricing.init()

io.on('connection', (socket) => {
  console.log(`[tacg] клиент подключился: ${socket.id}`)
  socket.emit('connected', { ok: true, ts: Date.now(), service: 'tacg-agent' })
  socket.emit('history:list', { runs: store.history() })
  socket.emit('pricing:status', pricing.status())

  socket.on('run:start', async (data: any) => {
    try {
      const task = typeof data?.task === 'string' ? data.task : ''
      const mode: RunMode = data?.mode === 'llm' ? 'llm' : 'demo'
      const decisionMode: DecisionMode = data?.decisionMode === 'auto' ? 'auto' : 'manual'
      const run = await engine.start(task, mode, decisionMode)
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

  socket.on('decision:resolve', (data: any) => {
    // optionIds — массив (смешанное решение); для совместимости принимаем и одиночную строку
    const raw = data?.optionIds
    const optionIds: string[] = Array.isArray(raw)
      ? raw.map((v: any) => String(v ?? ''))
      : typeof data?.optionId === 'string'
        ? [data.optionId]
        : typeof raw === 'string'
          ? [raw]
          : []
    const result = engine.resolveDecisionFromUser(String(data?.runId || ''), String(data?.nodeId || ''), optionIds)
    socket.emit('decision:resolve:result', result)
  })

  socket.on('decision:mode', (data: any) => {
    const mode: DecisionMode = data?.mode === 'auto' ? 'auto' : 'manual'
    const result = engine.setDecisionMode(String(data?.runId || ''), mode)
    socket.emit('decision:mode:result', result)
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

  // ─────────────────────── BYOK: конфигурация LLM ───────────────────────

  // Конфиг для клиента — ТОЛЬКО с маской ключа (полный ключ не покидает сервер)
  socket.on('llm:config:get', () => {
    socket.emit('llm:config', { config: publicConfig(loadConfig()) })
  })

  socket.on('llm:config:save', async (data: any) => {
    try {
      const incoming = sanitizeConfigInput(data?.config)
      if (!incoming || (!incoming.default && !incoming.roles)) {
        socket.emit('llm:config:saved', { ok: false, error: 'Некорректная конфигурация' })
        return
      }
      // пустой apiKey в поле = «не менять»: сохраняем прежний ключ
      const merged = mergeSavedApiKey(incoming, loadConfig())
      // валидация пробным запросом (openai-compatible); zai — без пробы
      let latencyMs: number | undefined
      if (merged.default?.adapter === 'openai-compatible') {
        const probe = await validateProvider(merged.default)
        if (!probe.ok) {
          socket.emit('llm:config:saved', { ok: false, error: probe.error })
          return
        }
        latencyMs = probe.latencyMs
      }
      saveConfig(merged)
      socket.emit('llm:config:saved', { ok: true, config: publicConfig(merged), latencyMs })
    } catch (e: any) {
      socket.emit('llm:config:saved', { ok: false, error: e?.message || 'Не удалось сохранить конфигурацию' })
    }
  })

  socket.on('llm:config:test', async (data: any) => {
    try {
      let cfgToTest: LlmConfig['default']
      if (data?.config) {
        const incoming = sanitizeConfigInput(data.config)
        if (!incoming) {
          socket.emit('llm:config:test:result', { ok: false, error: 'Некорректная конфигурация' })
          return
        }
        // пустой ключ при тесте = использовать сохранённый
        const merged = mergeSavedApiKey(incoming, loadConfig())
        cfgToTest = merged.default ?? resolveRole(undefined, merged)
      } else {
        cfgToTest = resolveRole(undefined, loadConfig())
      }
      const result = await validateProvider(cfgToTest)
      socket.emit('llm:config:test:result', result)
    } catch (e: any) {
      socket.emit('llm:config:test:result', { ok: false, error: e?.message || 'Ошибка проверки' })
    }
  })

  // ─────────────────────── Динамический прайсинг (ADR-016) ───────────────────────

  socket.on('pricing:get', () => {
    socket.emit('pricing:status', pricing.status())
  })

  socket.on('pricing:refresh', async () => {
    try {
      const result = await pricing.refresh()
      socket.emit('pricing:refresh:result', result)
      io.emit('pricing:status', pricing.status())
    } catch (e: any) {
      socket.emit('pricing:refresh:result', { ok: false, error: e?.message || 'Ошибка обновления прайсов' })
    }
  })

  socket.on('disconnect', () => {
    console.log(`[tacg] клиент отключился: ${socket.id}`)
  })
})

// Порт и адрес: TACG_PORT/TACG_BIND задаёт десктоп-оболочка (Tauri sidecar);
// TACG_BIND=127.0.0.1 в десктопе — движок виден только локально (не в LAN)
const PORT = Number(process.env.TACG_PORT || process.env.PORT) || 3003
const HOST = process.env.TACG_BIND || '0.0.0.0'
httpServer.listen(PORT, HOST, () => {
  console.log(`[tacg] Движок агента TACG запущен: ${HOST}:${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
