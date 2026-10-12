// TACG — статусные бейджи и легенда цветовой кодировки
'use client'

import { cn } from '@/lib/utils'
import { NodeStatus, RunMode, RunStatus, RUN_STATUS_LABELS, STATUS_LABELS, byLocale } from '@/lib/tacg/types'
import { useI18nStore, useT } from '@/lib/tacg/i18n'

const RUN_STATUS_STYLES: Record<RunStatus, { dot: string; pulse?: boolean }> = {
  planning: { dot: 'bg-amber-400', pulse: true },
  running: { dot: 'bg-cyan-400', pulse: true },
  paused: { dot: 'bg-amber-400' },
  stopped: { dot: 'bg-zinc-400' },
  completed: { dot: 'bg-emerald-400' },
  error: { dot: 'bg-red-500' },
}

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const s = RUN_STATUS_STYLES[status]
  const locale = useI18nStore((st) => st.locale)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground',
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot, s.pulse && 'animate-pulse')} />
      {byLocale(RUN_STATUS_LABELS, locale)[status]}
    </span>
  )
}

export const NODE_DOT: Record<NodeStatus, string> = {
  // CR-009: ожидание — нейтральный цинк; amber отдан развилкам («ваш ход»)
  pending: 'bg-zinc-400 dark:bg-zinc-400/80',
  running: 'bg-cyan-500 dark:bg-cyan-400',
  done: 'bg-emerald-500 dark:bg-emerald-400',
  error: 'bg-red-500',
  skipped: 'bg-zinc-400 dark:bg-zinc-500',
  discarded: 'bg-zinc-300 dark:bg-zinc-600',
}

export function NodeStatusBadge({ status }: { status: NodeStatus }) {
  const locale = useI18nStore((st) => st.locale)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', NODE_DOT[status], status === 'running' && 'animate-pulse')} />
      {byLocale(STATUS_LABELS, locale)[status]}
    </span>
  )
}

export function ModeBadge({ mode, model }: { mode: RunMode; model?: string }) {
  const t = useT()
  const label = mode === 'llm' ? (model ? `LLM · ${model}` : 'LLM · z-ai-web-dev-sdk') : t('badge.demoMode')
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        mode === 'llm'
          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
          : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
      )}
      title={mode === 'llm' ? (model ? t('badge.runProviderTitle', { model }) : 'z-ai-web-dev-sdk') : t('badge.simulationTitle')}
    >
      {label}
    </span>
  )
}

const LEGEND_KEYS = [
  'legend.done',
  'legend.running',
  'legend.pending',
  'legend.error',
  'legend.dynamic',
  'legend.fork',
  'legend.skipped',
  'legend.discarded',
]

const LEGEND_COLORS = [
  'bg-emerald-400',
  'bg-cyan-400',
  'bg-zinc-400',
  'bg-red-500',
  'bg-violet-400',
  'bg-amber-400',
  'bg-zinc-500',
  'bg-zinc-600',
]

export function GraphLegend({ className }: { className?: string }) {
  const t = useT()
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {LEGEND_KEYS.map((key, i) => (
        <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('size-2 rounded-full', LEGEND_COLORS[i])} />
          {t(key)}
        </span>
      ))}
    </div>
  )
}
