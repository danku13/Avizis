// TACG — свёртка потока событий в состояние запуска (для live-вида и replay)
import { GraphEdge, GraphNode, LogEntry, RunEvent, RunStatus, RunView } from './types'

/** Свёртка событий 0..n в состояние графа ( ядро режима «Воспроизведение» ) */
export function foldEvents(events: RunEvent[]): RunView {
  const nodes = new Map<string, GraphNode>()
  let version = 0
  let status: RunStatus = 'planning'
  let progress = 0
  let summary: string | undefined
  const logs: LogEntry[] = []

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
    }
  }
  return { nodes: [...nodes.values()], version, status, progress, logs, summary }
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

export interface VersionMarker {
  version: number
  eventIndex: number
  description: string
}

/** Точки «срезов версий» графа: v1 = исходный план, далее — адаптации */
export function versionMarkers(events: RunEvent[]): VersionMarker[] {
  const out: VersionMarker[] = []
  events.forEach((ev, i) => {
    if (ev.type === 'graph:init') {
      out.push({ version: 1, eventIndex: i, description: 'Исходный план агента' })
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
  })
  return ticks
}
