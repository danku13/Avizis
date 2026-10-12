#!/bin/bash
# TACG — GIF всех основных функций (16:9, БЕЗ субтитров) + превью для README.
#
# Источник — пересобранное download/tacg-demo.mp4 (1920×1080, чистая картинка,
# soft-subs не рендерятся в кадр). Окна нарезок проверены VLM-картой контента.
#
# Каждая функция = отдельный GIF 800×450, 12fps, палитровое кодирование
# (palettegen stats_mode=diff + sierra2_4a). Мульти-резки — через concat-фильтр.
#
# Карта контента видео (проверено):
#   0-12     интро (задача заполнена)
#   12-32     запуск: planning → узлы появляются
#   32-41     модалка развилки 1
#   41-51.8   выбор + активация ветки + рост
#   51.8-54.5 всплеск роста (v7-v10)
#   54.5-66.5 модалка развилки 2
#   66.5-74.7 выбор, v11-v12
#   74.7-86.9 завершение прогона 1 (метрики, граф)
#   86.9-107.9 статичный участок (в v1 мёртвый кадр)
#   107.9-127.9 задача 2: Manual→Auto, запуск, planning
#   127.9-142.2 рост плана прогона 2
#   142.2-156.2 красный узел ошибки (лимит API)
#   156.2-170.2 ошибка персистится, retry-попытки
#   170.2-184.2 инспектор упавшего узла + retry
#   184.2-201.6 успех узла + авто-развилка
#   201.6-215.9 инспектор: детали узла (HELP/IMPLEMENTATION/INTERPRETATION)
#   215.9-233.9 инспектор (Reason for adding), скраб к концу
#   233.9-245.9 финал: скраб, тост завершения, история с зелёной записью
set -e

SRC=/home/z/my-project/download/tacg-demo.mp4
OUT=/home/z/my-project/download/tacg-gifs
W=800   # 16:9 → 800×450
FPS=12
DITHER=sierra2_4a
mkdir -p "$OUT"

# make_gif <имя> <скорость> <окно1-начало> <окно1-конец> [окно2-начало> <окно2-конец> ...]
make_gif() {
  local name=$1 spd=$2
  shift 2
  local n=$(( $# / 2 ))
  local inputs=() fc="" i=0
  local chains=""
  while [ $# -ge 2 ]; do
    local s=$1 e=$2
    shift 2
    inputs+=(-ss "$s" -to "$e" -i "$SRC")
    fc+="[${i}:v]setpts=PTS/${spd},fps=${FPS},scale=${W}:-2:flags=lanczos,setsar=1[v${i}];"
    chains+="[v${i}]"
    i=$((i+1))
  done
  fc+="${chains}concat=n=${n}:v=1:a=0[cc];[cc]split[pa][pb];[pa]palettegen=stats_mode=diff[p];[pb][p]paletteuse=dither=${DITHER}"
  ffmpeg -hide_banner -loglevel error -y "${inputs[@]}" -filter_complex "$fc" -loop 0 "$OUT/${name}.gif"
  local sz=$(stat -c%s "$OUT/${name}.gif")
  printf '%-42s %6.1f КБ\n' "${name}.gif" "$(echo "$sz/1024" | awk '{printf "%.1f", $1}')"
}

# --- 9 GIF основных функций (без субтитров) ---
make_gif tacg-gif-01-launch-planning   1.25  12.5 32.0
make_gif tacg-gif-02-decision-branch   1.20  32.2 51.8
make_gif tacg-gif-03-plan-growth       1.30  127.9 142.2
make_gif tacg-gif-04-node-inspector    1.05  202 215
make_gif tacg-gif-05-timeline-replay   1.15  227 242
make_gif tacg-gif-06-auto-mode         1.25  108.5 127.9
make_gif tacg-gif-07-error-retry       1.30  145 151.5 170.5 180.5 184.5 187.5
make_gif tacg-gif-08-run-history       1.15  116 127 233.8 245.5
make_gif tacg-gif-09-completion-audit  1.05  76.5 86.9

# --- превью для README (640×360, «рост графа супервайзером», ADR-022) ---
W=640
make_gif tacg-demo-preview             1.15  127.9 141.6
mv "$OUT/tacg-demo-preview.gif" /home/z/my-project/download/tacg-demo-preview.gif
echo "превью → download/tacg-demo-preview.gif"

echo "=== итог ==="
ls -la "$OUT" /home/z/my-project/download/tacg-demo-preview.gif
