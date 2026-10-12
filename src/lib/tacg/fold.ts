// TACG — свёртка потока событий в состояние запуска (для live-вида и replay)
import { DecisionMode, GraphEdge, GraphNode, LlmProviderInfo, LogEntry, RunEvent, RunStatus, RunUsage, RunView } from './types'

/** Свёртка событий 0..n в состояние графа ( ядро режима «Воспроизведение» )
 *  base.llm — provenance из снапшота (события его не несут, он приходит с run:created/run:snapshot) */
export function foldEvents(events: RunEvent[], base?: { llm?: Record<string, LlmProviderInfo> }): RunView {
  const nodes = new Map<string, GraphNode>()
  let version = 0
  let status: RunStatus = 'planning'
  let progress = 0
  let summary: string | undefined
  let decisionMode: DecisionMode = 'manual'
  let certainty: number | undefined
  const logs: LogEntry[] = []
  let usage: RunUsage | undefined

  for (const ev of events) {
    switch (ev.type) {
      case 'graph:init':
        nodes.clear()
        ev.nodes.forEach((n) => nodes.set(n.id, { ...n }))
        version = 1
        break
      case 'graph:adapt':
        ev.nodes.forEach((n) => nodes.set(n.id, { ...n }))
        version = ev.version
        break
      case 'node:update':
        nodes.set(ev.node.id, { ...ev.node })
        break
      case 'run:status':
        status = ev.status
        progress = ev.progress
        break
      case 'log':
        logs.push(ev.entry)
        break
      case 'run:summary':
        summary = ev.summary
        break
      case 'run:certainty':
        certainty = ev.certainty
        break
      case 'llm:usage': {
        // Аудит токенов и стоимости (ADR-015/016): копим сводку и атрибутируем узлу
        // (в replay — до курсора); costUsd считается движком по динамическому прайсу
        usage ??= { inputTokens: 0, outputTokens: 0, calls: 0, byRole: {} }
        usage.inputTokens += ev.inputTokens
        usage.outputTokens += ev.outputTokens
        usage.calls += 1
        if (ev.costUsd != null) usage.costUsd = (usage.costUsd ?? 0) + ev.costUsd
        else usage.unpricedCalls = (usage.unpricedCalls ?? 0) + 1
        const r = (usage.byRole[ev.role] ??= { inputTokens: 0, outputTokens: 0, calls: 0 })
        r.inputTokens += ev.inputTokens
        r.outputTokens += ev.outputTokens
        r.calls += 1
        if (ev.costUsd != null) r.costUsd = (r.costUsd ?? 0) + ev.costUsd
        if (ev.nodeId) {
          const n = nodes.get(ev.nodeId)
          if (n) {
            const u = (n.usage ??= { input: 0, output: 0 })
            u.input += ev.inputTokens
            u.output += ev.outputTokens
            if (ev.costUsd != null) u.costUsd = (u.costUsd ?? 0) + ev.costUsd
          }
        }
        break
      }
      case 'decision:offer':
      case 'decision:resolved':
        // состояние развилки переносится через node:update; события — сигнал для UI
        break
      case 'decision:mode':
        decisionMode = ev.mode
        break
    }
  }
  return { nodes: [...nodes.values()], version, status, progress, logs, summary, decisionMode, certainty, llm: base?.llm, usage }
}

/** Рёбра графа выводятся из зависимостей узлов */
export function computeEdges(nodes: GraphNode[]): GraphEdge[] {
  const ids = new Set(nodes.map((n) => n.id))
  return nodes.flatMap((n) =>
    n.dependsOn
      .filter((d) => ids.has(d))
      .map((d) => ({ id: `${d}->${n.id}`, from: d, to: n.id }))
  )
}

/** Узел-развилка, ожидающая выбора прямо сейчас (в live-режиме — требует реакции) */
export function findOfferedDecision(nodes: GraphNode[]): GraphNode | undefined {
  return nodes.find(
    (n) => n.kind === 'decision' && n.decision?.status === 'offered' && !n.decision?.chosen && n.status === 'running'
  )
}

export interface VersionMarker {
  version: number
  eventIndex: number
  description: string
}

/** Точки «срезов версий» графа: v1 = исходный план, далее — адаптации
 *  (описание v1 — через переводчик: строка живёт в UI-словаре) */
export function versionMarkers(events: RunEvent[], v1Label: string = 'Исходный план агента'): VersionMarker[] {
  const out: VersionMarker[] = []
  events.forEach((ev, i) => {
    if (ev.type === 'graph:init') {
      out.push({ version: 1, eventIndex: i, description: v1Label })
    } else if (ev.type === 'graph:adapt') {
      out.push({ version: ev.version, eventIndex: i, description: ev.reason })
    }
  })
  return out
}

/** Индексы «крупных» событий — риски на шкале таймлайна */
export function timelineTicks(events: RunEvent[]): number[] {
  const ticks: number[] = []
  events.forEach((ev, i) => {
    if (ev.type === 'node:update' && (ev.node.status === 'done' || ev.node.status === 'error')) ticks.push(i)
    else if (ev.type === 'graph:adapt') ticks.push(i)
    else if (ev.type === 'run:summary') ticks.push(i)
    else if (ev.type === 'decision:offer' || ev.type === 'decision:resolved') ticks.push(i)
  })
  return ticks
}
