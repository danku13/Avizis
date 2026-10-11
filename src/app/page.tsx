// TACG Playground — живой граф вычислений агента (вёрстка на всю ширину экрана)
'use client'

import { useEffect, useMemo } from 'react'
import { Activity, Wifi, WifiOff, Eye } from 'lucide-react'
import { getSocket } from '@/lib/tacg/socket'
import { findOfferedDecision, foldEvents } from '@/lib/tacg/fold'
import { useTacgStore } from '@/store/tacg-store'
import { GraphCanvas } from '@/components/tacg/graph-canvas'
import { NodeInspectorModal } from '@/components/tacg/node-inspector'
import { DecisionModal } from '@/components/tacg/decision-modal'
import { EventLog } from '@/components/tacg/event-log'
import { RunToolbar } from '@/components/tacg/run-toolbar'
import { HistoryPanel } from '@/components/tacg/history-panel'
import { Timeline } from '@/components/tacg/timeline'
import { GraphLegend } from '@/components/tacg/status-badge'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function Home() {
  const connected = useTacgStore((s) => s.connected)
  const currentMeta = useTacgStore((s) => s.currentMeta)
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const selectedNodeId = useTacgStore((s) => s.selectedNodeId)
  const select = useTacgStore((s) => s.select)

  // ─── Подключение к движку агента (socket.io) ───
  useEffect(() => {
    const s = getSocket()
    const handlers: Array<[string, (...args: any[]) => void]> = [
      [
        'connect',
        () => useTacgStore.getState().setConnected(true),
      ],
      [
        'disconnect',
        () => useTacgStore.getState().setConnected(false),
      ],
      [
        'history:list',
        (data: any) => useTacgStore.getState().setRuns(data?.runs),
      ],
      [
        'run:created',
        (data: any) => {
          useTacgStore.getState().onRunCreated(
            {
              id: data.runId,
              task: data.task,
              mode: data.mode,
              createdAt: data.createdAt,
            },
            data.decisionMode
          )
        },
      ],
      [
        'run:started',
        () => useTacgStore.getState().onRunStarted(),
      ],
      [
        'run:event',
        (data: any) => {
          const st = useTacgStore.getState()
          if (data?.runId === st.currentRunId && data?.event) {
            st.applyEvent(data.event)
          } else if (data?.runId && data?.event?.type === 'run:status') {
            // обновляем историю, если завершился фоновый запуск
            const terminal = ['completed', 'stopped', 'error'].includes(data.event.status)
            if (terminal) getSocket().emit('history:list')
          }
        },
      ],
      [
        'run:snapshot',
        (data: any) => {
          if (data?.run) useTacgStore.getState().loadSnapshot(data.run)
        },
      ],
      [
        'error:server',
        (data: any) => {
          useTacgStore.getState().setStarting(false)
          import('sonner').then(({ toast }) => toast.error(data?.message || 'Ошибка движка агента'))
        },
      ],
      [
        'decision:resolve:result',
        (data: any) => {
          if (data && data.ok === false) {
            import('sonner').then(({ toast }) =>
              toast.error(data?.error || 'Не удалось принять решение — возможно, оно уже принято')
            )
          }
        },
      ],
      [
        'decision:mode:result',
        (data: any) => {
          if (data && data.ok === false) {
            import('sonner').then(({ toast }) => toast.error(data?.error || 'Не удалось изменить режим решений'))
          }
        },
      ],
    ]
    handlers.forEach(([ev, fn]) => s.on(ev, fn))
    if (s.connected) useTacgStore.getState().setConnected(true)
    return () => {
      handlers.forEach(([ev, fn]) => s.off(ev, fn))
    }
  }, [])

  const isLive = cursor === null
  const view = useMemo(() => foldEvents(isLive ? events : events.slice(0, cursor! + 1)), [events, cursor])
  const offeredDecision = useMemo(
    () => (isLive ? findOfferedDecision(view.nodes) : undefined),
    [view.nodes, isLive]
  )

  return (
    <TooltipProvider delayDuration={200}>
      {/* app-shell: на десктопе занимает весь экран без прокрутки страницы,
          на мобиле — обычная вертикальная прокрутка */}
      <div className="flex min-h-dvh w-full flex-col bg-zinc-950 text-zinc-100 lg:h-dvh lg:overflow-hidden">
        {/* ─── Шапка ─── */}
        <header className="z-20 shrink-0 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
          <div className="flex w-full items-center gap-3 px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-emerald-600 text-zinc-950">
              <Activity className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight">TACG Playground</h1>
              <p className="hidden truncate text-xs text-zinc-500 xl:block">
                Transparent Agent Computation Graph · живая карта мышления агента
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
                  connected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}
                role="status"
              >
                {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                {connected ? 'движок агента: подключён' : 'движок офлайн'}
              </span>
            </div>
          </div>
        </header>

        {/* ─── Основная область на всю ширину экрана ─── */}
        <main className="flex w-full min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row lg:overflow-hidden">
          {/* Левая колонка: запуск + история */}
          <aside className="w-full shrink-0 lg:w-[288px] lg:min-h-0 lg:overflow-y-auto">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
              <HistoryPanel />
            </div>
          </aside>

          {/* Центр на всё оставшееся пространство: тулбар + граф + таймлайн + журнал */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <RunToolbar />

            <div className="flex min-h-[420px] flex-1 flex-col gap-2 lg:min-h-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="size-4 text-zinc-400" />
                  Граф выполнения
                  {currentMeta && !isLive && <span className="text-xs font-normal text-amber-300">· режим воспроизведения</span>}
                </h2>
                <GraphLegend />
              </div>
              <div className="relative min-h-[380px] flex-1 lg:min-h-0">
                <GraphCanvas
                  nodes={view.nodes}
                  selectedNodeId={selectedNodeId}
                  onSelect={select}
                  waitingDecisionId={offeredDecision?.id ?? null}
                  onOpenDecision={() => useTacgStore.getState().openDecision()}
                />
              </div>
            </div>

            <Timeline />

            <div className="flex h-[260px] shrink-0 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5">
              <EventLog />
            </div>
          </section>
        </main>

        {/* ─── Подвал ─── */}
        <footer className="mt-auto shrink-0 border-t border-zinc-800/80 bg-zinc-950/80">
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-zinc-500">
            <span>TACG Prototype v0.4 · прототип для тестирования концепции</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Движок: socket.io мини-сервис + z-ai-web-dev-sdk (LLM)</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">React Flow · Развилки решений · Смешанный выбор · Вектор понимания</span>
          </div>
        </footer>

        {/* Инспектор узла — модалка ≥50% ширины экрана */}
        <NodeInspectorModal />

        {/* Модалка выбора на развилке (авто-режим: агент решает сам) */}
        <DecisionModal />
      </div>
    </TooltipProvider>
  )
}
