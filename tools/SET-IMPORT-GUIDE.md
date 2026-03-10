# Guia Completo: Importar um Novo Set

## Visão Geral

Pipeline completo para adicionar um novo set de Magic ao jogo. Cobre desde o download de cartas até a implementação e teste de todas as mecânicas.

**Tempo estimado por set**: depende da complexidade das mecânicas.

---

## Pipeline de Importação

```
┌──────────────────────────────────────────────────────────────┐
│  FASE 1: DADOS                                                │
│  Scryfall API → JSON → IndexedDB/SQLite                      │
├──────────────────────────────────────────────────────────────┤
│  FASE 2: EFEITOS                                              │
│  Oracle text → CardEffectsDB entries → Engine handlers        │
├──────────────────────────────────────────────────────────────┤
│  FASE 3: AUDITORIA                                            │
│  3-Layer audit → Fix erros → 0 errors / 0 warnings           │
├──────────────────────────────────────────────────────────────┤
│  FASE 4: TESTE                                                │
│  Playtest manual → Fix bugs → Re-audit                       │
└──────────────────────────────────────────────────────────────┘
```

---

## FASE 1: Download e Armazenamento de Dados

### 1.1 Baixar cartas do Scryfall

Criar `tools/fetch-<SET>.py` baseado no template:

```python
import json, time, urllib.request

SET_CODE = "xxx"  # código do set (lowercase), ex: "ltr", "tdm", "mkm"
SET_NAME = "XXX"  # nome curto (uppercase), ex: "LTR", "TDM"
API = f"https://api.scryfall.com/cards/search?q=set:{SET_CODE}&unique=prints"

all_cards = []
url = API
while url:
    print(f"Fetching: {url[:80]}...")
    req = urllib.request.Request(url, headers={
        "User-Agent": "MagicDraftSim/1.0",
        "Accept": "application/json"
    })
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    all_cards.extend(data["data"])
    if data.get("has_more"):
        url = data["next_page"]
        time.sleep(0.1)
    else:
        url = None

print(f"Total prints fetched: {len(all_cards)}")

# Filter: English, paper only
cards = [c for c in all_cards
         if c.get("lang") == "en" and "paper" in c.get("games", [])]
print(f"After en+paper filter: {len(cards)}")

# Dedup by name — pick the best art variant
from collections import defaultdict
by_name = defaultdict(list)
for c in cards:
    by_name[c["name"]].append(c)

def priority(c):
    """Art priority: showcase > borderless > normal > extended"""
    fe = c.get("frame_effects", [])
    bc = c.get("border_color", "black")
    cn = c.get("collector_number", "999")
    try: cn_int = int(cn)
    except: cn_int = 999

    # Showcase (ring showcase, anime showcase, etc.)
    if "showcase" in fe and "inverted" not in fe:
        return 1
    # Borderless / scene card
    if bc == "borderless" and "showcase" not in fe:
        return 2
    # Normal printing (within set number range)
    max_cn = 300  # ajustar por set se necessário
    non_legend_fe = [f for f in fe if f != "legendary"]
    if not non_legend_fe and cn_int <= max_cn:
        return 3
    if not non_legend_fe and "extendedart" not in fe:
        return 4
    return 99

picked = []
for name, variants in sorted(by_name.items()):
    best = min(variants, key=priority, default=None)
    if best and priority(best) < 99:
        picked.append(best)

print(f"Picked {len(picked)} unique cards")

output = {"set": SET_NAME, "total": len(picked), "cards": picked}
out_path = f"legacy-pure-js/js/data/scryfall-{SET_CODE}.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False)
print(f"Saved to {out_path}")
```

**Rodar:**
```bash
python tools/fetch-<SET>.py
```

### 1.2 (Opcional) Baixar art alternativa

Para sets com showcase/scene/alternate art, criar script similar a `tools/fetch-ltr-art.py` que:
1. Busca variantes de art (scene, showcase, extended, etc.)
2. Salva `scene_image_uris` ou `alt_image_uris` nos cards do JSON
3. O jogo usa essas na UI para variação visual nos boosters

### 1.3 Importar no jogo

