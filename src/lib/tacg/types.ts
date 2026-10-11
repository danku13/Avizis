// TACG — общие типы клиентской части (зеркало mini-services/tacg-agent/types.ts)

export type NodeStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export type RunStatus = 'planning' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
export type RunMode = 'demo' | 'llm'

export interface GraphNode {
  id: string
  title: string
  description: string
  status: NodeStatus
  dependsOn: string[]
  input?: string
  output?: string
  error?: string
  /** Причина динамического добавления */
  reason?: string
  /** Версия графа, в которой узел появился (1 = исходный план) */
  addedAtVersion?: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** Добавлен динамически в процессе выполнения */
  dynamic: boolean
  /** Результат переопределён пользователем */
  overridden?: boolean
  runs?: number
}

export interface LogEntry {
  id: string
  ts: number
  kind: 'plan' | 'node-start' | 'node-done' | 'node-error' | 'adapt' | 'control' | 'intervention' | 'run' | 'info'
  message: string
}

export type RunEvent =
  | { type: 'graph:init'; ts: number; nodes: GraphNode[] }
  | { type: 'graph:adapt'; ts: number; reason: string; version: number; nodes: GraphNode[] }
  | { type: 'node:update'; ts: number; node: GraphNode }
  | { type: 'run:status'; ts: number; status: RunStatus; progress: number }
  | { type: 'log'; ts: number; entry: LogEntry }
  | { type: 'run:summary'; ts: number; summary: string }

export interface RunSnapshot {
  id: string
  task: string
  mode: RunMode
  status: RunStatus
  createdAt: number
  finishedAt?: number
  progress: number
  nodes: GraphNode[]
  version: number
  events: RunEvent[]
  logs: LogEntry[]
  summary?: string
}

export interface RunMeta {
  id: string
  task: string
  mode: RunMode
  status: RunStatus
  createdAt: number
  finishedAt?: number
  nodesCount: number
  doneCount: number
  dynamicCount: number
  version: number
  progress: number
}

/** Развёрнутое состояние запуска для отрисовки */
export interface RunView {
  nodes: GraphNode[]
  version: number
  status: RunStatus
  progress: number
  logs: LogEntry[]
  summary?: string
}

export interface GraphEdge {
  id: string
  from: string
  to: string
}

export const STATUS_LABELS: Record<NodeStatus, string> = {
  pending: 'Ожидает',
  running: 'Выполняется',
  done: 'Выполнено',
  error: 'Ошибка',
  skipped: 'Пропущено',
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planning: 'Планирование',
  running: 'Выполняется',
  paused: 'Пауза',
  stopped: 'Остановлено',
  completed: 'Завершено',
  error: 'Ошибка',
}
