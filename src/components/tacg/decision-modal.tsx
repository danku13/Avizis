// TACG — модалка выбора на развилке: варианты с обоснованием и превью шагов.
// Поддерживает single (один вариант) и mixed (смешанное решение из нескольких) режимы.
// Авто-режим — агент решает сам (опции заблокированы), ручной — ожидает выбор пользователя.
// Открывается автоматически при предложении развилки; закрытие скрывает окно, но не отменяет ожидание.
'use client'

import { useState } from 'react'
import { Bot, GitFork, Hand, Layers, Loader2, MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { foldEvents, findOfferedDecision } from '@/lib/tacg/fold'
import { decisionDomainLabel, selectionMode } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useI18nStore, useT } from '@/lib/tacg/i18n'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const OPTION_STYLES: Record<string, { chip: string; stripe: string; ring: string }> = {
  a: { chip: 'bg-sky-500/25 text-sky-700 dark:text-sky-300', stripe: 'bg-sky-400/80', ring: 'ring-sky-400/70 border-sky-400/60' },
  b: { chip: 'bg-fuchsia-500/25 text-fuchsia-700 dark:text-fuchsia-300', stripe: 'bg-fuchsia-400/80', ring: 'ring-fuchsia-400/70 border-fuchsia-400/60' },
  c: { chip: 'bg-orange-500/25 text-orange-700 dark:text-orange-300', stripe: 'bg-orange-400/80', ring: 'ring-orange-400/70 border-orange-400/60' },
  d: { chip: 'bg-teal-500/25 text-teal-700 dark:text-teal-300', stripe: 'bg-teal-400/80', ring: 'ring-teal-400/70 border-teal-400/60' },
}
const optStyle = (id: string) =>
  OPTION_STYLES[id] ?? { chip: 'bg-zinc-500/25 text-zinc-600 dark:text-zinc-300', stripe: 'bg-zinc-400/80', ring: 'ring-zinc-400/70 border-zinc-500/60' }

