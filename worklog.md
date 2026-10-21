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

---
Task ID: 6
Agent: Super Z (main agent)
Task: Исправить обрезку «…» в «Причина добавления» / «Вход» / «Выход» инспектора; реструктурировать /docs под агентную разработку (папка на тип документа + индекс + отдельные файлы)

Work Log:
- Диагностика через agent-browser + разбор runs.json: обрезка оказалась на 3 уровнях —
  (1) buildInput в engine.ts усекал выходы зависимостей до 260 симв. с «…» (49 узлов
  в сохранённых прогонах с обрезанным «Входом»); (2) LLM-поля reason/rationale/question
  жёстко резались 240/320/300 симв.; (3) вёрстка: max-h-52 (Вход) и max-h-[38vh] (Выход)
  прятали хвост текста во внутренней прокрутке
- engine.ts: buildInput хранит полные выходы зависимостей; обрезка промптов вынесена
  в llmExecute (предохранитель 12000) и супервайзер (2000, было 300); лимиты полей
  reason/description/question/rationale/reasoning 240–400 → 800 (планировщик и
  супервайзер); сводка узлов для супервайзера 110 → 400
- node-inspector.tsx: сняты капы высоты с pre Вход/Выход — полное отображение,
  прокрутка на уровне колонки модалки
- Движок перезапущен (double-fork, bun --hot, :3003); тесты: test-tacg-decision —
  все сценарии; test-tacg-clarity — 17/17; E2E: свежий прогон «Напиши пост» →
  инспектор wfin: Вход 505 симв. и Выход 395 симв. целиком (max-height:none,
  scrollHeight==clientHeight, endsEllipsis=false), 0 многоточий в новых прогонах;
  консоль 0/0; bun run lint чист; скриншоты scripts/tacg-inspector-*.png
- Реструктуризация /docs: плоские PRD/ADR/FR/CR.md (git rm) → docs/{prd,adr,fr,cr}/,
  в каждой папке index.md (таблица id/тема/статус + правила ведения), каждый документ —
  отдельный файл: prd/PRD.md (v0.4); adr/ADR-001…010 (+tech-stack.md, у ADR-005 блок
  «Обновление»); fr/FR-100…800 по блокам (+ новый FR-309 «полные тексты»); cr/CR-001…005
  (+ новый CR-005 с диагностикой и результатом); корневой docs/README.md — карта
  документации, порядок чтения, конвенции именования/нумерации/статусов для агентов
- Корневой README.md переписан из заглушки: описание стенда, ссылки на docs/, стек, запуск
- Проверка структуры: 30 md-файлов в 4 папках, скрипт проверки относительных ссылок — 0 битых

Stage Summary:
- «Причина добавления», «Вход», «Выход» выводятся полностью: без обрезки данных (движок),
  без капов высоты (вёрстка); обрезка осталась только в компактных строках журнала событий
- /docs реструктурирован для агентной разработки: 4 типовые папки с индексами, 26 файлов
  документов + 4 индекса, конвенции в docs/README.md; новые артефакты: FR-309, CR-005,
  ADR-005-обновление, PRD v0.4
