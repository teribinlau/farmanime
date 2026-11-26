#!/usr/bin/env python3
"""把 build/web 打成一个自包含的 HTML（图片和音效内嵌为 base64），手机上直接打开就能玩。
用法：python3 tools/make_single_html.py build/web build/qunfang-ranch.html"""
import sys, base64, json
from pathlib import Path
src = Path(sys.argv[1]); out = Path(sys.argv[2])
imgs = {p.stem: 'data:image/png;base64,' + base64.b64encode(p.read_bytes()).decode() for p in sorted((src / 'images').glob('*.png'))}
html = (src / 'index.html').read_text(encoding='utf-8')
game = (src / 'game.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
snds = {p.stem: 'data:audio/wav;base64,' + base64.b64encode(p.read_bytes()).decode() for p in sorted((src / 'audio').glob('*.wav'))}
inline = '<script>window.__INLINE_IMAGES=' + json.dumps(imgs) + ';window.__INLINE_SOUNDS=' + json.dumps(snds) + ';</script>'
html = html.replace('<script src="game.js"></script>', inline + '\n<script>' + game + '</script>')
out.write_text(html, encoding='utf-8')
print(out, f'{out.stat().st_size/1024:.0f} KB', len(imgs), 'images')
