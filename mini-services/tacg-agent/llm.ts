// TACG — слой роутера LLM-вызовов (ADR-012, ADR-024): адаптеры zai (дефолт),
// openai-compatible (baseUrl + apiKey + model), anthropic (Messages API) и
// google-gemini (generateContent API) — резолв по ролям.
// extractJson/repairJson/таймауты/ретраи — НАД адаптерами (провайдер-агностичны).
import ZAI, { ChatMessage } from 'z-ai-web-dev-sdk'
import type { LlmProviderConfig } from './llm-config'
import { loadConfig, resolveRole, describeHttpError } from './llm-config'
import { chatCompletionsRequest, chatCompletionsStreamRequest, extractMessageContent, NonRetryableProviderError } from './openai-client'
import { anthropicRequest, anthropicStreamRequest, extractAnthropicContent, consumeAnthropicSse, ANTHROPIC_DEFAULT_BASE } from './anthropic-client'
import { geminiRequest, geminiStreamRequest, extractGeminiContent, geminiUsageOf, consumeGeminiSse, GEMINI_DEFAULT_BASE } from './gemini-client'

/** Роль движка: какая точка делает вызов */
export type LlmRole = 'planner' | 'executor' | 'supervisor' | 'decider'

/** Идентификатор адаптера провайдера (anthropic/google-gemini — нативные, CR-017) */
export type LlmAdapterId = 'zai' | 'openai-compatible' | 'anthropic' | 'google-gemini'

/** Использование токенов (прокидывается из ответа провайдера для будущих счётчиков) */
export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
}

/** Результат одного LLM-вызова через адаптер */
export interface LlmChatResult {
  content: string
  adapter: LlmAdapterId | string
  model?: string
  usage?: LlmUsage
}

let zaiInstance: any = null

export async function getZai(): Promise<any> {
  if (!zaiInstance) zaiInstance = await ZAI.create()
  return zaiInstance
}

const tryParse = (s: string): any | null => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Достаёт usage из ответа провайдера (OpenAI prompt/completion_tokens и GLM input/output_tokens) */
function extractUsage(data: any): LlmUsage | undefined {
  const u = data?.usage
  if (!u || typeof u !== 'object') return undefined
  const prompt = u.prompt_tokens ?? u.promptTokens ?? u.input_tokens ?? u.inputTokens
  const completion = u.completion_tokens ?? u.completionTokens ?? u.output_tokens ?? u.outputTokens
  if (typeof prompt !== 'number' && typeof completion !== 'number') return undefined
  return {
    promptTokens: typeof prompt === 'number' ? prompt : undefined,
    completionTokens: typeof completion === 'number' ? completion : undefined,
  }
}

/** Сложение usage по попыткам вызова (ретраи/JSON-повторы) */
function mergeUsage(a: LlmUsage | undefined, b: LlmUsage | undefined): LlmUsage | undefined {
  if (!a) return b
  if (!b) return a
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0) || undefined,
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0) || undefined,
  }
}

/** Ремонт типичных ошибок LLM в JSON: незакрытый массив, висячая запятая, обрыв */
function repairJson(text: string): any | null {
  let t = text
  // «"reasoning" попал внутрь массива» — не закрыт ] перед ключом верхнего уровня
  t = t.replace(/}\s*,\s*"(?:reasoning|notes?|comment|explanation|rationale)"\s*:/i, '}],"reasoning":')
  // висячая запятая перед } или ]
  t = t.replace(/,\s*([}\]])/g, '$1')
  let fixed = tryParse(t)
  if (fixed) return fixed
  // баланс скобок: закрываем незакрытые строку/массивы/объекты в конце
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let tail = ''
  if (inStr) tail += '"'
  while (stack.length) tail += stack.pop() === '{' ? '}' : ']'
  if (tail) {
    fixed = tryParse(t + tail)
    if (fixed) return fixed
  }
  return null
}

/** Достаёт JSON-объект из ответа LLM (учитывает ```-обёртки и лишний текст) */
export function extractJson(raw: string): any | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const candidates: string[] = []
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  candidates.push(text)
  for (const c of candidates) {
    const parsed = tryParse(c)
    if (parsed) return parsed
  }
  const best = candidates[0] ?? text
  return repairJson(best)
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ])

// ───────────── Стриминг ответов (CR-016 / ADR-023) ─────────────

/** Приёмник стрим-снапшотов: textSoFar — ВЕСЬ накопленный текст на момент вызова
 *  (снапшот, а не дельта: клиенту не нужно копить состояние, replay-безопасно) */
export type StreamSink = (textSoFar: string) => void

