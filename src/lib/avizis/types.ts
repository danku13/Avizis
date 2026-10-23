// Avizis — общие типы клиентской части (зеркало mini-services/avizis-agent/types.ts)

import type { Locale } from './i18n'

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

/** Затраты LLM-вызовов одного узла (ADR-015): токены + стоимость (ADR-016) */
export interface NodeUsage {
  input: number
  output: number
  /** Оценка стоимости вызовов узла в USD (динамический прайсинг; нет цены — нет поля) */
  costUsd?: number
}

/** Сводка использования LLM по запуску (ADR-015/016): токены + стоимость */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  calls: number
  /** Оценка суммарной стоимости в USD (динамический прайсинг) */
  costUsd?: number
  /** Вызовы без известной цены модели (стоимость не оценена) */
  unpricedCalls?: number
  byRole: Record<string, { inputTokens: number; outputTokens: number; calls: number; costUsd?: number }>
}

/** Форматирование числа токенов: 940 → «940», 1200 → «1,2k» (EN: 1.2k) */
export const fmtTokens = (n: number, locale: Locale = 'ru'): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', locale === 'ru' ? ',' : '.')}k`
  return String(n)
}

/** Формат суммы USD: $123 / $1,23 / $0,0123 — 3 значащих цифры до $1 (как fmtUsd движка);
 *  десятичный разделитель — по локали (ru: запятая, en: точка) */
export const fmtUsd = (v: number, locale: Locale = 'ru'): string => {
  if (!Number.isFinite(v) || v <= 0) return '$0'
  let s: string
  if (v >= 100) s = v.toFixed(0)
  else if (v >= 1) s = v.toFixed(2)
  else s = String(parseFloat(v.toPrecision(3)))
  return '$' + (locale === 'ru' ? s.replace('.', ',') : s)
}

/** Человекочитаемый источник прайса (ADR-016), по языку */
export const PRICE_SOURCE_LABELS: Record<Locale, Record<string, string>> = {
  ru: {
    manual: 'вручную (конфиг)',
    openrouter: 'OpenRouter',
    litellm: 'каталог LiteLLM',
  },
  en: {
    manual: 'manual (config)',
    openrouter: 'OpenRouter',
    litellm: 'LiteLLM catalog',
  },
}

/** Подпись источника прайса с фолбэком на ru */
export const priceSourceLabel = (id: string, locale: Locale): string =>
  PRICE_SOURCE_LABELS[locale][id] ?? PRICE_SOURCE_LABELS.ru[id] ?? id

/** Статус одного источника прайсов (для блока в настройках) */
export interface PricingSourceStatus {
  id: 'manual' | 'openrouter' | 'litellm'
  label: string
  models: number
  fetchedAt?: number
  ok?: boolean
  error?: string
}

/** Статус динамического прайсинга с сервера (socket 'pricing:status') */
export interface PricingStatus {
  sources: PricingSourceStatus[]
  ttlHours: number
  disabled: boolean
}

// ─────────────────────── Конвертация валюты (ADR-019, FR-910) ───────────────────────

/** Валюты отображения стоимости: символы для форматирования */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', RUB: '₽', KZT: '₸', CNY: '¥', GBP: '£', TRY: '₺',
  AED: 'DH', INR: '₹', BYN: 'Br', UAH: '₴', GEL: '₾', JPY: '¥', CHF: 'Fr', KRW: '₩',
}

export const CURRENCY_SOURCE_LABELS: Record<Locale, Record<string, string>> = {
  ru: {
    manual: 'вручную (конфиг)',
    cbr: 'ЦБ РФ',
    'cbr-mirror': 'ЦБ РФ (зеркало)',
    'er-api': 'open.er-api',
  },
  en: {
    manual: 'manual (config)',
    cbr: 'Bank of Russia',
    'cbr-mirror': 'Bank of Russia (mirror)',
    'er-api': 'open.er-api',
  },
}

/** Подпись источника курса с фолбэком на ru */
export const currencySourceLabel = (id: string, locale: Locale): string =>
  CURRENCY_SOURCE_LABELS[locale][id] ?? CURRENCY_SOURCE_LABELS.ru[id] ?? id

/** Курс одной валюты (сколько единиц за 1 USD; rate 0 = курса нет) */
export interface CurrencyEntry {
  code: string
  rate: number
  source: string
  asOf?: string
  fetchedAt?: number
}

