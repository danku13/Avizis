// Вычислительный движок агента TACG: планирование → пошаговое выполнение →
// динамическая адаптация → вмешательство пользователя. Реальные вызовы LLM
// выполняются через z-ai-web-dev-sdk (llm.ts), демо-режим — симуляция.
import { Server } from 'socket.io'
import { GraphNode, RunEvent, RunMode, RunSnapshot, RunStatus } from './types'
import { DEMO_ADAPTATIONS, DEFAULT_TASK, demoOutput, demoPlan, sleep } from './demo'
import { chatJson, chatText, getZai } from './llm'
import { store } from './store'

const now = () => Date.now()
const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')

export class StoppedError extends Error {
  constructor() {
    super('stopped')
  }
}

interface Runtime {
  snapshot: RunSnapshot
  stopped: boolean
  paused: boolean
  loopActive: boolean
  dynamicAdded: number
  demoAdaptDone: Set<number>
}

const PLANNER_SYS = `Ты — модуль планирования ИИ-агента. Твоя задача — разбить запрос пользователя на вычислительный граф из шагов. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток и пояснений.`

const EXECUTOR_SYS = `Ты — исполнительный модуль ИИ-агента внутри вычислительного графа. Выполни запрошенный шаг. Отвечай по-русски, лаконично и по делу (до 120 слов), без markdown-заголовков.`

