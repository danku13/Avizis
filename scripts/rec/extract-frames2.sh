#!/bin/bash
# TACG Task 21 — извлечение кадров из чанков для VLM-карты контента
exec > /home/z/my-project/scripts/rec/frames.log 2>&1
mkdir -p /tmp/frames2
for i in 000 001 002 003 004 005 006 007 008 009 010; do
  f=/tmp/chunk2-${i}.webm
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  t1=$(awk -v d="$dur" 'BEGIN{printf "%.1f", d*0.25}')
  t2=$(awk -v d="$dur" 'BEGIN{printf "%.1f", d*0.75}')
  timeout 20 ffmpeg -hide_banner -loglevel error -y -ss "$t1" -i "$f" -frames:v 1 -vf scale=960:540 "/tmp/frames2/c${i}-a.png"
  timeout 20 ffmpeg -hide_banner -loglevel error -y -ss "$t2" -i "$f" -frames:v 1 -vf scale=960:540 "/tmp/frames2/c${i}-b.png"
  echo "c${i}: t1=$t1 t2=$t2"
done
ls /tmp/frames2 | wc -l
echo DONE
