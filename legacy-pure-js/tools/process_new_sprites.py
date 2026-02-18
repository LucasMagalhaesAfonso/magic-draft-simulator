"""
Process new animation images from img/animations/ into individual transparent sprites.
Handles dark, gray, and light backgrounds with appropriate alpha extraction.
"""
from PIL import Image, ImageFilter, ImageStat
import os, math

BASE = os.path.join(os.path.dirname(__file__), '..')
ANIM_DIR = os.path.join(BASE, 'img', 'animations')
OUT_DIR = os.path.join(BASE, 'img', 'sprites')
os.makedirs(OUT_DIR, exist_ok=True)


def remove_dark_bg(img, threshold=35, boost=1.4):
    """Remove dark/black background using max channel as alpha."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            max_val = max(r, g, b)
            if max_val < threshold:
                pixels[x, y] = (r, g, b, 0)
            else:
                alpha = min(255, int(max_val * boost))
                pixels[x, y] = (r, g, b, alpha)
    return img


def remove_gray_bg(img, bg_color=None, threshold=45, boost=1.3):
    """Remove gray/colored background by color distance from detected bg."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    # Auto-detect bg color from corners if not provided
    if bg_color is None:
        corners = []
        for cx, cy in [(2,2), (w-3,2), (2,h-3), (w-3,h-3)]:
            r, g, b, a = pixels[cx, cy]
            corners.append((r, g, b))
        bg_color = (
            sum(c[0] for c in corners) // len(corners),
            sum(c[1] for c in corners) // len(corners),
            sum(c[2] for c in corners) // len(corners),
        )
    br, bg, bb = bg_color
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            dist = math.sqrt((r-br)**2 + (g-bg)**2 + (b-bb)**2)
            if dist < threshold:
                pixels[x, y] = (r, g, b, 0)
            else:
                alpha = min(255, int(min(dist * boost, 255)))
                # Also factor in saturation - vivid colors should be more opaque
                sat = max(r, g, b) - min(r, g, b)
                if sat > 40:
                    alpha = min(255, alpha + sat // 2)
                pixels[x, y] = (r, g, b, alpha)
    return img


def remove_light_bg(img, threshold=220, boost=1.4):
    """Remove white/light background using inverted brightness as alpha."""
    img = img.convert('RGBA')
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            brightness = (r + g + b) // 3
            sat = max(r, g, b) - min(r, g, b)
            if brightness > threshold and sat < 40:
                pixels[x, y] = (r, g, b, 0)
            else:
                # More saturated = more opaque; darker = more opaque
                alpha = min(255, int((255 - brightness + sat) * boost))
                alpha = max(0, min(255, alpha))
                pixels[x, y] = (r, g, b, alpha)
    return img


def trim_transparent(img, min_alpha=5):
    """Trim transparent borders."""
    bbox = img.split()[-1].point(lambda p: 255 if p > min_alpha else 0).getbbox()
    if bbox:
        return img.crop(bbox)
    return img


def crop_region(img, x0, y0, x1, y1, name, bg_type='dark', **kwargs):
    """Crop a specific region and remove background."""
    region = img.crop((x0, y0, x1, y1))
    if bg_type == 'dark':
        region = remove_dark_bg(region, kwargs.get('threshold', 35), kwargs.get('boost', 1.4))
    elif bg_type == 'gray':
        region = remove_gray_bg(region, kwargs.get('bg_color'), kwargs.get('threshold', 45), kwargs.get('boost', 1.3))
    elif bg_type == 'light':
        region = remove_light_bg(region, kwargs.get('threshold', 220), kwargs.get('boost', 1.4))
    region = trim_transparent(region)
    out_path = os.path.join(OUT_DIR, name)
    region.save(out_path, 'PNG')
    print(f"  Saved: {name} ({region.size[0]}x{region.size[1]})")
    return out_path


def crop_grid(img, cols, rows, names, bg_type='dark', **kwargs):
    """Crop image into grid."""
    w, h = img.size
    cw = w // cols
    ch = h // rows
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx >= len(names):
                break
            x0 = col * cw
            y0 = row * ch
            x1 = (col + 1) * cw
            y1 = (row + 1) * ch
            cell = img.crop((x0, y0, x1, y1))
            if bg_type == 'dark':
                cell = remove_dark_bg(cell, kwargs.get('threshold', 35), kwargs.get('boost', 1.4))
            elif bg_type == 'gray':
                cell = remove_gray_bg(cell, kwargs.get('bg_color'), kwargs.get('threshold', 45), kwargs.get('boost', 1.3))
            elif bg_type == 'light':
                cell = remove_light_bg(cell, kwargs.get('threshold', 220), kwargs.get('boost', 1.4))
            cell = trim_transparent(cell)
            out_path = os.path.join(OUT_DIR, names[idx])
            cell.save(out_path, 'PNG')
            print(f"  Saved: {names[idx]} ({cell.size[0]}x{cell.size[1]})")
            idx += 1


# ============================================================
# Process new images not handled by original script
# ============================================================

print("=== Processing Ice Claw Slash Frames (image copy 17.png) ===")
# 5 columns x 3 rows animation frames on black bg
slash = Image.open(os.path.join(ANIM_DIR, 'image copy 17.png'))
crop_grid(slash, 5, 3,
    [f'slash_ice_{i+1}.png' for i in range(15)],
    bg_type='dark', threshold=20, boost=1.3)

print("\n=== Processing Purple Dark Magic (image copy 10.png) ===")
# Purple magic on gray bg - 3 rows of effects
purp10 = Image.open(os.path.join(ANIM_DIR, 'image copy 10.png'))
w, h = purp10.size
crop_region(purp10, 0, 0, int(w*0.35), int(h*0.35), 'dark_projectile.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, int(w*0.3), 0, int(w*0.7), int(h*0.4), 'dark_swirl.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, int(w*0.6), 0, w, int(h*0.35), 'dark_burst.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, 0, int(h*0.33), int(w*0.5), int(h*0.7), 'dark_vortex.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, int(w*0.45), int(h*0.33), w, int(h*0.7), 'dark_explosion.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, 0, int(h*0.65), int(w*0.5), h, 'dark_slash.png',
    bg_type='gray', threshold=50, boost=1.5)
crop_region(purp10, int(w*0.35), int(h*0.65), w, h, 'dark_ghost.png',
    bg_type='gray', threshold=50, boost=1.5)

print("\n=== Processing Mixed Effects (image copy 13.png) ===")
# Pink flame, fire, gold ring, crystal, water wave, splash on black bg
mix13 = Image.open(os.path.join(ANIM_DIR, 'image copy 13.png'))
w, h = mix13.size
crop_region(mix13, 0, 0, int(w*0.2), int(h*0.5), 'attack_pink_flame.png',
    bg_type='dark', threshold=25, boost=1.4)
crop_region(mix13, int(w*0.18), 0, int(w*0.42), int(h*0.5), 'attack_fire_swoosh.png',
    bg_type='dark', threshold=25, boost=1.5)
crop_region(mix13, int(w*0.38), 0, int(w*0.7), int(h*0.5), 'attack_gold_ring.png',
    bg_type='dark', threshold=25, boost=1.4)
crop_region(mix13, 0, int(h*0.45), int(w*0.3), h, 'attack_crystal.png',
    bg_type='dark', threshold=25, boost=1.3)
crop_region(mix13, int(w*0.3), int(h*0.45), int(w*0.7), h, 'attack_water_wave.png',
    bg_type='dark', threshold=25, boost=1.3)
crop_region(mix13, int(w*0.65), int(h*0.45), w, h, 'attack_water_splash.png',
    bg_type='dark', threshold=25, boost=1.3)

print("\n=== Processing Multi-Element (image copy 14.png) ===")
# Green slash, fire, water, lightning on gray bg
mix14 = Image.open(os.path.join(ANIM_DIR, 'image copy 14.png'))
w, h = mix14.size
crop_region(mix14, 0, 0, int(w*0.45), int(h*0.55), 'attack_green_slash.png',
    bg_type='gray', bg_color=(100, 100, 100), threshold=55, boost=1.4)
crop_region(mix14, int(w*0.35), int(h*0.15), int(w*0.7), int(h*0.75), 'attack_fire_bolt.png',
    bg_type='gray', bg_color=(100, 100, 100), threshold=55, boost=1.5)
crop_region(mix14, 0, int(h*0.7), int(w*0.35), h, 'attack_water_jet.png',
    bg_type='gray', bg_color=(100, 100, 100), threshold=55, boost=1.4)
crop_region(mix14, int(w*0.6), int(h*0.7), w, h, 'attack_lightning_bolt.png',
    bg_type='gray', bg_color=(100, 100, 100), threshold=55, boost=1.5)

print("\n=== Processing Red Flame/Claw (image copy 15.png) ===")
# Single red flame claw on white bg
red_flame = Image.open(os.path.join(ANIM_DIR, 'image copy 15.png'))
w, h = red_flame.size
crop_region(red_flame, 0, 0, w, h, 'attack_red_claw.png',
    bg_type='light', threshold=230, boost=1.6)

print("\n=== Processing Blood Splatters (image copy 16.png) ===")
# Blood splatters on gray bg (3x3-ish layout)
blood = Image.open(os.path.join(ANIM_DIR, 'image copy 16.png'))
w, h = blood.size
crop_grid(blood, 4, 3,
    ['blood_splat_1.png', 'blood_splat_2.png', 'blood_splat_3.png', 'blood_splat_4.png',
     'blood_splat_5.png', 'blood_splat_6.png', 'blood_splat_7.png', 'blood_splat_8.png',
     'blood_splat_9.png', 'blood_splat_10.png', 'blood_splat_11.png', 'blood_splat_12.png'],
    bg_type='gray', bg_color=(140, 140, 140), threshold=40, boost=1.5)

print("\n=== Processing Fire Types (image copy 11.png) ===")
# 9 labeled fire effects (2 rows, 5+4) on tan bg
fire_types = Image.open(os.path.join(ANIM_DIR, 'image copy 11.png'))
w, h = fire_types.size
# Top row: 5 fire types
for i, name in enumerate(['fire_sharp', 'fire_swooshy', 'fire_lava', 'fire_smoky', 'fire_rounded']):
    x0 = int(w * i / 5)
    x1 = int(w * (i + 1) / 5)
    crop_region(fire_types, x0, 0, x1, int(h * 0.55), f'{name}.png',
        bg_type='gray', bg_color=(235, 220, 200), threshold=55, boost=1.6)
# Bottom row: 4 fire types
for i, name in enumerate(['fire_spirit', 'fire_steam', 'fire_dragon', 'fire_dark']):
    x0 = int(w * i / 4)
    x1 = int(w * (i + 1) / 4)
    crop_region(fire_types, x0, int(h * 0.45), x1, h, f'{name}.png',
        bg_type='gray', bg_color=(235, 220, 200), threshold=55, boost=1.6)

print(f"\n=== Done! ===")
# List new files
new_sprites = [f for f in sorted(os.listdir(OUT_DIR))
    if f.startswith(('slash_', 'dark_', 'attack_', 'blood_', 'fire_sharp', 'fire_swoosh',
                     'fire_lava', 'fire_smoky', 'fire_round', 'fire_spirit', 'fire_steam',
                     'fire_dragon', 'fire_dark'))]
print(f"New sprites: {len(new_sprites)}")
for s in new_sprites:
    size = os.path.getsize(os.path.join(OUT_DIR, s))
    print(f"  {s} ({size//1024}KB)")
