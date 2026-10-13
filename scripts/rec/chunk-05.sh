#!/bin/bash
# TACG Task 21 — чанк 05: закрыть инспектор → replay прогона 1 по таймлайну
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

snap=$(agent-browser snapshot -i 2>/dev/null)
refClose=$(echo "$snap" | rg 'button "Close"' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refClose" ] && agent-browser click "@$refClose" > /dev/null 2>&1 && echo "$(date +%s.%N) INSPECTOR-CLOSED" >> "$T"
sleep 2

snap2=$(agent-browser snapshot -i 2>/dev/null)
# play-кнопка истории: ищем по ключевым словам подписи
refPlay=$(echo "$snap2" | rg -i 'истор|history|воспроизв|проигр' | rg 'button' | rg -v 'disabled' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refPlay=$refPlay"
if [ -n "$refPlay" ]; then
  agent-browser click "@$refPlay" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN1 REPLAY-PLAY" >> "$T"
fi
sleep 9   # перемотка истории
snap3=$(agent-browser snapshot -i 2>/dev/null)
refF=$(echo "$snap3" | rg -i 'шаг вперёд|step forward' | rg -v 'disabled' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refF" ] && agent-browser click "@$refF" > /dev/null 2>&1
sleep 1.5
snap4=$(agent-browser snapshot -i 2>/dev/null)
refF2=$(echo "$snap4" | rg -i 'шаг вперёд|step forward' | rg -v 'disabled' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refF2" ] && agent-browser click "@$refF2" > /dev/null 2>&1
echo "$(date +%s.%N) RUN1 REPLAY-STEPS refF=$refF refF2=$refF2" >> "$T"

sleep 3
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
