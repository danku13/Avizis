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

---
Task ID: 2
Agent: Super Z (main agent)
Task: Правка вёрстки на ширину экрана + перевод графа на React Flow + Инспектор узла как модалка ≥50% ширины экрана

Work Log:
- Установлен @xyflow/react@12.12.0 (React Flow v12, совместим с React 19)
- Переписан src/components/tacg/graph-canvas.tsx на React Flow:
  - кастомный узел 'tacg' (HTML-карточка: цветовая полоска статуса, бейджи v2/изм., пульсация running, dashed-рамка для динамических)
  - слоевой layout (колонка = глубина зависимости) → позиции RF-узлов, сигнатура формы для авто-fitView при добавлении узлов
  - рёбра smoothstep с маркерами и цветовой кодировкой (cyan+animated для running, violet для динамических, emerald для done)
  - Controls (Zoom In/Out/Fit View) + MiniMap (тёмная, pannable/zoomable) + Background Dots
  - выделение через store (selected), клик по узлу → onSelect → модалка, клик по фону → снятие выделения
  - nodesDraggable/nodesConnectable=false, deleteKeyCode=null (защита от удаления узлов)
- node-inspector.tsx → NodeInspectorModal (shadcn Dialog):
  - ширина sm:55vw / lg:58vw / xl:64vw (≥50% экрана), высота 86dvh, на мобиле ~92vw
  - 2 колонки: слева мета (описание, причина, ошибка, тайминги, чипы зависимостей-ссылок), справа Вход/Выход
  - подвал: Переопределить результат / Повторить узел / подсказка Esc
- page.tsx: вёрстка на всю ширину экрана (убран max-w-[1600px]):
  - app-shell: lg:h-dvh + overflow-hidden, header/footer на всю ширину, без прокрутки страницы на десктопе
  - граф занимает всё доступное пространство по ширине и высоте (flex-1 + absolute inset-0)
  - правая колонка инспектора удалена (теперь модалка), EventLog зафиксирован h-[260px]
- globals.css: тёмная тема React Flow (Controls, MiniMap, атрибуция), удалён edge-flow (RF animated)
- Найденные и исправленные баги:
  1. Radix ScrollArea в HistoryPanel: display:table-обёртка раздувалась до 591px из-за nowrap truncate-текста → клики по карточкам истории попадали в область графа. Заменён на обычный div overflow-y-auto
  2. EventLog растянулся до 525px (ScrollArea h-52 flex-1 без ограничения высоты в app-shell) → канва графа сжималась до 227px. Фикс: обёртка flex h-[260px] flex-col
  3. Мобильная раскладка: канва схлопывалась до 2px (h-full не резолвится в flex-item с высотой только от min-height) → GraphCanvas корень absolute inset-0 + relative на обёртке
  4. SelectTrigger (w-fit + whitespace-nowrap) переполнял 390px: сокращены подписи режимов («Демо · симуляция», «LLM · z-ai-web-dev-sdk»)
  5. Radix Dialog warning «Missing Description» → убран ручной aria-describedby, оставлен sr-only DialogDescription
  6. Attribution React Flow: показывается (лицензионно корректно), стилизована в тёмной палитре, MiniMap поднята на bottom:34
- E2E через Agent Browser (порт :81): рендер RF (5 узлов/4 ребра), открытие прогона из истории, модалка 64% ширины (≥50%), Esc/клик-по-фону закрывают, override через модалку (1 узел «изм.», 2 потомка ×2 пересчитаны), playback v1/v2/v3 (4 узла на v2), notice о недоступности вмешательства, zoom-кнопки, мобильная 390px (без горизонтального скролла, канва 380px, модалка 92vw), 0 ошибок и 0 варнингов в консоли после чистой загрузки, bun run lint чисто

