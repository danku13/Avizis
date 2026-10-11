// TACG — общие типы клиентской части (зеркало mini-services/tacg-agent/types.ts)

export type NodeStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'discarded'
export type RunStatus = 'planning' | 'running' | 'paused' | 'stopped' | 'completed' | 'error'
export type RunMode = 'demo' | 'llm'

/** Режим принятия решений на развилках */
export type DecisionMode = 'auto' | 'manual'

/** Домен уточнения: какая сторона задачи закрывается вопросом на развилке */
export type DecisionDomain =
  | 'scope'
  | 'specialization'
  | 'product'
  | 'architecture'
  | 'tone'
  | 'format'
  | 'context'
  | 'strategy'

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
  selection?: 'single' | 'mixed'
  options: DecisionOption[]
  status: 'pending' | 'offered' | 'resolved'
  /** Выбранные варианты (при mixed — несколько); может быть строкой в старых прогонах */
  chosen?: string[] | string
  /** Кто принял решение */
  chosenBy?: 'agent' | 'user'
  /** Обоснование выбора (в авто-режиме — рассуждение агента) */
  reasoning?: string
  /** Оценка «понимания задачи» после закрытия вопроса (0..1) */
  certaintyAfter?: number
}

/** Роль LLM движка (BYOK): точка вызова */
export type LlmRole = 'planner' | 'executor' | 'supervisor' | 'decider'

/** Provenance: адаптер/модель, выполнившие LLM-вызов (ключи сюда не попадают) */
export interface LlmProviderInfo {
  /** 'zai' | 'openai-compatible' (допускается произвольный идентификатор) */
  adapter: string
  model: string
}

/** Публичная (маскированная) конфигурация провайдера — apiKey здесь всегда маска */
export interface LlmProviderConfigPublic {
  adapter: string
  baseUrl?: string
  model?: string
  /** Маска ключа (первые 3 + «…» + последние 4); полный ключ не покидает сервер */
  apiKey?: string
  temperature?: number
}

/** Публичная конфигурация LLM: дефолт + per-role переопределения */
export interface LlmConfigPublic {
  default?: LlmProviderConfigPublic
  roles?: Partial<Record<LlmRole, Partial<LlmProviderConfigPublic>>>
}

export const LLM_ROLE_LABELS: Record<string, string> = {
  planner: 'Планировщик',
  executor: 'Исполнитель',
  supervisor: 'Супервайзер',
  decider: 'Решатель',
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
  /** Provenance: адаптер/модель, выполнившие LLM-вызов этого узла */
  llm?: LlmProviderInfo
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
      /** Выбранные варианты (при mixed — несколько); в старых прогонах — строка */
      optionIds: string[] | string
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
  decisionMode?: DecisionMode
  /** Provenance: роль → адаптер/модель (фиксируется при старте LLM-прогона, без ключей) */
  llm?: Record<string, LlmProviderInfo>
  status: RunStatus
  createdAt: number
  finishedAt?: number
  progress: number
  /** Оценка агентом «понимания задачи» (0..1) */
  certainty?: number
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
  /** Оценка «понимания задачи» агентом на момент свёртки (0..1) */
  certainty?: number
  /** Provenance LLM (роль → адаптер/модель) — прокидывается из снапшота */
  llm?: Record<string, LlmProviderInfo>
}

/** Выбранные варианты развилки как массив (совместимость со старыми прогонами: chosen мог быть строкой) */
export const chosenIds = (dec: DecisionState | undefined): string[] => {
  if (!dec?.chosen) return []
  return Array.isArray(dec.chosen) ? dec.chosen : [dec.chosen]
}

/** Режим выбора развилки (старые прогоны — single) */
export const selectionMode = (dec: DecisionState | undefined): 'single' | 'mixed' =>
  dec?.selection === 'mixed' ? 'mixed' : 'single'

/** Человекочитаемая оценка «понимания задачи» */
export const certaintyLabel = (c: number): { label: string; hint: string } => {
  if (c < 0.35) return { label: 'Размытый вектор', hint: 'Поле решений широкое: агенту нужны уточнения' }
  if (c < 0.7) return { label: 'Вектор сужается', hint: 'Направление определено, часть аспектов ещё открыта' }
  return { label: 'Узкий вектор', hint: 'Требуемая точность достигнута — вектор решения задан жёстко' }
}

export const DECISION_DOMAIN_LABELS: Record<DecisionDomain, string> = {
  scope: 'Объём работ',
  specialization: 'Специализация',
  product: 'Продуктовый вопрос',
  architecture: 'Архитектура',
  tone: 'Tone of voice',
  format: 'Формат результата',
  context: 'Контекст задачи',
  strategy: 'Стратегия',
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
