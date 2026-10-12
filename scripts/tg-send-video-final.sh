#!/bin/bash
# TACG — Telegram-доставка финала Task 19: текст + видео + 10 GIF (по протоколу сессии)
set -e
BOT='8655788498:AAFYPzWx19rI-CIsgJ54NpXaPUwOljCOq9E'
CHAT='274002630'
DL=/home/z/my-project/download

# 1) текстовое саммари (с URL репозитория как ссылкой сессии)
cat > /tmp/tg-final.txt << 'MSG'
Демо-видео и GIF — исправлено (github.com/danku13/TACG)

Причина сплющивания: первый 20-секундный чанк записи был снят в окне 1280x578, остальные — 1920x1080; при склейке контейнер взял размер первого сегмента, и весь ролик сжался до 2.21:1. Вдобавок в финал были ошибочно вжаты английские субтитры.

Сделано:
- Видео пересобрано в 1920x1080: интро — лёттербоксом (без искажения), тайминг 245.9с сохранён, .srt-субтитры в синхроне; вжатых сабов больше нет — только переключаемые soft-subs eng/rus
- 9 GIF всех основных функций, 16:9, без субтитров: запуск и планирование, развилка и выбор ветки, рост плана, инспектор узла, скраб таймлайна, авто-режим, ошибка и retry, история прогонов, завершение с метриками
- Превью для README пересобрано (тоже 16:9, без сабов)
- Релиз v0.12.0: ассеты заменены, GIF добавлены — итого 15 ассетов
  github.com/danku13/TACG/releases/tag/v0.12.0

Видео и GIF отправляю следующими сообщениями.
MSG
python3 /home/z/my-project/scripts/tg-send.py /tmp/tg-final.txt

# 2) видео
curl -s -F "chat_id=$CHAT" \
  -F "video=@$DL/tacg-demo.mp4;type=video/mp4" \
  -F "caption=Демо-видео TACG — 1920×1080, пропорции исправлены, субтитры переключаемые (eng/rus)" \
  "https://api.telegram.org/bot$BOT/sendVideo" | head -c 200; echo

# 3) девять функциональных GIF + превью
send_gif() {
  curl -s -F "chat_id=$CHAT" \
    -F "animation=@$1;type=image/gif" \
    -F "caption=$2" \
    "https://api.telegram.org/bot$BOT/sendAnimation" | head -c 120; echo
}
send_gif "$DL/tacg-gifs/tacg-gif-01-launch-planning.gif"  "1/9 — Запуск: задача → план → граф"
send_gif "$DL/tacg-gifs/tacg-gif-02-decision-branch.gif"  "2/9 — Развилка и выбор ветки"
send_gif "$DL/tacg-gifs/tacg-gif-03-plan-growth.gif"      "3/9 — Динамический рост плана"
send_gif "$DL/tacg-gifs/tacg-gif-04-node-inspector.gif"   "4/9 — Инспектор узла"
send_gif "$DL/tacg-gifs/tacg-gif-05-timeline-replay.gif"  "5/9 — Скраб таймлайна (replay)"
send_gif "$DL/tacg-gifs/tacg-gif-06-auto-mode.gif"        "6/9 — Авто-режим решений"
send_gif "$DL/tacg-gifs/tacg-gif-07-error-retry.gif"      "7/9 — Ошибка API и retry из инспектора"
send_gif "$DL/tacg-gifs/tacg-gif-08-run-history.gif"      "8/9 — История прогонов"
send_gif "$DL/tacg-gifs/tacg-gif-09-completion-audit.gif" "9/9 — Завершение: метрики и аудит"
send_gif "$DL/tacg-demo-preview.gif"                      "Превью для README (12с, рост графа)"

echo "=== Telegram: доставка завершена ==="
