// TACG — инспектор узла: модальное окно (≥50% ширины экрана) для лучшей читаемости
// Для узлов-развилок показывает вопрос, варианты и обоснование выбора; для веток — принадлежность
'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PenLine, RotateCcw, Copy, MousePointerClick, Sparkles, Clock3, Cpu, Coins, GitBranch, GitFork, Hash, CheckCircle2, Bot, User, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NodeStatusBadge } from './status-badge'
import { chosenIds, convertUsd, decisionDomainLabel, fmtCurrency, fmtUsd, GraphNode, RunEvent, selectionMode } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useI18nStore, useT } from '@/lib/tacg/i18n'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const OPTION_STYLES: Record<string, string> = {
  a: 'bg-sky-500/25 text-sky-700 dark:text-sky-300',
  b: 'bg-fuchsia-500/25 text-fuchsia-700 dark:text-fuchsia-300',
  c: 'bg-orange-500/25 text-orange-700 dark:text-orange-300',
}

/** Поиск состояния узла в потоке событий (учитывает курсор воспроизведения) */
function findNode(events: RunEvent[], selectedNodeId: string, cursor: number | null): GraphNode | null {
  // Живой вид + инспектор (CR-016): node:stream — эфемерный снапшот выхода
  // исполнителя; применяется к running-узлу ПОСЛЕ последнего node:update и
  // затирается следующим node:update (в персистентной истории стримов нет —
  // replay с курсором их не встретит, семантика неизменна)
  const upto = cursor === null ? events.length - 1 : Math.min(cursor, events.length - 1)
  let found: GraphNode | null = null
  let streamingText: string | undefined
  for (let i = 0; i <= upto; i++) {
    const ev = events[i]
    if (ev.type === 'node:update' && ev.node.id === selectedNodeId) {
      found = ev.node
      streamingText = undefined
    } else if (ev.type === 'node:stream' && ev.nodeId === selectedNodeId) {
      streamingText = ev.text
    } else if (ev.type === 'graph:adapt') {
      const n = ev.nodes.find((x) => x.id === selectedNodeId)
      if (n) {
        found = n
        streamingText = undefined
      }
    } else if (ev.type === 'graph:init') {
      const n = ev.nodes.find((x) => x.id === selectedNodeId)
      found = n ?? null
      streamingText = undefined
    }
  }
  if (found && streamingText !== undefined && found.status === 'running') {
    return { ...found, streamingText }
  }
  return found
}

