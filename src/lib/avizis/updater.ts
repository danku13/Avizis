// Avizis — контракт автообновления по GitHub Releases (ADR-021).
//
// Проверка и применение идут через Tauri-команды оболочки (Rust):
//   check_updates → { current, latest, notes, url, size, hasUpdate, error }
//   apply_update  → прогресс событиями `update:progress` (download/install/relaunch)
// Браузерный режим без Tauri не обновляется (возвращает null).
//
// E2E/отладка десктоп-контракта в браузере: ?update-mock=1 активирует
// детерминированный сценарий обновления без оболочки — тот же приём, что
// ?port= для движка (ADR-018), сценарий фиксирован и не трогает сеть.

export interface UpdateCheckResult {
  current: string
  latest: string | null
  notes: string | null
  url: string | null
  size: number | null
  hasUpdate: boolean
  error: string | null
}

export type UpdateStage = 'download' | 'install' | 'relaunch'

export interface UpdateProgress {
  stage: UpdateStage
  received: number
  total: number
}

/** true, когда UI работает внутри десктоп-оболочки Tauri */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Мок-режим контракта обновлений (только для E2E/отладки в браузере) */
export function updateMockEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('update-mock') === '1'
}

// ─────────────────── Мок контракта (только ?update-mock=1) ───────────────────

const MOCK_RESULT: UpdateCheckResult = {
  current: '0.11.0',
  latest: '0.11.1',
  notes: 'Тест контракта обновления: новые функции, исправления, ускорение.',
  url: 'https://github.com/danku13/Avizis/releases/latest',
  size: 49_973_144,
  hasUpdate: true,
  error: null,
}

const mockListeners = new Set<(p: UpdateProgress) => void>()

/** Сценарий применения: скачивание ~1,3с → установка → «перезапуск» (без рестарта страницы) */
function mockApply(): Promise<void> {
  return new Promise((resolve) => {
    const total = MOCK_RESULT.size ?? 1
    const notify = (p: UpdateProgress) => mockListeners.forEach((fn) => fn(p))
    const steps = 10
    let step = 0
    const tick = () => {
      step += 1
      if (step <= steps) {
        notify({ stage: 'download', received: Math.round((total * step) / steps), total })
        setTimeout(tick, 130)
      } else if (step === steps + 1) {
        notify({ stage: 'install', received: total, total })
        setTimeout(tick, 350)
      } else {
        notify({ stage: 'relaunch', received: total, total })
        setTimeout(resolve, 250)
      }
    }
    setTimeout(tick, 150)
  })
}

// ─────────────────── Публичный API ───────────────────

/**
 * Проверить обновления. null — режим без обновлений (браузер без Tauri и
 * без мока); ошибки сети не бросаются, а приезжают в поле error.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  if (updateMockEnabled()) return { ...MOCK_RESULT }
  if (!isTauri()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<UpdateCheckResult>('check_updates')
  } catch (e) {
    return {
      current: '',
      latest: null,
      notes: null,
      url: null,
      size: null,
      hasUpdate: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Подписка на прогресс применения обновления; возвращает отписку.
 */
export async function onUpdateProgress(cb: (p: UpdateProgress) => void): Promise<() => void> {
  if (updateMockEnabled()) {
    mockListeners.add(cb)
    return () => mockListeners.delete(cb)
  }
  const { listen } = await import('@tauri-apps/api/event')
  const un = await listen<UpdateProgress>('update:progress', (e) => cb(e.payload))
  return un
}

/**
 * Применить обновление: скачать → подменить файлы → перезапуск приложения.
 * В Tauri промис может не разрешиться — процесс перезапускается; ориентируйтесь
 * на стадию `relaunch` из onUpdateProgress, а не на разрешение промиса.
 */
export async function applyUpdate(): Promise<void> {
  if (updateMockEnabled()) return mockApply()
  if (!isTauri()) throw new Error('Обновление доступно только в десктоп-приложении')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('apply_update')
}
