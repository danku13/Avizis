#!/usr/bin/env python3
"""TACG — генерация иконок десктоп-приложения (Tauri, ADR-018).

Мотив: тёмный скруглённый квадрат + мини-граф вычислений агента (узлы и рёбра
в фирменных цветах: фиолетовый = план, янтарный = развилка, бирюзовый = динамика).
Выход: src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico}
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons')
os.makedirs(OUT, exist_ok=True)

BG = (15, 23, 42)        # slate-900
EDGE = (148, 163, 184)   # slate-400
NODE_PLAN = (167, 139, 250)   # violet-400
NODE_FORK = (251, 191, 36)    # amber-400
NODE_DYN = (45, 212, 191)     # teal-400

# узлы мини-графа в координатах 0..1 (x, y, радиус в долях, цвет)
NODES = [
    (0.18, 0.30, 0.075, NODE_PLAN),
    (0.50, 0.18, 0.070, NODE_PLAN),
    (0.82, 0.30, 0.075, NODE_FORK),
    (0.30, 0.66, 0.070, NODE_DYN),
    (0.62, 0.58, 0.075, NODE_FORK),
    (0.82, 0.80, 0.070, NODE_PLAN),
]
EDGES = [(0, 1), (1, 2), (0, 3), (3, 4), (4, 5), (2, 4)]


def draw_icon(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # фон: скруглённый квадрат
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BG)
    # тонкая рамка для читаемости на светлых фонах
    if size >= 64:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius,
                            outline=(51, 65, 85), width=max(1, size // 128))
    # рёбра
    lw = max(2, int(size * 0.028))
    for a, b in EDGES:
        (x1, y1, _, _), (x2, y2, _, _) = NODES[a], NODES[b]
        d.line([x1 * size, y1 * size, x2 * size, y2 * size], fill=EDGE, width=lw)
    # узлы (с тёмной обводкой — отделение от рёбер)
    for x, y, r, color in NODES:
        cx, cy, rr = x * size, y * size, r * size
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color, outline=BG, width=max(1, int(rr * 0.22)))
    return img


def main():
    draw_icon(32).save(os.path.join(OUT, '32x32.png'))
    draw_icon(128).save(os.path.join(OUT, '128x128.png'))
    draw_icon(256).save(os.path.join(OUT, '128x128@2x.png'))
    draw_icon(512).save(os.path.join(OUT, 'icon.png'))
    # Windows .ico: мульти-размер
    draw_icon(256).save(os.path.join(OUT, 'icon.ico'),
                        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('иконки TACG:', sorted(os.listdir(OUT)))


if __name__ == '__main__':
    main()
