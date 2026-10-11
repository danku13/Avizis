// TACG — инспектор узла: модальное окно (≥50% ширины экрана) для лучшей читаемости
// Для узлов-развилок показывает вопрос, варианты и обоснование выбора; для веток — принадлежность
'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PenLine, RotateCcw, Copy, MousePointerClick, Sparkles, Clock3, Cpu, GitBranch, GitFork, Hash, CheckCircle2, Bot, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NodeStatusBadge } from './status-badge'
import { chosenIds, DECISION_DOMAIN_LABELS, GraphNode, RunEvent, selectionMode } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const OPTION_STYLES: Record<string, string> = {
  a: 'bg-sky-500/25 text-sky-300',
  b: 'bg-fuchsia-500/25 text-fuchsia-300',
  c: 'bg-orange-500/25 text-orange-300',
}

/** Поиск состояния узла в потоке событий (учитывает курсор воспроизведения) */
function findNode(events: RunEvent[], selectedNodeId: string, cursor: number | null): GraphNode | null {
  if (cursor !== null) {
    let found: GraphNode | null = null
    for (let i = 0; i <= cursor && i < events.length; i++) {
      const ev = events[i]
      if (ev.type === 'node:update' && ev.node.id === selectedNodeId) found = ev.node
      if (ev.type === 'graph:adapt') {
        const n = ev.nodes.find((x) => x.id === selectedNodeId)
        if (n) found = n
      }
      if (ev.type === 'graph:init') {
        const n = ev.nodes.find((x) => x.id === selectedNodeId)
        found = n ?? null
      }
    }
    return found
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type === 'node:update' && ev.node.id === selectedNodeId) return ev.node
    if ((ev.type === 'graph:adapt' || ev.type === 'graph:init') && ev.nodes.some((x) => x.id === selectedNodeId)) {
      return ev.nodes.find((x) => x.id === selectedNodeId) ?? null
    }
  }
  return null
}

