// TACG — граф вычислений агента на React Flow (@xyflow/react v12)
// Поддержка развилок решений: карточка-развилка, ветки вариантов, гашение нереализованных веток
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
import { CheckCircle2, Compass, GitFork, Loader2, Network, PenLine, Plus, X } from 'lucide-react'
import { chosenIds, GraphNode, selectionMode } from '@/lib/tacg/types'
import { computeEdges } from '@/lib/tacg/fold'
import { useIsDark } from '@/lib/tacg/theme'
import { useTacgStore } from '@/store/tacg-store'
import { useT } from '@/lib/tacg/i18n'
import { cn } from '@/lib/utils'

const NODE_W = 248
const NODE_H = 84
const GAP_X = 56
const GAP_Y = 26

type TacgFlowNode = Node<GraphNode, 'tacg'>

// Палитра (CR-009): ожидание — нейтральный цинк (план-чертёж), развилки — amber
// («ваш ход»), динамические узлы — violet. Раньше развилка была fuchsia —
// соседний с violet оттенок, читался как «динамика».
const CARD_STYLES: Record<GraphNode['status'], string> = {
  pending: 'border-zinc-400 bg-white/90 dark:border-zinc-500/60 dark:bg-zinc-900/80',
  running: 'border-cyan-500 bg-white dark:border-cyan-400 dark:bg-zinc-900',
  done: 'border-emerald-500/70 bg-white/90 dark:bg-zinc-900/80',
  error: 'border-red-500 bg-white dark:bg-zinc-900',
  skipped: 'border-zinc-300 bg-zinc-100/70 dark:border-zinc-600/60 dark:bg-zinc-900/50',
  discarded: 'border-zinc-300/80 bg-zinc-100/50 dark:border-zinc-600/40 dark:bg-zinc-900/40',
}

const BAR_STYLES: Record<GraphNode['status'], string> = {
  pending: 'bg-zinc-400/80 dark:bg-zinc-400/70',
  running: 'bg-cyan-500 dark:bg-cyan-400',
  done: 'bg-emerald-500 dark:bg-emerald-400',
  error: 'bg-red-500',
  skipped: 'bg-zinc-400 dark:bg-zinc-600',
  discarded: 'bg-zinc-300 dark:bg-zinc-600/60',
}

const MINIMAP_NODE_COLORS: Record<GraphNode['status'], string> = {
  pending: '#a1a1aa',
  running: '#22d3ee',
  done: '#34d399',
  error: '#ef4444',
  skipped: '#71717a',
  discarded: '#52525b',
}

