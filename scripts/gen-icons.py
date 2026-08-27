#!/usr/bin/env python3
"""Generate all app icons from assets/images/icon.svg.

Material-You style: a folded-corner document sheet with two content lines,
punched as transparent cutouts so it reads as a solid white/near-white
glyph on whatever sits behind it (papra-green for the flat icon, the
adaptive-icon backgroundColor for the Android layers).

Uses cairosvg to rasterize the SVG when available (the SVG is the design
source of truth); otherwise falls back to drawing the identical geometry
directly with PIL so this script still works with no extra dependency.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(HERE, "assets", "images")
SVG_PATH = os.path.join(IMG, "icon.svg")

S = 1024
GREEN = "#10b981"


def glyph_via_cairosvg():
    import cairosvg
    png_bytes = cairosvg.svg2png(url=SVG_PATH, output_width=S, output_height=S)
    import io
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")


def glyph_via_pil():
    """Same geometry as icon.svg, drawn 4x for antialiasing then downsampled."""
    F = 4
    img = Image.new("RGBA", (S * F, S * F), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1, fold, r = 312 * F, 252 * F, 712 * F, 772 * F, 110 * F, 36 * F
    white = (255, 255, 255, 255)
    clear = (0, 0, 0, 0)
    # page: rounded rect with the top-right corner clipped off diagonally
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=white)
    d.polygon([(x1 - fold, y0 - 1), (x1 + 1, y0 - 1), (x1 + 1, y0 + fold)], fill=clear)
    # folded flap, inset so a thin gap separates it from the clipped edge
    g = 16 * F
    d.polygon([(x1 - fold + g, y0 + g), (x1 - g, y0 + g), (x1 - g, y0 + fold - g)], fill=white)
    # two content lines, punched as holes
    d.rectangle([384 * F, 400 * F, 664 * F, 456 * F], fill=clear)
    d.rectangle([384 * F, 508 * F, 624 * F, 564 * F], fill=clear)
    return img.resize((S, S), Image.LANCZOS)


def make_glyph():
    try:
        return glyph_via_cairosvg()
    except ImportError:
        return glyph_via_pil()


def flatten(rgba_img, bg_hex):
    out = Image.new("RGBA", rgba_img.size, bg_hex)
    out.alpha_composite(rgba_img)
    return out.convert("RGB")


g = make_glyph()  # white glyph, transparent background, 1024x1024

flatten(g, GREEN).save(os.path.join(IMG, "icon.png"))
g.save(os.path.join(IMG, "android-icon-foreground.png"))
g.save(os.path.join(IMG, "android-icon-monochrome.png"))
Image.new("RGB", (S, S), GREEN).save(os.path.join(IMG, "android-icon-background.png"))
g.resize((512, 512), Image.LANCZOS).save(os.path.join(IMG, "splash-icon.png"))
flatten(g, GREEN).resize((48, 48), Image.LANCZOS).save(os.path.join(IMG, "favicon.png"))

print("icons written")
