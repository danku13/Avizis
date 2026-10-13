// VLM: прицельная перепроверка 3 GIF с флагом «subtitles» (Task 20).
// Задача: отличить НАСТОЯЩИЕ вжатые субтитры (белый текст с обводкой, по центру
// внизу, поверх КАРТИНКИ, выглядит как кинематографический саб) от элементов UI
// (тосты, статус-бар, подсказки, журнал событий — это часть интерфейса приложения).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const NAMES = [
  'tacg-gif-02-decision-branch',
  'tacg-gif-05-timeline-replay',
  'tacg-gif-06-auto-mode',
]

const ASK = `Кадры из GIF-записи экрана приложения (TACG, десктопный UI). Проверь ТОЛЬКО одно: есть ли на кадре ВЖАТЫЕ В ВИДЕО субтитры в кинематографическом стиле — белые буквы с чёрной обводкой/тенью, по центру нижней части кадра, поверх всего, НЕ являющиеся частью интерфейса приложения (это выглядело бы как перевод реплик в фильме).
НЕ считать субтитрами: тосты-уведомления, синие/серые подсказки, статус-бары, панели журнала событий, кнопки, лейблы — всё это UI приложения.
Ответь строго JSON одной строкой: {"burned_subs": true|false, "what_bottom_text": "<до 12 слов: что за текст внизу и чей он>"}`

async function main() {
  const zai = await ZAI.create()
  for (const name of NAMES) {
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const suf of ['a', 'b']) {
      const p = `/tmp/frames-hd/g-${name}-${suf}.png`
      if (!fs.existsSync(p)) continue
      const b64 = fs.readFileSync(p).toString('base64')
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    const raw = String(res?.choices?.[0]?.message?.content || '')
    const line = raw.replace(/```json|```/g, '').trim().slice(0, 250)
    let verdict = 'UNCLEAR'
    try {
      const j = JSON.parse(line)
      verdict = j.burned_subs ? 'REAL SUBS' : 'UI, НЕ сабы'
    } catch { /* parse fail */ }
    console.log(`${verdict}  ${name}: ${line}`)
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
