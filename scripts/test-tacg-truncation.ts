// Тест аудита усечений (CR-008 / ADR-013): юнит — чистая функция sanitizePlanData
// на сверхлимитной фикстуре (15 узлов, 6 вариантов × 5 шагов, 7 зависимостей,
// ссылки вперёд/необъявленные, «развилка» с 1 валидным вариантом) и на компактном
// плане (notes пусты); интеграция — полный LLM-прогон через мок-провайдер
// (MOCK_MODE=oversized) с проверкой записей kind='limits' в журнале прогона,
// порядка записей, усечённого графа и отсутствия ключа в артефактах.
import { io } from 'socket.io-client'
import fs from 'node:fs'
import path from 'node:path'
import { start as startMock, stop as stopMock } from './mock-openai'
import { sanitizePlanData } from '../mini-services/tacg-agent/plan-sanitizer'

const HERE = (import.meta as any).dir as string
const CONFIG_FILE = path.join(HERE, '..', 'mini-services', 'tacg-agent', 'data', 'llm-config.json')
const RUNS_FILE = path.join(HERE, '..', 'mini-services', 'tacg-agent', 'data', 'runs.json')
const TEST_KEY = 'sk-test-trunc-key-777'
const MOCK_URL = 'http://127.0.0.1:3099/v1'

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

// ─────────────────────── A. Юнит: sanitizePlanData ───────────────────────

/** Сверхлимитная фикстура: покрывает все 6 типов усечений (a–f) */
function oversizedFixture(): any {
  const step = (id: string, deps: string[], title: string) => ({
    id,
    title,
    description: `Описание ${id} тестовой фикстуры.`,
    dependsOn: deps,
  })
  const options = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => ({
    id: letter,
    label: `Вариант ${letter.toUpperCase()}`,
    rationale: `Обоснование варианта ${letter}.`,
    steps: Array.from({ length: 5 }, (_, k) => ({
      id: `b${letter}${k + 1}`,
      title: `Шаг ветки ${letter}${k + 1}`,
      description: 'Шаг ветки фикстуры.',
    })),
  }))
  return {
    certainty: 0.42,
    nodes: [
      step('n1', [], 'Шаг n1'),
      step('n2', ['n1'], 'Шаг n2'),
      step('n3', ['n2'], 'Шаг n3'),
      {
        id: 'dec1',
        title: 'Решение: сверхлимитная развилка',
        description: '6 вариантов по 5 шагов.',
        dependsOn: ['n3'],
        decision: {
          question: 'Какой путь выбрать?',
          domain: 'strategy',
          selection: 'single',
          certaintyAfter: 0.8,
          options,
        },
      },
      step('n4', ['n3'], 'Шаг n4'),
      step('n5', ['n4'], 'Шаг n5'),
      // 7 валидных зависимостей > лимита 5 → усечение c)
      step('n6', ['n1', 'n2', 'n3', 'n4', 'n5', 'dec1', 'ba1'], 'Шаг n6'),
      step('n7', ['n6'], 'Шаг n7'),
      // ссылки вперёд (n12) и необъявленные (nq, ba99) → усечение b)
      step('n8', ['n7', 'n12', 'nq', 'ba99'], 'Шаг n8'),
      {
        id: 'dec2',
        title: 'Решение: единственный вариант',
        description: 'Развилка с 1 валидным вариантом и одним пустым.',
        dependsOn: ['n8'],
        decision: {
          question: 'Подтвердить продолжение?',
          domain: 'scope',
          selection: 'single',
          options: [
            null,
            {
              id: 'a',
              label: 'Единственный вариант',
              rationale: 'Других нет.',
              steps: [{ id: 'bza1', title: 'Шаг единственной ветки', description: '—' }],
            },
          ],
        },
      },
      step('n9', ['n8'], 'Шаг n9'),
      step('n10', ['n9'], 'Шаг n10'),
      step('n11', ['n10'], 'Шаг n11'),
      step('n12', ['n11'], 'Шаг n12'),
      step('n13', ['n12'], 'Шаг n13'),
    ],
  }
}

