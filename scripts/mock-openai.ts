// Avizis — мок OpenAI-compatible-провайдера для тестов BYOK (127.0.0.1:3099).
// Отвечает в формате POST {baseUrl}/chat/completions, выбирая ответ по system-промпту:
// планировщик → валидный JSON плана, супервайзер → no_changes, решатель → выбор первого
// варианта, иначе → текст шага. Запоминает Authorization/model/tools каждого запроса (/__stats).
// Режимы MOCK_MODE:
//   oversized     — план с нарушениями структурных лимитов (CR-008, агент 10-b);
//   agentic-gate  — гейт OpenRouter «agentic harnesses»: без tools → 403, с tools → 200,
//                   ответ упакован в tool_calls (submit_final_answer) — тест разворачивания;
//   agentic-inline — то же, но ошибка внутри 200-ответа (data.error, без choices).
// Запуск: bun scripts/mock-openai.ts · импорт: { start, stop, stats, reset }
import { createServer, type Server } from 'node:http'

const HOST = '127.0.0.1'
const PORT = 3099

interface MockRequest {
  ts: number
  auth: string
  model: string
  systemPreview: string
  userPreview: string
  toolsCount: number
  /** CR-016: стрим-запрос исполнителя (гейт мок не проверяет для стримов — как и реальный путь ADR-023: откат на полный вызов) */
  stream: boolean
}

let requests: MockRequest[] = []
let server: Server | null = null

/** Валидный план (формат промпта планировщика engine.ts): certainty 0.5, 1 развилка, 3 варианта (1–2 шага) */
const NORMAL_PLAN = {
  certainty: 0.5,
  nodes: [
    {
      id: 'n1',
      title: 'Сбор входных данных',
      description: 'Собирает и нормализует входные данные задачи для дальнейшего анализа.',
      dependsOn: [],
    },
    {
      id: 'dec1',
      title: 'Решение: стратегия анализа',
      description: 'Развилка выбора стратегии анализа: определяет дальнейшие шаги и итог.',
      dependsOn: ['n1'],
      decision: {
        question: 'Какую стратегию анализа данных применить?',
        domain: 'strategy',
        selection: 'single',
        certaintyAfter: 0.85,
        options: [
          {
            id: 'a',
            label: 'Быстрая статистическая проверка',
            rationale: 'Дёшево и быстро: проверка ключевых метрик без глубокой детализации.',
            steps: [
              { id: 'ba1', title: 'Проверка ключевых метрик', description: 'Расчёт и сверка ключевых метрик.' },
            ],
          },
          {
            id: 'b',
            label: 'Глубокое расследование',
            rationale: 'Дороже, но находит причины: два шага детального разбора.',
            steps: [
              { id: 'bb1', title: 'Корреляционный анализ', description: 'Поиск связей между показателями.' },
              { id: 'bb2', title: 'Поиск причин отклонений', description: 'Разбор корней обнаруженных аномалий.' },
            ],
          },
          {
            id: 'c',
            label: 'Запрос контекста у владельца',
            rationale: 'Уточнение бизнес-контекста до анализа.',
            steps: [
              { id: 'bc1', title: 'Опрос владельца данных', description: 'Сбор пояснений по данным.' },
            ],
          },
        ],
      },
    },
    {
      id: 'nfin',
      title: 'Формирование результата',
      description: 'Сводит итог анализа в финальный ответ.',
      dependsOn: ['ba1', 'bb2', 'bc1'],
    },
  ],
}

/** План с нарушениями структурных лимитов (CR-008): 15 узлов, развилка с 6 вариантами
 *  по 5 шагов, развилка с 1 вариантом, узел с 7 зависимостями включая ссылки вперёд. */
