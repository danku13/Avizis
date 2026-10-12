// Вычислительный движок агента TACG: планирование → пошаговое выполнение →
// динамическая адаптация → вмешательство пользователя. Реальные вызовы LLM
// выполняются через z-ai-web-dev-sdk (llm.ts), демо-режим — симуляция.
import { Server } from 'socket.io'
import { DecisionDomain, DecisionMode, GraphNode, LlmProviderInfo, RunEvent, RunMode, RunSnapshot, RunStatus } from './types'
import {
  DEMO_ADAPTATIONS,
  DEMO_AUTO_PICK,
  DEFAULT_TASK,
  DEMO_DECISION_INSERTIONS,
  DEMO_INITIAL_CERTAINTY,
  DEMO_INITIAL_CERTAINTY_NOTE,
  DEMO_WRITING_AUTO_PICKS,
  demoOutput,
  demoPlan,
  demoWritingPlan,
  detectDemoScenario,
  sleep,
} from './demo'
import { chatJsonDetailed, chatTextDetailed, getZai, LlmRole, LlmUsage } from './llm'
import { loadConfig, providerInfoOf, resolveRole } from './llm-config'
import { pricing } from './pricing'
import { sanitizePlanData } from './plan-sanitizer'
import { store } from './store'

const now = () => Date.now()
const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

/** Формат числа токенов для журнала/итога: 940 → «940», 1200 → «1,2k» */
const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))

/** Формат суммы USD: $123 / $1,23 / $0,0123 / $0,00045 — 3 значащих цифры до $1 */
export const fmtUsd = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return '$0'
  let s: string
  if (v >= 100) s = v.toFixed(0)
  else if (v >= 1) s = v.toFixed(2)
  else s = String(parseFloat(v.toPrecision(3)))
  return '$' + s.replace('.', ',')
}

/** Хвост «· токены: ↑N / ↓M · ≈$X» для записей журнала (только если провайдер сообщил usage) */
const usageNote = (u: LlmUsage | undefined, costUsd?: number | null) =>
  u && ((u.promptTokens ?? 0) > 0 || (u.completionTokens ?? 0) > 0)
    ? ` · токены: ↑${fmtK(u.promptTokens ?? 0)} / ↓${fmtK(u.completionTokens ?? 0)}${
        typeof costUsd === 'number' && costUsd > 0 ? ` · ≈${fmtUsd(costUsd)}` : ''
      }`
    : ''

export class StoppedError extends Error {
  constructor() {
    super('stopped')
  }
}

/** Выбор на развилке: варианты (при смешанном решении — несколько) + кто выбрал + обоснование */
interface DecisionChoice {
  optionIds: string[]
  by: 'agent' | 'user'
  reasoning?: string
}

interface Runtime {
  snapshot: RunSnapshot
  stopped: boolean
  paused: boolean
  loopActive: boolean
  dynamicAdded: number
  demoAdaptDone: Set<number>
  /** Демо-сценарий текущего запуска (data | writing) */
  scenario: 'data' | 'writing'
  /** Выполненные вставки эмерджентных развилок демо-сценария «Напиши пост» */
  demoInsertionsDone: Set<number>
  /** Сколько эмерджентных развилок добавлено супервайзером (LLM-режим) */
  emergentAdded: number
  /** Текущий режим решений (зеркало snapshot.decisionMode) */
  decisionMode: DecisionMode
  /** Ожидаемое решение пользователя на развилке (null — ожидания нет) */
  pendingDecision: { nodeId: string; resolve: (choice: DecisionChoice | null) => void } | null
}

const PLANNER_SYS = `Ты — модуль планирования ИИ-агента. Твоя задача — разбить запрос пользователя на вычислительный граф из шагов и оценить, насколько ты понимаешь задачу. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток и пояснений.`

const EXECUTOR_SYS = `Ты — исполнительный модуль ИИ-агента внутри вычислительного графа. Выполни запрошенный шаг и верни его результат. Отвечай по-русски, по делу, без markdown-заголовков. Объём не ограничен жёстко — он должен быть минимально достаточным для полноценного результата шага: не раздувай контекст, избегай воды и повторов, следи, чтобы каждая фраза несла полезную информацию для следующих шагов и пользователя.`

const SUPERVISOR_SYS = `Ты — супервайзер вычислительного графа ИИ-агента. После каждого шага ты анализируешь входящие данные и решаешь: дополнить ли план новым шагом, задать ли уточняющий вопрос-развилку (если неоднозначность влияет на итог) или ничего не менять. Также ты оцениваешь, насколько узкий вектор решения сложился. Отвечай ТОЛЬКО валидным JSON.`

const DECIDER_SYS = `Ты — модуль принятия решений ИИ-агента на развилке вычислительного графа. Взвесь варианты с учётом задачи и контекста. На развилке типа single выбери один вариант; на развилке типа mixed допустимо смешанное решение из нескольких вариантов. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток.`

const DECISION_DOMAINS: DecisionDomain[] = ['scope', 'specialization', 'product', 'architecture', 'tone', 'format', 'context', 'strategy']

export class AgentEngine {
  private runs = new Map<string, Runtime>()

  constructor(private io: Server) {}

  getRun(runId: string): RunSnapshot | undefined {
    const rt = this.runs.get(runId)
    if (rt) return rt.snapshot
    return store.get(runId)
  }

  private emit(channel: string, payload: any) {
    this.io.emit(channel, payload)
  }

  /** Каждое событие: в журнал запуска (для replay) + broadcast всем клиентам */
  private emitEvent(rt: Runtime, ev: RunEvent) {
    rt.snapshot.events.push(ev)
    this.emit('run:event', { runId: rt.snapshot.id, event: ev })
  }

  private log(rt: Runtime, kind: RunSnapshot['logs'][number]['kind'], message: string) {
    const entry = { id: 'l' + rt.snapshot.logs.length, ts: now(), kind, message }
    rt.snapshot.logs.push(entry)
    this.emitEvent(rt, { type: 'log', ts: entry.ts, entry })
  }

  private pushStatus(rt: Runtime, status: RunStatus, progress: number, reason?: string) {
    rt.snapshot.status = status
    rt.snapshot.progress = progress
    this.emitEvent(rt, { type: 'run:status', ts: now(), status, progress, ...(reason ? { reason } : {}) })
    if (status === 'completed' || status === 'stopped' || status === 'error') {
      this.emit('history:list', { runs: store.history() })
    }
  }