export interface CurrencySourceStatus {
  id: string
  label: string
  currencies?: number
  asOf?: string
  fetchedAt?: number
  ok?: boolean
  error?: string
}

/** Статус курсов с сервера (socket 'currency:status') */
export interface CurrencyStatus {
  entries: CurrencyEntry[]
  sources: CurrencySourceStatus[]
  ttlHours: number
  disabled: boolean
}

/**
 * Формат суммы в валюте: «₽0,29» / «₽12,5» / «₽123» — 3 значащих цифры до 1
 * (согласовано с fmtUsd). Курс — единиц валюты за 1 USD.
 */
export const fmtCurrency = (v: number, code: string, locale: Locale = 'ru'): string => {
  const symbol = CURRENCY_SYMBOLS[code] ?? code
  if (!Number.isFinite(v) || v <= 0) return `${symbol}0`
  let s: string
  if (v >= 100) s = v.toFixed(0)
  else if (v >= 1) s = v.toFixed(1)
  else s = String(parseFloat(v.toPrecision(3)))
  return symbol + (locale === 'ru' ? s.replace('.', ',') : s)
}

/** Конвертация USD → выбранная валюта; null — курса нет */
export const convertUsd = (usd: number, rate: number): number | null =>
  Number.isFinite(usd) && Number.isFinite(rate) && rate > 0 ? usd * rate : null

/** Публичная (маскированная) конфигурация LLM: apiKey здесь всегда маска */
export interface LlmProviderConfigPublic {
  adapter: string
  baseUrl?: string
  model?: string
  /** Маска ключа (первые 3 + «…» + последние 4); полный ключ не покидает сервер */
  apiKey?: string
  temperature?: number
}

/** Ручные цены моделей из конфига (USD за 1M токенов; не секретны) */
export interface PricingOverridesPublic {
  models?: Record<string, { inputPer1M?: number; outputPer1M?: number }>
}

/** Публичная конфигурация LLM: дефолт + per-role переопределения + прайсинг + курсы валют */
export interface LlmConfigPublic {
  default?: LlmProviderConfigPublic
  roles?: Partial<Record<LlmRole, Partial<LlmProviderConfigPublic>>>
  pricing?: PricingOverridesPublic
  /** Ручные курсы валют (единиц за 1 USD; не секретны — префилл поля в настройках) */
  currency?: { rates?: Record<string, number> }
}

export const LLM_ROLE_LABELS: Record<Locale, Record<string, string>> = {
  ru: {
    planner: 'Планировщик',
    executor: 'Исполнитель',
    supervisor: 'Супервайзер',
    decider: 'Решатель',
  },
  en: {
    planner: 'Planner',
    executor: 'Executor',
    supervisor: 'Supervisor',
    decider: 'Decider',
  },
}

/** Подпись роли LLM с фолбэком на ru */
export const llmRoleLabel = (role: string, locale: Locale): string =>
  LLM_ROLE_LABELS[locale][role] ?? LLM_ROLE_LABELS.ru[role] ?? role

export interface GraphNode {
  id: string
  title: string
  description: string
  status: NodeStatus
  dependsOn: string[]
  input?: string
  output?: string
  /** Живой стрим выхода исполнителя (CR-016): накопленный снапшот, пока узел running.
   *  Эфемерное поле: приходит только с node:stream (не пишется в историю запуска),
   *  затирается следующим node:update (running/done/error) — в replay всегда пустое. */
  streamingText?: string
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
  /** Затраты токенов LLM-вызовов узла (ADR-015): исполнитель или решатель развилки */
  usage?: NodeUsage
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
  | { type: 'run:status'; ts: number; status: RunStatus; progress: number; reason?: string }
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
  /** Эфемерный снапшот стрима выхода исполнителя (CR-016 / ADR-023): только live-канал,
 *  в персистентную историю запуска не пишется — в replay таких событий нет */
  | { type: 'node:stream'; ts: number; nodeId: string; text: string }
  /** Агент переоценил «понимание задачи» (насколько узкий вектор решения) */
  | { type: 'run:certainty'; ts: number; certainty: number; note?: string }
  /** Аудит токенов и стоимости (ADR-015/016): один успешный LLM-вызов; nodeId — атрибуция узлу.
   *  adapter/model — provenance; costUsd — оценка по динамическому прайсу (нет цены — нет поля) */
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
      /** 'manual' | 'openrouter' | 'litellm' — источник прайса */
      priceSource?: string
    }

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
  /** Использование токенов LLM по запуску (демо-прогоны — без поля) */
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
  /** Использование токенов LLM на момент свёртки (ADR-015) */
  usage?: RunUsage
}

