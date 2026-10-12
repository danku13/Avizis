// Хранилище запусков: память + дублирование в JSON-файл (debounce)
import fs from 'node:fs'
import path from 'node:path'
import { RunMeta, RunSnapshot } from './types'

const DATA_DIR = path.join(import.meta.dir, 'data')
const FILE = path.join(DATA_DIR, 'runs.json')
const MAX_RUNS = 20

class RunStore {
  private runs = new Map<string, RunSnapshot>()
  private saveTimer: any = null
  private loaded = false

  private ensureLoad() {
    if (this.loaded) return
    this.loaded = true
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      if (fs.existsSync(FILE)) {
        const arr = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
        if (Array.isArray(arr)) {
          for (const r of arr) {
            if (r && r.id) this.runs.set(r.id, r as RunSnapshot)
          }
        }
      }
    } catch (e) {
      console.error('[tacg-store] не удалось загрузить историю:', e)
    }
  }

  save(run: RunSnapshot) {
    this.ensureLoad()
    this.runs.set(run.id, run)
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 600)
  }

  private flush() {
    try {
      this.ensureLoad()
      const arr = [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS)
      const keep = new Set(arr.map((r) => r.id))
      for (const id of this.runs.keys()) {
        if (!keep.has(id)) this.runs.delete(id)
      }
      fs.writeFileSync(FILE, JSON.stringify(arr), 'utf-8')
    } catch (e) {
      console.error('[tacg-store] не удалось сохранить историю:', e)
    }
  }

  get(id: string): RunSnapshot | undefined {
    this.ensureLoad()
    return this.runs.get(id)
  }

  remove(id: string) {
    this.ensureLoad()
    this.runs.delete(id)
    this.flush()
  }

  history(): RunMeta[] {
    this.ensureLoad()
    return [...this.runs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        id: r.id,
        task: r.task,
        mode: r.mode,
        status: r.status,
        createdAt: r.createdAt,
        finishedAt: r.finishedAt,
        nodesCount: r.nodes.length,
        doneCount: r.nodes.filter((n) => n.status === 'done').length,
        dynamicCount: r.nodes.filter((n) => n.dynamic).length,
        version: r.version,
        progress: r.progress,
      }))
  }
}

export const store = new RunStore()
