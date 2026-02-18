"""
Sprite Processor - Crops individual effects from sprite sheets and removes dark backgrounds.
Uses max channel brightness as alpha for natural feathering on glowing VFX.
"""
from PIL import Image, ImageFilter
import os

IMG_DIR = os.path.join(os.path.dirname(__file__), '..', 'img')
OUT_DIR = os.path.join(IMG_DIR, 'sprites')
os.makedirs(OUT_DIR, exist_ok=True)


def remove_dark_bg(img, threshold=35, boost=1.4):
    """Remove dark background using max channel as alpha.
    - Pixels below threshold become fully transparent
    - Brightness is boosted for better visibility on game bg
    """
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
                # Scale alpha based on brightness, with boost
                alpha = min(255, int(max_val * boost))
                pixels[x, y] = (r, g, b, alpha)
    return img


def crop_grid(img, cols, rows, names, threshold=35, boost=1.4, padding=0):
    """Crop an image into a grid of cols x rows and save each cell."""
    w, h = img.size
    cw = w // cols
    ch = h // rows
    results = []
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx >= len(names):
                break
            x0 = col * cw + padding
            y0 = row * ch + padding
            x1 = (col + 1) * cw - padding
            y1 = (row + 1) * ch - padding
            cell = img.crop((x0, y0, x1, y1))
            cell = remove_dark_bg(cell, threshold, boost)
            # Trim transparent edges
            cell = trim_transparent(cell)
            out_path = os.path.join(OUT_DIR, names[idx])
            cell.save(out_path, 'PNG')
            print(f"  Saved: {names[idx]} ({cell.size[0]}x{cell.size[1]})")
            results.append(out_path)
            idx += 1
    return results


def crop_region(img, x0, y0, x1, y1, name, threshold=35, boost=1.4):
    """Crop a specific region from an image."""
    region = img.crop((x0, y0, x1, y1))
    region = remove_dark_bg(region, threshold, boost)
    region = trim_transparent(region)
    out_path = os.path.join(OUT_DIR, name)
    region.save(out_path, 'PNG')
    print(f"  Saved: {name} ({region.size[0]}x{region.size[1]})")
    return out_path


def trim_transparent(img, min_alpha=5):
    """Trim transparent borders from an image."""
    bbox = img.split()[-1].point(lambda p: 255 if p > min_alpha else 0).getbbox()
    if bbox:
        return img.crop(bbox)
    return img


# ============================================================
# Process each sprite sheet
# ============================================================

print("=== Processing Fire Frames (image copy 3.png) ===")
fire_frames = Image.open(os.path.join(IMG_DIR, 'image copy 3.png'))
crop_grid(fire_frames, 4, 2,
    [f'fire_{i+1}.png' for i in range(8)],
    threshold=30, boost=1.5)

print("\n=== Processing Lightning Bolts (image copy 4.png) ===")
lightning = Image.open(os.path.join(IMG_DIR, 'image copy 4.png'))
crop_grid(lightning, 3, 1,
    ['lightning_1.png', 'lightning_2.png', 'lightning_3.png'],
    threshold=25, boost=1.3)

print("\n=== Processing Purple Magic (image copy 5.png) ===")
purple = Image.open(os.path.join(IMG_DIR, 'image copy 5.png'))
crop_grid(purple, 2, 2,
    ['purple_orb.png', 'purple_lightning.png', 'purple_spiral.png', 'purple_eruption.png'],
    threshold=25, boost=1.3)

print("\n=== Processing Blue/Teal Magic (image copy.png) ===")
blue_magic = Image.open(os.path.join(IMG_DIR, 'image copy.png'))
crop_grid(blue_magic, 3, 3,
    ['blue_bolt_sm.png', 'blue_slash.png', 'purple_flame_sm.png',
     'blue_lightning_big.png', 'teal_impact.png', 'purple_pillar.png',
     'blue_dissipate.png', 'teal_vortex.png', 'purple_wisp.png'],
    threshold=25, boost=1.3)

