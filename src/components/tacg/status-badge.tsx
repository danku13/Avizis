// TACG — статусные бейджи и легенда цветовой кодировки
'use client'

import { cn } from '@/lib/utils'
import { NodeStatus, RunMode, RunStatus, RUN_STATUS_LABELS, STATUS_LABELS } from '@/lib/tacg/types'

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
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground',
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot, s.pulse && 'animate-pulse')} />
      {RUN_STATUS_LABELS[status]}
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
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-1.5 rounded-full', NODE_DOT[status], status === 'running' && 'animate-pulse')} />
      {STATUS_LABELS[status]}
    </span>
  )
}

export function ModeBadge({ mode }: { mode: RunMode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        mode === 'llm'
          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
          : 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
      )}
    >
      {mode === 'llm' ? 'LLM · z-ai-web-dev-sdk' : 'Демо · симуляция'}
    </span>
  )
}

const LEGEND: { color: string; label: string }[] = [
  { color: 'bg-emerald-400', label: 'Выполнено' },
  { color: 'bg-cyan-400', label: 'Выполняется' },
  { color: 'bg-zinc-400', label: 'Ожидает' },
  { color: 'bg-red-500', label: 'Ошибка' },
  { color: 'bg-violet-400', label: 'Добавлено динамически' },
  { color: 'bg-amber-400', label: 'Развилка решения' },
  { color: 'bg-zinc-500', label: 'Пропущено' },
  { color: 'bg-zinc-600', label: 'Ветка не выбрана' },
]

export function GraphLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {LEGEND.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('size-2 rounded-full', l.color)} />
          {l.label}
        </span>
      ))}
    </div>
  )
}
