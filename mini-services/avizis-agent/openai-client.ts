// Avizis — общий клиент openai-compatible-провайдеров (llm.ts + llm-config.ts).
// Помимо POST /chat/completions здесь живёт обход гейта OpenRouter для
// free-эндпоинтов «только для агентных харнесов» (например
// thinkingmachines/inkling:free): первый запрос уходит как обычно, при 403
// с маркером гейта («only available for use with agentic harnesses») запрос
// повторяется с минимальным набором tools — Avizis и есть агентный харнес.
// Решение кэшируется per (baseUrl|model) до рестарта движка.
// 4xx-ошибки ключа/доступа/пути помечаются NonRetryableProviderError —
// внешние ретраи в llm.ts их пропускают (раньше 403 гонялся всеми 5 ретраями).
import type { LlmProviderConfig } from './llm-config'
import { describeHttpError, describeNetworkError } from './llm-config'

/** Ошибка провайдера, при которой ретраи бессмысленны (401/402/403/404…) */
export class NonRetryableProviderError extends Error {}

export interface ValidateResult {
  ok: boolean
  error?: string
  latencyMs?: number
  /** Проба прошла через tools (гейт agentic-harness) */
  agentic?: boolean
}

/** Маркер гейта agentic-harness в теле ошибки OpenRouter */
const AGENTIC_GATE_RE = /agentic (harness|application|use case)|only available for use with agentic/i

/** (baseUrl|model) → гейт подтверждён: последующие запросы сразу с tools */
const gatedProviders = new Set<string>()

export function resetGateCacheForTests(): void {
  gatedProviders.clear()
}

export function isGatedForTests(baseUrl: string, model: string): boolean {
  return gatedProviders.has(providerKeyOf(baseUrl, model))
}

function providerKeyOf(baseUrl: string, model: string): string {
  return `${(baseUrl || '').trim().replace(/\/+$/, '')}|${(model || '').trim()}`
}

/**
 * Минимальный набор tools для прохождения гейта: одна функция «отправить
 * итоговый ответ». Требование гейта — запрос выглядит агентным (харнессы
 * всегда декларируют tools); tool_choice НЕ шлём — free-варианты его не
 * поддерживают (supported_parameters: tools есть, tool_choice нет).
 */
const AGENTIC_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'submit_final_answer',
      description: 'Отправить итоговый текстовый ответ текущего шага. Вызывай, когда результат готов полностью.',
      parameters: {
        type: 'object',
        properties: {
          answer: { type: 'string', description: 'Полный итоговый текст ответа (весь результат шага целиком)' },
        },
        required: ['answer'],
      },
    },
  },
] as const

const cleanBaseUrl = (cfg: LlmProviderConfig): string => (cfg.baseUrl || '').trim().replace(/\/+$/, '')

