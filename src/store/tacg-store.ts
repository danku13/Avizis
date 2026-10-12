// TACG — глобальное состояние (zustand)
'use client'

import { create } from 'zustand'
import {
  DecisionMode,
  LlmConfigPublic,
  LlmProviderInfo,
  RunEvent,
  RunMeta,
  RunMode,
  RunSnapshot,
} from '@/lib/tacg/types'

export interface CurrentRunMeta {
  id: string
  task: string
  mode: RunMode
  createdAt: number
}

/** Результат последней проверки/сохранения конфигурации LLM (индикатор BYOK) */
export interface LlmStatusInfo {
  ok: boolean
  error?: string
  latencyMs?: number
}

interface TacgStore {
  connected: boolean
  runs: RunMeta[]
  currentRunId: string | null
  currentMeta: CurrentRunMeta | null
  events: RunEvent[]
  /** null = живой режим; иначе индекс события для воспроизведения */
  cursor: number | null
  playing: boolean
  selectedNodeId: string | null
  starting: boolean
  /** Актуальный режим решений live-запуска (null — до запуска) */
  decisionMode: DecisionMode | null
  /** id развилки, чью модалку пользователь закрыл вручную (до следующего предложения) */
  decisionDismissed: string | null

  /** BYOK: публичная (маскированная) конфигурация LLM с сервера */
  llmConfig: LlmConfigPublic | null
  /** BYOK: индикатор — результат последней проверки подключения / сохранения */
  llmStatus: LlmStatusInfo | null
  llmSaving: boolean
  llmTesting: boolean
  /** BYOK: модалка настроек LLM */
  settingsOpen: boolean
  /** Provenance текущего запуска: роль → адаптер/модель (из run:created/run:snapshot) */
  runLlm: Record<string, LlmProviderInfo> | null

  setConnected: (v: boolean) => void
  setRuns: (runs: RunMeta[]) => void
  onRunCreated: (meta: CurrentRunMeta, decisionMode?: DecisionMode | null, llm?: Record<string, LlmProviderInfo> | null) => void
  onRunStarted: () => void
  applyEvent: (ev: RunEvent) => void
  loadSnapshot: (run: RunSnapshot) => void
  setCursor: (i: number | null) => void
  setPlaying: (v: boolean) => void
  select: (nodeId: string | null) => void
  setStarting: (v: boolean) => void
  setDecisionMode: (mode: DecisionMode | null) => void
  dismissDecision: (nodeId: string) => void
  openDecision: () => void
  clearRun: () => void
  removeRunLocal: (runId: string) => void

  setLlmConfig: (cfg: LlmConfigPublic | null) => void
  setLlmStatus: (status: LlmStatusInfo | null) => void
  setLlmSaving: (v: boolean) => void
  setLlmTesting: (v: boolean) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useTacgStore = create<TacgStore>()((set, get) => ({
  connected: false,
  runs: [],
  currentRunId: null,
  currentMeta: null,
  events: [],
  cursor: null,
  playing: false,
  selectedNodeId: null,
  starting: false,
  decisionMode: null,
  decisionDismissed: null,
  llmConfig: null,
  llmStatus: null,
  llmSaving: false,
  llmTesting: false,
  settingsOpen: false,
  runLlm: null,

  setConnected: (v) => set({ connected: v }),

  setRuns: (runs) => set({ runs: runs ?? [] }),

  onRunCreated: (meta, decisionMode, llm) =>
    set({
      currentRunId: meta.id,
      currentMeta: meta,
      events: [],
      cursor: null,
      playing: false,
      selectedNodeId: null,
      starting: false,
      decisionMode: decisionMode ?? 'manual',
      decisionDismissed: null,
      runLlm: llm ?? null,
    }),

  onRunStarted: () => set({ starting: false }),

  applyEvent: (ev) => {
    // события приходят только для текущего запуска (фильтр в слое socket)
    set({ events: [...get().events, ev] })
    // новое предложение развилки — модалка открывается заново
    if (ev.type === 'decision:offer') set({ decisionDismissed: null })
    if (ev.type === 'decision:mode') set({ decisionMode: ev.mode })
  },

  loadSnapshot: (run) =>
    set({
      currentRunId: run.id,
      currentMeta: { id: run.id, task: run.task, mode: run.mode, createdAt: run.createdAt },
      events: run.events ?? [],
      cursor: null,
      playing: false,
      selectedNodeId: null,
      starting: false,
      decisionMode: run.decisionMode ?? null,
      decisionDismissed: null,
      runLlm: run.llm ?? null,
    }),

  setCursor: (i) => set({ cursor: i }),

  setPlaying: (v) => set({ playing: v }),

  select: (nodeId) => set({ selectedNodeId: nodeId }),

  setStarting: (v) => set({ starting: v }),

  setDecisionMode: (mode) => set({ decisionMode: mode }),

  dismissDecision: (nodeId) => set({ decisionDismissed: nodeId }),

  openDecision: () => set({ decisionDismissed: null }),

  clearRun: () =>
    set({
      currentRunId: null,
      currentMeta: null,
      events: [],
      cursor: null,
      playing: false,
      selectedNodeId: null,
      decisionMode: null,
      decisionDismissed: null,
      runLlm: null,
    }),

  removeRunLocal: (runId) => {
    const { currentRunId, runs } = get()
    set({ runs: runs.filter((r) => r.id !== runId) })
    if (currentRunId === runId) {
      get().clearRun()
    }
  },

  setLlmConfig: (cfg) => set({ llmConfig: cfg }),

  setLlmStatus: (status) => set({ llmStatus: status }),

  setLlmSaving: (v) => set({ llmSaving: v }),

  setLlmTesting: (v) => set({ llmTesting: v }),

  openSettings: () => set({ settingsOpen: true, llmStatus: null }),

  closeSettings: () => set({ settingsOpen: false, llmStatus: null }),
}))
