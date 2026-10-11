// TACG — панель управления запуском: статус, прогресс, пауза/стоп, версии, экспорт
'use client'

import { useMemo } from 'react'
import { Pause, Play, Square, Download, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RunStatusBadge, ModeBadge } from './status-badge'
import { foldEvents, versionMarkers } from '@/lib/tacg/fold'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function RunToolbar() {
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const meta = useTacgStore((s) => s.currentMeta)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const setCursor = useTacgStore((s) => s.setCursor)
  const setPlaying = useTacgStore((s) => s.setPlaying)

  const isLive = cursor === null
  const view = useMemo(() => foldEvents(isLive ? events : events.slice(0, cursor! + 1)), [events, cursor])
  const markers = useMemo(() => versionMarkers(events), [events])

  const canControl = isLive && currentRunId && ['planning', 'running', 'paused'].includes(view.status)
  const doneCount = view.nodes.filter((n) => n.status === 'done').length
  const elapsed = (() => {
    if (!meta) return null
    const terminal = ['completed', 'stopped', 'error'].includes(view.status)
    const endTs = terminal ? events[events.length - 1]?.ts ?? meta.createdAt : Date.now()
    return (endTs - meta.createdAt) / 1000
  })()

  const control = (action: 'pause' | 'resume' | 'stop') => {
    if (!currentRunId) return
    getSocket().emit('run:control', { runId: currentRunId, action })
    if (action === 'stop') toast.info('Остановка применится после завершения текущего узла')
  }

  const exportReport = () => {
    const md = buildReport()
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tacg-report-${currentRunId ?? 'run'}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Аудиторский отчёт выгружен (Markdown)')
  }

  const buildReport = (): string => {
    if (!meta) return '# TACG — отчёт\n\nНет данных.'
    const lines: string[] = []
    lines.push('# TACG — аудиторский отчёт запуска')
    lines.push('')
    lines.push(`- **Задача:** «${meta.task}»`)
    lines.push(`- **Режим:** ${meta.mode === 'llm' ? 'LLM (z-ai-web-dev-sdk)' : 'Демо (симуляция)'}`)
    lines.push(`- **Статус:** ${view.status}`)
    lines.push(`- **Прогресс:** ${view.progress}% (${doneCount}/${view.nodes.length} узлов)`)
    lines.push(`- **Версий графа:** ${view.version}`)
    lines.push(`- **Событий записано:** ${events.length}`)
    if (elapsed != null) lines.push(`- **Длительность:** ${elapsed.toFixed(1)} с`)
    lines.push('')
    lines.push('## Граф вычислений')
    lines.push('')
    lines.push('| # | Шаг | Статус | Зависимости | Длительность | Добавлен |')
    lines.push('|---|-----|--------|-------------|--------------|----------|')
    view.nodes.forEach((n, i) => {
      const dur = n.durationMs ? `${(n.durationMs / 1000).toFixed(1)} с` : '—'
      const added = n.dynamic ? `динамически (v${n.addedAtVersion})` : 'план (v1)'
      lines.push(`| ${i + 1} | ${n.title} | ${n.status} | ${n.dependsOn.join(', ') || '—'} | ${dur} | ${added} |`)
    })
    lines.push('')
    if (view.nodes.some((n) => n.reason)) {
      lines.push('## Причины динамических добавлений')
      lines.push('')
      view.nodes.filter((n) => n.reason).forEach((n) => lines.push(`- **${n.title}** (v${n.addedAtVersion}): ${n.reason}`))
      lines.push('')
    }
    lines.push('## Результаты узлов')
    lines.push('')
    view.nodes.forEach((n, i) => {
      lines.push(`### ${i + 1}. ${n.title}`)
      if (n.overridden) lines.push('_результат переопределён пользователем_')
      lines.push(`- **Вход:** ${n.input ? 'см. ниже' : '—'}`)
      lines.push(`- **Выход:** ${n.output || '—'}`)
      if (n.input) {
        lines.push('')
        lines.push('```')
        lines.push(n.input)
        lines.push('```')
      }
      lines.push('')
    })
    lines.push('## Хронология (полный журнал)')
    lines.push('')
    view.logs.forEach((l) => {
      const t = new Date(l.ts).toLocaleTimeString('ru-RU')
      lines.push(`- \`${t}\` **[${l.kind}]** ${l.message}`)
    })
    if (view.summary) {
      lines.push('')
      lines.push('## Итог')
      lines.push('')
      lines.push(view.summary)
    }
    return lines.join('\n')
  }

  if (!meta) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        <Radio className="size-4 text-emerald-400" />
        Движок агента готов — задайте задачу в панели слева
      </div>
    )
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RunStatusBadge status={view.status} />
        <ModeBadge mode={meta.mode} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="max-w-[280px] truncate text-sm font-medium">{meta.task}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm">
            <p>{meta.task}</p>
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" onClick={() => control(view.status === 'paused' ? 'resume' : 'pause')} disabled={!canControl} aria-label="Пауза">
                {view.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view.status === 'paused' ? 'Возобновить' : 'Пауза (текущий узел завершится)'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8 text-red-400 hover:text-red-300" onClick={() => control('stop')} disabled={!canControl} aria-label="Стоп">
                <Square className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Остановить выполнение</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" onClick={exportReport} aria-label="Экспорт отчёта">
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Экспорт аудиторского отчёта (MD)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
          <Progress value={view.progress} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {view.progress}% · {doneCount}/{view.nodes.length} узлов
          </span>
        </div>
        {elapsed != null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {['completed', 'stopped', 'error'].includes(view.status) ? 'длительность' : 'прошло'}: {elapsed.toFixed(1)} с
          </span>
        )}
        {markers.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">версии:</span>
            {markers.map((m) => (
              <button
                key={m.version}
                onClick={() => {
                  setPlaying(false)
                  setCursor(m.eventIndex)
                }}
                title={m.description}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors',
                  view.version === m.version
                    ? 'bg-violet-500/25 text-violet-200'
                    : 'bg-secondary text-muted-foreground hover:bg-violet-500/15 hover:text-violet-300'
                )}
              >
                v{m.version}
              </button>
            ))}
            {!isLive && (
              <button
                onClick={() => {
                  setPlaying(false)
                  setCursor(null)
                }}
                className="ml-1 flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30"
              >
                <Radio className="size-3" />
                Live
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
