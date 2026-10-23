// VLM: контрольные кадры для границ GIF-нарезок — что видно в каждом
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const ASK = `Это кадры из записи демо Avizis (тёмный UI, граф агента). Для КАЖДОГО кадра по порядку дай одну строку: номер → что происходит (модалка развилки? выбор варианта? красный узел ошибки? retry? успех? метрики завершения? история прогонов? запуск прогона? рост графа?). Кратко, без JSON.`

async function main() {
  const zai = await ZAI.create()
  const files = fs.readdirSync('/tmp/frames').filter(f => f.startsWith('k-')).sort()
  // двумя партиями по ~8
  for (const batch of [files.slice(0, 8), files.slice(8)]) {
    if (!batch.length) continue
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const f of batch) {
      const b64 = fs.readFileSync(`/tmp/frames/${f}`).toString('base64')
      content.push({ type: 'text', text: `кадр ${f}:` })
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 1800))
    console.log('---')
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
