// TACG — слой роутера LLM-вызовов (ADR-012): адаптеры zai (дефолт) и
// openai-compatible (baseUrl + apiKey + model), резолв по ролям.
// extractJson/repairJson/таймауты/ретраи — НАД адаптерами (провайдер-агностичны).
import ZAI, { ChatMessage } from 'z-ai-web-dev-sdk'
import type { LlmProviderConfig } from './llm-config'
import { describeHttpError, describeNetworkError, loadConfig, resolveRole } from './llm-config'

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
    return { content: content.trim(), adapter: 'zai', model: 'z-ai-sdk' }
  }
  throw new Error('Пустой ответ модели')
}

/** Адаптер openai-compatible: POST {baseUrl}/chat/completions, Bearer-ключ */
async function openaiCompatibleChat(cfg: LlmProviderConfig, system: string, user: string, timeoutMs: number): Promise<LlmChatResult> {
  const baseUrl = (cfg.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('baseUrl провайдера не задан (настройки LLM)')
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
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: any
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (e: any) {
    throw new Error(describeNetworkError(e, timeoutMs))
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(describeHttpError(res.status, text))
  }
  const data: any = await res.json().catch(() => null)
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('Пустой ответ модели')
  const usage = data?.usage
  return {
    content: content.trim(),
    adapter: 'openai-compatible',
    model,
    usage:
      usage && (typeof usage.prompt_tokens === 'number' || typeof usage.completion_tokens === 'number')
        ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens }
        : undefined,
  }
}

/** Роутер: резолв конфигурации по роли → диспетчеризация в адаптер */
async function callLlm(system: string, user: string, timeoutMs: number, role?: LlmRole): Promise<LlmChatResult> {
  const cfg = resolveRole(role, loadConfig())
  if (cfg.adapter === 'openai-compatible') return openaiCompatibleChat(cfg, system, user, timeoutMs)
  return zaiChat(system, user, timeoutMs)
}

/** Один LLM-вызов (текстовый ответ); role резолвит провайдера, отсутствие — дефолт zai */
export async function chatText(system: string, user: string, timeoutMs = 90_000, retries = 1, role?: LlmRole): Promise<string> {
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await callLlm(system, user, timeoutMs, role)
      return res.content
    } catch (e: any) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 900))
    }
  }
  throw lastErr ?? new Error('Ошибка LLM')
}

/** LLM-вызов с ожиданием JSON: ретраи при неудачном парсинге ответа */
export async function chatJson(system: string, user: string, timeoutMs = 60_000, jsonRetries = 1, role?: LlmRole): Promise<any | null> {
  let last: any = null
  const attempts = 1 + Math.max(0, jsonRetries)
  for (let i = 0; i < attempts; i++) {
    const raw = await chatText(system, user, timeoutMs, i === 0 ? 0 : 1, role)
    const parsed = extractJson(raw)
    if (parsed) return parsed
    last = raw
  }
  console.error('[tacg-llm] JSON не извлечён из ответа:', String(last || '').slice(0, 200))
  return null
}
