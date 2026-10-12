// Проверка устойчивости chatJson: 3 прогона парсинга плана
import ZAI from 'z-ai-web-dev-sdk'

function extractJson(raw: string): any | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const SYS = `Ты — модуль планирования ИИ-агента. Твоя задача — разбить запрос пользователя на вычислительный граф из шагов. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток и пояснений.`
const USER = `Задача пользователя: «Найди 3 главные новости недели про ИИ и сделай краткую выжимку»

Составь план из 3–5 шагов. Формат ответа:
{"nodes":[{"id":"n1","title":"...","description":"...","dependsOn":[]}],"reasoning":"..."}`

const zai = await ZAI.create()
for (let i = 1; i <= 3; i++) {
  const res: any = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: SYS },
      { role: 'user', content: USER },
    ],
    stream: false,
    thinking: { type: 'disabled' },
  })
  const content = res?.choices?.[0]?.message?.content ?? ''
  const parsed = extractJson(content)
  console.log(`прогон ${i}: длина=${content.length}, JSON ${parsed ? 'OK' : 'FAIL'}`)
  if (!parsed) {
    console.log('  ПОЛНЫЙ ОТВЕТ:', JSON.stringify(content))
  } else {
    console.log('  узлов:', Array.isArray(parsed.nodes) ? parsed.nodes.length : 'нет массива nodes')
  }
}
