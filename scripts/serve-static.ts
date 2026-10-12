// TACG — раздача статического экспорта (out/) для локальной верификации
// десктоп-контракта Tauri (ADR-018): страница с ?port=<N> подключается
// напрямую к движку-сайдкару. Запуск: bun scripts/serve-static.ts [порт]
const PORT = Number(process.argv[2] || 82)
const ROOT = new URL('../out/', import.meta.url).pathname

Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url)
    let p = decodeURIComponent(u.pathname)
    if (p === '/') p = '/index.html'
    const file = Bun.file(ROOT + p)
    if (await file.exists()) return new Response(file)
    // SPA-фолбэк на корень для не-файловых путей
    return new Response(Bun.file(ROOT + 'index.html'))
  },
})
console.log(`[serve-static] out/ раздаётся на http://localhost:${PORT}`)
