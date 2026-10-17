# Builds the web icons, link-preview picture, and Android launcher icons and splash screens
# from assets/logo.png. Run: python assets/make-icons.py  (needs Pillow: pip install pillow)
import os
from PIL import Image, ImageDraw, ImageFont

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
res = os.path.join(root, 'android/app/src/main/res')
icons = os.path.join(root, 'www/img/icons')
BG = (245, 247, 251, 255)  # the logo's own background colour
TITLE = 'Cầu Lông Hóc Môn 246'

logo = Image.open(os.path.join(root, 'assets/logo.png')).convert('RGBA').crop((4, 4, 153, 136))


def placed(size, fraction, height=None):
    """The logo centred on a size x height canvas, fraction of the width wide."""
    height = height or size
    canvas = Image.new('RGBA', (size, height), BG)
    w = round(size * fraction)
    h = round(logo.height * w / logo.width)
    canvas.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((size - w) // 2, (height - h) // 2))
    return canvas


def masked(img, shape):
    size = img.width
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    if shape == 'circle':
        draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.18), fill=255)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


# Web: favicon / bookmark, Apple home-screen icon, PWA icons (plain and maskable).
for size in (32, 180, 192, 512):
    placed(size, 0.86).save(os.path.join(icons, 'icon-%d.png' % size))
placed(512, 0.62).save(os.path.join(icons, 'icon-maskable-512.png'))

# Link preview (Zalo, Messenger, Facebook): 1200 x 630 with the logo and the group's name.
preview = Image.new('RGBA', (1200, 630), BG)
lw = 420
lh = round(logo.height * lw / logo.width)
preview.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), ((1200 - lw) // 2, 70))
font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 64)
draw = ImageDraw.Draw(preview)
tw = draw.textlength(TITLE, font=font)
draw.text(((1200 - tw) / 2, 70 + lh + 40), TITLE, font=font, fill=(26, 28, 36))
preview.convert('RGB').save(os.path.join(root, 'www/img/og-image.png'))

# Android launcher icons.
for name, scale in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    d = os.path.join(res, 'mipmap-' + name)
    placed(round(108 * scale), 0.56).save(os.path.join(d, 'ic_launcher_foreground.png'))
    size = round(48 * scale)
    masked(placed(size, 0.86), 'square').save(os.path.join(d, 'ic_launcher.png'))
    masked(placed(size, 0.76), 'circle').save(os.path.join(d, 'ic_launcher_round.png'))

# Android splash screens: the logo in the middle, same size as the existing files.
for folder in os.listdir(res):
    path = os.path.join(res, folder, 'splash.png')
    if folder.startswith('drawable') and os.path.exists(path):
        w, h = Image.open(path).size
        canvas = Image.new('RGBA', (w, h), BG)
        lw = round(min(w, h) * 0.45)
        lh = round(logo.height * lw / logo.width)
        canvas.alpha_composite(logo.resize((lw, lh), Image.LANCZOS), ((w - lw) // 2, (h - lh) // 2))
        canvas.convert('RGB').save(path)
print('done')
