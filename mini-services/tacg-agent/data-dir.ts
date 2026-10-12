// TACG — портативный каталог данных (ADR-017): в dev-режиме (bun index.ts) —
// data/ рядом с исходником; в скомпилированном бинарнике (bun build --compile)
// import.meta.dir указывает в виртуальную ФС /$bunfs/root (только чтение), поэтому
// данные кладутся в data/ рядом с исполняемым файлом — exe переносится копированием.
import fs from 'node:fs'
import path from 'node:path'

const srcDir = (import.meta as any).dir as string

/** true, если код исполняется из скомпилированного однофайлового бинарника */
export const isCompiledBinary = (): boolean => !fs.existsSync(srcDir)

export const DATA_DIR = isCompiledBinary()
  ? path.join(path.dirname(process.execPath), 'data')
  : path.join(srcDir, 'data')
