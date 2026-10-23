#!/bin/bash
# Avizis Task 21 — запуск сервисов для записи демо-видео (осиротевшие демоны):
#   движок :3003 (bun), фронт standalone :3005 (node), caddy :8200 (XTransformPort-шлюз)
# Каждый демон спавнится через промежуточный bash, который сразу выходит —
# процесс успевает осиротеть (PPID=1) ДО конца вызова инструмента → переживает reaper.
set -u
P=/home/z/my-project

# 0. чистая история прогонов для записи
cd "$P/mini-services/avizis-agent/data" 2>/dev/null && \
  [ -f runs.json ] && mv runs.json runs.json.bak-rec 2>/dev/null
echo "history: $([ -f runs.json ] && echo kept || echo fresh)"

# 1. движок агента (:3003)
bash -c "cd $P/mini-services/avizis-agent && nohup setsid bun index.ts >> $P/scripts/engine-hd.log 2>&1 & sleep 0.3; exit"
# 2. фронт standalone (:3005)
bash -c "cd $P/.next/standalone && PORT=3005 HOSTNAME=127.0.0.1 nohup setsid node server.js >> $P/scripts/next-hd.log 2>&1 & sleep 0.3; exit"
# 3. caddy-шлюз (:8200)
bash -c "cd $P && nohup setsid caddy run --config $P/scripts/Caddyfile-hd >> $P/scripts/caddy-hd.log 2>&1 & sleep 0.3; exit"

sleep 4
echo "=== порты ==="
ss -tlnp 2>/dev/null | rg ':(3003|3005|8200)\s' | head -6
echo "=== движок лог ==="
tail -3 "$P/scripts/engine-hd.log" 2>/dev/null
echo "=== next лог ==="
tail -3 "$P/scripts/next-hd.log" 2>/dev/null
echo "SERVICES-UP"
