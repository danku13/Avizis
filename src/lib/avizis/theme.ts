// Avizis — тема оформления: тёмная (дефолт) / светлая.
// Класс .dark живёт на <html> и выставляется bootstrap-скриптом в layout.tsx
// ДО гидрации (localStorage 'avizis-theme', отсутствие записи → тёмная).
// useSyncExternalStore: SSR-снимок — true (тёмная), чтобы не было расхождения при гидрации.

import { useSyncExternalStore } from 'react'

const KEY = 'avizis-theme'
const listeners = new Set<() => void>()

const readDom = (): boolean =>
  typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true

const notify = () => listeners.forEach((l) => l())

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Текущая тема тёмная? (реактивно; в SSR — true) */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, readDom, () => true)
}

/** Переключить тему и записать выбор в localStorage */
export function toggleTheme(): void {
  const next = !readDom()
  document.documentElement.classList.toggle('dark', next)
  try {
    localStorage.setItem(KEY, next ? 'dark' : 'light')
  } catch {
    /* localStorage недоступен (приватный режим) — тема живёт до перезагрузки */
  }
  notify()
}
