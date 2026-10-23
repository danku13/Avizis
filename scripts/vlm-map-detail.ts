// VLM: детальная карта ключевых моментов (ошибка/retry/инспектор/скраб/история)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const ASK = `Кадры Avizis. Для КАЖДОЙ метки времени одна строка строго:
T<время>: статус=<Planning|Running|Paused|Error|Completed>; инспектор=<нет|открыт справа, узел ...>; красныйУзел=<нет|есть, id/название если видно>; модалка=<нет|есть, тема>; позТаймлайна=<начало|середина|конец|другое — положение ползунка таймлайна внизу>; чемОтличается=<1-5 слов: что изменилось по сравнению с типичной картиной>`

const BATCHES = [
  [88, 92, 95, 97, 101, 105, 145],
  [150, 152, 158, 165, 172, 180, 183],
  [190, 200, 205, 236, 242, 245],
]

async function main() {
  const zai = await ZAI.create()
  for (const batch of BATCHES) {
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const t of batch) {
      const b64 = fs.readFileSync(`/tmp/frames/d-${t}.png`).toString('base64')
      content.push({ type: 'text', text: `T${t}:` })
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    console.log('— партия —')
    console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 1800))
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
