#!/bin/bash
# Avizis Task 21 — чанк 09: история прогонов — переключение «прогон 2 → прогон 1 → прогон 2»
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

sleep 4   # завершённый прогон 2: 16 узлов, v4, метрики

snap=$(agent-browser snapshot 2>/dev/null)
# запись прогона 1 в истории (07:14 / 9 узл.)
refH1=$(echo "$snap" | rg '07:14' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refH1=$refH1"
if [ -n "$refH1" ]; then
  agent-browser click "@$refH1" > /dev/null 2>&1
  echo "$(date +%s.%N) HISTORY→RUN1" >> "$T"
fi
sleep 6   # граф прогона 1

snap2=$(agent-browser snapshot 2>/dev/null)
refH2=$(echo "$snap2" | rg '07:20' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refH2=$refH2"
if [ -n "$refH2" ]; then
  agent-browser click "@$refH2" > /dev/null 2>&1
  echo "$(date +%s.%N) HISTORY→RUN2" >> "$T"
fi
sleep 5   # возврат к прогону 2

agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
