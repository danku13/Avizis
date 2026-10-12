#!/usr/bin/env python3
"""TACG — обновление видео-ассетов релиза v0.12.0 (фикс вертикального сплющивания):
удаляет старые tacg-demo.mp4 + tacg-demo-preview.gif, заливает исправленные
+ 9 функциональных GIF. PAT берётся из remote.origin.url (как poll-release.py)."""
import json
import os
import sys
import urllib.request

REPO = 'danku13/TACG'
TAG = 'v0.12.0'
TOKEN = os.popen(
    "git config --get remote.origin.url | sed -E 's#.*://[^:]+:([^@]+)@.*#\\1#'"
).read().strip()
if not TOKEN or '@' not in os.popen("git config --get remote.origin.url").read():
    TOKEN = os.environ.get('GITHUB_TOKEN', '')

DL = '/home/z/my-project/download'
GIF_DIR = f'{DL}/tacg-gifs'

REPLACE = [  # (путь, content-type)
    (f'{DL}/tacg-demo.mp4', 'video/mp4'),
    (f'{DL}/tacg-demo-preview.gif', 'image/gif'),
]
ADD = [
    (f'{GIF_DIR}/{n}', 'image/gif') for n in [
        'tacg-gif-01-launch-planning.gif',
        'tacg-gif-02-decision-branch.gif',
        'tacg-gif-03-plan-growth.gif',
        'tacg-gif-04-node-inspector.gif',
        'tacg-gif-05-timeline-replay.gif',
        'tacg-gif-06-auto-mode.gif',
        'tacg-gif-07-error-retry.gif',
        'tacg-gif-08-run-history.gif',
        'tacg-gif-09-completion-audit.gif',
    ]
]


def api(method, path, body=None, accept='application/vnd.github+json'):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            'Authorization': f'token {TOKEN}',
            'Accept': accept,
            'User-Agent': 'tacg-release-update',
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
        'User-Agent': 'tacg-release-update',
    }, method='POST')
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.load(r)
        print(f'  залит {name}: {resp["size"]} байт (state={resp["state"]})')
        return resp


def main():
    st, rel = api('GET', f'/repos/{REPO}/releases/tags/{TAG}')
    if st != 200:
        print('релиз не найден:', st, rel); sys.exit(1)
    rid = rel['id']
    print(f'релиз {TAG}: id={rid}, ассетов сейчас: {len(rel["assets"])}')

    # 1. удалить заменяемые
    for a in rel['assets']:
        if a['name'] in {os.path.basename(p) for p, _ in REPLACE} | {os.path.basename(p) for p, _ in ADD}:
            st2, _ = api('DELETE', f'/repos/{REPO}/releases/assets/{a["id"]}')
            print(f'  удалён старый {a["name"]}: HTTP {st2}')

    # 2. залить новые
    for path, ctype in REPLACE + ADD:
        if not os.path.exists(path):
            print(f'  НЕТ ФАЙЛА {path}'); sys.exit(2)
        upload(rid, path, ctype)

    # 3. контроль
    st, rel2 = api('GET', f'/repos/{REPO}/releases/{rid}')
    print(f'\nитого ассетов: {len(rel2["assets"])}')
    for a in rel2['assets']:
        print(f'  {a["name"]}: {a["size"]/1e6:.1f} МБ')
    print('УСПЕХ')


if __name__ == '__main__':
    main()
