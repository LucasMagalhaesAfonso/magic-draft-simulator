"""
Magic Wand Sprite Processor
============================
Properly detects and removes backgrounds using flood-fill from image edges,
similar to Photoshop's Magic Wand tool with "Contiguous" mode.

Two modes:
- GLOW: For effects on dark backgrounds (fire, lightning, etc.)
        Uses brightness-as-alpha for screen blend overlay.
- CUTOUT: For opaque art on colored backgrounds (blood, fire types, etc.)
          Uses flood-fill mask with feathered edges for clean transparency.

Auto-detect sprites by finding connected foreground components.
"""
import numpy as np
from PIL import Image, ImageFilter
from collections import deque
import os, sys, time

BASE = os.path.join(os.path.dirname(__file__), '..')
ANIM_DIR = os.path.join(BASE, 'img', 'animations')
OUT_DIR = os.path.join(BASE, 'img', 'sprites')
os.makedirs(OUT_DIR, exist_ok=True)


# ============================================================
# Core algorithms
# ============================================================

def detect_bg_color(arr):
    """Detect background color from image edges (median of edge pixels)."""
    h, w = arr.shape[:2]
    edges = np.concatenate([
        arr[0, :, :3],       # top
        arr[-1, :, :3],      # bottom
        arr[:, 0, :3],       # left
        arr[:, -1, :3],      # right
    ], axis=0)
    return np.median(edges, axis=0).astype(np.float32)


def flood_fill_bg(arr, bg_color, tolerance):
    """
    Flood fill from image edges to find connected background region.
    Like Photoshop's Magic Wand with Contiguous mode, clicking all edges.

    Returns boolean mask: True = background pixel.
    """
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3].astype(np.float32)
    bg = bg_color.astype(np.float32)

    # Color distance from each pixel to bg color
    dist = np.sqrt(np.sum((rgb - bg) ** 2, axis=2))

    # Pixels similar enough to bg
    similar = dist < tolerance

    # Flood fill: iteratively expand from edges through similar pixels
    filled = np.zeros((h, w), dtype=bool)
    filled[0, :] = similar[0, :]
    filled[-1, :] = similar[-1, :]
    filled[:, 0] = similar[:, 0]
    filled[:, -1] = similar[:, -1]

    iterations = 0
    while True:
        expanded = filled.copy()
        expanded[1:, :] |= filled[:-1, :]    # expand down
        expanded[:-1, :] |= filled[1:, :]    # expand up
        expanded[:, 1:] |= filled[:, :-1]    # expand right
        expanded[:, :-1] |= filled[:, 1:]    # expand left
        expanded &= similar                   # only into bg-similar pixels

        if np.array_equal(expanded, filled):
            break
        filled = expanded
        iterations += 1

    return filled