/** Выбранные варианты развилки как массив (совместимость со старыми прогонами: chosen мог быть строкой) */
export const chosenIds = (dec: DecisionState | undefined): string[] => {
  if (!dec?.chosen) return []
  return Array.isArray(dec.chosen) ? dec.chosen : [dec.chosen]
}

/** Режим выбора развилки (старые прогоны — single) */
export const selectionMode = (dec: DecisionState | undefined): 'single' | 'mixed' =>
  dec?.selection === 'mixed' ? 'mixed' : 'single'

/** Человекочитаемая оценка «понимания задачи», по языку */
export const certaintyLabel = (c: number, locale: Locale = 'ru'): { label: string; hint: string } => {
  if (locale === 'en') {
    if (c < 0.35) return { label: 'Vague direction', hint: 'The solution space is wide: the agent needs clarifications' }
    if (c < 0.7) return { label: 'Narrowing', hint: 'The direction is set, some aspects are still open' }
    return { label: 'Sharp direction', hint: 'Required certainty reached — the solution vector is fixed' }
  }
  if (c < 0.35) return { label: 'Размытый вектор', hint: 'Поле решений широкое: агенту нужны уточнения' }
  if (c < 0.7) return { label: 'Вектор сужается', hint: 'Направление определено, часть аспектов ещё открыта' }
  return { label: 'Узкий вектор', hint: 'Требуемая точность достигнута — вектор решения задан жёстко' }
}

export const DECISION_DOMAIN_LABELS: Record<Locale, Record<DecisionDomain, string>> = {
  ru: {
    scope: 'Объём работ',
    specialization: 'Специализация',
    product: 'Продуктовый вопрос',
    architecture: 'Архитектура',
    tone: 'Tone of voice',
    format: 'Формат результата',
    context: 'Контекст задачи',
    strategy: 'Стратегия',
  },
  en: {
    scope: 'Scope',
    specialization: 'Specialization',
    product: 'Product question',
    architecture: 'Architecture',
    tone: 'Tone of voice',
    format: 'Output format',
    context: 'Task context',
    strategy: 'Strategy',
  },
}

/** Подпись домена развилки с фолбэком на ru */
export const decisionDomainLabel = (domain: string, locale: Locale): string =>
  (DECISION_DOMAIN_LABELS[locale] as Record<string, string>)[domain] ??
  (DECISION_DOMAIN_LABELS.ru as Record<string, string>)[domain] ??
  domain

export interface GraphEdge {
  id: string
  from: string
  to: string
}

export const STATUS_LABELS: Record<Locale, Record<NodeStatus, string>> = {
  ru: {
    pending: 'Ожидает',
    running: 'Выполняется',
    done: 'Выполнено',
    error: 'Ошибка',
    skipped: 'Пропущено',
    discarded: 'Не реализовано',
  },
  en: {
    pending: 'Pending',
    running: 'Running',
    done: 'Done',
    error: 'Error',
    skipped: 'Skipped',
    discarded: 'Discarded',
  },
}

export const RUN_STATUS_LABELS: Record<Locale, Record<RunStatus, string>> = {
  ru: {
    planning: 'Планирование',
    running: 'Выполняется',
    paused: 'Пауза',
    stopped: 'Остановлено',
    completed: 'Завершено',
    error: 'Ошибка',
  },
  en: {
    planning: 'Planning',
    running: 'Running',
    paused: 'Paused',
    stopped: 'Stopped',
    completed: 'Completed',
    error: 'Error',
  },
}

export const DECISION_MODE_LABELS: Record<Locale, Record<DecisionMode, string>> = {
  ru: {
    auto: 'Авто — агент решает сам',
    manual: 'Вручную — агент предлагает и ждёт',
  },
  en: {
    auto: 'Auto — the agent decides',
    manual: 'Manual — the agent proposes and waits',
  },
}

/** Универсальный резолвер словаря-по-языку с фолбэком на ru */
export function byLocale<T extends Record<string, string>>(map: Record<Locale, T>, locale: Locale): T {
  return map[locale] ?? map.ru
}
