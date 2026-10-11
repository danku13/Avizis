// TACG — таймлайн: скраббинг по истории событий, воспроизведение, версии
'use client'

import { useEffect } from 'react'
import { SkipBack, SkipForward, Play, Pause, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { timelineTicks } from '@/lib/tacg/fold'
import { useTacgStore } from '@/store/tacg-store'
import { cn } from '@/lib/utils'

export function Timeline() {
  const events = useTacgStore((s) => s.events)
  const cursor = useTacgStore((s) => s.cursor)
  const playing = useTacgStore((s) => s.playing)
  const setCursor = useTacgStore((s) => s.setCursor)
  const setPlaying = useTacgStore((s) => s.setPlaying)

  const total = events.length
  const isLive = cursor === null
  const position = isLive ? Math.max(total - 1, 0) : cursor!
  const ticks = timelineTicks(events)

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const st = useTacgStore.getState()
      const cur = st.cursor === null ? 0 : st.cursor
      if (cur >= st.events.length - 1) {
        st.setPlaying(false)
        return
      }
      st.setCursor(cur + 1)
    }, 600)
    return () => clearInterval(t)
  }, [playing])

  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (isLive) {
      setCursor(0)
      setPlaying(true)
    } else if (position < total - 1) {
      setPlaying(true)
    } else {
      setCursor(0)
      setPlaying(true)
    }
  }

  const disabled = total === 0

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-secondary/40 p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={() => { setPlaying(false); setCursor(Math.max(0, position - 1)) }} disabled={disabled || position === 0} aria-label="Назад на событие">
          <SkipBack className="size-3.5" />
        </Button>
        <Button variant="secondary" size="icon" className="size-7" onClick={togglePlay} disabled={disabled} aria-label={playing ? 'Пауза воспроизведения' : 'Воспроизвести историю'}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => { setPlaying(false); setCursor(Math.min(total - 1, position + 1)) }} disabled={disabled || position >= total - 1} aria-label="Вперёд на событие">
          <SkipForward className="size-3.5" />
        </Button>

        <div className="relative mx-2 flex-1">
          <Slider
            value={[position]}
            min={0}
            max={Math.max(total - 1, 0)}
            step={1}
            onValueChange={([v]) => {
              setPlaying(false)
              setCursor(v)
            }}
            disabled={disabled}
            aria-label="Позиция воспроизведения"
          />
          {total > 1 && (
            <div className="pointer-events-none absolute inset-x-0 top-[7px] h-0">
              {ticks.map((t) => (
                <span
                  key={t}
                  className={cn('absolute size-1 -translate-x-1/2 rounded-full', t <= position ? 'bg-cyan-400/80' : 'bg-zinc-600')}
                  style={{ left: `${(t / (total - 1)) * 100}%` }}
                />
              ))}
            </div>
          )}
        </div>

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {position + 1} / {total}
        </span>

        <Button
          variant={isLive ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => {
            setPlaying(false)
            setCursor(null)
          }}
          disabled={isLive}
        >
          <Radio className={cn('size-3', isLive && 'animate-pulse text-emerald-400')} />
          Live
        </Button>
      </div>
      {!isLive && (
        <p className="pl-[52px] text-[11px] text-muted-foreground">
          Режим воспроизведения: показано состояние графа на событии #{cursor! + 1}. Нажмите «Live», чтобы вернуться
          к текущему состоянию.
        </p>
      )}
      {isLive && playing && (
        <p className="pl-[52px] text-[11px] text-muted-foreground">Воспроизведение запущено с начала истории…</p>
      )}
    </div>
  )
}