  /** Аудит токенов и стоимости (ADR-015/016): сводка снапшота + событие llm:usage;
   *  nodeId — атрибуция узлу. Событие сворачивается fold'ом на фронтенде — счётчики
   *  и стоимость видны и в replay. Возвращает стоимость вызова в USD (null — прайса нет). */
  private addUsage(rt: Runtime, role: string, usage: LlmUsage | undefined, nodeId?: string): number | null {
    if (!usage) return null
    const input = usage.promptTokens ?? 0
    const output = usage.completionTokens ?? 0
    if (!input && !output) return null
    const run = rt.snapshot
    // provenance вызова (live-резолв роли): модель → динамический прайс (ADR-016)
    const info = providerInfoOf(resolveRole(role as LlmRole, loadConfig()))
    const priced = pricing.costFor(info.model, input, output)
    if (!run.usage) run.usage = { inputTokens: 0, outputTokens: 0, calls: 0, byRole: {} }
    run.usage.inputTokens += input
    run.usage.outputTokens += output
    run.usage.calls += 1
    const r = (run.usage.byRole[role] ??= { inputTokens: 0, outputTokens: 0, calls: 0 })
    r.inputTokens += input
    r.outputTokens += output
    r.calls += 1
    if (priced) {
      run.usage.costUsd = (run.usage.costUsd ?? 0) + priced.costUsd
      r.costUsd = (r.costUsd ?? 0) + priced.costUsd
    } else {
      run.usage.unpricedCalls = (run.usage.unpricedCalls ?? 0) + 1
    }
    if (nodeId) {
      const node = run.nodes.find((n) => n.id === nodeId)
      if (node) {
        const u = (node.usage ??= { input: 0, output: 0 })
        u.input += input
        u.output += output
        if (priced) u.costUsd = (u.costUsd ?? 0) + priced.costUsd
      }
    }
    this.emitEvent(rt, {
      type: 'llm:usage',
      ts: now(),
      role,
      nodeId,
      inputTokens: input,
      outputTokens: output,
      adapter: info.adapter,
      model: info.model,
      ...(priced ? { costUsd: priced.costUsd, priceSource: priced.price.source } : {}),
    })
    return priced ? priced.costUsd : null
  }

  // ─────────────────────────── Запуск ───────────────────────────

  async start(taskInput: string, mode: RunMode, decisionMode: DecisionMode = 'manual'): Promise<RunSnapshot> {
    const task = (taskInput || '').trim() || DEFAULT_TASK
    const id = 'run_' + now().toString(36) + Math.random().toString(36).slice(2, 7)
    const scenario = mode === 'demo' ? detectDemoScenario(task) : 'data'
    const run: RunSnapshot = {
      id,
      task,
      mode,
      decisionMode,
      status: 'planning',
      createdAt: now(),
      progress: 0,
      nodes: [],
      version: 0,
      versions: [],
      events: [],
      logs: [],
    }
    const rt: Runtime = {
      snapshot: run,
      stopped: false,
      paused: false,
      loopActive: false,
      dynamicAdded: 0,
      demoAdaptDone: new Set(),
      scenario,
      demoInsertionsDone: new Set(),
      emergentAdded: 0,
      decisionMode,
      pendingDecision: null,
    }
    this.runs.set(id, rt)

    // Provenance (ADR-012): роль → адаптер/модель фиксируются при старте LLM-прогона (без ключей)
    if (mode === 'llm') {
      const cfg = loadConfig()
      run.llm = {
        planner: providerInfoOf(resolveRole('planner', cfg)),
        executor: providerInfoOf(resolveRole('executor', cfg)),
        supervisor: providerInfoOf(resolveRole('supervisor', cfg)),
        decider: providerInfoOf(resolveRole('decider', cfg)),
      }
    }

    this.emit('run:created', { runId: id, task, mode, decisionMode, createdAt: run.createdAt, llm: run.llm })
    this.emitEvent(rt, { type: 'decision:mode', ts: now(), mode: decisionMode })
    this.pushStatus(rt, 'planning', 0)
    // Прогон сразу попадает в историю: запуск виден мгновенно, не дожидаясь
    // терминального статуса (медленное LLM-планирование/ретраи — минуты)
    store.save(run)
    this.emit('history:list', { runs: store.history() })
    const llmLabel =
      mode === 'llm'
        ? run.llm!.planner.adapter === 'zai'
          ? 'LLM через z-ai-web-dev-sdk'
          : `LLM через ${run.llm!.planner.adapter} · ${run.llm!.planner.model}`
        : 'демо-режим (симуляция)'
    this.log(rt, 'run', `Запуск агента · ${llmLabel} · задача: «${trunc(task, 90)}»`)

    if (mode === 'llm') {
      this.log(rt, 'plan', 'Планировщик LLM анализирует задачу…')
      // инициализация SDK нужна только для адаптера zai
      if (resolveRole('planner', loadConfig()).adapter === 'zai') {
        try {
          await getZai()
        } catch (e: any) {
          this.log(rt, 'run', `Ошибка инициализации SDK: ${e?.message || e}`)
          this.pushStatus(rt, 'error', 0, `Ошибка инициализации SDK: ${trunc(e?.message || '', 120)}`)
          store.save(run)
          return run
        }
      }
    } else {
      this.log(rt, 'plan', 'Планировщик строит граф задачи…')
      await sleep(900)
    }

    let nodes: GraphNode[]
    if (mode === 'llm') {
      nodes = await this.planWithLLM(task, rt)
    } else if (scenario === 'writing') {
      nodes = demoWritingPlan()
      this.log(rt, 'plan', 'Демо-сценарий «Напиши пост»: размытый запрос — агент будет уточнять вектор по ходу выполнения')
    } else {
      nodes = demoPlan()
    }

    this.emitEvent(rt, { type: 'graph:init', ts: now(), nodes })
    run.nodes = nodes.map((n) => ({ ...n }))
    run.version = 1
    run.versions.push({ version: 1, createdAt: now(), description: 'Исходный план агента', nodeIds: nodes.map((n) => n.id) })
    this.log(rt, 'plan', `План готов: ${nodes.length} узлов · версия графа v1`)

    // стартовая самооценка «понимания задачи»: насколько узкий вектор решения
    const initialCertainty = mode === 'llm' ? (rt.snapshot.certainty ?? 0.4) : DEMO_INITIAL_CERTAINTY[scenario]
    const initialNote = mode === 'llm' ? undefined : DEMO_INITIAL_CERTAINTY_NOTE[scenario]
    this.emitCertainty(rt, initialCertainty, initialNote)

    this.pushStatus(rt, 'running', 0)
    this.log(rt, 'run', 'Выполнение графа началось')
    store.save(run)

    this.runLoop(rt).catch((err: any) => {
      this.log(rt, 'run', `Внутренняя ошибка цикла выполнения: ${err?.message || err}`)
      this.pushStatus(rt, 'error', run.progress, `Внутренняя ошибка цикла: ${trunc(err?.message || '', 120)}`)
    })
    return run
  }