/** Компактный валидный план: усечений нет, notes пусты */
function compactFixture(): any {
  return {
    certainty: 0.7,
    nodes: [
      { id: 'n1', title: 'Сбор данных', description: '—', dependsOn: [] },
      {
        id: 'dec1',
        title: 'Решение: стратегия',
        description: '—',
        dependsOn: ['n1'],
        decision: {
          question: 'Какую стратегию применить?',
          domain: 'strategy',
          selection: 'single',
          options: [
            {
              id: 'a',
              label: 'Быстрая',
              rationale: '—',
              steps: [
                { id: 'ba1', title: 'Шаг A1', description: '—' },
                { id: 'ba2', title: 'Шаг A2', description: '—' },
              ],
            },
            {
              id: 'b',
              label: 'Глубокая',
              rationale: '—',
              steps: [
                { id: 'bb1', title: 'Шаг B1', description: '—' },
                { id: 'bb2', title: 'Шаг B2', description: '—' },
              ],
            },
          ],
        },
      },
      { id: 'nfin', title: 'Итог', description: '—', dependsOn: ['ba2', 'bb2'] },
    ],
  }
}

function runUnitTests() {
  console.log('\n── A. Юнит: sanitizePlanData ──')
  const res = sanitizePlanData(oversizedFixture())
  const msgs = res.notes.map((n) => n.message)

  // (a) усечение плана 15 → 12 с перечислением отброшенных
  push(
    '(a) усечение узлов плана: 15 → 12, отброшенные перечислены с id и заголовком',
    msgs.some((m) => m.includes('LLM вернул 15 узлов — взяты первые 12') && m.includes('n11 «Шаг n11»') && m.includes('n13 «Шаг n13»')),
    [msgs.find((m) => m.includes('15 узлов')) ?? '—']
  )

  // (b) ссылки на необъявленные узлы
  push(
    '(b) неизвестные dependsOn: у n8 отброшены n12, nq, ba99',
    msgs.some((m) => m.includes('у узла n8 отброшены ссылки на необъявленные узлы: n12, nq, ba99')),
    [msgs.find((m) => m.includes('необъявленные')) ?? '—']
  )

  // (c) зависимостей 7 → 5
  push(
    '(c) усечение зависимостей: у n6 7 → 5 (отброшены dec1, ba1)',
    msgs.some((m) => m.includes('у узла n6 зависимостей 7 — оставлены первые 5 (отброшены: dec1, ba1)')),
    [msgs.find((m) => m.includes('зависимостей 7')) ?? '—']
  )

  // (d) варианты развилки 6 → 4
  push(
    '(d) усечение вариантов: у dec1 6 → 4',
    msgs.some((m) => m.includes('у развилки dec1 вариантов 6 — оставлены первые 4')),
    [msgs.find((m) => m.includes('вариантов 6')) ?? '—']
  )

  // (e) шаги веток 5 → 3 (по каждой из 4 оставшихся веток)
  const eMsgs = msgs.filter((m) => m.includes('шагов 5 — оставлены первые 3'))
  push(
    '(e) усечение шагов веток: 5 → 3 во всех 4 ветках (a, b, c, d)',
    eMsgs.length === 4 && ['a', 'b', 'c', 'd'].every((o) => eMsgs.some((m) => m.includes(`у ветки ${o} развилки dec1`))),
    eMsgs
  )

  // (f) деградация «развилки» с 1 валидным вариантом (+ пустой учтён)
  push(
    '(f) деградация развилки: dec2 меньше 2 валидных вариантов (пустых: 1)',
    msgs.some((m) => m.includes('у узла dec2 меньше 2 валидных вариантов (пустых/битых вариантов: 1) — развилка деградировала в обычный шаг')),
    [msgs.find((m) => m.includes('деградировала')) ?? '—']
  )

  // структура усечённого графа
  const nodes = res.nodes ?? []
  const dec1 = nodes.find((n) => n.id === 'dec1')
  const dec2 = nodes.find((n) => n.id === 'dec2')
  const n6 = nodes.find((n) => n.id === 'n6')
  const n8 = nodes.find((n) => n.id === 'n8')
  push(
    'граф усечён: 12 top-level + 12 узлов веток = 24; n11/n12/n13 отсутствуют',
    nodes.length === 24 && !nodes.some((n) => ['n11', 'n12', 'n13'].includes(n.id)) && nodes.filter((n) => !n.branchOf).length === 12,
    [`узлов=${nodes.length}, top-level=${nodes.filter((n) => !n.branchOf).length}`]
  )
  push(
    'dec1: 4 варианта по 3 шага (nextSteps), id a–d',
    !!dec1?.decision && dec1.decision.options.length === 4 && dec1.decision.options.every((o, i) => o.id === ['a', 'b', 'c', 'd'][i] && o.nextSteps.length === 3),
    [`options=${dec1?.decision?.options.length}, nextSteps=${dec1?.decision?.options.map((o) => o.nextSteps.length).join(',')}`]
  )
  push(
    'n6 зависит от первых 5 (n1–n5); n8 — только от n7',
    n6?.dependsOn.join(',') === 'n1,n2,n3,n4,n5' && n8?.dependsOn.join(',') === 'n7',
    [`n6=[${n6?.dependsOn.join(',')}], n8=[${n8?.dependsOn.join(',')}]`]
  )
  push(
    'dec2 деградировала в обычный шаг (kind=step, без decision)',
    !!dec2 && dec2.kind !== 'decision' && !dec2.decision && !nodes.some((n) => n.branchOf?.decisionId === 'dec2'),
    [`kind=${dec2?.kind}, decision=${!!dec2?.decision}`]
  )

  // certainty распарсен и клампится
  push('certainty фикстуры распарсен (0.42) и возвращается', res.certainty === 0.42, [`certainty=${res.certainty}`])
  const clamped = sanitizePlanData({ certainty: 1.7, nodes: compactFixture().nodes })
  push('certainty клампится сверху (1.7 → 1)', clamped.certainty === 1, [`certainty=${clamped.certainty}`])

  // детерминированность заметок (два прогона → идентичные сообщения)
  const second = sanitizePlanData(oversizedFixture()).notes.map((n) => n.message)
  push('заметки детерминированы: повторный прогон даёт идентичные сообщения', JSON.stringify(msgs) === JSON.stringify(second), [`заметок=${msgs.length}`])

  // компактный валидный план: notes пусты
  const compact = sanitizePlanData(compactFixture())
  push(
    'компактный валидный план: notes = [] и граф не отброшен',
    compact.notes.length === 0 && !!compact.nodes && compact.nodes.length === 7,
    [`notes=${compact.notes.length}, узлов=${compact.nodes?.length}`]
  )

  // неразборчивый план: nodes = null
  push('план без nodes: nodes = null', sanitizePlanData({ certainty: 0.5 }).nodes === null)
}

