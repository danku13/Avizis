// TACG — граф вычислений агента на React Flow (@xyflow/react v12)
'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, Network, PenLine, Plus } from 'lucide-react'
import { GraphNode } from '@/lib/tacg/types'
import { computeEdges } from '@/lib/tacg/fold'
import { cn } from '@/lib/utils'

const NODE_W = 248
const NODE_H = 84
const GAP_X = 56
const GAP_Y = 26

type TacgFlowNode = Node<GraphNode, 'tacg'>

const CARD_STYLES: Record<GraphNode['status'], string> = {
  pending: 'border-amber-400/50 bg-zinc-900/80',
  running: 'border-cyan-400 bg-zinc-900',
  done: 'border-emerald-500/70 bg-zinc-900/80',
  error: 'border-red-500 bg-zinc-900',
  skipped: 'border-zinc-600/60 bg-zinc-900/50',
}

const BAR_STYLES: Record<GraphNode['status'], string> = {
  pending: 'bg-amber-400/70',
  running: 'bg-cyan-400',
  done: 'bg-emerald-400',
  error: 'bg-red-500',
  skipped: 'bg-zinc-600',
}

const MINIMAP_NODE_COLORS: Record<GraphNode['status'], string> = {
  pending: '#fbbf24',
  running: '#22d3ee',
  done: '#34d399',
  error: '#ef4444',
  skipped: '#52525b',
}

/** Слоевой layout: колонка = глубина зависимости, узлы центрируются по вертикали */
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

  const pos = new Map<string, { x: number; y: number }>()
  for (const [d, col] of columns) {
    const colH = col.length * (NODE_H + GAP_Y) - GAP_Y
    const offsetY = (contentH - colH) / 2
    col.forEach((n, i) => pos.set(n.id, { x: d * (NODE_W + GAP_X), y: offsetY + i * (NODE_H + GAP_Y) }))
  }
  // сигнатура формы графа: меняется при добавлении/удалении узлов и колонок
  const sig = `${nodes.length}:${columns.size}:${maxColSize}`
  return { pos, sig }
}