export function DecisionModal() {
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const decisionDismissed = useTacgStore((s) => s.decisionDismissed)
  const dismissDecision = useTacgStore((s) => s.dismissDecision)
  const openDecision = useTacgStore((s) => s.openDecision)
  const t = useT()
  const locale = useI18nStore((s) => s.locale)

  const isLive = cursor === null
  // без useMemo: свёртка дешёвая, а условный slice внутри memo нарушает preserve-manual-memoization
  const view = foldEvents(isLive ? events : events.slice(0, cursor! + 1))
  const offered = isLive ? findOfferedDecision(view.nodes) : undefined

  // выбор привязан к id предложения: при новой развилке сбрасывается автоматически
  const [selection, setSelection] = useState<{ offeredId: string; optionIds: string[] } | null>(null)
  const selectedIds =
    selection && offered && selection.offeredId === offered.id ? selection.optionIds : []
  const dec = offered?.decision
  const mixed = selectionMode(dec) === 'mixed'

  const toggleOption = (optionId: string) => {
    if (!offered) return
    if (mixed) {
      const next = selectedIds.includes(optionId)
        ? selectedIds.filter((id) => id !== optionId)
        : [...selectedIds, optionId]
      setSelection(next.length ? { offeredId: offered.id, optionIds: next } : null)
    } else {
      // single: клик по выбранному снимает выбор, по другому — переключает
      const next = selectedIds[0] === optionId ? [] : [optionId]
      setSelection(next.length ? { offeredId: offered.id, optionIds: next } : null)
    }
  }

  const open = !!offered && decisionDismissed !== offered.id
  const mode = decisionMode ?? 'manual'
  const manual = mode === 'manual'

  const close = (o: boolean) => {
    if (!o && offered) dismissDecision(offered.id)
  }

  const accept = () => {
    if (!offered || !selectedIds.length || !currentRunId || !manual) return
    getSocket().emit('decision:resolve', { runId: currentRunId, nodeId: offered.id, optionIds: selectedIds })
    // модалка закроется сама по событию decision:resolved (узел уйдёт из состояния offered)
    toast.info(
      selectedIds.length > 1 ? t('dm.mixedSentToast', { n: selectedIds.length }) : t('dm.optionSentToast')
    )
  }

  const switchMode = (m: 'auto' | 'manual') => {
    if (!currentRunId || m === mode) return
    getSocket().emit('decision:mode', { runId: currentRunId, mode: m })
    toast.info(m === 'auto' ? t('dm.switchedAutoToast') : t('toolbar.modeManualToast'))
  }

  if (!offered) return null
  const decision = offered.decision!
  const certaintyNow = view.certainty
  const certaintyAfter = decision.certaintyAfter

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex h-[86dvh] max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-200 bg-white/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw] dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <DialogDescription className="sr-only">{t('dm.description')}</DialogDescription>

        {/* ─── Шапка ─── */}
        <DialogHeader className="border-b border-zinc-200/80 px-6 py-4 text-left dark:border-zinc-800/80">
          <div className="flex items-start justify-between gap-4 pr-8">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold leading-tight">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300">
                <GitFork className="size-4.5" />
              </span>
              {offered.title}
            </DialogTitle>
            <div className="mt-0.5 flex shrink-0 flex-wrap items-center gap-1.5">
              {decision.domain && (
                <span className="rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                  {decisionDomainLabel(decision.domain, locale)}
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                {mixed ? <Layers className="size-3" /> : <span className="size-1.5 animate-pulse rounded-full bg-amber-500 dark:bg-amber-400" />}
                {mixed ? t('dm.mixedSelection') : t('dm.singleSelection')}
              </span>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{decision.question}</p>
        </DialogHeader>

        {/* ─── Варианты ─── */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {manual ? (
            <p className="text-xs text-muted-foreground">
              {mixed
                ? t('dm.manualHintMixed', { n: decision.options.length })
                : t('dm.manualHintSingle', { n: decision.options.length })}
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              {t('dm.autoHint', { mixed: mixed ? t('dm.autoHintMixedSuffix') : '' })}
            </div>
          )}

          {decision.options.map((o) => {
            const st = optStyle(o.id)
            const isSel = selectedIds.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => manual && toggleOption(o.id)}
                disabled={!manual}
                aria-pressed={isSel}
                className={cn(
                  'relative block w-full overflow-hidden rounded-xl border bg-white/80 p-4 pl-5 text-left transition-all dark:bg-zinc-900/60',
                  manual && 'cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500',
                  isSel ? cn('border ring-2', st.ring) : 'border-zinc-300 dark:border-zinc-700/70',
                  !manual && 'opacity-60'
                )}
              >
                <span className={cn('absolute bottom-0 left-0 top-0 w-1', st.stripe)} />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-bold uppercase',
                        st.chip
                      )}
                    >
                      {o.id}
                    </span>
                    <span className="min-w-0 text-sm font-semibold leading-snug break-words text-zinc-900 dark:text-zinc-100">{o.label}</span>
                  </div>
                  {isSel && (
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {mixed ? t('inspector.inCombo') : t('inspector.chosen')}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{o.rationale}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500">{t('dm.nextStepsPrefix')}:</span>
                  {o.nextSteps.map((s, i) => (
                    <span
                      key={i}
                      className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                    >
                      {i + 1}. {s}
                    </span>
                  ))}
                  {o.nextSteps.length === 0 && <span className="text-[11px] text-zinc-500">{t('dm.directContinuation')}</span>}
                </div>
              </button>
            )
          })}

          <p className="flex items-center gap-1.5 pt-1 text-[11px] text-zinc-500 dark:text-zinc-600">
            <MousePointerClick className="size-3" />
            {mixed ? t('dm.footerHintMixed') : ''}
            {t('dm.footerHint')}
          </p>
        </div>

        {/* ─── Подвал: режим + принятие ─── */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-200/80 px-6 py-3.5 dark:border-zinc-800/80">
          <div className="flex items-center rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="group" aria-label={t('dm.modeGroupAria')}>
            <button
              type="button"
              onClick={() => switchMode('manual')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                manual
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              )}
              title={t('dm.manualModeTitle')}
            >
              <Hand className="size-3.5" />
              {t('toolbar.manualShort')}
            </button>
            <button
              type="button"
              onClick={() => switchMode('auto')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                !manual
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              )}
              title={t('dm.autoModeTitle')}
            >
              <Bot className="size-3.5" />
              {t('toolbar.auto')}
            </button>
          </div>

          {certaintyNow != null && (
            <span className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex" title={t('dm.certaintyTitle')}>
              {t('dm.certaintyLabel')}: {Math.round(certaintyNow * 100)}%
              {certaintyAfter != null && (
                <span className="text-emerald-600/80 dark:text-emerald-400/80">→ ~{Math.round(Math.max(certaintyNow, certaintyAfter) * 100)}%</span>
              )}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!manual && <span className="text-xs text-zinc-500">{t('dm.switchToManualHint')}</span>}
            <Button size="sm" onClick={accept} disabled={!manual || !selectedIds.length}>
              <GitFork className="mr-1.5 size-3.5" />
              {selectedIds.length > 1
                ? t('dm.acceptMixed', { n: selectedIds.length })
                : selectedIds.length === 1
                  ? t('dm.acceptOption', { label: decision.options.find((o) => o.id === selectedIds[0])?.label ?? selectedIds[0] })
                  : mixed
                    ? t('dm.pickOneOrMore')
                    : t('dm.pickOption')}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
