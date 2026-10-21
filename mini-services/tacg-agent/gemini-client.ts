// TACG — нативный клиент Google Gemini generateContent API (CR-017, ADR-024).
// POST {baseUrl}/v1beta/models/{model}:generateContent (стриминг —
// :streamGenerateContent?alt=sse); baseUrl по умолчанию —
// https://generativelanguage.googleapis.com; ключ — заголовок x-goog-api-key.
// Системный промпт — systemInstruction.parts; ответ — candidates[0].content.parts[].text.
// usage: usageMetadata.promptTokenCount / candidatesTokenCount (маппится в LlmUsage).
// Ошибки классифицируются как в openai-client (4xx → NonRetryable, 408/429/5xx — ретраебельны).
import type { LlmProviderConfig } from './llm-config'
import { describeHttpError, describeNetworkError } from './llm-config'
import { NonRetryableProviderError, type ValidateResult } from './openai-client'

export const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com'

export const geminiBase = (cfg: LlmProviderConfig): string =>
  (cfg.baseUrl || '').trim().replace(/\/+$/, '') || GEMINI_DEFAULT_BASE

/** Один POST к методу модели; тело ответа не читается при ok=false — отдаётся errorText */
async function postGemini(
  cfg: LlmProviderConfig,
  method: 'generateContent' | 'streamGenerateContent',
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  const model = (cfg.model || '').trim()
  if (!model) throw new Error('Модель провайдера не задана (настройки LLM)')
  const sse = method === 'streamGenerateContent' ? '?alt=sse' : ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: any
  try {
    res = await fetch(`${geminiBase(cfg)}/v1beta/models/${model}:${method}${sse}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
  } catch (e: any) {
    throw new Error(describeNetworkError(e, timeoutMs))
  } finally {
    clearTimeout(timer)
  }
  const errorText = res.ok ? '' : await res.text().catch(() => '')
  return { res, errorText }
}

/** Полный (нестримовый) вызов generateContent: JSON-ответ или классифицированная ошибка */
export async function geminiRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<any> {
  const { res, errorText } = await postGemini(cfg, 'generateContent', body, timeoutMs)
  if (!res.ok) {
    const message = describeHttpError(res.status, errorText)
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500
    if (retryable) throw new Error(message)
    throw new NonRetryableProviderError(message)
  }
  const data = await res.json().catch(() => null)
  if (!data) throw new NonRetryableProviderError('Провайдер вернул некорректный (не-JSON) ответ')
  return data
}

/** Стриминговый вызов (CR-016-паттерн): Response отдаётся вызывающему для чтения SSE */
export async function geminiStreamRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  return postGemini(cfg, 'streamGenerateContent', body, timeoutMs)
}

/** Текст ответа: candidates[0].content.parts[].text → конкатенация (части могут
 *  перемежаться с пустыми/нетекстовыми); null — ответа нет вовсе (finishReason и
 *  пустой candidates трактуются как «пустой ответ» на уровне вызывающего) */
export function extractGeminiContent(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts) || !parts.length) return null
  const out: string[] = []
  for (const p of parts) {
    if (typeof p?.text === 'string' && p.text.trim()) out.push(p.text.trim())
  }
  return out.length ? out.join('\n\n') : null
}

/** usageMetadata → LlmUsage (promptTokenCount / candidatesTokenCount) */
export function geminiUsageOf(data: any): { promptTokens?: number; completionTokens?: number } | undefined {
  const u = data?.usageMetadata
  if (!u || typeof u !== 'object') return undefined
  const prompt = u.promptTokenCount
  const completion = u.candidatesTokenCount
  if (typeof prompt !== 'number' && typeof completion !== 'number') return undefined
  return {
    promptTokens: typeof prompt === 'number' ? prompt : undefined,
    completionTokens: typeof completion === 'number' ? completion : undefined,
  }
}

export interface GeminiStreamResult {
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

/** Чтение SSE streamGenerateContent (alt=sse): каждый data-чанк — candidates с
 *  текстовыми дельтами (несколько parts в одном чанке склеиваются), usageMetadata
 *  приходит в финальном чанке (берём последний замеченный). */
export async function consumeGeminiSse(
  body: any,
  onSnapshot: (textSoFar: string) => void
): Promise<GeminiStreamResult> {
  const reader = (body as ReadableStream).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let usage: { promptTokens?: number; completionTokens?: number } | undefined
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
      const parts = obj?.candidates?.[0]?.content?.parts
      if (Array.isArray(parts)) {
        let chunk = ''
        for (const p of parts) {
          if (typeof p?.text === 'string' && p.text) chunk += p.text
        }
        if (chunk) {
          content += chunk
          onSnapshot(content)
        }
      }
      const u = geminiUsageOf(obj)
      if (u) usage = u
    }
  }
  return { content, usage }
}

/** Пробная валидация провайдера (FR-906): короткий «ping» */
export async function validateGemini(cfg: LlmProviderConfig, timeoutMs = 15_000): Promise<ValidateResult> {
  const model = (cfg.model || '').trim()
  if (!model) return { ok: false, error: 'модель не задана' }
  if (!cfg.apiKey) return { ok: false, error: 'ключ API не задан' }
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
    generationConfig: { maxOutputTokens: 16 },
  }
  const started = Date.now()
  try {
    await geminiRequest(cfg, body, timeoutMs)
    return { ok: true, latencyMs: Date.now() - started }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Ошибка проверки провайдера' }
  }
}
