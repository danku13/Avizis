// TACG — портативный каталог данных (ADR-017): в dev-режиме (bun index.ts) —
// data/ рядом с исходником; в скомпилированном бинарнике (bun build --compile)
// import.meta.dir указывает в виртуальную ФС /$bunfs/root (только чтение), поэтому
// данные кладутся в data/ рядом с исполняемым файлом — exe переносится копированием.
// ADR-018: десктоп-оболочка (Tauri) передаёт TACG_DATA_DIR — данные живут в
// каталоге приложения ОС (%APPDATA%/ru.tacg.desktop), survives переустановки;
// exe-прогон без оболочки остаётся полностью портативным (данные рядом с файлом).
import fs from 'node:fs'
import path from 'node:path'

const srcDir = (import.meta as any).dir as string

/** true, если код исполняется из скомпилированного однофайлового бинарника */
export const isCompiledBinary = (): boolean => !fs.existsSync(srcDir)

const resolveDataDir = (): string => {
  const override = (process.env.TACG_DATA_DIR || '').trim()
  if (override) return override
  return isCompiledBinary()
    ? path.join(path.dirname(process.execPath), 'data')
    : path.join(srcDir, 'data')
}

export const DATA_DIR = resolveDataDir()

// Каталог создаётся на первом обращении (кэш/конфиг могут отсутствовать — это норма)
try {
  fs.mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* невозможность создать каталог данных не роняет движок — упадёт при записи */
}
