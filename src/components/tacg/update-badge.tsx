// TACG — индикатор обновлений в футере (ADR-021): тихая авто-проверка при
// старте, ручная проверка по кнопке-иконке, применение с прогрессом
// (скачивание % → установка → перезапуск). В обычном браузерном режиме
// (без Tauri и без контракт-мока ?update-mock=1) не отображается.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  UpdateCheckResult,
  applyUpdate,
  checkForUpdates,
  onUpdateProgress,
  updateMockEnabled,
} from '@/lib/tacg/updater'

type Phase = 'off' | 'idle' | 'checking' | 'ready' | 'applying' | 'error'

/** Первая строка примечаний к релизу — для описания тоста */
function firstLine(notes: string | null): string | undefined {
  const line = notes?.split('\n').map((l) => l.trim()).find(Boolean)
  return line?.slice(0, 140)
}

export function UpdateBadge() {
  const [phase, setPhase] = useState<Phase>('off')
  const [info, setInfo] = useState<UpdateCheckResult | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // перезапуск обрывает IPC-канал — это успех, а не ошибка invoke
  const sawRelaunch = useRef(false)

  // ─── Применение обновления: прогресс тостом, состояние — в бейдж ───
  const startApply = useCallback(async () => {
    if (phase === 'applying' || phase === 'checking') return
    setPhase('applying')
    setError(null)
    setPct(null)
    sawRelaunch.current = false
    const toastId = 'tacg-update-toast'
    toast.loading('Скачивание обновления…', { id: toastId, duration: Infinity })
    let off: (() => void) | null = null
    try {
      off = await onUpdateProgress((p) => {
        if (p.stage === 'download') {
          const percent = p.total > 0 ? Math.round((p.received / p.total) * 100) : null
          setPct(percent)
          toast.loading('Скачивание обновления', {
            id: toastId,
            duration: Infinity,
            description: `${(p.received / 1048576).toFixed(1)} из ${(p.total / 1048576).toFixed(1)} МБ${percent !== null ? ` · ${percent}%` : ''}`,
          })
        } else if (p.stage === 'install') {
          setPct(null)
          toast.loading('Установка обновления…', { id: toastId, duration: Infinity })
        } else {
          sawRelaunch.current = true
          toast.success('Обновление установлено — перезапускаем приложение…', {
            id: toastId,
            duration: 10000,
          })
        }
      })
      await applyUpdate()
    } catch (e) {
      // оболочка перезапускается — invoke обрывается без ответа: это норма
      if (!sawRelaunch.current) {
        const msg = e instanceof Error ? e.message : String(e)
        setPhase('error')
        setError(msg)
        toast.error('Не удалось обновиться', {
          id: toastId,
          duration: 12000,
          description: `${msg}. Данные не пострадали — попробуйте ещё раз или перезапустите приложение`,
        })
      }
    } finally {
      off?.()
    }
  }, [phase])

  // ─── Тихая авто-проверка при старте: тост только если есть обновление ───
  useEffect(() => {
    if (!updateMockEnabled()) {
      // в браузере без Tauri обновлений нет — бейдж не показываем вовсе
      const tauri = '__TAURI_INTERNALS__' in window
      if (!tauri) return
    }
    setPhase('idle')
    let cancelled = false
    ;(async () => {
      const res = await checkForUpdates()
      if (cancelled || !res) return
      setInfo(res)
      if (res.hasUpdate && res.latest) {
        setPhase('ready')
        toast.info(`Доступна версия v${res.latest}`, {
          description: 'Файлы заменятся, приложение перезапустится; история и настройки сохранятся',
          duration: 15000,
          action: {
            label: 'Обновить',
            onClick: () => void startApply(),
          },
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Ручная проверка по кнопке: полный отклик, включая «нет обновлений» ───
  const runCheck = useCallback(async () => {
    if (phase === 'applying' || phase === 'checking') return
    setPhase('checking')
    const res = await checkForUpdates()
    if (!res) {
      setPhase('off')
      return
    }
    setInfo(res)
    if (res.hasUpdate && res.latest) {
      setPhase('ready')
      toast.success(`Доступна версия v${res.latest}`, {
        description: firstLine(res.notes) || 'Нажмите «Обновить» рядом с версией в футере',
      })
    } else if (res.error) {
      setPhase('error')
      setError(res.error)
      toast.error('Не удалось проверить обновления', {
        description: `${res.error}. Проверьте соединение и попробуйте ещё раз`,
      })
    } else {
      setPhase('idle')
      toast.success('У вас последняя версия', {
        description: `v${res.current} — обновлений нет`,
      })
    }
  }, [phase])

  if (phase === 'off') return null

  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="status"
      aria-label="Состояние обновлений приложения"
    >
      {phase === 'ready' && info?.latest && (
        <button
          onClick={() => void startApply()}
          title={`Обновить до v${info.latest}: скачать, заменить файлы и перезапустить`}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/10 px-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-500/20 dark:text-teal-300"
        >
          <ArrowUpCircle className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">обновить до</span> v{info.latest}
        </button>
      )}

      {phase === 'applying' && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-300">
          <Loader2 className="size-3.5 animate-spin" />
          обновление{pct !== null ? `… ${pct}%` : '…'}
        </span>
      )}

      {phase === 'error' && (
        <span
          className="text-xs text-amber-600 dark:text-amber-300"
          title={error ?? undefined}
        >
          обновление не удалось
        </span>
      )}

      {phase !== 'applying' && (
        <button
          onClick={() => void runCheck()}
          disabled={phase === 'checking'}
          aria-label="Проверить обновления"
          title="Проверить обновления (GitHub Releases)"
          className="inline-flex size-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/60 hover:text-zinc-600 disabled:cursor-progress dark:hover:bg-zinc-800/60 dark:hover:text-zinc-300"
        >
          <RefreshCw className={cn('size-3.5', phase === 'checking' && 'animate-spin')} />
        </button>
      )}
    </span>
  )
}
