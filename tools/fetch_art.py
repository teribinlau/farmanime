#!/usr/bin/env python3
"""下载 tools/art_manifest.json 里列出的图（{key: url}），去掉白底后存到 art/<key>.png。
地块 tile_* 和背景 bg_* 不去底。已经存在的 key 跳过（加 --force 重下）。
需要能访问 files.tapnow.media 的网络；或者用 --from DIR 读本地的 DIR/<key>.img（或 .png）。"""
import io, json, sys, urllib.request
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from cutout_white_v2 import cutout, fit

ROOT = Path(__file__).resolve().parent.parent
man = json.loads((ROOT / 'tools/art_manifest.json').read_text())
force = '--force' in sys.argv
src = Path(sys.argv[sys.argv.index('--from') + 1]) if '--from' in sys.argv else None
for key, url in man.items():
    out = ROOT / 'art' / f'{key}.png'
    if out.exists() and not force and key not in man.get('_replace', []):
        continue
    if key.startswith('_'):
        continue
    if src:
        f = next((src / f'{key}{ext}' for ext in ('.img', '.png') if (src / f'{key}{ext}').exists()), None)
        if not f:
            print('missing', key); continue
        im = Image.open(f)
    else:
        req = urllib.request.Request(url.split('?')[0], headers={'User-Agent': 'farmanime-art-fetch'})
        im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    if key.startswith(('tile_', 'bg_')):
        im = fit(im.convert('RGB'), 1024)
    elif im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] < 16:
        # 已经是透明底，只裁掉空白边
        im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
        im = fit(im, 1024)
    else:
        im, _ = cutout(im)
        im = fit(im, 1024)
    im.save(out, optimize=True)
    print('ok', key, im.size)
