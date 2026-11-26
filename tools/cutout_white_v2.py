import numpy as np
from PIL import Image
from scipy import ndimage

def c2a(rgb):
    """white color-to-alpha: returns alpha(0..1), unmixed rgb"""
    a = ((255 - rgb).max(axis=2) / 255.0)
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.clip((rgb - 255 * (1 - a[..., None])) / safe, 0, 255)
    return a, col

def cutout(img, thresh=28, band=2, hole_area=120, hole_dist=5, glow_box=None):
    rgb = np.asarray(img.convert('RGB')).astype(np.float32)
    dist = (255 - rgb).max(axis=2)
    near = dist < thresh
    lab, n = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    # enclosed holes: near-white blobs that are almost pure white (flat background, not shaded fabric)
    idx = np.arange(1, n + 1)
    areas = ndimage.sum(np.ones_like(dist), lab, idx)
    meds = ndimage.median(dist, lab, idx)
    p90 = ndimage.labeled_comprehension(dist, lab, idx, lambda v: np.percentile(v, 90), float, 0)
    holes = [i for i, ar, md, q in zip(idx, areas, meds, p90) if i not in border and ar >= hole_area and md <= hole_dist and q <= 12]
    if holes:
        bg |= np.isin(lab, holes)
    alpha = np.where(bg, 0.0, 1.0)
    col = rgb.copy()
    a2, c2 = c2a(rgb)
    edge = ndimage.binary_dilation(bg, iterations=band) & ~bg
    soft = edge.copy()
    if glow_box is not None:  # region where semi-transparent glow should stay translucent
        y0, y1, x0, x1 = glow_box
        gb = np.zeros_like(bg); gb[y0:y1, x0:x1] = True
        soft |= gb & ~bg & (rgb.min(axis=2) > 110)
    alpha[soft] = a2[soft]
    col[soft] = c2[soft]
    rgba = np.dstack([col, alpha * 255]).round().astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        pad = 6
        im = im.crop((max(0, bbox[0]-pad), max(0, bbox[1]-pad), min(im.width, bbox[2]+pad), min(im.height, bbox[3]+pad)))
    return im, len(holes)

def fit(im, maxside):
    s = maxside / max(im.size)
    return im.resize((round(im.width*s), round(im.height*s)), Image.LANCZOS) if s < 1 else im