/** Разбор SSE-потока chat-дельт (OpenAI-совместимый формат, включая zai/GLM):
 *  копит content-дельты, после каждой вызывает onSnapshot с накопленным текстом,
 *  возвращает полный текст + usage последнего чанка (если провайдер прислал). */
async function consumeSseStream(
  body: any,
  onSnapshot: StreamSink
): Promise<{ content: string; usage?: LlmUsage }> {
  const reader = (body as ReadableStream).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let usage: LlmUsage | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let obj: any
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      // 200-inline-error (mid-stream ошибки OpenRouter): текст от модели не пришёл,
      // добьёмся пустым content → вызывающий откатится на полный вызов
      if (obj?.error) continue
      const delta = obj?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) {
        content += delta
        onSnapshot(content)
      }
      const u = extractUsage(obj)
      if (u) usage = u
    }
  }
  return { content, usage }
}

// ─────────────────────── Адаптеры провайдеров ───────────────────────

/** Адаптер zai: прежнее поведение — singleton SDK, role 'assistant' = системный промпт */
async function zaiChat(system: string, user: string, timeoutMs: number): Promise<LlmChatResult> {
  const zai = await getZai()
  const messages: ChatMessage[] = [
    { role: 'assistant', content: system },
    { role: 'user', content: user },
  ]
  const res: any = await withTimeout(
    zai.chat.completions.create({ messages, stream: false, thinking: { type: 'disabled' } }),
    timeoutMs,
    `Таймаут LLM-запроса (${Math.round(timeoutMs / 1000)} с)`
  )
  const content = res?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) {
    // usage — если провайдер его сообщает (GLM-форматы); отсутствие не ошибка
    return { content: content.trim(), adapter: 'zai', model: 'z-ai-sdk', usage: extractUsage(res) }
  }
  throw new Error('Пустой ответ модели')
}

/** Адаптер zai в режиме стриминга (CR-016): stream:true → ReadableStream SSE
 *  (SDK отдаёт тело ответа при content-type text/event-stream|text/plain) */
async function zaiChatStream(system: string, user: string, timeoutMs: number, sink: StreamSink): Promise<LlmChatResult> {
  const zai = await getZai()
  const messages: ChatMessage[] = [
    { role: 'assistant', content: system },
    { role: 'user', content: user },
  ]
  const res: any = await withTimeout(
    zai.chat.completions.create({ messages, stream: true, thinking: { type: 'disabled' } }),
    timeoutMs,
    `Таймаут LLM-запроса (${Math.round(timeoutMs / 1000)} с)`
  )
  if (!res || typeof res.getReader !== 'function') {
    throw new Error('Адаптер zai не вернул поток (стрим не поддержан)')
  }
  const { content, usage } = await withTimeout(
    consumeSseStream(res, sink),
    timeoutMs,
    `Таймаут чтения стрима (${Math.round(timeoutMs / 1000)} с)`
  )
  if (!content.trim()) throw new Error('Пустой ответ модели')
  return { content: content.trim(), adapter: 'zai', model: 'z-ai-sdk', usage }
}

/** Адаптер openai-compatible: POST {baseUrl}/chat/completions через общий клиент
 *  (openai-client.ts): обход гейта OpenRouter «agentic harnesses» (free-эндпоинты
 *  вроде thinkingmachines/inkling:free) + разворачивание tool_calls в текст */
async function openaiCompatibleChat(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
  }
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    body.temperature = cfg.temperature
  }
  const { data } = await chatCompletionsRequest(cfg, body, timeoutMs)
  const content = extractMessageContent(data)
  if (!content) throw new Error('Пустой ответ модели')
  return {
    content,
    adapter: 'openai-compatible',
    model,
    usage: extractUsage(data),
  }
}

/** Адаптер openai-compatible в режиме стриминга (CR-016): stream:true + stream_options
 *  (usage в финальном чанке у провайдеров, которые его поддерживают). Гейт agentic-harness
 *  здесь не обходится: при 4xx/гейте/обрыве llm.ts откатывается на полный нестридовый путь. */
async function openaiCompatibleChatStream(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number, sink: StreamSink): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream_options: { include_usage: true },
  }
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    body.temperature = cfg.temperature
  }
  const { res, errorText } = await chatCompletionsStreamRequest(cfg, body, timeoutMs)
  if (!res.ok) throw new NonRetryableProviderError(describeHttpError(res.status, errorText))
  const contentType = String(res.headers?.get?.('content-type') || '')
  if (!(contentType.includes('event-stream') || contentType.includes('text/plain'))) {
    throw new Error('Провайдер не вернул SSE-поток для стримингового запроса')
  }
  const { content, usage } = await withTimeout(
    consumeSseStream(res.body, sink),
    timeoutMs,
    `Таймаут чтения стрима (${Math.round(timeoutMs / 1000)} с)`
  )
  if (!content.trim()) throw new Error('Пустой ответ модели')
  return { content: content.trim(), adapter: 'openai-compatible', model, usage }
}

