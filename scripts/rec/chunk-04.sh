#!/bin/bash
# Avizis Task 21 — чанк 04: replay прогона 1 — кнопка Play истории, покадровая перемотка
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

sleep 2
snap=$(agent-browser snapshot -i 2>/dev/null)
# закрыть инспектор, если открыт (для чистого вида таймлайна) — необязательно
# кнопка Play истории
refPlay=$(echo "$snap" | rg -i 'Воспроизвести|Play the history' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refPlay=$refPlay"
if [ -n "$refPlay" ]; then
  agent-browser click "@$refPlay" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN1 REPLAY-PLAY" >> "$T"
fi

sleep 8   # авто-перемотка истории событий
# шаг вперёд пару раз для наглядности покадрового скраббинга
snap2=$(agent-browser snapshot -i 2>/dev/null)
refF=$(echo "$snap2" | rg -i 'Шаг вперёд|Step forward' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refF" ] && agent-browser click "@$refF" > /dev/null 2>&1
sleep 1.5
snap3=$(agent-browser snapshot -i 2>/dev/null)
refF2=$(echo "$snap3" | rg -i 'Шаг вперёд|Step forward' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refF2" ] && agent-browser click "@$refF2" > /dev/null 2>&1
echo "$(date +%s.%N) RUN1 REPLAY-STEPS" >> "$T"

sleep 4
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