- Артефакты: mini-services/tacg-agent/engine.ts, src/components/tacg/node-inspector.tsx,
  docs/**, README.md, scripts/tacg-inspector-{before,fulltext}.png

---
Task ID: 7
Agent: main (Super Z)
Task: Снять лимиты эмерджентных вопросов и жёсткие объёмные капы входов/выходов/обоснований; дисциплину перенести в промпты; вывести в чат полный реестр применённых ограничений

Work Log:
- Аудит ограничений: grep по engine.ts/llm.ts/store.ts + src/ (truncate/line-clamp/slice/MAX)
- engine.ts — лимиты количества сняты: удалены rt.dynamicAdded >= 2, dynamic-узлов >= 3,
  rt.emergentAdded < 2; askAllowed = !hasOpenDecision (последовательность, не количество)
- engine.ts — объёмные срезы сняты: task .slice(0,500), 11× .slice(0,800)
  (description/question/rationale/reason/reasoning), override-output .slice(0,4000);
  ярлыки title/label <= 60 и заголовок вопроса <= 40 сохранены (идентификация на канве)
- Промпты: EXECUTOR_SYS «до 120 слов» → гигиена контекста («минимально достаточный объём,
  без воды и повторов»); супервайзеру добавлено «количество вопросов не ограничено, но каждый
  обязан быть полезным: не дублируй закрытые»; decider «1–2 предложения» → «краткое, но
  исчерпывающее без воды»
- Компакция промптов сохранена (12000 вход исполнителя; 400/2000 контекст супервайзера) —
  это защита промптов, не данных
- UI: node-inspector.tsx + decision-modal.tsx — label вариантов перенос (break-words)
  вместо truncate
- docs: новый ADR-011 (без лимитов; дисциплина в промптах), CR-006, FR-808 переписан,
  новый FR-809, ADR-010 блок «Обновление», индексы adr/cr/fr + README v0.5
- Сервис перезапущен (kill 13766 → bun index.ts, :3003); тесты: test-tacg-decision — все
  сценарии; test-tacg-clarity — 17/17; новый scripts/test-tacg-llm-auto.ts — полный LLM-прогон
  28.7 с, 2 авто-решения, выходы до 1314 симв. (кап 800 снят); tsc мини-сервиса чист
  (кроме Bun import.meta.dir); 8 ошибок tsc в src/ (graph-canvas, React Flow) —
  преждесуществующие, подтверждено git stash
- Реестр ограничений «было/стало» выведен пользователю в чат (по прямому запросу)

Stage Summary:
- Эмерджентные вопросы не ограничены по количеству; гарды только на последовательность
  (один открытый вопрос) и структуру (варианты 2–4, шаги ветки 1–3)
- Входы/выходы/обоснования хранятся и отображаются полностью; объём регулируется промптами
  (полезность, без воды), компакция — только при сборке промптов
- Артефакты: engine.ts, node-inspector.tsx, decision-modal.tsx, docs/{adr,cr,fr}/**,
  scripts/test-tacg-llm-auto.ts, docs/README.md (v0.5)

---
Task ID: 8
Agent: Super Z (main agent)
Task: Консультация в чате: разбор структурных лимитов графа, механики «понимания задачи», предложения по BYOK

Work Log:
- Восстановлен контекст: изучены engine.ts (sanitizePlan, insertDecision, resolveDecision,
  emitCertainty, maybeAdapt), llm.ts (singleton z-ai-web-dev-sdk), demo.ts (стартовые certainty),
  src/lib/tacg/types.ts (certaintyLabel), run-toolbar.tsx (метр)
- Подтверждено: BYOK/provider-абстракции в коде нет — единственный путь LLM = z-ai-web-dev-sdk
- Пользователю в чат выдано: (1) разбор каждого структурного лимита с привязкой к строкам кода
  и последствиями (тихая усечка плана на 12 узлов, потеря зависимостей при капе 5, деградация
  развилки при <2 вариантов, лимит «2 развилки» — только промпт, кодом не enforced);
  (2) механика certainty: самооценка LLM 0..1 (планировщик/супервайзер/certaintyAfter), монотонность
  max() на решениях, пороги шкалы 0.35/0.7 в certaintyLabel; (3) предложение BYOK: LLM-роутер
  с адаптерами (zai / openai-compatible / anthropic / gemini), per-role конфиг, ключи в
  data/llm-config.json (не в runs.json!), provenance в RunSnapshot.llm, usage/cost-токены в
  инспекторе и отчёте, модалка настроек с проверкой ключа, fallback-цепочка
- Реализация BYOK не выполнялась — пользователь просил предложения («предложи доработки»)

Stage Summary:
- Ответ в чате; артефактов кода не производилось; BYOK-MVP согласован как кандидат на
  следующую итерацию (B1+B3+B4+B6: роутер openai-compatible + хранение ключей + provenance + UI)

---
Task ID: 9
Agent: Super Z (main agent)
Task: Документация как спека для двух агентных реализаций: BYOK-MVP (CR-007) и аудит усечений (CR-008); задел на вычислимую метрику (ADR-014)

Work Log:
- Изучены конвенции docs/ (README v0.5, индексы adr/fr/cr, форматы ADR-011/FR-800/CR-006)
- Написаны: ADR-012 (BYOK: LLM-роутер, адаптеры zai/openai-compatible, ключи, provenance),
  ADR-013 (аудит усечений — конец тихим потерям), ADR-014 (задел: вычислимая метрика
  понимания из состояния графа — формула-кандидат, гибрид, миграция, открытые вопросы)
- FR: новый блок FR-900-byok.md (FR-901..907; 901-906 — в реализации CR-007, 907 — задел);
  FR-600 дополнен FR-603/604 (аудит усечений, в реализации CR-008); FR-800 дополнен FR-810
  (задел на ADR-014)
- CR-007 (BYOK-MVP, Task 10-a) и CR-008 (аудит усечений, Task 10-b) — полные спеки с
  инвариантами безопасности ключей и списком тестов; результат-секции заполняются по верификации
- Обновлены индексы adr/fr/cr и docs/README.md (v0.6)
- Статусы FR честно «⬜ в реализации» до верификации агентов; переворот в ✅ — задача 11

Stage Summary:
- Спека-пакет для агентной разработки готов: 3 ADR, 1 новый FR-блок, 2 дополнения FR, 2 CR,
  индексы и README v0.6; (в) зафиксирован как ADR-014/FR-810 (задел, реализации не требует)

---
Task ID: 10-a
Agent: full-stack-developer
Task: BYOK-MVP (CR-007): LLM-роутер с адаптерами zai/openai-compatible, ключи с маскированием, provenance моделей, модалка настроек + тесты + E2E

Work Log:
- Шаг 0: прочитан worklog (задачи 1–9), спеки ADR-012/FR-900/CR-007, весь код движка и фронта
- Обнаружено: реализация BYOK уже частично существовала после прерванной сессии (llm-роутер, llm-config, settings-modal, мок, тест, скриншоты), но не верифицирована и без записи в worklog — проведена полная ревизия по спеке, все пункты сверены
- Доработки найденные при ревизии:
  1. settings-modal.tsx: баг `onClick={() => closeSettings}` (лямбда возвращала функцию вместо вызова — кнопка «Закрыть» не закрывала модалку) → `onClick={closeSettings}`; проверено E2E (модалка закрывается)
  2. llm-config.ts / test-tacg-byok.ts: import.meta.dir → `(import.meta as any).dir` (Bun-API с cast — не добавляет новых ошибок tsc)
- Перезапуск сервиса :3003 (kill → double-fork setsid, pid 21524), smoke: connected + llm:config:get → zai
- Тесты:
  - bun scripts/test-tacg-byok.ts — 13/13 ✅ (мок :3099: сохранение с валидацией пробой, повторное сохранение без ключа хранит прежний, маска sk-…4242 в llm:config:get, файл с ключом и правами 600, полный LLM-прогон через мок, snapshot.llm 4 роли openai-compatible·mock-model, node.llm у всех done-узлов, 9 запросов к моку все с Bearer и model=mock-model, runs.json без ключа, дефолт zai восстановлен, ключ из файла удалён)
  - bun scripts/test-tacg-decision.ts — все сценарии ✅ (ручной выбор/авто/переключение в авто во время ожидания)
  - bun scripts/test-tacg-clarity.ts — 17/17 ✅
  - bun scripts/test-tacg-llm-auto.ts — ✅ (реальный z-ai, 37 с, 2 авто-решения, 9 узлов — дефолтный конфиг восстановлен)
  - bun run lint — чисто; tsc — 0 новых ошибок (25 преждесуществующих: graph-canvas 8, store.ts import.meta.dir 1, старые скрипты 13, skills/examples 3)
- E2E agent-browser (:81 через Caddy):
  1. чистая загрузка: 0 ошибок / 0 варнингов консоли (React DevTools info-log не в счёт)
  2. настройки открываются: 6 пресетов (z-ai SDK/OpenAI/DeepSeek/OpenRouter/Ollama/Свой), поля baseUrl/модель/ключ(+глаз)/проверка/Collapsible «Роли» (4 input'а)
  3. пресет OpenAI подставляет baseUrl api.openai.com/v1; «Свой OpenAI-compatible» + baseUrl http://127.0.0.1:3099/v1 + mock-model + тестовый ключ → «Проверить подключение» → бейдж «подключение работает · 3 мс» → «Сохранить» → тост «Конфигурация LLM сохранена»
  4. чип тулбара «LLM: openai-compatible · mock-model» (+ aria-label на мобиле)
  5. LLM-прогон через мок завершён (100% · 4/7, статус «Завершено», журнал: «Запуск агента · LLM через openai-compatible · mock-model», «Планировщик: openai-compatible · mock-model»)
  6. инспектор узла: бейдж «Модель: mock-model · openai-compatible»
  7. MD-отчёт (перехват Blob): секция «## Модели (BYOK)» со всеми 4 ролями; ключа в отчёте нет
  8. мобильная 390px: без горизонтального скролла (scrollW=clientW=390), чистая консоль, скриншот
  9. дефолт zai восстановлен ЧЕРЕЗ UI (настройки → Дефолт: z-ai SDK → Сохранить; файл llm-config.json = {"default":{"adapter":"zai"}})
  10. скриншоты: scripts/tacg-byok-{settings,toolbar,inspector,mobile}.png
  - доп. проверки: маска-плейсхолдер ключа при повторном открытии («sk-…9999 — пусто = не менять», поле пустое — ключ не возвращается клиенту); кнопка «Закрыть» работает (фикс)
- Безопасность (финальный аудит): ключи отсутствуют в runs.json (оба тестовых), tacg.log, снапшотах, событиях, MD-отчёте, ответах API (только маска); мок-провайдер остановлен после E2E

Stage Summary:
- BYOK-MVP реализован полностью по CR-007: роутер в llm.ts (zai дефолт + openai-compatible fetch/AbortController/Bearer), llm-config.ts (хранение chmod 600, маски, env-бутстрап TACG_LLM_*, резолв роль→дефолт→zai, валидация пробой), provenance (RunSnapshot.llm 4 роли, node.llm на исполнении/autoDecide/insertNode, запись в журнал при старте планирования), socket API llm:config:get/save/test (санитайз + merge старого ключа при пустом поле), фронт (settings-modal с пресетами и per-role моделями, чип+шестерёнка в тулбаре, бейдж модели в инспекторе, секция «Модели (BYOK)» в MD-отчёте, стор с подписками)
- Артефакты: mini-services/tacg-agent/{llm.ts,llm-config.ts,engine.ts,index.ts,types.ts}, src/lib/tacg/{types.ts,fold.ts}, src/store/tacg-store.ts, src/components/tacg/{settings-modal.tsx,run-toolbar.tsx,node-inspector.tsx}, src/app/page.tsx, scripts/{mock-openai.ts,test-tacg-byok.ts}, scripts/tacg-byok-*.png
- Все регрессионные тесты зелёные, дефолт zai восстановлен, сервис :3003 работает (double-fork), known-issue: временный React Flow warning 004 при resize/Fast Refresh (на чистой загрузке отсутствует)

---
Task ID: 10-b
Agent: full-stack-developer
Task: Аудит усечений (CR-008/ADR-013): все структурные лимиты плана и адаптации логируются в журнал прогона с новым kind «limits»

Work Log:
- Шаг 0: прочитан worklog (задачи 1–10-a), спеки ADR-013/FR-600 (FR-603/604)/CR-008, весь релевантный код (engine, types, llm, llm-config, fold, event-log, mock-openai, test-tacg-byok)
- mini-services/tacg-agent/plan-sanitizer.ts (НОВЫЙ): sanitizePlan вынесен из engine.ts в чистую функцию sanitizePlanData(json) → {nodes, certainty, notes[]}; SanitizeNote {code, message} — message готовая русская строка для журнала; семантика санитайза 1:1 (cleanId с дедупом, cleanDeps, ветки-цепочки, guard от ссылок вперёд, декларация ids, fallback при nodes<2); каждое усечение — заметка: a) узлы >12 (отброшенные перечислены «id «title»»), b) необъявленные/вперёд dependsOn, c) зависимостей >5 после дедупа (со списком отброшенных), d) варианты развилки >4, e) шаги ветки >3 (на вариант), f) деградация «развилки» с <2 валидных вариантов (+ пустые/битые учтены в f); certainty распарсен и клампится, возвращается в результате; заметки детерминированы (без Date/random в сообщениях)
- engine.ts: planWithLLM → sanitizePlanData, certainty присваивается как раньше, КАЖДАЯ заметка → this.log(rt, 'limits', …) ДО записи «Планировщик LLM построил граф…» (порядок: provenance → лимиты → итог плана, до graph:init; fold log-события обрабатывает generically); insertDecision: усечение зависимостей >12 при перепривязке на хвосты веток → «Лимит адаптации: при перепривязке узла {id} зависимостей {M} — оставлены первые 12 (отброшены: …)»; maybeAdapt (ask-ветка): варианты >4 и шаги >3 → «Лимит адаптации: у вопроса супервайзера …»; title/label ≤60 и заголовок вопроса ≤40 НЕ журналируются (ADR-011 п. 5); приватный sanitizePlan удалён, импорт DecisionOption убран
- kind 'limits' в LogEntry: mini-services/tacg-agent/types.ts + src/lib/tacg/types.ts (зеркало); event-log.tsx: [лимит] text-orange-300 (отличим от план zinc / адаптации violet / контроль amber); status-badge.tsx — легенды kinds нет (только статусы узлов), не тронут; MD-экспорт run-toolbar.tsx: журнал «Хронология» generic — [limits] попадает автоматически (проверено E2E); протокол RunEvent НЕ менялся (log с новым kind, новых типов событий нет)
- scripts/test-tacg-truncation.ts (НОВЫЙ): A) юнит — сверхлимитная фикстура (15 узлов; развилка 6 вариантов × 5 шагов; узел с 7 валидными зависимостями; узел со ссылками вперёд/необъявленными; «развилка» 1 валидный + 1 пустой вариант) → все 6 типов a–f с точными N→M и id, граф 24 узла (12 top-level + 12 веток), dec2 деградировала, certainty 0.42 + клампинг 1.7→1, детерминированность повторным прогоном, компактный план → notes=[], план без nodes → null; B) интеграция — мок MOCK_MODE=oversized (свой in-process или внешний с проверкой режима), llm:config:save (sk-test-trunc-key-777), run:start «Тест усечений» auto → completion, в logs 8 записей kind='limits' («15 узлов…», «вариантов 6», «шагов 5»×4, деградация dec2, неизвестные n9), порядок provenance(#2)→первый лимит(#3)→«построил граф»(#11), граф 24 узла/n11–n13 нет, ключ не утёк (снапшот + runs.json), дефолт zai восстановлен — 31/31 ✅
- Сервис :3003 перезапущен (kill → double-fork setsid, pid 24700), smoke: connected + прогон через тесты
- Регрессия: test-tacg-decision — все сценарии ✅; test-tacg-clarity — 17/17 ✅; test-tacg-byok — 13/13 ✅; test-tacg-llm-auto — ✅ (реальный z-ai, 44.7 с, дефолтный конфиг); bun run lint — чисто; tsc — 25 ошибок = базовый уровень, новых нет
- E2E agent-browser (:81): (1) чистая загрузка: 0 ошибок/0 варнингов консоли; (2) мок MOCK_MODE=oversized в фоне; настройки через UI (шестерёнка → «Свой OpenAI-compatible», baseUrl http://127.0.0.1:3099/v1, mock-model, тестовый ключ) → «Проверить подключение» → «подключение работает · 1 мс» → «Сохранить» (тост «Конфигурация LLM сохранена»); (3) LLM-прогон «Тест усечений: проверка аудита лимитов» (авто) → журнал: 8 записей «Лимит плана:» с бейджем [лимит] (text-orange-300), порядок «Запуск» → «Планировщик: …» → лимиты → «построил граф» — скриншот scripts/tacg-trunc-journal.png; (4) playback: кадр 1 — записей нет, кадр 15 — все лимит-записи видны (свёртка log-событий); (5) MD-отчёт (перехват Blob): 8× **[limits]** в «## Хронология (полный журнал)», артефакт scripts/tacg-trunc-report.md + скриншот tacg-trunc-report.png; (6) канва: 24 узла (n11/n12/n13 отсутствуют), инспектор dec1: «развилка · 4 варианта», опции A–D по 3 шага («дальше: 1…2…3»), бейдж «Модель: mock-model · openai-compatible»; (7) мобильная 390×844: hscroll=false, скриншот tacg-trunc-mobile.png; (8) ПОСЛЕ E2E дефолт zai восстановлен ЧЕРЕЗ UI (llm-config.json = {"default":{"adapter":"zai"}}); (9) мок остановлен; known-issue React Flow warning 004 — только при resize (как в 10-a), на чистой загрузке отсутствует
- Безопасность (финальный аудит): ключа нет в runs.json, tacg.log, снапшотах, MD-отчёте, ответах API

Stage Summary:
- Реализован аудит усечений полностью по CR-008/ADR-013: ни одна структурная потеря не остаётся тихой — план (узлы >12 с перечислением отброшенных, зависимости >5, необъявленные dependsOn-ссылки, варианты >4, шаги ветки >3, деградация развилки <2 вариантов) и адаптация (перепривязка >12 зависимостей, ask-варианты >4, ask-шаги >3) логируются записями kind «limits» с N→M и id; семантика усечений не менялась — добавлена только видимость
- Наследование без изменения протокола: live-журнал (бейдж [лимит], orange), playback (fold generic), MD-отчёт (Хронология), runs.json/replay
- Артефакты: mini-services/tacg-agent/{plan-sanitizer.ts (новый), engine.ts, types.ts}, src/lib/tacg/types.ts, src/components/tacg/event-log.tsx, scripts/{test-tacg-truncation.ts (новый), tacg-trunc-{journal,report,mobile}.png, tacg-trunc-report.md}
- Все регрессионные тесты зелёные (truncation 31/31, decision, clarity 17/17, byok 13/13, llm-auto), дефолт zai восстановлен, сервис :3003 работает (pid 24700, double-fork)

---
Task ID: 11
Agent: Super Z (main agent, оркестратор)
Task: Верификация задач 10-a/10-b, финализация документации, безопасность репозитория, коммит и пуш

Work Log:
- Запущены два агента последовательно (10-a BYOK-MVP, затем 10-b аудит усечений — на инфраструктуре
  мок-провайдера от 10-a); каждый получил самодостаточную спеку + Task ID + протокол worklog
- Верификация 10-a (независимо): test-tacg-byok 13/13, test-tacg-clarity 17/17, test-tacg-decision
  — все сценарии; сервис :3003 (pid 21524→24700); права llm-config.json 600; grep: тестовый ключ
  отсутствует в runs.json/снапшотах/артефактах; worklog-запись 10-a на месте
- Верификация 10-b: test-tacg-truncation 31/31; сервис жив; ключ sk-test-trunc-key-777 в runs.json
  отсутствует; скриншоты tacg-trunc-* существуют; worklog-запись 10-b на месте
- Финализация docs: FR-901..906 → ✅ (CR-007), FR-603/604 → ✅ (CR-008), индекс fr (6/4 строки),
  CR-007/CR-008 — секции «Результат (верифицировано независимо)» с числами и честными ограничениями
- Безопасность репозитория: mini-services/tacg-agent/data/llm-config.json добавлен в .gitignore
  (файл может содержать реальные ключи; git check-ignore подтверждает)
- Git: commit (docs + код BYOK/усечений + тесты + скриншоты) и push в origin main

Stage Summary:
- Оба агентных изменения реализованы и независимо верифицированы: BYOK-MVP (роутер zai/
  openai-compatible, ключи с маскированием и chmod 600, provenance ролей и узлов, модалка настроек)
  и аудит усечений (plan-sanitizer с notes, kind 'limits', 6+3 типа потерь в журнале)
- Документация согласована с реализацией: ADR-012/013 приняты, ADR-014 — задел; FR-9xx 6/7,
  FR-6xx 4/4, FR-8xx 9+1 задел; CR-007/CR-008 с верифицированными результатами
- Тестовый парк: test-tacg-byok 13/13, test-tacg-truncation 31/31 + прежние регрессии зелёные

---
Task ID: 12
Agent: Super Z (main agent)
Task: Аудит токенов LLM (вход/выход по шагам/ролям/запуску в журнале и UI), светлая тема, разведение цветов «добавлено динамически»/«развилка решения», продуктовый документ в /docs (возможности, гипотезы рынка, VPM, 4 ЦА)

Work Log:
- Шаг 0: прочитан worklog (задачи 1–11: BYOK 10-a и аудит усечений 10-b завершены, коммит a60b23e), код движка/UI и вся документация; git status чист (модификации — режим файлов, без контента)
- Токены (ADR-015): llm.ts — extractUsage (OpenAI prompt/completion_tokens и GLM input/output_tokens), usage у zai- и openai-compatible-адаптеров, chatTextDetailed/chatJsonDetailed (JSON-usage копится по попыткам), старые функции — обёртки; types.ts ×2 — NodeUsage (node.usage), RunUsage (snapshot/view.usage), событие llm:usage, fmtTokens; engine.ts — addUsage (сводка+атрибуция+событие; исполнитель — узлу до node:update, решатель — развилке, супервайзер/планировщик — в сводку без журнального шума), хвосты «· токены: ↑N / ↓M» в журнале шагов/плана, итог в финальной записи/summary/остановке; fold.ts — аккумуляция llm:usage (totals+byRole+calls+node.usage) для live И replay
- Токены UI: чип «↑ … · ↓ … · N вызов.» в тулбаре с тултипом по ролям (fold до курсора — replay честен); строка «Токены: ↑ / ↓» в мета-гриде инспектора; MD-отчёт — секция «## Использование токенов» (таблица ролей+итог) и колонка «Токены ↑/↓» графа
- Светлая тема (FR-706): layout.tsx — bootstrap-скрипт в <head> (localStorage 'tacg-theme', дефолт тёмная, до гидрации — без всплеска); src/lib/tacg/theme.ts (useIsDark на useSyncExternalStore + toggleTheme), theme-toggle.tsx (Sun/Moon в шапке); dark:-варианты во всех TACG-компонентах; globals.css — React Flow Controls/MiniMap/атрибуция/скроллбары light+.dark; MiniMap/фон/базовые рёбра — от темы
- Цвета (FR-707): развилка fuchsia→amber («ваш ход»: карточка, пульсация, рёбра ветвей, баннер, бейджи, модалка, журнал [решение]); pending amber→цинк (план-чертёж; амбер освобождён); динамика — violet (контраст тёплый↔холодный); легенда/точки/минимапа обновлены; DOM-проверка E2E: fuchsia-рёбер 0
- Продуктовый документ: docs/product/PRODUCT-001-capabilities-market.md + index.md (новый тип документов) — инвентаризация возможностей (8 блоков) и честные ограничения; 10 фальсифицируемых гипотез (H1–H6 рынок, H7–H10 продукт: формулировка→проверка→метрика→опровержение); value proposition map по Остервальду (круг ценности / профиль клиента / таблица «боль→болеутолитель→выгода» / 2 формулировки УТП); 4 ЦА (С1 инженеры-ядро, С2 продакты, С3 консультанты-ранний доход, С4 образование-вирус) с профилями и сравнительной таблицей
- Документация кода: ADR-015 (принято), CR-009 (цитаты запроса + верифицированный результат), FR-605/706/707 + FR-204 (amber), индексы fr/adr/cr, docs/README.md v0.7 (карта + product/ + текущее состояние), футер UI v0.7
- Тесты: scripts/test-tacg-usage.ts (новый) — 13/13: unit-fold (totals/byRole/атрибуция/replay-до-курсора/пустой поток) + интеграция с моком (7 вызовов=↑700/↓140; роли 1/3/2/1; узлы n1/dec1/ba1/nfin ↑100/↓20; события=7; журнал; summary; fold=снапшот; runs.json; ключ не утёк; provenance-регрессия); регрессии: byok 13/13, truncation 31/31, decision (все сценарии), clarity 17/17; tsc 25 (= базовый), lint чист
- E2E (agent-browser, :81): чистая загрузка (0 ошибок консоли); конфиг мока через UI (проверка подключения ок); LLM-прогон авто → чип «↑ 700 · ↓ 140 · 7 вызов.», журнал, инспектор «Токены: ↑ 100 · ↓ 20»; MD (перехват Blob): «## Использование токенов», «Итого | 7 | ↑ 700 | ↓ 140», колонка узлов; загрузка из истории → чип восстановлен; 8 шагов назад → «↑ 500 · ↓ 100 · 5 вызов.»; тема: .dark снят, localStorage light, reload переживает, рёбра переключаются; цвета DOM: forkAmber+dynViolet, fuchsia 0; мобильная 390×844 без hscroll; дефолты восстановлены (zai, тёмная, мок остановлен)
- Сервис :3003 перезапущен (kill старого pid → setsid bun index.ts, лог «Движок агента TACG запущен»)

Stage Summary:
- Токены LLM стали полноправной частью аудита: событие llm:usage в потоке → счётчики видны в live, replay (до курсора), журнале, инспекторе, тулбаре и MD-отчёте; арифметика фиксирована тестом (мок 7×100/20)
- Светлая тема: переключатель + запоминание + без всплеска; весь TACG-UI и React Flow двухтемны
- Палитра разведена: развилки amber («ваш ход») vs динамика violet (максимально удалённые), ожидание — нейтральный цинк
- Новый тип документов product/ (PRODUCT-001): возможности, 10 гипотез, VPM, 4 ЦА — база для приоритизации и питчей
- Артефакты: mini-services/tacg-agent/{llm.ts, types.ts, engine.ts}, src/lib/tacg/{types.ts, fold.ts, theme.ts (новый)}, src/components/tacg/* (dark:-варианты, amber, токены), src/app/{page.tsx, layout.tsx, globals.css}, scripts/test-tacg-usage.ts (новый) + tacg-{usage-dark, usage-inspector, colors-dark, light-graph, light-persist, light-mobile}.png + tacg-usage-report.md, docs/{product/ (новый тип), adr/ADR-015, cr/CR-009, fr/FR-600|FR-700|FR-200, README.md v0.7}

---
Task ID: 13
Agent: Super Z (main agent)
Task: Сворачиваемый «Журнал событий» (максимизация графа) + эффективная шапка сайта (статус движка, тема, LLM-чип)

Work Log:
- Шаг 0: прочитан worklog (задачи 1–12), page.tsx/event-log/run-toolbar/theme-toggle/graph-canvas, FR-700/index, CR-009 (формат), README v0.7; git status — рабочее дерево чисто по контенту
- Диагностика вертикального бюджета: журнал 260px всегда виден + шапка ~61px с неэффективным подзаголовком; LlmChip занимает строку тулбара, хотя BYOK — глобальная настройка. React Flow warning 004 = «parent container needs a width and a height» (возможен при resize) — сворачивание только растит канву, риска нет
- event-log.tsx: сворачиваемый самостоятельный контейнер (обёртка убрана из page.tsx): 260px ↔ h-11 (44px), transition-[height] 200ms + motion-reduce; вся строка-заголовок — button с aria-expanded/aria-controls (таргет 44px), chevron с поворотом; состояние в localStorage 'tacg-log-collapsed' через useSyncExternalStore + подписка (паттерн theme.ts: SSR-снимок false — без рассинхрона гидратации, lint clean — изначальный useState-в-эффекте поймал react-hooks/set-state-in-effect, переписан); свёрнутый вид: live/кадр + счётчик + превью последней записи [вид] сообщение (≥md); тело остаётся в DOM (h-0, aria-hidden) — анимация без перемонтирования
- llm-chip.tsx (новый): LlmChip перенесён из run-toolbar в шапку (глобальная настройка BYOK, не свойство прогона), компакт h-7/size-7; run-toolbar.tsx — LlmChip удалён из обоих состояний (нет прогона — только подсказка; есть прогон — строка данных прогона)
- page.tsx: шапка — одна строка h-11 (~61→45px): лого size-6, заголовок text-sm, подзаголовок удалён (VLM-проверка подтвердила шум), статус движка компактный h-7 (на <sm — иконка; role=status + aria-label сохранены), LlmChip + ThemeToggle size-7; футер v0.7 → v0.8
- Верификация: lint — чисто; tsc — 30 ошибок ДО (git stash) = 30 ПОСЛЕ, все преждесуществующие (graph-canvas 8, store 1, скрипты 19, skills 2), 0 новых
- E2E agent-browser (:81, viewport 1440×900): чистая загрузка — консоль 0 ошибок/0 предупреждений; шапка 45px, статусы «LLM: z-ai SDK» + «движок: подключён», подзаголовка нет; демо-прогон (авто нет — ручной, 15 записей): канва 241px → сворачивание журнала → 44px → канва 457px (+216 = ровно 260−44); превью свёрнутого: «[решение] Режим «ручной выбор»… 15»; персистентность: reload — журнал свёрнут (44px, ls=1), консоль чистая (нет предупреждений гидратации); разворачивание — 260px, ls=0; настройки LLM открываются из шапки (шестерёнка и чип); тема — компактная кнопка работает (light/dark + localStorage); React Flow warning 004 при сворачивании НЕ возникает (консоль чистая на всех шагах); мобильная 390×844: hscroll=false, шапка 45px, журнал 44px, таргет работает; VLM-проверка 2 скриншотов (тёмный свёрнутый, мобильный): дефектов вёрстки нет
- Регрессии: test-tacg-clarity 17/17 ✅, test-tacg-decision — все сценарии ✅, test-tacg-byok 13/13 ✅, test-tacg-usage 13/13 ✅
- Документация: CR-010 (цитаты мотивации, изменения, верифицированный результат с числами), FR-708 (блок NFR: 7 ✅ + 1 ⬜ — счётчик заголовка поправлен, был устаревшим после CR-009), индексы fr/cr (+строки CR-010 в таблицы), README v0.8 (+пункт «Максимум места графу»)
- Скриншоты: scripts/tacg-{dark-collapsed,dark-expanded,light-collapsed,collapse-mobile}.png

Stage Summary:
- Журнал событий сворачивается в строку 44px (клик по заголовку, анимация, персист в localStorage, SSR-безопасно через useSyncExternalStore): граф получает +216px высоты (замер E2E 241→457px), в свёрнутом виде счётчик и превью последней записи — информация не теряется
- Шапка ужата с ~61px до 45px: подзаголовок удалён, статус движка и тема компактные; чип LLM-провайдера и шестерёнка BYOK перенесены в шапку из тулбара (глобальная настройка), тулбар отдаёт строку данным прогона
- Протокол события/движок/снапшоты не менялись — все 46 регрессионных проверок зелёные, tsc = база, консоль чистая (включая сворачивание/resize)
- Артефакты: src/components/tacg/{event-log.tsx, llm-chip.tsx (новый), run-toolbar.tsx, theme-toggle.tsx}, src/app/page.tsx, docs/{cr/CR-010 (новый), fr/FR-700 (FR-708), cr/index.md, fr/index.md, README.md v0.8}, scripts/tacg-{dark-collapsed,dark-expanded,light-collapsed,collapse-mobile}.png
---
Task ID: 20
Agent: Super Z (main agent)
Task: HD-пересборка GIF — пользователь: «GIF в telegram крайне малого разрешения, невозможно использовать, сделай полное разрешение»

Work Log:
- Диагноз: пакет Task 19 был 800×450 (W=800 в make-demo-gifs.sh) при источнике tacg-demo.mp4 1920×1080
- Пересборка (scripts/make-demo-gifs-hd.sh): W=1920, резки/скорости/12fps/палитра (stats_mode=diff + sierra2_4a) — без изменений относительно одобренного пакета; 9 функциональных GIF 4.6–9.5 МБ + превью 7 МБ, всё 1920×1080
- Верификация: ffprobe — все 10 ровно 1920×1080, полный декод без ошибок; VLM (2 кадра/GIF, vlm-verify-gifs-hd.ts) — пропорции норм везде, 3 флага «сабы» сняты прицельным промптом (vlm-recheck-subs.ts: журнал событий/тосты = UI, не субтитры)
- Релиз v0.12.0 (scripts/update-release-assets-hd.py): старые 800×450 GIF (10 шт.) удалены, HD залиты (state=uploaded у всех), mp4/srt/установщики не тронуты — итого 15 ассетов
- Telegram: текст + 10 GIF отправлены ФАЙЛАМИ (sendDocument, байт-в-байт, 1920×1080): инлайн-анимации Telegram перекодирует и даунскейлит — вероятная причина жалобы на «крошечное разрешение»; упёрлись в 429 rate-limit — докатка 07/08/09/превью с retry_after-паузами (tg-send-gifs-hd-final.sh); 03–05 продублировались при докатке (косметический дефект, API истории у ботов нет — не удаляемо)
- Инфраструктура: шлюз инструментов несколько раз падал (Bash/Write «Error calling tool»), ричер песочницы убивал фоновые процессы (nohup+setsid+disown не спасали) — работа завершена foreground-прогонами с логами в scripts/*.log

Stage Summary:
- Все 10 GIF в полном разрешении 1920×1080 (16:9, без субтитров): доставлены в Telegram файлами, заменены в релизе v0.12.0, лежат в download/tacg-gifs/ + download/tacg-demo-preview.gif
- Превью для README тоже 1080p
- Артефакты: scripts/{make-demo-gifs-hd.sh, verify-hd.sh, extract-frames-hd.sh, vlm-verify-gifs-hd.ts, vlm-recheck-subs.ts, update-release-assets-hd.py, tg-send-gifs-hd.sh, tg-send-gifs-hd-resume.sh, tg-send-gifs-hd-final.sh}, логи scripts/{vlm-hd,vlm-recheck,release-hd,tg-hd}.log
---
Task ID: 21
Agent: Super Z (main agent)
Task: «Запиши ещё одно демо видео с парой прогонов в fullhd, только проверь разрешение до записи, так же с субтитрами»

Work Log:
- Инфраструктура: git reset --hard origin/main (дерево = v0.12.0; Task 20 закрыт коммитом 69bb9ab с пушем), bun install (@tauri-apps/api), next build standalone (:3005), движок :3003 (чистая история, runs.json → .bak-rec), caddy-шлюз :8200 (XTransformPort) — все сервисы осиротевшими демонами (double-fork, PPID=1 — переживают reaper, который убивает фоновые процессы в конце каждого вызова инструмента)
- Разрешение проверено ДО записи (явное требование): viewport 1920×1080 + скриншот-верификация до старта записи, повторная live-проверка внутри первого чанка, контроль каждого чанка ffprobe — все 11 чанков ровно 1920×1080 (баг v1 с первым чанком 1280×578 исключён архитектурно)
- Запись agent-browser'ом чанками по ~20с (11 чанков, 223с сырья): интро + запуск прогона 1 (data-сценарий, решения «вручную»), развилка с выбором B «Глубокое расследование», завершение (9 узлов, +1 дин., v2), инспектор узла решения (ВХОД/ВЫХОД/ВАРИАНТЫ), replay таймлайна, прогон 2 (writing-сценарий «Напиши пост…»), развилка «формат публикации» → переключение в «Авто» прямо из модалки (демо-приём: человек вмешивается и передаёт решения агенту), рост до 16 узлов (+14 дин., v4), история: переключение между прогонами
- Найденные грабли записи: label кнопки подтверждения меняется на «Принять вариант «…»» (fallback-поиск зацепил слово «подтвердят» в описании опции A — случайный клик A отрезан монтажом: чанк1 [0→7.2], чанк2 [4→19.97]); история в snapshot: ref на родителе generic (rg -B4)
- Сборка: x264 veryfast crf20 30fps High/4.0/timescale 15360 (контент статичный — кодирование 11 сегментов за ~45с), concat, нарезки (чанк4 →10с, чанк9 →8с), soft-subs mov_text rus(default)+eng, faststart
- Субтитры: 22 реплики RU+EN; тайминги из /tmp/rec-timeline.log (реалтайм-метки всех кликов); учтён систематический сдвиг (CHUNK START логируется через 3.5с после старта записи); VLM-верификация синхронности: инспектор 53.6с ✓, закрытие модалки после «Авто» ~124-126с ✓, прогон 1 в истории 169.9с ✓
- VLM-карта 22 кадров (2/чанк): пропорции норм везде, содержимое соответствует сценарию, вжатых сабов нет
- Итог: download/tacg-demo2.mp4 — 1920×1080, 30fps, SAR 1:1, 3:03, 15.6 МБ, дорожки сабов rus(default)+eng; + tacg-demo2-{ru,en}.srt
- Telegram: текст + видео (sendVideo, streaming) + точная копия mp4 документом (байт-в-байт — Telegram-плеер не показывает soft-subs, файл для VLC) + 2 srt-файла
- Сервисы записи остановлены, история движка восстановлена из бэкапа

Stage Summary:
- Новое FullHD-демо с двумя прогонами записано и доставлено: разрешение верифицировано ДО записи и в каждом чанке (все 1920×1080, сплющивания нет)
- Субтитры по требованию: переключаемые rus/eng + внешние srt, синхронность подтверждена VLM
- Артефакты: download/tacg-demo2.mp4 + tacg-demo2-{ru,en}.srt; scripts/rec/{chunk-00..10, chunk-passive, assemble-demo2.sh, vlm-map-chunks.ts, vlm-sync-check.ts, extract-frames2.sh, loadcheck.sh, tacg-demo2-*.srt}; служебное: scripts/{start-services-hd.sh, Caddyfile-hd, build-hd.sh}, логи scripts/rec/*.log

---
Task ID: 22
Agent: Super Z (main agent, сессия web-19af3f96, пакет «продолжи projects: TACG, NarrativeFox»)
Task: Продолжение TACG по roadmap (README) и честным ограничениям PRODUCT-001 §2.2: «Streaming node outputs» / FR-907 — стриминг ответов исполнителя, чтобы узел «писал на глазах», а не «загорался и ждал целиком» (ядро позиционирования «отладчик, а не логгер»).

Work Log:
- Выбор итерации: открытые заделы FR-705 (A/B-прогоны), FR-810 (вычислимый certainty), FR-907 (стриминг + нативные адаптеры). Взят FR-907-стриминг: пункт README-Roadmap, ограничение §2.2, напрямую бьёт в H5/H10 (демо-эффект живого графа) и в момент-вмешательство (H3).
- Канон: node:stream — эфемерный снапшот (text = весь накопленный текст), только socket-канал мимо emitEvent: не пишется в events[] запуска и в runs.json — аудит-трейл, MD-отчёт и replay семантически не меняются (ADR-023, новый). Троттлинг ~350 мс на узел + обязательный flush до node:update(done).
- llm.ts: chatTextDetailedStream над обоими адаптерами — zai (stream:true → ReadableStream SSE от SDK) и openai-compatible (chatCompletionsStreamRequest: stream:true + stream_options.include_usage; гейт agentic-harness в стриминге не обходится); consumeSseStream терпим к 200-inline-error и не-JSON строкам; usage финального чанка → ADR-015. Любой сбой стриминга — тихий откат на полный вызов с гейт-циклом (результат идентичен, UI получает финальный текст одним снапшотом).
- engine.ts: emitStream (троттлинг/flush, мимо истории); llmExecute — исполнитель через chatTextDetailedStream со sink; demoExecute — стрим-симуляция canned-текста (~25-симв. куски пропорционально времени шага): эффект виден на демо-прогонах без LLM.
- Клиент: GraphNode.streamingText (эфемерное: до следующего node:update); fold.ts кейс node:stream; инспектор — блок «модель пишет… · N симв.» с живым pre и пульсом ▌; бейдж узла «пишет · N симв.»; EN-ключи (ADR-022, +2 на локаль). Живой QA вскрыл дефект первой реализации: инспектор брал узел из последнего node:update через локальный findNode и не видел стрим (бейдж графа при этом работал — фолд был правильный) — findNode переписан: стрим-снапшоты применяются к running-узлу после последнего node:update, replay-ветка не задета (в персистентной истории стримов нет).
- Тест scripts/test-tacg-stream.ts — 9/9: (A) unit-fold — снапшот задаёт streamingText, done чистит, финал свёртки не зависит от стрим-событий (детерминизм replay); (B) live через мок openai-compatible c SSE (мок расширен: 7-симв. дельты 30 мс + usage-чанк): каждый шаг получил снапшоты, последний == output, рост монотонен, usage из стрима дошёл до llm:usage (111/42 × 3) и инспектора, прогон completed; (C) демо ≥3 снапшотов на шаг; (D) node:stream отсутствует в runs.json. Данные тестов: runs.json откат к бэкапу после прогона.
- E2E live (agent-browser, 1440×900, движок :3003 + приложение :3006 — :3005 занят чужим сервисом): живой glm-прогон (LLM-режим, auto-развилки) — бейдж узла «writing · 9 chars» во время работы модели; демо-прогоны — инспектор с живым блоком: 61 DOM-сэмпл in-page поллера «the model is writing… · 24 → 72 → 120 chars» с растущим текстом и курсором, RU-локаль «модель пишет… · 72 → 120 симв.», dark-тема — блок читается; 0 ошибок страницы/консоли; tsc 54 против 55 базовых (0 новых). Скриншоты download/tacg-stream-01…05. VLM-ревью скриншотов отложено (zai vision 429 в момент прогона) — DOM-сэмплы фиксируют состояние однозначно.
- Доки: CR-016-streaming-node-outputs.md; ADR-023-streaming-ephemeral-events.md; FR-907 ✅-стриминг/⬜-адаптеры (FR-900 + индекс); CR/ADR-индексы (+строки 016/023); README (capabilities + roadmap минус выполненный пункт); PRODUCT-001 §2.2 (ограничение снято) и §-приоритеты (стриминг → закрыт, приоритет — нативные адаптеры).

Stage Summary:
- FR-907 наполовину закрыт одним витком: стриминг — ✅ (оба адаптера + fallback + демо-симуляция), нативные anthropic/gemini — задел. Ядро позиционирования («отладчик с брейкпоинтами») стало буквальным: текст решения видно в момент написания, в инспекторе и на бейдже узла.
- Аудит-инварианты целы: node:stream эфемерен (мимо runs.json/MD-отчёта/replay), токены/стоимость считаются по факту вызова, детерминизм свёртки покрыт тестом.
- Артефакты: llm.ts (стрим-слой), engine.ts (emitStream + демо-симуляция), fold.ts/findNode/инспектор/бейдж, mock-openai SSE, test-tacg-stream.ts (9/9), CR-016, ADR-023, скриншоты tacg-stream-01…05.

---
Task ID: 23
Agent: Super Z (main agent, сессия web-19af3f96, пакет «продолжи projects: TACG, NarrativeFox»)
Task: TACG CR-017 — нативные адаптеры провайдеров (вторая половина FR-907, приоритет из Task 22): Anthropic Messages API + Google Gemini generateContent поверх BYOK-роутера ADR-012.

Work Log:
- Грунтинг: llm.ts/llm-config.ts/openai-client.ts (контракты адаптера, гейт, probe), FR-900/FR-907, PRODUCT-001 §2.2 («Нет нативных адаптеров anthropic / google-gemini — задел»), ADR-012/015/023.
- anthropic-client.ts (новый): POST {baseUrl}/v1/messages (дефолт api.anthropic.com), ключ x-api-key + anthropic-version 2023-06-01, system отдельным полем; ошибки по конвенции openai-client (4xx ключа/пути → NonRetryable, 408/429/5xx — ретраебельно); стрим-SSE (content_block_delta → снапшоты, usage input из message_start + output из message_delta); extractAnthropicContent (склейка text-блоков); validateAnthropic («ping», max_tokens 16).
- gemini-client.ts (новый): POST /v1beta/models/{model}:generateContent (стрим :streamGenerateContent?alt=sse, дефолт generativelanguage.googleapis.com), ключ x-goog-api-key; systemInstruction.parts; candidates[0].content.parts[].text; usageMetadata → LlmUsage; consumeGeminiSse; validateGemini.
- llm.ts: LlmAdapterId += anthropic|google-gemini; 4 адаптерные функции (полный + стрим) и диспетчеризация callLlm/chatTextDetailedStream; max_tokens-эвристика Anthropic («opus → 4096, иначе 8192»); стриминг по ADR-023 (любой сбой — тихий откат на полный вызов), usage по ADR-015.
- llm-config.ts: whitelist ADAPTERS; adapterUsesApiKey (ключевые адаптеры) — preserve-логика пустого ключа обобщена с openai-compatible на все три; переход на zai сбрасывает ключ; env-бутстрап TACG_LLM_ADAPTER принимает новые id. index.ts: validateAdapter — диспетчеризация probe по протоколу, save/test валидируют все ключевые адаптеры (zai — без пробы, как раньше).
- UI: settings-modal — пресеты Anthropic/Google Gemini (префилл baseUrl, model-hints claude-sonnet-4-5-20250929/gemini-2.5-flash), adapterOfPreset в buildPayload, нативные плашки-примечания (протокол/заголовок ключа/стриминг CR-016/кэп 8192-4096); i18n +4 ключа на локаль (sm.nativeAnthropicNote/sm.nativeGeminiNote). Прайс без правок: каталоги OpenRouter/LiteLLM уже знают claude-*/gemini-*.
- Моки: mock-canned.ts (контракт canned-ответов, тот же NORMAL_PLAN), mock-anthropic.ts (:3098, 401 при чужом ключе, SSE message_start/delta/stop), mock-gemini.ts (:3097, 401, alt=sse, usageMetadata в финальном чанке); mock-openai /__stats += флаг stream (стрим-попытки различимы).
- test-tacg-native.ts — 30/30: юнит (экстракция/SSE/usage-маппинг/sanitize/merge/adapterUsesApiKey) + живые прогоны движка против обоих моков (probe+latency, маска ключа, полный LLM-прогон, node:stream ≥3, llm:usage ≥4, provenance ролей и узлов, ключей нет в снапшоте/runs.json, мок видел x-api-key/x-goog-api-key + max_tokens 8192/16, неверный ключ → save отклонён «неверный ключ API (HTTP 401)»); runs.json откачен после прогона.
- Сопутствующее (найдено полной регрессией): актуализация ожиданий под контракт CR-016 (исполнитель стримится и приносит usage 111/42 за вызов вместо 100/20 — тесты не обновлялись с CR-016): test-tacg-usage 700/140 → 733/206 (13/13), test-tacg-pricing $0,00315 → $0,0038925, шаги ≈$0,000697 (26/26), test-tacg-currency ₽0,307 → ₽0,38 (26/26); test-tacg-client — легаси блокировался на ручной развилке (без decisionMode) — добавлен auto, ожидание адаптаций = 1 по DEMO_ADAPTATIONS (пройден); test-tacg-openrouter-gate B4 переформулирован (нестрид-вызовы после первого — с tools; стрим-попытки исполнителя — без tools, откат ADR-023) — 14/14. Map в тестах типизирован явно: tsc 46 против базлайна 54 (0 новых, −8 пре-существующих).
- Регрессии: byok 13/13 · stream 9/9 · decision · clarity 17/17 · llm-auto · truncation 31/31 · gate 14/14 · client — все зелёные.
- E2E live (agent-browser, 1440×900, движок :3003 + next dev :3006, моки :3098/:3097): пресет Anthropic — нативная плашка, «Test connection» → «connection works · 3 ms» (probe дошёл до мока: x-api-key, max_tokens 16), Save, LLM-прогон: журнал «LLM via anthropic · claude-3-5-sonnet-mock», чип токенов ↑1080/↓360 · 9 вызов., инспектор «Model: claude-3-5-sonnet-mock · anthropic»; пресет Gemini — «connection works · 3 ms», прогон «LLM via google-gemini · gemini-2.5-flash-mock»; dark, 390px scrollWidth 390, 0 ошибок страницы. Урок: сокет приложения идёт напрямую к движку только с ?port=3003 (без него — same-origin XTransformPort-шлюз, которого нет в dev) — HMR-реконнекты роняли spinner «Testing…». Скриншоты download/tacg-native-01…11.
- Доки: CR-017-native-adapters.md; ADR-024-native-provider-adapters.md (контракты, max_tokens-эвристика, probe-диспетчеризация, шаблон для новых нативных протоколов); индексы CR/ADR (+017/+024); FR-900 FR-907 ⬜→✅ (стриминг + нативные адаптеры); FR-индекс FR-9xx ✅ 10; README (BYOK row + Roadmap − «More native model-provider adapters»); PRODUCT-001 §2.2 − ограничение, §2.1 BYOK row + нативные адаптеры.

Stage Summary:
- FR-907 закрыт полностью: BYOK-роутер говорит с Anthropic (Messages API) и Google (generateContent) их собственными протоколами — четыре адаптера, probe-валидация, стриминг исполнителя, полный аудит (provenance/токены/стоимость) без изменений семантики; ROADMAP-пункт выполнен, PRODUCT-001 честен.
- Полная регрессия снова зелёная целиком — включая актуализированные под CR-016 usage/pricing/currency/client/gate (вторая волна отложенного техдолга CR-016 закрыта).
- Артефакты: anthropic-client.ts, gemini-client.ts, llm.ts/llm-config.ts/index.ts (диспетчеризация), settings-modal+i18n, mock-canned/mock-anthropic/mock-gemini, test-tacg-native.ts (30/30), CR-017, ADR-024, скриншоты tacg-native-01…11.
- Пуш: по транзитному PAT founder'а (файл .git/pat-transit, chmod 600, credential-helper, удалить сразу).
