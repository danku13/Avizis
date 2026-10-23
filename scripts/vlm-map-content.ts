// VLM: карта контента пересобранного видео — что происходит в каждой точке таймлайна
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const TIMES = [2, 14, 30, 35, 43, 50, 53, 60, 70, 80, 90, 100, 110, 125, 135, 148, 155, 163, 177, 186, 195, 210, 225, 240]

const ASK = `Кадры из демо-видео Avizis (тёмный UI: тулбар сверху, граф агента в центре, журнал событий снизу). Кадры идут парами "метка времени → изображение". Для КАЖДОЙ метки дай ОДНУ строку строго в виде:
T<время>: <что видно: статус прогона (Planning/Running/Paused/Error/Completed?), видна ли МОДАЛКА выбора развилки, виден ли ИНСПЕКТОР узла (правая панель), виден ли ТАЙМЛАЙН с ползунком, видна ли КРАСНАЯ ошибка/упавший узел, растёт ли граф, видна ли ИСТОРИЯ прогонов (левая/верхняя панель со списком), метрики (токены/стоимость).
Отвечай по-русски, кратко, без вступлений.`

async function main() {
  const zai = await ZAI.create()
  for (let b = 0; b < 3; b++) {
    const batch = TIMES.slice(b * 8, b * 8 + 8)
    if (!batch.length) continue
    const content: any[] = [{ type: 'text', text: ASK }]
    for (const t of batch) {
      const b64 = fs.readFileSync(`/tmp/frames/c-${t}.png`).toString('base64')
      content.push({ type: 'text', text: `T${t}:` })
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } })
    }
    const res = await zai.chat.completions.createVision({
      messages: [{ role: 'user', content }] as any,
      thinking: { type: 'disabled' },
    })
    console.log(`— партия ${b + 1} —`)
    console.log(String(res?.choices?.[0]?.message?.content || '').slice(0, 2000))
  }
}
main().catch((e) => { console.error('VLM error:', e?.message || e); process.exit(1) })
