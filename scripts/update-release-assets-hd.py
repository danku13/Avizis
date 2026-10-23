#!/usr/bin/env python3
"""Avizis Task 20 — замена GIF-ассетов релиза v0.12.0 на полное разрешение 1920×1080.
Удаляет старые 800×450 GIF (9 функциональных + превью), заливает HD-версии.
avizis-demo.mp4 НЕ трогаем (он уже 1920×1080). PAT — из remote.origin.url (запуск из /home/z/my-project)."""
import json
import os
import sys
import urllib.request

REPO = 'danku13/Avizis'
TAG = 'v0.12.0'
TOKEN = os.popen(
    "git config --get remote.origin.url | sed -E 's#.*://[^:]+:([^@]+)@.*#\\1#'"
).read().strip()
if not TOKEN or '@' not in os.popen("git config --get remote.origin.url").read():
    TOKEN = os.environ.get('GITHUB_TOKEN', '')

DL = '/home/z/my-project/download'
GIF_DIR = f'{DL}/avizis-gifs'

ASSETS = [  # (путь, content-type)
    (f'{GIF_DIR}/avizis-gif-01-launch-planning.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-02-decision-branch.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-03-plan-growth.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-04-node-inspector.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-05-timeline-replay.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-06-auto-mode.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-07-error-retry.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-08-run-history.gif', 'image/gif'),
    (f'{GIF_DIR}/avizis-gif-09-completion-audit.gif', 'image/gif'),
    (f'{DL}/avizis-demo-preview.gif', 'image/gif'),
]


def api(method, path, body=None, accept='application/vnd.github+json'):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            'Authorization': f'token {TOKEN}',
            'Accept': accept,
            'User-Agent': 'avizis-release-update',
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {'message': 'http error'}


def upload(release_id, path, ctype):
    name = os.path.basename(path)
    size = os.path.getsize(path)
    url = f'https://uploads.github.com/repos/{REPO}/releases/{release_id}/assets?name={name}'
    data = open(path, 'rb').read()
    req = urllib.request.Request(url, data=data, headers={
        'Authorization': f'token {TOKEN}',
        'Content-Type': ctype,
        'Content-Length': str(size),
        'User-Agent': 'avizis-release-update',
    }, method='POST')
    with urllib.request.urlopen(req, timeout=600) as r:
        resp = json.load(r)
        print(f'  залит {name}: {resp["size"]/1048576:.1f} МБ (state={resp["state"]})')
        return resp


def main():
    if not TOKEN:
        print('НЕТ ТОКЕНА'); sys.exit(1)
    st, rel = api('GET', f'/repos/{REPO}/releases/tags/{TAG}')
    if st != 200:
        print('релиз не найден:', st, rel); sys.exit(1)
    rid = rel['id']
    print(f'релиз {TAG}: id={rid}, ассетов сейчас: {len(rel["assets"])}')

    # 1. удалить старые версии GIF
    names = {os.path.basename(p) for p, _ in ASSETS}
    for a in rel['assets']:
        if a['name'] in names:
            st2, _ = api('DELETE', f'/repos/{REPO}/releases/assets/{a["id"]}')
            print(f'  удалён старый {a["name"]} ({a["size"]/1048576:.1f} МБ): HTTP {st2}')

    # 2. залить HD-версии
    for path, ctype in ASSETS:
        if not os.path.exists(path):
            print(f'  НЕТ ФАЙЛА {path}'); sys.exit(2)
        upload(rid, path, ctype)

    # 3. контроль
    st, rel2 = api('GET', f'/repos/{REPO}/releases/{rid}')
    print(f'\nитого ассетов: {len(rel2["assets"])}')
    for a in rel2['assets']:
        print(f'  {a["name"]}: {a["size"]/1048576:.1f} МБ')
    print('УСПЕХ')


if __name__ == '__main__':
    main()
