# CR-001 — Старт: прототип TACG на z-ai-web-dev-sdk

> Тип: CR · Task ID: 1 · Связанное: [ADR-001](../adr/ADR-001-llm-sdk-wrapper.md), [ADR-002](../adr/ADR-002-socket-io-mini-service.md), [ADR-003](../adr/ADR-003-event-sourcing-fold.md), [ADR-008](../adr/ADR-008-demo-llm-dual-mode.md)

**Мотивация.** «спланируй концепцию прототипа с использованием z-ai-web-dev-sdk
для тестирования и начинай реализацию» — проверить концепцию прозрачного графа
вычислений агента из `upload/agent_graph.md`.

**Изменения.**
- Создан mini-service `mini-services/tacg-agent/` (types, llm, demo, engine, store, index):
  планировщик → пошаговое выполнение → супервайзер-адаптация; пауза/стоп/резюм;
  override с пересчётом потомков; retry; история прогонов.
- Фронтенд: SVG-DAG канва, инспектор узла (правая колонка), тулбар, event-log,
  history-panel, timeline, zustand-стор, socket-клиент, fold событий.
- Тесты: `test-tacg-client.ts` (демо), `test-tacg-llm.ts` (реальный SDK).

**Результат.** Работающий стенд: живой граф + вмешательство + воспроизведение.
Исправлены при этом: graph:init не заполнял run.nodes; LLM-«reasoning» внутри массива
nodes (repair-JSON + ретраи); пауза не эмитила статус; прогресс считал skipped как done.
