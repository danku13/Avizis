# CR-017 — Нативные адаптеры провайдеров: Anthropic Messages API + Google Gemini generateContent

> Дата: 2026-10-22 · Статус: ✅ завершено · ADR: [ADR-024](../adr/ADR-024-native-provider-adapters.md) ·
> FR: [FR-907](../fr/FR-900-byok.md) (вторая половина — нативные адаптеры; стриминг закрыт в CR-016)

## Запрос

> Продолжение по README-Roadmap («More native model-provider adapters») и честному
> ограничению PRODUCT-001 §2.2: «Нет нативных адаптеров anthropic / google-gemini
> (FR-907 — задел)». Приоритет зафиксирован в Task 22: «стриминг → закрыт,
> приоритет — нативные адаптеры». BYOK-роутер (ADR-012) говорил с любым
> провайдером только через OpenAI-compatible диалект; собственные протоколы
> Anthropic и Google — самые частые запросы инженеров-пользователей.

## Что сделано

1. **`anthropic-client.ts`** (новый): POST `{baseUrl}/v1/messages` (дефолт
   `https://api.anthropic.com`), ключ — заголовок `x-api-key` + `anthropic-version:
   2023-06-01`, system — отдельное поле `body.system`, а не сообщение. Ошибки
   классифицируются по паттерну openai-client: 408/429/5xx — ретраебельны,
   прочие 4xx — `NonRetryableProviderError` (внешние ретраи llm.ts пропускают).
   Стриминг: SSE `message_start → content_block_delta(text_delta) →
   message_delta(usage) → message_stop`; `consumeAnthropicSse` копит текст,
   usage — `input_tokens` из message_start + `output_tokens` из message_delta.
   Проба `validateAnthropic` — «ping» с `max_tokens: 16`.
2. **`gemini-client.ts`** (новый): POST `{baseUrl}/v1beta/models/{model}:generateContent`
   (стриминг — `:streamGenerateContent?alt=sse`; дефолт
   `https://generativelanguage.googleapis.com`), ключ — заголовок `x-goog-api-key`.
   system — `systemInstruction.parts`; ответ — `candidates[0].content.parts[].text`
   (склейка частей); usage — `usageMetadata.promptTokenCount/candidatesTokenCount`
   (маппинг в LlmUsage). Стрим: текстовые дельты per-чанк, `usageMetadata` —
   в финальном чанке. Проба `validateGemini`.
3. **Роутер (`llm.ts`)**: `LlmAdapterId` += `anthropic | google-gemini`; четыре
   адаптерные функции (полный вызов + стрим на каждый протокол) и диспетчеризация
   в `callLlm`/`chatTextDetailedStream`. Anthropic `max_tokens` обязателен —
   эвристика «opus → 4096, остальное → 8192» (кэпы моделей различаются, ADR-024 §4).
   Стриминг работает по ADR-023 (снапшоты, троттлинг, откат на полный вызов при
   любом сбое); токены/стоимость — по факту вызова (ADR-015).
4. **Конфиг (`llm-config.ts` + `index.ts`)**: whitelist адаптеров расширен;
   сохранение ключа при пустом поле (маска-плейсхолдер UI) — теперь для всех
   ключевых адаптеров (`adapterUsesApiKey`: openai-compatible/anthropic/google-gemini),
   переход на zai сбрасывает ключ; env-бутстрап `AVIZIS_LLM_ADAPTER` принимает
   новые идентификаторы; save/test валидируются probe — `validateAdapter`
   диспетчеризует по протоколу (zai — без пробы, как раньше).
5. **UI настроек**: пресеты «Anthropic» (`https://api.anthropic.com`, подсказка
   `claude-sonnet-4-5-20250929`) и «Google Gemini» (`https://generativelanguage.googleapis.com`,
   подсказка `gemini-2.5-flash`); нативные заметки-плашки (протокол, заголовок
   ключа, стриминг CR-016, кэп вывода 8192/4096) — RU/EN (+4 ключа на локаль);
   `detectPreset` узнаёт пресет по baseUrl; прайс-ключ — нормализованное имя
   модели (каталоги OpenRouter/LiteLLM уже содержат claude-*/gemini-* — ручная
   цена не обязательна).
