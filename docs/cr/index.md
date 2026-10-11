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

## Сводка объёма изменений

| CR | Файлы (осн.) | Тесты |
|---|---|---|
| CR-001 | mini-services/tacg-agent/*, src/{lib,store,components}/tacg/*, src/app/page.tsx | test-tacg-client, test-tacg-llm |
| CR-002 | graph-canvas.tsx (React Flow), node-inspector.tsx (модалка), page.tsx, globals.css | E2E agent-browser (desktop+mobile) |
| CR-003 | types.ts ×2, demo.ts, engine.ts, index.ts, fold.ts, store, graph-canvas, decision-modal.tsx (new), run-toolbar, node-inspector, history-panel, event-log, status-badge, page.tsx | test-tacg-decision, E2E |
| CR-004 | types.ts ×2, demo.ts (writing), engine.ts, index.ts, fold.ts, types (хелперы), decision-modal, run-toolbar, graph-canvas, node-inspector, history-panel, page.tsx | test-tacg-clarity (17/17), test-tacg-decision, E2E |
| CR-005 | engine.ts (тексты без обрезки), node-inspector.tsx (без капов), docs/** (реструктуризация) | test-tacg-decision, test-tacg-clarity, E2E инспектора |
| CR-006 | engine.ts (лимиты и срезы сняты, промпты), node-inspector.tsx, decision-modal.tsx (label без truncate), docs/ADR-011, CR-006, FR-808/809 | tsc мини-сервиса, test-tacg-decision, test-tacg-clarity 17/17, test-tacg-llm-auto (новый) |

## Правила ведения

- Новая правка по запросу пользователя/ревью = новый файл `CR-NNN-slug.md` + строка здесь.
- Мотивация — цитата из запроса (сохраняет исходный язык пользователя).
- Результат — проверяемое утверждение (тест/E2E/скриншот), не «сделано».
