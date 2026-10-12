// Тест BYOK-MVP (CR-007): конфигурация openai-compatible через мок-провайдер :3099,
// полный LLM-прогон через мок, provenance (snapshot.llm / node.llm), маскирование
// ключа, права файла конфига, отсутствие ключа в артефактах прогона (runs.json).
// Паттерн — как test-tacg-clarity.ts: socket.io-клиент напрямую к http://127.0.0.1:3003.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

const HERE = (import.meta as any).dir as string
const CONFIG_FILE = path.join(HERE, '..', 'mini-services', 'tacg-agent', 'data', 'llm-config.json')
const RUNS_FILE = path.join(HERE, '..', 'mini-services', 'tacg-agent', 'data', 'runs.json')
const TEST_KEY = 'sk-test-byok-key-4242'
const EXPECTED_MASK = 'sk-…4242'

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

function waitFor(predicate: (ev: any) => boolean, timeoutMs = 60000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('таймаут ожидания события')), timeoutMs)
    const handler = (data: any) => {
      if (!predicate(data)) return
      clearTimeout(timer)
      socket.off('run:event', handler)
      resolve(data.event)
    }
    socket.on('run:event', handler)
  })
}

async function loadSnapshot(runId: string): Promise<any> {
  return new Promise((resolve) => {
    socket.once('run:snapshot', (d) => resolve(d.run))
    socket.emit('run:load', { runId })
  })
}

async function saveConfig(config: any): Promise<any> {
  return new Promise((resolve) => {
    socket.once('llm:config:saved', resolve)
    socket.emit('llm:config:save', { config })
  })
}

async function getConfig(): Promise<any> {
  return new Promise((resolve) => {
    socket.once('llm:config', resolve)
    socket.emit('llm:config:get')
  })
}

