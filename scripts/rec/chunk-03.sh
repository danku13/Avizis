#!/bin/bash
# Avizis Task 21 — чанк 03: завершённый прогон 1 (метрики, граф v2) + инспектор узла решения
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

sleep 5   # статичный кадр: завершённый прогон, метрики 100%, v2

snap=$(agent-browser snapshot -i 2>/dev/null)
# узел решения на графе (generic с текстом «Решение: стратегия»)
refNode=$(echo "$snap" | rg 'Решение: стратегия' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refNode=$refNode"
if [ -n "$refNode" ]; then
  agent-browser click "@$refNode" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN1 INSPECTOR-OPENED" >> "$T"
fi

sleep 9   # инспектор: вход/выход/причина добавления узла
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
