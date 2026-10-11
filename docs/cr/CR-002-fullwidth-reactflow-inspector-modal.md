# CR-002 — Вёрстка на всю ширину + React Flow + модалка инспектора

> Тип: CR · Task ID: 2 · Связанное: [ADR-004](../adr/ADR-004-react-flow.md), [ADR-005](../adr/ADR-005-inspector-modal-50vw.md), [FR-700](../fr/FR-700-nfr.md)

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