async function ensureMock(): Promise<boolean> {
  // мок мог остаться с E2E — переиспользуем (со сбросом статистики)
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

async function restoreDefault() {
  try {
    const r = await saveConfig({ default: { adapter: 'zai' } })
    console.log(`[test] восстановление дефолта zai: ${r?.ok ? 'ок' : `ошибка: ${r?.error}`}`)
  } catch (e: any) {
    console.error('[test] не удалось восстановить дефолт:', e?.message || e)
  }
}

socket.on('connect', async () => {
  let mockOwn = false
  try {
    // 1. мок-провайдер
    mockOwn = await ensureMock()
    push('мок-провайдер доступен на 127.0.0.1:3099', true)

    // 2. сохранение openai-compatible-конфига (с валидацией пробой)
    const saved = await saveConfig({
      default: {
        adapter: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:3099/v1',
        model: 'mock-model',
        apiKey: TEST_KEY,
      },
    })
    push(
      'конфиг openai-compatible сохранён (валидация пробой пройдена)',
      saved?.ok === true && saved?.config?.default?.adapter === 'openai-compatible',
      [`result=${JSON.stringify(saved).slice(0, 160)}`]
    )

    // 2b. нюанс: повторное сохранение без ключа (тот же провайдер) сохраняет старый ключ
    const resaved = await saveConfig({
      default: {
        adapter: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:3099/v1',
        model: 'mock-model',
      },
    })
    const fileAfterReSave = fs.readFileSync(CONFIG_FILE, 'utf-8')
    push(
      'повторное сохранение без ключа сохраняет прежний ключ (маска-плейсхолдер в UI)',
      resaved?.ok === true && fileAfterReSave.includes(TEST_KEY),
      [`result.ok=${resaved?.ok} ключ в файле=${fileAfterReSave.includes(TEST_KEY)}`]
    )

    // 3. чтение конфига отдаёт маску, не ключ
    const cfg = await getConfig()
    const masked = cfg?.config?.default?.apiKey
    push(
      `llm:config:get отдаёт маску ключа (${EXPECTED_MASK}), не полный ключ`,
      masked === EXPECTED_MASK,
      [`apiKey=${masked}`]
    )
    const cfgRaw = JSON.stringify(cfg)
    push('ответ llm:config не содержит полный ключ', !cfgRaw.includes(TEST_KEY), [`длина ответа=${cfgRaw.length}`])

    // 4. файл конфига: полный ключ + права 600
    const fileRaw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    const fileMode = fs.statSync(CONFIG_FILE).mode
    push(
      'data/llm-config.json содержит ключ, права 600',
      fileRaw.includes(TEST_KEY) && (fileMode & 0o777) === 0o600,
      [`права=${(fileMode & 0o777).toString(8)} размер=${fileRaw.length}`]
    )

    // 5. LLM-прогон через мок до завершения
    const runId = await new Promise<string>((resolve) => {
      socket.once('run:created', (d) => resolve(d.runId))
      socket.emit('run:start', { task: 'Тест BYOK', mode: 'llm', decisionMode: 'auto' })
    })
    const summary = await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary', 90000)
    push('LLM-прогон через мок-провайдер завершён', !!summary, [`summary="${String(summary?.summary).slice(0, 90)}…"`])

    // 6. provenance: снапшот + узлы
    const snap = await loadSnapshot(runId)
    const llm = snap?.llm ?? {}
    const rolesOk = ['planner', 'executor', 'supervisor', 'decider'].every(
      (r) => llm[r]?.adapter === 'openai-compatible' && llm[r]?.model === 'mock-model'
    )
    push(
      'snapshot.llm: все 4 роли — openai-compatible · mock-model',
      rolesOk,
      [`llm=${JSON.stringify(llm)}`]
    )
    const doneNodes = (snap?.nodes ?? []).filter((n: any) => n.status === 'done')
    const nodesWithLlm = doneNodes.filter((n: any) => n?.llm)
    const nodeLlmOk =
      doneNodes.length >= 3 &&
      nodesWithLlm.length === doneNodes.length &&
      nodesWithLlm.every((n: any) => n.llm?.adapter === 'openai-compatible' && n.llm?.model === 'mock-model')
    push(
      'выполненные LLM-узлы имеют node.llm (adapter+model, без ключа)',
      nodeLlmOk,
      [
        `done=${doneNodes.length} с node.llm=${nodesWithLlm.length}`,
        `пример: ${doneNodes.map((n: any) => `${n.id}(${n.llm ? n.llm.adapter + '/' + n.llm.model : '—'})`).join(' ')}`,
      ]
    )
    const snapRaw = JSON.stringify(snap)
    push('снапшот прогона не содержит ключ', !snapRaw.includes(TEST_KEY))

    // 7. мок получил запросы с нашим Bearer-ключом и моделью
    const stats: any = await (await fetch('http://127.0.0.1:3099/__stats')).json()
    const withKey = (stats?.requests ?? []).filter((r: any) => r.auth === `Bearer ${TEST_KEY}`)
    push(
      'мок получил запросы с Authorization Bearer и model=mock-model',
      withKey.length > 0 && withKey.every((r: any) => r.model === 'mock-model'),
      [`запросов всего=${(stats?.requests ?? []).length}, с ключом=${withKey.length}`]
    )

    // 8. БЕЗОПАСНОСТЬ: runs.json не содержит ключ (ждём debounce-flush стора)
    await sleep(1500)
    const runsRaw = fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf-8') : ''
    push('data/runs.json не содержит ключ API', !runsRaw.includes(TEST_KEY), [`размер runs.json=${runsRaw.length}`])
  } catch (e: any) {
    push('выполнение сценария без ошибок', false, [String(e?.message || e)])
  } finally {
    // 9. восстановить дефолт zai — важно для test-tacg-llm-auto; ключ сбрасывается
    await restoreDefault()
    try {
      const restoredRaw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      push(
        'дефолт zai восстановлен, тестовый ключ из файла удалён',
        restoredRaw.includes('"zai"') && !restoredRaw.includes(TEST_KEY),
        [`файл=${restoredRaw.trim()}`]
      )
    } catch {
      push('дефолт zai восстановлен, тестовый ключ из файла удалён', false, ['файл не читается'])
    }
    // 10. остановить мок (если стартовали сами)
    if (mockOwn) await stopMock()
    socket.disconnect()
    const failed = results.filter((r) => !r.ok)
    console.log('\n════════════ ИТОГ ════════════')
    console.log(`Пройдено: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
      console.log('Провалено:')
      failed.forEach((f) => console.log(`  ❌ ${f.name}`))
      process.exitCode = 1
    } else {
      console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ✅')
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
})

socket.on('connect_error', (e: any) => {
  console.error('[test] движок недоступен:', e?.message)
  process.exit(1)
})
