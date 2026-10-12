#!/usr/bin/env python3
"""TACG — опрос статуса CI/релиза через GitHub API с PAT из remote.origin.url.
Использование: poll-release.py <run_id|tag> [--wait] [--max <мин>]"""
import json
import os
import sys
import time
import urllib.request

REPO = 'danku13/TACG'
TOKEN = os.popen(
    "git config --get remote.origin.url | sed -E 's#.*://[^:]+:([^@]+)@.*#\\1#'"
).read().strip() if os.popen("git config --get remote.origin.url").read().find('@') > 0 else os.environ.get('GITHUB_TOKEN', '')
if not TOKEN:
    # попробовать без логина (PAT может быть вида https://TOKEN@host)
    TOKEN = os.popen("git config --get remote.origin.url | sed -E 's#https://([^@]+)@.*#\\1#'").read().strip()

def api(path: str):
    req = urllib.request.Request(f'https://api.github.com{path}', headers={
        'Authorization': f'token {TOKEN}',
        'Accept': 'application/vnd.github+json',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def wait_run(run_id: str, max_min: int = 25):
    deadline = time.time() + max_min * 60
    last = None
    while time.time() < deadline:
        r = api(f'/repos/{REPO}/actions/runs/{run_id}')
        if (r['status'], r.get('conclusion')) != last:
            print(f"run {run_id}: {r['status']} / {r.get('conclusion')}", flush=True)
            last = (r['status'], r.get('conclusion'))
        if r['status'] == 'completed':
            return r.get('conclusion')
        time.sleep(30)
    return 'timeout'

if __name__ == '__main__':
    arg = sys.argv[1]
    if arg.isdigit():
        concl = wait_run(arg)
        print('FINAL:', concl)
        sys.exit(0 if concl == 'success' else 1)
    else:
        rel = api(f'/repos/{REPO}/releases/tags/{arg}')
        print('release:', rel.get('name'), '| draft:', rel.get('draft'))
        for a in rel.get('assets', []):
            print(f"  - {a['name']}: {a['size']:,} байт ({a['state']})")
