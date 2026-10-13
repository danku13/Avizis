#!/bin/bash
# TACG Task 21 — чанк 07: развилка «формат публикации» → переключение на «Авто» прямо в модалке
# (демо-приём: человек вмешивается посреди прогона и передаёт решения агенту)
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

sleep 4   # модалка развилки: «агент просит решение»

snap=$(agent-browser snapshot -i 2>/dev/null)
# кнопка «Авто» внутри модалки (рядом с «Вручную»)
refAuto=$(echo "$snap" | rg 'button "Авто"' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refAuto=$refAuto"
if [ -n "$refAuto" ]; then
  agent-browser click "@$refAuto" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN2 FORK→AUTO" >> "$T"
fi

sleep 11   # агент решает сам, граф растёт
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