O jogo importa automaticamente via `src/lib/scryfall.ts`:
- **Tauri**: `syncSingleSet(setCode)` → SQLite
- **Browser**: `syncAllCards()` → IndexedDB

Ou via UI: HomeScreen → botão "Sync" importa do Scryfall API direto.

Para import offline (do JSON local), o JSON é lido em `public/data/` ou via `legacy-pure-js/js/data/`.

### 1.4 Gerar lista de nomes para auditoria

```bash
# Extrair nomes das cartas do JSON (1 por linha, lowercase)
node -e "
const data = require('./legacy-pure-js/js/data/scryfall-<SET>.json');
const names = data.cards
  .map(c => c.name.toLowerCase())
  .filter(n => !n.includes('//'))  // skip DFC back faces
  .sort();
require('fs').writeFileSync('<set>_audit_list.txt', names.join('\n'));
console.log(names.length + ' cards');
"
```

---

## FASE 2: Implementar Efeitos no CardEffectsDB

### 2.1 Entender as mecânicas do set

Antes de começar, identificar mecânicas específicas do set:
- **LTR**: Ring tempts you, Amass Orcs, Food tokens
- **TDM**: Behold, Mobilize, Flurry, Endure, Harmonize
- Cada set tem 3-5 mecânicas únicas que precisam de handlers novos

### 2.2 Categorizar cartas por tipo

Organizar as entries no `src/engine/card-effects.ts` com seções:

```typescript
// =================== <SET NAME> — INSTANTS ===================
// =================== <SET NAME> — SORCERIES ===================
// =================== <SET NAME> — CREATURES WITH ETB ===================
// =================== <SET NAME> — CREATURES WITH TRIGGERS ===================
// =================== <SET NAME> — ACTIVATED ABILITIES ===================
// =================== <SET NAME> — ENCHANTMENTS ===================
// =================== <SET NAME> — SAGAS ===================
// =================== <SET NAME> — EQUIPMENT ===================
// =================== <SET NAME> — LANDS ===================
// =================== <SET NAME> — <MECHANIC NAME> ===================
```

### 2.3 Prompt para gerar entries em batch

Usar este prompt para o Claude gerar as entries card-effects:

```
Preciso implementar as cartas do set <SET> no CardEffectsDB.
O JSON das cartas está em: legacy-pure-js/js/data/scryfall-<SET>.json

Para CADA carta não-vanilla (que tem abilities no oracle_text):
1. Ler o oracle_text completo
2. Criar entry no formato CardEffectsDB
3. Mapear abilities para effect types existentes quando possível
4. Se precisar de effect type novo, listar separadamente

Formato da entry:
  "<nome lowercase>": {
    // Keywords estáticas
    static: [{ type: "has_keyword", keywords: ["flying", "trample"] }],
    // ETB effects
    etb: [{ type: "draw", amount: 1 }],
    // Cast effects (instants/sorceries)
    cast: [{ type: "damage", amount: 3, target: "any" }],
    // Triggered abilities
    triggered: [{ event: "attacks", self: true, effects: [...] }],
    // Activated abilities
    activated: [{ cost: { mana: "{2}", tap: true }, effects: [...] }],
    // Saga chapters
    saga: true, chapters: { 1: [...], 2: [...], 3: [...] },
  },

Effect types suportados: [ver SUPPORTED_EFFECT_TYPES no audit engine]
Trigger events suportados: [ver SUPPORTED_TRIGGER_EVENTS no audit engine]

Começar com as <TIPO> (instants/sorceries/creatures/etc.).
Fazer em batches de 10-15 cartas.
```

### 2.4 Implementar handlers para mecânicas novas

Para cada mecânica nova do set que não existe no engine:

1. Adicionar `case '<new_type>':` em `_resolveSimpleEffect()` em `game-state.ts`
2. Se for trigger event novo: adicionar condição em `fireTrigger()`
3. Se for condition nova: adicionar em `_checkTriggerCondition()` ou `_checkEffectCondition()`
4. Se for static nova: adicionar handler em `_applyStaticOnETB()`
5. Adicionar ao `SUPPORTED_*` set correspondente no audit engine

### 2.5 Checklist por tipo de carta