def find_components(fg_mask, min_area=500, merge_dist=15):
    """
    Find connected foreground components using BFS.
    Returns list of bounding boxes sorted by position.
    """
    h, w = fg_mask.shape
    visited = np.zeros((h, w), dtype=bool)
    components = []

    # Downsample for speed if image is large
    scale = 1
    work_mask = fg_mask
    if h * w > 2_000_000:
        scale = 2
        work_mask = fg_mask[::scale, ::scale]

    wh, ww = work_mask.shape
    work_visited = np.zeros((wh, ww), dtype=bool)

    for y in range(wh):
        for x in range(ww):
            if work_mask[y, x] and not work_visited[y, x]:
                # BFS flood fill
                queue = deque([(y, x)])
                work_visited[y, x] = True
                min_y, max_y = y, y
                min_x, max_x = x, x
                area = 0

                while queue:
                    cy, cx = queue.popleft()
                    area += 1
                    min_y = min(min_y, cy)
                    max_y = max(max_y, cy)
                    min_x = min(min_x, cx)
                    max_x = max(max_x, cx)

                    for dy, dx in [(-1,0),(1,0),(0,-1),(0,1)]:
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < wh and 0 <= nx < ww and work_mask[ny, nx] and not work_visited[ny, nx]:
                            work_visited[ny, nx] = True
                            queue.append((ny, nx))

                # Scale back to original coords
                actual_area = area * scale * scale
                if actual_area >= min_area:
                    components.append({
                        'bbox': (min_x * scale, min_y * scale,
                                 min((max_x + 1) * scale, w), min((max_y + 1) * scale, h)),
                        'area': actual_area
                    })

    # Merge nearby components (some sprites have disconnected parts)
    merged = True
    while merged:
        merged = False
        new_components = []
        used = set()
        for i, a in enumerate(components):
            if i in used:
                continue
            ax0, ay0, ax1, ay1 = a['bbox']
            merged_box = [ax0, ay0, ax1, ay1]
            merged_area = a['area']

            for j, b in enumerate(components):
                if j <= i or j in used:
                    continue
                bx0, by0, bx1, by1 = b['bbox']

                # Check if boxes are close enough to merge
                gap_x = max(0, max(bx0 - merged_box[2], merged_box[0] - bx1))
                gap_y = max(0, max(by0 - merged_box[3], merged_box[1] - by1))

                if gap_x < merge_dist and gap_y < merge_dist:
                    merged_box[0] = min(merged_box[0], bx0)
                    merged_box[1] = min(merged_box[1], by0)
                    merged_box[2] = max(merged_box[2], bx1)
                    merged_box[3] = max(merged_box[3], by1)
                    merged_area += b['area']
                    used.add(j)
                    merged = True

            new_components.append({
                'bbox': tuple(merged_box),
                'area': merged_area
            })
            used.add(i)
        components = new_components

    # Sort: top-to-bottom rows first (quantized), then left-to-right
    if components:
        avg_h = np.mean([c['bbox'][3] - c['bbox'][1] for c in components])
        row_height = max(avg_h * 0.6, 30)
        components.sort(key=lambda c: (int(c['bbox'][1] / row_height), c['bbox'][0]))

    return components


def make_glow_alpha(arr, bg_mask, threshold=20, boost=1.5):
    """
    Create alpha for glowing effects on dark bg.
    Brightness = alpha, with bg mask ensuring proper boundaries.
    """
    rgb = arr[:, :, :3].astype(np.float32)
    max_ch = np.max(rgb, axis=2)

    alpha = np.where(max_ch < threshold, 0.0, np.clip(max_ch * boost, 0, 255))
    # Force bg pixels to transparent
    alpha[bg_mask] = 0

    return alpha.astype(np.uint8)


def make_cutout_alpha(arr, bg_mask, feather=2):
    """
    Create alpha for opaque art on colored bg.
    Clean binary cutout with feathered edges.
    """
    fg = (~bg_mask).astype(np.uint8) * 255

    if feather > 0:
        # Blur for feathered edges
        fg_img = Image.fromarray(fg, 'L')
        blurred = fg_img.filter(ImageFilter.GaussianBlur(radius=feather))
        blurred_arr = np.array(blurred)

        # Keep core fully opaque, only feather the boundary
        eroded = ~bg_mask
        for _ in range(max(1, feather)):
            new_eroded = eroded.copy()
            new_eroded[1:, :] &= eroded[:-1, :]
            new_eroded[:-1, :] &= eroded[1:, :]
            new_eroded[:, 1:] &= eroded[:, :-1]
            new_eroded[:, :-1] &= eroded[:, 1:]
            eroded = new_eroded

        result = blurred_arr.copy()
        result[eroded] = 255
        result[bg_mask & (blurred_arr < 10)] = 0
        return result

    return fg


def trim_transparent(img, padding=4):
    """Trim transparent borders with optional padding."""
    arr = np.array(img)
    alpha = arr[:, :, 3]
    rows = np.any(alpha > 5, axis=1)
    cols = np.any(alpha > 5, axis=0)

    if not np.any(rows) or not np.any(cols):
        return img

    y0, y1 = np.where(rows)[0][[0, -1]]
    x0, x1 = np.where(cols)[0][[0, -1]]

    # Add padding
    h, w = arr.shape[:2]
    y0 = max(0, y0 - padding)
    y1 = min(h - 1, y1 + padding)
    x0 = max(0, x0 - padding)
    x1 = min(w - 1, x1 + padding)

    return img.crop((x0, y0, x1 + 1, y1 + 1))


