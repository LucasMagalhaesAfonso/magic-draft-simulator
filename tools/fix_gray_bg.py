"""Fix sprites that have gray backgrounds (not black) by using higher threshold."""
from PIL import Image
import os

IMG_DIR = os.path.join(os.path.dirname(__file__), '..', 'img')
OUT_DIR = os.path.join(IMG_DIR, 'sprites')


def remove_dark_bg(img, threshold=35, boost=1.4):
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
                # For mid-range grays, reduce alpha more aggressively
                brightness = (r + g + b) / 3
                # If pixel is grayish (low saturation) and not bright, make more transparent
                max_c = max(r, g, b)
                min_c = min(r, g, b)
                saturation = (max_c - min_c) / max(max_c, 1)
                if saturation < 0.15 and brightness < threshold * 2:
                    # Low saturation, dim = background gray
                    pixels[x, y] = (r, g, b, 0)
                elif saturation < 0.2 and brightness < threshold * 1.5:
                    pixels[x, y] = (r, g, b, int(brightness * 0.3))
                else:
                    alpha = min(255, int(max_val * boost))
                    pixels[x, y] = (r, g, b, alpha)
    return img


def trim_transparent(img, min_alpha=5):
    bbox = img.split()[-1].point(lambda p: 255 if p > min_alpha else 0).getbbox()
    if bbox:
        return img.crop(bbox)
    return img


def crop_region(img, x0, y0, x1, y1, name, threshold=60, boost=1.4):
    region = img.crop((x0, y0, x1, y1))
    region = remove_dark_bg(region, threshold, boost)
    region = trim_transparent(region)
    out_path = os.path.join(OUT_DIR, name)
    region.save(out_path, 'PNG')
    print(f"  Fixed: {name} ({region.size[0]}x{region.size[1]})")


def crop_grid(img, cols, rows, names, threshold=60, boost=1.4, padding=0):
    w, h = img.size
    cw = w // cols
    ch = h // rows
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
            cell = trim_transparent(cell)
            out_path = os.path.join(OUT_DIR, names[idx])
            cell.save(out_path, 'PNG')
            print(f"  Fixed: {names[idx]} ({cell.size[0]}x{cell.size[1]})")
            idx += 1


# Reprocess images with gray backgrounds using higher threshold

print("=== Fixing Mixed Elements (image.png) - gray bg ~#444 ===")
elements = Image.open(os.path.join(IMG_DIR, 'image.png'))
w, h = elements.size
crop_region(elements, 0, 0, int(w*0.15), int(h*0.25), 'elem_fire_orb.png', threshold=75, boost=1.5)
crop_region(elements, int(w*0.08), int(h*0.0), int(w*0.22), int(h*0.35), 'elem_fireball.png', threshold=75, boost=1.5)
crop_region(elements, int(w*0.2), int(h*0.0), int(w*0.55), int(h*0.3), 'elem_fire_explosion.png', threshold=75, boost=1.5)
crop_region(elements, int(w*0.55), int(h*0.0), int(w*0.8), int(h*0.25), 'elem_lava.png', threshold=75, boost=1.5)
crop_region(elements, int(w*0.08), int(h*0.3), int(w*0.35), int(h*0.65), 'elem_ice_crystal.png', threshold=70, boost=1.3)
crop_region(elements, int(w*0.25), int(h*0.25), int(w*0.65), int(h*0.6), 'elem_ice_dome.png', threshold=70, boost=1.3)
crop_region(elements, int(w*0.7), int(h*0.25), int(w*1.0), int(h*0.65), 'elem_earth_pillar.png', threshold=75, boost=1.3)
crop_region(elements, int(w*0.0), int(h*0.6), int(w*0.2), int(h*1.0), 'elem_green_orb.png', threshold=70, boost=1.4)
crop_region(elements, int(w*0.15), int(h*0.6), int(w*0.5), int(h*1.0), 'elem_green_portal.png', threshold=70, boost=1.4)
crop_region(elements, int(w*0.45), int(h*0.6), int(w*0.75), int(h*1.0), 'elem_green_ramp.png', threshold=70, boost=1.4)

print("\n=== Fixing Purple Magic Alt (image copy 9.png) - gray bg ===")
purple2 = Image.open(os.path.join(IMG_DIR, 'image copy 9.png'))
w9, h9 = purple2.size
crop_region(purple2, 0, 0, int(w9*0.5), int(h9*0.4), 'purple_atom.png', threshold=70, boost=1.3)
crop_region(purple2, int(w9*0.35), int(h9*0.0), int(w9*0.75), int(h9*0.45), 'purple_bolt.png', threshold=70, boost=1.3)
crop_region(purple2, int(w9*0.6), int(h9*0.0), int(w9*1.0), int(h9*0.45), 'purple_geyser.png', threshold=70, boost=1.3)
crop_region(purple2, 0, int(h9*0.4), int(w9*0.5), int(h9*0.75), 'purple_beam.png', threshold=70, boost=1.3)
crop_region(purple2, int(w9*0.1), int(h9*0.65), int(w9*0.9), int(h9*1.0), 'purple_shield.png', threshold=70, boost=1.3)

print("\n=== Fixing Fire Shapes (image copy 6.png) - dark red bg ===")
fire_shapes = Image.open(os.path.join(IMG_DIR, 'image copy 6.png'))
wf, hf = fire_shapes.size
crop_region(fire_shapes, 0, 0, int(wf*0.25), int(hf*0.2), 'flame_swoosh_1.png', threshold=70, boost=1.5)
crop_region(fire_shapes, int(wf*0.25), 0, int(wf*0.6), int(hf*0.2), 'flame_swoosh_2.png', threshold=70, boost=1.5)
crop_region(fire_shapes, int(wf*0.25), int(hf*0.3), int(wf*0.55), int(hf*0.6), 'fireball_spin_1.png', threshold=70, boost=1.5)
crop_region(fire_shapes, int(wf*0.45), int(hf*0.3), int(wf*0.7), int(hf*0.6), 'fireball_spin_2.png', threshold=70, boost=1.5)
crop_region(fire_shapes, 0, int(hf*0.6), int(wf*0.3), hf, 'flame_small_1.png', threshold=70, boost=1.5)
crop_region(fire_shapes, int(wf*0.35), int(hf*0.75), int(wf*0.65), hf, 'flame_ground.png', threshold=70, boost=1.5)

print("\n=== Fixing Special Effects (image copy 2.png) ===")
special = Image.open(os.path.join(IMG_DIR, 'image copy 2.png'))
ws, hs = special.size
crop_region(special, 0, 0, int(ws*0.3), int(hs*0.3), 'fx_purple_chain.png', threshold=65, boost=1.3)
crop_region(special, 0, int(hs*0.25), int(ws*0.3), int(hs*0.65), 'fx_gold_energy.png', threshold=65, boost=1.4)
crop_region(special, int(ws*0.25), int(hs*0.1), int(ws*0.75), int(hs*0.85), 'fx_blue_impact.png', threshold=65, boost=1.3)
crop_region(special, int(ws*0.6), 0, ws, int(hs*0.4), 'fx_red_nodes.png', threshold=65, boost=1.4)
crop_region(special, 0, int(hs*0.6), int(ws*0.4), hs, 'fx_smoke_puff.png', threshold=65, boost=1.3)
crop_region(special, int(ws*0.7), int(hs*0.6), ws, hs, 'fx_green_wind.png', threshold=65, boost=1.3)

print("\nDone fixing gray backgrounds!")
