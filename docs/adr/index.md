# ADR — индекс архитектурных решений

> Формат: контекст → решение → альтернативы → последствия.
> Нумерация хронологическая, не переиспользуется. Все статусы: **принято**.

| # | Документ | Тема | Дата (сессия) |
|---|---|---|---|
| 001 | [ADR-001-llm-sdk-wrapper.md](./ADR-001-llm-sdk-wrapper.md) | LLM через z-ai-web-dev-sdk + repair-парсер JSON | старт |
| 002 | [ADR-002-socket-io-mini-service.md](./ADR-002-socket-io-mini-service.md) | Движок — mini-service на socket.io :3003 | старт |
| 003 | [ADR-003-event-sourcing-fold.md](./ADR-003-event-sourcing-fold.md) | Event-sourcing: RunEvent[] + fold на клиенте | старт |
| 004 | [ADR-004-react-flow.md](./ADR-004-react-flow.md) | React Flow v12 для визуализации графа | CR-002 |
| 005 | [ADR-005-inspector-modal-50vw.md](./ADR-005-inspector-modal-50vw.md) | Инспектор узла — модалка ≥50vw | CR-002 |
| 006 | [ADR-006-branch-decision-model.md](./ADR-006-branch-decision-model.md) | Развилки: все ветки в плане, `discarded` у непринятых | CR-003 |
| 007 | [ADR-007-auto-manual-decision-modes.md](./ADR-007-auto-manual-decision-modes.md) | Режимы «авто»/«ручной», переключение на ходу | CR-003 |
| 008 | [ADR-008-demo-llm-dual-mode.md](./ADR-008-demo-llm-dual-mode.md) | Двойной режим движка demo/llm | старт |
| 009 | [ADR-009-mixed-selection-certainty.md](./ADR-009-mixed-selection-certainty.md) | Mixed-выбор + certainty (метр понимания) | CR-004 |
| 010 | [ADR-010-emergent-decisions.md](./ADR-010-emergent-decisions.md) | Эмерджентные развилки по ходу выполнения | CR-004 |
| 011 | [ADR-011-unbounded-questions-soft-volumes.md](./ADR-011-unbounded-questions-soft-volumes.md) | Без лимитов на вопросы и объёмы; дисциплина — в промптах | CR-006 |
| 012 | [ADR-012-byok-llm-router.md](./ADR-012-byok-llm-router.md) | BYOK: LLM-роутер, адаптеры zai/openai-compatible, ключи, provenance | CR-007 |
| 013 | [ADR-013-truncation-audit.md](./ADR-013-truncation-audit.md) | Аудит усечений структурных лимитов (конец «тихим потерям») | CR-008 |
| 014 | [ADR-014-computable-certainty.md](./ADR-014-computable-certainty.md) | **задел**: вычислимая метрика понимания из состояния графа | — |
| 015 | [ADR-015-token-usage.md](./ADR-015-token-usage.md) | Аудит использования токенов через событийный поток (llm:usage) | CR-009 |
| — | [tech-stack.md](./tech-stack.md) | Сводка технологического стека | — |

## Правила ведения

- Новое решение = новый файл `ADR-NNN-slug.md` + строка в этой таблице.
- ADR не переписывается задним числом; уточнения — блоком «**Обновление.**» в конце файла.
- Если решение отменяет предыдущее — новый ADR со ссылкой на отменяемый.
- Статус по умолчанию «принято»; «задел» — зафиксированное направление без обязательства
  реализации (ADR-014).
