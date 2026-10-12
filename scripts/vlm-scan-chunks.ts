// VLM: скан сырых чанков — ищем инспектор узла, скраб таймлайна, взаимодействие с историей
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const ASK = `Кадры TACG (4 кадра из ОДНОГО 20-секундного куска записи, метки T3/T8/T13/T18). Для каждого кадра одна строка строго:
T<время>: статус=<...>; инспектор=<нет|открыт справа: панель с заголовком узла, полями вход/вывод>; позТаймлайна=<начало|середина|конец|нет>; выделениеИстории=<какая запись слева подсвечена: верхняя/нижняя/зелёная>; прочее=<курсор на чём, модалка, что меняется>
Особо: если ПОЗ ТАЙМЛАЙНА РАЗЛИЧАЕТСЯ между кадрами одного куска — это скраббинг, отметь. Если ВЫДЕЛЕНИЕ ИСТОРИИ меняется — отметь. Отвечай по-русски, только факты.`

const CHUNKS = ['014', '015', '016', '017', '018', '049', '050', '051']

async function main() {
  const zai = await ZAI.create()
  for (const c of CHUNKS) {
    const times = [3, 8, 13, 18].filter(t => fs.existsSync(`/tmp/frames/s-${c}-${t}.png`))
    if (!times.length) { console.log(`\n### chunk-${c}: нет кадров`); continue }
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const t of times) {
      const b64 = fs.readFileSync(`/tmp/frames/s-${c}-${t}.png`).toString('base64')
      content.push({ type: 'text', text: `T${t}:` })
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    console.log(`\n### chunk-${c}`)
    console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 1200))
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
