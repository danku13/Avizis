#!/bin/bash
# Avizis v2 — пересборка демо-видео с корректными пропорциями 16:9 (1920×1080).
#
# ПРИЧИНА БАГА v1: первый чанк записи (chunk-000, интро) был снят в окне 1280×578,
# остальные — 1920×1080. При concat контейнер взял размер ПЕРВОГО сегмента →
# весь ролик (95%) оказался сплюснут по вертикали до 2.21:1.
# Плюс в финал v1 были вжаты (burned) английские субтитры, хотя по ADR-022
# задуманы переключаемые soft-subs.
#
# ФИКС v2:
#  - seg-00 перекодируется из исходного chunk-000 с леттербоксом:
#    1280×578 → scale 1920×868 → pad до 1920×1080 (полосы 106px сверху/снизу,
#    на тёмном UI незаметны) — пропорции контента не искажаются;
#  - seg-01..18 уже 1920×1080 — склеиваются без перекодирования (stream copy);
#  - параметры seg-00-1080 подогнаны под остальные сегменты
#    (High/4.0/yuv420p/30fps/timescale 15360) для чистого concat;
#  - тайминг всех сегментов сохранён (245.9с) → субтитры avizis-demo-{en,ru}.srt
#    остаются в синхроне;
#  - вжатых сабов нет: только soft-subs mov_text eng (default) + rus.
#
# Исходники: /tmp/chunk-000.webm, /tmp/seg-01..18.mp4 (сохранены с сессии записи).
set -e
cd /tmp

OUT=/home/z/my-project/download

# 1) seg-00: 1280×578 → 1920×1080 (леттербокс, без искажения пропорций)
ffmpeg -hide_banner -loglevel error -y -ss 8 -to 20 -i /tmp/chunk-000.webm \
  -vf "scale=1920:868:flags=lanczos,pad=1920:1080:0:106:black,setsar=1,fps=30,format=yuv420p" -an \
  -c:v libx264 -preset medium -crf 20 -g 60 -profile:v high -level:v 4.0 \
  -video_track_timescale 15360 seg-00-1080.mp4

# 2) склейка: перекодированный seg-00-1080 + seg-01..18 как есть
rm -f concat1080.txt
echo "file 'seg-00-1080.mp4'" > concat1080.txt
for i in $(seq 1 18); do printf "file 'seg-%02d.mp4'\n" "$i" >> concat1080.txt; done
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i concat1080.txt -c copy avizis-demo-1080-nosubs.mp4

# 3) soft-subs: eng (default) + rus, видео не трогаем
ffmpeg -hide_banner -loglevel error -y -i avizis-demo-1080-nosubs.mp4 \
  -i "$OUT/avizis-demo-en.srt" -i "$OUT/avizis-demo-ru.srt" \
  -map 0:v -map 1:0 -map 2:0 -c:v copy -c:s mov_text \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=rus \
  -disposition:s:0 default -disposition:s:1 0 \
  -movflags +faststart "$OUT/avizis-demo.mp4"

# 4) контроль
echo "=== потоки ==="
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height:stream_tags=language -of default=noprint_wrappers=1 "$OUT/avizis-demo.mp4"
echo "=== длительность ==="
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT/avizis-demo.mp4"