Stage Summary:
- Граф переведён на React Flow v12: пан/зум/fitView/MiniMap/Controls из коробки, кастомные узлы сохраняют визуальный язык прототипа
- Инспектор узла — модалка 55-64vw с 2-колоночной раскладкой (мета слева, вход/выход справа)
- Вёрстка на всю ширину экрана: app-shell без прокрутки на десктопе, граф занимает всё свободное пространство
- Все прежние сценарии работают: live-прогон, адаптация, override с пересчётом, playback, история

---
Task ID: 3
Agent: Super Z (main agent)
Task: Ветвления решений: развилки в рассуждениях агента с режимами «авто»/«ручной выбор» и мгновенной визуализацией веток

Work Log:
- Спроектирована концепция decision-узлов: узел-развилка (kind='decision') с вопросом и 2-3 вариантами
  (label, rationale, nextSteps-превью); все ветки существуют в плане как параллельные цепочки (branchOf),
  итоговый узел зависит от хвостов всех веток
- Типы (types.ts, зеркало фронт/бэк): NodeStatus + 'discarded', DecisionOption, DecisionState
  (question/options/status pending-offered-resolved/chosen/chosenBy/reasoning), GraphNode + kind/decision/branchOf,
  LogEntry kind + 'decision', RunEvent + decision:offer/decision:resolved/decision:mode, RunSnapshot + decisionMode
- Демо-сценарий (demo.ts): развилка «стратегия проверки аномалий» с 3 вариантами (A стат.проверка / B глубокое
  расследование из 2 шагов / C запрос контекста у владельца), узлы b1a/b1b/b2b/b1c, итог n3 зависит от всех хвостов;
  DEMO_AUTO_PICK (агент выбирает B с обоснованием); outputs веток и итога зависят от выбранной стратегии; d2-адаптация
  убрана (роль проверки теперь у веток), d1 (валидация) сохранена
- Движок (engine.ts):
  - handleDecisionNode: фаза рассуждения (пауза с уважением stop/pause) → offer (node:update + decision:offer) →
    manual: waitForDecision (promise в rt.pendingDecision, движок «замер»), auto: autoDecide → resolveDecision
  - resolveDecision: узел done + output, decision.resolved (chosen/chosenBy/reasoning), МГНОВЕННОЕ гашение
    sibling-веток (status='discarded', node:update на каждую), decision:resolved, лог аудита
  - setDecisionMode: смена режима на ходу (decision:mode + лог); если ожидается выбор и включили «авто» —
    агент решает немедленно (promise резолвится выбором агента); control stop/deleteRun разблокируют ожидание (null → rollback узла)
  - nextReadyNode: зависимость от 'discarded' узла считается удовлетворённой; recalcProgress считает только активные узлы;
    overrideNode не воскрешает погашенные ветки; rollbackDecision возвращает развилку в очередь при остановке
  - LLM: планировщик просит ОДНУ развилку (JSON с decision.options[].steps), sanitizePlan нормализует ids/ветки
    (cleanId/cleanDeps, ветки цепочками от развилки, guard от ссылок вперёд); DECIDER_SYS + autoDecide
    (JSON {optionId, reasoning}, fallback на первый вариант)