// ─────────────────────── B. Интеграция: прогон через мок ───────────────────────

const socket = io('http://127.0.0.1:3003', { path: '/', transports: ['websocket'] })

function waitFor(predicate: (ev: any) => boolean, timeoutMs = 90000): Promise<any> {
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

/** Мок: свой (in-process, MOCK_MODE=oversized) или внешний (проверяется режим oversized) */
async function ensureMock(): Promise<'own' | 'external'> {
  const alive = await fetch('http://127.0.0.1:3099/__stats')
    .then((r) => r.ok)
    .catch(() => false)
  if (alive) {
    const probe = await fetch(`${MOCK_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mock-model',
        messages: [
          { role: 'system', content: 'Ты — модуль планирования ИИ-агента.' },
          { role: 'user', content: 'probe' },
        ],
      }),
    }).then((r) => r.json())
    const content = (probe as any)?.choices?.[0]?.message?.content ?? ''
    if (String(content).includes('oversized-развилка')) {
      await fetch('http://127.0.0.1:3099/__reset', { method: 'POST' })
      console.log('[test] внешний мок в режиме oversized — статистика сброшена')
      return 'external'
    }
    throw new Error('внешний мок запущен НЕ в режиме oversized — остановите его и перезапустите тест')
  }
  process.env.MOCK_MODE = 'oversized'
  await startMock()
  console.log('[test] мок-провайдер запущен в процессе (127.0.0.1:3099, MOCK_MODE=oversized)')
  return 'own'
}

async function restoreDefault() {
  try {
    const r = await saveConfig({ default: { adapter: 'zai' } })
    console.log(`[test] восстановление дефолта zai: ${r?.ok ? 'ок' : `ошибка: ${r?.error}`}`)
  } catch (e: any) {
    console.error('[test] не удалось восстановить дефолт:', e?.message || e)
  }
}

async function runIntegrationTests(): Promise<'own' | 'external' | null> {
  console.log('\n── B. Интеграция: LLM-прогон через мок (MOCK_MODE=oversized) ──')
  let mockOwner: 'own' | 'external' | null = null
  try {
    // 1. мок-провайдер в режиме oversized
    mockOwner = await ensureMock()
    push('мок-провайдер доступен в режиме oversized (127.0.0.1:3099)', true, [`владелец=${mockOwner}`])

    // 2. конфиг openai-compatible с тестовым ключом (валидация пробой)
    const saved = await saveConfig({
      default: {
        adapter: 'openai-compatible',
        baseUrl: MOCK_URL,
        model: 'mock-model',
        apiKey: TEST_KEY,
      },
    })
    push('конфиг openai-compatible сохранён (валидация пробой пройдена)', saved?.ok === true, [`result=${JSON.stringify(saved).slice(0, 120)}`])

    // 3. LLM-прогон до завершения
    const runId = await new Promise<string>((resolve) => {
      socket.once('run:created', (d) => resolve(d.runId))
      socket.emit('run:start', { task: 'Тест усечений', mode: 'llm', decisionMode: 'auto' })
    })
    const summary = await waitFor((d) => d.runId === runId && d.event?.type === 'run:summary', 90000)
    push('LLM-прогон через мок завершён', !!summary, [`summary="${String(summary?.summary).slice(0, 100)}…"`])

    // 4. журнал прогона: записи kind='limits'
    const snap = await loadSnapshot(runId)
    const logs: any[] = snap?.logs ?? []
    const limits = logs.filter((l) => l.kind === 'limits')
    const limitsMsgs = limits.map((l) => l.message)
    const allLimitsArePlan = limits.every((l) => String(l.message).startsWith('Лимит плана:'))
    push(
      `в журнале ${limits.length} записей kind='limits', все с префиксом «Лимит плана:»`,
      limits.length >= 8 && allLimitsArePlan,
      limitsMsgs
    )

    // 4a. минимум по CR-008: усечение 15→12, варианты 6→4, шаги 5→3
    push(
      'усечение узлов плана в журнале: 15 → 12 (отброшены n11–n13 с заголовками)',
      limitsMsgs.some((m) => m.includes('LLM вернул 15 узлов — взяты первые 12') && m.includes('n11 «Шаг 11»') && m.includes('n13 «Шаг 13»')),
      [limitsMsgs.find((m) => m.includes('15 узлов')) ?? '—']
    )
    push(
      'усечение вариантов в журнале: 6 → 4 у развилки dec1',
      limitsMsgs.some((m) => m.includes('у развилки dec1 вариантов 6 — оставлены первые 4')),
      [limitsMsgs.find((m) => m.includes('вариантов 6')) ?? '—']
    )
    push(
      'усечение шагов ветки в журнале: 5 → 3 (ветки a–d развилки dec1)',
      ['a', 'b', 'c', 'd'].every((o) => limitsMsgs.some((m) => m.includes(`у ветки ${o} развилки dec1 шагов 5 — оставлены первые 3`))),
      limitsMsgs.filter((m) => m.includes('шагов 5'))
    )
    push(
      'фильтрация неизвестных dependsOn в журнале: у n9 отброшены n10–n13, bxa1',
      limitsMsgs.some((m) => m.includes('у узла n9 отброшены ссылки на необъявленные узлы: n10, n11, n12, n13, bxa1')),
      [limitsMsgs.find((m) => m.includes('необъявленные')) ?? '—']
    )
    push(
      'деградация развилки в журнале: dec2 (1 валидный вариант) → обычный шаг',
      limitsMsgs.some((m) => m.includes('у узла dec2 меньше 2 валидных вариантов') && m.includes('деградировала в обычный шаг')),
      [limitsMsgs.find((m) => m.includes('деградировала')) ?? '—']
    )

    // 4b. порядок записей: лимиты ДО итоговой записи о построенном графе
    const builtIdx = logs.findIndex((l) => String(l.message).includes('Планировщик LLM построил граф'))
    const firstLimitsIdx = logs.findIndex((l) => l.kind === 'limits')
    const provIdx = logs.findIndex((l) => String(l.message).startsWith('Планировщик: '))
    push(
      'порядок корректен: provenance → лимиты → «Планировщик LLM построил граф…»',
      provIdx >= 0 && firstLimitsIdx >= 0 && builtIdx >= 0 && provIdx < firstLimitsIdx && firstLimitsIdx < builtIdx,
      [`Планировщик #${provIdx} < первая лимит-запись #${firstLimitsIdx} < построил #${builtIdx}`]
    )
    push(
      'первая лимит-запись — об усечении узлов плана (15 → 12)',
      firstLimitsIdx >= 0 && String(logs[firstLimitsIdx].message).startsWith('Лимит плана: LLM вернул 15 узлов'),
      [firstLimitsIdx >= 0 ? logs[firstLimitsIdx].message : '—']
    )

    // 5. усечённый граф в снапшоте
    const nodes: any[] = snap?.nodes ?? []
    const dec1 = nodes.find((n) => n.id === 'dec1')
    const dec2 = nodes.find((n) => n.id === 'dec2')
    const n9 = nodes.find((n) => n.id === 'n9')
    push(
      'граф усечён: 24 узла (12 top-level + 12 веток), n11/n12/n13 отсутствуют',
      nodes.length === 24 && !nodes.some((n) => ['n11', 'n12', 'n13'].includes(n.id)),
      [`узлов=${nodes.length}`]
    )
    push(
      'dec1: 4 варианта по 3 шага; dec2 деградировала в шаг; n9 зависит от [n8, dec2]',
      dec1?.decision?.options.length === 4 && dec1.decision.options.every((o: any) => o.nextSteps.length === 3) &&
        dec2?.kind !== 'decision' && !dec2?.decision && n9?.dependsOn.join(',') === 'n8,dec2',
      [
        `dec1.options=${dec1?.decision?.options.length}, dec2.kind=${dec2?.kind}, n9.deps=[${n9?.dependsOn.join(',')}]`,
      ]
    )

    // 6. ключ не утёк: снапшот и runs.json
    const snapRaw = JSON.stringify(snap)
    push('снапшот прогона не содержит ключ API', !snapRaw.includes(TEST_KEY))
    await sleep(1500)
    const runsRaw = fs.existsSync(RUNS_FILE) ? fs.readFileSync(RUNS_FILE, 'utf-8') : ''
    push('data/runs.json не содержит ключ API', !runsRaw.includes(TEST_KEY), [`размер runs.json=${runsRaw.length}`])
  } catch (e: any) {
    push('выполнение интеграционного сценария без ошибок', false, [String(e?.message || e)])
  } finally {
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
    if (mockOwner === 'own') await stopMock()
    socket.disconnect()
  }
  return mockOwner
}

// ─────────────────────── Запуск ───────────────────────

runUnitTests()

socket.on('connect', async () => {
  await runIntegrationTests()
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
})

socket.on('connect_error', (e: any) => {
  console.error('[test] движок недоступен:', e?.message)
  const failed = results.filter((r) => !r.ok)
  console.log('\n════════════ ИТОГ (движок недоступен) ════════════')
  console.log(`Пройдено: ${results.length - failed.length}/${results.length}`)
  process.exit(1)
})