  private async planWithLLM(task: string, rt: Runtime): Promise<GraphNode[]> {
    const user = `Задача пользователя: «${task}»

Сначала ОЦЕНИ: если запрос размыт (не заданы формат, объём, тон, аудитория, скоуп или подход) — начни понимание с низкой оценки certainty и включи развилки-уточнения. Если задача про разработку — уточняй продуктовые и архитектурные вопросы; если про тексты — tone of voice и формат; если про данные/анализ — стратегию проверки.

Составь план из 4–7 шагов с ОДНОЙ-ДВУМЯ развилками (узлами-решениями): точками, где выбор одного или нескольких вариантов меняет дальнейшие шаги и итоговый результат. Формат ответа — строго один JSON-объект без каких-либо дополнений:

{"certainty":0.3,"nodes":[
  {"id":"n1","title":"краткое название шага","description":"что делает шаг, 1-2 предложения","dependsOn":[]},
  {"id":"dec1","title":"Решение: ...","description":"суть развилки","dependsOn":["n1"],
   "decision":{"question":"вопрос, который решается на развилке","domain":"format","selection":"single","certaintyAfter":0.6,"options":[
     {"id":"a","label":"название варианта","rationale":"обоснование: плюсы, минусы, цена выбора","steps":[
       {"id":"ba1","title":"шаг ветки A","description":"..."}
     ]},
     {"id":"b","label":"название варианта","rationale":"...","steps":[
       {"id":"bb1","title":"шаг ветки B","description":"..."}
     ]}
   ]}},
  {"id":"nfin","title":"Формирование результата","description":"сведение итога","dependsOn":["ba1","bb1"]}
]}

Правила:
- Названия и описания — на русском языке. Первый узел имеет пустой dependsOn.
- certainty — число 0..1: твоя оценка понимания задачи ДО уточнений (размытый запрос → 0.2-0.4, конкретный → 0.6-0.8).
- Развилок не больше двух; вариантов 2–4; шагов в каждой ветке 1–3. Первый шаг ветки выполняется вместо шагов других веток.
- domain — один из: scope, specialization, product, architecture, tone, format, context, strategy.
- selection — "single" (выбрать один вариант) или "mixed" (смешанное решение: допустимо выбрать несколько вариантов — например, блоки контента). certaintyAfter — оценка понимания ПОСЛЕ закрытия вопроса.
- Итоговый узел зависит от хвостов ВСЕХ веток (перечисли их в dependsOn).
- dependsOn ссылается только на id уже объявленных узлов. Массив nodes обязан быть закрыт перед концом объекта.`
    try {
      const { json, usage } = await chatJsonDetailed(PLANNER_SYS, user, 60_000, 2, 'planner')
      const planCost = this.addUsage(rt, 'planner', usage)
      const { nodes, certainty, notes } = sanitizePlanData(json)
      if (certainty !== undefined) rt.snapshot.certainty = certainty
      if (nodes) {
        const plannerInfo = providerInfoOf(resolveRole('planner', loadConfig()))
        this.log(rt, 'plan', `Планировщик: ${plannerInfo.adapter} · ${plannerInfo.model}${usageNote(usage, planCost)}`)
        // ADR-013 (аудит усечений): каждая структурная потеря плана — в журнал
        // ДО итоговой записи о построенном графе (сначала лимиты, потом итог)
        for (const note of notes) this.log(rt, 'limits', note.message)
        const decCount = nodes.filter((n) => n.kind === 'decision').length
        this.log(
          rt,
          'plan',
          `Планировщик LLM построил граф из ${nodes.length} узлов${decCount ? ` · развилок: ${decCount}` : ''}`
        )
        return nodes
      }
      this.log(rt, 'info', 'Не удалось разобрать JSON плана — применён резервный план')
    } catch (e: any) {
      this.log(rt, 'info', `Планировщик LLM недоступен (${trunc(e?.message || '', 80)}) — применён резервный план`)
    }
    return demoPlan()
  }

  // ─────────────────────── Цикл выполнения ───────────────────────

  private async runLoop(rt: Runtime) {
    if (rt.loopActive) return
    rt.loopActive = true
    try {
      while (true) {
        const run = rt.snapshot
        if (rt.stopped) {
          this.finalizeStopped(rt)
          return
        }
        const node = this.nextReadyNode(run)
        if (!node) {
          const errored = run.nodes.find((n) => n.status === 'error')
          if (errored) {
            this.log(rt, 'node-error', `Узел «${errored.title}» завершился ошибкой — выполнение остановлено. Доступно вмешательство: «Повторить узел».`)
            this.pushStatus(rt, 'error', run.progress, `Узел «${errored.title}» упал: ${trunc(errored.error || 'ошибка выполнения', 140)}`)
            run.finishedAt = now()
            store.save(run)
            return
          }
          const pending = run.nodes.filter((n) => n.status === 'pending')
          if (pending.length) {
            this.log(rt, 'run', 'Обнаружена циклическая зависимость — оставшиеся узлы пропущены')
            pending.forEach((n) => {
              n.status = 'skipped'
              this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...n } })
            })
          }
          this.finalizeCompleted(rt)
          return
        }

        await this.waitWhilePaused(rt)
        if (rt.stopped) continue

        node.input = this.buildInput(run, node)
        node.status = 'running'
        node.startedAt = now()
        node.runs = (node.runs ?? 0) + 1
        node.error = undefined
        this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
        this.log(rt, 'node-start', `▶ «${node.title}» — выполнение`)

        // ─── Узел-развилка: рассуждение → предложение вариантов → выбор → гашение веток ───
        if (node.kind === 'decision' && node.decision) {
          const decided = await this.handleDecisionNode(rt, node)
          if (!decided) continue // остановлен во время решения — цикл завершит очистку
          this.recalcProgress(rt)
          this.pushStatus(rt, rt.paused ? 'paused' : 'running', run.progress)
          store.save(run)
          continue
        }

        try {
          const result =
            run.mode === 'demo'
              ? { output: await this.demoExecute(node, rt), usage: undefined as LlmUsage | undefined }
              : await this.llmExecute(run, node)
          node.status = 'done'
          node.output = result.output
          node.finishedAt = now()
          node.durationMs = node.finishedAt - (node.startedAt ?? node.finishedAt)
          // Аудит токенов (ADR-015): атрибуция исполнителя узлу ДО node:update,
          // чтобы usage попал в событие и в инспектор replay
          const stepCost = this.addUsage(rt, 'executor', result.usage, node.id)
          this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
          this.log(
            rt,
            'node-done',
            `✓ «${node.title}» — завершён за ${((node.durationMs ?? 0) / 1000).toFixed(1)} с${usageNote(result.usage, stepCost)}`
          )
        } catch (err: any) {
          if (err instanceof StoppedError) {
            node.status = 'pending'
            node.startedAt = undefined
            node.input = undefined
            this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
            this.finalizeStopped(rt)
            return
          }
          node.status = 'error'
          node.error = err?.message || String(err)
          node.finishedAt = now()
          node.durationMs = node.finishedAt - (node.startedAt ?? node.finishedAt)
          this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
          this.log(rt, 'node-error', `✗ «${node.title}» — ошибка: ${trunc(node.error ?? '', 140)}`)
          continue
        }