/** Цвет чипа ветки по id варианта */
const OPTION_STYLES: Record<string, string> = {
  a: 'bg-sky-500/25 text-sky-700 dark:text-sky-300',
  b: 'bg-fuchsia-500/25 text-fuchsia-700 dark:text-fuchsia-300',
  c: 'bg-orange-500/25 text-orange-700 dark:text-orange-300',
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
  const decisionMode = useTacgStore((s) => s.decisionMode)
  const t = useT()
  const isDecision = n.kind === 'decision' && !!n.decision
  const dec = isDecision ? n.decision! : undefined
  const offered = isDecision && dec?.status === 'offered' && chosenIds(dec).length === 0
  const waitingUser = offered && (decisionMode ?? 'manual') === 'manual'
  const picked = dec ? chosenIds(dec) : []
  const chosenOpts = dec ? dec.options.filter((o) => picked.includes(o.id)) : []
  const mixedSelection = selectionMode(dec) === 'mixed'

  return (
    <div
      className={cn(
        'relative w-[248px] rounded-xl border pl-4 pr-3.5 shadow-md backdrop-blur-sm transition-all',
        // развилка в ожидании — amber (CR-009): «ваш ход», максимум контраста с violet-динамикой
        isDecision && offered
          ? 'border-amber-500 bg-white dark:border-amber-400 dark:bg-zinc-900'
          : CARD_STYLES[n.status],
        n.dynamic && !isDecision && 'border-dashed',
        n.status === 'discarded' && 'opacity-55',
        selected && 'ring-2 ring-zinc-400/70 ring-offset-2 ring-offset-white dark:ring-zinc-300/70 dark:ring-offset-zinc-950',
        waitingUser && 'cursor-pointer hover:border-amber-400 dark:hover:border-amber-300',
      )}
    >
      {(n.status === 'running' || offered) && (
        <div
          className={cn(
            'node-pulse pointer-events-none absolute -inset-1.5 rounded-2xl border',
            offered ? 'border-amber-400/60 bg-amber-500/10' : 'border-cyan-400/50 bg-cyan-500/10'
          )}
        />
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
          <div className="flex min-w-0 items-start gap-1.5">
            {isDecision && <GitFork className={cn('mt-0.5 size-3.5 shrink-0', offered ? 'text-amber-500 dark:text-amber-300' : 'text-amber-600/80 dark:text-amber-400/80')} />}
            <div className="line-clamp-2 text-[13px] font-medium leading-tight text-zinc-900 dark:text-zinc-100">{n.title}</div>
          </div>
          <div className="flex shrink-0 gap-1">
            {n.branchOf && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                  OPTION_STYLES[n.branchOf.optionId] ?? 'bg-zinc-500/20 text-zinc-600 dark:text-zinc-300'
                )}
                title={t('graph.branchTitle', { option: n.branchOf.optionId, decision: n.branchOf.decisionId })}
              >
                {n.branchOf.optionId}
              </span>
            )}
            {n.dynamic && (
              <span className="flex items-center gap-0.5 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                <Plus className="size-2.5" />
                v{n.addedAtVersion}
              </span>
            )}
            {n.overridden && !n.dynamic && (
              <span className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                <PenLine className="size-2.5" />
                {t('graph.edited')}
              </span>
            )}
          </div>
        </div>

        {/* строка состояния: у развилок — свой сюжет */}
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-500">
          {isDecision ? (
            <DecisionStatusRow
              status={n.status}
              decisionStatus={dec?.status ?? 'pending'}
              waitingUser={!!waitingUser}
              chosenLabels={chosenOpts.map((o) => o.label)}
              chosenBy={dec?.chosenBy}
              optionsCount={dec?.options.length ?? 0}
              mixed={mixedSelection}
            />
          ) : n.status === 'running' ? (
            <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-300">
              <Loader2 className="size-3 animate-spin" />
              {n.streamingText
                ? t('graph.streamingChars', { n: n.streamingText.length })
                : t('graph.executing')}
            </span>
          ) : n.status === 'discarded' ? (
            <span className="flex items-center gap-1">
              <X className="size-3" />
              {t('graph.branchNotChosen')}
            </span>
          ) : (
            <>
              <span className={cn('size-1.5 rounded-full', BAR_STYLES[n.status])} />
              <span>
                {n.status === 'done' && n.durationMs
                  ? `${(n.durationMs / 1000).toFixed(1)} s`
                  : {
                      pending: t('graph.stPending'),
                      done: t('graph.stDone'),
                      error: t('graph.stError'),
                      skipped: t('graph.stSkipped'),
                      running: t('graph.stRunning'),
                      discarded: t('graph.stDiscarded'),
                    }[n.status]}
              </span>
              {(n.runs ?? 0) > 1 && <span className="text-amber-600/80 dark:text-amber-400/80">·×{n.runs}</span>}
            </>
          )}
        </div>
      </div>

      {/* цветовая полоска статуса слева */}
      <span
        className={cn(
          'absolute bottom-2.5 left-1.5 top-2.5 w-1 rounded-full',
          isDecision && offered ? 'bg-amber-500 dark:bg-amber-400' : BAR_STYLES[n.status]
        )}
      />
    </div>
  )
}

