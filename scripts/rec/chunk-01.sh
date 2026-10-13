#!/bin/bash
# TACG Task 21 — чанк 01: развилка 1 — выбор «B Глубокое расследование» + подтверждение
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")
P=/home/z/my-project/scripts/rec

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

# свежие refs в новом контексте
snap=$(agent-browser snapshot -i 2>/dev/null)
refB=$(echo "$snap" | rg 'Глубокое расследование' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refB=$refB"

sleep 5.5   # показать модалку и варианты

if [ -n "$refB" ]; then
  agent-browser click "@$refB" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN1 FORK1 OPTION-B" >> "$T"
  sleep 1.5
  # подтвердить: кнопка рядом (стала активной после выбора)
  snap2=$(agent-browser snapshot -i 2>/dev/null)
  refC=$(echo "$snap2" | rg 'Выберите вариант' | rg -v 'disabled' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
  echo "refConfirm=$refC"
  if [ -n "$refC" ]; then
    agent-browser click "@$refC" > /dev/null 2>&1
    echo "$(date +%s.%N) RUN1 FORK1 CONFIRMED" >> "$T"
  else
    # возможно сменилась подпись — ищем активную кнопку подтверждения
    refC2=$(echo "$snap2" | rg -i 'подтверд|выберите' | rg -v 'disabled' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
    [ -n "$refC2" ] && agent-browser click "@$refC2" > /dev/null 2>&1 && echo "$(date +%s.%N) RUN1 FORK1 CONFIRMED-alt" >> "$T"
  fi
fi

sleep 9   # активация ветки, рост плана
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
