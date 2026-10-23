// Avizis — панель управления запуском: статус, прогресс, пауза/стоп, версии, режим решений, экспорт
'use client'

import { useMemo } from 'react'
import { Pause, Play, Square, Download, Radio, Bot, Hand, GitFork, Compass, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RunStatusBadge, ModeBadge } from './status-badge'
import { findOfferedDecision, foldEvents, versionMarkers } from '@/lib/avizis/fold'
import {
  byLocale,
  certaintyLabel,
  chosenIds,
  convertUsd,
  currencySourceLabel,
  decisionDomainLabel,
  DECISION_MODE_LABELS,
  DecisionMode,
  fmtTokens,
  fmtUsd,
  fmtCurrency,
  llmRoleLabel,
  LlmProviderInfo,
  priceSourceLabel,
  selectionMode,
} from '@/lib/avizis/types'
import { getSocket } from '@/lib/avizis/socket'
import { useI18nStore, useT, Locale } from '@/lib/avizis/i18n'
import { useAvizisStore } from '@/store/avizis-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// Чип LLM-провайдера (BYOK) перенесён в шапку приложения — см. llm-chip.tsx (CR-010)

export function RunToolbar() {
  const events = useAvizisStore((s) => s.events)
  const cursor = useAvizisStore((s) => s.cursor)
  const meta = useAvizisStore((s) => s.currentMeta)
  const currentRunId = useAvizisStore((s) => s.currentRunId)
  const setCursor = useAvizisStore((s) => s.setCursor)
  const setPlaying = useAvizisStore((s) => s.setPlaying)
  const decisionMode = useAvizisStore((s) => s.decisionMode)
  const openDecision = useAvizisStore((s) => s.openDecision)
  const runLlm = useAvizisStore((s) => s.runLlm)
  const currencyStatus = useAvizisStore((s) => s.currencyStatus)
  const displayCurrency = useAvizisStore((s) => s.displayCurrency)
  const t = useT()
  const locale = useI18nStore((s) => s.locale)

  // Конвертация стоимости (FR-910): USD-базис + курс выбранной валюты на отображение
  const curRate =
    displayCurrency !== 'USD'
      ? currencyStatus?.entries.find((e) => e.code === displayCurrency && e.rate > 0) ?? null
      : null
  const fmtCost = (usd: number): string =>
    curRate
      ? `≈ ${fmtUsd(usd, locale)} · ${fmtCurrency(convertUsd(usd, curRate.rate) ?? 0, curRate.code, locale)}`
      : `≈ ${fmtUsd(usd, locale)}`

  const isLive = cursor === null
  const view = useMemo(
    () => foldEvents(isLive ? events : events.slice(0, cursor! + 1), { llm: runLlm ?? undefined }),
    [events, cursor, runLlm]
  )
  const markers = useMemo(() => versionMarkers(events, t('graph.v1Plan')), [events, t])
  const offered = useMemo(() => (isLive ? findOfferedDecision(view.nodes) : undefined), [view.nodes, isLive])

  const canControl = isLive && currentRunId && ['planning', 'running', 'paused'].includes(view.status)
  const doneCount = view.nodes.filter((n) => n.status === 'done').length
  const certainty = view.certainty
  const certaintyInfo = certainty != null ? certaintyLabel(certainty, locale) : null
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
    if (action === 'stop') toast.info(t('toolbar.stopToast'))
  }

  const setDecisionMode = (mode: DecisionMode) => {
    if (!currentRunId || mode === (decisionMode ?? 'manual')) return
    getSocket().emit('decision:mode', { runId: currentRunId, mode })
    toast.info(mode === 'auto' ? t('toolbar.modeAutoToast') : t('toolbar.modeManualToast'))
  }

  const exportReport = () => {
    const md = buildReport()
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `avizis-report-${currentRunId ?? 'run'}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('toolbar.exportToast'))
  }

  const buildReport = (): string => {
    if (!meta) return `# Avizis — ${t('report.title')}\n\n${t('report.noData')}.`
    const lines: string[] = []
    const L = locale
    lines.push(`# Avizis — ${t('report.title')}`)
    lines.push('')
    lines.push(`- **${t('report.task')}:** «${meta.task}»`)
    lines.push(`- **${t('report.mode')}:** ${meta.mode === 'llm' ? (runLlm?.planner?.model ? `LLM (${runLlm.planner.adapter} · ${runLlm.planner.model})` : 'LLM (z-ai-web-dev-sdk)') : t('report.modeDemo')}`)
    lines.push(`- **${t('report.status')}:** ${view.status}`)
    lines.push(`- **${t('report.progress')}:** ${view.progress}% (${doneCount}/${view.nodes.length} ${t('report.nodesUnit')})`)
    lines.push(`- **${t('report.versions')}:** ${view.version}`)
    if (certainty != null) {
      lines.push(
        `- **${t('report.certainty')}:** ${Math.round(certainty * 100)}% — ${certaintyLabel(certainty, L).label} (${t('report.certaintyHint')})`
      )
    }
    lines.push(`- **${t('report.events')}:** ${events.length}`)
    if (elapsed != null) lines.push(`- **${t('report.duration')}:** ${elapsed.toFixed(1)} s`)
    if (view.usage && view.usage.calls > 0) {
      lines.push(
        `- **${t('report.tokens')}:** ↑ ${view.usage.inputTokens} / ↓ ${view.usage.outputTokens} (${view.usage.calls} ${t('report.callsUnit')})`
      )
      if (view.usage.costUsd) {
        const store = useAvizisStore.getState()
        const entry =
          store.displayCurrency !== 'USD'
            ? store.currencyStatus?.entries.find((e) => e.code === store.displayCurrency && e.rate > 0) ?? null
            : null
        const curPart = entry ? ` · ${fmtCurrency(convertUsd(view.usage.costUsd, entry.rate) ?? 0, entry.code, L)}` : ''
        lines.push(
          `- **${t('report.cost')}:** ≈ ${fmtUsd(view.usage.costUsd, L)}${curPart} (${t('report.dynamicPricing')}${
            entry ? `, ${t('report.rate')} ${currencySourceLabel(entry.source, L)}` : ''
          })`
        )
      }
    }
    lines.push('')

    // Provenance моделей (BYOK): роль → адаптер · модель
    const llmRoles = Object.entries(view.llm ?? {}) as Array<[string, LlmProviderInfo]>
    if (llmRoles.length) {
      lines.push(`## ${t('report.modelsSection')}`)
      lines.push('')
      llmRoles.forEach(([role, info]) => {
        lines.push(`- **${llmRoleLabel(role, L)}:** ${info.adapter} · ${info.model}`)
      })
      lines.push('')
    }

    // Использование токенов и стоимости (ADR-015/016): разбивка по ролям + итог
    if (view.usage && view.usage.calls > 0) {
      const hasCost = !!view.usage.costUsd || Object.values(view.usage.byRole).some((r) => r.costUsd)
      lines.push(`## ${t('report.usageSection')}`)
      lines.push('')
      if (hasCost) {
        lines.push(`| ${t('report.role')} | ${t('report.calls')} | ${t('report.tokensIn')} | ${t('report.tokensOut')} | ${t('report.cost')} |`)
        lines.push('|---|---|---|---|---|')
      } else {
        lines.push(`| ${t('report.role')} | ${t('report.calls')} | ${t('report.tokensIn')} | ${t('report.tokensOut')} |`)
        lines.push('|---|---|---|---|')
      }
      const roles = Object.entries(view.usage.byRole).sort((a, b) => b[1].calls - a[1].calls)
      roles.forEach(([role, u]) => {
        const base = `| ${llmRoleLabel(role, L)} | ${u.calls} | ↑ ${u.inputTokens} | ↓ ${u.outputTokens}`
        lines.push(hasCost ? `${base} | ${u.costUsd ? fmtCost(u.costUsd) : '—'} |` : `${base} |`)
      })
      const total = `| **${t('report.total')}** | **${view.usage.calls}** | **↑ ${view.usage.inputTokens}** | **↓ ${view.usage.outputTokens}**`
      lines.push(hasCost ? `${total} | **${view.usage.costUsd ? fmtCost(view.usage.costUsd) : '—'}** |` : `${total} |`)
      lines.push('')

      // Provenance прайсов (ADR-016): источник и свежесть — обязательная часть аудита
      const pricingStatus = useAvizisStore.getState().pricingStatus
      const netSources = (pricingStatus?.sources ?? []).filter((s) => s.id !== 'manual')
      if (hasCost || netSources.length) {
        lines.push(t('report.pricingLine'))
        netSources.forEach((s) => {
          const when = s.fetchedAt ? new Date(s.fetchedAt).toLocaleString(L === 'en' ? 'en-US' : 'ru-RU') : '—'
          lines.push(
            `- ${s.label}: ${s.models} ${t('report.modelsUnit')}, ${t('report.updated')} ${when}${s.ok === false ? ` (${t('report.lastRefreshFailed')}: ${s.error ?? t('report.networkError')})` : ''}`
          )
        })
        const manual = pricingStatus?.sources.find((s) => s.id === 'manual')
        if (manual?.models) lines.push(`- ${t('report.pricingManual')}: ${manual.models} ${t('report.pricingManualUnit')}`)
        if (view.usage.unpricedCalls) {
          lines.push(`- ${t('report.unpriced')}: ${view.usage.unpricedCalls} ${t('report.callsUnit')} — ${t('report.unpricedReason')}`)
        }
        lines.push('')
      }

      // Конвертация валюты (FR-910): курс, источник и дата — часть аудита
      const store = useAvizisStore.getState()
      if (store.displayCurrency !== 'USD') {
        const entry = store.currencyStatus?.entries.find((e) => e.code === store.displayCurrency && e.rate > 0)
        const netSources = (store.currencyStatus?.sources ?? []).filter((s) => s.id !== 'manual')
        if (entry) {
          lines.push(t('report.rateLine'))
          lines.push(
            `- ${entry.code} / 1 USD: ${entry.rate} — ${currencySourceLabel(entry.source, L)}${
              entry.asOf ? `, ${t('report.quote')} ${entry.asOf}` : ''
            }`
          )
          netSources.forEach((s) => {
            const when = s.fetchedAt ? new Date(s.fetchedAt).toLocaleString(L === 'en' ? 'en-US' : 'ru-RU') : '—'
            lines.push(
              `- ${s.label}: ${s.currencies ?? 0} ${t('report.currenciesUnit')}, ${t('report.updated')} ${when}${
                s.ok === false ? ` (${t('report.lastRefreshFailed')}: ${s.error ?? t('report.networkError')})` : ''
              }`
            )
          })
          lines.push(`- ${t('report.usdBaseNote')}`)
          lines.push('')
        }
      }
    }

    lines.push(`## ${t('report.graphSection')}`)
    lines.push('')
    const nodesHaveCost = view.nodes.some((n) => n.usage?.costUsd)
    if (nodesHaveCost) {
      lines.push(`| # | ${t('report.step')} | ${t('report.status')} | ${t('report.deps')} | ${t('report.durationCol')} | ${t('report.tokensCol')} | ${t('report.cost')} | ${t('report.added')} |`)
      lines.push('|---|-----|--------|-------------|--------------|------------|-----------|----------|')
    } else {
      lines.push(`| # | ${t('report.step')} | ${t('report.status')} | ${t('report.deps')} | ${t('report.durationCol')} | ${t('report.tokensCol')} | ${t('report.added')} |`)
      lines.push('|---|-----|--------|-------------|--------------|------------|----------|')
    }
    view.nodes.forEach((n, i) => {
      const dur = n.durationMs ? `${(n.durationMs / 1000).toFixed(1)} s` : '—'
      const tokens = n.usage ? `↑ ${n.usage.input} / ↓ ${n.usage.output}` : '—'
      const added = n.dynamic ? `${t('report.addedDynamic')} (v${n.addedAtVersion})` : `${t('report.addedPlan')} (v1)`
      const base = `| ${i + 1} | ${n.title} | ${n.status} | ${n.dependsOn.join(', ') || '—'} | ${dur} | ${tokens}`
      lines.push(
        nodesHaveCost
          ? `${base} | ${n.usage?.costUsd ? fmtCost(n.usage.costUsd) : '—'} | ${added} |`
          : `${base} | ${added} |`
      )
    })
    lines.push('')
    const decisions = view.nodes.filter((n) => n.kind === 'decision' && n.decision)
    if (decisions.length) {
      lines.push(`## ${t('report.decisionsSection')}`)
      lines.push('')
      decisions.forEach((d) => {
        const dec = d.decision!
        const picked = chosenIds(dec)
        lines.push(`### ${d.title}`)
        lines.push(`- **${t('report.question')}:** ${dec.question}`)
        if (dec.domain) lines.push(`- **${t('report.domain')}:** ${decisionDomainLabel(dec.domain, L)}`)
        if (selectionMode(dec) === 'mixed') lines.push(`- **${t('report.selection')}:** ${t('report.mixed')}`)
        dec.options.forEach((o) => {
          const mark = picked.includes(o.id) ? `✅ **${t('report.chosen')}**` : '—'
          lines.push(`- ${mark} **${t('report.option')} «${o.id}» — ${o.label}:** ${o.rationale}`)
          if (o.nextSteps.length) lines.push(`  - ${t('report.nextSteps')}: ${o.nextSteps.join(' → ')}`)
        })
        if (picked.length) {
          lines.push(
            `- **${t('report.outcome')}:** ${t('report.option')} «${picked.join(' + ')}» · ${t('report.decidedBy')} ${
              dec.chosenBy === 'user' ? t('report.byUser') : t('report.byAgent')
            }${picked.length > 1 ? ` · ${t('report.mixed')}` : ''}`
          )
          if (dec.reasoning) lines.push(`- **${t('report.reasoning')}:** ${dec.reasoning}`)
        } else {
          lines.push(`- **${t('report.outcome')}:** ${t('report.notDecided')}`)
        }
        lines.push('')
      })
    }
    if (view.nodes.some((n) => n.reason)) {
      lines.push(`## ${t('report.reasonsSection')}`)
      lines.push('')
      view.nodes.filter((n) => n.reason).forEach((n) => lines.push(`- **${n.title}** (v${n.addedAtVersion}): ${n.reason}`))
      lines.push('')
    }
    lines.push(`## ${t('report.outputsSection')}`)
    lines.push('')
    view.nodes.forEach((n, i) => {
      lines.push(`### ${i + 1}. ${n.title}`)
      if (n.overridden) lines.push(`_${t('report.overriddenNote')}_`)
      lines.push(`- **${t('report.input')}:** ${n.input ? t('report.seeBelow') : '—'}`)
      lines.push(`- **${t('report.output')}:** ${n.output || '—'}`)
      if (n.input) {
        lines.push('')
        lines.push('```')
        lines.push(n.input)
        lines.push('```')
      }
      lines.push('')
    })
    lines.push(`## ${t('report.chronologySection')}`)
    lines.push('')
    view.logs.forEach((l) => {
      const time = new Date(l.ts).toLocaleTimeString(L === 'en' ? 'en-US' : 'ru-RU')
      lines.push(`- \`${time}\` **[${l.kind}]** ${l.message}`)
    })
    if (view.summary) {
      lines.push('')
      lines.push(`## ${t('report.summarySection')}`)
      lines.push('')
      lines.push(view.summary)
    }
    return lines.join('\n')
  }

  if (!meta) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        <Radio className="size-4 text-emerald-400" />
        <span className="min-w-0 flex-1">{t('toolbar.engineReady')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-secondary/40 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RunStatusBadge status={view.status} />
        <ModeBadge mode={meta.mode} model={meta.mode === 'llm' ? runLlm?.planner?.model : undefined} />
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
              <div className="flex items-center rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label={t('toolbar.decisionGroupAria')}>
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
                  <span className="hidden sm:inline">{t('toolbar.decisionsManual')}</span>
                  <span className="sm:hidden">{t('toolbar.manualShort')}</span>
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
                  <span className="hidden sm:inline">{t('toolbar.auto')}</span>
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('toolbar.decisionTooltip')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" onClick={() => control(view.status === 'paused' ? 'resume' : 'pause')} disabled={!canControl} aria-label={t('toolbar.pauseAria')}>
                {view.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{view.status === 'paused' ? t('toolbar.resume') : t('toolbar.pause')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8 text-red-400 hover:text-red-300" onClick={() => control('stop')} disabled={!canControl} aria-label={t('toolbar.stopAria')}>
                <Square className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.stop')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" onClick={exportReport} aria-label={t('toolbar.exportAria')}>
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('toolbar.export')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
          <Progress value={view.progress} className="h-1.5 flex-1" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t('toolbar.progress', { progress: view.progress, done: doneCount, total: view.nodes.length })}
          </span>
        </div>

        {/* ─── Метр «понимания задачи»: насколько узкий вектор решения ─── */}
        {certainty != null && certaintyInfo && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex min-w-[210px] max-w-[290px] items-center gap-2" role="meter" aria-label={t('toolbar.certaintyAria')} aria-valuenow={Math.round(certainty * 100)}>
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
                    {t('toolbar.waitsClarification', { n: openQuestions })}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold">{t('toolbar.certaintyTitle', { label: certaintyInfo.label })}</p>
              <p className="mt-1 text-xs opacity-90">{certaintyInfo.hint}</p>
              {openQuestions > 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{t('toolbar.openQuestions', { n: openQuestions })}</p>
              )}
            </TooltipContent>
          </Tooltip>
        )}

        {elapsed != null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {['completed', 'stopped', 'error'].includes(view.status) ? t('toolbar.elapsedFinal') : t('toolbar.elapsedRunning')}:{' '}
            {elapsed.toFixed(1)} s
          </span>
        )}

        {/* ─── Аудит токенов и стоимости (ADR-015/016): счётчики запуска, live и replay ─── */}
        {view.usage && view.usage.calls > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="status"
                aria-label={t('toolbar.usageAria', { input: view.usage.inputTokens, output: view.usage.outputTokens, calls: view.usage.calls, cost: view.usage.costUsd ? fmtUsd(view.usage.costUsd, locale) : '' })}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white/70 px-2 py-0.5 text-xs font-medium tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200"
              >
                <Coins className="size-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
                <span className="whitespace-nowrap">
                  ↑ {fmtTokens(view.usage.inputTokens, locale)} · ↓ {fmtTokens(view.usage.outputTokens, locale)} ·{' '}
                  {view.usage.calls} {t('toolbar.callsShort')}{view.usage.costUsd ? ` · ${fmtCost(view.usage.costUsd)}` : ''}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="font-semibold">{t('toolbar.usageTitle')}</p>
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(view.usage.byRole)
                  .sort((a, b) => b[1].calls - a[1].calls)
                  .map(([role, u]) => (
                    <p key={role} className="flex items-center justify-between gap-4 text-xs tabular-nums">
                      <span>{llmRoleLabel(role, locale)}</span>
                      <span>
                        ↑ {u.inputTokens} / ↓ {u.outputTokens} · {u.calls} {t('toolbar.callsShort')}
                        {u.costUsd ? ` · ${fmtCost(u.costUsd)}` : ''}
                      </span>
                    </p>
                  ))}
              </div>
              <p className="mt-1.5 border-t border-border pt-1.5 text-xs font-semibold tabular-nums">
                {t('toolbar.usageTotal', { input: view.usage.inputTokens, output: view.usage.outputTokens, calls: view.usage.calls })}
                {view.usage.costUsd ? ` · ${fmtCost(view.usage.costUsd)}` : ''}
              </p>
              {view.usage.costUsd ? (
                <p className="mt-1 text-[11px] leading-relaxed opacity-80">
                  {t('toolbar.usageFootnoteCost', { sources: [priceSourceLabel('openrouter', locale), priceSourceLabel('litellm', locale), priceSourceLabel('manual', locale)].join(' / ') })}
                  {curRate
                    ? ` ${t('toolbar.usageRateNote', { source: currencySourceLabel(curRate.source, locale), asOf: curRate.asOf ?? '' })}`
                    : ` ${t('toolbar.usageNoRate')}`}
                  {` ${t('toolbar.usageTailNote')}`}
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-relaxed opacity-80">
                  {t('toolbar.usageUnpriced', { n: view.usage.unpricedCalls ? `${view.usage.unpricedCalls} ${t('toolbar.callsShort')}` : '' })}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        )}
        {markers.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">{t('toolbar.versions')}:</span>
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
            {(decisionMode ?? 'manual') === 'manual' ? t('toolbar.waitingUser') : t('toolbar.waitingAuto')}
            <span className="ml-2 hidden text-xs text-amber-700/80 dark:text-amber-300/70 md:inline">{offered.title}</span>
          </span>
          {(decisionMode ?? 'manual') === 'manual' && (
            <Button size="sm" variant="secondary" className="h-7 gap-1.5 border-amber-500/40 bg-amber-500/15 px-3 text-xs text-amber-900 hover:bg-amber-500/25 dark:text-amber-100" onClick={openDecision}>
              <GitFork className="size-3" />
              {t('toolbar.openChoice')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
