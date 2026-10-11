// TACG — живой журнал событий запуска
'use client'

import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LogEntry } from '@/lib/tacg/types'
import { cn } from '@/lib/utils'
import { useTacgStore } from '@/store/tacg-store'

const KIND_STYLES: Record<LogEntry['kind'], string> = {
  plan: 'text-zinc-400',
  'node-start': 'text-cyan-300',
  'node-done': 'text-emerald-300',
  'node-error': 'text-red-300',
  adapt: 'text-violet-300',
  control: 'text-amber-300',
  intervention: 'text-amber-300',
  decision: 'text-fuchsia-300',
  run: 'text-zinc-300',
  info: 'text-zinc-500',
  limits: 'text-orange-300',
}

const KIND_LABELS: Record<LogEntry['kind'], string> = {
  plan: 'план',
  'node-start': 'шаг',
  'node-done': 'шаг',
  'node-error': 'ошибка',
  adapt: 'адаптация',
  control: 'управление',
  intervention: 'вмешательство',
  decision: 'решение',
  run: 'запуск',
  info: 'инфо',
  limits: 'лимит',
}

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function EventLog() {
  const cursor = useTacgStore((s) => s.cursor)
  const events = useTacgStore((s) => s.events)
  const logsRef = useRef<HTMLDivElement>(null)
  const isLive = cursor === null

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

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Журнал событий · {isLive ? 'live' : `кадр ${cursor! + 1}`}
        </h4>
        <span className="text-xs tabular-foreground text-muted-foreground">{logs.length}</span>
      </div>
      <ScrollArea className="h-0 flex-1 rounded-md border bg-zinc-950/50 p-2">
        <div className="space-y-1.5 pr-1">
          {logs.length === 0 && <p className="px-1 py-2 text-xs text-muted-foreground">События появятся во время выполнения…</p>}
          {logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className="shrink-0 tabular-nums text-zinc-600">{fmtTime(l.ts)}</span>
              <span className={cn('shrink-0 font-medium', KIND_STYLES[l.kind])}>[{KIND_LABELS[l.kind]}]</span>
              <span className="min-w-0 break-words text-zinc-300">{l.message}</span>
            </div>
          ))}
          <div ref={logsRef} />
        </div>
      </ScrollArea>
    </div>
  )
}
