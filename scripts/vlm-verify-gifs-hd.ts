// VLM: верификация HD GIF (Task 20) — пропорции и отсутствие субтитров, 2 кадра на GIF
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const NAMES = [
  'tacg-gif-01-launch-planning',
  'tacg-gif-02-decision-branch',
  'tacg-gif-03-plan-growth',
  'tacg-gif-04-node-inspector',
  'tacg-gif-05-timeline-replay',
  'tacg-gif-06-auto-mode',
  'tacg-gif-07-error-retry',
  'tacg-gif-08-run-history',
  'tacg-gif-09-completion-audit',
  'tacg-demo-preview',
]

const ASK = `Два кадра (начало и середина) из GIF-анимации приложения TACG. Ответь строго JSON одной строкой:
{"squashed": true|false, "subtitles": true|false, "note": "<до 15 слов: что видно>"}
squashed = UI заметно сплюснут по вертикали (текст/кнопки широкие и низкие);
subtitles = в нижней части кадра есть белая текстовая подпись-субтитр (не элементы UI).`

async function main() {
  const zai = await ZAI.create()
  let bad = 0
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