- Socket API (index.ts): run:start + decisionMode; decision:resolve (выбор пользователя), decision:mode (смена режима)
- Фронтенд:
  - fold.ts: RunView + decisionMode, обработка decision-событий, findOfferedDecision (развилка в ожидании),
    timelineTicks + decision-события
  - store: decisionMode (обновляется из decision:mode/run:created/run:snapshot), decisionDismissed (модалка
    закрыта вручную — не авто-открывается до нового offer), openDecision/dismissDecision
  - graph-canvas: карточка-развилка (GitFork, fuchsia-рамка+пульс в ожидании, статусные строки «агент
    рассуждает…»/«ждёт вашего выбора»/«агент выбирает…»/«выбрано: label · агент|вы»), чипы веток A/B/C
    (sky/fuchsia/orange), 'discarded' = полупрозрачная серая карта «ветка не выбрана», рёбра: к веткам —
    пунктир fuchsia до выбора, emerald для выбранной, серый тихий пунктир для нереализованных; клик по
    ожидающей развилке открывает модалку выбора (не инспектор); MiniMap развилки — fuchsia
  - decision-modal.tsx (НОВЫЙ): Диалог 55-64vw (≥50%): вопрос, карточки вариантов (чип буквы, label,
    rationale, превью «дальше: 1. … 2. …»), выбор+«Принять вариант», тумблер Вручную/Авто в подвале
    (переключение в «авто» во время ожидания — агент решает за пользователя), auto-open на decision:offer,
    закрытие скрывает окно не отменяя ожидание; lint-фиксы: derived-state вместо setState-in-effect, fold без memo
  - run-toolbar: тумблер «Решения: вручную/Авто» (синхрон с движком через decision:mode), баннер
    «Агент ждёт вашего решения — Открыть выбор» при ожидании, секция «Развилки и решения» в MD-отчёте
  - node-inspector: секция развилки (вопрос, все варианты с chosen-выделением, «Решение принял: агент|пользователь»,
    блок «Рассуждение агента»/«Обоснование»), бейджи «развилка · N варианта» и «ветка X», кнопка «Открыть выбор варианта»
  - history-panel: селект «Решения: вручную/авто» при запуске; event-log: kind 'решение' (fuchsia);
    status-badge: легенда + «Развилка решения» и «Ветка не выбрана»; page: DecisionModal, waitingDecisionId
    для кликов по графу, обработчики decision:resolve:result/decision:mode:result; v0.3 в футере
- Тест scripts/test-tacg-decision.ts — ПРОЙДЕН (3 сценария): ручной выбор (ветка a done, b/c discarded,
  итог по быстрой стратегии), авто (агент выбрал b с reasoning), переключение в «авто» во время ожидания
  (resolved by=agent)
- E2E через Agent Browser (:81): рендер, авто-открытие модалки на развилке (64% ширины), выбор B →
  2 ветки погашены («ветка не выбрана»), карточка «выбрано: Глубокое расследование · вы», инспектор
  развилки (вопрос/варианты/выбран/обоснование), авто-режим («· агент»), playback v1: все ветки видны
  как ожидающие (погашено 0), мобильная 390px без горизонтального скролла, 0 ошибок и 0 варнингов консоли,
  bun run lint чисто
- Инфраструктура: сервис tacg-agent перезапущен через double-fork (bash -c '(setsid … &)') — переживает
  завершение команды Bash-инструмента

Stage Summary:
- Агент «рассуждая» доходит до развилок: предлагает варианты с обоснованием и превью шагов
- Режим «авто»: агент выбирает сам (демо-скрипт или LLM-вызов DECIDER_SYS), обоснование видно
  в карточке/инспекторе/журнале/отчёте; режим «ручной выбор»: модалка ≥50vw, движок ждёт
- Переключение режима на ходу, в т.ч. прерывание ожидания переводом в «авто»
- Выбор мгновенно меняет набор шагов: выбранная ветка активна, альтернативы гаснут («не реализовано»),
  итог зависит от стратегии; всё в event-stream → playback показывает ветки до и после решения
- Артефакты: mini-services/tacg-agent/{types,demo,engine,index}.ts, src/lib/tacg/{types,fold}.ts,
  src/store/tacg-store.ts, src/components/tacg/{graph-canvas,decision-modal,run-toolbar,node-inspector,
  event-log,status-badge,history-panel}.tsx, src/app/page.tsx, scripts/test-tacg-decision.ts

---
Task ID: 4
Agent: Super Z (main agent)
Task: Создать /docs (PRD, ADR, FR, CR — кратко, от старта сессии) и запушить репозиторий в github.com/danku13/TACG

