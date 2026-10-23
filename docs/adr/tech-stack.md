# Технологический стек Avizis Playground

> Тип: справочник (сводка по ADR-001…010) · Статус: актуален

| Слой | Технология | Решение |
|---|---|---|
| LLM | z-ai-web-dev-sdk (singleton, таймауты, ретраи, repair-JSON) | [ADR-001](./ADR-001-llm-sdk-wrapper.md) |
| Движок | bun + socket.io :3003, mini-service, JSON-стор истории | [ADR-002](./ADR-002-socket-io-mini-service.md) |
| Фронтенд | Next.js (App Router), React 19, Tailwind, shadcn/ui, Radix | — |
| Граф | @xyflow/react v12 (React Flow), кастомные узлы/рёбра | [ADR-004](./ADR-004-react-flow.md) |
| Состояние | zustand + детерминированный fold событий (event-sourcing) | [ADR-003](./ADR-003-event-sourcing-fold.md) |
| Тесты | scripts/test-avizis-{client,llm,decision,clarity}.ts + E2E agent-browser | — |
