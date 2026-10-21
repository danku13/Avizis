// TACG — нативный клиент Anthropic Messages API (CR-017, ADR-024).
// POST {baseUrl}/v1/messages (baseUrl по умолчанию https://api.anthropic.com):
// ключ — заголовок x-api-key + anthropic-version; system отделён от messages.
// Ошибки классифицируются как в openai-client: 4xx ключа/доступа/пути →
// NonRetryableProviderError (внешние ретраи пропускают), 408/429/5xx — ретраебельны.
// Стриминг: stream:true → SSE «event: …/data: …»; текст копится из content_block_delta
// (delta.text_delta), usage — input_tokens из message_start + output_tokens из message_delta.
import type { LlmProviderConfig } from './llm-config'
import { describeHttpError, describeNetworkError } from './llm-config'
import { NonRetryableProviderError, type ValidateResult } from './openai-client'

export const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'
export const ANTHROPIC_VERSION = '2023-06-01'

export const anthropicBase = (cfg: LlmProviderConfig): string =>
  (cfg.baseUrl || '').trim().replace(/\/+$/, '') || ANTHROPIC_DEFAULT_BASE

/** Один POST /v1/messages; тело ответа не читается при ok=false — отдаётся errorText */
async function postMessages(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let res: any
  try {
    res = await fetch(`${anthropicBase(cfg)}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
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

/** Полный (нестримовый) вызов Messages API: JSON-ответ или классифицированная ошибка */
export async function anthropicRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<any> {
  const { res, errorText } = await postMessages(cfg, body, timeoutMs)
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
export async function anthropicStreamRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  return postMessages(cfg, { ...body, stream: true }, timeoutMs)
}

/** Текст ответа: content[].type === 'text' → конкатенация блоков (промпт-инжиниринг
 *  Anthropic допускает несколько text-блоков); null — ответа нет вовсе */
export function extractAnthropicContent(data: any): string | null {
  const blocks = data?.content
  if (!Array.isArray(blocks) || !blocks.length) return null
  const parts: string[] = []
  for (const b of blocks) {
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text.trim())
  }
  return parts.length ? parts.join('\n\n') : null
}

export interface AnthropicStreamResult {
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

/** Чтение SSE Messages API: снапшоты накопленного текста после каждой text_delta;
 *  usage собирается из message_start (input) и message_delta (output, финальный). */
export async function consumeAnthropicSse(
  body: any,
  onSnapshot: (textSoFar: string) => void
): Promise<AnthropicStreamResult> {
  const reader = (body as ReadableStream).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue // строки «event: …» игнорируем — тип живёт в payload
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let obj: any
      try {
        obj = JSON.parse(payload)
      } catch {
        continue
      }
      if (obj?.type === 'content_block_delta' && obj?.delta?.type === 'text_delta') {
        const t = obj.delta.text
        if (typeof t === 'string' && t) {
          content += t
          onSnapshot(content)
        }
      }
      const inTok = obj?.message?.usage?.input_tokens ?? obj?.usage?.input_tokens
      if (typeof inTok === 'number') promptTokens = inTok
      const outTok = obj?.usage?.output_tokens
      if (typeof outTok === 'number') completionTokens = outTok
    }
  }
  return {
    content,
    usage:
      typeof promptTokens === 'number' || typeof completionTokens === 'number'
        ? { promptTokens, completionTokens }
        : undefined,
  }
}

/** Пробная валидация провайдера (FR-906): короткий «ping» с max_tokens 16 */
export async function validateAnthropic(cfg: LlmProviderConfig, timeoutMs = 15_000): Promise<ValidateResult> {
  const model = (cfg.model || '').trim()
  if (!model) return { ok: false, error: 'модель не задана' }
  if (!cfg.apiKey) return { ok: false, error: 'ключ API не задан' }
  const body = { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
  const started = Date.now()
  try {
    await anthropicRequest(cfg, body, timeoutMs)
    return { ok: true, latencyMs: Date.now() - started }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Ошибка проверки провайдера' }
  }
}
