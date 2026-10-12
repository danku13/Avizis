# CR — индекс журнала изменений

> Формат записи: мотивация (цитата запроса) → изменения → результат.
> Хронологический порядок; номер CR соответствует Task ID из worklog.

| # | Документ | Тема | Task ID |
|---|---|---|---|
| 001 | [CR-001-prototype.md](./CR-001-prototype.md) | Старт: прототип TACG на z-ai-web-dev-sdk | 1 |
| 002 | [CR-002-fullwidth-reactflow-inspector-modal.md](./CR-002-fullwidth-reactflow-inspector-modal.md) | Вёрстка на всю ширину + React Flow + модалка инспектора | 2 |
| 003 | [CR-003-decision-branches.md](./CR-003-decision-branches.md) | Ветвления решений: авто/ручной + мгновенная визуализация | 3 |
| 004 | [CR-004-clarity-agent.md](./CR-004-clarity-agent.md) | Уточняющий агент: вопросы, домены, метр понимания, mixed | 5 |
| 005 | [CR-005-full-texts-and-docs-restructure.md](./CR-005-full-texts-and-docs-restructure.md) | Полные тексты инспектора + реструктуризация /docs | 6 |
| 006 | [CR-006-unbounded-questions-soft-limits.md](./CR-006-unbounded-questions-soft-limits.md) | Снятие лимитов вопросов/объёмов, промпт-дисциплина | 7 |
| 007 | [CR-007-byok-mvp.md](./CR-007-byok-mvp.md) | BYOK-MVP: роутер LLM, ключи, provenance, UI настроек | 10-a |
| 008 | [CR-008-truncation-audit.md](./CR-008-truncation-audit.md) | Аудит усечений структурных лимитов | 10-b |
| 009 | [CR-009-tokens-theme-colors.md](./CR-009-tokens-theme-colors.md) | Токены по шагам/ролям/запуску, светлая тема, разведение цветов + PRODUCT-001 | 12 |
| 010 | [CR-010-collapsible-log-compact-header.md](./CR-010-collapsible-log-compact-header.md) | Сворачиваемый журнал (максимум графа) + компактная шапка с LLM-чипом | 13 |
| 011 | [CR-011-pricing-cost.md](./CR-011-pricing-cost.md) | Стоимость прогонов в $ (динамический прайсинг) + однофайловые exe (ADR-017) | 14 |

## Сводка объёма изменений

| CR | Файлы (осн.) | Тесты |
|---|---|---|
| CR-001 | mini-services/tacg-agent/*, src/{lib,store,components}/tacg/*, src/app/page.tsx | test-tacg-client, test-tacg-llm |
| CR-002 | graph-canvas.tsx (React Flow), node-inspector.tsx (модалка), page.tsx, globals.css | E2E agent-browser (desktop+mobile) |
| CR-003 | types.ts ×2, demo.ts, engine.ts, index.ts, fold.ts, store, graph-canvas, decision-modal.tsx (new), run-toolbar, node-inspector, history-panel, event-log, status-badge, page.tsx | test-tacg-decision, E2E |
| CR-004 | types.ts ×2, demo.ts (writing), engine.ts, index.ts, fold.ts, types (хелперы), decision-modal, run-toolbar, graph-canvas, node-inspector, history-panel, page.tsx | test-tacg-clarity (17/17), test-tacg-decision, E2E |
| CR-005 | engine.ts (тексты без обрезки), node-inspector.tsx (без капов), docs/** (реструктуризация) | test-tacg-decision, test-tacg-clarity, E2E инспектора |
| CR-006 | engine.ts (лимиты и срезы сняты, промпты), node-inspector.tsx, decision-modal.tsx (label без truncate), docs/ADR-011, CR-006, FR-808/809 | tsc мини-сервиса, test-tacg-decision, test-tacg-clarity 17/17, test-tacg-llm-auto (новый) |
| CR-007 | llm.ts (роутер), llm-config.ts (новый), engine.ts (роли+provenance), index.ts, types.ts ×2, fold.ts, store, settings-modal.tsx (новый), run-toolbar, node-inspector, page.tsx, mock-openai.ts (новый) | test-tacg-byok 13/13 (новый), decision, clarity, llm-auto, E2E |
| CR-008 | plan-sanitizer.ts (новый, чистая функция+notes), engine.ts (логирование усечений), types.ts ×2 (kind limits), event-log.tsx, test-tacg-truncation.ts (новый) | test-tacg-truncation 31/31 (новый), decision, clarity, byok, llm-auto, E2E |
| CR-009 | llm.ts (usage), types.ts ×2, engine.ts, fold.ts, theme.ts (новый), theme-toggle.tsx (новый), все TACG-компоненты (light-варианты, amber, токены), layout.tsx, globals.css, page.tsx, test-tacg-usage.ts (новый), docs/product/ (новый) | test-tacg-usage 13/13 (новый), byok, truncation, decision, clarity, llm-auto, E2E |
| CR-010 | event-log.tsx (сворачиваемый контейнер, useSyncExternalStore), llm-chip.tsx (новый, из тулбара в шапку), page.tsx (компактная шапка h-11), run-toolbar.tsx (−LlmChip), theme-toggle.tsx (size-7) | E2E agent-browser (замеры высот: шапка 45px, канва +216px), clarity 17/17, decision, byok 13/13, usage 13/13, tsc = база |
| CR-011 | pricing.ts (новый), data-dir.ts (новый), llm-config.ts (pricing.models), engine.ts (addUsage cost + хвосты), index.ts (pricing-сокеты), types.ts ×2, fold.ts, store.ts, run-toolbar/node-inspector/settings-modal.tsx, tacg-store, page.tsx, scripts/{test-tacg-pricing.ts, build-executables.sh} (новые) | test-tacg-pricing 26/26 (новый), usage 13/13, byok 13/13, truncation 31/31, clarity 17/17, decision, E2E (чип/инспектор/MD/настройки/VLM), сборка+запуск exe 4 таргета, tsc = база |
| CR-012 | currency.ts (новый), index.ts/llm-config.ts/data-dir.ts (движок: env-контракт сайдкара + currency.rates), socket.ts (3 режима), types.ts/store.ts (валюта UI), run-toolbar/node-inspector/settings-modal (₽ в чипе/инспекторе/настройках+MD), src-tauri/ (новый: main.rs ~130 строк, tauri.conf.json ✓ схема v2, icons), .github/workflows/desktop.yml + release-notes.md, scripts/{test-tacg-currency.ts 26/26 (новый), serve-static.ts, make-icons.py} | регрессии: byok 13/13 · clarity 17/17 · usage 13/13 · pricing 26/26 · truncation 31/31 · decision; E2E статики ?port= (чип ₽0,263, инспектор, MD-отчёт с курсом, источники ЦБ/er-api живые, консоль 0); compile:engine:win → PE32+ 94МБ; workflow ждёт scope workflow (шаблон docs/ci/) |

## Правила ведения

- Новая правка по запросу пользователя/ревью = новый файл `CR-NNN-slug.md` + строка здесь.
- Мотивация — цитата из запроса (сохраняет исходный язык пользователя).
- Результат — проверяемое утверждение (тест/E2E/скриншот), не «сделано».
