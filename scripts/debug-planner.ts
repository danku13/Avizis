// Отладка сырого ответа планировщика LLM
import ZAI from 'z-ai-web-dev-sdk'

const SYS = `Ты — модуль планирования ИИ-агента. Твоя задача — разбить запрос пользователя на вычислительный граф из шагов. Отвечай ТОЛЬКО валидным JSON без markdown-обёрток и пояснений.`

const USER = `Задача пользователя: «Составь короткий обзор трёх самых популярных языков программирования 2026 года»

Составь план из 3–5 шагов. Формат ответа:
{"nodes":[{"id":"n1","title":"краткое название шага","description":"что делает шаг, 1-2 предложения","dependsOn":[]}],"reasoning":"одна строка о логике плана"}

Правила:
- Названия и описания шагов — на русском языке.
- Первый узел имеет пустой dependsOn.
- dependsOn ссылается только на id уже объявленных узлов.
- Граф простой: цепочка или максимум одно ветвление.
- Последний узел — формирование итогового результата.`

const zai = await ZAI.create()
const res: any = await zai.chat.completions.create({
  messages: [
    { role: 'assistant', content: SYS },
    { role: 'user', content: USER },
  ],
  stream: false,
  thinking: { type: 'disabled' },
})
const content = res?.choices?.[0]?.message?.content
console.log('=== RAW ===')
console.log(JSON.stringify(content))
console.log('=== END ===')