6. **Моки для тестов**: `mock-canned.ts` (контракт canned-ответов mock-openai),
   `mock-anthropic.ts` (:3098, Messages API: 401 при чужом ключе, SSE-стрим),
   `mock-gemini.ts` (:3097, generateContent: 401, alt=sse-стрим); mock-openai
   получил флаг `stream` в /__stats (стрим-попытки исполнителя различимы —
   B4-контракт гейта, см. ниже).

## Тесты

- `scripts/test-avizis-native.ts` — 30/30: (A) юнит — экстракция content/parts,
  SSE-аккумуляторы (снапшоты, usage), sanitize/merge/adapterUsesApiKey;
  (B) живые прогоны через движок против обоих моков: probe-валидация с latency,
  маска ключа в llm:config, полный LLM-прогон (7 узлов), стриминг исполнителя
  (node:stream ≥3, llm:usage ≥4), provenance всех 4 ролей и узлов, ключ
  отсутствует в снапшоте и runs.json, мок видел x-api-key/x-goog-api-key и
  max_tokens=8192 (чат) + 16 (проба), неверный ключ → save отклонён с
  человекочитаемым «неверный ключ API (HTTP 401)».
- Регрессии: byok 13/13 · stream 9/9 · decision ✅ · clarity 17/17 · llm-auto ✅ ·
  truncation 31/31 · openrouter-gate 14/14 · **usage 13/13 · pricing 26/26 ·
  currency 26/26 · client ✅** (последние четыре — актуализация ожиданий под
  контракт CR-016: исполнитель стримится и приносит usage 111/42 за вызов
  вместо 100/20; client-легаси блокировался на ручной развилке — добавлен
  `decisionMode: 'auto'`, ожидание адаптаций = 1 по DEMO_ADAPTATIONS; gate-B4
  переформулирован: нестрид-вызовы после первого — с tools, стрим-попытки
  исполнителя — без tools с откатом ADR-023). tsc: 46 ошибок против базлайна 54
  (0 новых, −8: типизация Map в тестах починила и пре-существующие ошибки блоков).
- E2E live (agent-browser, 1440×900, движок :3003 + приложение :3006/?port=3003,
  моки :3098/:3097): пресет Anthropic — нативная плашка, префилл baseUrl,
  «Test connection» → «connection works · 3 ms» (probe дошёл до мока:
  x-api-key, max_tokens 16), Save; LLM-прогон: журнал «LLM via anthropic ·
  claude-3-5-sonnet-mock», чип «↑1080 / ↓360 · 9 вызов.», инспектор узла
  «Model: claude-3-5-sonnet-mock · anthropic»; пресет Gemini — та же цепочка
  («connection works · 3 ms», прогон «LLM via google-gemini · gemini-2.5-flash-mock»);
  dark-тема, 390px scrollWidth 390, 0 ошибок страницы. Скриншоты
  `download/avizis-native-01…11`.

## Результат

- FR-907 закрыт полностью: стриминг (CR-016) + нативные адаптеры anthropic /
  google-gemini (CR-017). README Roadmap — пункт «More native model-provider
  adapters» выполнен (собственные протоколы Anthropic и Google); PRODUCT-001
  §2.2 — ограничение снято.
- Инварианты аудита целы: ключи только в llm-config.json (chmod 600) и маске
  UI; runs.json/снапшоты/MD-отчёт без ключей; токены/стоимость — по факту
  вызова (usage из стрима или полного ответа, каталоги прайсов уже знают
  claude-*/gemini-*); probe-валидация не даёт сохранить нерабочий провайдер.
- Сопутствующее: актуализированы ожидания usage/pricing/currency/client/gate
  тестов под контракт CR-016 (стало зелёным всё семейство регрессий);
  mock-openai /__stats различает стрим-запросы.
