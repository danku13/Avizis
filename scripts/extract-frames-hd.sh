#!/bin/bash
# TACG Task 20 — извлечение кадров из HD GIF для VLM-проверки (2 кадра: ~30% и ~65%)
exec > /home/z/my-project/scripts/extract-frames.log 2>&1
mkdir -p /tmp/frames-hd
cd /home/z/my-project/download
for f in tacg-gifs/tacg-gif-01*.gif tacg-gifs/tacg-gif-02*.gif tacg-gifs/tacg-gif-03*.gif \
         tacg-gifs/tacg-gif-04*.gif tacg-gifs/tacg-gif-05*.gif tacg-gifs/tacg-gif-06*.gif \
         tacg-gifs/tacg-gif-07*.gif tacg-gifs/tacg-gif-08*.gif tacg-gifs/tacg-gif-09*.gif \
         tacg-demo-preview.gif; do
  name=$(basename "$f" .gif)
  dur=$(timeout 10 ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  t1=$(awk -v d="$dur" 'BEGIN{printf "%.2f", d*0.30}')
  t2=$(awk -v d="$dur" 'BEGIN{printf "%.2f", d*0.65}')
  timeout 30 ffmpeg -hide_banner -loglevel error -y -ss "$t1" -i "$f" -frames:v 1 -vf scale=960:540 "/tmp/frames-hd/g-${name}-a.png"
  timeout 30 ffmpeg -hide_banner -loglevel error -y -ss "$t2" -i "$f" -frames:v 1 -vf scale=960:540 "/tmp/frames-hd/g-${name}-b.png"
  echo "$name dur=${dur}s → g-${name}-a.png (t=$t1), g-${name}-b.png (t=$t2)"
done
ls /tmp/frames-hd/ | wc -l
echo "DONE"
