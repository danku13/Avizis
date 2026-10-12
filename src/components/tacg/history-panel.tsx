// TACG — панель запуска задачи и история прогонов
'use client'

import { useState } from 'react'
import { Play, Trash2, History, Zap, Cpu, GitFork, Bot, Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { DecisionMode, RunMode, RunStatus, RUN_STATUS_LABELS, byLocale } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useI18nStore, useT } from '@/lib/tacg/i18n'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const STATUS_DOT: Record<string, string> = {
  planning: 'bg-amber-400 animate-pulse',
  running: 'bg-cyan-400 animate-pulse',
  paused: 'bg-amber-400',
  stopped: 'bg-zinc-400',
  completed: 'bg-emerald-400',
  error: 'bg-red-500',
}

const fmtDate = (ts: number, locale: 'ru' | 'en') => {
  const d = new Date(ts)
  const loc = locale === 'en' ? 'en-US' : 'ru-RU'
  return d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
}

export function HistoryPanel() {
  const runs = useTacgStore((s) => s.runs)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const starting = useTacgStore((s) => s.starting)
  const setStarting = useTacgStore((s) => s.setStarting)
  const t = useT()
  const locale = useI18nStore((s) => s.locale)
  const [task, setTask] = useState(t('history.defaultTask'))
  const [mode, setMode] = useState<RunMode>('demo')
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('manual')

  const start = () => {
    getSocket().emit('run:start', { task, mode, decisionMode })
    setStarting(true)
    toast.info(mode === 'llm' ? t('history.startedLlm') : t('history.startedDemo'), {
      description: decisionMode === 'manual' ? t('history.startedManualHint') : t('history.startedAutoHint'),
    })
    setTimeout(() => useTacgStore.getState().setStarting(false), 4000)
  }

  const load = (id: string) => {
    getSocket().emit('run:load', { runId: id })
    toast.info(t('history.loadedToast'))
  }

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    getSocket().emit('run:delete', { runId: id })
    useTacgStore.getState().removeRunLocal(id)
  }

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Zap className="size-4 text-teal-500 dark:text-teal-400" />
        {t('history.taskTitle')}
      </h3>

      <div className="space-y-2.5">
        <Textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t('history.taskPlaceholder')}
          className="min-h-[88px] resize-none text-sm"
          aria-label={t('history.taskAria')}
        />
        <Select value={mode} onValueChange={(v) => setMode(v as RunMode)}>
          <SelectTrigger aria-label={t('history.modeAria')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="demo">
              <span className="flex items-center gap-2">
                <Cpu className="size-3.5 text-violet-400" />
                {t('history.modeDemo')}
              </span>
            </SelectItem>
            <SelectItem value="llm">
              <span className="flex items-center gap-2">
                <Zap className="size-3.5 text-teal-400" />
                LLM · z-ai-web-dev-sdk
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={decisionMode} onValueChange={(v) => setDecisionMode(v as DecisionMode)}>
          <SelectTrigger aria-label={t('toolbar.decisionGroupAria')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">
              <span className="flex items-center gap-2">
                <Hand className="size-3.5 text-amber-500 dark:text-amber-400" />
                {t('history.decisionsManual')}
              </span>
            </SelectItem>
            <SelectItem value="auto">
              <span className="flex items-center gap-2">
                <Bot className="size-3.5 text-amber-500 dark:text-amber-400" />
                {t('history.decisionsAuto')}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <Button className="w-full" onClick={start} disabled={starting || !task.trim()}>
          <Play className="mr-2 size-4" />
          {starting ? t('history.starting') : t('history.startButton')}
        </Button>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <GitFork className="mt-0.5 size-3.5 shrink-0 text-amber-500/80 dark:text-amber-400/70" />
          <span>{t('history.hint')}</span>
        </p>
      </div>

      <Separator className="my-4" />

      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <History className="size-4 text-zinc-400" />
        {t('history.title')}
        <span className="ml-auto text-xs font-normal text-muted-foreground">{runs.length}</span>
      </h3>

      {/* обычный div вместо Radix ScrollArea: display:table-обёртка ScrollArea
          раздувалась по ширине из-за nowrap-текста с truncate */}
      <div className="-mr-2 h-0 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-2">
        <div className="space-y-1.5">
          {runs.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
              {t('history.empty')}
            </p>
          )}
          {runs.map((r) => (
            <div
              key={r.id}
              onClick={() => load(r.id)}
              className={cn(
                'group cursor-pointer rounded-lg border p-2.5 transition-colors hover:border-zinc-400 dark:hover:border-zinc-600',
                r.id === currentRunId ? 'border-teal-500/50 bg-teal-500/5' : 'border-border bg-secondary/30'
              )}
            >
              <div className="flex items-start gap-2">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT[r.status] ?? 'bg-zinc-500')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium leading-snug" title={r.task}>
                    {r.task}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground" title={byLocale(RUN_STATUS_LABELS, locale)[r.status as RunStatus] ?? r.status}>
                    {fmtDate(r.createdAt, locale)} · {r.mode === 'llm' ? 'LLM' : t('history.demoShort')} · {t('history.nodesShort', { n: r.nodesCount })}
                    {r.dynamicCount > 0 && <span className="text-violet-600 dark:text-violet-400"> (+{r.dynamicCount} {t('history.dynShort')})</span>}
                    {r.version > 1 && <span className="text-violet-600 dark:text-violet-400"> v{r.version}</span>}
                  </p>
                </div>
                <button
                  onClick={(e) => remove(e, r.id)}
                  className="mt-0.5 hidden rounded p-1 text-muted-foreground transition-colors hover:text-red-400 group-hover:block"
                  aria-label={t('history.deleteAria')}
                  title={t('history.deleteTitle')}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