def process_sprite(arr, bg_mask, mode='glow', threshold=20, boost=1.5, feather=2):
    """Apply alpha and return RGBA PIL Image."""
    h, w = arr.shape[:2]
    rgba = arr[:, :, :4].copy() if arr.shape[2] >= 4 else np.dstack([arr[:, :, :3], np.full((h, w), 255, dtype=np.uint8)])

    if mode == 'glow':
        rgba[:, :, 3] = make_glow_alpha(arr, bg_mask, threshold, boost)
    else:
        rgba[:, :, 3] = make_cutout_alpha(arr, bg_mask, feather)

    return Image.fromarray(rgba, 'RGBA')


# ============================================================
# Processing functions
# ============================================================

def process_grid(filepath, cols, rows, names, mode='glow', tolerance=35,
                 threshold=20, boost=1.5, feather=2):
    """Process a grid-based sprite sheet. One sprite per cell."""
    img = Image.open(filepath).convert('RGBA')
    arr = np.array(img)
    h, w = arr.shape[:2]
    cw, ch = w // cols, h // rows

    results = []
    idx = 0
    for row in range(rows):
        for col in range(cols):
            if idx >= len(names):
                break

            # Crop cell
            x0, y0 = col * cw, row * ch
            x1, y1 = (col + 1) * cw, (row + 1) * ch
            cell = arr[y0:y1, x0:x1].copy()

            # Detect bg and flood fill per cell
            bg_color = detect_bg_color(cell)
            bg_mask = flood_fill_bg(cell, bg_color, tolerance)

            # Create sprite
            sprite = process_sprite(cell, bg_mask, mode, threshold, boost, feather)
            sprite = trim_transparent(sprite)

            name = names[idx] if not names[idx].endswith('.png') else names[idx][:-4]
            out_path = os.path.join(OUT_DIR, f'{name}.png')
            sprite.save(out_path, 'PNG')
            print(f"  [{idx+1}/{len(names)}] {name}.png ({sprite.size[0]}x{sprite.size[1]})")
            results.append(out_path)
            idx += 1

    return results


def process_auto(filepath, prefix, mode='glow', tolerance=40, min_area=2000,
                 threshold=20, boost=1.5, feather=2, merge_dist=15, names=None,
                 bg_color_override=None):
    """Auto-detect and extract individual sprites from a scattered layout."""
    img = Image.open(filepath).convert('RGBA')
    arr = np.array(img)

    # Detect bg and flood fill
    bg_color = np.array(bg_color_override, dtype=np.float32) if bg_color_override else detect_bg_color(arr)
    print(f"  BG color: ({bg_color[0]:.0f}, {bg_color[1]:.0f}, {bg_color[2]:.0f})")

    bg_mask = flood_fill_bg(arr, bg_color, tolerance)
    fg_mask = ~bg_mask
    fg_pct = np.sum(fg_mask) / fg_mask.size * 100
    print(f"  Foreground: {fg_pct:.1f}% of image")

    # Find components
    components = find_components(fg_mask, min_area, merge_dist)
    print(f"  Found {len(components)} sprites (min_area={min_area})")

    results = []
    for i, comp in enumerate(components):
        x0, y0, x1, y1 = comp['bbox']

        # Add padding around bbox
        pad = 8
        h, w = arr.shape[:2]
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(w, x1 + pad)
        y1 = min(h, y1 + pad)

        # Crop region
        region = arr[y0:y1, x0:x1].copy()
        region_bg = bg_mask[y0:y1, x0:x1].copy()

        # Create sprite
        sprite = process_sprite(region, region_bg, mode, threshold, boost, feather)
        sprite = trim_transparent(sprite, padding=2)

        if names and i < len(names):
            name = names[i]
        else:
            name = f"{prefix}{i+1}"

        if not name.endswith('.png'):
            name += '.png'

        out_path = os.path.join(OUT_DIR, name)
        sprite.save(out_path, 'PNG')
        area_k = comp['area'] / 1000
        print(f"  [{i+1}/{len(components)}] {name} ({sprite.size[0]}x{sprite.size[1]}, {area_k:.1f}k px)")
        results.append(out_path)

    return results


# ============================================================
# Image configurations
# ============================================================

def src(name):
    """Get full path for a source image."""
    # Check animations dir first, then img dir
    p = os.path.join(ANIM_DIR, name)
    if os.path.exists(p):
        return p
    p = os.path.join(BASE, 'img', name)
    if os.path.exists(p):
        return p
    return p


