#!/bin/bash
# TACG Task 20 — верификация HD GIF: размеры + полный декод, всё в лог
exec > /home/z/my-project/scripts/verify-hd.log 2>&1
cd /home/z/my-project/download
for f in tacg-gifs/tacg-gif-06*.gif tacg-gifs/tacg-gif-07*.gif tacg-gifs/tacg-gif-08*.gif tacg-gifs/tacg-gif-09*.gif tacg-demo-preview.gif; do
  dims=$(timeout 10 ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$f")
  if timeout 30 ffmpeg -v error -i "$f" -f null - 2>/dev/null; then dec="decode-OK"; else dec="DECODE-FAIL"; fi
  sz=$(( $(stat -c%s "$f") / 1048576 ))
  echo "$f: ${dims} ${sz}MB ${dec}"
done
echo "DONE"
