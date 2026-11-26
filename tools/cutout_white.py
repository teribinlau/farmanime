"""Remove a plain white background from generated art and save transparent PNGs.
Usage: python cutout_white.py manifest.json out_dir   (manifest: {"urls": {key: url}})
   or: python cutout_white.py --file in.png out.png [--max 768]
Only white pixels connected to the image border are removed, so white clothing inside the figure is kept.
"""
import sys, json, io, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

def cutout(img, thresh=28, feather=2):
    rgb = np.asarray(img.convert('RGB')).astype(np.int16)
    dist = (255 - rgb).max(axis=2)            # 0 = pure white
    near = dist < thresh
    lab, _ = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # soft edge: pixels next to background get alpha from how far they are from white
    edge = ndimage.binary_dilation(bg, iterations=feather) & ~bg
    alpha = np.where(bg, 0, 255).astype(np.float32)
    alpha[edge] = np.clip(dist[edge] / (thresh * 2.0), 0, 1) * 255
    # un-premultiply white from edge pixels so no white fringe
    a = (alpha / 255.0)[..., None]
    out = rgb.astype(np.float32)
    safe = np.maximum(a, 1e-3)
    out = np.where(a > 0, (out - 255 * (1 - a)) / safe, out)
    out = np.clip(out, 0, 255).astype(np.uint8)
    rgba = np.dstack([out, alpha.astype(np.uint8)])
    im = Image.fromarray(rgba, 'RGBA')
    bbox = im.getbbox()
    if bbox:
        pad = 8
        im = im.crop((max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(im.width, bbox[2]+pad), min(im.height, bbox[3]+pad)))
    return im

def fit(im, maxside):
    s = maxside / max(im.size)
    return im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS) if s < 1 else im

def size_for(key):
    if key == 'heroine': return 768
    if key.startswith(('hero_', 'lord_')): return 768
    if key in ('logo',): return 768
    return 256

if __name__ == '__main__':
    if sys.argv[1] == '--file':
        m = int(sys.argv[sys.argv.index('--max')+1]) if '--max' in sys.argv else 768
        fit(cutout(Image.open(sys.argv[2])), m).save(sys.argv[3]); sys.exit()
    man = json.load(open(sys.argv[1])); out = sys.argv[2]
    import os; os.makedirs(out, exist_ok=True)
    for key, url in man['urls'].items():
        url = url.split('?')[0]
        data = urllib.request.urlopen(url, timeout=60).read()
        im = Image.open(io.BytesIO(data))
        if key.startswith('tile_'):
            fit(im.convert('RGBA'), 256).save(f'{out}/{key}.png')
        else:
            fit(cutout(im), size_for(key)).save(f'{out}/{key}.png')
        print('ok', key)