Work Log:
- Восстановлён контекст сессии из worklog (Task 1: прототип TACG; Task 2: React Flow + модалка ≥50vw + полноширинная вёрстка; Task 3: развилки решений авто/ручной + мгновенная визуализация)
- Аудит репозитория перед пушем: 151 tracked-файл, .git 7.6M, .log/.next/node_modules не трекаются, .env безопасен (локальный sqlite-путь), db/custom.db 24KB
- Создан /docs:
  - PRD.md — проблема, продукт, цели/не-цели, пользователи, 6 ключевых сценариев, функциональные блоки, метрики, риски
  - ADR.md — 8 решений: ADR-001 SDK-обёртка с repair-JSON, ADR-002 mini-service socket.io :3003, ADR-003 event-sourcing fold, ADR-004 React Flow v12, ADR-005 модалка инспектора ≥50vw, ADR-006 модель развилок (branchOf + discarded), ADR-007 режимы авто/ручной с переключением на ходу, ADR-008 demo/llm двойной режим; сводка стека
  - FR.md — FR-1..7 (запуск/режимы, живой граф, инспектор, развилки, воспроизведение, история, нефункциональные) со статусами ✅
  - CR.md — CR-001 (прототип) → CR-002 (вёрстка/RF/модалка) → CR-003 (ветвления решений), мотивация→изменения→результат + сводка объёма
  - README.md — индекс документации
- Git: добавлен remote origin (PAT в URL для последующих пушей), fetch, merge origin/main (unrelated histories — заглушка README), коммит docs (c6fd628), push main; докоммичен обновлённый runs.json (f7ad958); рабочее дерево чистое
- Пуш верифицирован: remote main = f7ad958, ls-remote подтверждает

Stage Summary:
- Документация сессии сохранена в /docs (PRD/ADR/FR/CR + индекс README)
- Весь проект TACG Playground отправлен в github.com/danku13/TACG (main, история с сохранением исходного remote-коммита)
- PAT встроен в remote URL (origin) — последующие пуши работают напрямую

---
Task ID: 5
Agent: Super Z (main agent)
Task: Уточняющий агент: анализ каждого шага на потребность решений, доменные вопросы (продукт/архитектура/тон/формат), метр «понимания задачи», смешанные решения

Work Log:
- Типы (зеркало бэк/фронт): DecisionDomain (scope/specialization/product/architecture/tone/format/context/strategy),
  DecisionState + selection 'single'|'mixed', chosen → string[], domain, certaintyAfter;
  RunSnapshot.certainty; RunEvent: decision:resolved.optionIds[], новое run:certainty
- Движок (engine.ts):
  - resolveDecision(optionIds[]): валидация unknown-id, single-обрезка до 1; активны ВСЕ выбранные
    ветки, прочие гаснут; вывод «Смешанное решение агента/пользователя: «X» + «Y»»
  - emitCertainty(): публикация самооценки понимания (старт / после каждого решения max(cur, certaintyAfter) / супервайзер)
  - insertDecision(): эмерджентная развилка — узел-вопрос + ветки + перепривязка pending-узлов
    с якоря на хвосты веток (итог ждёт только реализованные)
  - maybeAdapt: демо-сценарий writing — 3 скриптованные вставки (afterAny, одноразовые);
    LLM-супервайзер — режим ask (question+options+domain+selection+certaintyAfter), лимиты ≤2 и не при
    открытой развилке; certainty от супервайзера (Δ>0.05)
  - autoDecide: демо — DEMO_WRITING_AUTO_PICKS по id развилки (decf:a, decb:[a,b], dect:b);
    LLM — mixed-промпт {optionIds[], reasoning}, нормализация одиночных/массивов
  - Планировщик LLM: certainty в ответе + domain/selection/certaintyAfter развилки; sanitizePlan
    (домены из белого списка, clamp 0..1, опции до 4)
- Демо (demo.ts): сценарий «Напиши пост» (детект /пост|стать|текст|напиши|write…/): w1 → wfin +
  3 эмерджентных вопроса: формат (single, a-короткий/b-лонгрид/c-серия), блоки контента
  (MIXED, 4 варианта: кейс/статистика/история/CTA), тон (single, 3 варианта);
  certainty 0.2→0.45→0.75→0.95; demoOutput для всех веток + итог, собранный из параметров
