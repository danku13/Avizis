// video-understand: финальная проверка окон F (инспектор+скраб) и G (история+финал)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const CLIPS: Array<[string, string]> = [
  ['F', 'Окно 201.6-215.9с видео (после авто-развилки прогона 2). Вопросы: (1) открыта ли панель ИНСПЕКТОРА узла справа и какие секции видны (вход/вывод/причина добавления/помощь)? (2) двигается ли ползунок ТАЙМЛАЙНА внизу? (3) меняется ли ГРАФ при движении ползунка (узлы появляются/исчезают/меняют цвет)? (4) что в конце окна?'],
  ['G', 'Окно 226-246с видео (финал). Вопросы: (1) закрывается ли инспектор? (2) двигается ли ползунок таймлайна, меняется ли граф при этом? (3) появляется ли тост/сообщение о завершении? (4) меняется ли ВЫДЕЛЕНИЕ в панели истории слева (переключение прогонов)? (5) что в самом конце?'],
]

async function main() {
  const zai = await ZAI.create()
  for (const [id, ask] of CLIPS) {
    const b64 = fs.readFileSync(`/tmp/clip-${id}.mp4`).toString('base64')
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Запись экрана Avizis (тёмный UI: тулбар, слева история прогонов, центр — граф, снизу таймлайн и журнал).\n${ask}\nОтветь нумерованным списком, только видимые факты, по-русски.` },
            { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } },
          ],
        },
      ] as any,
      thinking: { type: 'disabled' },
    })
    console.log(`\n===== CLIP ${id} =====`)
    console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 1100))
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
