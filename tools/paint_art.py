"""Watercolour art for Our Game Shelf.
A small procedural watercolour engine: noisy-edged washes with pigment pooling at the
edges, granulation and paper grain, plus wobbly ink lines. Everything renders at 2x."""
import numpy as np, os, sys, math
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, map_coordinates

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/art'
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)

INK = (35, 46, 70)


def noise(h, w, s, wrap=True):
    n = gaussian_filter(rng.standard_normal((h, w)), s, mode='wrap' if wrap else 'reflect')
    n -= n.min(); n /= n.max() + 1e-9
    return n


def save_rgb(a, name, q=84):
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name), quality=q, optimize=True, progressive=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


def save_rgba(a, name):
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
    img.save(os.path.join(OUT, name), optimize=True)
    print(name, os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


class Sheet:
    """A transparent painting surface. Washes accumulate as subtractive pigment."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.absorb = np.zeros((h, w, 3))   # how much of each channel the pigment removes
        self.grain = noise(h, w, 0.8) * 0.6 + noise(h, w, 2.5) * 0.4

    def wash(self, mask, color, strength=0.85, edge=0.9, bloom=0.35, gran=0.35, rough=0.18, blur=1.4, soft=False):
        h, w = self.h, self.w
        m = gaussian_filter(mask.astype(float), blur)
        if rough:
            m = m + (noise(h, w, 3) - 0.5) * rough + (noise(h, w, 9) - 0.5) * rough
        a = np.clip((m - 0.42) / 0.16, 0, 1) if not soft else np.clip(m, 0, 1)
        inner = gaussian_filter(a, 5)
        rim = np.clip(a - inner, 0, 1) * 2.2
        low = noise(h, w, 22)
        dens = a * (strength * (1 - bloom + bloom * low)) + rim * edge * strength
        dens *= (1 - gran * 0.5) + gran * self.grain
        col = np.array(color, float) / 255
        k = 1 - col                       # what the pigment absorbs
        self.absorb = 1 - (1 - self.absorb) * (1 - np.clip(dens, 0, 1.2)[..., None] * k)
        return a

    def ink(self, paths, width=2.2, color=INK, alpha=0.92, wobble=1.2):
        img = Image.new('L', (self.w, self.h), 0)
        d = ImageDraw.Draw(img)
        for pts in paths:
            jit = [(x + rng.normal(0, wobble * 0.4), y + rng.normal(0, wobble * 0.4)) for x, y in pts]
            for i in range(len(jit) - 1):
                wv = width * rng.uniform(0.75, 1.15)
                d.line([jit[i], jit[i + 1]], fill=255, width=max(1, int(round(wv))), joint='curve')
        a = np.asarray(img.filter(ImageFilter.GaussianBlur(0.6)), float) / 255 * alpha
        a *= 0.8 + 0.2 * self.grain
        k = 1 - np.array(color, float) / 255
        self.absorb = 1 - (1 - self.absorb) * (1 - a[..., None] * k * 1.05)

    def rgba(self):
        # express subtractive pigment as colour + alpha for use with multiply over paper
        A = np.clip(self.absorb.max(axis=2), 0, 1)
        safe = np.where(A > 1e-4, A, 1)
        rgb = 1 - self.absorb / safe[..., None]
        out = np.dstack([rgb * 255, A * 255])
        return out

    def over_paper(self, paper):
        return paper * (1 - self.absorb)


def disk(w, h, cx, cy, r):
    y, x = np.mgrid[0:h, 0:w]
    return ((x - cx) ** 2 + (y - cy) ** 2) <= r * r


def ellipse(w, h, cx, cy, rx, ry, ang=0):
    y, x = np.mgrid[0:h, 0:w].astype(float)
    x, y = x - cx, y - cy
    c, s = math.cos(ang), math.sin(ang)
    xr, yr = x * c + y * s, -x * s + y * c
    return (xr / rx) ** 2 + (yr / ry) ** 2 <= 1


def poly(w, h, pts):
    img = Image.new('L', (w, h), 0); ImageDraw.Draw(img).polygon(pts, fill=255)
    return np.asarray(img) > 127


def rrect(w, h, x0, y0, x1, y1, r):
    img = Image.new('L', (w, h), 0); ImageDraw.Draw(img).rounded_rectangle([x0, y0, x1, y1], r, fill=255)
    return np.asarray(img) > 127


def circle_path(cx, cy, r, n=48, start=0, end=2 * math.pi):
    return [(cx + r * math.cos(start + (end - start) * i / n), cy + r * math.sin(start + (end - start) * i / n)) for i in range(n + 1)]


# ---------------- palette ----------------
RED = (196, 72, 52)
OCHRE = (226, 168, 60)
SEA = (58, 106, 140)
SKY = (138, 176, 204)
SAGE = (128, 160, 122)
OLIVE = (92, 122, 78)
PLUM = (128, 76, 108)
GREY = (122, 128, 132)
STONE = (140, 132, 120)
NAVY = (40, 60, 98)

# ================= surfaces =================
# cold-press watercolour paper, warm white, tileable
def paper_tile(n=768, base=(246, 240, 228)):
    hgt = noise(n, n, 1.6) * 0.35 + noise(n, n, 4) * 0.4 + noise(n, n, 12) * 0.25
    gy, gx = np.gradient(hgt)
    shade = 1 + (gx * -1.0 + gy * -1.0) * 1.25
    mott = noise(n, n, 60)
    col = np.array(base, float)[None, None, :] * shade[..., None] * (0.985 + 0.03 * mott[..., None])
    return col

paper = paper_tile()
save_rgb(paper, 'paper.jpg', 82)

# denim-blue linen tablecloth (the "table" everything sits on)
def linen(n=512, c1=(92, 118, 146), c2=(120, 146, 172)):
    y, x = np.mgrid[0:n, 0:n].astype(float)
    period = 4.0
    warp = np.sin(x / period * 2 * math.pi) ** 2
    weft = np.sin(y / period * 2 * math.pi) ** 2
    slub_h = noise(n, n, 0.5)[:, :1].repeat(n, 1) * 0 + gaussian_filter(rng.standard_normal((n, 1)), 2, mode='wrap').repeat(n, 1)
    slub_v = gaussian_filter(rng.standard_normal((1, n)), 2, mode='wrap').repeat(n, 0)
    checker = ((np.floor(x / period) + np.floor(y / period)) % 2)
    t = np.where(checker > 0, warp, weft) * 0.55 + 0.25 * (slub_h * 0.5 + slub_v * 0.5 + 0.5) + 0.2 * noise(n, n, 30)
    t = (t - t.min()) / (t.max() - t.min())
    c1, c2 = np.array(c1, float), np.array(c2, float)
    return c1 + (c2 - c1) * t[..., None]

save_rgb(linen(), 'linen.jpg', 80)

# milk-painted sage cupboard wood (grain visible through paint), for the dresser
def painted_wood(w, h, c_lo, c_hi, grain_len=60):
    y, x = np.mgrid[0:h, 0:w].astype(float)
    warp = gaussian_filter(rng.standard_normal((h, w)), (12, grain_len * 2), mode='wrap') * 120
    rings = (np.sin((y + warp) * 0.06) * 0.5 + 0.5) ** 2
    fib = gaussian_filter(rng.standard_normal((h, w)), (0.6, grain_len), mode='wrap')
    fib = (fib - fib.min()) / (fib.max() - fib.min())
    wear = noise(h, w, 18)
    t = 0.35 * rings + 0.35 * fib + 0.3 * wear
    t = (t - t.min()) / (t.max() - t.min())
    lo, hi = np.array(c_lo, float), np.array(c_hi, float)
    col = lo + (hi - lo) * t[..., None]
    # chipped paint showing pale wood underneath
    chips = noise(h, w, 2.5)
    chip = np.clip((chips - 0.83) / 0.05, 0, 1) * np.clip((wear - 0.55) / 0.2, 0, 1)
    col = col * (1 - chip[..., None]) + np.array([214, 190, 150]) * chip[..., None]
    return col

save_rgb(painted_wood(1000, 400, (98, 126, 104), (150, 172, 146)), 'sage-wood.jpg', 82)
save_rgb(painted_wood(900, 760, (34, 62, 104), (66, 100, 146), 50), 'blue-board.jpg', 82)

# watercolour sea for the Battleships chart
def sea_tile(n=800):
    s = Sheet(n, n)
    full = np.ones((n, n), bool)
    s.wash(full, (150, 190, 210), strength=0.55, bloom=0.6, rough=0, soft=True, gran=0.5)
    for k in range(5):
        f = gaussian_filter(rng.standard_normal((n, n)), (22 + k * 4, 70 + k * 10), mode='wrap')
        f = (f - f.min()) / (f.max() - f.min())
        s.wash(f > 0.6, SEA if k % 2 else SKY, strength=0.3, edge=0.35, bloom=0.6, rough=0.12, blur=5)
    return s.over_paper(paper_tile(n, (240, 238, 230)))

save_rgb(sea_tile(), 'sea.jpg', 82)

# ship hull paint (warm grey with weathering)
def hull_tex(w=400, h=120):
    s = Sheet(w, h)
    s.wash(np.ones((h, w), bool), (138, 146, 140), strength=0.75, bloom=0.5, rough=0, soft=True, gran=0.8)
    s.wash(noise(h, w, 6) > 0.6, (90, 98, 96), strength=0.35, rough=0.2, blur=2)
    return s.over_paper(paper_tile(max(w, h), (238, 234, 222))[:h, :w])

save_rgb(hull_tex(), 'hull.jpg', 84)

# ================= illustrations =================
def disc_art(color, name, S=200):
    s = Sheet(S, S)
    c = S / 2
    s.wash(disk(S, S, c, c, S * 0.44), color, strength=0.9, edge=1.0, rough=0.12)
    s.wash(disk(S, S, c, c, S * 0.3), tuple(int(v * 0.8) for v in color), strength=0.35, edge=1.2, rough=0.1)
    s.ink([circle_path(c, c, S * 0.44)], width=2.4, alpha=0.55)
    s.ink([circle_path(c, c, S * 0.3, 40, 0.3, 2.4)], width=1.6, alpha=0.4)
    save_rgba(s.rgba(), name)

disc_art(RED, 'disc-red.png')
disc_art(OCHRE, 'disc-yellow.png')

# rock · paper · scissors
def rps_rock(S=360):
    s = Sheet(S, S)
    pts = [(70, 250), (60, 190), (95, 135), (160, 105), (235, 112), (290, 150), (305, 210), (285, 262), (220, 285), (130, 285)]
    s.wash(poly(S, S, pts), STONE, strength=0.85, edge=0.9, gran=0.9, rough=0.14)
    s.wash(poly(S, S, [(110, 170), (160, 130), (220, 135), (190, 175), (130, 195)]), (220, 214, 200), strength=0.25, rough=0.2)
    s.wash(poly(S, S, [(200, 230), (280, 205), (285, 255), (220, 278)]), (90, 84, 78), strength=0.45, rough=0.2)
    s.wash(ellipse(S, S, 185, 300, 120, 14), (60, 70, 90), strength=0.3, rough=0.2, blur=4)
    s.ink([pts + [pts[0]]], width=3)
    s.ink([[(150, 160), (175, 150), (205, 158)], [(230, 240), (255, 232)]], width=2, alpha=0.6)
    save_rgba(s.rgba(), 'rps-rock.png')

def rps_paper(S=360):
    s = Sheet(S, S)
    sheet = [(95, 60), (235, 60), (285, 110), (285, 300), (95, 300)]
    s.wash(poly(S, S, sheet), (236, 230, 214), strength=0.5, edge=0.6, rough=0.06)
    s.wash(poly(S, S, [(235, 60), (285, 110), (235, 110)]), (180, 170, 150), strength=0.5, rough=0.05)
    s.wash(ellipse(S, S, 192, 318, 110, 10), (60, 70, 90), strength=0.25, rough=0.2, blur=4)
    for yy in range(140, 280, 26):
        s.wash(rrect(S, S, 120, yy, 260 if yy < 250 else 210, yy + 3, 1), SKY, strength=0.7, rough=0.03, blur=0.8)
    s.wash(rrect(S, S, 140, 120, 143, 285, 1), RED, strength=0.5, rough=0.03, blur=0.8)
    s.ink([sheet + [sheet[0]], [(235, 60), (235, 110), (285, 110)]], width=3)
    save_rgba(s.rgba(), 'rps-paper.png')

def rps_scissors(S=360):
    s = Sheet(S, S)
    # blades
    b1 = [(170, 190), (300, 60), (312, 72), (190, 205)]
    b2 = [(180, 205), (70, 70), (82, 60), (198, 188)]
    s.wash(poly(S, S, b1), (176, 186, 192), strength=0.8, gran=0.4, rough=0.05)
    s.wash(poly(S, S, b2), (196, 204, 208), strength=0.8, gran=0.4, rough=0.05)
    # handles
    for cx, cy in ((120, 262), (240, 270)):
        ring = disk(S, S, cx, cy, 46) & ~disk(S, S, cx, cy, 24)
        s.wash(ring, RED, strength=0.95, edge=1.1, rough=0.1)
        s.ink([circle_path(cx, cy, 46), circle_path(cx, cy, 24)], width=2.6)
    s.wash(poly(S, S, [(150, 230), (180, 200), (200, 210), (165, 245)]), RED, strength=0.9, rough=0.05)
    s.wash(poly(S, S, [(205, 235), (185, 210), (205, 195), (225, 228)]), RED, strength=0.9, rough=0.05)
    s.ink([b1 + [b1[0]], b2 + [b2[0]]], width=2.6)
    s.ink([circle_path(186, 200, 6)], width=3)
    save_rgba(s.rgba(), 'rps-scissors.png')

rps_rock(); rps_paper(); rps_scissors()

# botanical sprig (decoration)
def sprig(name, S=(300, 420), color=SAGE, color2=OLIVE, seed=0, flower=None):
    W, H = S
    s = Sheet(W, H)
    stem = []
    for i in range(30):
        t = i / 29
        stem.append((W * 0.5 + math.sin(t * 2.4 + seed) * 30 * t, H * 0.95 - t * H * 0.85))
    leaves_ink = []
    for i in range(3, 29, 3):
        x, y = stem[i]
        side = 1 if (i // 3) % 2 else -1
        ang = -math.pi / 2 + side * rng.uniform(0.7, 1.1)
        L = rng.uniform(40, 62) * (1 - i / 45)
        cx, cy = x + math.cos(ang) * L * 0.55, y + math.sin(ang) * L * 0.55
        m = ellipse(W, H, cx, cy, L * 0.55, L * 0.2, ang)
        s.wash(m, color if i % 2 else color2, strength=0.8, edge=1.0, rough=0.08)
        leaves_ink.append([(x, y), (x + math.cos(ang) * L * 0.9, y + math.sin(ang) * L * 0.9)])
    if flower:
        x, y = stem[-1]
        for k in range(5):
            a = k * 2 * math.pi / 5
            s.wash(ellipse(W, H, x + math.cos(a) * 14, y + math.sin(a) * 14, 13, 8, a), flower, strength=0.85, rough=0.08)
        s.wash(disk(W, H, x, y, 6), OCHRE, strength=0.9, rough=0.05)
    s.ink([stem], width=2.2)
    s.ink(leaves_ink, width=1.3, alpha=0.6)
    save_rgba(s.rgba(), name)

sprig('sprig-a.png', seed=0.4, flower=(222, 140, 150))
sprig('sprig-b.png', (260, 380), color=(150, 176, 120), color2=SAGE, seed=1.7)

# ---- game box covers (portrait 3:4, 360x480) ----
def box_c4(W=360, H=480):
    s = Sheet(W, H)
    cols, rows = 4, 4
    reserve = disk(W, H, 292, 70, 30)
    for r in range(rows):
        for c in range(cols):
            reserve |= disk(W, H, 70 + c * 74, 150 + r * 74, 31)
    s.wash(rrect(W, H, 8, 8, W - 8, H - 8, 10) & ~reserve, (56, 104, 178), strength=0.93, bloom=0.38, edge=0.7, gran=0.2, rough=0.05)
    for r in range(rows):
        for c in range(cols):
            cx, cy = 70 + c * 74, 150 + r * 74
            pick = (r * 7 + c * 3) % 5
            if r >= 1 and pick in (0, 2):
                s.wash(disk(W, H, cx, cy, 28), RED if (r + c) % 2 else OCHRE, strength=0.95, edge=1.1, rough=0.1)
                s.ink([circle_path(cx, cy, 28)], width=2, alpha=0.5)
            else:
                s.wash(disk(W, H, cx, cy, 28), (26, 44, 86), strength=0.85, rough=0.08)
                s.ink([circle_path(cx, cy, 28)], width=1.6, alpha=0.35)
    # falling disc
    s.wash(disk(W, H, 292, 70, 26), RED, strength=0.95, edge=1.1, rough=0.1)
    s.ink([circle_path(292, 70, 26), [(292, 16), (292, 34)], [(275, 20), (280, 36)], [(309, 20), (304, 36)]], width=2)
    save_rgba(s.rgba(), 'box-c4.png')

def box_bs(W=360, H=480):
    s = Sheet(W, H)
    hull0 = [(66, 226), (304, 226), (280, 274), (92, 274)]
    reserve = poly(W, H, hull0) | rrect(W, H, 136, 192, 234, 236, 6) | rrect(W, H, 168, 162, 200, 200, 4) | disk(W, H, 250, 372, 18)
    s.wash(rrect(W, H, 8, 8, W - 8, H - 8, 10) & ~reserve, (40, 84, 132), strength=0.93, bloom=0.38, edge=0.7, gran=0.25, rough=0.05)
    # chart grid in pale ink
    grid = [[(30 + i * 30, 30), (30 + i * 30, H - 30)] for i in range(11)] + [[(30, 30 + i * 30), (W - 30, 30 + i * 30)] for i in range(15)]
    s.ink(grid, width=1.4, color=(14, 30, 52), alpha=0.35, wobble=0.6)
    # waves
    for k in range(6):
        y0 = 250 + k * 34
        pts = [(x, y0 + math.sin(x / 26 + k) * 6) for x in range(20, W - 20, 8)]
        s.ink([pts], width=2, color=(150, 190, 214), alpha=0.6)
    # ship
    hull = [(70, 230), (300, 230), (276, 270), (96, 270)]
    s.wash(poly(W, H, hull), (150, 156, 150), strength=0.95, gran=0.7, rough=0.05)
    s.wash(rrect(W, H, 140, 196, 230, 232, 4), (174, 178, 170), strength=0.95, rough=0.05)
    s.wash(rrect(W, H, 172, 166, 196, 198, 3), (120, 126, 124), strength=0.95, rough=0.05)
    s.wash(rrect(W, H, 92, 262, 282, 270, 2), RED, strength=0.9, rough=0.03)
    s.ink([hull + [hull[0]], [(140, 232), (140, 196), (230, 196), (230, 232)], [(172, 196), (172, 166), (196, 166), (196, 196)], [(110, 214), (140, 214)]], width=2.2, color=(20, 26, 40))
    # splash + hit
    for r in (14, 26, 38):
        s.ink([circle_path(90, 380, r)], width=2, color=(232, 240, 242), alpha=0.85)
    s.wash(disk(W, H, 250, 372, 14), RED, strength=1, edge=1.2, rough=0.1)
    s.wash(disk(W, H, 250, 372, 30), OCHRE, strength=0.4, rough=0.25, blur=4)
    save_rgba(s.rgba(), 'box-bs.png')

def box_gw(W=360, H=480):
    s = Sheet(W, H)
    reserve = np.zeros((H, W), bool)
    for r in range(2):
        for c in range(3):
            reserve |= rrect(W, H, 36 + c * 100, 60 + r * 150, 122 + c * 100, 184 + r * 150, 8)
    s.wash(rrect(W, H, 8, 8, W - 8, H - 8, 10) & ~reserve, (150, 84, 122), strength=0.9, bloom=0.38, edge=0.7, gran=0.2, rough=0.05)
    skins = [(232, 190, 160), (196, 140, 104), (150, 100, 70), (226, 176, 140), (176, 120, 90), (240, 204, 176)]
    hairs = [(80, 50, 30), (30, 26, 24), (200, 150, 60), (120, 70, 40), (60, 40, 30), (180, 90, 50)]
    k = 0
    for r in range(2):
        for c in range(3):
            x0, y0 = 36 + c * 100, 60 + r * 150
            s.wash(rrect(W, H, x0, y0, x0 + 86, y0 + 124, 8), (238, 222, 200), strength=0.35, rough=0.04)
            s.ink([[(x0, y0), (x0 + 86, y0), (x0 + 86, y0 + 124), (x0, y0 + 124), (x0, y0)]], width=1.6, alpha=0.5)
            cx, cy = x0 + 43, y0 + 56
            s.wash(ellipse(W, H, cx, cy - 22, 26, 16), hairs[k], strength=0.9, rough=0.08)
            s.wash(disk(W, H, cx, cy, 22), skins[k], strength=0.85, rough=0.06)
            s.wash(ellipse(W, H, cx, cy + 52, 34, 22), [SAGE, SKY, RED, OCHRE, SEA, OLIVE][k], strength=0.85, rough=0.06)
            s.ink([[(cx - 8, cy - 2), (cx - 6, cy)], [(cx + 6, cy - 2), (cx + 8, cy)], [(cx - 7, cy + 9), (cx, cy + 12), (cx + 7, cy + 9)]], width=1.8, alpha=0.8)
            k += 1
    save_rgba(s.rgba(), 'box-gw.png')

box_c4(); box_bs(); box_gw()

# landing hero: a little tabletop still life — discs, a paper boat, pegs
def hero(W=760, H=420):
    s = Sheet(W, H)
    s.wash(ellipse(W, H, 380, 330, 330, 70), SKY, strength=0.35, rough=0.15, blur=6, bloom=0.7)
    # stack of discs
    for i, col in enumerate([RED, OCHRE, RED, OCHRE]):
        cy = 300 - i * 18
        s.wash(ellipse(W, H, 200, cy, 70, 22), col, strength=0.9, edge=1.0, rough=0.06)
        s.ink([[(200 + 70 * math.cos(a), cy + 22 * math.sin(a)) for a in np.linspace(0, math.pi, 30)]], width=2, alpha=0.5)
    s.ink([[(200 + 70 * math.cos(a), 246 + 22 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 50)]], width=2.2)
    # rolling disc
    s.wash(disk(W, H, 340, 290, 46), RED, strength=0.95, edge=1.1, rough=0.1)
    s.wash(disk(W, H, 340, 290, 30), (160, 54, 40), strength=0.35, edge=1.2, rough=0.08)
    s.ink([circle_path(340, 290, 46), circle_path(340, 290, 30, 40, 0.4, 2.6)], width=2.2)
    # paper boat
    boat = [(450, 270), (640, 270), (600, 320), (490, 320)]
    sail = [(520, 270), (560, 160), (600, 270)]
    s.wash(poly(W, H, boat), (236, 230, 214), strength=0.6, rough=0.04)
    s.wash(poly(W, H, sail), (240, 236, 224), strength=0.5, rough=0.04)
    s.wash(poly(W, H, [(560, 160), (600, 270), (560, 270)]), (190, 184, 166), strength=0.5, rough=0.04)
    s.wash(rrect(W, H, 470, 300, 620, 306, 2), SEA, strength=0.7, rough=0.03)
    s.ink([boat + [boat[0]], sail + [sail[0]], [(560, 160), (560, 270)]], width=2.4)
    for k in range(3):
        y0 = 336 + k * 14
        s.ink([[(x, y0 + math.sin(x / 18 + k) * 4) for x in range(430 + k * 20, 680 - k * 20, 6)]], width=2, color=SEA, alpha=0.7)
    # pegs
    for (x, y, c) in ((690, 240, RED), (712, 262, (236, 236, 230)), (668, 268, (236, 236, 230))):
        s.wash(disk(W, H, x, y, 11), c, strength=0.95, rough=0.05)
        s.ink([circle_path(x, y, 11, 20)], width=1.8)
    save_rgba(s.rgba(), 'hero.png')

hero()

# ================= Hues (the card game) =================
# One painted panel per suit colour (the number sits on it in the page), a four-colour panel for
# the wild cards, the card back and the box. Cards are 68x96 on screen, so these are 136x192.
HUE = {'lavender': (150, 126, 196), 'orange': (226, 118, 48), 'navy': (40, 70, 140), 'sage': (104, 146, 104)}
CW, CH = 136, 192

def rot_rect(cx, cy, w, h, ang):
    c, s = math.cos(ang), math.sin(ang)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2))]

def splatter(s, color, n, box, rmax=4):
    x0, y0, x1, y1 = box
    for _ in range(n):
        s.wash(disk(s.w, s.h, rng.uniform(x0, x1), rng.uniform(y0, y1), rng.uniform(1.5, rmax)), color, strength=0.8, rough=0.05, blur=0.8)

def hue_face(name, color):
    s = Sheet(CW, CH)
    s.wash(rrect(CW, CH, 8, 8, CW - 8, CH - 8, 10), color, strength=0.88, edge=0.9, bloom=0.4, gran=0.45, rough=0.14)
    s.wash(ellipse(CW, CH, CW / 2, CH / 2, 40, 54, 0.35), tuple(int(v * 0.72) for v in color), strength=0.45, edge=1.1, rough=0.18, blur=2)
    splatter(s, color, 7, (6, 6, CW - 6, CH - 6))
    save_rgba(s.rgba(), f'hue-{name}.png')

def hue_wild():
    s = Sheet(CW, CH)
    cols = list(HUE.values())
    for k, (cx, cy) in enumerate(((40, 52), (96, 52), (40, 140), (96, 140))):
        s.wash(ellipse(CW, CH, cx, cy, 40, 52, 0.5 + k) & rrect(CW, CH, 9, 9, CW - 9, CH - 9, 10), cols[k], strength=0.8, edge=1.0, bloom=0.5, gran=0.4, rough=0.16, blur=2)
    s.ink([rrect_path(8, 8, CW - 8, CH - 8)], width=1.6, alpha=0.35)
    save_rgba(s.rgba(), 'hue-wild.png')

def rrect_path(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]

def hue_back():
    s = Sheet(CW, CH)
    cx, cy = CW / 2, CH / 2
    spots = [(cx + 26 * math.cos(a), cy + 26 * math.sin(a)) for a in (-math.pi / 2, 0, math.pi / 2, math.pi)]
    reserve = disk(CW, CH, cx, cy, 9)
    for x, y in spots:
        reserve |= disk(CW, CH, x, y, 17)
    s.wash(rrect(CW, CH, 6, 6, CW - 6, CH - 6, 10) & ~reserve, (34, 58, 112), strength=0.92, bloom=0.45, gran=0.5, rough=0.08)
    for (x, y), col in zip(spots, HUE.values()):
        s.wash(disk(CW, CH, x, y, 15), col, strength=0.8, edge=1.1, rough=0.12)
    s.ink([rrect_path(14, 14, CW - 14, CH - 14)], width=1.6, color=(236, 226, 206), alpha=0.5)
    save_rgba(s.rgba(), 'hue-back.png')

def box_hu(W=360, H=480):
    s = Sheet(W, H)
    cards = [(130, 250, -0.32, 'sage'), (180, 232, -0.05, 'orange'), (232, 250, 0.26, 'lavender')]
    reserve = np.zeros((H, W), bool)
    for cx, cy, a, _ in cards:
        reserve |= poly(W, H, rot_rect(cx, cy, 128, 182, a))
    s.wash(rrect(W, H, 8, 8, W - 8, H - 8, 10) & ~reserve, (40, 70, 140), strength=0.92, bloom=0.4, edge=0.7, gran=0.3, rough=0.05)
    for i, (cx, cy, a, name) in enumerate(cards):
        outline = rot_rect(cx, cy, 128, 182, a)
        inner = poly(W, H, rot_rect(cx, cy, 110, 164, a))
        for j in range(i + 1, len(cards)):  # later cards lie on top
            inner &= ~poly(W, H, rot_rect(*cards[j][:2], 128, 182, cards[j][2]))
        s.wash(inner, HUE[name], strength=0.88, edge=1.0, rough=0.1)
        if i == len(cards) - 1:
            s.ink([outline + [outline[0]]], width=2.2)
            s.ink([circle_path(cx, cy, 30, 40, 0.6, 5.6)], width=4, color=(244, 236, 220), alpha=0.9)
    splatter(s, HUE['orange'], 6, (40, 380, 320, 450), 5)
    splatter(s, HUE['lavender'], 6, (40, 40, 320, 110), 5)
    save_rgba(s.rgba(), 'box-hu.png')

for k, v in HUE.items():
    hue_face(k, v)
hue_wild(); hue_back(); box_hu()

# ================= Quickfire (Words and Sums) =================
# The box: a cream stopwatch on a poppy wash, with three letter tiles under it: S, a blank, and a
# plus, for the two races inside.
def box_qf(W=360, H=480):
    s = Sheet(W, H)
    cx, cy, R = 180, 196, 104
    tiles = [(96, 392), (180, 392), (264, 392)]
    reserve = disk(W, H, cx, cy, R + 10) | rrect(W, H, cx - 18, cy - R - 44, cx + 18, cy - R - 2, 5) | ellipse(W, H, cx + 92, cy - 92, 19, 14, -0.8)
    for x, y in tiles:
        reserve |= rrect(W, H, x - 34, y - 36, x + 34, y + 36, 8)
    s.wash(rrect(W, H, 8, 8, W - 8, H - 8, 10) & ~reserve, (186, 70, 52), strength=0.9, bloom=0.42, edge=0.7, gran=0.3, rough=0.05)
    # the watch: ochre rim, cream face, crown and button, ink ticks and hands
    s.wash(disk(W, H, cx, cy, R + 8) & ~disk(W, H, cx, cy, R - 6), OCHRE, strength=0.92, edge=1.1, rough=0.08)
    s.wash(disk(W, H, cx, cy, R - 6), (244, 232, 206), strength=0.35, bloom=0.5, rough=0.08)
    s.wash(rrect(W, H, cx - 14, cy - R - 40, cx + 14, cy - R - 6, 4), OCHRE, strength=0.9, rough=0.05)
    s.wash(ellipse(W, H, cx + 92, cy - 92, 15, 10, -0.8), OCHRE, strength=0.95, edge=1.1, rough=0.04)
    ticks = []
    for i in range(12):
        a = i * math.pi / 6
        r0 = R - 22 if i % 3 else R - 30
        ticks.append([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)), (cx + (R - 12) * math.cos(a), cy + (R - 12) * math.sin(a))])
    s.ink([circle_path(cx, cy, R + 8), circle_path(cx, cy, R - 6)] + ticks, width=2.2)
    s.ink([[(cx, cy), (cx + 42, cy - 52)], [(cx, cy), (cx - 8, cy + 66)]], width=4.2)
    s.wash(disk(W, H, cx, cy, 9), RED, strength=1, rough=0.03)
    # three cream tiles with ink marks
    for x, y in tiles:
        s.wash(rrect(W, H, x - 30, y - 32, x + 30, y + 32, 7), (236, 214, 170), strength=0.55, edge=0.9, rough=0.06)
        s.ink([[(x - 30, y - 32), (x + 30, y - 32), (x + 30, y + 32), (x - 30, y + 32), (x - 30, y - 32)]], width=1.8, alpha=0.6)
    x, y = tiles[0]
    s.ink([[(x + 14, y - 16), (x + 4, y - 20), (x - 10, y - 16), (x - 12, y - 6), (x - 2, y), (x + 10, y + 6), (x + 12, y + 16), (x, y + 21), (x - 14, y + 16)]], width=4.4)
    x, y = tiles[1]
    s.ink([[(x - 14, y + 18), (x + 14, y + 18)]], width=4.4)
    x, y = tiles[2]
    s.ink([[(x - 16, y), (x + 16, y)], [(x, y - 16), (x, y + 16)]], width=4.4)
    splatter(s, OCHRE, 7, (30, 30, 330, 90), 5)
    save_rgba(s.rgba(), 'box-qf.png')

box_qf()