function oversizedPlan(): any {
  const nodes: any[] = []
  const step = (id: string, deps: string[], i: number) => ({
    id,
    title: `Шаг ${i}`,
    description: `Описание шага ${i} oversized-мока.`,
    dependsOn: deps,
  })
  for (let i = 1; i <= 3; i++) nodes.push(step(`n${i}`, i === 1 ? [] : [`n${i - 1}`], i))
  // развилка с 6 вариантами и 5 шагами в каждой ветке (лимиты: 2–4 варианта, 1–3 шага)
  const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => ({
    id: letter,
    label: `Вариант ${letter.toUpperCase()}`,
    rationale: `Обоснование варианта ${letter} oversized-мока.`,
    steps: Array.from({ length: 5 }, (_, k) => ({
      id: `b${letter}${k + 1}`,
      title: `Шаг ветки ${letter}${k + 1}`,
      description: 'Шаг ветки oversized-мока.',
    })),
  }))
  nodes.push({
    id: 'dec1',
    title: 'Решение: oversized-развилка',
    description: 'Развилка с 6 вариантами и 5 шагами в ветках.',
    dependsOn: ['n3'],
    decision: {
      question: 'Какой путь анализа выбрать?',
      domain: 'strategy',
      selection: 'single',
      certaintyAfter: 0.8,
      options,
    },
  })
  // n4..n8: цепочка после развилки
  for (let i = 4; i <= 8; i++) nodes.push(step(`n${i}`, [`n${i - 1}`], i))
  // развилка с 1 вариантом (лимит: минимум 2)
  nodes.push({
    id: 'dec2',
    title: 'Решение: единственный вариант',
    description: 'Развилка с одним вариантом — нарушение лимита.',
    dependsOn: ['n8'],
    decision: {
      question: 'Подтвердить продолжение?',
      domain: 'scope',
      selection: 'single',
      options: [
        {
          id: 'a',
          label: 'Единственный вариант',
          rationale: 'Других вариантов нет.',
          steps: [{ id: 'bza1', title: 'Шаг единственной ветки', description: 'Шаг oversized-мока.' }],
        },
      ],
    },
  })
  // узел с 7 зависимостями, включая ссылки вперёд (n10..n13 объявлены ниже)
  nodes.push({
    id: 'n9',
    title: 'Шаг с 7 зависимостями',
    description: 'Нарушение: ссылается вперёд и на несуществующие узлы.',
    dependsOn: ['n8', 'dec2', 'n10', 'n11', 'n12', 'n13', 'bxa1'],
  })
  for (let i = 10; i <= 13; i++) nodes.push(step(`n${i}`, [`n${i - 1}`], i))
  return { certainty: 0.5, nodes }
}

function pickResponse(system: string): string {
  const sys = system || ''
  if (sys.includes('модуль планирования')) {
    return JSON.stringify(process.env.MOCK_MODE === 'oversized' ? oversizedPlan() : NORMAL_PLAN)
  }
  if (sys.includes('супервайзер')) return JSON.stringify({ decision: 'no_changes', certainty: 0.6 })
  if (sys.includes('модуль принятия решений')) {
    return JSON.stringify({ optionId: 'a', reasoning: 'Мок-выбор: первый вариант' })
  }
  return 'Мок-результат шага: данные проверены, аномалий нет'
}

function wrap(content: string) {
  return JSON.stringify({
    id: 'chatcmpl-mock-' + Date.now(),
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  })
}

