# Worklog

---
Task ID: 1
Agent: Super Z (main agent)
Task: Спроектировать и реализовать прототип TACG (Transparent Agent Computation Graph) для тестирования концепции с использованием z-ai-web-dev-sdk

Work Log:
- Изучил продукт-документ `upload/agent_graph.md` (концепция TACG: живой граф, прозрачность, вмешательство, воспроизводимость)
- Загрузил skill fullstack-dev, инициализировал окружение, проверил z-ai-web-dev-sdk тестовым LLM-вызовом
- Спроектировал архитектуру: мини-сервис движка агента (socket.io :3003) + фронтенд Next.js
- Реализован мини-сервис `mini-services/tacg-agent/`:
  - `types.ts` — типы (GraphNode, RunEvent, RunSnapshot, LogEntry)
  - `llm.ts` — обёртка z-ai-web-dev-sdk (singleton, таймауты, ретраи, ремонт LLM-JSON: незакрытые массивы, висячие запятые, обрывы)
  - `demo.ts` — детерминированный сценарий по мотивам сценария №1 документа (3 узла → +2 динамических → 3 версии)
  - `engine.ts` — цикл выполнения: планирование → пошаговое выполнение → супервайзер-адаптация → пауза/стоп/резюме → override с пересчётом потомков → retry ошибочных узлов
  - `store.ts` — история прогонов (память + JSON-файл, debounce)
  - `index.ts` — socket.io API (run:start/control/load/delete, node:override/retry, history:list)
- Фронтенд:
  - `src/lib/tacg/` — types, socket-клиент (XTransformPort=3003), fold (свёртка событий для live и replay)
  - `src/store/tacg-store.ts` — zustand-стор с курсором воспроизведения
  - `src/components/tacg/` — graph-canvas (SVG DAG, слоевой layout, пан/зум, цветовая кодировка, пульсация), node-inspector (вход/выход/причина/override/retry), run-toolbar (статус/прогресс/контроль/чипы версий/экспорт MD-отчёта), event-log, history-panel, timeline (скраббинг, play, Live)
  - `src/app/page.tsx` — композиция, layout.tsx — ru/dark/sonner, globals.css — анимации
- Тесты (scripts/): test-tacg-client.ts (демо: 2 адаптации, пауза, override с пересчётом 4 потомков — ПРОЙДЕН), test-tacg-llm.ts (LLM-режим: план+выполнение+итог — ПРОЙДЕН), debug-скрипты парсинга
- Найденные и исправленные баги: graph:init не заполнял run.nodes (прогон завершался мгновенно); LLM помещал "reasoning" внутрь массива nodes (добавлен repairJson + ретраи парсинга); пауза не эмитила статус мгновенно (перенос pushStatus в control()); прогресс считал skipped как выполненные
- E2E через Agent Browser (порт :81 через Caddy-шлюз): рендер, демо-прогон до конца, инспектор (причина динамического узла), чипы v1/v2/v3 (3↔5 узлов), playback+Live, override (пересчёт), пауза/резюм/стоп, экспорт отчёта (файл скачан, содержимое корректно), LLM-режим в браузере, mobile 390px (column), 0 ошибок консоли
- bun run lint — чисто; dev.log без ошибок; сервис перезапущен после hot-reload-сбоя, smoke-тест пройден

Stage Summary:
- Готов работающий прототип TACG Playground: живой граф агента с адаптацией, вмешательством и воспроизведением
- Движок агента на z-ai-web-dev-sdk: планировщик, исполнитель, супервайзер (3 LLM-роли) + демо-режим
- Все режимы из концепции проверены E2E: прозрачность (инспектор), контроль (пауза/стоп/override), воспроизводимость (timeline, версии, экспорт аудита)
- Артефакты: mini-services/tacg-agent/*, src/lib/tacg/*, src/store/tacg-store.ts, src/components/tacg/*, src/app/page.tsx; скриншоты scripts/tacg-*.png