- Socket (index.ts): decision:resolve принимает optionIds[] (совместимость со строкой/optionId)
- Фронтенд:
  - fold: run:certainty → RunView.certainty; types: chosenIds()/selectionMode()/certaintyLabel()/
    DECISION_DOMAIN_LABELS; нормализация старых прогонов (chosen-строка → массив)
  - decision-modal: multi-select toggle (mixed), бейджи домена и «смешанный выбор», чипы
    «в составе», кнопка «Принять смешанное решение (N)», подвал «понимание: X% → ~Y%», d-стиль
  - run-toolbar: метр «Понимание задачи» (Compass, цвет по диапазону, чип «ждёт уточнений: N»,
    tooltip с hint), отчёт MD: домены, mixed-итоги («a + b»), строка certainty
  - graph-canvas: «смешанное: A + B» в статус-строке карточки, «ждёт выбора (можно несколько)»,
    рёбра по массиву chosen
  - node-inspector: «Домен уточнения: …», бейджи «в составе», «смешанное решение «a + b»»
  - history-panel: placeholder с подсказкой про текстовый сценарий; page.tsx: v0.4
- Тесты: test-tacg-decision переведён на массивы — 4/4; НОВЫЙ test-tacg-clarity — 17/17
  (эмерджентные вопросы, mixed-выбор пользователя и агента, single-guard, certainty-цепочка,
  итог из параметров); test-tacg-llm — ПРОЙДЕН (планировщик сам строит развилку, супервайзер добавляет узлы)
- Инфраструктура: движок перезапущен (double-fork), отладочный прогон (debug-auto-writing) —
  полный цикл 25.4с; найден и исправлен баг теста (certainty 0.95 ждётся ПОСЛЕ summary, а
  событие приходит раньше — сверка переведена на снапшот)
- E2E agent-browser (:81): текстовый демо-прогон вручную: модалка формата (single) → лонгрид →
  модалка блоков (mixed, 4 варианта, «Выберите один или несколько») → выбор A+B → «Принять
  смешанное решение (2)» → модалка тона (домен «Tone of voice») → финал; метр понимания
  20%→45%→75%→95% «Узкий вектор» (meter aria-valuenow=95); карточка «смешанное: Кейс клиента +
  Статистика и цифры»; инспектор (Домен «Объём работ», «в составе» ×2, «смешанное решение «a + b»»);
  журнал переоценок; мобильная 390×844 без горизонтального скролла; чистая загрузка: консоль 0
  ошибок / 0 предупреждений; bun run lint чист

Stage Summary:
- Агент анализирует каждый шаг и вставляет эмерджентные вопросы-развилки (динамические узлы с
  ветками и причиной) — и в демо-сценарии «Напиши пост», и в LLM-режиме (супервайзер ask)
- Вопросы доменные: формат/tone/скоуп для текстов; продуктовые/архитектурные — в LLM-промптах
- Метр «понимания задачи»: certainty 0..1, качественная шкала (Размытый вектор/Вектор сужается/
  Узкий вектор), чип открытых уточнений, история переоценок в аудите
- Смешанные решения: mixed-развилки допускают multi-select (пользователь и агент); выбранные
  ветки реализуются вместе, альтернативы гаснут мгновенно; итог собирается из всех параметров
- Документация обновлена: CR-004, FR-8, ADR-009/010, PRD (сценарий 7)
- Артефакты: mini-services/tacg-agent/{types,demo,engine,index}.ts, src/lib/tacg/{types,fold}.ts,
  src/components/tacg/{decision-modal,run-toolbar,graph-canvas,node-inspector,history-panel}.tsx,
  scripts/test-tacg-clarity.ts, скриншоты scripts/tacg-clarity-*.png
