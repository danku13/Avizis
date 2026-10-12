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

/** Провайдер LLM для provenance: каким адаптером/моделью выполнен вызов (без ключей) */
export interface LlmProviderInfo {
  /** 'zai' | 'openai-compatible' (допускается произвольный идентификатор адаптера) */
  adapter: string
  model: string
}

/** Затраты LLM-вызовов одного узла: токены (ADR-015) + стоимость в USD (ADR-016) */
export interface NodeUsage {
  input: number
  output: number
  /** Оценка стоимости вызовов узла в USD (динамический прайсинг; отсутствует — цена модели неизвестна) */
  costUsd?: number
}

/** Сводка использования LLM по запуску: токены (ADR-015) + стоимость (ADR-016) */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  calls: number
  /** Оценка суммарной стоимости в USD (динамический прайсинг ADR-016) */
  costUsd?: number
  /** Вызовы без известной цены модели (стоимость не оценена) */
  unpricedCalls?: number
  byRole: Record<string, { inputTokens: number; outputTokens: number; calls: number; costUsd?: number }>
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
  /** Provenance: адаптер/модель, выполнившие LLM-вызов этого узла */
  llm?: LlmProviderInfo
  /** Затраты токенов LLM-вызовов узла (ADR-015): исполнитель или решатель развилки */
  usage?: NodeUsage
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
    /** Аудит усечений структурных лимитов (ADR-013): «Лимит плана/адаптации: …» */
    | 'limits'
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
  /** Аудит токенов и стоимости (ADR-015/016): один успешный LLM-вызов; nodeId — атрибуция узлу.
   *  adapter/model — provenance вызова; costUsd — оценка по динамическому прайсу (нет цены — нет поля) */
  | {
      type: 'llm:usage'
      ts: number
      role: string
      nodeId?: string
      inputTokens: number
      outputTokens: number
      adapter?: string
      model?: string
      costUsd?: number
      /** 'manual' | 'openrouter' | 'litellm' — источник прайса стоимости */
      priceSource?: string
    }

export interface RunSnapshot {
  id: string
  task: string
  mode: RunMode
  /** Режим решений на развилках (можно менять на ходу) */
  decisionMode: DecisionMode
  /** Provenance: роль → адаптер/модель, зафиксировано при старте LLM-прогона (без ключей) */
  llm?: Record<string, LlmProviderInfo>
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
  /** Использование токенов LLM по запуску (появляется с первым вызовом; демо — отсутствует) */
  usage?: RunUsage
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
