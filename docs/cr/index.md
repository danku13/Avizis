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
| 012 | [CR-012-tauri-desktop-currency.md](./CR-012-tauri-desktop-currency.md) | Десктоп Tauri v2 + конвертация валюты (ЦБ РФ) | 15 |
| 013 | [CR-013-openrouter-gate-launch-feedback.md](./CR-013-openrouter-gate-launch-feedback.md) | Гейт OpenRouter agentic + мгновенная обратная связь запуска | 16 |
| 014 | [CR-014-github-releases-autoupdate.md](./CR-014-github-releases-autoupdate.md) | Автообновление по GitHub Releases + полноценный portable | 17 |
| 015 | [CR-015-i18n-bilingual.md](./CR-015-i18n-bilingual.md) | Двуязычность RU/EN (UI ⇄ язык прогона) + демо-видео с субтитрами | 18 |
| 016 | [CR-016-streaming-node-outputs.md](./CR-016-streaming-node-outputs.md) | Стриминг выхода исполнителя: node:stream-снапшоты (эфемерные, ADR-023), оба адаптера, демо-симуляция | 22 |
| 017 | [CR-017-native-adapters.md](./CR-017-native-adapters.md) | Нативные адаптеры anthropic Messages API + google-gemini generateContent (ADR-024): пресеты, probe, стриминг, актуализация регрессий под контракт CR-016 | 23 |

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
| CR-013 | openai-client.ts (новый: гейт + tools + NonRetryable), llm.ts (адаптер через общий клиент, tool_calls), llm-config.ts (validateProvider → openai-client), engine.ts (history:list при создании прогона, reason у run:status), types.ts ×2 (reason), index.ts (импорт), tacg-store (оптимистичный инсерт + live-метрики истории), page.tsx (тост ошибки, planning в GraphCanvas), graph-canvas (состояние «Агент работает…»), run-toolbar/status-badge (реальная модель в бейдже/MD), mock-openai.ts (режимы agentic-gate/agentic-inline/reject-429/MOCK_DELAY_MS, toolsCount в stats), scripts/test-tacg-openrouter-gate.ts (новый) | test-tacg-openrouter-gate 14/14 (новый); регрессии: byok 13/13 · clarity 17/17 · usage 13/13 · truncation 31/31 · pricing 26/26 · currency 26/26 · decision · llm-auto; E2E статики: «Агент работает…», история при старте, прогон через гейт completed (7 вызовов с tools), переключение на новый запуск, ошибка → статус+тост, консоль 0; tsc = база, lint чист |
| CR-014 | src-tauri/updater-core/ (новый крейт: версии, разбор релиза, план подмены, fs-операции + тесты 11/11), src-tauri/src/updater.rs (новый: check_updates/apply_update, прогресс update:progress, swap+relaunch), main.rs (модуль, invoke_handler, cleanup *.old), Cargo.toml (+updater-core/reqwest/serde), tauri.conf.json v0.11.0, updater.ts (новый: invoke/listen + мок ?update-mock=1), update-badge.tsx (новый: авто-чек, тост, прогресс, ручная проверка), page.tsx (бейдж в футере, v0.11.0), desktop.yml (README в portable zip), release-notes.md v0.11.0, scripts/test-tacg-updater.ts (новый) | cargo test updater-core 11/11; живой GitHub API парсинг ok; test-tacg-updater 5/5; E2E ?update-mock=1: тост, бейдж, прогресс 50%→100%, «перезапускаем», web-режим без бейджа, мобильная без hscroll, консоль 0; регрессии byok 13/13 · usage 13/13 · currency 26/26; tsc = база, lint чист |
| CR-015 | i18n-ru/i18n-en/i18n.ts (новые, ~430 ключей + стор + useT/tNow), language-toggle.tsx (новый), все TACG-компоненты (перевод), layout.tsx (<html lang>), demo-i18n-en.ts (новый: EN-зеркало сценариев), demo.ts (lang-параметры всех экспортов), engine.ts (rt.lang ведёт журналы/статусы/summary/ошибки управления, runUsageNote, uiLang у start), i18n.ts движка (новый: detectLang/L/promptLangSuffix), index.ts (locale в handshake → engine.start), socket.ts (locale в query), history-panel.tsx (задача следует за языком UI), scripts/{make-demo-video.sh, video-rec-loop.sh} (новые), download/tacg-demo.mp4 (+soft-subs eng/rus) + srt ×2 + preview.gif, test-tacg-openrouter-gate.ts (рестор конфига через API) | decision · llm-auto · updater 5/5 · openrouter-gate 14/14 · byok 13/13 · clarity 17/17 · usage 13/13 · truncation 31/31 · pricing 26/26 · currency 26/26; E2E статики: EN-прогон (граф+журнал+модалка EN), RU-прогон, персист локали, мобильная без hscroll, консоль 0; ffprobe: h264+mov_text eng(default)/rus |

## Правила ведения

- Новая правка по запросу пользователя/ревью = новый файл `CR-NNN-slug.md` + строка здесь.
- Мотивация — цитата из запроса (сохраняет исходный язык пользователя).
- Результат — проверяемое утверждение (тест/E2E/скриншот), не «сделано».
