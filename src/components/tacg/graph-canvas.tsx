// TACG — интерактивный SVG-граф вычислений агента
'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, PenLine, Plus, ZoomIn, ZoomOut, Maximize, Network } from 'lucide-react'
import { GraphNode } from '@/lib/tacg/types'
import { computeEdges } from '@/lib/tacg/fold'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const NODE_W = 232
const NODE_H = 78
const GAP_X = 64
const GAP_Y = 30

interface Point {
  x: number
  y: number
}

function computeLayout(nodes: GraphNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const depthCache = new Map<string, number>()
  const depth = (id: string, guard: Set<string>): number => {
    if (depthCache.has(id)) return depthCache.get(id)!
    if (guard.has(id)) return 0
    guard.add(id)
    const n = byId.get(id)
    const d = !n || n.dependsOn.length === 0 ? 0 : Math.max(...n.dependsOn.map((x) => depth(x, guard))) + 1
    depthCache.set(id, d)
    return d
  }
  nodes.forEach((n) => depth(n.id, new Set()))

  const columns = new Map<number, GraphNode[]>()
  for (const n of nodes) {
    const d = depthCache.get(n.id) ?? 0
    if (!columns.has(d)) columns.set(d, [])
    columns.get(d)!.push(n)
  }
  const maxColSize = Math.max(...[...columns.values()].map((c) => c.length), 1)
  const contentH = maxColSize * (NODE_H + GAP_Y) - GAP_Y
  const maxDepth = Math.max(...[...columns.keys()], 0)
  const contentW = (maxDepth + 1) * (NODE_W + GAP_X) - GAP_X

  const pos = new Map<string, Point>()
  for (const [d, col] of columns) {
    const colH = col.length * (NODE_H + GAP_Y) - GAP_Y
    const offsetY = (contentH - colH) / 2
    col.forEach((n, i) => pos.set(n.id, { x: 24 + d * (NODE_W + GAP_X), y: 24 + offsetY + i * (NODE_H + GAP_Y) }))
  }
  return { pos, width: contentW + 48, height: contentH + 48 }
}

const CARD_STYLES: Record<GraphNode['status'], string> = {
  pending: 'fill-zinc-800/70 stroke-amber-400/50',
  running: 'fill-zinc-800 stroke-cyan-400',
  done: 'fill-zinc-800/80 stroke-emerald-500/70',
  error: 'fill-zinc-800 stroke-red-500',
  skipped: 'fill-zinc-800/40 stroke-zinc-600/60',
}

const BAR_STYLES: Record<GraphNode['status'], string> = {
  pending: 'fill-amber-400/70',
  running: 'fill-cyan-400',
  done: 'fill-emerald-400',
  error: 'fill-red-500',
  skipped: 'fill-zinc-600',
}

function edgeClasses(from: GraphNode, to: GraphNode): string {
  if (to.status === 'running') return 'stroke-cyan-400/80 edge-flow'
  if (to.dynamic && from.status !== 'done') return 'stroke-violet-400/60'
  if (from.status === 'done') return 'stroke-emerald-500/55'
  return 'stroke-zinc-600/60'
}

function edgeMarker(from: GraphNode, to: GraphNode): string {
  if (to.status === 'running') return 'url(#arrow-cyan)'
  if (to.dynamic && from.status !== 'done') return 'url(#arrow-violet)'
  if (from.status === 'done') return 'url(#arrow-emerald)'
  return 'url(#arrow-zinc)'
}

export interface GraphCanvasProps {
  nodes: GraphNode[]
  selectedNodeId: string | null
  onSelect: (id: string) => void
}

