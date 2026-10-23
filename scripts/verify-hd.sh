#!/bin/bash
# Avizis Task 20 — верификация HD GIF: размеры + полный декод, всё в лог
exec > /home/z/my-project/scripts/verify-hd.log 2>&1
cd /home/z/my-project/download
for f in avizis-gifs/avizis-gif-06*.gif avizis-gifs/avizis-gif-07*.gif avizis-gifs/avizis-gif-08*.gif avizis-gifs/avizis-gif-09*.gif avizis-demo-preview.gif; do
  dims=$(timeout 10 ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$f")
  if timeout 30 ffmpeg -v error -i "$f" -f null - 2>/dev/null; then dec="decode-OK"; else dec="DECODE-FAIL"; fi
  sz=$(( $(stat -c%s "$f") / 1048576 ))
  echo "$f: ${dims} ${sz}MB ${dec}"
done
echo "DONE"
