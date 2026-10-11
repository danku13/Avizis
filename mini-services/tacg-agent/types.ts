// TACG — Transparent Agent Computation Graph
// Общие типы движка агента (дублируются на фронтенде: src/lib/tacg/types.ts)

export type NodeStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'discarded'
export type RunStatus = 'planning' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
export type RunMode = 'demo' | 'llm'

/** Режим принятия решений на развилках */
export type DecisionMode = 'auto' | 'manual'

/** Домен уточнения: какая сторона задачи закрывается вопросом на развилке */
export type DecisionDomain =
  | 'scope' // расширение/сужение объёма работ
  | 'specialization' // специализация подхода
  | 'product' // продуктовые вопросы (цели, ценность, аудитория)
  | 'architecture' // архитектурные вопросы (разработка)
  | 'tone' // tone of voice (тексты)
  | 'format' // формат результата (статья/заметка/пост)
  | 'context' // уточнение контекста задачи
  | 'strategy' // стратегия выполнения

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
  /** Домен уточнения (для бейджа и отчёта) */
  domain?: DecisionDomain
  /** single — выбрать один вариант; mixed — смешанное решение из нескольких */
  selection: 'single' | 'mixed'
  options: DecisionOption[]
  status: 'pending' | 'offered' | 'resolved'
  /** Выбранные варианты (при mixed — несколько) */
  chosen?: string[]
  /** Кто принял решение */
  chosenBy?: 'agent' | 'user'
  /** Обоснование выбора (в авто-режиме — рассуждение агента) */
  reasoning?: string
  /** Оценка «понимания задачи» после закрытия вопроса (0..1) */
  certaintyAfter?: number
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
  /** Тип узла: обычный шаг или развилка (решение) */
  kind?: 'step' | 'decision'
  /** Присутствует у узлов-развилок */
  decision?: DecisionState
  /** Принадлежность узла ветке варианта развилки */
  branchOf?: { decisionId: string; optionId: string }
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
      /** Выбранные варианты (при mixed — несколько) */
      optionIds: string[]
      by: 'agent' | 'user'
      reasoning?: string
    }
  | { type: 'decision:mode'; ts: number; mode: DecisionMode }
  /** Агент переоценил «понимание задачи» (насколько узкий вектор решения) */
  | { type: 'run:certainty'; ts: number; certainty: number; note?: string }

export interface RunSnapshot {
  id: string
  task: string
  mode: RunMode
  /** Режим решений на развилках (можно менять на ходу) */
  decisionMode: DecisionMode
  status: RunStatus
  createdAt: number
  finishedAt?: number
  progress: number
  /** Оценка агентом «понимания задачи» (0..1): насколько узкий вектор решения */
  certainty?: number
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