print("\n=== Processing Water Splashes (image copy 7.png) ===")
water = Image.open(os.path.join(IMG_DIR, 'image copy 7.png'))
crop_grid(water, 4, 2,
    ['water_arc.png', 'water_wave.png', 'water_splash.png', 'water_drip.png',
     'water_geyser.png', 'water_slash.png', 'water_burst.png', 'water_fountain.png'],
    threshold=30, boost=1.3)

print("\n=== Processing Water/Ice Glow (image copy 8.png) ===")
ice = Image.open(os.path.join(IMG_DIR, 'image copy 8.png'))
crop_grid(ice, 3, 2,
    ['ice_comet.png', 'ice_dome.png', 'ice_wave.png',
     'ice_ring.png', 'ice_waterfall.png', 'ice_whip.png'],
    threshold=25, boost=1.3)

print("\n=== Processing Mixed Elements (image.png) ===")
elements = Image.open(os.path.join(IMG_DIR, 'image.png'))
w, h = elements.size
# Top-left: fire effects
crop_region(elements, 0, 0, int(w*0.15), int(h*0.25), 'elem_fire_orb.png', threshold=30, boost=1.5)
crop_region(elements, int(w*0.08), int(h*0.0), int(w*0.22), int(h*0.35), 'elem_fireball.png', threshold=30, boost=1.5)
# Center top: fire explosion
crop_region(elements, int(w*0.2), int(h*0.0), int(w*0.55), int(h*0.3), 'elem_fire_explosion.png', threshold=30, boost=1.5)
# Right: lava/embers
crop_region(elements, int(w*0.55), int(h*0.0), int(w*0.8), int(h*0.25), 'elem_lava.png', threshold=30, boost=1.5)
# Middle-left: ice crystal
crop_region(elements, int(w*0.08), int(h*0.3), int(w*0.35), int(h*0.65), 'elem_ice_crystal.png', threshold=25, boost=1.3)
# Center: ice dome
crop_region(elements, int(w*0.25), int(h*0.25), int(w*0.65), int(h*0.6), 'elem_ice_dome.png', threshold=25, boost=1.3)
# Right: earth pillar
crop_region(elements, int(w*0.7), int(h*0.25), int(w*1.0), int(h*0.65), 'elem_earth_pillar.png', threshold=30, boost=1.3)
# Bottom: green portals
crop_region(elements, int(w*0.0), int(h*0.6), int(w*0.2), int(h*1.0), 'elem_green_orb.png', threshold=25, boost=1.4)
crop_region(elements, int(w*0.15), int(h*0.6), int(w*0.5), int(h*1.0), 'elem_green_portal.png', threshold=25, boost=1.4)
crop_region(elements, int(w*0.45), int(h*0.6), int(w*0.75), int(h*1.0), 'elem_green_ramp.png', threshold=25, boost=1.4)

print("\n=== Processing Purple Magic Alt (image copy 9.png) ===")
purple2 = Image.open(os.path.join(IMG_DIR, 'image copy 9.png'))
w9, h9 = purple2.size
crop_region(purple2, 0, 0, int(w9*0.5), int(h9*0.4), 'purple_atom.png', threshold=25, boost=1.3)
crop_region(purple2, int(w9*0.35), int(h9*0.0), int(w9*0.75), int(h9*0.45), 'purple_bolt.png', threshold=25, boost=1.3)
crop_region(purple2, int(w9*0.6), int(h9*0.0), int(w9*1.0), int(h9*0.45), 'purple_geyser.png', threshold=25, boost=1.3)
crop_region(purple2, 0, int(h9*0.4), int(w9*0.5), int(h9*0.75), 'purple_beam.png', threshold=25, boost=1.3)
crop_region(purple2, int(w9*0.1), int(h9*0.65), int(w9*0.9), int(h9*1.0), 'purple_shield.png', threshold=25, boost=1.3)

