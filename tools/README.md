# tools

Python scripts that paint the game's art. Needs `pip install numpy scipy pillow`.

- `paint_art.py` — the watercolour engine and every texture/illustration in `public/art/`
  (paper, linen, sage wood, blue board, sea, hulls, discs, RPS cards, box covers, sprigs, hero).
  Run from the repo root: `python3 tools/paint_art.py` (writes to `public/art/`).
- `make_icons.py` — home-screen icons in `public/icons/` from the painted discs and linen.
