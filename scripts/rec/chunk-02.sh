#!/bin/bash
# TACG Task 21 — чанк 02: развилка 1 — ЧИСТЫЙ выбор B + «Принять вариант «Глубокое расследование»»
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

snap=$(agent-browser snapshot -i 2>/dev/null)
refB=$(echo "$snap" | rg 'Глубокое расследование' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)

sleep 4   # модалка на экране

if [ -n "$refB" ]; then
  agent-browser click "@$refB" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN1 FORK1 OPTION-B(clean)" >> "$T"
  sleep 1.5
  snap2=$(agent-browser snapshot -i 2>/dev/null)
  # кнопка подтверждения меняет label на «Принять вариант «…»» — ищем по точному префиксу
  refC=$(echo "$snap2" | rg 'button "Принять вариант' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
  echo "refConfirm=$refC"
  if [ -n "$refC" ]; then
    agent-browser click "@$refC" > /dev/null 2>&1
    echo "$(date +%s.%N) RUN1 FORK1 CONFIRMED-B" >> "$T"
  fi
fi

sleep 10   # активация ветки B, добавление шагов, рост плана
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
