"""Generate PNG favicons by drawing directly with PIL (no SVG renderer needed)."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).parent.parent / 'public'
BLUE = (14, 165, 233)
WHITE = (255, 255, 255)

def draw(size: int) -> Image.Image:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 64.0

    # Pin teardrop: rounded top + triangle point
    cx, cy_top = 32 * s, 28 * s
    r = 25 * s
    d.ellipse([cx - r, cy_top - r, cx + r, cy_top + r], fill=BLUE)
    d.polygon([
        (cx - 13 * s, cy_top + 18 * s),
        (cx + 13 * s, cy_top + 18 * s),
        (cx, cy_top + 33 * s),
    ], fill=BLUE)

    # House silhouette inside pin head (roof + walls as one polygon)
    d.polygon([
        (14 * s, 33 * s),
        (32 * s, 16 * s),
        (50 * s, 33 * s),
        (43 * s, 33 * s),
        (43 * s, 43 * s),
        (21 * s, 43 * s),
        (21 * s, 33 * s),
    ], fill=WHITE)
    return img

for size in (16, 32, 48, 64, 180, 192, 512):
    out = OUT / f'favicon-{size}.png'
    draw(size).save(out)
    print(f'  wrote {out.name} ({size}x{size})')

# Apple touch icon — Apple recommends apple-touch-icon.png at 180x180
draw(180).save(OUT / 'apple-touch-icon.png')
print('  wrote apple-touch-icon.png (180x180)')

# Classic .ico (multi-res) for legacy browsers
ico_imgs = [draw(s) for s in (16, 32, 48)]
ico_imgs[0].save(OUT / 'favicon.ico', format='ICO',
                 sizes=[(16, 16), (32, 32), (48, 48)],
                 append_images=ico_imgs[1:])
print('  wrote favicon.ico (16/32/48)')
