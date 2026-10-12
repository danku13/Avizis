// TACG — язык прогона движка (ADR-022): контент LLM и сообщения журнала
// следуют языку задачи (кириллица в задаче → ru, иначе → en), UI остаётся
// независимым переключателем. L() — выбор строки по языку.

export type Lang = 'ru' | 'en'

/** Определение языка задачи: кириллица → ru, остальное → en */
export function detectLang(task: string): Lang {
  return /[а-яё]/i.test(task) ? 'ru' : 'en'
}

/** Выбор строки по языку прогона (сообщения журнала, статусы, промпты) */
export function L(lang: Lang, ru: string, en: string): string {
  return lang === 'en' ? en : ru
}

/** Инструкция языка ответов для промптов LLM (en-прогоны) */
export function promptLangSuffix(lang: Lang): string {
  return lang === 'en'
    ? ' Respond in English only: node titles, descriptions, results, reasons and decision texts must be in English.'
    : ''
}
