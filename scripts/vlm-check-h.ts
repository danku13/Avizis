// video-understand: chunk-016 — есть ли взаимодействие с историей прогонов
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

async function main() {
  const zai = await ZAI.create()
  const b64 = fs.readFileSync('/tmp/clip-H.mp4').toString('base64')
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Неиспользованный 20-секундный кусок записи экрана Avizis. Вопросы:
(1) Что происходит в панели ИСТОРИИ прогонов слева — сколько записей, какая подсвечена, происходит ли КЛИК/переключение между записями?
(2) Что в центре — загружается ли граф СТАРОГО прогона (playback/режим просмотра), меняются ли узлы?
(3) Двигается ли ползунок таймлайна внизу? В какую сторону?
(4) Есть ли живые действия (курсор, клики, анимации) или всё статично?
Ответь нумерованным списком, по-русски, только видимые факты.`,
          },
          { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } },
        ],
      },
    ] as any,
    thinking: { type: 'disabled' },
  })
  console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 1200))
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