print("\n=== Processing Mixed VFX (image copy 12.png) ===")
mixed = Image.open(os.path.join(IMG_DIR, 'image copy 12.png'))
wm, hm = mixed.size
crop_region(mixed, 0, 0, int(wm*0.65), int(hm*0.35), 'death_fire_skull.png', threshold=25, boost=1.4)
crop_region(mixed, int(wm*0.55), 0, wm, int(hm*0.35), 'death_smoke.png', threshold=25, boost=1.3)
crop_region(mixed, 0, int(hm*0.3), int(wm*0.7), int(hm*0.6), 'death_ice_skull.png', threshold=25, boost=1.3)
crop_region(mixed, 0, int(hm*0.55), int(wm*0.55), int(hm*0.8), 'death_earth_skull.png', threshold=25, boost=1.3)
crop_region(mixed, int(wm*0.3), int(hm*0.75), int(wm*0.7), hm, 'death_lightning_skull.png', threshold=25, boost=1.3)
crop_region(mixed, int(wm*0.6), int(hm*0.75), wm, hm, 'death_green_ghost.png', threshold=25, boost=1.3)

print("\n=== Processing Fire Shapes (image copy 6.png) ===")
fire_shapes = Image.open(os.path.join(IMG_DIR, 'image copy 6.png'))
wf, hf = fire_shapes.size
# Top row: horizontal flames
crop_region(fire_shapes, 0, 0, int(wf*0.25), int(hf*0.2), 'flame_swoosh_1.png', threshold=40, boost=1.5)
crop_region(fire_shapes, int(wf*0.25), 0, int(wf*0.6), int(hf*0.2), 'flame_swoosh_2.png', threshold=40, boost=1.5)
# Middle: fireballs
crop_region(fire_shapes, int(wf*0.25), int(hf*0.3), int(wf*0.55), int(hf*0.6), 'fireball_spin_1.png', threshold=40, boost=1.5)
crop_region(fire_shapes, int(wf*0.45), int(hf*0.3), int(wf*0.7), int(hf*0.6), 'fireball_spin_2.png', threshold=40, boost=1.5)
# Bottom: small flames
crop_region(fire_shapes, 0, int(hf*0.6), int(wf*0.3), hf, 'flame_small_1.png', threshold=40, boost=1.5)
crop_region(fire_shapes, int(wf*0.35), int(hf*0.75), int(wf*0.65), hf, 'flame_ground.png', threshold=40, boost=1.5)

print("\n=== Processing Special Effects (image copy 2.png) ===")
special = Image.open(os.path.join(IMG_DIR, 'image copy 2.png'))
ws, hs = special.size
crop_region(special, 0, 0, int(ws*0.3), int(hs*0.3), 'fx_purple_chain.png', threshold=25, boost=1.3)
crop_region(special, 0, int(hs*0.25), int(ws*0.3), int(hs*0.65), 'fx_gold_energy.png', threshold=25, boost=1.4)
crop_region(special, int(ws*0.25), int(hs*0.1), int(ws*0.75), int(hs*0.85), 'fx_blue_impact.png', threshold=25, boost=1.3)
crop_region(special, int(ws*0.6), 0, ws, int(hs*0.4), 'fx_red_nodes.png', threshold=25, boost=1.4)
crop_region(special, 0, int(hs*0.6), int(ws*0.4), hs, 'fx_smoke_puff.png', threshold=30, boost=1.3)
crop_region(special, int(ws*0.7), int(hs*0.6), ws, hs, 'fx_green_wind.png', threshold=25, boost=1.3)

print(f"\n=== Done! Check {OUT_DIR} ===")

# List all generated files
sprites = sorted(os.listdir(OUT_DIR))
print(f"Total sprites: {len(sprites)}")
for s in sprites:
    size = os.path.getsize(os.path.join(OUT_DIR, s))
    print(f"  {s} ({size//1024}KB)")
