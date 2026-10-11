// TACG — санитайзер плана LLM как чистая функция (ADR-013): нормализация плана
// вынесена из engine.sanitizePlan без изменения семантики; каждое структурное
// усечение (тихая потеря раньше) возвращается заметкой SanitizeNote для журнала
// аудита запуска (kind «limits»). Заметки детерминированы: сообщения не зависят
// от Date/random — идентификаторы берутся из LLM-вывода, формулы фиксированы.
import { DecisionDomain, DecisionOption, GraphNode } from './types'

/** Заметка аудита усечения: код + готовое русское сообщение для журнала запуска */
export interface SanitizeNote {
  code: string
  message: string
}

/** Результат санитайза плана: узлы (null — план неразборчив), certainty, аудит усечений */
export interface SanitizedPlan {
  nodes: GraphNode[] | null
  /** Стартовая самооценка «понимания задачи» от планировщика (кламп 0..1) */
  certainty?: number
  /** Каждое применённое усечение — отдельная заметка (ADR-013) */
  notes: SanitizeNote[]
}

const DECISION_DOMAINS: DecisionDomain[] = ['scope', 'specialization', 'product', 'architecture', 'tone', 'format', 'context', 'strategy']

/** Структурные лимиты плана (ADR-011: защита от разбухания LLM-вывода; ADR-013: усечения логируются) */
export const PLAN_LIMITS = {
  maxNodes: 12,
  maxDeps: 5,
  maxOptions: 4,
  maxBranchSteps: 3,
} as const

/**
 * Нормализация плана LLM: цепочки + узел-развилка с ветками вариантов + certainty.
 * Семантика 1:1 с прежним engine.sanitizePlan; добавлен возврат notes[]
 * (аудит усечений ADR-013): узлы >12, неизвестные dependsOn, зависимости >5
 * после дедупа, варианты развилки >4, шаги ветки >3, деградация «развилки»
 * с <2 валидных вариантов в обычный шаг.
 */
