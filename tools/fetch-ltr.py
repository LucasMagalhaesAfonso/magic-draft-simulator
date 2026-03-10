import json, time, urllib.request

API = "https://api.scryfall.com/cards/search?q=set:ltr&unique=prints"
all_cards = []
url = API

while url:
    print(f"Fetching: {url[:80]}...")
    req = urllib.request.Request(url, headers={"User-Agent": "MagicDraftSim/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    all_cards.extend(data["data"])
    if data.get("has_more"):
        url = data["next_page"]
        time.sleep(0.1)
    else:
        url = None

print(f"Total prints fetched: {len(all_cards)}")

# Filter: English, paper
cards = [c for c in all_cards if c.get("lang") == "en" and "paper" in c.get("games", [])]
print(f"After en+paper filter: {len(cards)}")

# Group by name
from collections import defaultdict
by_name = defaultdict(list)
for c in cards:
    by_name[c["name"]].append(c)

def priority(c):
    fe = c.get("frame_effects", [])
    bc = c.get("border_color", "black")
    cn = c.get("collector_number", "999")
    try:
        cn_int = int(cn)
    except ValueError:
        cn_int = 999

    # Ring Showcase: showcase but NOT inverted (inverted = scroll showcase)
    if "showcase" in fe and "inverted" not in fe:
        return 1  # best

    # Scene Card: borderless, no showcase
    if bc == "borderless" and "showcase" not in fe:
        return 2

    # Normal: no special frame_effects (legendary alone is fine), CN <= 281
    non_legend_fe = [f for f in fe if f != "legendary"]
    if not non_legend_fe and cn_int <= 281:
        return 3

    # Fallback: normal-border card beyond 281 but not extended art
    if not non_legend_fe and "extendedart" not in fe:
        return 4

    return 99  # skip

stats = {"ring_showcase": 0, "scene": 0, "normal": 0}
picked = []

for name, variants in sorted(by_name.items()):
    best = None
    best_pri = 99
    for v in variants:
        p = priority(v)
        if p < best_pri:
            best_pri = p
            best = v
    if best and best_pri < 99:
        picked.append(best)
        if best_pri == 1:
            stats["ring_showcase"] += 1
        elif best_pri == 2:
            stats["scene"] += 1
        else:
            stats["normal"] += 1

print(f"\nPicked {len(picked)} unique cards:")
print(f"  Ring Showcase: {stats['ring_showcase']}")
print(f"  Scene Cards:   {stats['scene']}")
print(f"  Normal:        {stats['normal']}")

output = {"set": "LTR", "total": len(picked), "cards": picked}
out_path = r"C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft\legacy-pure-js\js\data\scryfall-ltr.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False)
print(f"\nSaved to {out_path}")
