// Avizis — мок Google Gemini generateContent API для тестов нативного адаптера
// (127.0.0.1:3097). POST /v1beta/models/{model}:generateContent (стриминг —
// :streamGenerateContent?alt=sse); ключ — заголовок x-goog-api-key
// (≠ EXPECTED_KEY → 401 {error:{code:401,message:'API key not valid'}}).
// system — body.systemInstruction.parts[0].text; ответ — candidates[0].content.parts;
// usage — usageMetadata {promptTokenCount, candidatesTokenCount}.
// /__stats — журнал запросов, /__reset — очистка.
// Запуск: bun scripts/mock-gemini.ts · импорт: { start, stop, stats, reset }
import { createServer, type Server } from 'node:http'
import { pickResponse, EXPECTED_KEY, MOCK_USAGE } from './mock-canned'

const HOST = '127.0.0.1'
const PORT = 3097

interface MockRequest {
  ts: number
  apiKey: string
  model: string
  systemPreview: string
  userPreview: string
  stream: boolean
}

let requests: MockRequest[] = []
let server: Server | null = null

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
      const streamMatch = /\/v1beta\/models\/([^:]+):streamGenerateContent/.exec(req.url || '')
      const genMatch = /\/v1beta\/models\/([^:]+):generateContent/.exec(req.url || '')
      if (req.method === 'POST' && (streamMatch || genMatch)) {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          let parsed: any = null
          try {
            parsed = JSON.parse(body)
          } catch {
            /* некорректный body → значения по умолчанию */
          }
          const key = String(req.headers['x-goog-api-key'] || '')
          if (key !== EXPECTED_KEY) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({ error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' } })
            )
            return
          }
          const model = String(streamMatch?.[1] ?? genMatch?.[1] ?? '')
          const system = String(parsed?.systemInstruction?.parts?.[0]?.text ?? '')
          const user = String(parsed?.contents?.[0]?.parts?.[0]?.text ?? '')
          requests.push({
            ts: Date.now(),
            apiKey: key,
            model,
            systemPreview: system.slice(0, 120),
            userPreview: user.slice(0, 120),
            stream: !!streamMatch,
          })
          const full = pickResponse(system)
          const chunkOf = (text: string, finish?: string) => {
            const cand: any = { content: { parts: [{ text }], role: 'model' } }
            if (finish) cand.finishReason = finish
            return { candidates: [cand] }
          }
          if (streamMatch) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' })
            let i = 0
            const step = 7
            const timer = setInterval(() => {
              if (i < full.length) {
                const delta = full.slice(i, i + step)
                i += step
                res.write(`data: ${JSON.stringify(chunkOf(delta))}\n\n`)
              } else {
                res.write(
                  `data: ${JSON.stringify({
                    candidates: [
                      { content: { parts: [{ text: '' }], role: 'model' }, finishReason: 'STOP' },
                    ],
                    usageMetadata: {
                      promptTokenCount: MOCK_USAGE.prompt,
                      candidatesTokenCount: MOCK_USAGE.completion,
                      totalTokenCount: MOCK_USAGE.prompt + MOCK_USAGE.completion,
                    },
                  })}\n\n`
                )
                res.end()
                clearInterval(timer)
              }
            }, 30)
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                candidates: [
                  { content: { parts: [{ text: full }], role: 'model' }, finishReason: 'STOP' },
                ],
                usageMetadata: {
                  promptTokenCount: MOCK_USAGE.prompt,
                  candidatesTokenCount: MOCK_USAGE.completion,
                  totalTokenCount: MOCK_USAGE.prompt + MOCK_USAGE.completion,
                },
              })
            )
          }
        })
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 404, message: `Unknown path ${url}`, status: 'NOT_FOUND' } }))
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

// Прямой запуск: bun scripts/mock-gemini.ts (порт удерживается до Ctrl+C)
if (import.meta.main) {
  start().then(() => console.log(`[mock-gemini] слушает http://${HOST}:${PORT}`))
}
