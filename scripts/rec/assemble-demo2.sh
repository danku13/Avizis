#!/bin/bash
# Avizis Task 21 — сборка avizis-demo2.mp4: 11 чанков webm (1920×1080) → нарезка →
# x264 → concat → soft-subs (rus default + eng) → download/avizis-demo2.mp4.
# Запуск ОСИРОТЕВШИМ процессом, лог в assemble.log.
exec > /home/z/my-project/scripts/rec/assemble.log 2>&1
set -e
cd /tmp
OUT=/home/z/my-project/download
REC=/home/z/my-project/scripts/rec

# 1) сегменты: (чанк, старт, конец)
SEGS=(
  "000 0 20.866"
  "001 0 7.2"
  "002 4.0 19.966"
  "003 0 19.0"
  "004 0 10.0"
  "005 0 21.366"
  "006 0 20.9"
  "007 0 19.266"
  "008 0 20.0"
  "009 0 8.0"
  "010 0 20.533"
)

rm -f seg2-*.mp4 concat2.txt
i=0
for row in "${SEGS[@]}"; do
  set -- $row
  c=$1; s=$2; e=$3
  echo "=== seg2-${i} ← chunk2-${c} [${s} → ${e}] $(date +%H:%M:%S) ==="
  timeout 300 ffmpeg -hide_banner -loglevel error -y \
    -ss "$s" -to "$e" -i "/tmp/chunk2-${c}.webm" \
    -vf "fps=30,format=yuv420p,setsar=1" -an \
    -c:v libx264 -preset veryfast -crf 20 -g 60 \
    -profile:v high -level:v 4.0 -video_track_timescale 15360 \
    "seg2-${i}.mp4"
  printf "file 'seg2-%d.mp4'\n" "$i" >> concat2.txt
  i=$((i+1))
done

# 2) склейка
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i concat2.txt \
  -c copy avizis-demo2-nosubs.mp4
echo "concat OK: $(ffprobe -v error -show_entries format=duration -of csv=p=0 avizis-demo2-nosubs.mp4)s"

# 3) soft-subs: rus (default) + eng
ffmpeg -hide_banner -loglevel error -y -i avizis-demo2-nosubs.mp4 \
  -i "$REC/avizis-demo2-ru.srt" -i "$REC/avizis-demo2-en.srt" \
  -map 0:v -map 1:0 -map 2:0 -c:v copy -c:s mov_text \
  -metadata:s:s:0 language=rus -metadata:s:s:1 language=eng \
  -disposition:s:0 default -disposition:s:1 0 \
  -movflags +faststart "$OUT/avizis-demo2.mp4"

cp "$REC/avizis-demo2-ru.srt" "$OUT/avizis-demo2-ru.srt"
cp "$REC/avizis-demo2-en.srt" "$OUT/avizis-demo2-en.srt"

# 4) контроль
echo "=== потоки ==="
ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height:stream_tags=language -of default=noprint_wrappers=1 "$OUT/avizis-demo2.mp4"
echo "=== длительность/размер ==="
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT/avizis-demo2.mp4"
echo "ASSEMBLE-DONE"
