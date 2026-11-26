#!/usr/bin/env python3
"""用 OpenAI 的 GPT Image 批量生成《云上小牧场》美术素材。

准备：
    pip install openai pillow
    export OPENAI_API_KEY=你的key        # Windows PowerShell: $env:OPENAI_API_KEY="你的key"

用法（在项目根目录运行）：
    python tools/gen_art.py --dry-run                 # 只打印提示词，不花钱
    python tools/gen_art.py --only sheep              # 先出一张，看画风
    python tools/gen_art.py --ref art_src/sheep.png   # 满意后，用它当画风参考批量出其余的图
    python tools/gen_art.py --only fox,owl --force    # 重画指定几张

输出：
    art_src/<key>.png                 原始 1024 图（留档，方便以后重新裁切）
    art/<key>.png    游戏用原图，npm run build 时会再压缩进 build/
"""
import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = Path(__file__).resolve().parent / "art_prompts.json"
SRC_DIR = ROOT / "art_src"
OUT_DIR = ROOT / "art"

# 游戏里用到的尺寸（像素）。图标 256 足够清晰，角色立绘留大一点。
OUT_SIZE = {"heroine": 768, "logo": 768}
DEFAULT_OUT = 256


def build_prompt(style: str, a: dict) -> str:
    if a.get("square_tile"):
        # 地形是铺满格子的方形贴图，不要透明背景
        return a["prompt"] + ". Same art style as: " + style.replace(
            "isolated on a fully transparent background", "filling the whole square edge to edge")
    return a["prompt"] + ". " + style


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("ART_MODEL", "gpt-image-1"),
                    help="图片模型名，默认 gpt-image-1；有更新的模型可以在这里换")
    ap.add_argument("--quality", default="medium", choices=["low", "medium", "high", "auto"])
    ap.add_argument("--only", default="", help="只生成这些 key，逗号分隔")
    ap.add_argument("--ref", default="", help="画风参考图路径（用已经满意的一张图统一风格）")
    ap.add_argument("--force", action="store_true", help="已存在的图也重新生成")
    ap.add_argument("--dry-run", action="store_true", help="只打印提示词")
    args = ap.parse_args()

    data = json.loads(PROMPTS.read_text(encoding="utf-8"))
    style = data["style"]
    only = {k.strip() for k in args.only.split(",") if k.strip()}
    assets = [a for a in data["assets"] if not only or a["key"] in only]
    if only - {a["key"] for a in assets}:
        sys.exit("找不到这些 key：" + ", ".join(sorted(only - {a['key'] for a in assets})))

    if args.dry_run:
        for a in assets:
            print(f"[{a['group']}] {a['key']}（{a['name']}）\n  {build_prompt(style, a)}\n")
        return

    try:
        from openai import OpenAI
        from PIL import Image
    except ImportError:
        sys.exit("请先运行：pip install openai pillow")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("请先设置环境变量 OPENAI_API_KEY")

    client = OpenAI()
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for n, a in enumerate(assets, 1):
        key = a["key"]
        src = SRC_DIR / f"{key}.png"
        out = OUT_DIR / f"{key}.png"
        if out.exists() and not args.force:
            print(f"({n}/{len(assets)}) 跳过 {key}，已存在（加 --force 重画）")
            continue
        prompt = build_prompt(style, a)
        transparent = not a.get("square_tile")
        print(f"({n}/{len(assets)}) 生成 {key}（{a['name']}）…", flush=True)
        for attempt in range(3):
            try:
                kw = dict(model=args.model, prompt=prompt, size="1024x1024", quality=args.quality, n=1)
                if transparent:
                    kw["background"] = "transparent"
                if args.ref and Path(args.ref).resolve() != src.resolve():
                    with open(args.ref, "rb") as f:
                        kw["prompt"] = ("Use the attached image only as a STYLE reference (line, shading, palette). "
                                        "Draw a completely new subject: " + prompt)
                        res = client.images.edit(image=[f], **kw)
                else:
                    res = client.images.generate(**kw)
                src.write_bytes(base64.b64decode(res.data[0].b64_json))
                break
            except Exception as e:  # 网络抖动或限流时重试
                print(f"  出错：{e}")
                if attempt == 2:
                    print(f"  放弃 {key}")
                    src = None
                else:
                    time.sleep(5 * (attempt + 1))
        if not src:
            continue
        size = OUT_SIZE.get(key, 512 if key.startswith(("hero_", "lord_")) else DEFAULT_OUT)
        img = Image.open(src).convert("RGBA")
        # 保持原比例，最长边缩到 size（竖长立绘不会被压扁）
        img.thumbnail((size, size), Image.LANCZOS)
        img.save(out)
        print(f"  已保存 {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
