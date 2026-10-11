// TACG — Transparent Agent Computation Graph
// Общие типы движка агента (дублируются на фронтенде: src/lib/tacg/types.ts)

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
  /** Причина динамического добавления (для узлов, добавленных супервайзером) */
  reason?: string
  /** Версия графа, в которой узел появился (1 = исходный план) */
  addedAtVersion?: number
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** Добавлен динамически в процессе выполнения */
  dynamic: boolean
  /** Результат переопределён пользователем (вмешательство) */
  overridden?: boolean
  /** Сколько раз узел запускался (повторы/пересчёты) */
  runs?: number
}

export interface GraphVersion {
  version: number
  createdAt: number
  description: string
  nodeIds: string[]
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
  versions: GraphVersion[]
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
