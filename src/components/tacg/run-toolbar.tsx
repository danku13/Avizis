// TACG — панель управления запуском: статус, прогресс, пауза/стоп, версии, режим решений, экспорт
'use client'

import { useMemo } from 'react'
import { Pause, Play, Square, Download, Radio, Bot, Hand, GitFork, Compass, Settings2, Cpu, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RunStatusBadge, ModeBadge } from './status-badge'
import { findOfferedDecision, foldEvents, versionMarkers } from '@/lib/tacg/fold'
import { chosenIds, certaintyLabel, DECISION_DOMAIN_LABELS, DecisionMode, fmtTokens, LLM_ROLE_LABELS, LlmProviderInfo, selectionMode } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** Чип активного провайдера + кнопка настроек (BYOK) */
function LlmChip() {
  const llmConfig = useTacgStore((s) => s.llmConfig)
  const openSettings = useTacgStore((s) => s.openSettings)
  const d = llmConfig?.default
  const label =
    d?.adapter === 'openai-compatible'
      ? `LLM: ${d.adapter}${d.model ? ` · ${d.model}` : ''}`
      : 'LLM: z-ai SDK'
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openSettings}
            role="status"
            aria-label={`Активный LLM-провайдер: ${label}. Открыть настройки`}
            className="inline-flex h-8 max-w-[300px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/70 px-2.5 text-xs font-medium text-zinc-700 transition-colors hover:border-teal-500/50 hover:text-teal-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:text-teal-300"
          >
            <Cpu className="size-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
            <span className="hidden truncate sm:inline">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Активный провайдер: {label} — клик открывает настройки LLM (BYOK)
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-8" onClick={openSettings} aria-label="Настройки LLM">
            <Settings2 className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Настройки LLM (BYOK: свои модели и ключи)</TooltipContent>
      </Tooltip>
    </>
  )
}