/** Один HTTP-запрос; tools добавляются в body при withTools */
async function postOnce(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  withTools: boolean,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  const baseUrl = cleanBaseUrl(cfg)
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
      body: JSON.stringify(withTools ? { ...body, tools: AGENTIC_TOOLS } : body),
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

export interface ChatCompletionResult {
  /** Распарсенный JSON ответа провайдера */
  data: any
  /** Запрос ушёл с tools (гейт OpenRouter обойдён) */
  usedTools: boolean
}

/**
 * POST /chat/completions с обходом гейта agentic-harness:
 * без tools → 403-гейт → повтор с tools → успех (кэш per модель).
 * 4xx (кроме ретраебельных 408/429) → NonRetryableProviderError.
 */
export async function chatCompletionsRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<ChatCompletionResult> {
  const baseUrl = cleanBaseUrl(cfg)
  if (!baseUrl) throw new Error('baseUrl провайдера не задан (настройки LLM)')
  const key = providerKeyOf(baseUrl, cfg.model || '')

  for (let attempt = 1; ; attempt++) {
    const withTools = gatedProviders.has(key)
    const { res, errorText } = await postOnce(cfg, body, withTools, timeoutMs)
    if (res.ok) {
      const data = await res.json().catch(() => null)
      if (!data) throw new NonRetryableProviderError('Провайдер вернул некорректный (не-JSON) ответ')
      // 200 с error-телом (mid-stream ошибки OpenRouter): проверяем гейт и по нему
      const inlineError = !data?.choices?.length && data?.error ? JSON.stringify(data.error) : ''
      if (!withTools && attempt === 1 && inlineError && AGENTIC_GATE_RE.test(inlineError)) {
        gatedProviders.add(key)
        continue
      }
      return { data, usedTools: withTools }
    }
    // гейт «только для агентных харнесов»: один повтор с tools, дальше — кэш
    if (!withTools && attempt === 1 && AGENTIC_GATE_RE.test(errorText)) {
      gatedProviders.add(key)
      continue
    }
    // 408 (timeout) и 429 (rate limit) — транзиентны, остальное 4xx не ретраится
    const retryableStatus = res.status === 408 || res.status === 429 || res.status >= 500
    const message = describeHttpError(res.status, errorText)
    if (retryableStatus) throw new Error(message)
    throw new NonRetryableProviderError(message)
  }
}

/**
 * POST /chat/completions в режиме стриминга (CR-016): один запрос, тело ответа
 * НЕ читается — отдаётся Response целиком (SSE-поток читает вызывающий).
 * Гейт agentic-harness здесь НЕ обходится: streaming + tools-повтор — отдельная
 * сложность, при любом отказе llm.ts откатывается на обычный (нестримовый)
 * путь с полным гейт-циклом. errorText — только для не-ok ответов.
 */
export async function chatCompletionsStreamRequest(
  cfg: LlmProviderConfig,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<{ res: any; errorText: string }> {
  const baseUrl = cleanBaseUrl(cfg)
  if (!baseUrl) throw new Error('baseUrl провайдера не задан (настройки LLM)')
  return postOnce(cfg, { ...body, stream: true }, false, timeoutMs)
}

/**
 * Текст ответа из chat.completion: message.content, а при его отсутствии —
 * аргументы tool_calls (модель, вызвавшая submit_final_answer, вместо текста).
 * Несколько вызовов склеиваются; null — ответа нет вовсе.
 */
export function extractMessageContent(data: any): string | null {
  const msg = data?.choices?.[0]?.message
  if (!msg) return null
  const parts: string[] = []
  const content = msg.content
  if (typeof content === 'string' && content.trim()) parts.push(content.trim())
  const calls = msg.tool_calls
  if (Array.isArray(calls)) {
    for (const c of calls) {
      const fn = c?.function
      const raw = typeof fn?.arguments === 'string' ? fn.arguments.trim() : ''
      if (!fn?.name && !raw) continue
      let parsed: any = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        /* аргументы не-JSON — используем как есть */
      }
      const text =
        typeof parsed?.answer === 'string'
          ? parsed.answer
          : typeof parsed?.result === 'string'
            ? parsed.result
            : typeof parsed?.output === 'string'
              ? parsed.output
              : typeof parsed === 'string'
                ? parsed
                : raw
      if (typeof text === 'string' && text.trim()) parts.push(text.trim())
    }
  }
  return parts.length ? parts.join('\n\n') : null
}

/**
 * Пробная валидация провайдера (FR-906): POST chat/completions с «ping».
 * Для гейта agentic-harness повторяет пробу с tools — иначе inkling:free
 * нельзя было бы даже сохранить в настройках (save валидирует пробой).
 */
export async function validateProvider(cfg: LlmProviderConfig, timeoutMs = 15_000): Promise<ValidateResult> {
  if (cfg.adapter !== 'openai-compatible') return { ok: true }
  const baseUrl = cleanBaseUrl(cfg)
  if (!baseUrl) return { ok: false, error: 'baseUrl не задан' }
  const model = (cfg.model || '').trim()
  if (!model) return { ok: false, error: 'модель не задана' }
  const body = { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }
  const started = Date.now()
  try {
    const { usedTools } = await chatCompletionsRequest(cfg, body, timeoutMs)
    return { ok: true, latencyMs: Date.now() - started, ...(usedTools ? { agentic: true } : {}) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Ошибка проверки провайдера' }
  }
}
