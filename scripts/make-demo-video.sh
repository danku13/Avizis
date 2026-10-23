#!/bin/bash
# Avizis — монтаж демо-видео из чанков записи (ADR-022/CR-015):
# сегменты (файл, локальные сек, скорость) → h264 → склейка → субтитры → mp4 + gif.
# Исходники: /tmp/chunk-*.webm (VP8 1920x1080 30fps, ~20с каждый).
set -e
cd /tmp

SEGS=(
  "chunk-000.webm 8 20 1.0    # интро: задача заполнена"
  "chunk-001.webm 0 20 1.0    # запуск, планирование, первые узлы, развилка"
  "chunk-002.webm 0 9  1.0    # модалка развилки 1"
  "chunk-008.webm 0 20 1.0    # выбор варианта, ветка активируется, v4-v6"
  "chunk-009.webm 0 20 1.3    # быстрый рост v7-v10"
  "chunk-010.webm 0 12 1.0    # модалка развилки 2"
  "chunk-012.webm 0 20 1.0    # выбор, v11-v12"
  "chunk-013.webm 0 16 1.0    # завершение прогона 1"
  "chunk-014.webm 0 9  1.0    # инспектор узла"
  "chunk-015.webm 0 12 1.0    # скраб таймлайна"
  "chunk-019.webm 0 20 1.0    # задача 2, авто-режим, запуск"
  "chunk-020.webm 0 20 1.4    # рост прогона 2"
  "chunk-021.webm 0 14 1.0    # ошибка 429"
  "chunk-031.webm 0 14 1.0    # retry №1 — снова ошибка"
  "chunk-047.webm 0 14 1.0    # retry №2"
  "chunk-048.webm 0 20 1.15   # успех + авто-развилка + рост"
  "chunk-049.webm 0 20 1.4    # v8-v11"
  "chunk-050.webm 0 18 1.0    # завершение прогона 2"
  "chunk-051.webm 0 12 1.0    # история прогонов"
)

rm -f seg-*.mp4 concat.txt
i=0
for spec in "${SEGS[@]}"; do
  read -r f ls le sp _ <<< "$spec"
  [ -f "/tmp/$f" ] || { echo "НЕТ ФАЙЛА $f"; continue; }
  sz=$(stat -c%s "/tmp/$f")
  [ "$sz" -lt 1000 ] && { echo "ПУСТОЙ $f — пропуск"; continue; }
  n=$(printf '%02d' $i)
  echo "seg $n: $f [$ls..$le] x$sp"
  if [ "$sp" = "1.0" ]; then
    VF="fps=30"
  else
    VF="setpts=PTS/${sp},fps=30"
  fi
  ffmpeg -hide_banner -loglevel error -y -ss "$ls" -to "$le" -i "/tmp/$f" \
    -vf "$VF,format=yuv420p" -an \
    -c:v libx264 -preset medium -crf 20 -g 60 "seg-${n}.mp4"
  echo "file 'seg-${n}.mp4'" >> concat.txt
  i=$((i+1))
done

ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i concat.txt -c copy avizis-demo-nosubs.mp4
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 avizis-demo-nosubs.mp4)
echo "склеено: avizis-demo-nosubs.mp4, длительность $DUR"
