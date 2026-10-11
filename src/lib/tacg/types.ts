// TACG — общие типы клиентской части (зеркало mini-services/tacg-agent/types.ts)

export type NodeStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'discarded'
export type RunStatus = 'planning' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
export type RunMode = 'demo' | 'llm'

/** Режим принятия решений на развилках */
export type DecisionMode = 'auto' | 'manual'

/** Вариант на развилке: обоснование + превью дальнейших шагов */
export interface DecisionOption {
  id: string
  label: string
  /** Обоснование: плюсы, минусы, цена выбора */
  rationale: string
  /** Названия шагов, которые выполнит эта ветка (превью последствий) */
  nextSteps: string[]
}

/** Состояние развилки в узле-решении */
export interface DecisionState {
  question: string
  options: DecisionOption[]
  status: 'pending' | 'offered' | 'resolved'
  /** Выбранный вариант (id из options) */
  chosen?: string
  /** Кто принял решение */
  chosenBy?: 'agent' | 'user'
  /** Обоснование выбора (в авто-режиме — рассуждение агента) */
  reasoning?: string
}

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
  /** Тип узла: обычный шаг или развилка (решение) */
  kind?: 'step' | 'decision'
  /** Присутствует у узлов-развилок */
  decision?: DecisionState
  /** Принадлежность узла ветке варианта развилки */
  branchOf?: { decisionId: string; optionId: string }
}

export interface LogEntry {
  id: string
  ts: number
  kind:
    | 'plan'
    | 'node-start'
    | 'node-done'
    | 'node-error'
    | 'adapt'
    | 'control'
    | 'intervention'
    | 'decision'
    | 'run'
    | 'info'
  message: string
}

export type RunEvent =
  | { type: 'graph:init'; ts: number; nodes: GraphNode[] }
  | { type: 'graph:adapt'; ts: number; reason: string; version: number; nodes: GraphNode[] }
  | { type: 'node:update'; ts: number; node: GraphNode }
  | { type: 'run:status'; ts: number; status: RunStatus; progress: number }
  | { type: 'log'; ts: number; entry: LogEntry }
  | { type: 'run:summary'; ts: number; summary: string }
  | { type: 'decision:offer'; ts: number; nodeId: string; question: string; options: DecisionOption[] }
  | {
      type: 'decision:resolved'
      ts: number
      nodeId: string
      optionId: string
      by: 'agent' | 'user'
      reasoning?: string
    }
  | { type: 'decision:mode'; ts: number; mode: DecisionMode }

export interface RunSnapshot {
  id: string
  task: string
  mode: RunMode
  /** Режим решений на развилках (можно менять на ходу) */
  decisionMode?: DecisionMode
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
  /** Режим решений на момент свёртки (для playback) */
  decisionMode: DecisionMode
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
  discarded: 'Не реализовано',
}

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  planning: 'Планирование',
  running: 'Выполняется',
  paused: 'Пауза',
  stopped: 'Остановлено',
  completed: 'Завершено',
  error: 'Ошибка',
}

export const DECISION_MODE_LABELS: Record<DecisionMode, string> = {
  auto: 'Авто — агент решает сам',
  manual: 'Вручную — агент предлагает и ждёт',
}
