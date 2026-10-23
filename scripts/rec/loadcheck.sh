#!/bin/bash
# Avizis Task 21 — замер длительности загрузки страницы в начале чанков.
# Эвристика: почти пустой кадр → маленький PNG; отрисованный UI → большой.
exec > /home/z/my-project/scripts/rec/loadcheck.log 2>&1
mkdir -p /tmp/loadcheck
for c in 001 003 007; do
  echo "--- chunk $c ---"
  for t in 0.25 0.5 0.75 1.0 1.25 1.5 1.75 2.0 2.25 2.5 2.75 3.0 3.5; do
    f=/tmp/loadcheck/l-${c}-${t}.png
    timeout 15 ffmpeg -hide_banner -loglevel error -y -ss "$t" -i /tmp/chunk2-${c}.webm \
      -frames:v 1 -vf scale=960:540 "$f" 2>/dev/null
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    echo "t=$t size=$sz"
  done
done
echo DONE
