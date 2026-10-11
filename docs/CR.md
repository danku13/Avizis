# CR — Журнал изменений сессии (TACG Playground)

> Change Requests по ходу сессии: мотивация → содержание → результат.
> Хронологический порядок, соответствует Task ID из worklog.

---

## CR-001 (Task 1) — Старт: прототип TACG на z-ai-web-dev-sdk

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

---

## CR-002 (Task 2) — Вёрстка на всю ширину + React Flow + модалка инспектора

**Мотивация.** «поправь вёрстку на ширину экрана и используй react flow. открывай
Инспектор узла как модалку не менее чем на 50% ширины экрана для лучшей читаемости» —
граф зажат, инспектор узкий, самописный SVG-DAG дороже сопровождать.

**Изменения.**
- Установлен `@xyflow/react@12.12.0`; `graph-canvas.tsx` переписан на React Flow
  (кастомная карточка-узел, smoothstep-рёбра с кодировкой, Controls, MiniMap, Background,
  авто-fitView; узлы не перетаскиваются/не соединяются/не удаляются).
- `node-inspector.tsx` → `NodeInspectorModal` (Dialog): 55–64vw (≥50%), 86dvh,
  2 колонки (мета / вход-выход), подвал с override/retry.
- `page.tsx`: app-shell на всю ширину (lg:h-dvh, без прокрутки страницы), канва
  flex-1 + absolute inset-0; правая колонка инспектора удалена; EventLog фикс. высоты.
- globals.css: тёмная тема React Flow.
- Пакет исправлений: ScrollArea в HistoryPanel раздувался → div overflow-y-auto;
  EventLog сжимал канву → фикс. высота обёртки; мобильная канва схлопывалась →
  absolute inset-0; SelectTrigger переполнял 390px → короткие подписи; Radix
  «Missing Description» → sr-only; позиция MiniMap/атрибуции.

**Результат.** Полноэкранная вёрстка, зум/пан/fitView, модалка 64vw ≥ 50%; все прежние
сценарии (live, адаптация, override, playback, история) сохранены; консоль чистая.

---

## CR-003 (Task 3) — Ветвления решений: «авто» / «ручной выбор» + мгновенная визуализация

**Мотивация.** «мне сейчас нехватает детализации там, где агент мог рассуждая принимать
одно из нескольких решений, при этом решение может влиять на финальный результат.
Я хочу видеть эти ветки и иметь возможность выбирать режим типа "авто"... или "ручной
выбор"... если выбор меняет набор дальнейших шагов, то требуется сразу визуализация».

**Изменения.**
- Модель: узел `kind='decision'` + `DecisionState`; варианты (label, rationale,
  nextSteps); все ветки в плане как цепочки с `branchOf`; итог зависит от хвостов веток.
- Движок: reasoning-фаза → offer; manual — ожидание на promise (`pendingDecision`),
  auto — `autoDecide` (демо-скрипт или LLM DECIDER); `resolveDecision` мгновенно гасит
  sibling-ветки (`discarded`); `setDecisionMode` на ходу (в т.ч. «агент решит сейчас»);
  stop/deleteRun — rollback; зависимости от discarded удовлетворены; прогресс по
  активным узлам.
- События/аудит: `decision:offer / decision:resolved / decision:mode`, лог kind
  'decision', секция «Развилки и решения» в MD-отчёте.
- UI: карточка-развилка (GitFork, fuchsia-пульс «ждёт вашего выбора», статус-строки),
  чипы веток A/B/C; `decision-modal.tsx` (≥50vw): вопрос, карточки вариантов с
  обоснованием и превью «дальше: …», «Принять вариант», тумблер Вручную/Авто; авто-открытие
  на offer; баннер ожидания в тулбаре; инспектор развилки (вопрос/варианты/кто решил/
  обоснование); event-log и status-badge дополнены; селект режима при запуске.
- Демо-сценарий: развилка «стратегия проверки аномалий» — A статистика / B глубокое
  расследование (2 шага) / C запрос у владельца; итог зависит от стратегии.

**Результат.** Развилки видны как ветки графа; в «ручном» агент ждёт пользователя,
в «авто» решает сам и показывает рассуждение; выбор мгновенно меняет набор дальнейших
шагов (гашение веток + пересчёт пути к итогу); playback показывает ветки до и после
решения. Тест `test-tacg-decision.ts` — 3 сценария пройдены; E2E без ошибок консоли.

---

## Сводка объёма изменений по CR

| CR | Файлы (осн.) | Тесты |
|---|---|---|
| CR-001 | mini-services/tacg-agent/*, src/{lib,store,components}/tacg/*, src/app/page.tsx | test-tacg-client, test-tacg-llm |
| CR-002 | graph-canvas.tsx (React Flow), node-inspector.tsx (модалка), page.tsx, globals.css | E2E agent-browser (desktop+mobile) |
| CR-003 | types.ts ×2, demo.ts, engine.ts, index.ts, fold.ts, store, graph-canvas, decision-modal.tsx (new), run-toolbar, node-inspector, history-panel, event-log, status-badge, page.tsx | test-tacg-decision, E2E agent-browser |
