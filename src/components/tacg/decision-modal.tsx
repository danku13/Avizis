// TACG — модалка выбора на развилке: варианты с обоснованием и превью шагов.
// Авто-режим — агент решает сам (опции заблокированы), ручной — ожидает выбор пользователя.
// Открывается автоматически при предложении развилки; закрытие скрывает окно, но не отменяет ожидание.
'use client'

import { useState } from 'react'
import { Bot, GitFork, Hand, Loader2, MousePointerClick } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { foldEvents, findOfferedDecision } from '@/lib/tacg/fold'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const OPTION_STYLES: Record<string, { chip: string; stripe: string; ring: string }> = {
  a: { chip: 'bg-sky-500/25 text-sky-300', stripe: 'bg-sky-400/80', ring: 'ring-sky-400/70 border-sky-400/60' },
  b: { chip: 'bg-fuchsia-500/25 text-fuchsia-300', stripe: 'bg-fuchsia-400/80', ring: 'ring-fuchsia-400/70 border-fuchsia-400/60' },
  c: { chip: 'bg-orange-500/25 text-orange-300', stripe: 'bg-orange-400/80', ring: 'ring-orange-400/70 border-orange-400/60' },
}
const optStyle = (id: string) => OPTION_STYLES[id] ?? { chip: 'bg-zinc-500/25 text-zinc-300', stripe: 'bg-zinc-400/80', ring: 'ring-zinc-400/70 border-zinc-500/60' }

export function DecisionModal() {
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const currentRunId = useTacgStore((s) => s.currentRunId)
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const decisionDismissed = useTacgStore((s) => s.decisionDismissed)
  const dismissDecision = useTacgStore((s) => s.dismissDecision)
  const openDecision = useTacgStore((s) => s.openDecision)

  const isLive = cursor === null
  // без useMemo: свёртка дешёвая, а условный slice внутри memo нарушает preserve-manual-memoization
  const view = foldEvents(isLive ? events : events.slice(0, cursor! + 1))
  const offered = isLive ? findOfferedDecision(view.nodes) : undefined

  // выбор привязан к id предложения: при новой развилке сбрасывается автоматически
  const [selection, setSelection] = useState<{ offeredId: string; optionId: string } | null>(null)
  const selected = selection && offered && selection.offeredId === offered.id ? selection.optionId : null
  const setSelected = (optionId: string | null) => {
    setSelection(offered && optionId ? { offeredId: offered.id, optionId } : null)
  }

  const open = !!offered && decisionDismissed !== offered.id
  const mode = decisionMode ?? 'manual'
  const manual = mode === 'manual'

  const close = (o: boolean) => {
    if (!o && offered) dismissDecision(offered.id)
  }

  const accept = () => {
    if (!offered || !selected || !currentRunId || !manual) return
    getSocket().emit('decision:resolve', { runId: currentRunId, nodeId: offered.id, optionId: selected })
    // модалка закроется сама по событию decision:resolved (узел уйдёт из состояния offered)
    toast.info('Вариант отправлен — ветка активируется')
  }

  const switchMode = (m: 'auto' | 'manual') => {
    if (!currentRunId || m === mode) return
    getSocket().emit('decision:mode', { runId: currentRunId, mode: m })
    toast.info(
      m === 'auto'
        ? 'Режим «авто»: агент примет решение сам (в том числе на текущей развилке)'
        : 'Режим «ручной выбор»: агент будет предлагать варианты и ждать'
    )
  }

  if (!offered) return null
  const dec = offered.decision!

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex h-[86dvh] max-h-[86dvh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden border-zinc-800 bg-zinc-950/95 p-0 backdrop-blur-md sm:max-w-none sm:w-[55vw] lg:w-[58vw] xl:w-[64vw]"
      >
        <DialogDescription className="sr-only">
          Развилка графа вычислений: варианты агента с обоснованием, выбор активирует одну из веток
        </DialogDescription>

        {/* ─── Шапка ─── */}
        <DialogHeader className="border-b border-zinc-800/80 px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <DialogTitle className="flex items-center gap-2.5 text-lg font-semibold leading-tight">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/15 text-fuchsia-300">
                <GitFork className="size-4.5" />
              </span>
              {offered.title}
            </DialogTitle>
            <span className="mt-0.5 flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-0.5 text-xs font-medium text-fuchsia-300">
              <span className="size-1.5 animate-pulse rounded-full bg-fuchsia-400" />
              развилка · {manual ? 'ждёт вашего выбора' : 'агент выбирает сам'}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-300">{dec.question}</p>
        </DialogHeader>

        {/* ─── Варианты ─── */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {manual ? (
            <p className="text-xs text-muted-foreground">
              Агент предлагает {dec.options.length} варианта. Выбор определяет дальнейшие шаги — нереализованные
              ветки погаснут на графе сразу после решения.
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 p-3 text-xs text-fuchsia-200">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              Режим «авто»: агент взвешивает варианты и примет решение самостоятельно. Обоснование появится в
              инспекторе узла и в журнале.
            </div>
          )}

          {dec.options.map((o) => {
            const st = optStyle(o.id)
            const isSel = selected === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => manual && setSelected(o.id)}
                disabled={!manual}
                aria-pressed={isSel}
                className={cn(
                  'relative block w-full overflow-hidden rounded-xl border bg-zinc-900/60 p-4 pl-5 text-left transition-all',
                  manual && 'cursor-pointer hover:border-zinc-500',
                  isSel ? cn('border ring-2', st.ring) : 'border-zinc-700/70',
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
                    <span className="min-w-0 truncate text-sm font-semibold text-zinc-100">{o.label}</span>
                  </div>
                  {isSel && (
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      выбран
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">{o.rationale}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500">дальше:</span>
                  {o.nextSteps.map((s, i) => (
                    <span
                      key={i}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-300"
                    >
                      {i + 1}. {s}
                    </span>
                  ))}
                  {o.nextSteps.length === 0 && <span className="text-[11px] text-zinc-500">прямое продолжение</span>}
                </div>
              </button>
            )
          })}

          <p className="flex items-center gap-1.5 pt-1 text-[11px] text-zinc-600">
            <MousePointerClick className="size-3" />
            Esc скрывает окно — ожидание выбора не отменяется. Вернуться можно кликом по развилке на графе или
            баннером в панели управления.
          </p>
        </div>

        {/* ─── Подвал: режим + принятие ─── */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-800/80 px-6 py-3.5">
          <div className="flex items-center rounded-lg border border-zinc-700 p-0.5" role="group" aria-label="Режим принятия решений">
            <button
              type="button"
              onClick={() => switchMode('manual')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                manual ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Агент предлагает варианты и ожидает вашего решения"
            >
              <Hand className="size-3.5" />
              Вручную
            </button>
            <button
              type="button"
              onClick={() => switchMode('auto')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                !manual ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-zinc-400 hover:text-zinc-200'
              )}
              title="Агент принимает решения на развилках сам"
            >
              <Bot className="size-3.5" />
              Авто
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!manual && <span className="text-xs text-zinc-500">переключите в «Вручную», чтобы выбрать самому</span>}
            <Button size="sm" onClick={accept} disabled={!manual || !selected}>
              <GitFork className="mr-1.5 size-3.5" />
              {selected
                ? `Принять вариант «${dec.options.find((o) => o.id === selected)?.label ?? selected}»`
                : 'Выберите вариант'}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
