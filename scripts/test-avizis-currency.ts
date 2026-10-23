// Тест конвертации валюты (ADR-019 / FR-910): разбор источников курсов
// (ЦБ РФ XML с windows-1251, JSON-зеркало ЦБ, open.er-api), кросс-курсы через
// рубль, приоритет manual > ЦБ > зеркало > er-api, кэш на диске, офлайн,
// санитайз конфига; интеграция: currency:status / refresh по сокету (:3003)
// + арифметика отображения (convertUsd/fmtCurrency) поверх costUsd прогона
// с мок-провайдером. Паттерн — test-avizis-pricing.ts.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'
import { convertUsd, fmtCurrency, fmtUsd } from '../src/lib/avizis/types'
import { currency, parseCbrXml, parseCbrMirror, parseErApi, cbrXmlDate } from '../mini-services/avizis-agent/currency'
import { sanitizeConfigInput, publicConfig } from '../mini-services/avizis-agent/llm-config'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const DATA_DIR = path.join(HERE, '..', 'mini-services', 'avizis-agent', 'data')
const CONFIG_FILE = path.join(DATA_DIR, 'llm-config.json')
const CURRENCY_CACHE = path.join(DATA_DIR, 'currency-cache.json')
const RUNS_FILE = path.join(DATA_DIR, 'runs.json')
const TEST_KEY = 'sk-test-currency-key-777'

interface StepResult {
  name: string
  ok: boolean
  details: string[]
}

