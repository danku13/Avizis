// VLM: точечная проверка — есть ли в НОВОМ видео вжатые субтитры (vs тосты/журнал)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const ASK = `Кадр из видео без дорожки субтитров. Вопрос один: есть ли в кадре ВЖАТАЯ строка субтитров — крупный полупрозрачный текст по ЦЕНТРУ внизу кадра поверх интерфейса, как субтитры в фильме (например, фраза на английском про агента/граф)?
ВНИМАНИЕ: не путать с (а) тост-уведомлением — карточкой в правом нижнем углу, (б) панелью журнала событий — встроенной панелью интерфейса внизу, (в) футером.
Ответь строго JSON: {"burned_subtitle": true|false, "what_bottom_text": "<что это на самом деле: тост/журнал/футер/ничего>"}`

const FRAMES = [
  ['/tmp/frames/v-30.png', 't=30с (планирование прогона 1)'],
  ['/tmp/frames/v-114.png', 't=114.7с (задача 2, авто-режим)'],
  ['/tmp/frames/v-232.png', 't=232.7с (скраб таймлайна)'],
  ['/tmp/frames/v-240.png', 't=240с (финал)'],
]

async function main() {
  const zai = await ZAI.create()
  for (const [file, label] of FRAMES) {
    const b64 = fs.readFileSync(file).toString('base64')
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${label}. ${ASK}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })
    console.log(`${label}: ${String(res?.choices?.[0]?.message?.content || '').replace(/\n/g, ' ').slice(0, 220)}`)
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