/** Нижняя строка карточки-развилки */
function DecisionStatusRow({
  status,
  decisionStatus,
  waitingUser,
  chosenLabels,
  chosenBy,
  optionsCount,
  mixed,
}: {
  status: GraphNode['status']
  decisionStatus: 'pending' | 'offered' | 'resolved'
  waitingUser: boolean
  chosenLabels: string[]
  chosenBy?: 'agent' | 'user'
  optionsCount: number
  mixed?: boolean
}) {
  const t = useT()
  if (decisionStatus === 'resolved' && chosenLabels.length) {
    const isMixed = chosenLabels.length > 1
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 className="size-3 shrink-0" />
        <span className="truncate">
          {isMixed ? t('graph.mixedPrefix', { labels: chosenLabels.join(' + ') }) : t('graph.chosenPrefix', { label: chosenLabels[0] })}
        </span>
        <span className="shrink-0 text-zinc-500">· {chosenBy === 'user' ? t('graph.byUser') : t('graph.byAgent')}</span>
      </span>
    )
  }
  if (decisionStatus === 'offered') {
    return waitingUser ? (
      <span className="flex animate-pulse items-center gap-1 text-amber-600 dark:text-amber-300">
        <GitFork className="size-3 shrink-0" />
        {mixed ? t('graph.waitsChoiceMulti') : t('graph.waitsYourChoice')}
      </span>
    ) : (
      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {t('graph.agentChoosing')}
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-300">
        <Loader2 className="size-3 animate-spin" />
        {t('graph.agentReasoning')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <GitFork className="size-3" />
      {t('graph.forkWithOptions', { n: optionsCount })}
    </span>
  )
}

const nodeTypes: NodeTypes = { tacg: TacgNodeCard }

/** ─── Слой поверх React Flow: синхронизация узлов/рёбер + fitView ─── */
function FlowStage({
  nodes,
  selectedNodeId,
  onSelect,
  waitingDecisionId,
  onOpenDecision,
}: {
  nodes: GraphNode[]
  selectedNodeId: string | null
  onSelect: (id: string | null) => void
  /** id развилки, ожидающей выбора (клик по ней открывает модалку выбора) */
  waitingDecisionId: string | null
  onOpenDecision: () => void
}) {
  const rf = useReactFlow()
  const isDark = useIsDark()
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
    [nodes, layout, selectedNodeId]
  )

  const rfEdges = useMemo<Edge[]>(() => {
    return computeEdges(nodes)
      .map((e) => {
        const from = byId.get(e.from)
        const to = byId.get(e.to)
        if (!from || !to) return null
        // базовые цвета рёбер — от темы (CR-009/светлый стиль)
        let stroke = isDark ? 'rgba(82,82,91,0.75)' : 'rgba(113,113,122,0.55)'
        let animated = false
        let dash: string | undefined

        const isBranchEdge = from.kind === 'decision' && to.branchOf?.decisionId === from.id
        const chosen = from.decision ? chosenIds(from.decision) : []
        const deadBranch =
          from.status === 'discarded' ||
          to.status === 'discarded' ||
          (isBranchEdge && chosen.length > 0 && !chosen.includes(to.branchOf?.optionId ?? ''))

        if (deadBranch) {
          // нереализованная ветка: тихое пунктирное ребро
          stroke = isDark ? 'rgba(63,63,70,0.45)' : 'rgba(161,161,170,0.45)'
          dash = '3 4'
        } else if (isBranchEdge) {
          // ветка развилки — amber (CR-009): контраст с violet-рёбрами динамики
          if (chosen) {
            stroke = from.status === 'done' ? 'rgba(52,211,153,0.65)' : 'rgba(245,158,11,0.7)'
          } else {
            stroke = 'rgba(245,158,11,0.65)'
            dash = '6 4'
          }
        } else if (to.status === 'running') {
          stroke = '#22d3ee'
          animated = true
        } else if (to.dynamic && from.status !== 'done') {
          stroke = 'rgba(167,139,250,0.75)'
        } else if (from.status === 'done') {
          stroke = 'rgba(52,211,153,0.6)'
        }
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'smoothstep',
          animated,
          style: { stroke, strokeWidth: 1.75, ...(dash ? { strokeDasharray: dash } : {}) },
          pathOptions: { borderRadius: 18 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: stroke },
        } satisfies Edge
      })
      .filter((e): e is Edge => e !== null)
  }, [nodes, byId, isDark])

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
      onNodeClick={(_, node) => {
        // клик по развилке в ожидании открывает модалку выбора, остальные узлы — инспектор
        if (node.id === waitingDecisionId) onOpenDecision()
        else onSelect(node.id)
      }}
      onPaneClick={() => onSelect(null)}
      className="bg-transparent"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1.4}
        color={isDark ? 'rgba(82,82,91,0.55)' : 'rgba(113,113,122,0.5)'}
        className="bg-[radial-gradient(circle_at_30%_20%,rgba(228,228,231,0.55),transparent_60%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(63,63,70,0.22),transparent_60%)]"
      />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        className="hidden md:block"
        bgColor={isDark ? '#101013' : '#fafafa'}
        maskColor={isDark ? 'rgba(9,9,11,0.72)' : 'rgba(255,255,255,0.75)'}
        nodeColor={(n) =>
          (n as TacgFlowNode).data?.kind === 'decision'
            ? '#f59e0b'
            : MINIMAP_NODE_COLORS[(n as TacgFlowNode).data?.status ?? 'pending'] ?? '#52525b'
        }
        nodeStrokeColor={isDark ? '#3f3f46' : '#d4d4d8'}
        nodeStrokeWidth={2}
        nodeBorderRadius={6}
        style={{ bottom: 34, right: 12, border: isDark ? '1px solid rgba(63,63,70,0.9)' : '1px solid rgba(212,212,216,0.9)', borderRadius: 10 }}
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
  waitingDecisionId?: string | null
  onOpenDecision?: () => void
  /** Прогон идёт (планирование/выполнение), узлов ещё нет — показать индикацию */
  planning?: boolean
}

