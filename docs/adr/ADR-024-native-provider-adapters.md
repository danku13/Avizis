# ADR-024 — Нативные адаптеры провайдеров (Anthropic Messages API, Google Gemini generateContent)

> Статус: принято (CR-017) · Дата: 2026-10-22 · Связанные: [ADR-012](./ADR-012-byok-llm-router.md)
> (BYOK-роутер), [ADR-015](./ADR-015-token-usage.md) (usage), [ADR-023](./ADR-023-streaming-ephemeral-events.md)
> (стриминг), [FR-907](../fr/FR-900-byok.md)

## Контекст

BYOK-роутер (ADR-012) изначально говорил с провайдерами через два адаптера:
сервисный zai SDK и OpenAI-compatible диалект (`/chat/completions`). Anthropic и
Google — крупнейшие провайдеры с собственными протоколами: их «нативные» API
отличаются и транспортом (заголовки ключа, форма system-промпта, имена полей
ответа/usage), и стримингом (SSE-форматы с разными схемами дельт). Пользователи
Avizis приносят ключи этих платформ напрямую, минуя OpenAI-compatible-шлюзы;
статус «задел» (FR-907) закрывался этим решением.

## Решение

Роутер расширяется идентификаторами адаптеров `anthropic` и `google-gemini`;
протокольный слой каждого — отдельный клиент-файл, зеркалящий контракт
`openai-client.ts` (классификация ошибок, probe, стрим):

1. **Anthropic Messages API** (`anthropic-client.ts`): POST `{baseUrl}/v1/messages`,
   дефолт `https://api.anthropic.com`; ключ — `x-api-key` + `anthropic-version:
   2023-06-01`; system — отдельное поле `body.system`; ответ — `content[]`
   (склейка text-блоков); usage — `input_tokens/output_tokens`. Стрим: SSE-события
   `content_block_delta.text_delta`, usage — `message_start` (input) +
   `message_delta` (output). Проба — «ping» с `max_tokens: 16`.
2. **Google Gemini generateContent** (`gemini-client.ts`): POST
   `{baseUrl}/v1beta/models/{model}:generateContent` (стрим —
   `:streamGenerateContent?alt=sse`), дефолт
   `https://generativelanguage.googleapis.com`; ключ — `x-goog-api-key`; system —
   `systemInstruction.parts`; ответ — `candidates[0].content.parts[].text`;
   usage — `usageMetadata.promptTokenCount/candidatesTokenCount` (маппится в
   LlmUsage). Проба — «ping».

Ключевые следствия:

3. **Ретраи/ошибки** — общая конвенция: 408/429/5xx ретраебельны, прочие 4xx —
   `NonRetryableProviderError`; человекочитаемые сообщения — `describeHttpError`
   (401 = ключ, 404 = путь/baseUrl). Гейт-логика OpenRouter (openai-client)
   на нативные адаптеры не переносится — у Anthropic/Google гейтов нет.
4. **`max_tokens` Anthropic обязателен**; эвристика «opus → 4096, остальное →
   8192»: кэпы моделей различаются (старший opus — 4096), завышение ломает
   запрос 400-й. Эвристика выбирает максимум, который принимают все
   актуальные модели линейки; для экзотики — OpenRouter-диалект.
5. **Стриминг — без изменений семантики ADR-023**: оба клиента отдают Response
   с SSE, llm.ts читает их аккумуляторами; любой сбой — тихий откат на полный
   вызов (результат идентичен нестридовому пути). Пробы (save/test в
   настройках) идут нестридовым «ping» — дешёво и одинаково для всех
   ключевых адаптеров (`validateAdapter` в index.ts диспетчеризует по протоколу).
6. **Ключи**: хранение/маскирование/preserve-логика llm-config.ts обобщена
   признаком `adapterUsesApiKey` (openai-compatible | anthropic | google-gemini):
   пустое поле ключа в UI сохраняет прежний ключ того же провайдера, смена
   адаптера/переход на zai сбрасывает; env-бутстрап `AVIZIS_LLM_ADAPTER` принимает
   новые идентификаторы. Ключи живут только в `llm-config.json` (chmod 600).

## Последствия

- Единая поверхность BYOK: четыре адаптера, один роутер, роли резолвят
  провайдера по цепочке (роль → дефолт → zai); provenance в инспекторе/журнале/
  MD-отчёте называет реальный протокол (`anthropic`, `google-gemini`).
- Прайс не требует правок: каталоги OpenRouter/LiteLLM (ADR-016) уже содержат
  claude-*/gemini-*; ручная цена в конфиге перекрывает при желании.
- Тестирование без реальных ключей: мок-провайдеры повторяют протоколы
  (mock-anthropic :3098, mock-gemini :3097, canned-контракт mock-openai) —
  полные прогоны движка верифицируют доставку, стрим, usage и безопасность
  ключей; реальные платформы подключаются пользователем своим ключом.
- Новые нативные протоколы дальше (Bedrock, Vertex и т.п.) — по тому же шаблону:
  клиент-файл с контрактами openai-client + строка в диспетчеризации; без
  изменений в движке, UI и аудите.
