// Тест контракта автообновления (ADR-021 / FR-912): frontend-модуль
// src/lib/avizis/updater.ts поверх контракт-мока (?update-mock=1): проверка
// наличия обновления, последовательность прогресса (download → install →
// relaunch), монотонность процентов, отписка, web-режим без Tauri
// (null + отказ с понятной ошибкой). Сам swap exe — в интеграционных
// тестах cargo (`cargo test -p updater-core`), браузерный E2E мока —
// agent-browser (скриншоты avizis-update-*.png), реальный Tauri-слой — CI.
import {
  UpdateProgress,
  applyUpdate,
  checkForUpdates,
  onUpdateProgress,
} from '../src/lib/avizis/updater'

interface StepResult {
  name: string
  ok: boolean
  details: string[]
}

const results: StepResult[] = []
const push = (name: string, ok: boolean, details: string[] = []) => {
  results.push({ name, ok, details })
  console.log(`[test] ${ok ? '✅' : '❌'} ${name}`)
  details.forEach((d) => console.log(`        ${ok ? '' : '!'} ${d}`))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Минимальный window для мока: достаточно location.search
const stubWindow = (search: string, tauri: boolean) => {
  ;(globalThis as any).window = {
    location: { search },
    ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
  }
}

async function main() {
  // ─── A. Мок контракта: check → прогресс → relaunch ───
  stubWindow('?update-mock=1', false)

  const check = await checkForUpdates()
  push(
    'A1 мок check: есть обновление, версии и размер на месте',
    !!check && check.hasUpdate && check.latest === '0.11.1' && check.current === '0.11.0' && !!check.size && !check.error,
    [`current=${check?.current} latest=${check?.latest} size=${check?.size}`]
  )

  const events: UpdateProgress[] = []
  let off: (() => void) | null = null
  try {
    off = await onUpdateProgress((p) => events.push({ ...p }))
    await applyUpdate()
  } finally {
    off?.()
  }

  const downloads = events.filter((e) => e.stage === 'download')
  const percents = downloads.map((e) => (e.total > 0 ? Math.round((e.received / e.total) * 100) : 0))
  const monotonic = percents.every((p, i) => i === 0 || p >= percents[i - 1])
  push(
    'A2 прогресс: download → install → relaunch, проценты монотонны до 100%',
    events.length >= 12 &&
      downloads.length === 10 &&
      events[events.length - 2].stage === 'install' &&
      events[events.length - 1].stage === 'relaunch' &&
      monotonic &&
      percents[percents.length - 1] === 100 &&
      events[events.length - 1].received === events[events.length - 1].total,
    [`событий=${events.length} download=${downloads.length} %=${percents.join(',')} финал=${events[events.length - 1].stage}`]
  )

  // ─── B. Отписка: после off() новых событий нет ───
  const after: UpdateProgress[] = []
  const off2 = await onUpdateProgress((p) => after.push(p))
  off2()
  await applyUpdate() // полный сценарий повторно
  await sleep(150)
  push(
    'B1 отписка: колбэк не вызывается после off()',
    after.length === 0,
    [`событий после отписки=${after.length}`]
  )

  // ─── C. Web-режим без Tauri и без мока: обновлений нет ───
  stubWindow('', false)
  const webCheck = await checkForUpdates()
  push('C1 web-режим: checkForUpdates → null (бейдж не показывается)', webCheck === null, [`result=${webCheck}`])

  let webApplyError = ''
  try {
    await applyUpdate()
  } catch (e) {
    webApplyError = e instanceof Error ? e.message : String(e)
  }
  push(
    'C2 web-режим: applyUpdate отказывает с понятной причиной',
    webApplyError.includes('десктоп'),
    [`error=${webApplyError}`]
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${'═'.repeat(30)} ИТОГ ${'═'.repeat(30)}`)
  console.log(`Пройдено: ${results.length - failed.length}/${results.length}`)
  if (failed.length) {
    console.log('ПРОВАЛЕНО:', failed.map((f) => f.name).join('; '))
    process.exit(1)
  }
  console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ ✅')
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
