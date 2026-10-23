// Avizis — конвертация валюты для стоимости прогонов (FR-910, ADR-019).
// Базис аудита — USD (динамический прайсинг, ADR-016); конвертация — на отображение.
// Курсы НЕ захардкожены: подтягиваются в рантайме из внешних источников и кэшируются.
//
// Источники (приоритет по валюте):
//   1) manual — ручной override в data/llm-config.json (секция currency.rates),
//      самый высокий приоритет (офлайн-работа, детерминированные тесты, свой курс);
//   2) cbr — официальный XML ЦБ РФ https://www.cbr.ru/scripts/XML_daily.asp
//      (курсы RUB-базис, пересчёт через кросс-курс к доллару; кодировка windows-1251);
//   3) cbr-mirror — JSON-зеркало https://www.cbr-xml-daily.ru/daily_json.js
//      (те же курсы ЦБ в удобном JSON, обход блокировок/таймаутов основного сайта);
//   4) er-api — https://open.er-api.com/v6/latest/USD (независимый источник,
//      ~160 валют, обновление раз в день, без ключа).
//
// Всё best-effort: без сети курсы отсутствуют → стоимость остаётся в USD, прогон
// не страдает. Курсы обновляются раз в день у источников — TTL по умолчанию 6 ч.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from './llm-config'
import { DATA_DIR } from './data-dir'

export type CurrencySource = 'manual' | 'cbr' | 'cbr-mirror' | 'er-api'

/** Единица курса: сколько единиц валюты в 1 USD */
export interface CurrencyEntry {
  code: string
  rate: number
  source: CurrencySource
  /** Дата котировки источника (ЦБ: дата реестра), не дата загрузки */
  asOf?: string
  fetchedAt?: number
}

export interface CurrencySourceStatus {
  id: CurrencySource
  label: string
  currencies?: number
  asOf?: string
  fetchedAt?: number
  ok?: boolean
  error?: string
}

export interface CurrencyStatus {
  entries: CurrencyEntry[]
  sources: CurrencySourceStatus[]
  ttlHours: number
  /** AVIZIS_CURRENCY_DISABLED=1 — сетевые источники выключены, только manual */
  disabled: boolean
}

/** Поддерживаемые валюты отображения (куррируемый набор: ЦБ + ходовые) */
export const SUPPORTED_CURRENCIES = [
  'USD', 'EUR', 'RUB', 'KZT', 'CNY', 'GBP', 'TRY', 'AED',
  'INR', 'BYN', 'UAH', 'GEL', 'JPY', 'CHF', 'KRW',
] as const

const SUPPORTED = new Set<string>(SUPPORTED_CURRENCIES)

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const CBR_URL = process.env.AVIZIS_CURRENCY_URL_CBR || 'https://www.cbr.ru/scripts/XML_daily.asp'
const MIRROR_URL = process.env.AVIZIS_CURRENCY_URL_MIRROR || 'https://www.cbr-xml-daily.ru/daily_json.js'
const ER_API_URL = process.env.AVIZIS_CURRENCY_URL_ERAPI || 'https://open.er-api.com/v6/latest/USD'
const TTL_HOURS =
  Number(process.env.AVIZIS_CURRENCY_TTL_HOURS ?? '') > 0 ? Number(process.env.AVIZIS_CURRENCY_TTL_HOURS) : 6
const DISABLED = process.env.AVIZIS_CURRENCY_DISABLED === '1'
const FETCH_TIMEOUT_MS = 12_000

const CACHE_FILE = path.join(DATA_DIR, 'currency-cache.json')

/** Кэш источника: код → курс (за 1 USD) + дата котировки */
interface SourceCache {
  fetchedAt: number
  ok: boolean
  error?: string
  asOf?: string
  rates: Record<string, number>
}

interface CacheFile {
  version: 1
  savedAt: number
  cbr?: SourceCache
  'cbr-mirror'?: SourceCache
  'er-api'?: SourceCache
}

type NetworkSourceId = 'cbr' | 'cbr-mirror' | 'er-api'

// ─────────────────────── состояние в памяти ───────────────────────

