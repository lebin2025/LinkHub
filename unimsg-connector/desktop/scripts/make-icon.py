#!/usr/bin/env python3
"""生成 LinkHub 桌面版图标（无需外部素材）。

产物（提交进仓库，构建时直接用，避免每次打包依赖 Python）：
  desktop/assets/icon.png  512x512（窗口图标 / 关于页）
  desktop/assets/icon.ico  多尺寸（exe 图标：16/24/32/48/64/128/256）

用法：python desktop/scripts/make-icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SS = 4  # 超采样倍数（先画 2048 再缩小，得到平滑边缘）
BASE = 512
SIZE = BASE * SS

ASSETS = Path(__file__).resolve().parent.parent / "assets"


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    # 1) 圆角方形背景 + 蓝青渐变
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    grad = Image.new("RGBA", (SIZE, SIZE))
    gd = ImageDraw.Draw(grad)
    c1 = (37, 99, 235)   # #2563EB
    c2 = (14, 165, 233)  # #0EA5E9
    for y in range(SIZE):
        t = y / (SIZE - 1)
        gd.line([(0, y), (SIZE, y)], fill=(lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t), 255))

    mask = Image.new("L", (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    radius = int(SIZE * 0.22)
    md.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # 2) 白色消息气泡（圆角矩形 + 小尾巴）+ 内部两条"消息"短线
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 255)
    bubble = [int(SIZE * 0.20), int(SIZE * 0.24), int(SIZE * 0.80), int(SIZE * 0.66)]
    d.rounded_rectangle(bubble, radius=int(SIZE * 0.085), fill=white)
    # 气泡尾巴（左下小三角）
    tail = [
        (int(SIZE * 0.29), int(SIZE * 0.64)),
        (int(SIZE * 0.29), int(SIZE * 0.79)),
        (int(SIZE * 0.44), int(SIZE * 0.66)),
    ]
    d.polygon(tail, fill=white)
    # 两条消息线（蓝色，与背景同色系）
    line_color = (14, 118, 214, 255)
    lw = int(SIZE * 0.038)
    d.rounded_rectangle(
        [int(SIZE * 0.30), int(SIZE * 0.36), int(SIZE * 0.70), int(SIZE * 0.36) + lw],
        radius=lw // 2, fill=line_color,
    )
    d.rounded_rectangle(
        [int(SIZE * 0.30), int(SIZE * 0.47), int(SIZE * 0.60), int(SIZE * 0.47) + lw],
        radius=lw // 2, fill=line_color,
    )

    icon512 = img.resize((BASE, BASE), Image.LANCZOS)
    icon512.save(ASSETS / "icon.png")

    # 3) ICO（256 基准 + 多尺寸）
    ico_base = img.resize((256, 256), Image.LANCZOS)
    ico_base.save(
        ASSETS / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("生成：", ASSETS / "icon.png", ASSETS / "icon.ico")


if __name__ == "__main__":
    main()