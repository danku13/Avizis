#!/bin/bash
# Цикл записи чанками: agent-browser recorder имеет буфер ~3МБ (~35с тяжёлой
# анимации) — пишем по 20с в отдельные файлы, склейка потом ffmpeg'ом.
# Стоп: touch /tmp/rec-stop
cd /home/z/my-project
rm -f /tmp/rec-stop /tmp/chunk-*.webm
i=0
while [ ! -f /tmp/rec-stop ]; do
  f=$(printf '/tmp/chunk-%03d.webm' "$i")
  agent-browser record start "$f" > /dev/null 2>&1
  sleep 20
  agent-browser record stop > /dev/null 2>&1
  sleep 1.2
  i=$((i+1))
done
echo "chunks: $i" > /tmp/rec-loop-done.txt
