# ADR-002: Движок агента как отдельный mini-service на socket.io (порт 3003)

> Тип: ADR · Статус: принято · Контекст: старт сессии · Связанное: [CR-001](../cr/CR-001-prototype.md), [tech-stack.md](./tech-stack.md)

**Контекст.** Next.js-фронтенд уже развёрнут через Caddy-шлюз (:81). Движок — stateful:
пауза/резюм, ожидание решений пользователя, поток событий. HTTP-запросы плохо подходят
для живого потока и долгоживущих состояний.

**Решение.** `mini-services/avizis-agent/` — отдельный bun-процесс с socket.io.
API: `run:start`, `run:control`, `run:load/delete`, `node:override/retry`,
`history:list`, `decision:resolve`, `decision:mode`. События: `graph:init`, `graph:adapt`,
`node:update`, `run:status`, `log`, `run:summary`, `decision:offer/resolved/mode`.
Запуск через double-fork (переживает завершение shell-команды).

**Альтернативы.** API-роуты Next.js + polling — дублирование логики трансляции состояния;
WebRTC/gRPC — избыточно.

**Последствия.** Движок живёт независимо от hot-reload фронтенда; клиент — тонкий
сокет-клиент в `src/lib/avizis/socket.ts`. Цена: отдельный процесс для мониторинга.
