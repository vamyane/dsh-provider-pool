#!/usr/bin/env python3
"""生成 dsh-provider-pool 的 512x512 图标。

主题：深蓝底 + 分叉路由/节点（左侧 3 个 provider 汇聚到中央路由枢纽，
右侧两条出边——实线主路径 + 琥珀色虚线 fallback 路径）。
4x 超采样后 LANCZOS 缩小，保证 64px 小尺寸下依然清楚。

用法：python assets/generate_icon.py
输出：assets/icon.png（512x512，PNG）
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SCALE = 4
SIZE = 512
CANVAS = SIZE * SCALE
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def build_background() -> Image.Image:
    """对角渐变：左上深海军蓝 → 右下偏亮的蓝。"""
    top = np.array([6, 15, 30], dtype=np.float32)
    bottom = np.array([13, 40, 74], dtype=np.float32)
    y = np.linspace(0.0, 1.0, CANVAS, dtype=np.float32)[:, None]
    x = np.linspace(0.0, 1.0, CANVAS, dtype=np.float32)[None, :]
    t = np.clip((x * 0.55 + y * 0.45), 0.0, 1.0)[..., None]
    rgb = top[None, None, :] * (1.0 - t) + bottom[None, None, :] * t
    alpha = np.full((CANVAS, CANVAS, 1), 255, dtype=np.float32)
    arr = np.concatenate([rgb, alpha], axis=2).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def add_glow(base: Image.Image) -> None:
    """中央路由枢纽背后的青色辉光。"""
    glow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = 1180, 1024
    for radius, alpha in ((470, 26), (360, 34), (250, 44)):
        gd.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(56, 189, 248, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    base.alpha_composite(glow)


def add_dot_grid(base: Image.Image) -> None:
    grid = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    step = 128
    for x in range(64, CANVAS, step):
        for y in range(64, CANVAS, step):
            gd.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(148, 197, 255, 26))
    base.alpha_composite(grid)


def node(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: tuple, border: tuple, width: int = 8) -> None:
    draw.rounded_rectangle(box, radius=42, fill=fill, outline=border, width=width)


def draw_lines(base: Image.Image) -> None:
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    hub = (1180, 1024)

    # 三个 provider → 中央枢纽：汇聚线
    for y in (620, 1024, 1428):
        ld.line([(500, y), (900, y), (hub[0] - 176, hub[1])], fill=(56, 189, 248, 190), width=16, joint="curve")
        ld.ellipse((884, y - 12, 908, y + 12), fill=(125, 211, 252, 235))

    # 中央枢纽 → 右侧主路径（实线）
    ld.line([(hub[0] + 176, hub[1]), (1640, 760), (1700, 760)], fill=(56, 189, 248, 210), width=18, joint="curve")

    # 中央枢纽 → 右侧 fallback（琥珀虚线）
    dash_y = 1288
    start_x = hub[0] + 150
    end_x = 1700
    seg = 40
    gap = 28
    x = start_x
    while x < end_x:
        x2 = min(x + seg, end_x)
        ld.line([(x, dash_y), (x2, dash_y)], fill=(251, 191, 36, 215), width=16)
        x += seg + gap
    ld.line([(hub[0] + 176, hub[1]), (1520, dash_y), (start_x, dash_y)], fill=(251, 191, 36, 150), width=16, joint="curve")

    # 线上小「数据包」
    for (x, y, color) in (
        (700, 620, (186, 230, 253, 245)),
        (820, 1428, (186, 230, 253, 245)),
        (1500, 872, (186, 230, 253, 245)),
        (1300, 1180, (253, 224, 71, 245)),
    ):
        ld.ellipse((x - 14, y - 14, x + 14, y + 14), fill=color)

    base.alpha_composite(layer)


def draw_hub(base: Image.Image) -> None:
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = 1180, 1024
    r = 200
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(9, 22, 42, 255), outline=(56, 189, 248, 255), width=18)
    r2 = 150
    d.ellipse((cx - r2, cy - r2, cx + r2, cy + r2), outline=(56, 189, 248, 110), width=6)

    # 路由叉形符号：一个入口分两路
    ink = (224, 242, 254, 255)
    d.line([(cx - 96, cy), (cx - 6, cy)], fill=ink, width=20)
    d.ellipse((cx - 108, cy - 12, cx - 84, cy + 12), fill=ink)
    d.line([(cx - 6, cy), (cx + 84, cy - 74)], fill=ink, width=20)
    d.line([(cx - 6, cy), (cx + 84, cy + 74)], fill=ink, width=20)
    d.ellipse((cx + 70, cy - 88, cx + 100, cy - 58), fill=ink)
    d.ellipse((cx + 70, cy + 58, cx + 100, cy + 88), fill=ink)
    d.ellipse((cx - 34, cy - 26, cx + 22, cy + 26), fill=(11, 26, 48, 255), outline=(224, 242, 254, 255), width=8)

    base.alpha_composite(layer)


def draw_side_nodes(base: Image.Image) -> None:
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 左侧 provider 节点
    left = [
        ((300, 512, 468, 680), (14, 116, 144, 255), (125, 211, 252, 235), (56, 189, 248, 255)),
        ((300, 916, 468, 1084), (109, 40, 217, 190), (196, 181, 253, 235), (167, 139, 250, 255)),
        ((300, 1320, 468, 1488), (146, 64, 14, 190), (253, 224, 71, 235), (251, 191, 36, 255)),
    ]
    for (box, fill, border, accent) in left:
        node(d, box, fill, border, 10)
        x0, y0, x1, y1 = box
        # 节点内的小「模型」符号：三条横杠
        for i, factor in enumerate((0.34, 0.5, 0.66)):
            yy = int(lerp(y0, y1, factor))
            pad = 46 + i * 16
            d.rounded_rectangle((x0 + pad, yy - 8, x1 - pad, yy + 8), radius=8, fill=accent)

    # 右侧输出节点
    right = [
        ((1700, 640, 1852, 792), (8, 47, 73, 235), (125, 211, 252, 235)),
        ((1700, 1196, 1852, 1348), (76, 29, 12, 225), (253, 224, 71, 235)),
    ]
    for (box, fill, border) in right:
        node(d, box, fill, border, 8)
        x0, y0, x1, y1 = box
        d.ellipse((x0 + 42, y0 + 42, x1 - 42, y1 - 42), fill=border)

    base.alpha_composite(layer)


def draw_label(base: Image.Image) -> None:
    layer = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    text = "PROVIDER POOL"
    try:
        from PIL import ImageFont

        font = ImageFont.load_default(size=92)
    except Exception:  # very old Pillow
        font = None
    if font is not None:
        bbox = d.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        d.text(((CANVAS - w) / 2, 1748), text, font=font, fill=(229, 237, 255, 150))
    base.alpha_composite(layer)


def main() -> None:
    img = build_background()
    add_glow(img)
    add_dot_grid(img)
    draw_lines(img)
    draw_hub(img)
    draw_side_nodes(img)
    draw_label(img)

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes, {img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
