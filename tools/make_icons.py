"""Builds the home-screen icons from the painted art: two watercolour discs on the linen tablecloth.
Run from the repo root:  python3 tools/make_icons.py"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import os

ART = 'public/art'
OUT = 'public/icons'
os.makedirs(OUT, exist_ok=True)


def tile(img, size):
    out = Image.new('RGB', (size, size))
    for y in range(0, size, img.height):
        for x in range(0, size, img.width):
            out.paste(img, (x, y))
    return out


def disc(name, d, paper):
    """watercolour disc multiplied over a circle of paper, with a soft drop shadow"""
    art = Image.open(f'{ART}/{name}').convert('RGBA').resize((d, d), Image.LANCZOS)
    p = paper.resize((d, d)).convert('RGB')
    a = np.asarray(art).astype(float) / 255
    pp = np.asarray(p).astype(float) / 255
    rgb = pp * (1 - a[..., 3:4] + a[..., 3:4] * a[..., :3])
    mask = Image.new('L', (d, d), 0)
    ImageDraw.Draw(mask).ellipse([d * 0.06, d * 0.06, d * 0.94, d * 0.94], fill=255)
    im = Image.fromarray((rgb * 255).astype('uint8')).convert('RGBA')
    im.putalpha(mask)
    return im


def icon(size, safe=1.0):
    linen = Image.open(f'{ART}/linen.jpg').convert('RGB')
    linen = linen.resize((int(linen.width * size / 512), int(linen.height * size / 512)))
    bg = tile(linen, size).convert('RGBA')
    # warm lamp glow + vignette, like the app
    y, x = np.mgrid[0:size, 0:size] / size
    glow = np.clip(1 - np.hypot(x - 0.5, y + 0.05) * 1.4, 0, 1) * 0.28
    vig = np.clip(np.hypot(x - 0.5, y - 0.5) * 1.6 - 0.55, 0, 1) * 0.45
    arr = np.asarray(bg).astype(float)
    arr[..., :3] = arr[..., :3] * (1 - vig[..., None]) + np.array([255, 232, 190]) * glow[..., None]
    bg = Image.fromarray(np.clip(arr, 0, 255).astype('uint8'))
    paper = Image.open(f'{ART}/paper.jpg')
    d = int(size * 0.5 * safe)
    cx, cy = size // 2, size // 2
    for name, dx, dy in (('disc-yellow.png', 0.15, -0.11), ('disc-red.png', -0.12, 0.1)):
        dd = disc(name, d, paper)
        x0, y0 = int(cx + dx * size * safe - d / 2), int(cy + dy * size * safe - d / 2)
        sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        m = dd.split()[3]
        sh.paste((16, 26, 46, 110), (x0 + int(size * 0.012), y0 + int(size * 0.03)), m)
        bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(size * 0.02)))
        bg.alpha_composite(dd, (x0, y0))
    return bg.convert('RGB')


icon(512).save(f'{OUT}/icon-512.png', optimize=True)
icon(192).save(f'{OUT}/icon-192.png', optimize=True)
icon(180).save(f'{OUT}/apple-touch-icon.png', optimize=True)
icon(512, safe=0.78).save(f'{OUT}/icon-maskable-512.png', optimize=True)
icon(64).save('public/favicon.ico', sizes=[(32, 32), (64, 64)])
print('icons written to', OUT)