/** Роутер: резолв конфигурации по роли → диспетчеризация в адаптер */
async function callLlm(system: string, user: string, timeoutMs: number, role?: LlmRole): Promise<LlmChatResult> {
  const cfg = resolveRole(role, loadConfig())
  if (cfg.adapter === 'anthropic') return anthropicChat(cfg, system, user, timeoutMs)
  if (cfg.adapter === 'google-gemini') return geminiChat(cfg, system, user, timeoutMs)
  if (cfg.adapter === 'openai-compatible') return openaiCompatibleChat(cfg, system, user, timeoutMs)
  return zaiChat(system, user, timeoutMs)
}

/** Адаптер anthropic (Messages API, CR-017): system отдельным полем; max_tokens
 *  обязателен — по эвристике «opus → 4096, остальное → 8192» (кэпы моделей
 *  различаются, выходим в максимум, не ломая старые модели; ADR-024 §4). */
async function anthropicChat(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    model,
    max_tokens: /opus/i.test(model) ? 4096 : 8192,
    system,
    messages: [{ role: 'user', content: user }],
  }
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    body.temperature = cfg.temperature
  }
  const data = await anthropicRequest(cfg, body, timeoutMs)
  const content = extractAnthropicContent(data)
  if (!content) throw new Error('Пустой ответ модели')
  return { content, adapter: 'anthropic', model, usage: extractUsage(data) }
}

/** Адаптер anthropic в режиме стриминга: SSE с content_block_delta (CR-016-паттерн). */
async function anthropicChatStream(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number, sink: StreamSink): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    model,
    max_tokens: /opus/i.test(model) ? 4096 : 8192,
    system,
    messages: [{ role: 'user', content: user }],
  }
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    body.temperature = cfg.temperature
  }
  const { res, errorText } = await anthropicStreamRequest(cfg, body, timeoutMs)
  if (!res.ok) throw new NonRetryableProviderError(describeHttpError(res.status, errorText))
  const contentType = String(res.headers?.get?.('content-type') || '')
  if (!contentType.includes('event-stream')) {
    throw new Error('Провайдер не вернул SSE-поток для стримингового запроса')
  }
  const { content, usage } = await withTimeout(
    consumeAnthropicSse(res.body, sink),
    timeoutMs,
    `Таймаут чтения стрима (${Math.round(timeoutMs / 1000)} с)`
  )
  if (!content.trim()) throw new Error('Пустой ответ модели')
  return { content: content.trim(), adapter: 'anthropic', model, usage }
}

/** Адаптер google-gemini (generateContent API, CR-017): systemInstruction.parts,
 *  temperature — в generationConfig; usage — из usageMetadata. */
async function geminiChat(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
  }
  const genCfg: Record<string, unknown> = {}
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    genCfg.temperature = cfg.temperature
  }
  if (Object.keys(genCfg).length) body.generationConfig = genCfg
  const data = await geminiRequest(cfg, body, timeoutMs)
  const content = extractGeminiContent(data)
  if (!content) throw new Error('Пустой ответ модели')
  return { content, adapter: 'google-gemini', model, usage: geminiUsageOf(data) }
}

/** Адаптер google-gemini в режиме стриминга: streamGenerateContent?alt=sse (CR-016-паттерн). */
async function geminiChatStream(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number, sink: StreamSink): Promise<LlmChatResult> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
  }
  const genCfg: Record<string, unknown> = {}
  if (typeof cfg.temperature === 'number' && Number.isFinite(cfg.temperature)) {
    genCfg.temperature = cfg.temperature
  }
  if (Object.keys(genCfg).length) body.generationConfig = genCfg
  const { res, errorText } = await geminiStreamRequest(cfg, body, timeoutMs)
  if (!res.ok) throw new NonRetryableProviderError(describeHttpError(res.status, errorText))
  const contentType = String(res.headers?.get?.('content-type') || '')
  if (!(contentType.includes('event-stream') || contentType.includes('text/plain'))) {
    throw new Error('Провайдер не вернул SSE-поток для стримингового запроса')
  }
  const { content, usage } = await withTimeout(
    consumeGeminiSse(res.body, sink),
    timeoutMs,
    `Таймаут чтения стрима (${Math.round(timeoutMs / 1000)} с)`
  )
  if (!content.trim()) throw new Error('Пустой ответ модели')
  return { content: content.trim(), adapter: 'google-gemini', model, usage }
}

