#!/bin/bash
# Avizis Task 21 — чанк 00: интро (RU UI, задача) + запуск прогона 1 (data-сценарий, вручную)
# Лог таймингов для субтитров: /tmp/rec-timeline.log
T=/tmp/rec-timeline.log
N=$(printf '%03d' "$1")

agent-browser record start "/tmp/chunk2-${N}.webm" > /dev/null 2>&1
agent-browser set viewport 1920 1080 > /dev/null 2>&1
sleep 3.5
title=$(agent-browser get title 2>/dev/null | head -1)
[ "$title" = "Avizis Playground — live agent computation graph" ] || echo "WARN: title=$title"
# язык должен быть RU (localStorage переносится во fresh context)
h=$(agent-browser get text @e6 2>/dev/null | head -1)
[ "$h" = "Задача агенту" ] || { agent-browser click @e4 > /dev/null 2>&1; sleep 1; }

agent-browser screenshot /tmp/rec-check-live.png > /dev/null 2>&1
dims=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 /tmp/rec-check-live.png)
echo "$(date +%s.%N) CHUNK${N} START" >> "$T"
if [ "$dims" != "1920,1080" ]; then
  echo "$(date +%s.%N) ABORT: live dims=$dims" >> "$T"
  agent-browser record stop > /dev/null 2>&1
  echo "ABORTED dims=$dims"; exit 1
fi
echo "$(date +%s.%N) RESOLUTION-OK 1920x1080" >> "$T"

sleep 7   # интро: интерфейс, задача
agent-browser click @e10 > /dev/null 2>&1   # «Запустить агента»
echo "$(date +%s.%N) RUN1 LAUNCHED" >> "$T"
sleep 9
agent-browser record stop > /dev/null 2>&1
echo "$(date +%s.%N) CHUNK${N} STOP" >> "$T"
sleep 1
d=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "/tmp/chunk2-${N}.webm" 2>/dev/null)
echo "$(date +%s.%N) CHUNK${N} SAVED dims=$d dur=$dur" >> "$T"
echo "chunk2-${N}.webm: dims=$d dur=${dur}s"
