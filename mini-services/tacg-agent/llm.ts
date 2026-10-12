// TACG — слой роутера LLM-вызовов (ADR-012): адаптеры zai (дефолт) и
// openai-compatible (baseUrl + apiKey + model), резолв по ролям.
// extractJson/repairJson/таймауты/ретраи — НАД адаптерами (провайдер-агностичны).
import ZAI, { ChatMessage } from 'z-ai-web-dev-sdk'
import type { LlmProviderConfig } from './llm-config'
import { loadConfig, resolveRole } from './llm-config'
import { chatCompletionsRequest, extractMessageContent, NonRetryableProviderError } from './openai-client'

/** Роль движка: какая точка делает вызов */
export type LlmRole = 'planner' | 'executor' | 'supervisor' | 'decider'

/** Идентификатор адаптера провайдера */
export type LlmAdapterId = 'zai' | 'openai-compatible'

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

/** Роутер: резолв конфигурации по роли → диспетчеризация в адаптер */
async function callLlm(system: string, user: string, timeoutMs: number, role?: LlmRole): Promise<LlmChatResult> {
  const cfg = resolveRole(role, loadConfig())
  if (cfg.adapter === 'openai-compatible') return openaiCompatibleChat(cfg, system, user, timeoutMs)
  return zaiChat(system, user, timeoutMs)
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
