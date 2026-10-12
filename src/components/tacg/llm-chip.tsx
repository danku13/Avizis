// TACG — чип активного LLM-провайдера + кнопка настроек (BYOK).
// CR-010: перенесён из run-toolbar в шапку — глобальная настройка, а не
// свойство конкретного прогона; тулбар освобождает строку для данных прогона.
'use client'

import { Cpu, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTacgStore } from '@/store/tacg-store'

/** Чип активного провайдера + кнопка настроек (BYOK) — компактный, для шапки */
export function LlmChip() {
  const llmConfig = useTacgStore((s) => s.llmConfig)
  const openSettings = useTacgStore((s) => s.openSettings)
  const d = llmConfig?.default
  const label =
    d?.adapter === 'openai-compatible'
      ? `LLM: ${d.adapter}${d.model ? ` · ${d.model}` : ''}`
      : 'LLM: z-ai SDK'
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={openSettings}
            role="status"
            aria-label={`Активный LLM-провайдер: ${label}. Открыть настройки`}
            className="inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white/70 px-2 text-xs font-medium text-zinc-700 transition-colors hover:border-teal-500/50 hover:text-teal-600 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:text-teal-300"
          >
            <Cpu className="size-3 shrink-0 text-teal-500 dark:text-teal-400" />
            <span className="hidden truncate md:inline">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Активный провайдер: {label} — клик открывает настройки LLM (BYOK)
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-7" onClick={openSettings} aria-label="Настройки LLM">
            <Settings2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Настройки LLM (BYOK: свои модели и ключи)</TooltipContent>
      </Tooltip>
    </>
  )
}