export function GraphCanvas({ nodes, selectedNodeId, onSelect }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [transform, setTransform] = useState<{ x: number; y: number; k: number }>({ x: 0, y: 0, k: 1 })
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; originX: number; originY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  })
  const userAdjusted = useRef(false)

  const edges = useMemo(() => computeEdges(nodes), [nodes])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const layout = useMemo(() => computeLayout(nodes), [nodes])

  const fit = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width || !layout.width) return
    const k = Math.min((rect.width - 32) / layout.width, (rect.height - 32) / layout.height, 1.1)
    const kk = Math.max(k, 0.25)
    setTransform({
      x: (rect.width - layout.width * kk) / 2,
      y: (rect.height - layout.height * kk) / 2,
      k: kk,
    })
    userAdjusted.current = false
  }, [layout.width, layout.height])

  // авто-вписывание при изменении формы графа (пока пользователь не трогал канву)
  useEffect(() => {
    if (!userAdjusted.current) fit()
  }, [fit, nodes.length, layout.height])

  useEffect(() => {
    const onResize = () => {
      if (!userAdjusted.current) fit()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fit])

  // зум колесом (non-passive)
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userAdjusted.current = true
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setTransform((t) => {
        const factor = e.deltaY < 0 ? 1.12 : 0.89
        const k = Math.min(2.5, Math.max(0.2, t.k * factor))
        return {
          k,
          x: mx - ((mx - t.x) * k) / t.k,
          y: my - ((my - t.y) * k) / t.k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { active: true, startX: e.clientX, startY: e.clientY, originX: transform.x, originY: transform.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return
    userAdjusted.current = true
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setTransform((t) => ({ ...t, x: dragRef.current.originX + dx, y: dragRef.current.originY + dy }))
  }
  const onPointerUp = () => {
    dragRef.current.active = false
  }

  const zoomBy = (factor: number) => {
    userAdjusted.current = true
    const el = svgRef.current
    const rect = el?.getBoundingClientRect()
    const cx = (rect?.width ?? 400) / 2
    const cy = (rect?.height ?? 300) / 2
    setTransform((t) => {
      const k = Math.min(2.5, Math.max(0.2, t.k * factor))
      return { k, x: cx - ((cx - t.x) * k) / t.k, y: cy - ((cy - t.y) * k) / t.k }
    })
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border bg-zinc-950/60 bg-[radial-gradient(circle_at_30%_20%,rgba(63,63,70,0.25),transparent_60%)]">
      {nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed">
            <Network className="size-7" />
          </div>
          <p className="max-w-xs text-center text-sm">
            Граф появится здесь: задайте задачу агенту и нажмите «Запустить агента»
          </p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          role="img"
          aria-label="Граф выполнения агента"
        >
          <defs>
            <marker id="arrow-zinc" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-zinc-600" />
            </marker>
            <marker id="arrow-emerald" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-emerald-500/70" />
            </marker>
            <marker id="arrow-cyan" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-cyan-400" />
            </marker>
            <marker id="arrow-violet" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-violet-400/70" />
            </marker>
          </defs>
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {edges.map((e) => {
              const p1 = layout.pos.get(e.from)
              const p2 = layout.pos.get(e.to)
              const from = byId.get(e.from)
              const to = byId.get(e.to)
              if (!p1 || !p2 || !from || !to) return null
              const x1 = p1.x + NODE_W
              const y1 = p1.y + NODE_H / 2
              const x2 = p2.x
              const y2 = p2.y + NODE_H / 2
              const dx = Math.max(44, (x2 - x1) / 2)
              const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2 - 1} ${y2}`
              return (
                <path
                  key={e.id}
                  d={d}
                  fill="none"
                  strokeWidth={1.75}
                  markerEnd={edgeMarker(from, to)}
                  className={edgeClasses(from, to)}
                />
              )
            })}
            {nodes.map((n) => {
              const p = layout.pos.get(n.id)!
              const isSel = n.id === selectedNodeId
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(n.id)
                  }}
                >
                  {n.status === 'running' && (
                    <rect
                      x={-5}
                      y={-5}
                      width={NODE_W + 10}
                      height={NODE_H + 10}
                      rx={15}
                      className="fill-cyan-500/10 stroke-cyan-400/50 node-pulse"
                    />
                  )}
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={12}
                    strokeWidth={n.dynamic ? 1.75 : 1.5}
                    strokeDasharray={n.dynamic ? '7 4' : undefined}
                    className={cn(CARD_STYLES[n.status], 'transition-all')}
                  />
                  <rect x={0} y={10} width={4} height={NODE_H - 20} rx={2} className={BAR_STYLES[n.status]} />
                  {isSel && (
                    <rect x={-2} y={-2} width={NODE_W + 4} height={NODE_H + 4} rx={13} fill="none" strokeWidth={2} className="stroke-zinc-300/80" />
                  )}
                  <foreignObject x={14} y={8} width={NODE_W - 28} height={NODE_H - 16}>
                    <div className="pointer-events-none flex h-full flex-col justify-between">
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="line-clamp-2 text-[13px] font-medium leading-tight text-zinc-100">{n.title}</div>
                        {n.dynamic && (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                            <Plus className="size-2.5" />
                            v{n.addedAtVersion}
                          </span>
                        )}
                        {n.overridden && !n.dynamic && (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            <PenLine className="size-2.5" />
                            изм.
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                        {n.status === 'running' ? (
                          <span className="flex items-center gap-1 text-cyan-300">
                            <Loader2 className="size-3 animate-spin" />
                            выполнение…
                          </span>
                        ) : (
                          <>
                            <span
                              className={cn(
                                'size-1.5 rounded-full',
                                {
                                  pending: 'bg-amber-400/90',
                                  running: 'bg-cyan-400',
                                  done: 'bg-emerald-400',
                                  error: 'bg-red-500',
                                  skipped: 'bg-zinc-600',
                                }[n.status]
                              )}
                            />
                            <span>
                              {n.status === 'done' && n.durationMs
                                ? `${(n.durationMs / 1000).toFixed(1)} с`
                                : {
                                    pending: 'ожидает',
                                    done: 'готово',
                                    error: 'ошибка',
                                    skipped: 'пропущен',
                                    running: 'выполняется',
                                  }[n.status]}
                            </span>
                            {(n.runs ?? 0) > 1 && <span className="text-amber-400/80">·×{n.runs}</span>}
                          </>
                        )}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              )
            })}
          </g>
        </svg>
      )}
      {nodes.length > 0 && (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <Button variant="secondary" size="icon" className="size-8" onClick={() => zoomBy(1.2)} aria-label="Приблизить">
            <ZoomIn className="size-4" />
          </Button>
          <Button variant="secondary" size="icon" className="size-8" onClick={() => zoomBy(0.83)} aria-label="Отдалить">
            <ZoomOut className="size-4" />
          </Button>
          <Button variant="secondary" size="icon" className="size-8" onClick={fit} aria-label="Вписать в экран">
            <Maximize className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
