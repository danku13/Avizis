// Быстрая VLM-проверка скриншотов стриминга (CR-016 QA): что реально видно
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const files = [
  '/home/z/tacg/download/tacg-stream-01-node-badge.png',
  '/home/z/tacg/download/tacg-stream-02-inspector-live.png',
]

async function main() {
  const zai = await ZAI.create()
  for (const f of files) {
    const b64 = fs.readFileSync(f).toString('base64')
    const res = await zai.chat.completions.create({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe precisely: (1) is there a computation graph with nodes? (2) is any node showing a live "writing" indicator with a char count (e.g. "writing · 219 chars" or "пишет · N симв.")? (3) is a node-inspector dialog open, and does it show a live-growing output text with a "the model is writing" / "модель пишет" label? (4) any visual defects? Answer briefly in Russian.' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })
    console.log(`=== ${f.split('/').pop()} ===`)
    console.log(res.choices[0]?.message?.content ?? '(no content)')
  }
}

main().catch((e) => { console.error('VLM error:', e?.message ?? e); process.exit(1) })