**Instants/Sorceries:**
- [ ] `cast: [...]` com effects corretos
- [ ] Targets corretos (creature, opponent_creature, any, etc.)
- [ ] Amounts corretos (damage, draw, etc.)
- [ ] Additional costs se houver (sacrifice, behold, etc.)
- [ ] Cost reduction se houver (self_cost_reduction)

**Creatures com ETB:**
- [ ] `etb: [...]` com effects
- [ ] Target interactive se humano precisa escolher
- [ ] Conditions se ETB é condicional

**Creatures com Triggers:**
- [ ] `triggered: [{ event, self, effects, condition? }]`
- [ ] `self: true` se trigger é "when THIS attacks" vs `self: false` se "whenever YOU attack"
- [ ] Conditions corretas (ex: `cast_with_another_spell`, `attacks_alone`)

**Creatures com Activated:**
- [ ] `activated: [{ cost: { mana, tap, sacrifice? }, effects }]`
- [ ] Cost de mana no formato correto: `"{2}{W}"` com braces
- [ ] `sacrifice: "self"` para sacrificar a si mesmo, `sacrifice: "Food"` para tokens

**Enchantments/Auras:**
- [ ] Auras: `aura_debuff`, `aura_prevent_untap`, etc.
- [ ] Static effects: `anthem`, `grant_all`, etc.

**Sagas:**
- [ ] `saga: true, chapters: { 1: [...], 2: [...], 3: [...] }`
- [ ] Cada capítulo com effects independentes
- [ ] Token com `death_trigger` se necessário

**Equipment:**
- [ ] `equip: { cost: N, power: X, toughness: Y }`
- [ ] Triggered abilities do equipment (ex: `equipped_attacks`, `equipped_blocked_by`)

**Lands:**
- [ ] `activated: [{ cost: { tap: true }, effects: [{ type: "add_mana", color: "B" }] }]`
- [ ] `enters_tapped` se entra virado
- [ ] Triggered/static se tiver abilities especiais

---

## FASE 3: Auditoria Automatizada

### 3.1 Criar audit engine para o set

Copiar `tools/ltr-audit-engine.ts` → `tools/<set>-audit-engine.ts`

Ajustar:
```typescript
// Linha 21 — path do JSON
const scryfallPath = path.resolve(__dirname, '../legacy-pure-js/js/data/scryfall-<SET>.json');

// Linha 575 — path da audit list
const auditListPath = path.resolve(__dirname, '../<set>_audit_list.txt');

// Linhas 77-206 — SUPPORTED_* sets
// Adicionar mecânicas/conditions/events/effects novos do set
```

### 3.2 Rodar auditoria

```bash
# Audit completo
npx tsx tools/<set>-audit-engine.ts

# Audit parcial (cartas 1-20)
npx tsx tools/<set>-audit-engine.ts 1 20

# Buscar carta específica
npx tsx tools/<set>-audit-engine.ts "Card Name"
```

### 3.3 Interpretar e corrigir

| Resultado | Ação |
|-----------|------|
| `❌ L1: Card NOT in CardEffectsDB` | Adicionar entry no DB |
| `❌ L2: Effect type "X" NOT handled` | Implementar handler no engine OU corrigir typo |
| `❌ L2: Trigger event "X" NOT in engine` | Adicionar condição no fireTrigger |
| `❌ L3: Oracle has "ring tempts" but no effect` | Adicionar effect na entry |
| `⚠️ L3: Oracle has triggered but no "triggered" in DB` | Verificar se é false positive ou ability faltando |
| `⚠️ L3: Scryfall keyword "flying" not in DB` | Adicionar `static: [{ type: "has_keyword", keywords: ["flying"] }]` |

### 3.4 Ciclo de correção

```
while (errors > 0 || warnings > 0) {
  1. Rodar audit
  2. Pegar primeiro erro/warning
  3. Consultar oracle text no Scryfall
  4. Corrigir entry no CardEffectsDB (ou implementar handler)
  5. Re-rodar audit
}
// Meta: "N cards | 0 errors | 0 warnings"
```

---

## FASE 4: Playtest e TDD

### 4.1 Playtest manual

```bash
# Iniciar o jogo
npm run tauri dev
# OU em browser:
npm run dev  # → http://localhost:1420
```

