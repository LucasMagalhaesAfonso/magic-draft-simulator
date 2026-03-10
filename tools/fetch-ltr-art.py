import json, subprocess, time

def fetch(url):
    r = subprocess.run(['curl', '-s', url, '-H', 'User-Agent: MagicDraft/1.0'], capture_output=True)
    return json.loads(r.stdout.decode('utf-8'))

out_path = r'C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft\legacy-pure-js\js\data\scryfall-ltr.json'

# Step 1: Fetch normal booster cards (unique=cards gives 1 per card name, default printing)
print('=== Fetching normal booster cards ===')
normal_cards = []
page = 1
while True:
    print(f'  Page {page}...')
    data = fetch(f'https://api.scryfall.com/cards/search?q=set:ltr+is:booster&unique=cards&page={page}')
    normal_cards.extend(data['data'])
    if not data.get('has_more'):
        break
    page += 1
    time.sleep(0.12)

normal_cards = [c for c in normal_cards if c.get('lang') == 'en' and 'paper' in (c.get('games') or [])]
print(f'Normal booster cards: {len(normal_cards)}')

# Some of these might still be showcase. Filter to CN <= 281 only.
# For cards that unique=cards returned as showcase, fetch the normal printing separately.
final_normals = []
need_normal_fetch = []
for c in normal_cards:
    cn = c.get('collector_number', '0')
    cn_num = int(cn) if cn.isdigit() else 9999
    fe = c.get('frame_effects', [])
    if cn_num <= 281 and 'showcase' not in fe and 'inverted' not in fe:
        final_normals.append(c)
    else:
        need_normal_fetch.append(c['name'])

print(f'Already normal: {len(final_normals)}, need re-fetch: {len(need_normal_fetch)}')

# Re-fetch the ones that came as showcase - get their CN<=281 printing
for name in need_normal_fetch:
    time.sleep(0.12)
    safe_name = name.replace('"', '\\"')
    data = fetch(f'https://api.scryfall.com/cards/search?q=set:ltr+!"{safe_name}"+-frame:showcase+-frame:inverted+-is:borderless&unique=prints')
    found = False
    for c in data.get('data', []):
        cn_num = int(c['collector_number']) if c['collector_number'].isdigit() else 9999
        if cn_num <= 281 and c.get('lang') == 'en':
            final_normals.append(c)
            found = True
            break
    if not found:
        # Fallback: just use whatever we had
        orig = [c for c in normal_cards if c['name'] == name]
        if orig:
            final_normals.append(orig[0])
            print(f'  WARNING: No normal printing for {name}, using default')

print(f'Total normal cards: {len(final_normals)}')

# Step 2: Fetch scene cards
print('\n=== Fetching scene cards ===')
scene_cards = []
page = 1
while True:
    print(f'  Page {page}...')
    data = fetch(f'https://api.scryfall.com/cards/search?q=set:ltr+is:scene&unique=cards&page={page}')
    scene_cards.extend(data['data'])
    if not data.get('has_more'):
        break
    page += 1
    time.sleep(0.12)

scene_cards = [c for c in scene_cards if c.get('lang') == 'en']
print(f'Scene cards: {len(scene_cards)}')

# Build oracle_id -> scene image_uris
scene_imgs = {}
for c in scene_cards:
    oid = c.get('oracle_id')
    if oid and c.get('image_uris'):
        scene_imgs[oid] = c['image_uris']

# Step 3: Add scene_image_uris to cards that have scene variants
scene_count = 0
for card in final_normals:
    oid = card.get('oracle_id')
    if oid and oid in scene_imgs:
        card['scene_image_uris'] = scene_imgs[oid]
        scene_count += 1

print(f'\nCards with scene art variant: {scene_count}')

# Save
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({"set": "LTR", "total": len(final_normals), "cards": final_normals}, f, ensure_ascii=False)

print(f'Saved {len(final_normals)} cards ({scene_count} with scene art option)')