/** Ответ с вызовом инструмента submit_final_answer (модель вызвала tool вместо текста) */
function wrapToolCall(answer: string) {
  return JSON.stringify({
    id: 'chatcmpl-mock-' + Date.now(),
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_mock_1',
              type: 'function',
              function: { name: 'submit_final_answer', arguments: JSON.stringify({ answer }) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  })
}

/** 403-гейт OpenRouter «agentic harnesses» (тело — как у реального провайдера) */
const AGENTIC_GATE_BODY = JSON.stringify({
  error: {
    message: 'The free Inkling endpoint is only available for use with agentic harnesses',
    code: 403,
    metadata: { error_type: 'permission_denied' },
  },
})

export function start(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) return resolve()
    const srv = createServer((req, res) => {
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
      if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          let parsed: any = null
          try {
            parsed = JSON.parse(body)
          } catch {
            /* некорректный body → значения по умолчанию */
          }
          const messages: any[] = Array.isArray(parsed?.messages) ? parsed.messages : []
          const systemMsg = messages.find((m) => m?.role === 'system')?.content ?? ''
          const userMsg = messages.find((m) => m?.role === 'user')?.content ?? ''
          const toolsCount = Array.isArray(parsed?.tools) ? parsed.tools.length : 0
          requests.push({
            ts: Date.now(),
            auth: String(req.headers['authorization'] || ''),
            model: String(parsed?.model || ''),
            systemPreview: String(systemMsg).slice(0, 120),
            userPreview: String(userMsg).slice(0, 120),
            toolsCount,
            stream: parsed?.stream === true,
          })
          const mode = process.env.MOCK_MODE || 'normal'
          // Имитация долгого reasoning-ответа (для E2E состояния «планирование»)
          const delayMs = Number(process.env.MOCK_DELAY_MS || 0)
          const respond = () => {
            // Режим reject-429: всегда 429 (транзиентная ошибка — ретраится)
            if (mode === 'reject-429') {
              res.writeHead(429, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }))
              return
            }
            // Стриминг (CR-016): SSE-дельты полного ответа + финальный usage-чанк,
            // если запрошен stream_options.include_usage; 30 мс на дельту — тест
            // успевает увидеть несколько снапшотов и монотонный рост текста
            if (parsed?.stream === true) {
              const full = String(pickResponse(String(systemMsg)))
              const wantUsage = !!parsed?.stream_options?.include_usage
              res.writeHead(200, { 'Content-Type': 'text/event-stream' })
              let i = 0
              const step = 7
              const timer = setInterval(() => {
                if (i < full.length) {
                  const delta = full.slice(i, i + step)
                  i += step
                  res.write(`data: ${JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: { content: delta } }] })}\n\n`)
                } else {
                  const tail = wantUsage
                    ? `data: ${JSON.stringify({ id: 'mock', choices: [], usage: { prompt_tokens: 111, completion_tokens: 42 } })}\n\n`
                    : ''
                  res.write(`${tail}data: [DONE]\n\n`)
                  res.end()
                  clearInterval(timer)
                }
              }, 30)
              return
            }
            // Гейт OpenRouter: без tools — отказ, с tools — ответ через tool_calls
            if ((mode === 'agentic-gate' || mode === 'agentic-inline') && toolsCount === 0) {
              if (mode === 'agentic-inline') {
                // 200 с error-телом (mid-stream вариант гейта)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ ...JSON.parse(AGENTIC_GATE_BODY) }))
              } else {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(AGENTIC_GATE_BODY)
              }
              return
            }
            if (mode === 'agentic-gate' || mode === 'agentic-inline') {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(wrapToolCall(pickResponse(String(systemMsg))))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(wrap(pickResponse(String(systemMsg))))
          }
          if (delayMs > 0) setTimeout(respond, delayMs)
          else respond()
        })
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })
    srv.once('error', (e) => {
      server = null
      reject(e)
    })
    srv.listen(PORT, HOST, () => {
      server = srv
      resolve()
    })
  })
}

export function stop(): Promise<void> {
  return new Promise((resolve) => {
    const srv = server
    server = null
    requests = []
    if (!srv) return resolve()
    srv.close(() => resolve())
  })
}

export function stats(): MockRequest[] {
  return requests.slice()
}

export function reset(): void {
  requests = []
}

// CLI-запуск для E2E: bun scripts/mock-openai.ts
if (import.meta.main) {
  start()
    .then(() => {
      console.log(
        `[mock-openai] мок-провайдер запущен: http://${HOST}:${PORT}/v1 (MOCK_MODE=${process.env.MOCK_MODE ?? 'normal'})`
      )
      process.on('SIGTERM', () => stop().then(() => process.exit(0)))
      process.on('SIGINT', () => stop().then(() => process.exit(0)))
    })
    .catch((e) => {
      console.error('[mock-openai] не удалось запустить (порт занят?):', e?.message || e)
      process.exit(1)
    })
}