/** ─── Кастомный узел React Flow ─── */
function TacgNodeCard({ data: n, selected }: NodeProps<TacgFlowNode>) {
  return (
    <div
      className={cn(
        'relative w-[248px] rounded-xl border pl-4 pr-3.5 shadow-md backdrop-blur-sm transition-all',
        CARD_STYLES[n.status],
        n.dynamic && 'border-dashed',
        selected && 'ring-2 ring-zinc-300/70 ring-offset-2 ring-offset-zinc-950',
      )}
    >
      {n.status === 'running' && (
        <div className="node-pulse pointer-events-none absolute -inset-1.5 rounded-2xl border border-cyan-400/50 bg-cyan-500/10" />
      )}

      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!size-1.5 !border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="!size-1.5 !border-0 !bg-transparent !opacity-0"
      />

      <div className="flex h-[84px] flex-col justify-between py-3">
        <div className="flex items-start justify-between gap-1.5">
          <div className="line-clamp-2 text-[13px] font-medium leading-tight text-zinc-100">{n.title}</div>
          <div className="flex shrink-0 gap-1">
            {n.dynamic && (
              <span className="flex items-center gap-0.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                <Plus className="size-2.5" />
                v{n.addedAtVersion}
              </span>
            )}
            {n.overridden && !n.dynamic && (
              <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                <PenLine className="size-2.5" />
                изм.
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          {n.status === 'running' ? (
            <span className="flex items-center gap-1 text-cyan-300">
              <Loader2 className="size-3 animate-spin" />
              выполнение…
            </span>
          ) : (
            <>
              <span className={cn('size-1.5 rounded-full', BAR_STYLES[n.status])} />
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

      {/* цветовая полоска статуса слева */}
      <span className={cn('absolute bottom-2.5 left-1.5 top-2.5 w-1 rounded-full', BAR_STYLES[n.status])} />
    </div>
  )
}

const nodeTypes: NodeTypes = { tacg: TacgNodeCard }

/** ─── Слой поверх React Flow: синхронизация узлов/рёбер + fitView ─── */
function FlowStage({
  nodes,
  selectedNodeId,
  onSelect,
}: {
  nodes: GraphNode[]
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}) {
  const rf = useReactFlow()
  const lastSig = useRef<string | null>(null)
  const fitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const layout = useMemo(() => computeLayout(nodes), [nodes])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const rfNodes = useMemo<TacgFlowNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: 'tacg' as const,
        position: layout.pos.get(n.id) ?? { x: 0, y: 0 },
        data: n,
        selected: n.id === selectedNodeId,
        width: NODE_W,
        height: NODE_H,
        style: { width: NODE_W, height: NODE_H },
      })),
    [nodes, layout, selectedNodeId],
  )

  const rfEdges = useMemo<Edge[]>(() => {
    return computeEdges(nodes)
      .map((e) => {
        const from = byId.get(e.from)
        const to = byId.get(e.to)
        if (!from || !to) return null
        let stroke = 'rgba(82,82,91,0.75)'
        let animated = false
        if (to.status === 'running') {
          stroke = '#22d3ee'
          animated = true
        } else if (to.dynamic && from.status !== 'done') {
          stroke = 'rgba(167,139,250,0.7)'
        } else if (from.status === 'done') {
          stroke = 'rgba(52,211,153,0.6)'
        }
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'smoothstep',
          animated,
          style: { stroke, strokeWidth: 1.75 },
          pathOptions: { borderRadius: 18 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
        } satisfies Edge
      })
      .filter((e): e is Edge => e !== null)
  }, [nodes, byId])

  // авто-вписывание при изменении формы графа (новые узлы/колонки)
  useEffect(() => {
    if (nodes.length === 0) {
      lastSig.current = null
      return
    }
    if (layout.sig === lastSig.current) return
    lastSig.current = layout.sig
    if (fitTimer.current) clearTimeout(fitTimer.current)
    fitTimer.current = setTimeout(() => {
      rf.fitView({ padding: 0.12, maxZoom: 1.05, minZoom: 0.25, duration: 350 })
    }, 60)
    return () => {
      if (fitTimer.current) clearTimeout(fitTimer.current)
    }
  }, [layout.sig, nodes.length, rf])

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1.05, minZoom: 0.25 }}
      minZoom={0.15}
      maxZoom={2.5}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      zoomOnDoubleClick={false}
      selectionOnDrag={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      className="bg-transparent"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1.4}
        color="rgba(82,82,91,0.55)"
        className="bg-[radial-gradient(circle_at_30%_20%,rgba(63,63,70,0.22),transparent_60%)]"
      />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        className="hidden md:block"
        bgColor="#101013"
        maskColor="rgba(9,9,11,0.72)"
        nodeColor={(n) => MINIMAP_NODE_COLORS[(n as TacgFlowNode).data?.status ?? 'pending'] ?? '#52525b'}
        nodeStrokeColor="#3f3f46"
        nodeStrokeWidth={2}
        nodeBorderRadius={6}
        style={{ bottom: 34, right: 12, border: '1px solid rgba(63,63,70,0.9)', borderRadius: 10 }}
        pannable
        zoomable
      />
    </ReactFlow>
  )
}

export interface GraphCanvasProps {
  nodes: GraphNode[]
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
}

export function GraphCanvas({ nodes, selectedNodeId, onSelect }: GraphCanvasProps) {
  return (
    /* absolute inset-0: надёжнее h-full — проценты не резолвятся
       в flex-item, чья высота задана только min-height (мобильная раскладка) */
    <div className="absolute inset-0 overflow-hidden rounded-lg border bg-zinc-950/60">
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
        <ReactFlowProvider>
          <FlowStage nodes={nodes} selectedNodeId={selectedNodeId} onSelect={onSelect} />
        </ReactFlowProvider>
      )}
    </div>
  )
}