export function RunToolbar() {
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const meta = useTacgStore((s) => s.currentMeta)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const setCursor = useTacgStore((s) => s.setCursor)
  const setPlaying = useTacgStore((s) => s.setPlaying)
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const openDecision = useTacgStore((s) => s.openDecision)
  const runLlm = useTacgStore((s) => s.runLlm)

  const isLive = cursor === null
  const view = useMemo(
    () => foldEvents(isLive ? events : events.slice(0, cursor! + 1), { llm: runLlm ?? undefined }),
    [events, cursor, runLlm]
  )
  const markers = useMemo(() => versionMarkers(events), [events])
  const offered = useMemo(() => (isLive ? findOfferedDecision(view.nodes) : undefined), [view.nodes, isLive])

  const canControl = isLive && currentRunId && ['planning', 'running', 'paused'].includes(view.status)
  const doneCount = view.nodes.filter((n) => n.status === 'done').length
  const certainty = view.certainty
  const certaintyInfo = certainty != null ? certaintyLabel(certainty) : null
  const openQuestions = view.nodes.filter(
    (n) => n.kind === 'decision' && (n.status === 'pending' || n.status === 'running')
  ).length
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

  const setDecisionMode = (mode: DecisionMode) => {
    if (!currentRunId || mode === (decisionMode ?? 'manual')) return
    getSocket().emit('decision:mode', { runId: currentRunId, mode })
    toast.info(
      mode === 'auto'
        ? 'Режим «авто»: агент будет решать развилки сам'
        : 'Режим «ручной выбор»: агент будет предлагать варианты и ждать'
    )
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
    if (certainty != null) {
      lines.push(
        `- **Понимание задачи:** ${Math.round(certainty * 100)}% — ${certaintyLabel(certainty).label} (оценка агента: насколько узкий вектор решения)`
      )
    }
    lines.push(`- **Событий записано:** ${events.length}`)
    if (elapsed != null) lines.push(`- **Длительность:** ${elapsed.toFixed(1)} с`)
    if (view.usage && view.usage.calls > 0) {
      lines.push(
        `- **Токены LLM:** ↑ ${view.usage.inputTokens} / ↓ ${view.usage.outputTokens} (${view.usage.calls} вызов.)`
      )
    }
    lines.push('')

    // Provenance моделей (BYOK): роль → адаптер · модель
    const llmRoles = Object.entries(view.llm ?? {}) as Array<[string, LlmProviderInfo]>
    if (llmRoles.length) {
      lines.push('## Модели (BYOK)')
      lines.push('')
      llmRoles.forEach(([role, info]) => {
        lines.push(`- **${LLM_ROLE_LABELS[role] ?? role}:** ${info.adapter} · ${info.model}`)
      })
      lines.push('')
    }

    // Использование токенов (ADR-015): разбивка по ролям + итог
    if (view.usage && view.usage.calls > 0) {
      lines.push('## Использование токенов')
      lines.push('')
      lines.push('| Роль | Вызовы | Токены (вход) | Токены (выход) |')
      lines.push('|---|---|---|---|')
      const roles = Object.entries(view.usage.byRole).sort((a, b) => b[1].calls - a[1].calls)
      roles.forEach(([role, u]) => {
        lines.push(`| ${LLM_ROLE_LABELS[role] ?? role} | ${u.calls} | ↑ ${u.inputTokens} | ↓ ${u.outputTokens} |`)
      })
      lines.push(`| **Итого** | **${view.usage.calls}** | **↑ ${view.usage.inputTokens}** | **↓ ${view.usage.outputTokens}** |`)
      lines.push('')
    }

    lines.push('## Граф вычислений')
    lines.push('')
    lines.push('| # | Шаг | Статус | Зависимости | Длительность | Токены ↑/↓ | Добавлен |')
    lines.push('|---|-----|--------|-------------|--------------|------------|----------|')
    view.nodes.forEach((n, i) => {
      const dur = n.durationMs ? `${(n.durationMs / 1000).toFixed(1)} с` : '—'
      const tokens = n.usage ? `↑ ${n.usage.input} / ↓ ${n.usage.output}` : '—'
      const added = n.dynamic ? `динамически (v${n.addedAtVersion})` : 'план (v1)'
      lines.push(
        `| ${i + 1} | ${n.title} | ${n.status} | ${n.dependsOn.join(', ') || '—'} | ${dur} | ${tokens} | ${added} |`
      )
    })
    lines.push('')
    const decisions = view.nodes.filter((n) => n.kind === 'decision' && n.decision)
    if (decisions.length) {
      lines.push('## Развилки и решения')
      lines.push('')
      decisions.forEach((d) => {
        const dec = d.decision!
        const picked = chosenIds(dec)
        lines.push(`### ${d.title}`)
        lines.push(`- **Вопрос:** ${dec.question}`)
        if (dec.domain) lines.push(`- **Домен:** ${DECISION_DOMAIN_LABELS[dec.domain]}`)
        if (selectionMode(dec) === 'mixed') lines.push('- **Тип выбора:** смешанный (несколько вариантов)')
        dec.options.forEach((o) => {
          const mark = picked.includes(o.id) ? '✅ **ВЫБРАН**' : '—'
          lines.push(`- ${mark} **Вариант «${o.id}» — ${o.label}:** ${o.rationale}`)
          if (o.nextSteps.length) lines.push(`  - Дальнейшие шаги: ${o.nextSteps.join(' → ')}`)
        })
        if (picked.length) {
          lines.push(
            `- **Итог:** вариант(ы) «${picked.join(' + ')}» · решение принял: ${
              dec.chosenBy === 'user' ? 'пользователь' : 'агент'
            }${picked.length > 1 ? ' · смешанное решение' : ''}`
          )
          if (dec.reasoning) lines.push(`- **Обоснование:** ${dec.reasoning}`)
        } else {
          lines.push('- **Итог:** решение не принято (запуск остановлен до выбора)')
        }
        lines.push('')
      })
    }
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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        <Radio className="size-4 text-emerald-400" />
        <span className="min-w-0 flex-1">Движок агента готов — задайте задачу в панели слева</span>
        <div className="flex shrink-0 items-center gap-2">
          <LlmChip />
        </div>
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
              <div className="flex items-center rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label="Режим решений на развилках">
                <button
                  onClick={() => setDecisionMode('manual')}
                  disabled={!canControl}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    (decisionMode ?? 'manual') === 'manual'
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  )}
                >
                  <Hand className="size-3.5" />
                  <span className="hidden sm:inline">Решения: вручную</span>
                  <span className="sm:hidden">Вручную</span>
                </button>
                <button
                  onClick={() => setDecisionMode('auto')}
                  disabled={!canControl}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    decisionMode === 'auto'
                      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  )}
                >
                  <Bot className="size-3.5" />
                  <span className="hidden sm:inline">Авто</span>
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Режим решений на развилках: «вручную» — агент предлагает варианты и ждёт, «авто» — решает сам
            </TooltipContent>
          </Tooltip>
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
          <LlmChip />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
          <Progress value={view.progress} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {view.progress}% · {doneCount}/{view.nodes.length} узлов
          </span>
        </div>

        {/* ─── Метр «понимания задачи»: насколько узкий вектор решения ─── */}
        {certainty != null && certaintyInfo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex min-w-[210px] max-w-[290px] items-center gap-2" role="meter" aria-label="Понимание задачи агентом" aria-valuenow={Math.round(certainty * 100)}>
                <Compass
                  className={cn(
                    'size-3.5 shrink-0',
                    certainty < 0.35
                      ? 'text-amber-500 dark:text-amber-400'
                      : certainty < 0.7
                        ? 'text-yellow-500 dark:text-yellow-300'
                        : 'text-emerald-500 dark:text-emerald-400'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <Progress
                    value={Math.round(certainty * 100)}
                    className={cn(
                      'h-1.5',
                      certainty < 0.35
                        ? '[&>div]:bg-amber-500'
                        : certainty < 0.7
                          ? '[&>div]:bg-yellow-400'
                          : '[&>div]:bg-emerald-500'
                    )}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {Math.round(certainty * 100)}% · {certaintyInfo.label}
                </span>
                {openQuestions > 0 && (
                  <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    ждёт уточнений: {openQuestions}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold">Понимание задачи — {certaintyInfo.label}</p>
              <p className="mt-1 text-xs opacity-90">{certaintyInfo.hint}</p>
              {openQuestions > 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">Открытых вопросов агента: {openQuestions}</p>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {elapsed != null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {['completed', 'stopped', 'error'].includes(view.status) ? 'длительность' : 'прошло'}: {elapsed.toFixed(1)} с
          </span>
        )}

        {/* ─── Аудит токенов (ADR-015): счётчики запуска, live и replay ─── */}
        {view.usage && view.usage.calls > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={`Токены LLM: вход ${view.usage.inputTokens}, выход ${view.usage.outputTokens}, вызовов ${view.usage.calls}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white/70 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
              >
                <Coins className="size-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
                <span className="whitespace-nowrap">
                  ↑ {fmtTokens(view.usage.inputTokens)} · ↓ {fmtTokens(view.usage.outputTokens)} ·{' '}
                  {view.usage.calls} вызов.
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold">Использование токенов LLM</p>
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(view.usage.byRole)
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([role, u]) => (
                    <p key={role} className="flex items-center justify-between gap-4 text-xs tabular-nums">
                      <span>{LLM_ROLE_LABELS[role] ?? role}</span>
                      <span>
                        ↑ {u.inputTokens} / ↓ {u.outputTokens} · {u.calls} вызов.
                      </span>
                    </p>
                  ))}
              </div>
              <p className="mt-1.5 border-t border-border pt-1.5 text-xs font-semibold tabular-nums">
                Итого: ↑ {view.usage.inputTokens} / ↓ {view.usage.outputTokens} · {view.usage.calls} вызовов
              </p>
              <p className="mt-1 text-[11px] leading-relaxed opacity-80">
                Данные провайдера (вход/выход) по каждому LLM-вызову; шаги — в инспекторе узлов, детализация — в MD-отчёте
              </p>
            </TooltipContent>
          </Tooltip>
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
                    ? 'bg-violet-500/25 text-violet-700 dark:text-violet-200'
                    : 'bg-secondary text-muted-foreground hover:bg-violet-500/15 hover:text-violet-600 dark:hover:text-violet-300'
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

      {/* Баннер ожидания выбора: агент замер на развилке */}
      {offered && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
          <GitFork className="size-4 shrink-0 animate-pulse text-amber-500 dark:text-amber-300" />
          <span className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
            {(decisionMode ?? 'manual') === 'manual'
              ? 'Агент ждёт вашего решения на развилке'
              : 'Агент принимает решение на развилке…'}
            <span className="ml-2 hidden text-xs text-amber-700/80 dark:text-amber-300/70 md:inline">{offered.title}</span>
          </span>
          {(decisionMode ?? 'manual') === 'manual' && (
            <Button size="sm" variant="secondary" className="h-7 gap-1.5 border-amber-500/40 bg-amber-500/15 px-3 text-xs text-amber-900 hover:bg-amber-500/25 dark:text-amber-100" onClick={openDecision}>
              <GitFork className="size-3" />
              Открыть выбор
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