        await this.maybeAdapt(rt, node)
        this.recalcProgress(rt)
        this.pushStatus(rt, rt.paused ? 'paused' : 'running', run.progress)
        store.save(run)
      }
    } finally {
      rt.loopActive = false
    }
  }

  private nextReadyNode(run: RunSnapshot): GraphNode | undefined {
    const byId = new Map(run.nodes.map((n) => [n.id, n]))
    // «discarded» = ветка не реализована: зависимость от неё считается удовлетворённой
    const ready = (n: GraphNode) =>
      n.dependsOn.every((d) => {
        const dep = byId.get(d)
        return !dep || dep.status === 'done' || dep.status === 'skipped' || dep.status === 'discarded'
      })
    return run.nodes.find((n) => n.status === 'pending' && ready(n))
  }

  private buildInput(run: RunSnapshot, node: GraphNode): string {
    const deps = node.dependsOn
      .map((id) => run.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => !!n && n.status === 'done')
    // Полные тексты без обрезки: node.input — это данные инспектора (Вход),
    // а не только промпт. Обрезка промптов — отдельно в llmExecute/decider.
    if (!deps.length) return `Задача: ${run.task}`
    return `Задача: ${run.task}\n\nРезультаты предыдущих шагов:\n${deps
      .map((d) => `• «${d.title}»: ${d.output || '—'}`)
      .join('\n')}`
  }

  private async demoExecute(node: GraphNode, rt: Runtime): Promise<string> {
    // полный набор решений прогона: id развилки → выбранные варианты
    const picks: Record<string, string[]> = {}
    for (const n of rt.snapshot.nodes) {
      if (n.kind === 'decision' && n.decision?.status === 'resolved' && Array.isArray(n.decision.chosen)) {
        picks[n.id] = [...n.decision.chosen]
      }
    }
    const base = demoOutput(node, rt.snapshot.task, picks)
    const isRerun = (node.runs ?? 0) > 1
    const text = isRerun ? `↻ Пересчёт после вмешательства пользователя.\n\n${base}` : base
    const duration = isRerun ? 1200 : 2300
    const deadline = now() + duration
    while (now() < deadline) {
      if (rt.stopped) throw new StoppedError()
      while (rt.paused && !rt.stopped) await sleep(150)
      if (rt.stopped) throw new StoppedError()
      await sleep(120)
    }
    return text
  }

  private async llmExecute(run: RunSnapshot, node: GraphNode): Promise<{ output: string; usage?: LlmUsage }> {
    const user = `Задача пользователя: «${run.task}»

Текущий шаг: «${node.title}»
Описание шага: ${node.description || '—'}

${trunc(node.input || `Задача: ${run.task}`, 12000)}

Выполни текущий шаг и верни его результат.`
    // provenance узла: адаптер/модель исполнителя (без ключей)
    node.llm = providerInfoOf(resolveRole('executor', loadConfig()))
    const res = await chatTextDetailed(EXECUTOR_SYS, user, 90_000, 1, 'executor')
    return { output: res.content, usage: res.usage }
  }

  // ───────────────────── Динамическая адаптация ─────────────────────

  /**
   * Анализ входящих данных после каждого шага: дополнить план шагом,
   * вставить эмерджентную развилку-уточнение (анализ показал неоднозначность,
   * влияющую на итог) или ничего не менять.
   */
  private async maybeAdapt(rt: Runtime, finished: GraphNode) {
    const run = rt.snapshot
    if (run.mode === 'demo') {
      if (rt.scenario === 'data') {
        const idx = DEMO_ADAPTATIONS.findIndex((a, i) => a.after === finished.id && !rt.demoAdaptDone.has(i))
        if (idx < 0) return
        rt.demoAdaptDone.add(idx)
        await sleep(450)
        const spec = DEMO_ADAPTATIONS[idx]
        this.insertNode(rt, { ...spec.node, dependsOn: [finished.id] }, spec.reason)
        return
      }
      // сценарий «Напиши пост»: агент анализирует результаты шагов и вставляет развилки-уточнения
      const insIdx = DEMO_DECISION_INSERTIONS.findIndex(
        (d, i) => d.afterAny.includes(finished.id) && !rt.demoInsertionsDone.has(i)
      )
      if (insIdx < 0) return
      rt.demoInsertionsDone.add(insIdx)
      await sleep(450)
      const spec = DEMO_DECISION_INSERTIONS[insIdx]
      this.insertDecision(rt, finished.id, spec.decision, spec.reason)
      return
    }

    // LLM-режим: супервайзер анализирует результаты шагов — новый шаг / вопрос-развилка / ничего.
    // Количество эмерджентных вопросов и динамических вставок НЕ ограничено (ADR-011):
    // дисциплину задаёт промпт (полезность вопроса, недублирование), а не жёсткие счётчики.
    const hasPendingSuccessors = run.nodes.some((n) => n.status === 'pending' && n.dependsOn.includes(finished.id))
    const anyPending = run.nodes.some((n) => n.status === 'pending')
    if (!hasPendingSuccessors && !anyPending) return
    // вопрос не вставляется, пока открыта другая развилка: уточнения идут последовательно
    const hasOpenDecision = run.nodes.some((n) => n.kind === 'decision' && (n.status === 'pending' || n.status === 'running'))
    const askAllowed = !hasOpenDecision

    const graphDesc = run.nodes
      .map((n) => `- ${n.id} «${n.title}» [${n.status}]${n.output ? ': ' + trunc(n.output, 400) : ''}`)
      .join('\n')
    const openQuestions = run.nodes
      .filter((n) => n.kind === 'decision')
      .map((n) => n.decision ? `«${n.title}» (${n.decision.status})` : '')
      .filter(Boolean)
      .join(', ')
    const user = `Задача: «${run.task}»

Текущий граф:
${graphDesc}

Заданные ранее вопросы-развилки: ${openQuestions || '—'}

Только что завершён узел «${finished.title}»: ${trunc(finished.output || '', 2000)}

Проанализируй входящие данные завершённого шага и реши:
1) add_node — если есть ЯВНЫЙ пробел, закрываемый обычным шагом (например, данные требуют валидации);
2) ask — если обнаружена неоднозначность, влияющая на итог (расширение/сужение скоупа, специализация, продуктовые или архитектурные вопросы для разработки, tone of voice или формат для текстов, контекст задачи): предложи вопрос с вариантами и обоснованием;${
      askAllowed ? '' : ' (сейчас ask недоступен — используй только no_changes/add_node)'
    }
3) no_changes — в остальных случаях (в подавляющем большинстве).
Количество вопросов не ограничено, но каждый обязан быть полезным: не дублируй уже заданные/закрытые вопросы (список выше), не уточняй то, что не влияет на итог. Во всех текстах (description, rationale, reason) не раздувай контекст: только полезная информация, без воды и повторов.
Также верни certainty — текущую оценку понимания задачи (0..1: насколько узкий вектор решения сложился).

Формат ответа:
{"decision":"no_changes","certainty":0.6}
или
{"decision":"add_node","certainty":0.6,"node":{"title":"...","description":"...","reason":"почему добавляем"}}
или
{"decision":"ask","certainty":0.5,"question":{"question":"текст вопроса","domain":"scope","selection":"single","certaintyAfter":0.8,"reason":"почему вопрос важен","options":[{"id":"a","label":"название","rationale":"обоснование","steps":[{"title":"шаг ветки","description":"..."}]}]}}

Домены: scope, specialization, product, architecture, tone, format, context, strategy. selection: single (один вариант) или mixed (смешанное решение из нескольких). Вариантов 2–4, шагов в ветке 1–3.`

    try {
      const { json, usage } = await chatJsonDetailed(SUPERVISOR_SYS, user, 45_000, 0, 'supervisor')
      // Аудит токенов (ADR-015): супервайзер вызывается после каждого шага —
      // без записи в журнал (иначе шум), но с полным учётом в сводке запуска
      this.addUsage(rt, 'supervisor', usage)
      if (typeof json?.certainty === 'number' && Number.isFinite(json.certainty)) {
        const c = Math.min(1, Math.max(0, json.certainty))
        if (Math.abs(c - (run.certainty ?? 0)) > 0.05) this.emitCertainty(rt, c)
      }
      if (json?.decision === 'add_node' && json.node?.title) {
        const id = `dyn${rt.dynamicAdded + 1}`
        this.insertNode(
          rt,
          {
            id,
            title: String(json.node.title).slice(0, 60),
            description: String(json.node.description || ''),
            dependsOn: [finished.id],
          },
          String(json.node.reason || 'Выявлен пробел в плане'),
          providerInfoOf(resolveRole('supervisor', loadConfig()))
        )
      } else if (json?.decision === 'ask' && askAllowed) {
        const q = json.question
        if (q?.question && Array.isArray(q?.options) && q.options.length >= 2) {
          const labeled = q.options.filter((o: any) => o?.label)
          const qTitle = trunc(String(q.question), 80)
          // ADR-013 (аудит усечений): варианты >4 и шаги >3 ask-вопроса — в журнал
          if (labeled.length > 4) {
            this.log(rt, 'limits', `Лимит адаптации: у вопроса супервайзера «${qTitle}» вариантов ${labeled.length} — оставлены 4`)
          }
          const options = labeled
            .slice(0, 4)
            .map((o: any, j: number) => {
              const optId = ['a', 'b', 'c', 'd'][j]
              const stepsAll = Array.isArray(o.steps) ? o.steps.filter((s: any) => s) : []
              if (stepsAll.length > 3) {
                this.log(
                  rt,
                  'limits',
                  `Лимит адаптации: у вопроса супервайзера «${qTitle}» шагов ${stepsAll.length} в ветке ${optId} — оставлены 3`
                )
              }
              return {
                id: optId,
                label: String(o.label).slice(0, 60),
                rationale: String(o.rationale || ''),
                steps: stepsAll.slice(0, 3).map((s: any) => ({
                  title: String(s?.title || 'шаг ветки').slice(0, 60),
                  description: String(s?.description || ''),
                })),
              }
            })
          if (options.length >= 2) {
            const certaintyAfter = Number(q.certaintyAfter)
            this.insertDecision(
              rt,
              finished.id,
              {
                id: `decq${rt.emergentAdded + 1}`,
                title: `Вопрос: ${String(q.question).slice(0, 40)}`,
                description: String(q.reason || 'Выявлена неоднозначность, влияющая на итог'),
                question: String(q.question),
                domain: DECISION_DOMAINS.includes(q.domain) ? q.domain : 'context',
                selection: q.selection === 'mixed' ? 'mixed' : 'single',
                certaintyAfter: Number.isFinite(certaintyAfter)
                  ? Math.min(1, Math.max(0, certaintyAfter))
                  : Math.min(0.95, (run.certainty ?? 0.4) + 0.2),
                options,
              },
              String(q.reason || 'Агент обнаружил неоднозначность, влияющую на итог')
            )
          }
        }
      }
    } catch {
      /* супервайзер недоступен → план не меняем */
    }
  }

  private insertNode(
    rt: Runtime,
    spec: { id: string; title: string; description: string; dependsOn: string[] },
    reason: string,
    llm?: LlmProviderInfo
  ) {
    const run = rt.snapshot
    const newNode: GraphNode = {
      id: spec.id,
      title: spec.title,
      description: spec.description,
      status: 'pending',
      dependsOn: [...spec.dependsOn],
      dynamic: true,
      reason,
      addedAtVersion: run.version + 1,
      runs: 0,
      llm,
    }
    const changed: GraphNode[] = [newNode]
    const anchor = spec.dependsOn[0]
    // Перепривязываем ещё не начатые узлы, зависящие от якоря, на новый узел
    for (const n of run.nodes) {
      if (n.status === 'pending' && n.dependsOn.includes(anchor)) {
        n.dependsOn = [...new Set(n.dependsOn.map((d) => (d === anchor ? newNode.id : d)))]
        changed.push({ ...n })
      }
    }
    run.nodes.push(newNode)
    run.version += 1
    rt.dynamicAdded += 1
    run.versions.push({ version: run.version, createdAt: now(), description: reason, nodeIds: run.nodes.map((n) => n.id) })
    this.emitEvent(rt, { type: 'graph:adapt', ts: now(), reason, version: run.version, nodes: changed.map((n) => ({ ...n })) })
    this.log(rt, 'adapt', `＋ Граф адаптирован (v${run.version}): добавлен узел «${newNode.title}». Причина: ${reason}`)
    store.save(run)
  }

  /**
   * Вставка эмерджентной развилки: агент проанализировал результаты шага и
   * обнаружил неоднозначность, влияющую на итог. Создаёт узел-вопрос с ветками
   * вариантов; ещё не начатые узлы, ждавшие якорь, переводятся на хвосты веток —
   * итог корректно дождётся только реализованных веток.
   */
  private insertDecision(
    rt: Runtime,
    anchorId: string,
    spec: {
      id: string
      title: string
      description: string
      question: string
      domain?: string
      selection: 'single' | 'mixed'
      certaintyAfter?: number
      options: Array<{ id: string; label: string; rationale: string; steps: Array<{ id?: string; title: string; description: string }> }>
    },
    reason: string
  ) {
    const run = rt.snapshot
    const domain: DecisionDomain | undefined = DECISION_DOMAINS.includes(spec.domain as DecisionDomain)
      ? (spec.domain as DecisionDomain)
      : undefined
    const version = run.version + 1

    const decNode: GraphNode = {
      id: spec.id,
      kind: 'decision',
      title: spec.title,
      description: spec.description,
      status: 'pending',
      dependsOn: [anchorId],
      dynamic: true,
      reason,
      addedAtVersion: version,
      runs: 0,
      decision: {
        question: spec.question,
        domain,
        selection: spec.selection,
        certaintyAfter: spec.certaintyAfter,
        options: spec.options.map((o) => ({
          id: o.id,
          label: o.label,
          rationale: o.rationale,
          nextSteps: o.steps.map((s) => s.title),
        })),
        status: 'pending',
      },
    }
    const changed: GraphNode[] = [decNode]
    const tails: string[] = []

    // ветки вариантов: цепочки от развилки
    spec.options.forEach((o) => {
      let prev = spec.id
      o.steps.forEach((s, k) => {
        const bid = s.id || `${spec.id}${o.id}${k + 1}`
        const branchNode: GraphNode = {
          id: bid,
          title: s.title,
          description: s.description,
          status: 'pending',
          dependsOn: [prev],
          dynamic: true,
          reason,
          addedAtVersion: version,
          runs: 0,
          branchOf: { decisionId: spec.id, optionId: o.id },
        }
        run.nodes.push(branchNode)
        changed.push({ ...branchNode })
        prev = bid
      })
      if (prev === spec.id) return // у варианта нет шагов — ветка «прямое продолжение»
      tails.push(prev)
    })
    run.nodes.push(decNode)

    // перепривязка: ещё не начатые узлы, ждавшие якорь, ждут хвосты ВСЕХ веток
    // (невыбранные ветки станут discarded — зависимость удовлетворится автоматически)
    for (const n of run.nodes) {
      if (n.id !== decNode.id && n.status === 'pending' && n.dependsOn.includes(anchorId)) {
        const rebound = [...new Set(n.dependsOn.flatMap((d) => (d === anchorId ? (tails.length ? tails : [anchorId]) : [d])))]
        // ADR-013 (аудит усечений): зависимостей после перепривязки >12 — в журнал
        if (rebound.length > 12) {
          this.log(
            rt,
            'limits',
            `Лимит адаптации: при перепривязке узла ${n.id} зависимостей ${rebound.length} — оставлены первые 12 (отброшены: ${rebound.slice(12).join(', ')})`
          )
        }
        n.dependsOn = rebound.slice(0, 12)
        changed.push({ ...n })
      }
    }

    run.version = version
    rt.dynamicAdded += 1
    rt.emergentAdded += 1
    run.versions.push({ version, createdAt: now(), description: reason, nodeIds: run.nodes.map((n) => n.id) })
    this.emitEvent(rt, { type: 'graph:adapt', ts: now(), reason, version, nodes: changed.map((n) => ({ ...n })) })
    this.log(
      rt,
      'adapt',
      `＋ Эмерджентная развилка (v${version}): «${spec.title}» — ${spec.options.length} варианта${
        spec.selection === 'mixed' ? ' (смешанный выбор допустим)' : ''
      }. Причина: ${reason}`
    )
    store.save(run)
  }

  /** Публикация самооценки «понимания задачи»: насколько узкий вектор решения */
  private emitCertainty(rt: Runtime, certainty: number, note?: string) {
    const c = Math.min(1, Math.max(0, Number.isFinite(certainty) ? certainty : 0))
    rt.snapshot.certainty = c
    this.emitEvent(rt, { type: 'run:certainty', ts: now(), certainty: c, note })
    const pct = Math.round(c * 100)
    this.log(rt, 'decision', `◎ Понимание задачи: ${pct}% — ${note || 'агент переоценил вектор решения'}`)
  }

  // ───────────────────── Развилки: предложения и выбор ─────────────────────

  /** Жизненный цикл узла-развилки: рассуждение → предложение вариантов → выбор → активация ветки */
  private async handleDecisionNode(rt: Runtime, node: GraphNode): Promise<boolean> {
    const dec = node.decision!
    this.log(rt, 'decision', `⎇ Развилка «${node.title}»: ${dec.question}`)
    try {
      await this.decisionThinkDelay(rt)
    } catch {
      return this.rollbackDecision(rt, node)
    }
    if (rt.stopped) return this.rollbackDecision(rt, node)

    dec.status = 'offered'
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
    this.emitEvent(rt, {
      type: 'decision:offer',
      ts: now(),
      nodeId: node.id,
      question: dec.question,
      options: dec.options,
    })

    if (rt.decisionMode === 'manual') {
      this.log(
        rt,
        'decision',
        `⎇ Режим «ручной выбор»: агент предлагает ${dec.options.length} варианта с обоснованием и ожидает решения пользователя${
          dec.selection === 'mixed' ? ' (допустимо смешанное решение из нескольких)' : ''
        }`
      )
      const choice = await this.waitForDecision(rt, node)
      if (!choice) return this.rollbackDecision(rt, node)
      this.resolveDecision(rt, node, choice.optionIds, choice.by, choice.reasoning)
    } else {
      this.log(rt, 'decision', '⎇ Режим «авто»: агент взвешивает варианты и принимает решение самостоятельно')
      const picked = await this.autoDecide(rt, node)
      if (rt.stopped) return this.rollbackDecision(rt, node)
      this.resolveDecision(rt, node, picked.optionIds, 'agent', picked.reasoning)
    }
    return true
  }

  /** Откат развилки (остановка во время решения): узел возвращается в очередь */
  private rollbackDecision(rt: Runtime, node: GraphNode): boolean {
    node.status = 'pending'
    node.startedAt = undefined
    node.input = undefined
    if (node.decision) node.decision = { ...node.decision, status: 'pending' }
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
    return false
  }

  /** Фаза рассуждения на развилке: пауза с уважением stop/pause */
  private async decisionThinkDelay(rt: Runtime): Promise<void> {
    const deadline = now() + (rt.snapshot.mode === 'llm' ? 700 : 1600)
    while (now() < deadline) {
      if (rt.stopped) throw new StoppedError()
      while (rt.paused && !rt.stopped) await sleep(150)
      if (rt.stopped) throw new StoppedError()
      await sleep(120)
    }
  }

  /** Ожидание выбора: движок засыпает на promise до решения пользователя / переключения в авто / остановки */
  private waitForDecision(rt: Runtime, node: GraphNode): Promise<DecisionChoice | null> {
    return new Promise<DecisionChoice | null>((resolve) => {
      rt.pendingDecision = { nodeId: node.id, resolve }
    })
  }

  /** Авто-режим: демо — скриптованный выбор; LLM — вызов модуля принятия решений */
  private async autoDecide(rt: Runtime, node: GraphNode): Promise<{ optionIds: string[]; reasoning: string }> {
    const dec = node.decision!
    if (rt.snapshot.mode === 'demo') {
      await sleep(1200)
      const scripted = DEMO_WRITING_AUTO_PICKS[node.id]
      if (scripted) return { optionIds: [...scripted.optionIds], reasoning: scripted.reasoning }
      return { optionIds: [...DEMO_AUTO_PICK.optionIds], reasoning: DEMO_AUTO_PICK.reasoning }
    }
    const mixed = dec.selection === 'mixed'
    // provenance узла-развилки: адаптер/модель решателя (без ключей)
    if (rt.snapshot.mode === 'llm') {
      node.llm = providerInfoOf(resolveRole('decider', loadConfig()))
    }
    const user = `Задача: «${rt.snapshot.task}»

Развилка: ${dec.question}
Тип выбора: ${mixed ? 'mixed — можно выбрать НЕСКОЛЬКО вариантов (смешанное решение)' : 'single — нужно выбрать ровно один вариант'}

Варианты:
${dec.options.map((o) => `- id «${o.id}» — ${o.label}: ${o.rationale}`).join('\n')}

${node.input || ''}

${mixed ? 'Выбери один или несколько вариантов (id из списка) и обоснуй состав.' : 'Выбери один вариант (id из списка) и обоснуй выбор.'} Ответ строго JSON:
${mixed ? '{"optionIds":["<id1>","<id2>"],"reasoning":"краткое, но исчерпывающее обоснование без воды"}' : '{"optionIds":["<id>"],"reasoning":"краткое, но исчерпывающее обоснование без воды"}'}`
    try {
      const { json, usage } = await chatJsonDetailed(DECIDER_SYS, user, 45_000, 1, 'decider')
      // Аудит токенов (ADR-015): вызовы решателя атрибутируются узлу-развилке
      this.addUsage(rt, 'decider', usage, node.id)
      const rawIds: any[] = Array.isArray(json?.optionIds)
        ? json.optionIds
        : Array.isArray(json?.options)
          ? json.options
          : json?.optionId
            ? [json.optionId]
            : []
      const valid = rawIds
        .map((v) => String(v ?? '').trim().toLowerCase())
        .filter((v) => dec.options.some((o) => o.id === v))
      const unique = [...new Set(valid)]
      if (unique.length && json?.reasoning) {
        const picked = mixed ? unique : unique.slice(0, 1)
        return { optionIds: picked, reasoning: String(json.reasoning) }
      }
    } catch {
      /* fallback ниже */
    }
    return { optionIds: [dec.options[0].id], reasoning: 'Обоснование LLM недоступно — выбран первый вариант по умолчанию' }
  }

  /** Применяет выбор (один или несколько вариантов): активирует ветки, гасит альтернативы, фиксирует аудит-трейл */
  private resolveDecision(rt: Runtime, node: GraphNode, optionIds: string[], by: 'agent' | 'user', reasoning?: string) {
    const run = rt.snapshot
    const dec = node.decision!
    const single = dec.selection !== 'mixed'
    // валидация: только известные id; single — ровно один
    let picked = optionIds.map((id) => id.trim().toLowerCase()).filter((id) => dec.options.some((o) => o.id === id))
    picked = [...new Set(picked)]
    if (!picked.length) picked = [dec.options[0].id]
    if (single) picked = picked.slice(0, 1)
    const opts = picked.map((id) => dec.options.find((o) => o.id === id)!)
    const isMixedResult = picked.length > 1
    const pickedLabel = opts.map((o) => `«${o.label}»`).join(isMixedResult ? ' + ' : '')

    node.status = 'done'
    node.finishedAt = now()
    node.durationMs = node.finishedAt - (node.startedAt ?? node.finishedAt)
    node.decision = { ...dec, status: 'resolved', chosen: picked, chosenBy: by, reasoning: reasoning?.trim() || undefined }
    node.output =
      by === 'agent'
        ? `${isMixedResult ? `Смешанное решение агента: ${pickedLabel}.` : `Решение агента: вариант ${pickedLabel}.`} ${reasoning || ''}`.trim()
        : `${isMixedResult ? `Смешанный выбор пользователя: ${pickedLabel}.` : `Выбор пользователя: вариант ${pickedLabel}.`} ${opts.map((o) => o.rationale).join(' ')}`
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })

    // мгновенная визуализация последствий: нереализованные ветки гаснут
    let discarded = 0
    for (const n of run.nodes) {
      if (n.branchOf?.decisionId === node.id && !picked.includes(n.branchOf.optionId) && n.status === 'pending') {
        n.status = 'discarded'
        discarded++
        this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...n } })
      }
    }

    this.emitEvent(rt, {
      type: 'decision:resolved',
      ts: now(),
      nodeId: node.id,
      optionIds: picked,
      by,
      reasoning: node.decision.reasoning,
    })
    this.log(
      rt,
      'decision',
      `⎇ Решение принято (${by === 'agent' ? 'агентом' : 'пользователем'}): ${pickedLabel}${
        isMixedResult ? ' — ветки активированы' : ' — ветка активирована'
      }, узлов в нереализованных ветках: ${discarded}`
    )

    // закрытие вопроса сужает вектор понимания задачи
    const after =
      dec.certaintyAfter ?? Math.min(0.95, (rt.snapshot.certainty ?? 0.4) + 0.15)
    this.emitCertainty(
      rt,
      Math.max(rt.snapshot.certainty ?? 0, after),
      isMixedResult
        ? `смешанное решение по вопросу «${trunc(node.title, 48)}»`
        : `вопрос «${trunc(node.title, 48)}» закрыт`
    )
  }

  /** Переключение режима решений на ходу; «авто» во время ожидания — агент решает немедленно */
  setDecisionMode(runId: string, mode: DecisionMode): { ok: boolean; error?: string } {
    const rt = this.runs.get(runId)
    if (!rt) return { ok: false, error: 'Запуск не активен или уже выгружен' }
    if (rt.decisionMode === mode) return { ok: true }
    rt.decisionMode = mode
    rt.snapshot.decisionMode = mode
    this.emitEvent(rt, { type: 'decision:mode', ts: now(), mode })
    this.log(
      rt,
      'control',
      `⎇ Режим решений: ${mode === 'auto' ? '«авто» — агент решает сам' : '«ручной выбор» — агент предлагает варианты и ждёт'}`
    )
    store.save(rt.snapshot)
    // если сейчас ожидается выбор, а включили «авто» — агент принимает решение вместо пользователя
    if (mode === 'auto' && rt.pendingDecision) {
      const pd = rt.pendingDecision
      rt.pendingDecision = null
      const node = rt.snapshot.nodes.find((n) => n.id === pd.nodeId)
      if (node?.decision) {
        this.log(rt, 'decision', '⎇ Ожидание выбора прервано: агент принимает решение вместо пользователя')
        this.autoDecide(rt, node)
          .then((picked) => pd.resolve({ optionIds: picked.optionIds, by: 'agent', reasoning: picked.reasoning }))
          .catch(() => pd.resolve(null))
      } else {
        pd.resolve(null)
      }
    }
    return { ok: true }
  }

  /** Выбор пользователя на развилке (из модалки): один или несколько вариантов */
  resolveDecisionFromUser(runId: string, nodeId: string, optionIds: string[]): { ok: boolean; error?: string } {
    const rt = this.runs.get(runId)
    if (!rt) return { ok: false, error: 'Запуск не активен' }
    const pd = rt.pendingDecision
    if (!pd || pd.nodeId !== nodeId) return { ok: false, error: 'Решение не ожидается (уже принято или запуск завершён)' }
    const node = rt.snapshot.nodes.find((n) => n.id === nodeId)
    const dec = node?.decision
    const ids = (optionIds || []).map((id) => String(id).trim().toLowerCase())
    if (!dec || !ids.length || !ids.every((id) => dec.options.some((o) => o.id === id))) {
      return { ok: false, error: 'Неизвестный вариант' }
    }
    rt.pendingDecision = null
    pd.resolve({ optionIds: ids, by: 'user' })
    return { ok: true }
  }

  // ─────────────── Управление и вмешательство пользователя ───────────────

  control(runId: string, action: 'pause' | 'resume' | 'stop') {
    const rt = this.runs.get(runId)
    if (!rt) return
    if (action === 'pause') {
      if (!rt.paused && !rt.stopped && rt.snapshot.status === 'running') {
        rt.paused = true
        this.pushStatus(rt, 'paused', rt.snapshot.progress)
        this.log(rt, 'control', '⏸ Пауза: текущий узел завершится, новые не стартуют')
      }
    } else if (action === 'resume') {
      if (rt.paused) {
        rt.paused = false
        this.log(rt, 'control', '▶ Выполнение возобновлено')
        if (rt.snapshot.status === 'paused') {
          this.pushStatus(rt, 'running', rt.snapshot.progress)
        }
      }
    } else if (action === 'stop') {
      if (rt.stopped) return
      if (['completed', 'error', 'stopped'].includes(rt.snapshot.status)) return
      rt.stopped = true
      rt.paused = false
      // если ждём выбор пользователя на развилке — разблокируем ожидание
      if (rt.pendingDecision) {
        const pd = rt.pendingDecision
        rt.pendingDecision = null
        pd.resolve(null)
      }
      this.log(rt, 'control', '⏹ Остановка запрошена — применится после завершения текущего узла')
    }
  }

  private async waitWhilePaused(rt: Runtime) {
    while (rt.paused && !rt.stopped) await sleep(150)
  }

  private finalizeStopped(rt: Runtime) {
    const run = rt.snapshot
    let skipped = 0
    for (const n of run.nodes) {
      if (n.status === 'pending') {
        n.status = 'skipped'
        skipped++
        this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...n } })
      }
    }
    this.recalcProgress(rt)
    this.pushStatus(rt, 'stopped', run.progress)
    const doneCount = run.nodes.filter((n) => n.status === 'done').length
    const u = run.usage
    const usageTotal = u
      ? ` · токены: ↑${fmtK(u.inputTokens)} / ↓${fmtK(u.outputTokens)} (${u.calls} вызов. LLM)${
          u.costUsd ? ` · ≈${fmtUsd(u.costUsd)}` : ''
        }`
      : ''
    this.log(rt, 'run', `Выполнение остановлено пользователем · выполнено узлов: ${doneCount}, пропущено: ${skipped}${usageTotal}`)
    run.finishedAt = now()
    store.save(run)
  }

  private finalizeCompleted(rt: Runtime) {
    const run = rt.snapshot
    rt.stopped = false
    run.progress = 100
    this.pushStatus(rt, 'completed', 100)
    run.finishedAt = now()
    const dynamic = run.nodes.filter((n) => n.dynamic).length
    const durS = ((run.finishedAt - run.createdAt) / 1000).toFixed(1)
    const last = [...run.nodes].filter((n) => n.status === 'done').pop()
    // Аудит токенов и стоимости (ADR-015/016): итог запуска в summary и журнале
    const u = run.usage
    const usageTotal = u
      ? ` · токены: ↑${fmtK(u.inputTokens)} / ↓${fmtK(u.outputTokens)} (${u.calls} вызов. LLM)${
          u.costUsd ? ` · ≈${fmtUsd(u.costUsd)}` : ''
        }`
      : ''
    const summary = `Готово за ${durS} с: ${run.nodes.length} узлов, ${dynamic} добавлено динамически, версий графа — ${run.version}${usageTotal}. Итог: ${trunc(last?.output || '—', 220)}`
    run.summary = summary
    this.emitEvent(rt, { type: 'run:summary', ts: now(), summary })
    this.log(rt, 'run', `✓ Задача выполнена за ${durS} с${usageTotal}`)
    store.save(run)
  }

  private recalcProgress(rt: Runtime) {
    const run = rt.snapshot
    // нереализованные ветки не считаются работой: прогресс по активным узлам
    const active = run.nodes.filter((n) => n.status !== 'discarded').length || 1
    const done = run.nodes.filter((n) => n.status === 'done').length
    run.progress = Math.round((done / active) * 100)
  }

  private downstreamOf(run: RunSnapshot, nodeId: string): GraphNode[] {
    const out: GraphNode[] = []
    const queue = [nodeId]
    const seen = new Set<string>()
    while (queue.length) {
      const cur = queue.shift()!
      for (const n of run.nodes) {
        if (n.dependsOn.includes(cur) && !seen.has(n.id)) {
          seen.add(n.id)
          out.push(n)
          queue.push(n.id)
        }
      }
    }
    return out
  }

  overrideNode(runId: string, nodeId: string, output: string): { ok: boolean; error?: string; resetCount?: number } {
    const rt = this.runs.get(runId)
    if (!rt) return { ok: false, error: 'Запуск не активен или уже выгружен' }
    const run = rt.snapshot
    const node = run.nodes.find((n) => n.id === nodeId && n.status === 'done')
    if (!node) return { ok: false, error: 'Узел не найден или ещё не завершён' }
    if (rt.stopped) return { ok: false, error: 'Запуск остановлен — переопределение недоступно' }
    const trimmed = (output || '').trim()
    if (!trimmed) return { ok: false, error: 'Результат не может быть пустым' }

    node.output = trimmed
    node.overridden = true
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
    this.log(rt, 'intervention', `✎ Вмешательство: результат узла «${node.title}» переопределён пользователем`)

    // нереализованные ветки не восстанавливаем — выбор на развилке остаётся в силе
    const down = this.downstreamOf(run, nodeId).filter((d) => d.status !== 'discarded')
    for (const d of down) {
      d.status = 'pending'
      d.output = undefined
      d.startedAt = undefined
      d.finishedAt = undefined
      d.durationMs = undefined
      d.error = undefined
      d.overridden = false
      this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...d } })
    }
    if (down.length) {
      this.log(rt, 'intervention', `↓ Пересчёт: ${down.length} зависимых узлов сброшены и будут выполнены заново`)
      this.recalcProgress(rt)
    }
    if (down.length && !rt.loopActive) {
      this.pushStatus(rt, 'running', run.progress)
      this.runLoop(rt).catch(() => {})
    }
    store.save(run)
    return { ok: true, resetCount: down.length }
  }

  retryNode(runId: string, nodeId: string): { ok: boolean; error?: string } {
    const rt = this.runs.get(runId)
    if (!rt) return { ok: false, error: 'Запуск не активен' }
    const node = rt.snapshot.nodes.find((n) => n.id === nodeId)
    if (!node || node.status !== 'error') return { ok: false, error: 'Узел не в состоянии ошибки' }
    rt.stopped = false
    node.status = 'pending'
    node.error = undefined
    node.startedAt = undefined
    node.finishedAt = undefined
    node.durationMs = undefined
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
    this.log(rt, 'intervention', `↻ Повтор узла «${node.title}» по запросу пользователя`)
    if (!rt.loopActive) {
      this.pushStatus(rt, 'running', rt.snapshot.progress)
      this.runLoop(rt).catch(() => {})
    }
    store.save(rt.snapshot)
    return { ok: true }
  }

  deleteRun(runId: string) {
    const rt = this.runs.get(runId)
    if (rt) {
      rt.stopped = true
      if (rt.pendingDecision) {
        const pd = rt.pendingDecision
        rt.pendingDecision = null
        pd.resolve(null)
      }
      this.runs.delete(runId)
    }
    store.remove(runId)
    this.emit('history:list', { runs: store.history() })
  }
}