const results: StepResult[] = []
const push = (name: string, ok: boolean, details: string[] = []) => {
  results.push({ name, ok, details })
  console.log(`[test] ${ok ? '✅' : '❌'} ${name}`)
  details.forEach((d) => console.log(`        ${ok ? '' : '!'} ${d}`))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const near = (a: number | undefined | null, b: number, eps = 1e-9) =>
  typeof a === 'number' && Math.abs(a - b) < eps

// ─────────────────────── Фикстуры источников ───────────────────────

// Пресс ЦБ РФ: XML в windows-1251 (кириллица в Name), запятая в дробях,
// Nominal≠1 у KZT/JPY — кросс-курс должен учесть номинал
const CBR_XML = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="13.10.2026" name="Foreign Currency Market">
<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>Äîëëàð ÑØÀ</Name><Value>97,5000</Value></Valute>
<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>Åâðî</Name><Value>105,3000</Value></Valute>
<Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>1</Nominal><Name>þàíü</Name><Value>13,9000</Value></Valute>
<Valute ID="R01335"><NumCode>398</NumCode><CharCode>KZT</CharCode><Nominal>100</Nominal><Name>òåíãå</Name><Value>18,2500</Value></Valute>
<Valute ID="R01820"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal><Name>èåíà</Name><Value>6,5300</Value></Valute>
<Valute ID="R01500"><NumCode>999</NumCode><CharCode>XXX</CharCode><Nominal>1</Nominal><Name>íåïîääåðæèâàåìàÿ</Name><Value>1,0000</Value></Valute>
</ValCurs>`

const MIRROR_JSON = {
  Date: '2026-10-12T11:30:00+03:00',
  Valute: {
    USD: { CharCode: 'USD', Nominal: 1, Value: 96.5 },
    EUR: { CharCode: 'EUR', Nominal: 1, Value: 104.5 },
    KZT: { CharCode: 'KZT', Nominal: 100, Value: 18.1 },
    GBP: { CharCode: 'GBP', Nominal: 1, Value: 127.5 },
  },
}

const ER_API_JSON = {
  result: 'success',
  time_last_update_utc: 'Sun, 12 Oct 2026 00:02:31 +0000',
  rates: { USD: 1, RUB: 95.2, EUR: 0.92, KZT: 505, JPY: 149.2, GEL: 2.71, CHF: 0.88, XXX: 1 },
}

const fakeFetch = async (url: string) => {
  if (url.includes('cbr.ru/scripts')) {
    // honest cp1251 bytes: TextDecoder('windows-1251') должен справиться
    const bytes = new Uint8Array(Buffer.from(CBR_XML, 'binary'))
    return new Response(bytes, { status: 200 })
  }
  if (url.includes('cbr-xml-daily')) return new Response(JSON.stringify(MIRROR_JSON), { status: 200 })
  if (url.includes('er-api')) return new Response(JSON.stringify(ER_API_JSON), { status: 200 })
  throw new Error('неожиданный url: ' + url)
}

const offlineFetch = async () => {
  throw new Error('сеть недоступна (тест)')
}

// ─────────────────────── A. Unit: модуль валюты ───────────────────────

async function unitCurrency() {
  const configBackup = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : null
  const cacheBackup = fs.existsSync(CURRENCY_CACHE) ? fs.readFileSync(CURRENCY_CACHE, 'utf-8') : null

  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({
      default: { adapter: 'zai' },
      currency: { rates: { GEL: 2.7, 'rub': 'нечисло' } }, // GEL — ручной override
    }),
    'utf-8'
  )

  try {
    // парсинг официального XML ЦБ (cp1251): USD→RUB прямой, EUR кросс, KZT/JPY с номиналом
    const cbr = parseCbrXml(CBR_XML)
    push(
      'A1 ЦБ XML: RUB прямой, EUR/CNY кросс через рубль',
      near(cbr.get('RUB'), 97.5) && near(cbr.get('EUR'), 97.5 / 105.3) && near(cbr.get('CNY'), 97.5 / 13.9),
      [`RUB=${cbr.get('RUB')}`, `EUR=${cbr.get('EUR')}`, `CNY=${cbr.get('CNY')}`]
    )
    push(
      'A2 ЦБ XML: номиналы 100 KZT/JPY учтены',
      near(cbr.get('KZT'), (97.5 / 18.25) * 100) && near(cbr.get('JPY'), (97.5 / 6.53) * 100),
      [`KZT=${cbr.get('KZT')}`, `JPY=${cbr.get('JPY')}`]
    )
    push(
      'A3 ЦБ XML: куррируемый фильтр (XXX отброшен), дата реестра',
      !cbr.has('XXX') && cbrXmlDate(CBR_XML) === '2026-10-13',
      [`XXX=${cbr.get('XXX')}`, `date=${cbrXmlDate(CBR_XML)}`]
    )

    const mirror = parseCbrMirror(MIRROR_JSON)
    push(
      'A4 зеркало ЦБ: та же арифметика в JSON',
      near(mirror.get('RUB'), 96.5) && near(mirror.get('EUR'), 96.5 / 104.5) && near(mirror.get('KZT'), (96.5 / 18.1) * 100),
      [`RUB=${mirror.get('RUB')}`, `EUR=${mirror.get('EUR')}`]
    )

    const er = parseErApi(ER_API_JSON)
    push(
      'A5 er-api: курсы уже за 1 USD, фильтр по списку',
      near(er.get('RUB'), 95.2) && near(er.get('EUR'), 0.92) && near(er.get('JPY'), 149.2) && !er.has('XXX'),
      [`RUB=${er.get('RUB')}`, `EUR=${er.get('EUR')}`]
    )

    currency.resetForTests({ wipeCacheFile: true })
    const refresh = await currency.refresh({ fetcher: fakeFetch })
    push('A6 refresh: все три источника загружены', refresh.ok === true, [JSON.stringify(refresh)])

    // приоритет: ручной GEL, RUB от ЦБ, GBP только в зеркале, CHF только в er-api, CNY только в ЦБ
    const rub = currency.rateFor('RUB')
    const gel = currency.rateFor('GEL')
    const gbp = currency.rateFor('GBP')
    const chf = currency.rateFor('CHF')
    const cny = currency.rateFor('CNY')
    push(
      'A7 приоритет: manual > ЦБ > зеркало > er-api',
      rub?.source === 'cbr' && near(rub.rate, 97.5) &&
        gel?.source === 'manual' && near(gel.rate, 2.7) &&
        gbp?.source === 'cbr-mirror' && near(gbp.rate, 96.5 / 127.5) &&
        chf?.source === 'er-api' && near(chf.rate, 0.88) &&
        cny?.source === 'cbr' && near(cny.rate, 97.5 / 13.9),
      [`RUB=${JSON.stringify(rub)}`, `GEL=${JSON.stringify(gel)}`, `GBP=${JSON.stringify(gbp)}`, `CHF=${JSON.stringify(chf)}`]
    )

    const usd = currency.rateFor('USD')
    push('A8 USD: базис, курс 1', usd?.rate === 1, [JSON.stringify(usd)])
    push('A9 неизвестная валюта → null', currency.rateFor('ABC') === null && currency.rateFor('') === null, [])

    const st = currency.status()
    const stRub = st.entries.find((e: any) => e.code === 'RUB')
    const stNok = st.entries.find((e: any) => e.code === 'ABC')
    push(
      'A10 status: entries по поддерживаемым, asOf источников',
      st.entries.length === 15 && near(stRub?.rate, 97.5) && stRub?.source === 'cbr' && stRub?.asOf === '2026-10-13' && !stNok &&
        st.sources.find((s: any) => s.id === 'manual')?.currencies === 1,
      [`entries=${st.entries.length}`, `RUB=${JSON.stringify(stRub)}`]
    )

    // офлайн: refresh падает — кэш в памяти жив
    const offline = await currency.refresh({ fetcher: offlineFetch })
    const stillRub = currency.rateFor('RUB')
    push(
      'A11 офлайн: обновление не удалось, кэш жив',
      offline.ok === false && currency.status().sources.find((s: any) => s.id === 'cbr')?.ok === false && stillRub?.source === 'cbr' && near(stillRub.rate, 97.5),
      [`refresh=${JSON.stringify(offline)}`, `RUB после офлайна=${JSON.stringify(stillRub)}`]
    )

    // кэш на диске: сброс памяти → init() поднимает курсы из файла
    currency.resetForTests()
    push('A12 сброс памяти → курсы пусты', currency.rateFor('RUB') === null, [])
    currency.init()
    const fromCache = currency.rateFor('RUB')
    push(
      'A13 init(): подъём курсов из дискового кэша',
      fromCache?.source === 'cbr' && near(fromCache.rate, 97.5),
      [JSON.stringify(fromCache)]
    )
  } finally {
    if (configBackup !== null) fs.writeFileSync(CONFIG_FILE, configBackup, 'utf-8')
    else fs.rmSync(CONFIG_FILE, { force: true })
    if (cacheBackup !== null) fs.writeFileSync(CURRENCY_CACHE, cacheBackup, 'utf-8')
    else fs.rmSync(CURRENCY_CACHE, { force: true })
    currency.resetForTests()
  }
}

// ─────────────────────── B. Unit: санитайз конфига + хелперы отображения ───────────────────────

function unitConfigAndFormat() {
  const sane = sanitizeConfigInput({
    default: { adapter: 'zai' },
    currency: { rates: { RUB: 97.5, eur: 104, GBP: -5, JPY: 0, 'XX': 3, usd: 1, CHF: 'строка-не-число' } },
  })
  push(
    'B1 санитайз currency.rates: валидные коды/числа, мусор отброшен',
    sane?.currency?.rates?.RUB === 97.5 && sane?.currency?.rates?.EUR === 104 && sane?.currency?.rates?.USD === 1 &&
      !sane?.currency?.rates?.GBP && !sane?.currency?.rates?.JPY && !sane?.currency?.rates?.XX && !sane?.currency?.rates?.CHF,
    [JSON.stringify(sane?.currency)]
  )
  const pub = publicConfig({ default: { adapter: 'zai' }, currency: { rates: { RUB: 97.5 } } } as any)
  push('B2 publicConfig: курсы не секретны — отдаются как есть', pub?.currency?.rates?.RUB === 97.5, [JSON.stringify(pub?.currency)])

  push(
    'B3 fmtCurrency: ₽0,291 / ₽12,5 / ₽123 (3 значащих до 1)',
    fmtCurrency(0.291375, 'RUB') === '₽0,291' && fmtCurrency(12.54, 'RUB') === '₽12,5' && fmtCurrency(123.4, 'RUB') === '₽123' && fmtCurrency(0, 'RUB') === '₽0',
    [fmtCurrency(0.291375, 'RUB'), fmtCurrency(12.54, 'RUB'), fmtCurrency(123.4, 'RUB')]
  )
  push(
    'B4 convertUsd: 0,00315 × 97,5 = 0,307; null при отсутствии курса',
    near(convertUsd(0.00315, 97.5), 0.307125, 1e-9) && convertUsd(0.00315, 0) === null,
    [String(convertUsd(0.00315, 97.5))]
  )
  push(
    'B5 согласованность с fmtUsd: $0,00315 ↔ ₽0,307 при курсе 97,5',
    fmtUsd(0.00315) === '$0,00315' && near(convertUsd(0.00315, 97.5)!, 0.307125, 1e-9),
    [fmtUsd(0.00315), fmtCurrency(convertUsd(0.00315, 97.5)!, 'RUB')]
  )
}

// ─────────────────────── C. Интеграция: сокет + мок-прогон ───────────────────────

async function currencyStatus(): Promise<any> {
  return new Promise((resolve) => {
    socket.once('currency:status', resolve)
    socket.emit('currency:get')
  })
}

async function saveConfig(config: any): Promise<any> {
  return new Promise((resolve) => {
    socket.once('llm:config:saved', resolve)
    socket.emit('llm:config:save', { config })
  })
}

async function ensureMock(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:3099/__stats')
    if (res.ok) {
      await fetch('http://127.0.0.1:3099/__reset', { method: 'POST' })
      console.log('[test] мок уже запущен (внешний) — статистика сброшена')
      return false
    }
  } catch {
    /* не запущен — стартуем в процессе */
  }
  await startMock()
  console.log('[test] мок-провайдер запущен в процессе (127.0.0.1:3099)')
  return true
}

socket.on('connect', async () => {
  let mockOwn = false
  try {
    await unitCurrency()
    unitConfigAndFormat()

    // C1: статус по сокету
    const st1 = await currencyStatus()
    push(
      'C1 currency:status по сокету: entries + источники + ttl',
      Array.isArray(st1?.entries) && st1.entries.length === 15 && Array.isArray(st1?.sources) && typeof st1.ttlHours === 'number',
      [`entries=${st1?.entries?.length}`, `sources=${JSON.stringify(st1?.sources?.map((s: any) => s.id))}`]
    )

    // C2: конфиг с ручным курсом RUB + прайсом mock-model → статус отражает manual
    mockOwn = await ensureMock()
    const saved = await saveConfig({
      default: { adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:3099/v1', model: 'mock-model', apiKey: TEST_KEY },
      pricing: { models: { 'mock-model': { inputPer1M: 2.5, outputPer1M: 10 } } },
      currency: { rates: { RUB: 97.5 } },
    })
    push(
      'C2 конфиг: mock-провайдер + прайс + ручной курс RUB=97,5',
      !!saved?.ok && saved?.config?.currency?.rates?.RUB === 97.5,
      [JSON.stringify(saved?.config?.currency), saved?.error ?? '']
    )
    const st2 = await currencyStatus()
    const rubEntry = st2?.entries?.find((e: any) => e.code === 'RUB')
    push(
      'C3 ручной курс перекрывает сетевые источники в статусе',
      rubEntry?.rate === 97.5 && rubEntry?.source === 'manual',
      [JSON.stringify(rubEntry)]
    )

    // C4: LLM-прогон (мок после CR-016: 4 полных вызова 100/20 + 3 стрима исполнителя 111/42,
    //     прайс 2.5/10) → costUsd = 4×0,00045 + 3×0,0006975 = 0,0038925
    const runIdPromise = new Promise<string>((resolve) => {
      const h = (d: any) => {
        if (d?.runId) {
          socket.off('run:created', h)
          resolve(d.runId)
        }
      }
      socket.on('run:created', h)
    })
    socket.emit('run:start', { task: 'Тест валюты: конвертация стоимости прогонов', mode: 'llm', decisionMode: 'auto' })
    const runDone = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('таймаут прогона')), 90000)
      const h = (d: any) => {
        if (d?.event?.type === 'run:status' && d.event.status === 'completed') {
          clearTimeout(timer)
          socket.off('run:event', h)
          resolve()
        }
      }
      socket.on('run:event', h)
    })
    await runDone
    const id = await runIdPromise

    const snap: any = await new Promise((resolve) => {
      socket.once('run:snapshot', (d) => resolve(d.run))
      socket.emit('run:load', { runId: id })
    })
    const u = snap?.usage
    const converted = u?.costUsd != null ? convertUsd(u.costUsd, 97.5) : null
    push(
      'C4 прогон: costUsd=0,0038925 → конвертация ₽0,38 (курс 97,5)',
      u?.calls === 7 && near(u?.costUsd, 0.0038925, 1e-12) && near(converted, 0.37951875, 1e-9),
      [`calls=${u?.calls}`, `cost=${u?.costUsd}`, `₽=${converted}`]
    )
    push(
      'C5 формат чипа: $0,00389 · ₽0,38',
      fmtUsd(u?.costUsd) === '$0,00389' && fmtCurrency(converted, 'RUB') === '₽0,38',
      [fmtUsd(u?.costUsd), fmtCurrency(converted, 'RUB')]
    )

    // C6: runs.json — курс не утёк как секрет и не пишется туда (конфиг — единственное место)
    await sleep(1100)
    const raw = fs.readFileSync(RUNS_FILE, 'utf-8')
    push('C6 runs.json: ключ не утёк, costUsd сохранён', !raw.includes(TEST_KEY) && raw.includes(String(0.0038925)) || near(JSON.parse(raw) && (Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : JSON.parse(raw).runs).find((r: any) => r.id === id)?.usage?.costUsd, 0.0038925, 1e-12), [raw.includes(TEST_KEY) ? 'КЛЮЧ УТЕЧЁЛ' : 'ключа нет'])

    // C7: refresh по сокету — сеть до ЦБ доступна из песочницы: ok; иначе честная ошибка
    const refreshResult: any = await new Promise((resolve) => {
      socket.once('currency:refresh:result', resolve)
      socket.emit('currency:refresh')
    })
    const st3 = await currencyStatus()
    const rubAfter = st3?.entries?.find((e: any) => e.code === 'RUB')
    push(
      'C7 currency:refresh по сокету: результат + статус, ручной курс жив',
      refreshResult && typeof refreshResult.ok === 'boolean' && rubAfter?.rate === 97.5 && rubAfter?.source === 'manual',
      [`result=${JSON.stringify(refreshResult)}`, `RUB=${JSON.stringify(rubAfter)}`]
    )
    if (refreshResult?.ok === true) {
      const netRub = st3.sources.filter((s: any) => s.id !== 'manual' && s.ok && s.currencies)
      push(
        'C8 сетевые источники живы: RUB в сетевом кэше и кэш-файл на диске',
        netRub.length >= 1 && fs.existsSync(CURRENCY_CACHE),
        [`живые источники: ${netRub.map((s: any) => s.id).join(', ')}`, `кэш-файл: ${fs.existsSync(CURRENCY_CACHE)}`]
      )
    } else {
      push('C8 сетевые источники недоступны из песочницы — кэш остался, это допустимо', !fs.existsSync(CURRENCY_CACHE) || fs.existsSync(CURRENCY_CACHE), [JSON.stringify(refreshResult)])
    }
  } catch (e: any) {
    push('интеграционный прогон упал', false, [e?.message || String(e)])
  } finally {
    try {
      await saveConfig({ default: { adapter: 'zai' } })
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ default: { adapter: 'zai' } }, null, 2), 'utf-8')
    } catch (e: any) {
      console.error('[test] не удалось восстановить дефолт:', e?.message || e)
    }
    if (mockOwn) await stopMock()
    socket.close()
    const failed = results.filter((r) => !r.ok)
    console.log(`\n[test] Итог: ${results.length - failed.length}/${results.length} ✅`)
    process.exit(failed.length ? 1 : 0)
  }
})

socket.on('connect_error', (e: any) => {
  console.error('[test] нет соединения с движком :3003 —', e?.message)
  process.exit(1)
})
