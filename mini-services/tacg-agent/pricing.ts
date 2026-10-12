// TACG — динамический прайсинг моделей (ADR-016): цены НЕ захардкожены, а подтягиваются
// в рантайме из внешних источников и кэшируются на диске. Источники:
//   1) manual — пользовательские override в data/llm-config.json (секция pricing.models),
//      самый высокий приоритет (z-ai SDK, локальные модели Ollama, корпоративные тарифы);
//   2) openrouter — публичный API https://openrouter.ai/api/v1/models (pricing.prompt /
//      pricing.completion, USD за токен; покрывает OpenRouter-конфиги с их наценкой);
//   3) litellm — открытый каталог LiteLLM (model_prices_and_context_window.json:
//      input_cost_per_token / output_cost_per_token; покрывает OpenAI, DeepSeek, Anthropic,
//      Google и сотни моделей — фактически индустриальный справочник).
// Всё best-effort: без сети прайсы просто отсутствуют → стоимость «н/д», прогон не страдает.
// Цена известна → стоимость считается по формуле tokens/1e6 × price_per_1M.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './llm-config'
import { DATA_DIR } from './data-dir'

export type PriceSource = 'manual' | 'openrouter' | 'litellm'

export interface ModelPrice {
  /** USD за 1M токенов промпта */
  inputPer1M: number
  /** USD за 1M токенов ответа */
  outputPer1M: number
  source: PriceSource
  /** Когда источник получен (для manual — время чтения конфига) */
  fetchedAt: number
}

export interface PricingSourceStatus {
  id: PriceSource
  label: string
  models: number
  fetchedAt?: number
  ok?: boolean
  error?: string
}

export interface PricingStatus {
  sources: PricingSourceStatus[]
  ttlHours: number
  /** TACG_PRICING_DISABLED=1 — сетевые источники выключены, только manual */
  disabled: boolean
}

export interface PriceResult {
  price: ModelPrice
  /** Стоимость вызова в USD (tokens/1e6 × цена за 1M) */
  costUsd: number
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const OPENROUTER_URL = process.env.TACG_PRICING_OPENROUTER_URL || 'https://openrouter.ai/api/v1/models'
const LITELLM_URL =
  process.env.TACG_PRICING_LITELLM_URL ||
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const TTL_HOURS = Number(process.env.TACG_PRICING_TTL_HOURS ?? '') > 0 ? Number(process.env.TACG_PRICING_TTL_HOURS) : 24
const DISABLED = process.env.TACG_PRICING_DISABLED === '1'
const FETCH_TIMEOUT_MS = 12_000

// Каталог данных — портативный (data-dir.ts, ADR-017): рядом с exe в скомпилированном бинарнике
const CACHE_FILE = path.join(DATA_DIR, 'pricing-cache.json')

/** Каталог источника: id модели → [вход $/1M, выход $/1M] */
interface SourceCache {
  fetchedAt: number
  ok: boolean
  error?: string
  models: Record<string, [number, number]>
}

interface CacheFile {
  version: 1
  savedAt: number
  openrouter?: SourceCache
  litellm?: SourceCache
}

// ─────────────────────── состояние в памяти ───────────────────────

const maps: Record<'openrouter' | 'litellm', Map<string, [number, number]>> = {
  openrouter: new Map(),
  litellm: new Map(),
}
const meta: Record<'openrouter' | 'litellm', { fetchedAt: number; ok: boolean; error?: string }> = {
  openrouter: { fetchedAt: 0, ok: false },
  litellm: { fetchedAt: 0, ok: false },
}
let manualFetchedAt = 0
let refreshInFlight: Promise<void> | null = null

/** Ручные override из конфига (live: saveConfig обновляет кэш конфига) */
function manualOverrides(): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  const models = loadConfig().pricing?.models
  if (!models) return out
  for (const [key, v] of Object.entries(models)) {
    const inP = v?.inputPer1M
    const outP = v?.outputPer1M
    if (typeof inP === 'number' || typeof outP === 'number') {
      out.set(normalize(key), [Number(inP) || 0, Number(outP) || 0])
    }
  }
  manualFetchedAt = Date.now()
  return out
}

const normalize = (m: string): string => (m || '').trim().toLowerCase()

/** USD за токен → USD за 1M токенов (значения источников приходят за токен) */
const per1M = (v: any): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n * 1e6 : 0
}

// ─────────────────────── разбор источников ───────────────────────

