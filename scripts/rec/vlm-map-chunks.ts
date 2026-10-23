// VLM: карта контента чанков записи Task 21 (2 кадра/чанк) — для нарезки и субтитров
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const IDS = ['000','001','002','003','004','005','006','007','008','009','010']

const ASK = `Два кадра из видео-записи приложения Avizis (Playground, тёмный UI, русский интерфейс). Опиши СТРОГО JSON одной строкой:
{"squashed": true|false, "modal": "<что за модалка ИЛИ нет>", "state": "<статус прогона/графа в 2-4 словах>", "note": "<что происходит, до 12 слов>"}
squashed = UI сплюснут по вертикали; modal = открыта ли модалка (какая: развилка/инспектор/нет); state = например «планирование, 3 узла» / «граф завершён, 9 узлов» / «история прогонов».`

async function main() {
  const zai = await ZAI.create()
  for (const id of IDS) {
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const suf of ['a', 'b']) {
      const p = `/tmp/frames2/c${id}-${suf}.png`
      if (!fs.existsSync(p)) continue
      const b64 = fs.readFileSync(p).toString('base64')
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    const raw = String(res?.choices?.[0]?.message?.content || '')
    const line = raw.replace(/```json|```/g, '').trim().slice(0, 300)
    console.log(`c${id}: ${line}`)
  }
  console.log('MAP-DONE')
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