const SUPERVISOR_SYS = `Ты — супервайзер вычислительного графа ИИ-агента. После завершения очередного узла ты решаешь, нужно ли ДОПОЛНИТЬ план новым шагом. Отвечай ТОЛЬКО валидным JSON.`

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

  private pushStatus(rt: Runtime, status: RunStatus, progress: number) {
    rt.snapshot.status = status
    rt.snapshot.progress = progress
    this.emitEvent(rt, { type: 'run:status', ts: now(), status, progress })
    if (status === 'completed' || status === 'stopped' || status === 'error') {
      this.emit('history:list', { runs: store.history() })
    }
  }

  // ─────────────────────────── Запуск ───────────────────────────

  async start(taskInput: string, mode: RunMode): Promise<RunSnapshot> {
    const task = (taskInput || '').trim().slice(0, 500) || DEFAULT_TASK
    const id = 'run_' + now().toString(36) + Math.random().toString(36).slice(2, 7)
    const run: RunSnapshot = {
      id,
      task,
      mode,
      status: 'planning',
      createdAt: now(),
      progress: 0,
      nodes: [],
      version: 0,
      versions: [],
      events: [],
      logs: [],
    }
    const rt: Runtime = { snapshot: run, stopped: false, paused: false, loopActive: false, dynamicAdded: 0, demoAdaptDone: new Set() }
    this.runs.set(id, rt)

    this.emit('run:created', { runId: id, task, mode, createdAt: run.createdAt })
    this.pushStatus(rt, 'planning', 0)
    this.log(rt, 'run', `Запуск агента · ${mode === 'demo' ? 'демо-режим (симуляция)' : 'LLM через z-ai-web-dev-sdk'} · задача: «${trunc(task, 90)}»`)

    if (mode === 'llm') {
      this.log(rt, 'plan', 'Планировщик LLM анализирует задачу…')
      try {
        await getZai()
      } catch (e: any) {
        this.log(rt, 'run', `Ошибка инициализации SDK: ${e?.message || e}`)
        this.pushStatus(rt, 'error', 0)
        store.save(run)
        return run
      }
    } else {
      this.log(rt, 'plan', 'Планировщик строит граф задачи…')
      await sleep(900)
    }

    let nodes: GraphNode[]
    if (mode === 'llm') {
      nodes = await this.planWithLLM(task, rt)
    } else {
      nodes = demoPlan()
    }

    this.emitEvent(rt, { type: 'graph:init', ts: now(), nodes })
    run.nodes = nodes.map((n) => ({ ...n }))
    run.version = 1
    run.versions.push({ version: 1, createdAt: now(), description: 'Исходный план агента', nodeIds: nodes.map((n) => n.id) })
    this.log(rt, 'plan', `План готов: ${nodes.length} узлов · версия графа v1`)
    this.pushStatus(rt, 'running', 0)
    this.log(rt, 'run', 'Выполнение графа началось')
    store.save(run)

    this.runLoop(rt).catch((err: any) => {
      this.log(rt, 'run', `Внутренняя ошибка цикла выполнения: ${err?.message || err}`)
      this.pushStatus(rt, 'error', run.progress)
    })
    return run
  }

  private async planWithLLM(task: string, rt: Runtime): Promise<GraphNode[]> {
    const user = `Задача пользователя: «${task}»

Составь план из 3–5 шагов. Формат ответа — строго один JSON-объект без каких-либо дополнений:
{"nodes":[{"id":"n1","title":"краткое название шага","description":"что делает шаг, 1-2 предложения","dependsOn":[]},{"id":"n2","title":"...","description":"...","dependsOn":["n1"]}]}

Правила:
- Названия и описания шагов — на русском языке.
- Первый узел имеет пустой dependsOn.
- dependsOn ссылается только на id уже объявленных узлов.
- Массив nodes обязан быть закрыт перед концом объекта.
- Граф простой: цепочка или максимум одно ветвление.
- Последний узел — формирование итогового результата.`
    try {
      const json = await chatJson(PLANNER_SYS, user, 60_000, 2)
      const nodes = this.sanitizePlan(json)
      if (nodes) {
        this.log(rt, 'plan', `Планировщик LLM построил граф из ${nodes.length} узлов`)
        return nodes
      }
      this.log(rt, 'info', 'Не удалось разобрать JSON плана — применён резервный план')
    } catch (e: any) {
      this.log(rt, 'info', `Планировщик LLM недоступен (${trunc(e?.message || '', 80)}) — применён резервный план`)
    }
    return demoPlan()
  }

  private sanitizePlan(json: any): GraphNode[] | null {
    if (!json || !Array.isArray(json.nodes) || json.nodes.length === 0) return null
    const raw = json.nodes.slice(0, 6)
    const idMap = new Map<string, string>()
    raw.forEach((n: any, i: number) => idMap.set(String(n?.id || `x${i}`), `n${i + 1}`))
    const nodes: GraphNode[] = []
    raw.forEach((n: any, i: number) => {
      const id = `n${i + 1}`
      const deps = Array.isArray(n?.dependsOn)
        ? [...new Set(n.dependsOn.map((d: any) => idMap.get(String(d))).filter((d): d is string => !!d && d !== id && d < id))]
        : i > 0
          ? [`n${i}`]
          : []
      nodes.push({
        id,
        title: String(n?.title || `Шаг ${i + 1}`).slice(0, 60),
        description: String(n?.description || '').slice(0, 240),
        status: 'pending',
        dependsOn: deps,
        dynamic: false,
        runs: 0,
      })
    })
    return nodes
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
            this.pushStatus(rt, 'error', run.progress)
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

        try {
          const output =
            run.mode === 'demo' ? await this.demoExecute(node, rt) : await this.llmExecute(run, node)
          node.status = 'done'
          node.output = output
          node.finishedAt = now()
          node.durationMs = node.finishedAt - (node.startedAt ?? node.finishedAt)
          this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
          this.log(rt, 'node-done', `✓ «${node.title}» — завершён за ${((node.durationMs ?? 0) / 1000).toFixed(1)} с`)
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
          this.log(rt, 'node-error', `✗ «${node.title}» — ошибка: ${trunc(node.error, 140)}`)
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
    const ready = (n: GraphNode) =>
      n.dependsOn.every((d) => {
        const dep = byId.get(d)
        return !dep || dep.status === 'done' || dep.status === 'skipped'
      })
    return run.nodes.find((n) => n.status === 'pending' && ready(n))
  }

  private buildInput(run: RunSnapshot, node: GraphNode): string {
    const deps = node.dependsOn
      .map((id) => run.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => !!n && n.status === 'done')
    if (!deps.length) return `Задача: ${run.task}`
    return `Задача: ${run.task}\n\nРезультаты предыдущих шагов:\n${deps
      .map((d) => `• «${d.title}»: ${trunc(d.output || '—', 260)}`)
      .join('\n')}`
  }

  private async demoExecute(node: GraphNode, rt: Runtime): Promise<string> {
    const base = demoOutput(node, rt.snapshot.task)
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

  private async llmExecute(run: RunSnapshot, node: GraphNode): Promise<string> {
    const user = `Задача пользователя: «${run.task}»

Текущий шаг: «${node.title}»
Описание шага: ${node.description || '—'}

${node.input || `Задача: ${run.task}`}

Выполни текущий шаг и верни его результат.`
    return chatText(EXECUTOR_SYS, user, 90_000, 1)
  }

  // ───────────────────── Динамическая адаптация ─────────────────────

  private async maybeAdapt(rt: Runtime, finished: GraphNode) {
    const run = rt.snapshot
    if (run.mode === 'demo') {
      const idx = DEMO_ADAPTATIONS.findIndex((a, i) => a.after === finished.id && !rt.demoAdaptDone.has(i))
      if (idx < 0) return
      rt.demoAdaptDone.add(idx)
      await sleep(450)
      const spec = DEMO_ADAPTATIONS[idx]
      this.insertNode(rt, { ...spec.node, dependsOn: [finished.id] }, spec.reason)
      return
    }

    // LLM-режим: супервайзер решает, нужен ли дополнительный шаг
    if (rt.dynamicAdded >= 2) return
    const hasPendingSuccessors = run.nodes.some((n) => n.status === 'pending' && n.dependsOn.includes(finished.id))
    const anyPending = run.nodes.some((n) => n.status === 'pending')
    if (!hasPendingSuccessors && !anyPending) return
    if (run.nodes.filter((n) => n.dynamic).length >= 2) return

    const graphDesc = run.nodes
      .map((n) => `- ${n.id} «${n.title}» [${n.status}]${n.output ? ': ' + trunc(n.output, 110) : ''}`)
      .join('\n')
    const user = `Задача: «${run.task}»

Текущий граф:
${graphDesc}

Только что завершён узел «${finished.title}»: ${trunc(finished.output || '', 300)}

Вопрос: есть ли ЯВНЫЙ пробел, который стоит закрыть дополнительным шагом перед выполнением следующих узлов? В подавляющем большинстве случаев отвечай no_changes — добавляй узел только при реальном пробеле (например, данные требуют валидации, а её нет в плане).

Формат ответа:
{"decision":"no_changes"}
или
{"decision":"add_node","node":{"title":"...","description":"...","reason":"почему добавляем"}}`

    try {
      const json = await chatJson(SUPERVISOR_SYS, user, 45_000, 0)
      if (json?.decision === 'add_node' && json.node?.title) {
        const id = `dyn${rt.dynamicAdded + 1}`
        this.insertNode(
          rt,
          {
            id,
            title: String(json.node.title).slice(0, 60),
            description: String(json.node.description || '').slice(0, 240),
            dependsOn: [finished.id],
          },
          String(json.node.reason || 'Выявлен пробел в плане').slice(0, 240)
        )
      }
    } catch {
      /* супервайзер недоступен → план не меняем */
    }
  }

  private insertNode(rt: Runtime, spec: { id: string; title: string; description: string; dependsOn: string[] }, reason: string) {
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
    this.log(rt, 'run', `Выполнение остановлено пользователем · выполнено узлов: ${doneCount}, пропущено: ${skipped}`)
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
    const summary = `Готово за ${durS} с: ${run.nodes.length} узлов, ${dynamic} добавлено динамически, версий графа — ${run.version}. Итог: ${trunc(last?.output || '—', 220)}`
    run.summary = summary
    this.emitEvent(rt, { type: 'run:summary', ts: now(), summary })
    this.log(rt, 'run', `✓ Задача выполнена за ${durS} с`)
    store.save(run)
  }

  private recalcProgress(rt: Runtime) {
    const run = rt.snapshot
    const total = run.nodes.length || 1
    const done = run.nodes.filter((n) => n.status === 'done').length
    run.progress = Math.round((done / total) * 100)
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

    node.output = trimmed.slice(0, 4000)
    node.overridden = true
    this.emitEvent(rt, { type: 'node:update', ts: now(), node: { ...node } })
    this.log(rt, 'intervention', `✎ Вмешательство: результат узла «${node.title}» переопределён пользователем`)

    const down = this.downstreamOf(run, nodeId)
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
      this.runs.delete(runId)
    }
    store.remove(runId)
    this.emit('history:list', { runs: store.history() })
  }
}