/** OpenRouter: { data: [{ id, pricing: { prompt, completion, ... } }] } — строки USD за токен */
function parseOpenRouter(json: any): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  const list = Array.isArray(json?.data) ? json.data : []
  for (const m of list) {
    const id = normalize(String(m?.id ?? ''))
    if (!id) continue
    const inputPerM = per1M(m?.pricing?.prompt)
    const outputPerM = per1M(m?.pricing?.completion)
    if (inputPerM <= 0 && outputPerM <= 0) continue // :free и служебные
    out.set(id, [inputPerM, outputPerM])
  }
  return out
}

/** LiteLLM: { "<model>": { input_cost_per_token, output_cost_per_token, ... } } */
function parseLiteLLM(json: any): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  if (!json || typeof json !== 'object') return out
  for (const [key, v] of Object.entries(json)) {
    const id = normalize(key)
    if (!id || typeof v !== 'object' || v === null) continue
    const inputPerM = per1M((v as any).input_cost_per_token)
    const outputPerM = per1M((v as any).output_cost_per_token)
    if (inputPerM <= 0 && outputPerM <= 0) continue
    out.set(id, [inputPerM, outputPerM])
  }
  return out
}

// ─────────────────────── кэш на диске ───────────────────────

function readCache(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) return
    const parsed: any = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    if (parsed?.version !== 1) return
    for (const src of ['openrouter', 'litellm'] as const) {
      const s = parsed[src]
      if (!s || typeof s !== 'object') continue
      const m = new Map<string, [number, number]>()
      for (const [k, v] of Object.entries(s.models ?? {})) {
        if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
          m.set(normalize(k), [v[0], v[1]])
        }
      }
      maps[src] = m
      meta[src] = { fetchedAt: Number(s.fetchedAt) || 0, ok: !!s.ok, error: s.error }
    }
  } catch (e) {
    console.error('[tacg-pricing] не удалось прочитать кэш прайсов:', e)
  }
}

function writeCache(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const file: CacheFile = { version: 1, savedAt: Date.now() }
    for (const src of ['openrouter', 'litellm'] as const) {
      const models: Record<string, [number, number]> = {}
      for (const [k, v] of maps[src]) models[k] = v
      file[src] = { fetchedAt: meta[src].fetchedAt, ok: meta[src].ok, error: meta[src].error, models }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(file))
  } catch (e) {
    /* кэш не критичен */
  }
}

// ─────────────────────── сетевое обновление ───────────────────────