export function NodeInspectorModal() {
  const selectedNodeId = useTacgStore((s) => s.selectedNodeId)
  const select = useTacgStore((s) => s.select)
  const cursor = useTacgStore((s) => s.cursor)
  const events = useTacgStore((s) => s.events)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const openDecision = useTacgStore((s) => s.openDecision)

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
    if (text) navigator.clipboard?.writeText(text).then(() => toast.success('Скопировано в буфер'))
  }

  const startEdit = () => {
    setDraft(node?.output ?? '')
    setEditing(true)
  }

  const saveOverride = () => {
    if (!currentRunId || !draft.trim() || !node) return
    getSocket().emit('node:override', { runId: currentRunId, nodeId: node.id, output: draft })
    setEditing(false)
    toast.success('Результат узла переопределён — потомки будут пересчитаны')
  }

  const retry = () => {
    if (!currentRunId || !node) return
    getSocket().emit('node:retry', { runId: currentRunId, nodeId: node.id })
    toast.info('Узел поставлен в очередь на повторное выполнение')
  }

  const isPlayback = cursor !== null
  const dec = node?.kind === 'decision' ? node.decision : undefined
  const branchOf = node?.branchOf
  const pickedIds = dec ? chosenIds(dec) : []
  const decMixed = selectionMode(dec) === 'mixed'

  return (
    <Dialog open={!!selectedNodeId} onOpenChange={close}>
      <DialogContent
        className="flex h-[86dvh] max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-950/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw]"
      >
        <DialogDescription className="sr-only">
          Детали узла графа вычислений: вход, выход, причина добавления и инструменты вмешательства
        </DialogDescription>

        {!node ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-muted-foreground">
            <MousePointerClick className="size-8" />
            <p className="max-w-sm text-center text-sm">
              Состояние узла не найдено в этом кадре истории. Возможно, узел появился позже — переместите курсор
              воспроизведения вперёд или вернитесь в live-режим.
            </p>
          </div>
        ) : (
          <>
            {/* ─── Шапка модалки ─── */}
            <DialogHeader className="border-b border-zinc-800/80 px-6 py-4 text-left">
              <div className="flex items-start justify-between gap-4 pr-8">
                <DialogTitle className="text-lg font-semibold leading-tight">{node.title}</DialogTitle>
                <NodeStatusBadge status={node.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="gap-1 border-zinc-700 font-mono text-[10px] text-zinc-400">
                  <Hash className="size-2.5" />
                  {node.id}
                </Badge>
                {node.dynamic && (
                  <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-300">
                    <Sparkles className="mr-1 size-3" />
                    добавлен динамически · v{node.addedAtVersion}
                  </Badge>
                )}
                {node.kind === 'decision' && (
                  <Badge variant="outline" className="border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300">
                    <GitFork className="mr-1 size-3" />
                    развилка · {node.decision?.options.length ?? 0} варианта
                  </Badge>
                )}
                {branchOf && (
                  <Badge
                    variant="outline"
                    className={cn('font-bold uppercase', branchOf.optionId === 'a' ? 'border-sky-500/40 text-sky-300' : branchOf.optionId === 'b' ? 'border-fuchsia-500/40 text-fuchsia-300' : 'border-orange-500/40 text-orange-300')}
                    title={`Узел принадлежит ветке варианта «${branchOf.optionId}» развилки ${branchOf.decisionId}`}
                  >
                    <GitBranch className="mr-1 size-3" />
                    ветка {branchOf.optionId}
                  </Badge>
                )}
                {node.overridden && (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">
                    <PenLine className="mr-1 size-3" />
                    переопределён пользователем
                  </Badge>
                )}
                {(node.runs ?? 0) > 1 && (
                  <Badge variant="outline" className="border-zinc-600 text-zinc-400">
                    <RotateCcw className="mr-1 size-3" />
                    выполнений: {node.runs}
                  </Badge>
                )}
                {node.llm && (
                  <Badge
                    variant="outline"
                    className="gap-1 border-teal-500/40 bg-teal-500/10 font-mono text-[10px] text-teal-300"
                    title={`LLM-вызов узла выполнен через адаптер «${node.llm.adapter}» (provenance BYOK)`}
                  >
                    <Cpu className="size-3" />
                    Модель: {node.llm.model} · {node.llm.adapter}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            {/* ─── Тело: слева мета-информация, справа вход/выход ─── */}
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              {/* Левая колонка */}
              <div className="min-h-0 shrink-0 space-y-4 overflow-y-auto border-b border-zinc-800/80 p-5 md:w-[340px] md:border-b-0 md:border-r">
                {node.description && (
                  <p className="text-sm leading-relaxed text-muted-foreground">{node.description}</p>
                )}

                {node.reason && (
                  <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-200">
                    <span className="font-semibold">Причина добавления: </span>
                    {node.reason}
                  </div>
                )}

                {/* ─── Секция развилки: вопрос, варианты, обоснование выбора ─── */}
                {dec && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3 text-xs leading-relaxed text-fuchsia-200">
                      <span className="font-semibold">Вопрос развилки: </span>
                      {dec.question}
                      {(dec.domain || decMixed) && (
                        <span className="mt-1.5 block text-[11px] text-fuchsia-300/70">
                          {dec.domain ? `Домен уточнения: ${DECISION_DOMAIN_LABELS[dec.domain]}` : ''}
                          {dec.domain && decMixed ? ' · ' : ''}
                          {decMixed ? 'допустимо смешанное решение' : ''}
                        </span>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Варианты агента</h4>
                      {dec.options.map((o) => {
                        const chosen = pickedIds.includes(o.id)
                        return (
                          <div
                            key={o.id}
                            className={cn(
                              'rounded-lg border p-3',
                              chosen ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-zinc-700/70 bg-zinc-900/60',
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
                                <span className="min-w-0 text-xs font-semibold leading-snug break-words text-zinc-100">{o.label}</span>
                              </div>
                              {chosen && (
                                <span className="flex shrink-0 items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                  <CheckCircle2 className="size-3" />
                                  {pickedIds.length > 1 ? 'в составе' : 'выбран'}
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{o.rationale}</p>
                            {o.nextSteps.length > 0 && (
                              <p className="mt-1.5 text-[11px] text-zinc-500">
                                дальше: {o.nextSteps.map((s, i) => `${i + 1}. ${s}`).join(' → ')}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {dec.status === 'offered' && (
                      <div className="flex items-center gap-2 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-3 text-xs text-fuchsia-200">
                        <GitFork className="size-3.5 shrink-0 animate-pulse" />
                        {(decisionMode ?? 'manual') === 'manual'
                          ? 'Развилка ожидает вашего выбора — график приостановлен'
                          : 'Агент выбирает вариант самостоятельно…'}
                      </div>
                    )}

                    {pickedIds.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-emerald-300">
                          <CheckCircle2 className="size-3.5" />
                          Решение принял: {dec.chosenBy === 'user' ? 'пользователь' : 'агент'}
                          <span className="text-zinc-500">
                            ·{' '}
                            {pickedIds.length > 1
                              ? `смешанное решение «${pickedIds.join(' + ')}»`
                              : `вариант «${pickedIds[0]}»`}
                          </span>
                        </div>
                        {dec.reasoning && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100">
                            <span className="font-semibold">
                              {dec.chosenBy === 'agent' ? (
                                <span className="inline-flex items-center gap-1">
                                  <Bot className="size-3" /> Рассуждение агента:{' '}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <User className="size-3" /> Обоснование:{' '}
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
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{node.error}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5" />
                    {node.status === 'done' && node.durationMs
                      ? `${(node.durationMs / 1000).toFixed(1)} с`
                      : node.status === 'running' && node.startedAt
                        ? `${((Date.now() - node.startedAt) / 1000).toFixed(1)} с…`
                        : '—'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <GitBranch className="size-3.5" />
                    Зависимостей: {node.dependsOn.length}
                  </div>
                </div>

                {node.dependsOn.length > 0 && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Входы (зависимости)</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {node.dependsOn.map((d) => (
                        <button
                          key={d}
                          onClick={() => select(d)}
                          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
                          title="Перейти к узлу-зависимости"
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
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Вход</h4>
                    {node.input && (
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.input)} aria-label="Копировать вход">
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                  {/* Полный текст без обрезки: прокрутка — на уровне колонки */}
                  <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-900/70 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                    {node.input ?? '— (узел ещё не стартовал)'}
                  </pre>
                </section>

                <Separator />

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Выход</h4>
                    {!editing && node.output && (
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.output)} aria-label="Копировать выход">
                        <Copy className="size-3" />
                      </Button>
                    )}
                  </div>
                  {node.status === 'error' ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                      Узел завершился ошибкой. См. сообщение в левой колонке.
                    </div>
                  ) : node.status === 'running' ? (
                    <div className="animate-pulse rounded-md border bg-zinc-900/70 p-3 font-mono text-xs text-zinc-500">
                      узел выполняется, результат появится здесь…
                    </div>
                  ) : editing ? (
                    <div className="space-y-2.5">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="min-h-[160px] font-mono text-xs"
                        placeholder="Новый результат узла…"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveOverride} disabled={!draft.trim()}>
                          <PenLine className="mr-1.5 size-3.5" />
                          Сохранить и пересчитать потомков
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                          Отмена
                        </Button>
                      </div>
                    </div>
                  ) : node.status === 'done' ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-900/70 p-3 font-mono text-xs leading-relaxed text-zinc-300">
                      {node.output}
                    </pre>
                  ) : (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      — (узел ещё не выполнялся)
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* ─── Подвал: вмешательство ─── */}
            <footer className="flex flex-wrap items-center gap-2 border-t border-zinc-800/80 px-6 py-3.5">
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
                      ? 'Режим «авто»: агент решает сам'
                      : 'Открыть модалку выбора варианта'
                  }
                  className="border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-100 hover:bg-fuchsia-500/25"
                >
                  <GitFork className="mr-1.5 size-3.5" />
                  Открыть выбор варианта
                </Button>
              )}
              {node.status === 'done' && !editing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEdit}
                  disabled={isPlayback || !currentRunId}
                  title={isPlayback ? 'Вернитесь в live-режим, чтобы вмешиваться' : 'Заменить результат узла и пересчитать потомков'}
                >
                  <PenLine className="mr-1.5 size-3.5" />
                  Переопределить результат
                </Button>
              )}
              {node.status === 'error' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                  disabled={isPlayback || !currentRunId}
                  title={isPlayback ? 'Вернитесь в live-режим, чтобы вмешиваться' : 'Перезапустить ошибочный узел'}
                >
                  <RotateCcw className="mr-1.5 size-3.5" />
                  Повторить узел
                </Button>
              )}
              {isPlayback && (
                <p className="text-xs text-muted-foreground">
                  Режим воспроизведения: вмешательство недоступно. Нажмите «Live» на таймлайне.
                </p>
              )}
              <span className="ml-auto text-[11px] text-zinc-600">
                Esc — закрыть · клик по фону графа — снять выделение
              </span>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
