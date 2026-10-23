#!/usr/bin/env bash
# Avizis — верификация первого релиза (этап 5, CR-012): статус workflow-прогона,
# артефакты и ассеты GitHub Release. Запуск: bash scripts/release-verify.sh [тег]
set -euo pipefail

TAG="${1:-v0.10.0}"
REPO="danku13/Avizis"
TOKEN="$(git config --get remote.origin.url | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
AUTH="Authorization: token $TOKEN"

api() { curl -s --max-time 20 -H "$AUTH" "https://api.github.com$1"; }

echo "── workflow-прогоны (последние 5):"
api "/repos/$REPO/actions/runs?per_page=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('workflow_runs', []):
    print(f\"  {r['name'][:40]:42} {r['head_branch'][:12]:14} {r['status'][:12]:14} {r['conclusion'] or '—':10} {r['html_url']}\")
"

echo
echo "── релиз $TAG:"
api "/repos/$REPO/releases/tags/$TAG" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'id' not in d:
    print('  релиз не найден:', d.get('message')); sys.exit(0)
print(f\"  {d['name']} · draft={d['draft']} · assets={len(d['assets'])} · {d['html_url']}\")
for a in d.get('assets', []):
    print(f\"    - {a['name']} ({a['size']//1024//1024} МБ, скачиваний {a['download_count']})\")
"

echo
echo "── теги:"
git ls-remote --tags origin | tail -5
