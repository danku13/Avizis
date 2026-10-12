// TACG — живой журнал событий запуска. CR-010: сворачиваемый контейнер —
// сворачивание освобождает высоту под граф выполнения (главный элемент экрана).
// Контейнер владеет своей высотой сам; выбор пользователя — в localStorage
// 'tacg-log-collapsed'; в свёрнутом виде показываем превью последней записи.
'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { ChevronDown } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LogEntry } from '@/lib/tacg/types'
import { useI18nStore, useT } from '@/lib/tacg/i18n'
import { cn } from '@/lib/utils'
import { useTacgStore } from '@/store/tacg-store'

const COLLAPSE_KEY = 'tacg-log-collapsed'

// ─── Свернутое состояние: внешнее хранилище localStorage + подписка ───
// (как theme.ts: SSR-снимок false — согласовано с серверным HTML, после
// гидратации синхронизируется с localStorage без setState-в-эффекте)
const listeners = new Set<() => void>()

const readCollapsed = (): boolean => {
  if (typeof document === 'undefined') return false
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

const notifyCollapsed = () => listeners.forEach((l) => l())

function subscribeCollapsed(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const KIND_STYLES: Record<LogEntry['kind'], string> = {
  // CR-009: решения (развилки) — amber в обеих темах; остальные акценты — 600/300
  plan: 'text-zinc-500 dark:text-zinc-400',
  'node-start': 'text-cyan-600 dark:text-cyan-300',
  'node-done': 'text-emerald-600 dark:text-emerald-300',
  'node-error': 'text-red-600 dark:text-red-300',
  adapt: 'text-violet-600 dark:text-violet-300',
  control: 'text-amber-600 dark:text-amber-300',
  intervention: 'text-amber-600 dark:text-amber-300',
  decision: 'text-amber-500 dark:text-amber-400',
  run: 'text-zinc-700 dark:text-zinc-300',
  info: 'text-zinc-500 dark:text-zinc-500',
  limits: 'text-orange-600 dark:text-orange-300',
}

const KIND_LABELS: Record<LogEntry['kind'], string> = {
  plan: 'log.plan',
  'node-start': 'log.step',
  'node-done': 'log.step',
  'node-error': 'log.error',
  adapt: 'log.adaptation',
  control: 'log.control',
  intervention: 'log.intervention',
  decision: 'log.decision',
  run: 'log.run',
  info: 'log.info',
  limits: 'log.limit',
}

export function EventLog() {
  const cursor = useTacgStore((s) => s.cursor)
  const events = useTacgStore((s) => s.events)
  const logsRef = useRef<HTMLDivElement>(null)
  const isLive = cursor === null
  const t = useT()
  const locale = useI18nStore((s) => s.locale)

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const kindLabel = (kind: LogEntry['kind']) => t(KIND_LABELS[kind])

  // ─── Сворачивание (CR-010): выбор в localStorage, дефолт — развёрнут ───
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)
  const toggleCollapsed = () => {
    const next = !readCollapsed()
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      /* приватный режим — состояние до перезагрузки */
    }
    notifyCollapsed()
  }

  // журнал — из свёртки событий до курсора (или всех, если live)
  const logs: LogEntry[] = []
  const limit = isLive ? events.length : cursor! + 1
  for (let i = 0; i < limit; i++) {
    const ev = events[i]
    if (ev.type === 'log') logs.push(ev.entry)
  }

  useEffect(() => {
    if (isLive && logsRef.current) {
      logsRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [logs.length, isLive])

  const last = logs[logs.length - 1]

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-200/80 bg-white/60 transition-[height] duration-200 motion-reduce:transition-none dark:border-zinc-800/80 dark:bg-zinc-900/40',
        collapsed ? 'h-11' : 'h-[260px]'
      )}
    >
      {/* Вся строка заголовка — кнопка-переключатель (зона клика 44px, a11y) */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls="tacg-event-log-body"
        title={collapsed ? t('log.expandTitle') : t('log.collapseTitle')}
        className="flex h-11 w-full shrink-0 items-center gap-2 px-3.5 text-left transition-colors hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40"
      >
        <ChevronDown
          className={cn('size-3.5 shrink-0 text-zinc-400 transition-transform duration-200', collapsed && '-rotate-90')}
        />
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {t('log.title')}
        </span>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">· {isLive ? 'live' : t('log.frame', { n: cursor! + 1 })}</span>

        {/* превью последней записи в свёрнутом виде — информация не теряется */}
        {collapsed && last && (
          <span className="ml-1 hidden min-w-0 items-center gap-1.5 text-xs md:flex">
            <span className={cn('shrink-0 font-medium', KIND_STYLES[last.kind])}>[{kindLabel(last.kind)}]</span>
            <span className="truncate text-zinc-500 dark:text-zinc-400" title={last.message}>
              {last.message}
            </span>
          </span>
        )}

        <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{logs.length}</span>
      </button>

      {/* Тело журнала: остаётся в DOM (плавная анимация высоты контейнера),
          при сворачивании — нулевая высота + aria-hidden */}
      <ScrollArea
        id="tacg-event-log-body"
        aria-hidden={collapsed}
        className="mt-1.5 h-0 flex-1 rounded-md border bg-white/60 p-2 dark:bg-zinc-950/50"
      >
        <div className="space-y-1.5 pr-1">
          {logs.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">{t('log.empty')}</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className="shrink-0 tabular-nums text-zinc-400 dark:text-zinc-600">{fmtTime(l.ts)}</span>
              <span className={cn('shrink-0 font-medium', KIND_STYLES[l.kind])}>[{kindLabel(l.kind)}]</span>
              <span className="min-w-0 break-words text-zinc-700 dark:text-zinc-300">{l.message}</span>
            </div>
          ))}
          <div ref={logsRef} />
        </div>
      </ScrollArea>
    </div>
  )
}
