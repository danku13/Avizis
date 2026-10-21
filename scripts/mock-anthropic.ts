// TACG — мок Anthropic Messages API для тестов нативного адаптера (127.0.0.1:3098).
// POST /v1/messages: system — отдельное поле body, пользователь — messages[0].content;
// ключ — заголовок x-api-key (≠ EXPECTED_KEY → 401 authentication_error, формат Anthropic).
// Нестрид: JSON {content:[{type:'text',text}], usage:{input_tokens,output_tokens}}.
// Стрим (stream:true): SSE-последовательность message_start → content_block_start →
// content_block_delta(text_delta, ~7 симв./30 мс) → message_delta(usage) → message_stop.
// /__stats — журнал запросов (ключ/модель/system/user), /__reset — очистка.
// Запуск: bun scripts/mock-anthropic.ts · импорт: { start, stop, stats, reset }
import { createServer, type Server } from 'node:http'
import { pickResponse, EXPECTED_KEY, MOCK_USAGE } from './mock-canned'

const HOST = '127.0.0.1'
const PORT = 3098

interface MockRequest {
  ts: number
  apiKey: string
  model: string
  systemPreview: string
  userPreview: string
  maxTokens: number
  stream: boolean
}

let requests: MockRequest[] = []
let server: Server | null = null

const sse = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export function start(): Promise<void> {
  return new Promise((resolve) => {
    if (server) return resolve()
    server = createServer((req, res) => {
      const url = (req.url || '').split('?')[0]
      if (req.method === 'GET' && url === '/__stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ requests: requests.slice() }))
        return
      }
      if (req.method === 'POST' && url === '/__reset') {
        requests = []
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{}')
        return
      }
      if (req.method === 'POST' && url === '/v1/messages') {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          let parsed: any = null
          try {
            parsed = JSON.parse(body)
          } catch {
            /* некорректный body → значения по умолчанию */
          }
          const key = String(req.headers['x-api-key'] || '')
          if (key !== EXPECTED_KEY) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                type: 'error',
                error: { type: 'authentication_error', message: 'invalid x-api-key' },
              })
            )
            return
          }
          const system = String(parsed?.system ?? '')
          const user = String(parsed?.messages?.[0]?.content ?? '')
          requests.push({
            ts: Date.now(),
            apiKey: key,
            model: String(parsed?.model || ''),
            systemPreview: system.slice(0, 120),
            userPreview: user.slice(0, 120),
            maxTokens: Number(parsed?.max_tokens || 0),
            stream: parsed?.stream === true,
          })
          const full = pickResponse(system)
          if (parsed?.stream === true) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            res.write(sse('message_start', {
              type: 'message_start',
              message: { usage: { input_tokens: MOCK_USAGE.prompt, output_tokens: 1 } },
            }))
            res.write(sse('content_block_start', { type: 'content_block_start', index: 0 }))
            let i = 0
            const step = 7
            const timer = setInterval(() => {
              if (i < full.length) {
                const delta = full.slice(i, i + step)
                i += step
                res.write(
                  sse('content_block_delta', {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: delta },
                  })
                )
              } else {
                res.write(
                  sse('message_delta', {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn' },
                    usage: { output_tokens: MOCK_USAGE.completion },
                  })
                )
                res.write(sse('message_stop', { type: 'message_stop' }))
                res.end()
                clearInterval(timer)
              }
            }, 30)
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                id: 'msg_mock_' + Date.now(),
                type: 'message',
                role: 'assistant',
                model: String(parsed?.model || 'mock'),
                content: [{ type: 'text', text: full }],
                stop_reason: 'end_turn',
                usage: { input_tokens: MOCK_USAGE.prompt, output_tokens: MOCK_USAGE.completion },
              })
            )
          }
        })
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'not_found_error', message: `Unknown path ${url}` } }))
    })
    server.listen(PORT, HOST, () => resolve())
  })
}

export function stop(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve()
    server.close(() => {
      server = null
      resolve()
    })
  })
}

export async function stats(): Promise<MockRequest[]> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/__stats`)
    const data: any = await res.json()
    return data?.requests ?? []
  } catch {
    return []
  }
}

export async function reset(): Promise<void> {
  requests = []
  try {
    await fetch(`http://${HOST}:${PORT}/__reset`, { method: 'POST' })
  } catch {
    /* мок не запущен — локальный массив уже очищен */
  }
}

// Прямой запуск: bun scripts/mock-anthropic.ts (порт удерживается до Ctrl+C)
if (import.meta.main) {
  start().then(() => console.log(`[mock-anthropic] слушает http://${HOST}:${PORT}`))
}
