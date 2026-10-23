#!/bin/bash
# Avizis Task 21 — чанк 06: прогон 2 — новая задача (writing) + режим «Авто» + запуск
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")
TASK='Напиши пост про запуск нашей новой функции — умного помощника в редакторе'

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"

# 1) новая задача
snap=$(agent-browser snapshot -i 2>/dev/null)
refTask=$(echo "$snap" | rg 'Текст задачи' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refTask=$refTask"
[ -n "$refTask" ] && agent-browser fill "@$refTask" "$TASK" > /dev/null 2>&1
echo "$(date +%s.%N) RUN2 TASK-FILLED" >> "$T"
sleep 3

# 2) режим решений: Авто
snap2=$(agent-browser snapshot -i 2>/dev/null)
refCombo=$(echo "$snap2" | rg 'Режим решений' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
echo "refCombo=$refCombo"
if [ -n "$refCombo" ]; then
  agent-browser click "@$refCombo" > /dev/null 2>&1
  sleep 0.8
  snap3=$(agent-browser snapshot -i 2>/dev/null)
  refAuto=$(echo "$snap3" | rg -i 'option|Авто' | rg 'Авто' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
  echo "refAuto=$refAuto"
  [ -n "$refAuto" ] && agent-browser click "@$refAuto" > /dev/null 2>&1
  echo "$(date +%s.%N) RUN2 MODE-AUTO" >> "$T"
fi
sleep 2.5

# 3) запуск
snap4=$(agent-browser snapshot -i 2>/dev/null)
refRun=$(echo "$snap4" | rg 'Запустить агента' | rg -o '\[ref=(e[0-9]+)\]' -r '$1' | head -1)
[ -n "$refRun" ] && agent-browser click "@$refRun" > /dev/null 2>&1
echo "$(date +%s.%N) RUN2 LAUNCHED" >> "$T"

sleep 10   # планирование прогона 2
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
