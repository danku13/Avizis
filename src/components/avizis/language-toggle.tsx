// Avizis — переключатель языка интерфейса (ADR-022): RU ⇄ EN, выбор
// переживает перезагрузку (localStorage 'avizis-locale'), <html lang>
// синхронизируется. Компактен, как ThemeToggle — одна кнопка в шапке.
'use client'

import { Languages } from 'lucide-react'
import { useI18nStore, useT } from '@/lib/avizis/i18n'

export function LanguageToggle() {
  const t = useT()
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)

  return (
    <button
      onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}
      aria-label={t('lang.toggleAria')}
      title={t('lang.toggleTitle')}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200/80 px-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-800/80 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
    >
      <Languages className="size-3.5" />
      <span className="tabular-nums">{locale === 'ru' ? 'RU' : 'EN'}</span>
    </button>
  )
}
