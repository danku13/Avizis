// TACG — конфигурация LLM-провайдеров (BYOK): хранение, маскирование ключей,
// резолв по ролям, пробная валидация. Ключи живут ТОЛЬКО здесь (data/llm-config.json,
// chmod 600) и никогда не попадают в runs.json/снапшоты/события/логи.
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './data-dir'
import type { LlmAdapterId, LlmRole } from './llm'
import type { LlmProviderInfo } from './types'

/** Параметры одного провайдера (ключ — только на сервере) */
export interface LlmProviderConfig {
  adapter: LlmAdapterId
  baseUrl?: string
  model?: string
  apiKey?: string
  temperature?: number
}

/** Полная конфигурация: дефолт + per-role переопределения + ручной прайсинг (ADR-016) */
export interface LlmConfig {
  default?: LlmProviderConfig
  roles?: Partial<Record<LlmRole, Partial<LlmProviderConfig>>>
  /** Ручные цены моделей (USD за 1M токенов): приоритет выше сетевых каталогов */
  pricing?: { models?: Record<string, { inputPer1M?: number; outputPer1M?: number }> }
}

// Портативный каталог данных (ADR-017): data/ рядом с exe в скомпилированном бинарнике
const FILE = path.join(DATA_DIR, 'llm-config.json')

export const LLM_ROLES: LlmRole[] = ['planner', 'executor', 'supervisor', 'decider']
const ADAPTERS: LlmAdapterId[] = ['zai', 'openai-compatible']

/** Человекочитаемые ошибки провайдера (FR-906) */
export function describeHttpError(status: number, body: string): string {
  const snippet = body ? `: ${body.slice(0, 200)}` : ''
  if (status === 401) return 'неверный ключ API (HTTP 401)'
  if (status === 404) return 'неверный baseUrl (HTTP 404 — путь не найден)'
  return `ошибка провайдера HTTP ${status}${snippet}`
}

export function describeNetworkError(e: any, timeoutMs?: number): string {
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
    return `таймаут запроса к провайдеру (${Math.round((timeoutMs ?? 0) / 1000)} с)`
  }
  const code = e?.cause?.code || e?.code
  if (code === 'ECONNREFUSED') return 'провайдер недоступен (соединение отклонено) — проверьте baseUrl'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'провайдер недоступен (хост не найден) — проверьте baseUrl'
  return `провайдер недоступен (${code || e?.message || 'сетевая ошибка'})`
}

/** Маска ключа: первые 3 + «…» + последние 4 симв. (короче 8 — «•••») */
export function maskKey(key: string): string {
  const k = (key || '').trim()
  if (k.length >= 8) return k.slice(0, 3) + '…' + k.slice(-4)
  return '•••'
}

/** Похоже ли значение на маску (защита от «сохранить маску как ключ») */
export function looksLikeMask(v?: string): boolean {
  return !!v && (v.includes('…') || v.includes('•'))
}

/** Прайс модели в USD за 1M токенов (руками в конфиге — для моделей вне каталогов) */
const cleanPrice = (v: any): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(10_000, Math.max(0, v))
}

const PRICING_LABELS: Record<string, string> = { manual: 'вручную (конфиг)', openrouter: 'OpenRouter', litellm: 'каталог LiteLLM' }

/** Человекочитаемое имя источника прайса */
export function priceSourceLabel(source: string): string {
  return PRICING_LABELS[source] ?? source
}

/**
 * Санитайз входа конфигурации (socket API): adapter из белого списка, строки
 * триммируются и урезаются (baseUrl ≤ 300, model ≤ 100, apiKey ≤ 400),
 * roles — только валидные ключи ролей; pricing.models — ≤ 50 моделей,
 * цены — числа 0..10000 USD за 1M токенов.
 */
