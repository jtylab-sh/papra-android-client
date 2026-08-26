#!/usr/bin/env python3
"""Generate all app icons. Papra-ish: white document, emerald fold, dark ground."""
from PIL import Image, ImageDraw

S = 1024
BG = "#0d1512"
EMERALD = "#10b981"
PAPER = "#f4f7f6"
LINE = "#94a3ad"

def glyph(color_paper=PAPER, color_accent=EMERALD, color_line=LINE):
    """Document glyph on transparent 1024x1024, drawn 4x for antialiasing."""
    F = 4
    img = Image.new("RGBA", (S * F, S * F), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # sheet: x 312..712, y 252..772 (within adaptive-icon safe zone), fold 110
    x0, y0, x1, y1, fold, r = 312 * F, 252 * F, 712 * F, 772 * F, 110 * F, 36 * F
    # sheet with clipped top-right corner
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=color_paper)
    d.polygon([(x1 - fold, y0 - 1), (x1 + 1, y0 - 1), (x1 + 1, y0 + fold)], fill=(0, 0, 0, 0))
    # fold triangle
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=color_accent)
    # text lines
    lw = 8 * F
    for i, (lx1, ly) in enumerate([(600, 400), (640, 480), (640, 560)]):
        d.rounded_rectangle([384 * F, ly * F, lx1 * F, (ly + 34) * F], radius=17 * F,
                            fill=color_line if i else color_accent)
    # tag chip
    d.rounded_rectangle([384 * F, 648 * F, 520 * F, 700 * F], radius=26 * F, fill=color_accent)
    return img.resize((S, S), Image.LANCZOS)

g = glyph()
mono = glyph("#ffffff", "#ffffff", "#ffffff")

icon = Image.new("RGBA", (S, S), BG); icon.alpha_composite(g)
icon.convert("RGB").save("assets/images/icon.png")
g.save("assets/images/android-icon-foreground.png")
mono.save("assets/images/android-icon-monochrome.png")
Image.new("RGBA", (S, S), BG).convert("RGB").save("assets/images/android-icon-background.png")
g.save("assets/images/splash-icon.png")
icon.resize((48, 48), Image.LANCZOS).convert("RGB").save("assets/images/favicon.png")
print("icons written")
