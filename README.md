# TACG — Transparent Agent Computation Graph

Прототип интерактивного стенда: агент (z-ai-web-dev-sdk) выполняет задачу, пользователь
наблюдает вычисления как живой граф, вмешивается (пауза / override / выбор ветки решений)
и воспроизводит любой прогон покадрово.

## Документация

Вся документация — в [`docs/`](./docs/README.md), структура оптимизирована для агентной
разработки (папка на тип документа, индекс в каждой папке, каждый документ — отдельный файл):

| Папка | Что внутри |
|---|---|
| [`docs/prd/`](./docs/prd/) | Продуктовые требования (PRD) |
| [`docs/adr/`](./docs/adr/) | Архитектурные решения ADR-001…010 + сводка стека |
| [`docs/fr/`](./docs/fr/) | Функциональные требования FR-1xx…8xx со статусами |
| [`docs/cr/`](./docs/cr/) | Журнал изменений CR-001…005 |

## Стек

Next.js (App Router) · React 19 · @xyflow/react v12 · Tailwind · shadcn/ui · zustand ·
движок: bun + socket.io mini-service (:3003) на z-ai-web-dev-sdk · event-sourcing (RunEvent[] + fold).

## Запуск

```bash
bun install
bun run dev            # фронтенд (Next.js)
cd mini-services/tacg-agent && bun --hot index.ts   # движок агента (:3003)
```

Тесты: `bun scripts/test-tacg-{client,llm,decision,clarity}.ts` · E2E-скриншоты: `scripts/tacg-*.png`.
