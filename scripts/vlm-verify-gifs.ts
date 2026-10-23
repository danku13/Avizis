// VLM: финальная верификация GIF — пропорции и отсутствие субтитров
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const NAMES = [
  'avizis-gif-01-launch-planning',
  'avizis-gif-02-decision-branch',
  'avizis-gif-03-plan-growth',
  'avizis-gif-04-node-inspector',
  'avizis-gif-05-timeline-replay',
  'avizis-gif-06-auto-mode',
  'avizis-gif-07-error-retry',
  'avizis-gif-08-run-history',
  'avizis-gif-09-completion-audit',
]

const ASK = `Два кадра (начало и середина) из GIF-анимации приложения Avizis. Ответь строго JSON одной строкой:
{"squashed": true|false, "subtitles": true|false, "note": "<до 15 слов: что видно>"}
squashed = UI заметно сплюснут по вертикали (текст/кнопки широкие и низкие);
subtitles = в нижней части кадра есть белая текстовая подпись-субтитр (не элементы UI).`

async function main() {
  const zai = await ZAI.create()
  let bad = 0
  for (const name of NAMES) {
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const suf of ['a', 'b']) {
      const p = `/tmp/frames/g-${name}-${suf}.png`
      if (!fs.existsSync(p)) continue
      const b64 = fs.readFileSync(p).toString('base64')
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    const raw = String(res?.choices?.[0]?.message?.content || '')
    let line = raw.replace(/```json|```/g, '').trim().slice(0, 200)
    let ok = true
    try {
      const j = JSON.parse(line)
      ok = !j.squashed && !j.subtitles
      line = JSON.stringify(j)
    } catch { ok = false }
    if (!ok) bad++
    console.log(`${ok ? 'OK ' : 'BAD'} ${name}: ${line}`)
  }
  console.log(bad === 0 ? '\nВСЕ GIF ЧИСТЫЕ' : `\nПРОБЛЕМНЫХ: ${bad}`)
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
