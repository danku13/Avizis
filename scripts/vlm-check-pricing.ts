// VLM-проверка E2E-скриншотов прайсинга (CR-011): дефекты вёрстки и наличие стоимости
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const SHOTS = [
  ['scripts/avizis-pricing-toolbar.png', 'тулбар с чипом «↑ 700 · ↓ 140 · 7 вызов. · ≈$0,00315» и графом'],
  ['scripts/avizis-pricing-inspector.png', 'инспектор узла со строкой «Токены: ↑ 100 · ↓ 20 · ≈$0,00045»'],
  ['scripts/avizis-pricing-settings.png', 'модалка настроек с блоком «Прайсинг моделей (динамический)» и полями цены'],
]

async function main() {
  const zai = await ZAI.create()
  for (const [file, what] of SHOTS) {
    const b64 = fs.readFileSync(file).toString('base64')
    const res = await zai.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Скриншот Avizis Playground (${what}). Ответь строго JSON: {"defects": "<описание дефектов вёрстки: наложения, обрезанный текст, нечитаемое — или 'нет'>", "costVisible": true|false}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })
    const text = res?.choices?.[0]?.message?.content || ''
    console.log(`\n=== ${file} ===\n${String(text).slice(0, 400)}`)
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