def process_all():
    """Process all source images."""
    total_sprites = 0
    t0 = time.time()

    # ---- DARK BG, GRID LAYOUT ----

    print("\n=== Fire Frames (image copy 3.png) - 4x2 grid, dark bg ===")
    r = process_grid(src('image copy 3.png'), 4, 2,
        [f'fire_{i+1}' for i in range(8)],
        mode='glow', tolerance=35, threshold=25, boost=1.5)
    total_sprites += len(r)

    print("\n=== Lightning (image copy 4.png) - 3x1 grid, dark bg ===")
    r = process_grid(src('image copy 4.png'), 3, 1,
        ['lightning_1', 'lightning_2', 'lightning_3'],
        mode='glow', tolerance=30, threshold=20, boost=1.4)
    total_sprites += len(r)

    print("\n=== Purple Magic (image copy 5.png) - 2x2 grid, dark bg ===")
    r = process_grid(src('image copy 5.png'), 2, 2,
        ['purple_orb', 'purple_lightning', 'purple_spiral', 'purple_eruption'],
        mode='glow', tolerance=30, threshold=20, boost=1.4)
    total_sprites += len(r)

    print("\n=== Blue/Teal Magic (image copy.png) - 3x3 grid, dark bg ===")
    r = process_grid(src('image copy.png'), 3, 3,
        ['blue_bolt_sm', 'blue_slash', 'purple_flame_sm',
         'blue_lightning_big', 'teal_impact', 'purple_pillar',
         'blue_dissipate', 'teal_vortex', 'purple_wisp'],
        mode='glow', tolerance=35, threshold=20, boost=1.3)
    total_sprites += len(r)

    print("\n=== Water/Ice (image copy 8.png) - 3x2 grid, dark bg ===")
    r = process_grid(src('image copy 8.png'), 3, 2,
        ['ice_comet', 'ice_dome', 'ice_wave', 'ice_ring', 'ice_waterfall', 'ice_whip'],
        mode='glow', tolerance=30, threshold=20, boost=1.3)
    total_sprites += len(r)

    print("\n=== Ice Slash Frames (image copy 17.png) - 5x3 grid, dark bg ===")
    r = process_grid(src('image copy 17.png'), 5, 3,
        [f'slash_ice_{i+1}' for i in range(11)],  # skip last 4 (empty)
        mode='glow', tolerance=25, threshold=15, boost=1.3)
    total_sprites += len(r)

    # ---- DARK BG, SCATTERED → AUTO DETECT ----

    print("\n=== Water Splashes (image copy 7.png) - 4x2 grid, dark bg ===")
    r = process_grid(src('image copy 7.png'), 4, 2,
        ['water_arc', 'water_wave', 'water_splash', 'water_drip',
         'water_geyser', 'water_slash', 'water_burst', 'water_fountain'],
        mode='glow', tolerance=50, threshold=20, boost=1.4)
    total_sprites += len(r)

    print("\n=== Mixed Elements (image.png) - auto, dark bg ===")
    r = process_auto(src('image.png'), 'elem_',
        mode='glow', tolerance=50, min_area=1500, merge_dist=10,
        threshold=25, boost=1.4)
    total_sprites += len(r)

    print("\n=== Special FX (image copy 2.png) - auto, dark bg ===")
    r = process_auto(src('image copy 2.png'), 'fx_',
        mode='glow', tolerance=40, min_area=2000, merge_dist=15,
        threshold=20, boost=1.3)
    total_sprites += len(r)

    print("\n=== Fire Shapes (image copy 6.png) - auto, dark bg ===")
    r = process_auto(src('image copy 6.png'), 'flame_',
        mode='glow', tolerance=40, min_area=2000, merge_dist=20,
        threshold=30, boost=1.5)
    total_sprites += len(r)

    print("\n=== Purple Magic Alt (image copy 9.png) - auto, dark bg ===")
    r = process_auto(src('image copy 9.png'), 'purple_alt_',
        mode='glow', tolerance=40, min_area=2500, merge_dist=15,
        threshold=20, boost=1.3)
    total_sprites += len(r)

    print("\n=== Mixed VFX / Skulls (image copy 12.png) - auto, dark bg ===")
    r = process_auto(src('image copy 12.png'), 'death_',
        mode='glow', tolerance=35, min_area=2000, merge_dist=8,
        threshold=20, boost=1.4)
    total_sprites += len(r)

    print("\n=== Attack Effects (image copy 13.png) - auto, dark bg ===")
    r = process_auto(src('image copy 13.png'), 'attack_',
        mode='glow', tolerance=40, min_area=2500, merge_dist=20,
        threshold=20, boost=1.4,
        names=['attack_pink_flame', 'attack_fire_swoosh', 'attack_gold_ring',
               'attack_crystal', 'attack_water_wave', 'attack_water_splash'])
    total_sprites += len(r)

    # ---- GRAY BG → CUTOUT MODE ----

    print("\n=== Purple Dark Magic (image copy 10.png) - auto, gray bg ===")
    r = process_auto(src('image copy 10.png'), 'dark_',
        mode='cutout', tolerance=38, min_area=3000, merge_dist=25,
        feather=2,
        names=['dark_projectile', 'dark_swirl', 'dark_burst',
               'dark_vortex', 'dark_explosion', 'dark_slash', 'dark_ghost'])
    total_sprites += len(r)

    print("\n=== Multi-Element (image copy 14.png) - manual regions, gray bg ===")
    # Effects scattered on gray bg, need manual crop
    me_img = Image.open(src('image copy 14.png')).convert('RGBA')
    me_arr = np.array(me_img)
    mh, mw = me_arr.shape[:2]
    regions = [
        ('attack_green_slash', (0, int(mh*0.18), int(mw*0.45), int(mh*0.72))),
        ('attack_fire_bolt',   (int(mw*0.35), int(mh*0.15), int(mw*0.7), int(mh*0.72))),
        ('attack_water_jet',   (0, int(mh*0.72), int(mw*0.4), mh)),
        ('attack_lightning_bolt', (int(mw*0.55), int(mh*0.65), mw, mh)),
    ]
    for name, (rx0, ry0, rx1, ry1) in regions:
        region = me_arr[ry0:ry1, rx0:rx1].copy()
        bg_c = np.array([78, 78, 78], dtype=np.float32)
        bg_m = flood_fill_bg(region, bg_c, 50)
        sprite = process_sprite(region, bg_m, 'cutout', feather=2)
        sprite = trim_transparent(sprite)
        out_path = os.path.join(OUT_DIR, f'{name}.png')
        sprite.save(out_path, 'PNG')
        print(f"  {name}.png ({sprite.size[0]}x{sprite.size[1]})")
        total_sprites += 1

    print("\n=== Blood Splatters (image copy 16.png) - 4x3 grid, gray bg ===")
    r = process_grid(src('image copy 16.png'), 4, 3,
        [f'blood_splat_{i+1}' for i in range(12)],
        mode='cutout', tolerance=40, feather=1)
    total_sprites += len(r)

    # ---- LIGHT/BEIGE BG → CUTOUT MODE ----

    print("\n=== Fire Types (image copy 11.png) - 5x2 grid, beige bg ===")
    # 5 fire types top row, 4 + watermark bottom row
    r = process_grid(src('image copy 11.png'), 5, 2,
        ['fire_sharp', 'fire_swooshy', 'fire_lava', 'fire_smoky', 'fire_rounded',
         'fire_spirit', 'fire_steam', 'fire_dragon', 'fire_dark'],
        mode='cutout', tolerance=55, feather=2)
    total_sprites += len(r)

    print("\n=== Red Claw (image copy 15.png) - auto, white bg ===")
    r = process_auto(src('image copy 15.png'), 'attack_',
        mode='cutout', tolerance=45, min_area=1000, merge_dist=10,
        feather=2,
        names=['attack_red_claw'])
    total_sprites += len(r)

    # ---- SUMMARY ----
    elapsed = time.time() - t0
    all_sprites = sorted(os.listdir(OUT_DIR))
    print(f"\n{'='*60}")
    print(f"DONE! Generated {total_sprites} sprites in {elapsed:.1f}s")
    print(f"Total files in {OUT_DIR}: {len(all_sprites)}")
    print(f"{'='*60}")

    # Print all sprites with sizes
    for s in all_sprites:
        path = os.path.join(OUT_DIR, s)
        size_kb = os.path.getsize(path) / 1024
        img = Image.open(path)
        print(f"  {s:40s} {img.size[0]:4d}x{img.size[1]:<4d}  {size_kb:.0f}KB")


if __name__ == '__main__':
    process_all()