export function sanitizePlanData(json: any): SanitizedPlan {
  const notes: SanitizeNote[] = []

  // стартовая самооценка «понимания задачи» от планировщика
  const c = Number(json?.certainty)
  const certainty = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : undefined

  const allNodes: any[] = Array.isArray(json?.nodes) ? json.nodes : []
  if (allNodes.length === 0) return { nodes: null, certainty, notes }

  // (a) усечение плана: LLM вернул больше 12 узлов — берём первые 12,
  // отброшенные перечисляются с id и заголовком
  if (allNodes.length > PLAN_LIMITS.maxNodes) {
    const dropped = allNodes
      .slice(PLAN_LIMITS.maxNodes)
      .map((raw: any) => {
        const id = String(raw?.id ?? '').trim() || '—'
        const title = String(raw?.title ?? '').trim() || '—'
        return `${id} «${title}»`
      })
    notes.push({
      code: 'plan-nodes',
      message: `Лимит плана: LLM вернул ${allNodes.length} узлов — взяты первые ${PLAN_LIMITS.maxNodes} (отброшены: ${dropped.join(', ')})`,
    })
  }
  const rawNodes = allNodes.slice(0, PLAN_LIMITS.maxNodes)

  const used = new Set<string>()
  const cleanId = (v: any, fallback: string): string => {
    let s = String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
    if (!s) s = fallback
    while (used.has(s)) s = (s.slice(0, 9) || 'n') + 'x' + Math.floor(Math.random() * 900 + 100)
    used.add(s)
    return s
  }

  const declared = new Set<string>()
  const cleanDeps = (nodeId: string, raw: any, exclude: Set<string>): string[] => {
    const arr: any[] = Array.isArray(raw?.dependsOn) ? raw.dependsOn : []
    const normalized = arr
      .map((d: any) => String(d ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    // (b) ссылки на необъявленные узлы (в т.ч. вперёд и несуществующие id) — отбрасываются
    const unknown = [...new Set(normalized.filter((d) => d && !declared.has(d)))]
    if (unknown.length) {
      notes.push({
        code: 'deps-unknown',
        message: `Лимит плана: у узла ${nodeId} отброшены ссылки на необъявленные узлы: ${unknown.join(', ')}`,
      })
    }
    const deps = [...new Set(normalized.filter((d) => d && declared.has(d) && !exclude.has(d)))]
    // (c) зависимостей после дедупа больше 5 — оставляются первые 5
    if (deps.length > PLAN_LIMITS.maxDeps) {
      notes.push({
        code: 'deps-cap',
        message: `Лимит плана: у узла ${nodeId} зависимостей ${deps.length} — оставлены первые ${PLAN_LIMITS.maxDeps} (отброшены: ${deps.slice(PLAN_LIMITS.maxDeps).join(', ')})`,
      })
    }
    return deps.slice(0, PLAN_LIMITS.maxDeps)
  }

  const nodes: GraphNode[] = []
  rawNodes.forEach((raw: any, i: number) => {
    const id = cleanId(raw?.id, `n${i + 1}`)
    const decisionRaw = raw?.decision
    const optionsAll: any[] = Array.isArray(decisionRaw?.options) ? decisionRaw.options : []
    const optionsTruthy = optionsAll.filter((o: any) => o)
    const invalidDropped = optionsAll.length - optionsTruthy.length
    const optionsRaw = optionsTruthy.slice(0, PLAN_LIMITS.maxOptions)
    const hasDecision = optionsRaw.length >= 2 && !!decisionRaw?.question

    if (hasDecision) {
      // (d) вариантов развилки больше 4 — оставляются первые 4
      if (optionsTruthy.length > PLAN_LIMITS.maxOptions) {
        notes.push({
          code: 'options-cap',
          message: `Лимит плана: у развилки ${id} вариантов ${optionsTruthy.length} — оставлены первые ${PLAN_LIMITS.maxOptions}`,
        })
      }
      const branchIds = new Set<string>()
      const selection: 'single' | 'mixed' = decisionRaw?.selection === 'mixed' ? 'mixed' : 'single'
      const domain: DecisionDomain | undefined = DECISION_DOMAINS.includes(decisionRaw?.domain)
        ? decisionRaw.domain
        : undefined
      const certaintyAfter = Number(decisionRaw?.certaintyAfter)
      const options: DecisionOption[] = []
      optionsRaw.forEach((ro: any, j: number) => {
        const optId = ['a', 'b', 'c', 'd'][j]
        const stepsAll: any[] = Array.isArray(ro?.steps) ? ro.steps.filter((s: any) => s) : []
        // (e) шагов в ветке больше 3 — оставляются первые 3
        if (stepsAll.length > PLAN_LIMITS.maxBranchSteps) {
          notes.push({
            code: 'branch-steps',
            message: `Лимит плана: у ветки ${optId} развилки ${id} шагов ${stepsAll.length} — оставлены первые ${PLAN_LIMITS.maxBranchSteps}`,
          })
        }
        const stepsRaw = stepsAll.slice(0, PLAN_LIMITS.maxBranchSteps)
        options.push({
          id: optId,
          label: String(ro?.label || `Вариант ${optId}`).slice(0, 60),
          rationale: String(ro?.rationale || ''),
          nextSteps: stepsRaw.map((s: any) => String(s?.title || 'шаг ветки').slice(0, 60)),
        })
        // шаги ветки: цепочка от развилки
        let prev = id
        stepsRaw.forEach((rs: any, k: number) => {
          const bid = cleanId(rs?.id, `${id}${optId}${k + 1}`)
          branchIds.add(bid)
          declared.add(bid)
          nodes.push({
            id: bid,
            title: String(rs?.title || `Шаг ветки ${optId}${k + 1}`).slice(0, 60),
            description: String(rs?.description || ''),
            status: 'pending',
            dependsOn: [prev],
            dynamic: false,
            runs: 0,
            branchOf: { decisionId: id, optionId: optId },
          })
          prev = bid
        })
      })
      declared.add(id)
      nodes.push({
        id,
        kind: 'decision',
        title: String(raw?.title || 'Решение').slice(0, 60),
        description: String(raw?.description || ''),
        status: 'pending',
        dependsOn: cleanDeps(id, raw, branchIds),
        dynamic: false,
        runs: 0,
        decision: {
          question: String(decisionRaw.question),
          domain,
          selection,
          certaintyAfter: Number.isFinite(certaintyAfter) ? Math.min(1, Math.max(0, certaintyAfter)) : undefined,
          options,
          status: 'pending',
        },
      })
    } else {
      // (f) узел заявлен как decision, но развилка не состоялась —
      // деградация в обычный шаг (валидных вариантов < 2 или нет вопроса)
      if (decisionRaw) {
        if (optionsRaw.length < 2) {
          const empties = invalidDropped > 0 ? ` (пустых/битых вариантов: ${invalidDropped})` : ''
          notes.push({
            code: 'decision-degraded',
            message: `Лимит плана: у узла ${id} меньше 2 валидных вариантов${empties} — развилка деградировала в обычный шаг`,
          })
        } else {
          notes.push({
            code: 'decision-degraded',
            message: `Лимит плана: у узла ${id} развилка без вопроса — деградировала в обычный шаг`,
          })
        }
      }
      declared.add(id)
      nodes.push({
        id,
        title: String(raw?.title || `Шаг ${i + 1}`).slice(0, 60),
        description: String(raw?.description || ''),
        status: 'pending',
        dependsOn: cleanDeps(id, raw, new Set()),
        dynamic: false,
        runs: 0,
      })
    }
  })
  if (nodes.length < 2) return { nodes: null, certainty, notes }
  return { nodes, certainty, notes }
}
