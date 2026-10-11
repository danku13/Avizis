// TACG — глобальное состояние (zustand)
'use client'

import { create } from 'zustand'
import { RunEvent, RunMeta, RunMode, RunSnapshot } from '@/lib/tacg/types'

export interface CurrentRunMeta {
  id: string
  task: string
  mode: RunMode
  createdAt: number
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

  setConnected: (v: boolean) => void
  setRuns: (runs: RunMeta[]) => void
  onRunCreated: (meta: CurrentRunMeta) => void
  onRunStarted: (runId: string) => void
  applyEvent: (ev: RunEvent) => void
  loadSnapshot: (run: RunSnapshot) => void
  setCursor: (i: number | null) => void
  setPlaying: (v: boolean) => void
  select: (nodeId: string | null) => void
  setStarting: (v: boolean) => void
  clearRun: () => void
  removeRunLocal: (runId: string) => void
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

  setConnected: (v) => set({ connected: v }),

  setRuns: (runs) => set({ runs: runs ?? [] }),

  onRunCreated: (meta) =>
    set({
      currentRunId: meta.id,
      currentMeta: meta,
      events: [],
      cursor: null,
      playing: false,
      selectedNodeId: null,
      starting: false,
    }),

  onRunStarted: () => set({ starting: false }),

  applyEvent: (ev) => {
    // события приходят только для текущего запуска (фильтр в слое socket)
    if (get().cursor === null) {
      set({ events: [...get().events, ev] })
    } else {
      // во время воспроизведения новые события накапливаются «в фоне»
      set({ events: [...get().events, ev] })
    }
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
    }),

  setCursor: (i) => set({ cursor: i }),

  setPlaying: (v) => set({ playing: v }),

  select: (nodeId) => set({ selectedNodeId: nodeId }),

  setStarting: (v) => set({ starting: v }),

  clearRun: () =>
    set({
      currentRunId: null,
      currentMeta: null,
      events: [],
      cursor: null,
      playing: false,
      selectedNodeId: null,
    }),

  removeRunLocal: (runId) => {
    const { currentRunId, runs } = get()
    set({ runs: runs.filter((r) => r.id !== runId) })
    if (currentRunId === runId) {
      get().clearRun()
    }
  },
}))
