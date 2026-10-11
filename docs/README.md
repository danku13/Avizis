# Документация TACG Playground

Краткая документация прототипа, созданная по итогам сессии (хронология — от старта).

| Документ | Что содержит |
|---|---|
| [PRD.md](./PRD.md) | Продукт: проблема, цели, пользователи, сценарии, метрики |
| [ADR.md](./ADR.md) | Архитектурные решения ADR-001…008 (SDK, socket.io, event-sourcing, React Flow, модалки, развилки) |
| [FR.md](./FR.md) | Функциональные требования FR-1…7 со статусами реализации |
| [CR.md](./CR.md) | Журнал изменений сессии: CR-001 прототип → CR-002 UI/React Flow → CR-003 развилки решений |

Реализация: `mini-services/tacg-agent/` (движок на z-ai-web-dev-sdk, socket.io :3003),
`src/components/tacg/` (React Flow граф, модалки инспектора/выбора, тулбар, timeline),
`src/lib/tacg/` (типы, сокет-клиент, fold), `src/store/tacg-store.ts`.
Тесты: `scripts/test-tacg-{client,llm,decision}.ts`; скриншоты E2E: `scripts/tacg-*.png`.