const rates: Record<NetworkSourceId, Map<string, number>> = {
  cbr: new Map(),
  'cbr-mirror': new Map(),
  'er-api': new Map(),
}
const meta: Record<NetworkSourceId, { fetchedAt: number; ok: boolean; error?: string; asOf?: string }> = {
  cbr: { fetchedAt: 0, ok: false },
  'cbr-mirror': { fetchedAt: 0, ok: false },
  'er-api': { fetchedAt: 0, ok: false },
}
let manualFetchedAt = 0
let refreshInFlight: Promise<void> | null = null

const SOURCE_LABELS: Record<CurrencySource, string> = {
  manual: 'вручную (конфиг)',
  cbr: 'ЦБ РФ (XML_daily)',
  'cbr-mirror': 'ЦБ РФ (JSON-зеркало)',
  'er-api': 'open.er-api.com',
}

/** Человекочитаемое имя источника курса */
export function currencySourceLabel(source: string): string {
  return SOURCE_LABELS[source as CurrencySource] ?? source
}

/** Ручные override из конфига: код → курс за 1 USD */
function manualOverrides(): Map<string, number> {
  const out = new Map<string, number>()
  const manual = loadConfig().currency?.rates
  if (manual) {
    for (const [code, rate] of Object.entries(manual)) {
      const c = code.trim().toUpperCase()
      if (c && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) out.set(c, rate)
    }
  }
  manualFetchedAt = Date.now()
  return out
}

const cleanRate = (v: any): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 && n < 1e8 ? n : undefined
}

// ─────────────────────── разбор источников ───────────────────────

const decodeXml = (buf: ArrayBuffer): string => {
  // ЦБ отдаёт windows-1251; ASCII-поля (CharCode/Nominal/Value) не меняются,
  // но декодируем честно — с фолбэком на utf-8 (lossy) для экзотики
  try {
    return new TextDecoder('windows-1251').decode(buf)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf)
  }
}

/**
 * ЦБ РФ, официальный XML: <Valute><CharCode>USD</CharCode><Nominal>1</Nominal>
 * <Value>92,4103</Value></Valute> — рубли за Nominal единиц валюты.
 * Пересчёт: rate(X за 1 USD) = usdRub / (rubPerX / nominal… уже учтено).
 */
export function parseCbrXml(xml: string): Map<string, number> {
  const out = new Map<string, number>()
  const rubPer: Record<string, number> = {}
  const blockRe = /<Valute[^>]*>([\s\S]*?)<\/Valute>/g
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1]
    const code = block.match(/<CharCode>([A-Z]{3})<\/CharCode>/)?.[1]
    const nominal = cleanRate(block.match(/<Nominal>([\d.,]+)<\/Nominal>/)?.[1])
    const value = cleanRate(block.match(/<Value>([\d.,]+)<\/Value>/)?.[1])
    if (!code || !SUPPORTED.has(code) || !nominal || !value) continue
    rubPer[code] = value / nominal // ₽ за 1 единицу валюты
  }
  const usdRub = rubPer['USD']
  if (!usdRub) return out
  out.set('RUB', usdRub)
  for (const [code, rub] of Object.entries(rubPer)) {
    if (code === 'USD') continue
    const rate = usdRub / rub // кросс-курс через рубль
    if (Number.isFinite(rate) && rate > 0) out.set(code, rate)
  }
  return out
}

/** Дата реестра ЦБ из <ValCurs Date="13.10.2026" ...> → ISO */
export function cbrXmlDate(xml: string): string | undefined {
  const d = xml.match(/<ValCurs[^>]*\sDate="(\d{2})\.(\d{2})\.(\d{4})"/)
  return d ? `${d[3]}-${d[2]}-${d[1]}` : undefined
}

/**
 * JSON-зеркало ЦБ (cbr-xml-daily.ru): { Date, Valute: { USD: { Nominal, Value } } }.
 * Та же RUB-базисная арифметика, что и в официальном XML.
 */
