#!/usr/bin/env python3
"""把 art/ 里的原图压缩成游戏用图，输出到 build/images/。

- 人物立绘（heroine、hero_*、lord_*）：等比缩到高 640，并自动裁一张头像 avatar_<key>.png（128×128）
- 背景 bg_*：缩到 750 宽以内
- 其他图（动物、地块、道具）：最长边 256
- 全部转成 256 色调色板 PNG，控制小游戏包体（主包上限 4MB）

用法：python3 tools/build_art.py [输出目录，默认 build/images]
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "images"

PORTRAIT_H = 640
ICON = 256
AVATAR = 128
# 自动找头偏了的话在这里微调：水平偏移（头像边长的比例，正数往右）
AVATAR_DX = {"hero_caiwenji": -0.42, "hero_guanyu": 0.2}


def is_portrait(key: str) -> bool:
    return key == "heroine" or key.startswith(("hero_", "lord_"))


def save_small(img: Image.Image, path: Path):
    if img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255:
        save_alpha_palette(img, path)
        return
    q = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    q.save(path, optimize=True)


def save_alpha_palette(img: Image.Image, path: Path):
    """带透明的图存成 256 色调色板 PNG，但身体内部保证完全不透明。
    直接对 RGBA 做八叉树量化会把内部像素的不透明度压到 245 左右，浅色背景上看着发虚。
    做法：0 号色给全透明；完全不透明的像素用 224 色；半透明的边缘单独用 31 色（带各自的透明度）。"""
    import numpy as np
    a = np.array(img.getchannel("A"))
    a = np.where(a >= 235, 255, np.where(a <= 10, 0, a)).astype(np.uint8)
    rgb = np.array(img.convert("RGB"))
    h, w = a.shape
    idx = np.zeros((h, w), np.uint8)
    pal = [(0, 0, 0)]
    alphas = [0]
    op = a == 255
    if op.any():
        px = Image.fromarray(rgb[op].reshape(-1, 1, 3))
        q = px.quantize(colors=224, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        qp = q.getpalette()[: 224 * 3]
        n = len(qp) // 3
        idx[op] = np.array(q).reshape(-1) + 1
        pal += [tuple(qp[k * 3:k * 3 + 3]) for k in range(n)]
        alphas += [255] * n
        pal += [(0, 0, 0)] * (224 - n); alphas += [0] * (224 - n)
    else:
        pal += [(0, 0, 0)] * 224; alphas += [0] * 224
    edge = (a > 0) & (a < 255)
    if edge.any():
        e = np.concatenate([rgb[edge], a[edge][:, None]], axis=1).reshape(-1, 1, 4)
        q = Image.fromarray(e, "RGBA").quantize(colors=31, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        qp = q.getpalette(rawmode="RGBA")[: 31 * 4]
        n = len(qp) // 4
        idx[edge] = np.array(q).reshape(-1) + 225
        pal += [tuple(qp[k * 4:k * 4 + 3]) for k in range(n)]
        alphas += [qp[k * 4 + 3] for k in range(n)]
    out = Image.fromarray(idx, "P")
    flat = [c for t in pal for c in t]
    out.putpalette(flat + [0] * (768 - len(flat)))
    out.info["transparency"] = bytes(alphas + [0] * (256 - len(alphas)))
    out.save(path, optimize=True, transparency=bytes(alphas + [0] * (256 - len(alphas))))


def head_box(img: Image.Image, key: str = ""):
    """根据透明通道估计头部位置：取人物最上方一段，找不透明像素最密集的列（避开细长的武器）。"""
    a = img.getchannel("A")
    w, h = img.size
    bbox = a.getbbox() or (0, 0, w, h)
    top = bbox[1]
    band_h = int(h * 0.16)
    px = a.load()
    cols = []
    for x in range(w):
        n = 0
        for y in range(top, min(h, top + band_h), 2):
            if px[x, y] > 128:
                n += 1
        cols.append(n)
    peak = max(cols) or 1
    dense = [x for x, n in enumerate(cols) if n >= peak * 0.5]
    cx = (sum(dense) / len(dense)) if dense else w / 2
    side = int(h * 0.17)
    # 头顶可能被武器顶出，往下找到头部开始：从 cx 附近的列里找第一行较宽的不透明段
    y0 = top
    for y in range(top, top + band_h):
        run = sum(1 for x in range(int(cx - side * 0.3), int(cx + side * 0.3)) if 0 <= x < w and px[x, y] > 128)
        if run > side * 0.25:
            y0 = y
            break
    y0 = max(0, y0 - int(side * 0.08))
    x0 = int(cx - side / 2 + AVATAR_DX.get(key, 0) * side)
    return (x0, y0, x0 + side, y0 + side)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for f in sorted(SRC.glob("*.png")):
        key = f.stem
        img = Image.open(f).convert("RGBA")
        if is_portrait(key):
            w, h = img.size
            small = img.resize((round(w * PORTRAIT_H / h), PORTRAIT_H), Image.LANCZOS)
            save_small(small, OUT / f"{key}.png")
            box = head_box(img, key)
            av = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
            av.paste(img.crop(box), (0, 0))
            av = av.resize((AVATAR, AVATAR), Image.LANCZOS)
            save_small(av, OUT / f"avatar_{key}.png")
        elif key.startswith("bg_"):
            img = img.convert("RGB")
            img.thumbnail((750, 1334), Image.LANCZOS)
            save_small(img, OUT / f"{key}.png")
        else:
            img.thumbnail((ICON, ICON), Image.LANCZOS)
            save_small(img, OUT / f"{key}.png")
    for p in OUT.glob("*.png"):
        total += p.stat().st_size
    print(f"images -> {OUT}  共 {len(list(OUT.glob('*.png')))} 张，{total / 1024:.0f} KB")


if __name__ == "__main__":
    main()
