#!/bin/bash
# TACG — GIF всех основных функций в ПОЛНОМ разрешении 1920×1080 (16:9, БЕЗ субтитров).
#
# Причина пересборки (Task 20): предыдущий пакет GIF (Task 19) был 800×450 —
# пользователь сообщил, что это «крайне малое разрешение, невозможно использовать».
#
# Источник — download/tacg-demo.mp4 (1920×1080, 30fps, чистая картинка: soft-subs
# в кадр не рендерятся). Окна нарезок и скорости — БЕЗ ИЗМЕНЕНИЙ относительно
# одобренного пакета (scripts/make-demo-gifs.sh, Task 19): меняется только
# разрешение W=800→1920. Палитровое кодирование: palettegen stats_mode=diff +
# sierra2_4a (на тёмном UI даёт чистые градиенты). Мульти-резки — concat-фильтр.
#
# Карта контента видео (проверена VLM в Task 19):
#   12.5-32    запуск: planning → узлы появляются
#   32.2-51.8  модалка развилки 1 + выбор ветки
#   127.9-142.2 рост плана прогона 2
#   202-215    инспектор: детали узла
#   227-242    скраб таймлайна + тост
#   108.5-127.9 задача 2: Manual→Auto, запуск
#   145-151.5 + 170.5-180.5 + 184.5-187.5  ошибка API + retry (3 резки)
#   116-127 + 233.8-245.5  история прогонов (2 резки)
#   76.5-86.9  завершение: метрики, граф
set -e
SRC=/home/z/my-project/download/tacg-demo.mp4
OUT=/home/z/my-project/download/tacg-gifs
W=1920   # 16:9 → 1920×1080 — полное разрешение источника
FPS=12
DITHER=sierra2_4a
mkdir -p "$OUT"

# make_gif <имя> <скорость> <окно1-начало> <окно1-конец> [<окно2-начало> <окно2-конец> ...]
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
  printf '%-42s %6.1f МБ\n' "${name}.gif" "$(echo "$sz/1048576" | awk '{printf "%.1f", $1}')"
}

# --- 9 GIF основных функций (полное разрешение, без субтитров) ---
make_gif tacg-gif-01-launch-planning   1.25  12.5 32.0
make_gif tacg-gif-02-decision-branch   1.20  32.2 51.8
make_gif tacg-gif-03-plan-growth       1.30  127.9 142.2
make_gif tacg-gif-04-node-inspector    1.05  202 215
make_gif tacg-gif-05-timeline-replay   1.15  227 242
make_gif tacg-gif-06-auto-mode         1.25  108.5 127.9
make_gif tacg-gif-07-error-retry       1.30  145 151.5 170.5 180.5 184.5 187.5
make_gif tacg-gif-08-run-history       1.15  116 127 233.8 245.5
make_gif tacg-gif-09-completion-audit  1.05  76.5 86.9

# --- превью для README — тоже полное разрешение ---
make_gif tacg-demo-preview             1.15  127.9 141.6
mv "$OUT/tacg-demo-preview.gif" /home/z/my-project/download/tacg-demo-preview.gif
echo "превью → download/tacg-demo-preview.gif"

echo "=== итог ==="
ls -la "$OUT" /home/z/my-project/download/tacg-demo-preview.gif