export function NodeInspectorModal() {
  const selectedNodeId = useTacgStore((s) => s.selectedNodeId)
  const select = useTacgStore((s) => s.select)
  const cursor = useTacgStore((s) => s.cursor)
  const events = useTacgStore((s) => s.events)
  // Конвертация стоимости (FR-910): курс выбранной валюты с сервера
  const curEntry = useTacgStore((s) =>
    s.displayCurrency !== 'USD'
      ? s.currencyStatus?.entries.find((e) => e.code === s.displayCurrency && e.rate > 0) ?? null
      : null
  )
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const openDecision = useTacgStore((s) => s.openDecision)
  const t = useT()
  const locale = useI18nStore((s) => s.locale)
  const num = (v: number) => v.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU')

  const node = useMemo<GraphNode | null>(
    () => (selectedNodeId ? findNode(events, selectedNodeId, cursor) : null),
    [selectedNodeId, cursor, events],
  )

  const isWaitingDecision =
    !!node &&
    node.kind === 'decision' &&
    node.decision?.status === 'offered' &&
    chosenIds(node.decision).length === 0 &&
    node.status === 'running'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditing(false)
  }, [selectedNodeId, node?.status])

  const close = (open: boolean) => {
    if (!open) select(null)
  }

  const copy = (text?: string) => {
    if (text) navigator.clipboard?.writeText(text).then(() => toast.success(t('inspector.copied')))
  }

  const startEdit = () => {
    setDraft(node?.output ?? '')
    setEditing(true)
  }

  const saveOverride = () => {
    if (!currentRunId || !draft.trim() || !node) return
    getSocket().emit('node:override', { runId: currentRunId, nodeId: node.id, output: draft })
    setEditing(false)
    toast.success(t('inspector.overriddenToast'))
  }

  const retry = () => {
    if (!currentRunId || !node) return
    getSocket().emit('node:retry', { runId: currentRunId, nodeId: node.id })
    toast.info(t('inspector.retryToast'))
  }

  const isPlayback = cursor !== null
  const dec = node?.kind === 'decision' ? node.decision : undefined
  const branchOf = node?.branchOf
  const pickedIds = dec ? chosenIds(dec) : []
  const decMixed = selectionMode(dec) === 'mixed'

  return (
    <Dialog open={!!selectedNodeId} onOpenChange={close}>
      <DialogContent
        className="flex h-[86dvh] max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-200 bg-white/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw] dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <DialogDescription className="sr-only">{t('inspector.description')}</DialogDescription>

        {!node ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
            <MousePointerClick className="size-8" />
            <p className="max-w-sm text-center text-sm">{t('inspector.nodeNotFound')}</p>
          </div>
        ) : (
          <>
            {/* ─── Шапка модалки ─── */}
            <DialogHeader className="border-b border-zinc-200/80 px-6 py-4 text-left dark:border-zinc-800/80">
              <div className="flex items-start justify-between gap-4 pr-8">
                <DialogTitle className="text-lg font-semibold leading-tight">{node.title}</DialogTitle>
                <NodeStatusBadge status={node.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="gap-1 border-zinc-300 font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  <Hash className="size-2.5" />
                  {node.id}
                </Badge>
                {node.dynamic && (
                  <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300">
                    <Sparkles className="mr-1 size-3" />
                    {t('inspector.addedDynamic', { v: node.addedAtVersion ?? 0 })}
                  </Badge>
                )}
                {node.kind === 'decision' && (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <GitFork className="mr-1 size-3" />
                    {t('inspector.forkBadge', { n: node.decision?.options.length ?? 0 })}
                  </Badge>
                )}
                {branchOf && (
                  <Badge
                    variant="outline"
                    className={cn('font-bold uppercase', branchOf.optionId === 'a' ? 'border-sky-500/40 text-sky-700 dark:text-sky-300' : branchOf.optionId === 'b' ? 'border-fuchsia-500/40 text-fuchsia-700 dark:text-fuchsia-300' : 'border-orange-500/40 text-orange-700 dark:text-orange-300')}
                    title={t('inspector.branchBadgeTitle', { option: branchOf.optionId, decision: branchOf.decisionId })}
                  >
                    <GitBranch className="mr-1 size-3" />
                    {t('inspector.branchBadge', { option: branchOf.optionId })}
                  </Badge>
                )}
                {node.overridden && (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    <PenLine className="mr-1 size-3" />
                    {t('inspector.overriddenBadge')}
                  </Badge>
                )}
                {(node.runs ?? 0) > 1 && (
                  <Badge variant="outline" className="border-zinc-400 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                    <RotateCcw className="mr-1 size-3" />
                    {t('inspector.runsBadge', { n: node.runs ?? 0 })}
                  </Badge>
                )}
                {node.llm && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-teal-500/40 bg-teal-500/10 font-mono text-[10px] text-teal-700 dark:text-teal-300"
                    title={t('inspector.llmBadgeTitle', { adapter: node.llm.adapter })}
                  >
                    <Cpu className="size-3" />
                    {t('inspector.llmBadge', { model: node.llm.model, adapter: node.llm.adapter })}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {/* ─── Тело: слева мета-информация, справа вход/выход ─── */}
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              {/* Левая колонка */}
              <div className="min-h-0 shrink-0 space-y-4 overflow-y-auto border-b border-zinc-200/80 p-5 md:w-[340px] md:border-b-0 md:border-r dark:border-zinc-800/80">
                {node.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{node.description}</p>
                )}

                {node.reason && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-800 dark:text-violet-200">
                    <span className="font-semibold">{t('inspector.reasonLabel')} </span>
                    {node.reason}
                  </div>
                )}

                {/* ─── Секция развилки: вопрос, варианты, обоснование выбора ─── */}
                {dec && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                      <span className="font-semibold">{t('inspector.forkQuestionLabel')} </span>
                      {dec.question}
                      {(dec.domain || decMixed) && (
                        <span className="mt-1.5 block text-[11px] text-amber-700/80 dark:text-amber-300/70">
                          {dec.domain ? `${t('inspector.domainLabel')} ${decisionDomainLabel(dec.domain, locale)}` : ''}
                          {dec.domain && decMixed ? ' · ' : ''}
                          {decMixed ? t('inspector.mixedAllowed') : ''}
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('inspector.agentOptions')}</h4>
                      {dec.options.map((o) => {
                        const chosen = pickedIds.includes(o.id)
                        return (
                          <div
                            key={o.id}
                            className={cn(
                              'rounded-lg border p-3',
                              chosen
                                ? 'border-emerald-500/50 bg-emerald-500/10'
                                : 'border-zinc-300 bg-zinc-100/70 dark:border-zinc-700/70 dark:bg-zinc-900/60',
                              !chosen && pickedIds.length > 0 && 'opacity-60'
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className={cn(
                                    'flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold uppercase',
                                    OPTION_STYLES[o.id] ?? 'bg-zinc-500/25 text-zinc-300'
                                  )}
                                >
                                  {o.id}
                                </span>
                                <span className="min-w-0 text-xs font-semibold leading-snug break-words text-zinc-900 dark:text-zinc-100">{o.label}</span>
                              </div>
                              {chosen && (
                                <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                  <CheckCircle2 className="size-3" />
                                  {pickedIds.length > 1 ? t('inspector.inCombo') : t('inspector.chosen')}
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{o.rationale}</p>
                            {o.nextSteps.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                                {t('inspector.nextSteps')} {o.nextSteps.map((s, i) => `${i + 1}. ${s}`).join(' → ')}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {dec.status === 'offered' && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <GitFork className="size-3.5 shrink-0 animate-pulse" />
                        {(decisionMode ?? 'manual') === 'manual' ? t('inspector.forkWaitsUser') : t('inspector.forkAgentDecides')}
                      </div>
                    )}

                    {pickedIds.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-emerald-300">
                          <CheckCircle2 className="size-3.5" />
                          {t('inspector.decidedBy')} {dec.chosenBy === 'user' ? t('inspector.byUser') : t('inspector.byAgent')}
                          <span className="text-zinc-500">
                            ·{' '}
                            {pickedIds.length > 1
                              ? t('inspector.mixedOutcome', { ids: pickedIds.join(' + ') })
                              : t('inspector.singleOutcome', { id: pickedIds[0] })}
                          </span>
                        </div>
                        {dec.reasoning && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-800 dark:text-emerald-100">
                            <span className="font-semibold">
                              {dec.chosenBy === 'agent' ? (
                                <span className="inline-flex items-center gap-1">
                                  <Bot className="size-3" /> {t('inspector.agentReasoning')}{' '}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <User className="size-3" /> {t('inspector.userRationale')}{' '}
                                </span>
                              )}
                            </span>
                            {dec.reasoning}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {node.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-700 dark:text-red-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{node.error}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5" />
                    {node.status === 'done' && node.durationMs
                      ? `${(node.durationMs / 1000).toFixed(1)} s`
                      : node.status === 'running' && node.startedAt
                        ? `${((Date.now() - node.startedAt) / 1000).toFixed(1)} s…`
                        : '—'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5" />
                    {t('inspector.depsCount', { n: node.dependsOn.length })}
                  </div>
                  {/* Аудит токенов и стоимости (ADR-015/016 + FR-910): затраты LLM-вызовов узла */}
                  {node.usage && (node.usage.input > 0 || node.usage.output > 0) && (
                    <div
                      className="col-span-2 flex items-center gap-1.5 tabular-nums"
                      title={t('inspector.usageTitle')}
                    >
                      <Coins className="size-3.5 text-teal-500 dark:text-teal-400" />
                      {t('inspector.tokens', { input: num(node.usage.input), output: num(node.usage.output) })}
                      {node.usage.costUsd ? (
                        <span className="font-medium text-teal-600 dark:text-teal-300">
                          · ≈{fmtUsd(node.usage.costUsd, locale)}
                          {curEntry
                            ? ` · ${fmtCurrency(convertUsd(node.usage.costUsd, curEntry.rate) ?? 0, curEntry.code, locale)}`
                            : ''}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                {node.dependsOn.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('inspector.inputsSection')}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {node.dependsOn.map((d) => (
                        <button
                          key={d}
                          onClick={() => select(d)}
                          className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 transition-colors hover:border-cyan-500/50 hover:text-cyan-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-cyan-300"
                          title={t('inspector.gotoDep')}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Правая колонка: вход/выход */}
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('inspector.inputSection')}</h4>
                    {node.input && (
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.input)} aria-label={t('inspector.copyInputAria')}>
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                  {/* Полный текст без обрезки: прокрутка — на уровне колонки */}
                  <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-100 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                    {node.input ?? t('inspector.notStarted')}
                  </pre>
                </section>

                <Separator />

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('inspector.outputSection')}</h4>
                    {!editing && node.output && (
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.output)} aria-label={t('inspector.copyOutputAria')}>
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                  {node.status === 'error' ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
                      {t('inspector.nodeFailed')}
                    </div>
                  ) : node.status === 'running' && node.streamingText ? (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-cyan-600 dark:text-cyan-300">
                        <Loader2 className="size-3 animate-spin" />
                        {t('inspector.streaming', { n: node.streamingText.length })}
                      </div>
                      <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-100 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                        {node.streamingText}
                        <span className="animate-pulse text-cyan-600 dark:text-cyan-300">▌</span>
                      </pre>
                    </div>
                  ) : node.status === 'running' ? (
                    <div className="animate-pulse rounded-md border bg-zinc-100 p-3 font-mono text-xs text-zinc-500 dark:bg-zinc-900/70 dark:text-zinc-500">
                      {t('inspector.nodeRunning')}
                    </div>
                  ) : editing ? (
                    <div className="space-y-2.5">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="min-h-[160px] font-mono text-xs"
                        placeholder={t('inspector.overridePlaceholder')}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveOverride} disabled={!draft.trim()}>
                          <PenLine className="mr-1.5 size-3.5" />
                          {t('inspector.saveAndRecompute')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : node.status === 'done' ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-100 p-3 font-mono text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                      {node.output}
                    </pre>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      {t('inspector.notRunYet')}
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* ─── Подвал: вмешательство ─── */}
            <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-200/80 px-6 py-3.5 dark:border-zinc-800/80">
              {isWaitingDecision && (
                <Button
                  size="sm"
                  onClick={() => {
                    select(null)
                    openDecision()
                  }}
                  disabled={isPlayback || !currentRunId || (decisionMode ?? 'manual') !== 'manual'}
                  title={
                    (decisionMode ?? 'manual') !== 'manual'
                      ? t('inspector.autoDecides')
                      : t('inspector.openChoiceTitle')
                  }
                  className="border-amber-500/40 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25 dark:text-amber-100"
                >
                  <GitFork className="mr-1.5 size-3.5" />
                  {t('inspector.openChoice')}
                </Button>
              )}
              {node.status === 'done' && !editing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEdit}
                  disabled={isPlayback || !currentRunId}
                  title={isPlayback ? t('inspector.playbackHint') : t('inspector.overrideTitle')}
                >
                  <PenLine className="mr-1.5 size-3.5" />
                  {t('inspector.overrideResult')}
                </Button>
              )}
              {node.status === 'error' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                  disabled={isPlayback || !currentRunId}
                  title={isPlayback ? t('inspector.playbackHint') : t('inspector.retryTitle')}
                >
                  <RotateCcw className="mr-1.5 size-3.5" />
                  {t('inspector.retryNode')}
                </Button>
              )}
              {isPlayback && (
                <p className="text-xs text-muted-foreground">{t('inspector.playbackNote')}</p>
              )}
              <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-600">
                {t('inspector.footerHint')}
              </span>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
