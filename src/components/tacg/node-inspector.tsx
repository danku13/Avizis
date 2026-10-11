// TACG — инспектор узла: детали, вход/выход, вмешательство пользователя
'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PenLine, RotateCcw, Copy, MousePointerClick, Sparkles, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { NodeStatusBadge } from './status-badge'
import { GraphNode } from '@/lib/tacg/types'
import { getSocket } from '@/lib/tacg/socket'
import { useTacgStore } from '@/store/tacg-store'
import { toast } from 'sonner'

export function NodeInspector() {
  const selectedNodeId = useTacgStore((s) => s.selectedNodeId)
  const cursor = useTacgStore((s) => s.cursor)
  const events = useTacgStore((s) => s.events)
  const currentRunId = useTacgStore((s) => s.currentRunId)

  const node = useMemo<GraphNode | null>(() => {
    if (!selectedNodeId) return null
    if (cursor !== null) {
      // находим последнее состояние узла до позиции воспроизведения
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
          if (n) found = n
          else found = null
        }
      }
      return found
    }
    // live: последнее состояние
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev.type === 'node:update' && ev.node.id === selectedNodeId) return ev.node
      if ((ev.type === 'graph:adapt' || ev.type === 'graph:init') && ev.nodes.some((x) => x.id === selectedNodeId)) {
        return ev.nodes.find((x) => x.id === selectedNodeId) ?? null
      }
    }
    return null
  }, [selectedNodeId, cursor, events])

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditing(false)
  }, [selectedNodeId, node?.status])

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <MousePointerClick className="size-8" />
        <p className="max-w-[240px] text-center text-sm">
          Выберите узел на графе, чтобы увидеть его детали, вход/выход и инструменты вмешательства
        </p>
      </div>
    )
  }

  const isPlayback = cursor !== null
  const deps = node.dependsOn

  const startEdit = () => {
    setDraft(node.output ?? '')
    setEditing(true)
  }

  const saveOverride = () => {
    if (!currentRunId || !draft.trim()) return
    getSocket().emit('node:override', { runId: currentRunId, nodeId: node.id, output: draft })
    setEditing(false)
    toast.success('Результат узла переопределён — потомки будут пересчитаны')
  }

  const retry = () => {
    if (!currentRunId) return
    getSocket().emit('node:retry', { runId: currentRunId, nodeId: node.id })
    toast.info('Узел поставлен в очередь на повторное выполнение')
  }

  const copy = (text?: string) => {
    if (text) navigator.clipboard?.writeText(text).then(() => toast.success('Скопировано в буфер'))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight">{node.title}</h3>
        <NodeStatusBadge status={node.status} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {node.dynamic && (
          <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-300">
            <Sparkles className="mr-1 size-3" />
            добавлен динамически · v{node.addedAtVersion}
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
      </div>

      {node.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{node.description}</p>}

      {node.reason && (
        <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-xs leading-relaxed text-violet-200">
          <span className="font-semibold">Причина добавления: </span>
          {node.reason}
        </div>
      )}

      {node.error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{node.error}</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Clock3 className="size-3.5" />
          {node.status === 'done' && node.durationMs
            ? `${(node.durationMs / 1000).toFixed(1)} с`
            : node.status === 'running' && node.startedAt
              ? `${((Date.now() - node.startedAt) / 1000).toFixed(1)} с…`
              : '—'}
        </div>
        <div>Зависимостей: {deps.length}</div>
      </div>

      {deps.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          Входы: {deps.join(', ')}
        </div>
      )}

      <Separator className="my-4" />

      <ScrollArea className="h-0 flex-1 pr-2">
        <div className="space-y-4 pb-2">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Вход</h4>
              {node.input && (
                <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.input)} aria-label="Копировать вход">
                  <Copy className="size-3" />
                </Button>
              )}
            </div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-zinc-900/70 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
              {node.input ?? node.status === 'pending' ? (node.input ?? '— (узел ещё не стартовал)') : '—'}
            </pre>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Выход</h4>
              {!editing && node.output && (
                <Button variant="ghost" size="icon" className="size-6" onClick={() => copy(node.output)} aria-label="Копировать выход">
                  <Copy className="size-3" />
                </Button>
              )}
            </div>
            {node.status === 'error' ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-200">
                Узел завершился ошибкой. См. сообщение выше.
              </div>
            ) : node.status === 'running' ? (
              <div className="animate-pulse rounded-md border bg-zinc-900/70 p-2.5 font-mono text-[11px] text-zinc-500">
                узел выполняется, результат появится здесь…
              </div>
            ) : editing ? (
              <div className="space-y-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-[120px] font-mono text-[11px]"
                  placeholder="Новый результат узла…"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveOverride} disabled={!draft.trim()}>
                    <PenLine className="mr-1 size-3.5" />
                    Сохранить и пересчитать
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Отмена
                  </Button>
                </div>
              </div>
            ) : node.status === 'done' ? (
              <pre className="whitespace-pre-wrap break-words rounded-md border bg-zinc-900/70 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-300">
                {node.output}
              </pre>
            ) : (
              <div className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                — (узел ещё не выполнялся)
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      <Separator className="my-3" />

      <div className="flex flex-col gap-2">
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
          <p className="text-center text-[11px] text-muted-foreground">
            Режим воспроизведения: вмешательство недоступно. Нажмите «Live» на таймлайне.
          </p>
        )}
      </div>
    </div>
  )
}