export function parseCbrMirror(json: any): Map<string, number> {
  const out = new Map<string, number>()
  const rubPer: Record<string, number> = {}
  const valutes = json?.Valute
  if (!valutes || typeof valutes !== 'object') return out
  for (const [code, v] of Object.entries<any>(valutes)) {
    const c = String(code).trim().toUpperCase()
    if (!SUPPORTED.has(c)) continue
    const nominal = cleanRate(v?.Nominal)
    const value = cleanRate(v?.Value)
    if (!nominal || !value) continue
    rubPer[c] = value / nominal
  }
  const usdRub = rubPer['USD']
  if (!usdRub) return out
  out.set('RUB', usdRub)
  for (const [code, rub] of Object.entries(rubPer)) {
    if (code === 'USD') continue
    const rate = usdRub / rub
    if (Number.isFinite(rate) && rate > 0) out.set(code, rate)
  }
  return out
}

/** open.er-api.com: { rates: { RUB: 92.5, EUR: 0.92, ... } } — сразу за 1 USD */
export function parseErApi(json: any): Map<string, number> {
  const out = new Map<string, number>()
  const ratesIn = json?.rates
  if (!ratesIn || typeof ratesIn !== 'object') return out
  for (const [code, v] of Object.entries<any>(ratesIn)) {
    const c = String(code).trim().toUpperCase()
    if (!SUPPORTED.has(c)) continue
    const rate = cleanRate(v)
    if (rate !== undefined) out.set(c, rate)
  }
  return out
}

// ─────────────────────── кэш на диске ───────────────────────

function readCache(): void {
  try {
    if (!fs.existsSync(CACHE_FILE)) return
    const parsed: any = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
    if (parsed?.version !== 1) return
    for (const src of ['cbr', 'cbr-mirror', 'er-api'] as const) {
      const s = parsed[src]
      if (!s || typeof s !== 'object') continue
      const m = new Map<string, number>()
      for (const [k, v] of Object.entries(s.rates ?? {})) {
        const rate = cleanRate(v)
        const code = String(k).trim().toUpperCase()
        if (rate !== undefined && code) m.set(code, rate)
      }
      rates[src] = m
      meta[src] = { fetchedAt: Number(s.fetchedAt) || 0, ok: !!s.ok, error: s.error, asOf: s.asOf }
    }
  } catch (e) {
    console.error('[avizis-currency] не удалось прочитать кэш курсов:', e)
  }
}

function writeCache(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const file: CacheFile = { version: 1, savedAt: Date.now() }
    for (const src of ['cbr', 'cbr-mirror', 'er-api'] as const) {
      const r: Record<string, number> = {}
      for (const [k, v] of rates[src]) r[k] = v
      file[src] = { fetchedAt: meta[src].fetchedAt, ok: meta[src].ok, error: meta[src].error, asOf: meta[src].asOf, rates: r }
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(file))
  } catch {
    /* кэш не критичен */
  }
}

// ─────────────────────── сетевое обновление ───────────────────────

const trunc = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

async function fetchText(url: string, fetcher: Fetcher): Promise<string> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetcher(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJsonBody(url: string, fetcher: Fetcher): Promise<any> {
  const text = await fetchText(url, fetcher)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('некорректный JSON')
  }
}

async function refreshSource(src: NetworkSourceId, fetcher: Fetcher): Promise<void> {
  try {
    let parsed: Map<string, number>
    let asOf: string | undefined
    if (src === 'cbr') {
      const xml = await fetchText(CBR_URL, fetcher)
      parsed = parseCbrXml(xml)
      asOf = cbrXmlDate(xml)
      if (!parsed.get('RUB')) throw new Error('USD/RUB не найден в XML')
    } else if (src === 'cbr-mirror') {
      const json = await fetchJsonBody(MIRROR_URL, fetcher)
      parsed = parseCbrMirror(json)
      asOf = typeof json?.Date === 'string' ? json.Date.slice(0, 10) : undefined
      if (!parsed.get('RUB')) throw new Error('USD/RUB не найден в зеркале')
    } else {
      const json = await fetchJsonBody(ER_API_URL, fetcher)
      parsed = parseErApi(json)
      asOf = typeof json?.time_last_update_utc === 'string' ? json.time_last_update_utc.slice(0, 16) : undefined
      if (!parsed.get('RUB')) throw new Error('USD/RUB не найден в er-api')
    }
    if (!parsed.size) throw new Error('пустой список курсов')
    rates[src] = parsed
    meta[src] = { fetchedAt: Date.now(), ok: true, asOf }
  } catch (e: any) {
    // кэш остаётся как есть (если был) — фиксируем неудачу обновления
    meta[src] = {
      fetchedAt: meta[src].fetchedAt,
      ok: false,
      error: e?.name === 'AbortError' ? 'таймаут' : trunc(e?.message || 'сетевая ошибка'),
    }
  }
}

