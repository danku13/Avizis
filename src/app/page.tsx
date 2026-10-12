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
import { SettingsModal } from '@/components/tacg/settings-modal'
import { EventLog } from '@/components/tacg/event-log'
import { RunToolbar } from '@/components/tacg/run-toolbar'
import { HistoryPanel } from '@/components/tacg/history-panel'
import { Timeline } from '@/components/tacg/timeline'
import { GraphLegend } from '@/components/tacg/status-badge'
import { ThemeToggle } from '@/components/tacg/theme-toggle'
import { LlmChip } from '@/components/tacg/llm-chip'
import { UpdateBadge } from '@/components/tacg/update-badge'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export default function Home() {
  const connected = useTacgStore((s) => s.connected)
  const currentMeta = useTacgStore((s) => s.currentMeta)
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const selectedNodeId = useTacgStore((s) => s.selectedNodeId)
  const select = useTacgStore((s) => s.select)
  const runLlm = useTacgStore((s) => s.runLlm)

  // ─── Подключение к движку агента (socket.io) ───
  useEffect(() => {
    const s = getSocket()
    const handlers: Array<[string, (...args: any[]) => void]> = [
      [
        'connect',
        () => {
          useTacgStore.getState().setConnected(true)
          // BYOK: подтянить актуальную конфигурацию LLM (только маска ключа)
          getSocket().emit('llm:config:get')
        },
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
            data.decisionMode,
            data.llm
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
            // Ошибка прогона видна сразу тостом — не только в свёрнутом журнале
            const ev = data.event
            if (ev.type === 'run:status' && ev.status === 'error') {
              import('sonner').then(({ toast }) =>
                toast.error('Прогон завершился ошибкой', {
                  description: ev.reason || 'Подробности — в журнале событий (нажмите «Повторить узел» для ретрая)',
                })
              )
            }
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
      // ─── BYOK: конфигурация LLM (ответ всегда с маской ключа) ───
      [
        'llm:config',
        (data: any) => {
          useTacgStore.getState().setLlmConfig(data?.config ?? null)
        },
      ],
      [
        'llm:config:saved',
        (data: any) => {
          const st = useTacgStore.getState()
          st.setLlmSaving(false)
          if (data?.ok) {
            st.setLlmConfig(data.config ?? null)
            st.setLlmStatus({ ok: true, latencyMs: data.latencyMs })
            import('sonner').then(({ toast }) =>
              toast.success('Конфигурация LLM сохранена', {
                description: 'Новые прогоны пойдут через выбранного провайдера',
              })
            )
          } else {
            st.setLlmStatus({ ok: false, error: data?.error })
            import('sonner').then(({ toast }) =>
              toast.error('Конфигурация не сохранена', {
                description: data?.error || 'Проверка подключения не прошла',
              })
            )
          }
        },
      ],
      [
        'llm:config:test:result',
        (data: any) => {
          useTacgStore.getState().setLlmTesting(false)
          useTacgStore.getState().setLlmStatus({ ok: !!data?.ok, error: data?.error, latencyMs: data?.latencyMs })
        },
      ],
      // ─── Динамический прайсинг (ADR-016): статус источников и результат обновления ───
      [
        'pricing:status',
        (data: any) => {
          useTacgStore.getState().setPricingStatus(data ?? null)
        },
      ],
      [
        'pricing:refresh:result',
        (data: any) => {
          import('sonner').then(({ toast }) => {
            if (data?.ok) {
              toast.success('Прайсы моделей обновлены', {
                description: 'Стоимость новых вызовов считается по свежим ценам',
              })
            } else {
              toast.error('Не удалось обновить прайсы', {
                description: data?.error || 'Сетевые источники недоступны — работает кэш',
              })
            }
          })
        },
      ],
      // ─── Конвертация валюты (ADR-019): статус курсов и результат обновления ───
      [
        'currency:status',
        (data: any) => {
          useTacgStore.getState().setCurrencyStatus(data ?? null)
        },
      ],
      [
        'currency:refresh:result',
        (data: any) => {
          import('sonner').then(({ toast }) => {
            if (data?.ok) {
              toast.success('Курсы валют обновлены', {
                description: 'Конвертация стоимости — по свежим курсам',
              })
            } else {
              toast.error('Не удалось обновить курсы', {
                description: data?.error || 'Источники недоступны — работает кэш/ручной курс',
              })
            }
          })
        },
      ],
    ]
    handlers.forEach(([ev, fn]) => s.on(ev, fn))
    if (s.connected) {
      useTacgStore.getState().setConnected(true)
      getSocket().emit('llm:config:get')
      getSocket().emit('currency:get')
    }
    // Валюта отображения (FR-910): выбор переживает перезагрузку (localStorage)
    try {
      const saved = localStorage.getItem('tacg-currency')
      if (saved && /^[A-Z]{3}$/.test(saved)) useTacgStore.getState().setDisplayCurrency(saved)
    } catch {
      /* приватный режим */
    }
    return () => {
      handlers.forEach(([ev, fn]) => s.off(ev, fn))
    }
  }, [])

  const isLive = cursor === null
  const view = useMemo(
    () => foldEvents(isLive ? events : events.slice(0, cursor! + 1), { llm: runLlm ?? undefined }),
    [events, cursor, runLlm]
  )
  // Живой прогон без узлов: видимое «планирование» вместо пустого полотна
  const planningLive =
    !!currentMeta && isLive && view.nodes.length === 0 && (view.status === 'planning' || view.status === 'running')
  const offeredDecision = useMemo(
    () => (isLive ? findOfferedDecision(view.nodes) : undefined),
    [view.nodes, isLive]
  )

  return (
    <TooltipProvider delayDuration={200}>
      {/* app-shell: на десктопе занимает весь экран без прокрутки страницы,
          на мобиле — обычная вертикальная прокрутка */}
      <div className="flex min-h-dvh w-full flex-col bg-zinc-50 text-zinc-900 lg:h-dvh lg:overflow-hidden dark:bg-zinc-950 dark:text-zinc-100">
        {/* ─── Шапка (CR-010): одна компактная строка h-11 — лого, чип LLM (BYOK),
            статус движка и тема; подзаголовок убран как неэффективный, LLM-чип
            перенесён из тулбара (глобальная настройка, а не свойство прогона) ─── */}
        <header className="z-20 shrink-0 border-b border-zinc-200/80 bg-white/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/80">
          <div className="flex h-11 w-full items-center gap-2.5 px-3 sm:px-4">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-600 text-zinc-950">
              <Activity className="size-3.5" />
            </div>
            <h1 className="shrink-0 text-sm font-bold leading-none">TACG Playground</h1>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <LlmChip />
              <span
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium',
                  connected
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                )}
                role="status"
                aria-label={connected ? 'Движок агента: подключён' : 'Движок агента: офлайн'}
                title={connected ? 'Мини-сервис socket.io :3003 — подключён' : 'Движок агента недоступен — проверьте сервис'}
              >
                {connected ? <Wifi className="size-3.5 shrink-0" /> : <WifiOff className="size-3.5 shrink-0" />}
                <span className="hidden sm:inline">{connected ? 'движок: подключён' : 'движок: офлайн'}</span>
              </span>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* ─── Основная область на всю ширину экрана ─── */}
        <main className="flex w-full min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row lg:overflow-hidden">
          {/* Левая колонка: запуск + история */}
          <aside className="w-full shrink-0 lg:w-[288px] lg:min-h-0 lg:overflow-y-auto">
            <div className="rounded-xl border border-zinc-200/80 bg-white/60 p-3.5 lg:flex lg:h-full lg:min-h-0 lg:flex-col dark:border-zinc-800/80 dark:bg-zinc-900/40">
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
                  {currentMeta && !isLive && <span className="text-xs font-normal text-amber-600 dark:text-amber-300">· режим воспроизведения</span>}
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
                  planning={planningLive}
                />
              </div>
            </div>

            <Timeline />

            {/* Журнал событий — сворачиваемый (CR-010): компонент владеет высотой сам,
                сворачивание отдаёт место графу; выбор — в localStorage */}
            <EventLog />
          </section>
        </main>

        {/* ─── Подвал: версия + индикатор автообновления (ADR-021) ─── */}
        <footer className="mt-auto shrink-0 border-t border-zinc-200/80 bg-white/80 dark:border-zinc-800/80 dark:bg-zinc-950/80">
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-zinc-500">
            <span>TACG Prototype v0.11.0 · прототип для тестирования концепции</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Движок: socket.io мини-сервис + z-ai-web-dev-sdk (LLM)</span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">React Flow · Развилки решений · Аудит токенов и стоимости · Валюта · Светлая/тёмная тема</span>
            <span className="ml-auto inline-flex items-center gap-2">
              <UpdateBadge />
            </span>
          </div>
        </footer>

        {/* Инспектор узла — модалка ≥50% ширины экрана */}
        <NodeInspectorModal />

        {/* Модалка выбора на развилке (авто-режим: агент решает сам) */}
        <DecisionModal />

        {/* Модалка настроек LLM (BYOK: свои модели и ключи) */}
        <SettingsModal />
      </div>
    </TooltipProvider>
  )
}