/** Детальный результат LLM-вызова: текст + usage (для аудита токенов) */
export interface LlmTextResult {
  content: string
  usage?: LlmUsage
  model?: string
  adapter: LlmAdapterId | string
}

/** Один LLM-вызов с возвратом usage (ADR-015): роль резолвит провайдера */
export async function chatTextDetailed(
  system: string,
  user: string,
  timeoutMs = 90_000,
  retries = 1,
  role?: LlmRole
): Promise<LlmTextResult> {
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await callLlm(system, user, timeoutMs, role)
      return { content: res.content, usage: res.usage, model: res.model, adapter: res.adapter }
    } catch (e: any) {
      lastErr = e
      // 4xx ключа/доступа/пути не лечится повтором — выходим сразу
      if (e instanceof NonRetryableProviderError) break
      if (attempt < retries) await new Promise((r) => setTimeout(r, 900))
    }
  }
  throw lastErr ?? new Error('Ошибка LLM')
}

/** Один LLM-вызов (текстовый ответ); role резолвит провайдера, отсутствие — дефолт zai */
export async function chatText(system: string, user: string, timeoutMs = 90_000, retries = 1, role?: LlmRole): Promise<string> {
  return (await chatTextDetailed(system, user, timeoutMs, retries, role)).content
}

/** Один LLM-вызов с живым стримом текста (CR-016): sink получает снапшоты накопленного
 *  текста после каждой дельты. Любой сбой стриминга (не поддержан провайдером, гейт
 *  agentic-harness, обрыв, пустой поток) — тихий откат на обычный полный вызов с
 *  гейт-циклом: результат идентичен нестридовому пути, UI получает финальный текст
 *  одним снапшотом. Стрим — транспортное UX-улучшение, не семантика запуска. */
export async function chatTextDetailedStream(
  system: string,
  user: string,
  timeoutMs = 90_000,
  role?: LlmRole,
  sink?: StreamSink
): Promise<LlmTextResult> {
  if (sink) {
    try {
      const cfg = resolveRole(role, loadConfig())
      const res = cfg.adapter === 'anthropic'
        ? await anthropicChatStream(cfg, system, user, timeoutMs, sink)
        : cfg.adapter === 'google-gemini'
          ? await geminiChatStream(cfg, system, user, timeoutMs, sink)
          : cfg.adapter === 'openai-compatible'
            ? await openaiCompatibleChatStream(cfg, system, user, timeoutMs, sink)
            : await zaiChatStream(system, user, timeoutMs, sink)
      sink(res.content)
      return { content: res.content, usage: res.usage, model: res.model, adapter: res.adapter }
    } catch (e: any) {
      console.error('[tacg-llm] стрим не удался, откат на полный вызов:', e?.message ?? e)
    }
  }
  const res = await chatTextDetailed(system, user, timeoutMs, 1, role)
  if (sink) sink(res.content)
  return res
}

/** Результат JSON-вызова: распарсенный объект + накопленный usage всех попыток */
export interface LlmJsonResult {
  json: any | null
  usage?: LlmUsage
}

/** LLM-вызов с ожиданием JSON и возвратом usage (ADR-015): usage копится по всем попыткам */
export async function chatJsonDetailed(
  system: string,
  user: string,
  timeoutMs = 60_000,
  jsonRetries = 1,
  role?: LlmRole
): Promise<LlmJsonResult> {
  let last: any = null
  let usageAcc: LlmUsage | undefined
  const attempts = 1 + Math.max(0, jsonRetries)
  for (let i = 0; i < attempts; i++) {
    const res = await chatTextDetailed(system, user, timeoutMs, i === 0 ? 0 : 1, role)
    usageAcc = mergeUsage(usageAcc, res.usage)
    const parsed = extractJson(res.content)
    if (parsed) return { json: parsed, usage: usageAcc }
    last = res.content
  }
  console.error('[tacg-llm] JSON не извлечён из ответа:', String(last || '').slice(0, 200))
  return { json: null, usage: usageAcc }
}

/** LLM-вызов с ожиданием JSON: ретраи при неудачном парсинге ответа */
export async function chatJson(system: string, user: string, timeoutMs = 60_000, jsonRetries = 1, role?: LlmRole): Promise<any | null> {
  return (await chatJsonDetailed(system, user, timeoutMs, jsonRetries, role)).json
}