// ─────────────────────── публичный API ───────────────────────

export const currency = {
  /** Дисковый кэш (синхронно) + фоновое обновление устаревших источников */
  init(): void {
    readCache()
    const stale = (src: NetworkSourceId) =>
      !meta[src].fetchedAt || Date.now() - meta[src].fetchedAt > TTL_HOURS * 3_600_000
    if (!DISABLED && (stale('cbr') || stale('cbr-mirror') || stale('er-api'))) {
      this.refresh().catch(() => {})
    }
  },

  /** Обновление всех сетевых источников (best-effort, параллельно) */
  async refresh(opts?: { fetcher?: Fetcher }): Promise<{ ok: boolean; error?: string }> {
    if (DISABLED) return { ok: false, error: 'курсы выключены (AVIZIS_CURRENCY_DISABLED=1)' }
    const fetcher = opts?.fetcher ?? ((u: string, init?: RequestInit) => fetch(u, init))
    if (refreshInFlight) return refreshInFlight.then(() => ({ ok: this.anyOk() }))
    const done = (async () => {
      await Promise.all([
        refreshSource('cbr', fetcher),
        refreshSource('cbr-mirror', fetcher),
        refreshSource('er-api', fetcher),
      ])
      writeCache()
    })()
    refreshInFlight = done
    try {
      await done
    } finally {
      refreshInFlight = null
    }
    const ok = this.anyOk()
    return { ok, error: ok ? undefined : 'источники недоступны (сеть?)' }
  },

  anyOk(): boolean {
    return meta.cbr.ok || meta['cbr-mirror'].ok || meta['er-api'].ok
  },

  /**
   * Курс валюты по лестнице приоритетов: manual → ЦБ РФ → зеркало ЦБ → er-api.
   * Возвращает курс (единиц валюты за 1 USD) или null.
   */
  rateFor(code: string): CurrencyEntry | null {
    const c = (code || '').trim().toUpperCase()
    if (!c) return null
    if (c === 'USD') return { code: 'USD', rate: 1, source: 'manual' }
    const manual = manualOverrides().get(c)
    if (manual) return { code: c, rate: manual, source: 'manual', fetchedAt: manualFetchedAt }
    for (const src of ['cbr', 'cbr-mirror', 'er-api'] as const) {
      const r = rates[src].get(c)
      if (r) return { code: c, rate: r, source: src, asOf: meta[src].asOf, fetchedAt: meta[src].fetchedAt }
    }
    return null
  },

  /** Статус для UI: поддерживаемые валюты + источники */
  status(): CurrencyStatus {
    const entries: CurrencyEntry[] = []
    for (const code of SUPPORTED_CURRENCIES) {
      const e = this.rateFor(code)
      entries.push(e ?? { code, rate: 0, source: 'manual' }) // rate 0 = курса нет
    }
    const manual = manualOverrides()
    const sources: CurrencySourceStatus[] = [
      { id: 'manual', label: SOURCE_LABELS.manual, currencies: manual.size, ok: true, fetchedAt: manualFetchedAt },
    ]
    if (!DISABLED) {
      for (const src of ['cbr', 'cbr-mirror', 'er-api'] as const) {
        sources.push({
          id: src,
          label: SOURCE_LABELS[src],
          currencies: rates[src].size,
          asOf: meta[src].asOf,
          fetchedAt: meta[src].fetchedAt || undefined,
          ok: meta[src].fetchedAt ? meta[src].ok : undefined,
          error: meta[src].ok ? undefined : meta[src].error,
        })
      }
    }
    return { entries, sources, ttlHours: TTL_HOURS, disabled: DISABLED }
  },

  /** Тесты: очистка памяти и (опционально) файла кэша */
  resetForTests(opts?: { wipeCacheFile?: boolean }): void {
    for (const src of ['cbr', 'cbr-mirror', 'er-api'] as const) {
      rates[src] = new Map()
      meta[src] = { fetchedAt: 0, ok: false }
    }
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