export function GraphCanvas({ nodes, selectedNodeId, onSelect, waitingDecisionId, onOpenDecision, planning }: GraphCanvasProps) {
  const t = useT()
  return (
    /* absolute inset-0: надёжнее h-full — проценты не резолвятся
       в flex-item, чья высота задана только min-height (мобильная раскладка) */
    <div className="absolute inset-0 overflow-hidden rounded-lg border bg-zinc-50 dark:bg-zinc-950/60">
      {nodes.length === 0 ? (
        planning ? (
          // Живой прогон без узлов: LLM-планирование/первые вызовы — видимый
          // процесс вместо пустого полотна (долгое планирование reasoning-моделей)
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <div className="relative flex size-14 items-center justify-center rounded-2xl border border-teal-500/30 bg-teal-500/5">
              <Compass className="size-7 animate-pulse text-teal-500 dark:text-teal-400" />
              <span className="absolute -right-1.5 -top-1.5 size-3.5 animate-ping rounded-full bg-teal-400/70" />
            </div>
            <div className="max-w-sm space-y-1.5 text-center">
              <p className="text-sm font-medium text-foreground">{t('graph.agentWorking')}</p>
              <p className="text-xs leading-relaxed">{t('graph.agentWorkingHint')}</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-dashed">
              <Network className="size-7" />
            </div>
            <p className="max-w-xs text-center text-sm">{t('graph.emptyState')}</p>
          </div>
        )
      ) : (
        <ReactFlowProvider>
          <FlowStage
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            waitingDecisionId={waitingDecisionId ?? null}
            onOpenDecision={onOpenDecision ?? (() => {})}
          />
        </ReactFlowProvider>
      )}
    </div>
  )
}
