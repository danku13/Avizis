// Обёртка над z-ai-web-dev-sdk: singleton-инстанс, таймауты, ретраи,
// устойчивое извлечение и ремонт JSON из ответов LLM
import ZAI, { ChatMessage } from 'z-ai-web-dev-sdk'

let zaiInstance: any = null

export async function getZai(): Promise<any> {
  if (!zaiInstance) zaiInstance = await ZAI.create()
  return zaiInstance
}

const tryParse = (s: string): any | null => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Ремонт типичных ошибок LLM в JSON: незакрытый массив, висячая запятая, обрыв */
function repairJson(text: string): any | null {
  let t = text
  // «"reasoning" попал внутрь массива» — не закрыт ] перед ключом верхнего уровня
  t = t.replace(/}\s*,\s*"(?:reasoning|notes?|comment|explanation|rationale)"\s*:/i, '}],"reasoning":')
  // висячая запятая перед } или ]
  t = t.replace(/,\s*([}\]])/g, '$1')
  let fixed = tryParse(t)
  if (fixed) return fixed
  // баланс скобок: закрываем незакрытые строку/массивы/объекты в конце
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  let tail = ''
  if (inStr) tail += '"'
  while (stack.length) tail += stack.pop() === '{' ? '}' : ']'
  if (tail) {
    fixed = tryParse(t + tail)
    if (fixed) return fixed
  }
  return null
}

/** Достаёт JSON-объект из ответа LLM (учитывает ```-обёртки и лишний текст) */
export function extractJson(raw: string): any | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const candidates: string[] = []
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1))
  candidates.push(text)
  for (const c of candidates) {
    const parsed = tryParse(c)
    if (parsed) return parsed
  }
  const best = candidates[0] ?? text
  return repairJson(best)
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ])

/** Один LLM-вызов (текстовый ответ). role 'assistant' — системный промпт, согласно SDK. */
export async function chatText(system: string, user: string, timeoutMs = 90_000, retries = 1): Promise<string> {
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const zai = await getZai()
      const messages: ChatMessage[] = [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ]
      const res: any = await withTimeout(
        zai.chat.completions.create({ messages, stream: false, thinking: { type: 'disabled' } }),
        timeoutMs,
        `Таймаут LLM-запроса (${Math.round(timeoutMs / 1000)} с)`
      )
      const content = res?.choices?.[0]?.message?.content
      if (typeof content === 'string' && content.trim()) return content.trim()
      throw new Error('Пустой ответ модели')
    } catch (e: any) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 900))
    }
  }
  throw lastErr ?? new Error('Ошибка LLM')
}

/** LLM-вызов с ожиданием JSON: ретраи при неудачном парсинге ответа */
export async function chatJson(system: string, user: string, timeoutMs = 60_000, jsonRetries = 1): Promise<any | null> {
  let last: any = null
  const attempts = 1 + Math.max(0, jsonRetries)
  for (let i = 0; i < attempts; i++) {
    const raw = await chatText(system, user, timeoutMs, i === 0 ? 0 : 1)
    const parsed = extractJson(raw)
    if (parsed) return parsed
    last = raw
  }
  console.error('[tacg-llm] JSON не извлечён из ответа:', String(last || '').slice(0, 200))
  return null
}
