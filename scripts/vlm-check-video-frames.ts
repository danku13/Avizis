// VLM-проверка кадров диагностики видео: искажение пропорций, вжатые субтитры
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const FRAMES: Array<[string, string]> = [
  ['/tmp/frames/f-chunk000.png', 'кадр из исходной записи chunk-000 (интро, поле задачи). Проверь: выглядит ли UI непропорционально сплюснутым по вертикали (текст/кнопки заметно шире и ниже, чем должны быть у нормального десктопного окна)? Какого цвета верхний и нижний край кадра?'],
  ['/tmp/frames/f-chunk001.png', 'кадр из исходной записи chunk-001 (граф агента). Проверь: выглядит ли UI непропорционально сплюснутым по вертикали? Пропорции текста и узлов нормальные?'],
  ['/tmp/frames/f-chunk014.png', 'кадр из исходной записи chunk-014 (инспектор узла). Проверь: выглядит ли UI сплюснутым по вертикали?'],
  ['/tmp/frames/f-final30.png', 'кадр из ФИНАЛЬНОГО tacg-demo.mp4. Проверь: выглядит ли UI непропорционально сплюснутым по вертикали (текст заметно приплюснутый/широкий)?'],
  ['/tmp/frames/f-gif.png', 'кадр из tacg-demo-preview.gif. Проверь: есть ли вжатые (burned-in) субтитры/текст-подпись в нижней части кадра? Выглядит ли UI сплюснутым по вертикали?'],
]

async function main() {
  const zai = await ZAI.create()
  for (const [file, what] of FRAMES) {
    const b64 = fs.readFileSync(file).toString('base64')
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${what}\nОтветь строго JSON: {"squashed": true|false, "note": "<кратко что видишь, включая цвет краёв кадра и наличие текста-подписи>"}` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })
    const text = res?.choices?.[0]?.message?.content || ''
    console.log(`\n=== ${file} ===\n${String(text).slice(0, 500)}`)
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
