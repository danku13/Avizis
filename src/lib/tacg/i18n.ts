// TACG — ядро локализации (RU/EN, ADR-022): плоские словари + zustand-стор.
//
// Принципы:
//  • RU — пререндер-дефолт (статический экспорт), сохранённый/определённый язык
//    применяется после монтирования (без гидратационных рассинхронов, как с темой
//    CR-009 — но через effect: смена текста, а не класса <html>);
//  • выбор переживает перезагрузку (localStorage 'tacg-locale');
//  • недостающий ключ в EN молча берётся из RU (t не бросает, возвращает ключ);
//  • интерполяция {параметр} в шаблонах.
import { create } from 'zustand'
import { en } from './i18n-en'
import { ru } from './i18n-ru'

export type Locale = 'ru' | 'en'

export const LOCALE_STORAGE_KEY = 'tacg-locale'

const DICTS: Record<Locale, Record<string, string>> = { ru, en }

/** Перевод с фолбэком en → ru → ключ; {параметры} подставляются из params */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const raw = DICTS[locale][key] ?? DICTS.ru[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, p) => String(params[p] ?? `{${p}}`))
}

/** Сохранённый язык > язык браузера (ru* → ru, прочие → en) */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'ru'
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch {
    /* приватный режим */
  }
  const nav = typeof navigator !== 'undefined' ? (navigator.language || '').toLowerCase() : ''
  return nav.startsWith('ru') ? 'ru' : 'en'
}

interface I18nState {
  locale: Locale
  /** false, пока не применён сохранённый/определённый язык (первый кадр = prerender RU) */
  ready: boolean
  init: () => void
  setLocale: (l: Locale) => void
}

export const useI18nStore = create<I18nState>((set, get) => ({
  locale: 'ru',
  ready: false,
  init: () => {
    if (get().ready) return
    const locale = detectLocale()
    set({ locale, ready: true })
    try {
      document.documentElement.lang = locale
    } catch {
      /* SSR/тесты без DOM */
    }
  },
  setLocale: (locale) => {
    set({ locale })
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale)
      document.documentElement.lang = locale
    } catch {
      /* приватный режим */
    }
  },
}))

export type TFunc = (key: string, params?: Record<string, string | number>) => string

/** Хук перевода: компонент перерисовывается при смене языка */
export function useT(): TFunc {
  const locale = useI18nStore((s) => s.locale)
  return (key, params) => translate(locale, key, params)
}

/** Перевод по языку стора НА МОМЕНТ ВЫЗОВА — для колбэков сокетов/таймеров
 *  (их замыкание живёт дольше рендера, useT замёр бы язык на маунте) */
export function tNow(key: string, params?: Record<string, string | number>): string {
  return translate(useI18nStore.getState().locale, key, params)
}