async function fetchJson(url: string, fetcher: Fetcher): Promise<any> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetcher(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function refreshSource(
  src: 'openrouter' | 'litellm',
  url: string,
  parse: (json: any) => Map<string, [number, number]>,
  fetcher: Fetcher
): Promise<void> {
  try {
    const json = await fetchJson(url, fetcher)
    const parsed = parse(json)
    if (!parsed.size) throw new Error('пустой список моделей')
    maps[src] = parsed
    meta[src] = { fetchedAt: Date.now(), ok: true }
  } catch (e: any) {
    // кэш остаётся как есть (если был) — просто фиксируем неудачу обновления
    meta[src] = { fetchedAt: meta[src].fetchedAt, ok: false, error: e?.name === 'AbortError' ? 'таймаут' : trunc(e?.message || 'сетевая ошибка') }
  }
}

const trunc = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// ─────────────────────── публичный API ───────────────────────

export const pricing = {
  /** Загрузка дискового кэша (синхронно) + фоновое обновление устаревших источников */
  init(): void {
    readCache()
    const stale = (src: 'openrouter' | 'litellm') =>
      !meta[src].fetchedAt || Date.now() - meta[src].fetchedAt > TTL_HOURS * 3_600_000
    if (!DISABLED && (stale('openrouter') || stale('litellm'))) {
      this.refresh().catch(() => {})
    }
  },

  /**
   * Обновление сетевых источников (OpenRouter + LiteLLM), best-effort.
   * fetcher — инъекция для тестов (по умолчанию глобальный fetch).
   */
  async refresh(opts?: { fetcher?: Fetcher }): Promise<{ ok: boolean; error?: string }> {
    if (DISABLED) return { ok: false, error: 'прайсинг выключен (TACG_PRICING_DISABLED=1)' }
    const fetcher = opts?.fetcher ?? ((u: string, init?: RequestInit) => fetch(u, init))
    if (refreshInFlight) return refreshInFlight.then(() => ({ ok: meta.openrouter.ok || meta.litellm.ok }))
    const done = (async () => {
      await Promise.all([
        refreshSource('openrouter', OPENROUTER_URL, parseOpenRouter, fetcher),
        refreshSource('litellm', LITELLM_URL, parseLiteLLM, fetcher),
      ])
      writeCache()
    })()
    refreshInFlight = done
    try {
      await done
    } finally {
      refreshInFlight = null
    }
    const ok = meta.openrouter.ok || meta.litellm.ok
    return { ok, error: ok ? undefined : 'источники недоступны (сеть?)' }
  },

  /**
   * Цена модели по лестнице приоритетов: manual → OpenRouter (точное совпадение id,
   * включая наценку провайдера) → LiteLLM (точное) → LiteLLM по базовому id →
   * OpenRouter по базовому id (уникальное совпадение). Неизвестна → null.
   */
  priceFor(model: string): ModelPrice | null {
    const m = normalize(model)
    if (!m) return null
    const manual = manualOverrides().get(m)
    if (manual) return { inputPer1M: manual[0], outputPer1M: manual[1], source: 'manual', fetchedAt: manualFetchedAt }
    const or = maps.openrouter.get(m)
    if (or) return { inputPer1M: or[0], outputPer1M: or[1], source: 'openrouter', fetchedAt: meta.openrouter.fetchedAt }
    const ll = maps.litellm.get(m)
    if (ll) return { inputPer1M: ll[0], outputPer1M: ll[1], source: 'litellm', fetchedAt: meta.litellm.fetchedAt }
    // суффиксы вида «:free» / «:extended» отбрасываем
    const bare = m.split(':')[0]
    if (bare !== m) {
      const orB = maps.openrouter.get(bare)
      if (orB) return { inputPer1M: orB[0], outputPer1M: orB[1], source: 'openrouter', fetchedAt: meta.openrouter.fetchedAt }
      const llB = maps.litellm.get(bare)
      if (llB) return { inputPer1M: llB[0], outputPer1M: llB[1], source: 'litellm', fetchedAt: meta.litellm.fetchedAt }
    }
    // базовый id: «openai/gpt-4o» → «gpt-4o»
    const base = m.split('/').pop()!
    if (base !== m && base) {
      const llB = maps.litellm.get(base)
      if (llB) return { inputPer1M: llB[0], outputPer1M: llB[1], source: 'litellm', fetchedAt: meta.litellm.fetchedAt }
      const orCandidates = [...maps.openrouter.keys()].filter((k) => k.split('/').pop() === base)
      if (orCandidates.length === 1) {
        const v = maps.openrouter.get(orCandidates[0])!
        return { inputPer1M: v[0], outputPer1M: v[1], source: 'openrouter', fetchedAt: meta.openrouter.fetchedAt }
      }
    }
    return null
  },

  /** Стоимость вызова в USD по usage; null — цена модели неизвестна */
  costFor(model: string, inputTokens: number, outputTokens: number): PriceResult | null {
    const price = this.priceFor(model)
    if (!price) return null
    const costUsd = (inputTokens / 1e6) * price.inputPer1M + (outputTokens / 1e6) * price.outputPer1M
    return { price, costUsd }
  },

  /** Статус источников для UI настроек */
  status(): PricingStatus {
    const manual = manualOverrides()
    const src: PricingSourceStatus[] = [
      { id: 'manual', label: 'Вручную (конфиг)', models: manual.size, ok: true, fetchedAt: manualFetchedAt },
    ]
    if (!DISABLED) {
      src.push({
        id: 'openrouter',
        label: 'OpenRouter /models',
        models: maps.openrouter.size,
        fetchedAt: meta.openrouter.fetchedAt || undefined,
        // undefined = ещё не пробовали; false = пробовали и не вышло (кэш мог остаться)
        ok: meta.openrouter.fetchedAt ? meta.openrouter.ok : undefined,
        error: meta.openrouter.ok ? undefined : meta.openrouter.error,
      })
      src.push({
        id: 'litellm',
        label: 'Каталог LiteLLM',
        models: maps.litellm.size,
        fetchedAt: meta.litellm.fetchedAt || undefined,
        ok: meta.litellm.fetchedAt ? meta.litellm.ok : undefined,
        error: meta.litellm.ok ? undefined : meta.litellm.error,
      })
    }
    return { sources: src, ttlHours: TTL_HOURS, disabled: DISABLED }
  },

  /** Тесты: очистка памяти и (опционально) файла кэша */
  resetForTests(opts?: { wipeCacheFile?: boolean }): void {
    maps.openrouter = new Map()
    maps.litellm = new Map()
    meta.openrouter = { fetchedAt: 0, ok: false }
    meta.litellm = { fetchedAt: 0, ok: false }
    manualFetchedAt = 0
    if (opts?.wipeCacheFile) {
      try {
        fs.rmSync(CACHE_FILE, { force: true })
      } catch {
        /* пусто */
      }
    }
  },
}
