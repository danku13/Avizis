// VLM-проверка E2E-скриншотов валюты (FR-910): дефекты вёрстки и наличие конвертации
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const SHOTS = [
  ['scripts/avizis-currency-chip.png', 'тулбар с чипом «↑ 600 · ↓ 120 · 6 вызов. · ≈ $0,0027 · €0,00241» и граф'],
  ['scripts/avizis-currency-settings.png', 'модалка настроек с блоком «Валюта стоимости» (селектор, ручной курс, источники ЦБ РФ/er-api)'],
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
            { type: 'text', text: `Скриншот Avizis Playground (${what}). Ответь строго JSON: {"defects": "<описание дефектов вёрстки: наложения, обрезанный текст, нечитаемое — или 'нет'>", "currencyVisible": true|false}` },
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
