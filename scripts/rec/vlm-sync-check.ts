// VLM: контроль синхронности tacg-demo2.mp4 — кадры на известных таймкодах
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const CHECKS: [string, string][] = [
  ['50', 'инспектор узла открыт (панель ВХОД/ВЫХОД)'],
  ['119', 'модалка развилки «формат публикации» открыта'],
  ['140', 'граф прогона 2 растёт, много узлов, без модалок'],
  ['166', 'история прогонов: виден список записей (два прогона)'],
]

const ASK = `Кадр из видео приложения TACG. Ожидаю: {expect}. Ответь строго JSON одной строкой:
{"match": true|false, "see": "<до 12 слов: что реально видно>"}
match = кадр соответствует ожиданию.`

async function main() {
  const zai = await ZAI.create()
  let bad = 0
  for (const [t, expect] of CHECKS) {
    const p = `/tmp/frames2/final-${t}.png`
    if (!fs.existsSync(p)) { console.log(`MISS ${t}`); bad++; continue }
    const b64 = fs.readFileSync(p).toString('base64')
    const res = await zai.chat.completions.createVision({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ASK.replace('{expect}', expect) },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ] as any,
      }],
      thinking: { type: 'disabled' },
    })
    const raw = String(res?.choices?.[0]?.message?.content || '')
    const line = raw.replace(/```json|```/g, '').trim().slice(0, 200)
    let ok = false
    try { ok = JSON.parse(line).match } catch {}
    if (!ok) bad++
    console.log(`${ok ? 'OK ' : 'BAD'} t=${t}s: ${line}`)
  }
  console.log(bad === 0 ? 'SYNC-OK' : `SYNC-ISSUES: ${bad}`)
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