export function sanitizeConfigInput(raw: any): LlmConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const cleanString = (v: any, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined
    const s = v.trim()
    return s ? s.slice(0, max) : undefined
  }
  const cleanProvider = (p: any, adapterRequired: boolean): Partial<LlmProviderConfig> | null => {
    if (!p || typeof p !== 'object') return null
    const out: Partial<LlmProviderConfig> = {}
    if (p.adapter !== undefined) {
      if (!ADAPTERS.includes(p.adapter)) return null
      out.adapter = p.adapter
    } else if (adapterRequired) {
      return null
    }
    const baseUrl = cleanString(p.baseUrl, 300)
    if (baseUrl) out.baseUrl = baseUrl
    const model = cleanString(p.model, 100)
    if (model) out.model = model
    const apiKey = cleanString(p.apiKey, 400)
    if (apiKey) out.apiKey = apiKey
    if (typeof p.temperature === 'number' && Number.isFinite(p.temperature)) {
      out.temperature = Math.min(2, Math.max(0, p.temperature))
    }
    return Object.keys(out).length ? out : null
  }

  const out: LlmConfig = {}
  if (raw.default !== undefined) {
    const d = cleanProvider(raw.default, true)
    if (!d || !d.adapter) return null
    out.default = d as LlmProviderConfig
  }
  if (raw.roles && typeof raw.roles === 'object') {
    const roles: LlmConfig['roles'] = {}
    for (const role of LLM_ROLES) {
      const r = raw.roles[role]
      if (r !== undefined) {
        const s = cleanProvider(r, false)
        if (s) roles[role] = s
      }
    }
    if (Object.keys(roles).length) out.roles = roles
  }
  // Ручной прайсинг (ADR-016): только конечный объект с валидными числами
  if (raw.pricing && typeof raw.pricing === 'object' && raw.pricing.models && typeof raw.pricing.models === 'object') {
    const models: NonNullable<LlmConfig['pricing']>['models'] = {}
    for (const [k, v] of Object.entries(raw.pricing.models as Record<string, any>).slice(0, 50)) {
      const key = String(k).trim().toLowerCase().slice(0, 100)
      if (!key || typeof v !== 'object' || v === null) continue
      const inputPer1M = cleanPrice(v.inputPer1M)
      const outputPer1M = cleanPrice(v.outputPer1M)
      if (inputPer1M === undefined && outputPer1M === undefined) continue
      models[key] = { inputPer1M, outputPer1M }
    }
    out.pricing = { models }
  }
  return out
}

/**
 * Слияние входа с сохранённым конфигом: пустой/маско-подобный apiKey сохраняется
 * от прежнего провайдера, только если провайдер не сменился (тот же adapter и baseUrl)
 * и ключ реально используется (openai-compatible) — пользователь не перепечатывает
 * ключ при каждой правке модели; смена провайдера или переход на zai ключ сбрасывает.
 * Прайсинг: per-key merge — вход перекрывает сохранённые цены поимённо, остальное живёт
 * (в UI редактируется цена только текущей модели; удаление записи — правкой файла).
 */
export function mergeSavedApiKey(incoming: LlmConfig, saved: LlmConfig): LlmConfig {
  const sameProvider = (a?: Partial<LlmProviderConfig>, b?: Partial<LlmProviderConfig>): boolean =>
    (a?.adapter ?? 'zai') === (b?.adapter ?? 'zai') && (a?.baseUrl ?? '') === (b?.baseUrl ?? '')
  const merged: LlmConfig = { ...incoming }
  if (
    incoming.default &&
    (!incoming.default.apiKey || looksLikeMask(incoming.default.apiKey)) &&
    incoming.default.adapter === 'openai-compatible' &&
    saved.default?.apiKey &&
    sameProvider(incoming.default, saved.default)
  ) {
    merged.default = { ...incoming.default, apiKey: saved.default.apiKey }
  }
  if (incoming.roles && saved.roles) {
    const roles: LlmConfig['roles'] = {}
    for (const role of LLM_ROLES) {
      const inc = incoming.roles[role]
      if (!inc) continue
      const old = saved.roles[role]
      let entry: Partial<LlmProviderConfig> = { ...inc }
      const effectiveAdapter = inc.adapter ?? incoming.default?.adapter
      if (
        (!entry.apiKey || looksLikeMask(entry.apiKey)) &&
        old?.apiKey &&
        effectiveAdapter === 'openai-compatible' &&
        sameProvider(inc, old)
      ) {
        entry = { ...entry, apiKey: old.apiKey }
      }
      roles[role] = entry
    }
    merged.roles = roles
  }
  if (incoming.pricing?.models || saved.pricing?.models) {
    const models = { ...(saved.pricing?.models ?? {}), ...(incoming.pricing?.models ?? {}) }
    if (Object.keys(models).length) merged.pricing = { models }
  }
  return merged
}

let cached: LlmConfig | null = null

/** Бутстрап из env при отсутствии файла (headless-запуск, TACG_LLM_*) */
function bootstrapFromEnv(): LlmConfig {
  const env = process.env
  const cfg: LlmConfig = {}
  const wantsOpenai = env.TACG_LLM_ADAPTER === 'openai-compatible'
  const hasEnv = wantsOpenai || env.TACG_LLM_BASE_URL || env.TACG_LLM_API_KEY || env.TACG_LLM_MODEL
  if (hasEnv) {
    const d: LlmProviderConfig = { adapter: wantsOpenai ? 'openai-compatible' : 'zai' }
    if (env.TACG_LLM_BASE_URL) d.baseUrl = env.TACG_LLM_BASE_URL
    if (env.TACG_LLM_API_KEY) d.apiKey = env.TACG_LLM_API_KEY
    if (env.TACG_LLM_MODEL) d.model = env.TACG_LLM_MODEL
    cfg.default = d
  } else {
    cfg.default = { adapter: 'zai' }
  }
  const roleEnv: Array<[LlmRole, string | undefined]> = [
    ['planner', env.TACG_LLM_MODEL_PLANNER],
    ['executor', env.TACG_LLM_MODEL_EXECUTOR],
    ['supervisor', env.TACG_LLM_MODEL_SUPERVISOR],
    ['decider', env.TACG_LLM_MODEL_DECIDER],
  ]
  const roles: LlmConfig['roles'] = {}
  for (const [role, m] of roleEnv) if (m) roles[role] = { model: m }
  if (Object.keys(roles).length) cfg.roles = roles
  return cfg
}

