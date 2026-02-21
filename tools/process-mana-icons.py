#!/usr/bin/env python3
"""
Process MTG mana symbol images:
- Remove background (flood-fill from corners → transparent)
- Crop to circle with transparent corners
- Save as src/assets/mana-{color}.png
"""

from PIL import Image
import numpy as np
import os

# Map filenames to mana color codes
FILES = {
    'image.png':        'U',  # water drop = blue
    'image copy.png':   'R',  # phoenix = red
    'image copy 2.png': 'B',  # skull = black
    'image copy 3.png': 'W',  # sun = white
    'image copy 4.png': 'G',  # tree = green
}

INPUT_DIR  = os.path.join(os.path.dirname(__file__), '..', 'img')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
os.makedirs(OUTPUT_DIR, exist_ok=True)

def flood_fill_transparent(img_array, seed_x, seed_y, tolerance=30):
    """
    Flood-fill from (seed_x, seed_y), replacing similar-colored pixels
    with transparent. Returns a mask of pixels to make transparent.
    """
    h, w = img_array.shape[:2]
    target_color = img_array[seed_y, seed_x, :3].astype(int)
    mask = np.zeros((h, w), dtype=bool)

    stack = [(seed_x, seed_y)]
    visited = np.zeros((h, w), dtype=bool)

    while stack:
        x, y = stack.pop()
        if x < 0 or x >= w or y < 0 or y >= h:
            continue
        if visited[y, x]:
            continue
        visited[y, x] = True

        pixel = img_array[y, x, :3].astype(int)
        diff = np.abs(pixel - target_color).max()
        if diff > tolerance:
            continue

        mask[y, x] = True
        stack.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1)])

    return mask


def process_image(input_path, color_code, output_path, size=64):
    img = Image.open(input_path).convert('RGBA')
    arr = np.array(img)

    h, w = arr.shape[:2]

    # Flood fill from all 4 corners to find and remove background
    combined_mask = np.zeros((h, w), dtype=bool)
    for sx, sy in [(0,0), (w-1,0), (0,h-1), (w-1,h-1)]:
        if arr[sy, sx, 3] > 0:  # only if not already transparent
            m = flood_fill_transparent(arr, sx, sy, tolerance=35)
            combined_mask |= m

    # Make those pixels transparent
    arr[combined_mask, 3] = 0

    # Also: make a circular mask — any pixel outside the circle → transparent
    cy, cx = h // 2, w // 2
    radius = min(h, w) // 2 - 2
    ys, xs = np.ogrid[:h, :w]
    outside_circle = (xs - cx)**2 + (ys - cy)**2 > radius**2
    arr[outside_circle, 3] = 0

    result = Image.fromarray(arr, 'RGBA')

    # Resize to target size
    result = result.resize((size, size), Image.LANCZOS)
    result.save(output_path, 'PNG')
    print(f'  OK {color_code}: {os.path.basename(input_path)} -> mana-{color_code}.png ({size}x{size})')


print('Processing mana icons...')
for filename, color in FILES.items():
    input_path  = os.path.join(INPUT_DIR, filename)
    output_path = os.path.join(OUTPUT_DIR, f'mana-{color}.png')
    if os.path.exists(input_path):
        process_image(input_path, color, output_path, size=64)
    else:
        print(f'  SKIP: {filename} not found')

print('Done! Files saved to src/assets/')