1. Criar draft com o novo set
2. Jogar partida completa
3. Anotar bugs: "Carta X não fez Y", "Efeito Z quebrou"

### 4.2 Bug fix workflow

Para CADA bug reportado:
1. **Scryfall**: Buscar oracle_text completo da carta
2. **Identificar**: Qual ability está bugada
3. **Analisar código**: CardEffectsDB entry + engine handler
4. **Corrigir**: DB entry ou engine code
5. **Re-testar**: Jogar novamente com a carta

### 4.3 Padrões de bugs comuns

| Sintoma | Causa provável | Fix |
|---------|---------------|-----|
| Efeito não acontece | Entry faltando/errada no DB | Corrigir entry |
| Trigger não dispara | `self: true/false` errado, ou event errado | Verificar oracle: "when THIS" vs "whenever YOU" |
| Alvo errado | `target` incorreto | Verificar: `creature` vs `opponent_creature` vs `own_creature` |
| Custo não reduz | `self_cost_reduction` não implementado no useGameEngine | Adicionar check antes do autoTapForSpell |
| Modal text ilegível | Falta `description` nos modos | Adicionar `description` field |
| Criatura se auto-target | `target: "own_creature"` inclui self | Mudar para `"other_own_creature"` |
| Keyword não funciona | `_losesAllAbilities` não checado | Verificar `hasKeyword()` |
| Token death trigger | `death_trigger` não registrado | Adicionar `death_trigger: [...]` no `create_token` effect |
| Sacrifice self não funciona | `sacrifice: "self"` não tratado | Verificar handlers de activated abilities |
| Counter removal para em 1 | Logic de counter/untap incorreta | Verificar handler de aura |

### 4.4 Verificação final

```bash
# 1. Audit 100% limpo
npx tsx tools/<set>-audit-engine.ts
# → "N cards | 0 errors | 0 warnings"

# 2. Build sem erros
npx tsc --noEmit
npx vite build

# 3. Playtest completo
# - 3+ partidas como humano
# - Testar mecânicas específicas do set
# - Verificar AI joga as cartas corretamente
```

---

## Referência Rápida: Arquivos Envolvidos

| Arquivo | Responsabilidade |
|---------|-----------------|
| `tools/fetch-<SET>.py` | Download de cartas do Scryfall |
| `legacy-pure-js/js/data/scryfall-<SET>.json` | JSON com dados de cartas |
| `<set>_audit_list.txt` | Lista de nomes de cartas (1 por linha) |
| `src/engine/card-effects.ts` | CardEffectsDB — entries de cada carta |
| `src/engine/game-state.ts` | Engine — handlers de effects, triggers, conditions |
| `src/engine/card-utils.ts` | Utilities — hasKeyword, getPower, canBlock, etc. |
| `src/engine/combat.ts` | Combate — dano, first strike, deathtouch |
| `src/components/game/GameOverlays.tsx` | UI — modal text, overlays |
| `src/hooks/useGameEngine.ts` | Bridge UI↔Engine — autoTap, spell casting |
| `tools/<set>-audit-engine.ts` | Auditoria 3-layer |

---

## Checklist Resumido

```
□ FASE 1: DADOS
  □ Criar tools/fetch-<SET>.py
  □ Rodar → gera scryfall-<SET>.json
  □ Gerar <set>_audit_list.txt
  □ (Opcional) Fetch alt art

□ FASE 2: EFEITOS
  □ Identificar mecânicas novas do set
  □ Implementar handlers para mecânicas novas no engine
  □ Gerar entries do CardEffectsDB em batches (instants → sorceries → creatures → etc.)
  □ Cada batch: consultar oracle, criar entry, verificar targets/conditions

□ FASE 3: AUDITORIA
  □ Criar tools/<set>-audit-engine.ts (copiar de ltr)
  □ Ajustar paths e SUPPORTED_* sets
  □ Rodar audit → corrigir erros → repetir
  □ Meta: 0 errors, 0 warnings

□ FASE 4: TESTE
  □ Playtest 3+ partidas completas
  □ Anotar e corrigir bugs
  □ Build limpo (tsc + vite)
  □ Re-audit final
```