/** Загрузка конфигурации: файл → env-бутстрап → дефолт zai. Кэш в памяти. */
export function loadConfig(): LlmConfig {
  if (cached) return cached
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
      const sane = sanitizeConfigInput(parsed)
      if (sane) {
        cached = sane
        return cached
      }
      console.error('[tacg-llm-config] конфиг-файл некорректен — используется дефолт zai')
    }
  } catch (e) {
    console.error('[tacg-llm-config] не удалось прочитать конфиг:', e)
  }
  cached = bootstrapFromEnv()
  return cached
}

/** Сохранение: JSON-файл (chmod 600) + обновление кэша */
export function saveConfig(cfg: LlmConfig): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), 'utf-8')
  try {
    fs.chmodSync(FILE, 0o600)
  } catch {
    /* chmod может отсутствовать на некоторых ФС — не критично */
  }
  cached = cfg
}

/** Конфиг для клиента: apiKey заменён маской (полный ключ не покидает сервер) */
export function publicConfig(cfg: LlmConfig): Record<string, any> {
  const pub = (p?: Partial<LlmProviderConfig>): Record<string, any> | undefined => {
    if (!p) return undefined
    const out: Record<string, any> = {}
    if (p.adapter) out.adapter = p.adapter
    if (p.baseUrl) out.baseUrl = p.baseUrl
    if (p.model) out.model = p.model
    if (p.apiKey) out.apiKey = maskKey(p.apiKey)
    if (typeof p.temperature === 'number') out.temperature = p.temperature
    return Object.keys(out).length ? out : undefined
  }
  const out: Record<string, any> = {}
  const d = pub(cfg.default)
  if (d) out.default = d
  if (cfg.roles) {
    const roles: Record<string, any> = {}
    for (const [k, v] of Object.entries(cfg.roles)) {
      const r = pub(v as Partial<LlmProviderConfig>)
      if (r) roles[k] = r
    }
    if (Object.keys(roles).length) out.roles = roles
  }
  // прайсинг не секретен — отдаём как есть (для префилла полей цены в настройках)
  if (cfg.pricing?.models && Object.keys(cfg.pricing.models).length) out.pricing = cfg.pricing
  return out
}

/** Резолв конфигурации по цепочке «роль → дефолт → zai» */
export function resolveRole(role: LlmRole | undefined, cfg: LlmConfig): LlmProviderConfig {
  const base: LlmProviderConfig = cfg.default ?? { adapter: 'zai' }
  const override = role ? cfg.roles?.[role] : undefined
  if (!override) return { ...base }
  return {
    adapter: override.adapter ?? base.adapter,
    baseUrl: override.baseUrl ?? base.baseUrl,
    model: override.model ?? base.model,
    apiKey: override.apiKey ?? base.apiKey,
    temperature: override.temperature ?? base.temperature,
  }
}

/** Модель-метка для provenance: zai → 'z-ai-sdk' (см. ADR-012) */
export function providerInfoOf(cfg: LlmProviderConfig): LlmProviderInfo {
  return {
    adapter: cfg.adapter,
    model: cfg.adapter === 'zai' ? 'z-ai-sdk' : (cfg.model || '').trim() || 'не задана',
  }
}

export interface ValidateResult {
  ok: boolean
  error?: string
  latencyMs?: number
}

/** Пробная валидация провайдера: для zai — без пробы; для openai-compatible — POST chat/completions */
export async function validateProvider(cfg: LlmProviderConfig, timeoutMs = 15_000): Promise<ValidateResult> {
  if (cfg.adapter !== 'openai-compatible') return { ok: true }
  const baseUrl = (cfg.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) return { ok: false, error: 'baseUrl не задан' }
  const model = (cfg.model || '').trim()
  if (!model) return { ok: false, error: 'модель не задана' }
  const url = `${baseUrl}/chat/completions`
  const started = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: ac.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: describeHttpError(res.status, text) }
    }
    return { ok: true, latencyMs: Date.now() - started }
  } catch (e: any) {
    return { ok: false, error: describeNetworkError(e, timeoutMs) }
  } finally {
    clearTimeout(timer)
  }
}
