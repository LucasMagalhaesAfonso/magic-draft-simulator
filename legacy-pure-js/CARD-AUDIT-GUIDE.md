# 🔍 Card Completeness Auditor - Quick Guide

## Overview
Ferramenta para auditar cartas 100% usando Scryfall como base:
- Busca oracle_text completo no Scryfall
- Analisa todas as abilities (ETB, Cast, Triggered, Activated, Static)
- Verifica implementação no CardEffectsDB
- Valida suporte no engine (stack.js, game-state.js, cards.js)
- Gera relatório detalhado de gaps/bugs

---

## Quick Start

### **Auditar 1 lote de 5 cartas:**
```bash
node tools/audit-batch.js batch1
```

### **Auditar todas as 25 cartas:**
```bash
node tools/audit-batch.js all25
```

### **Auditar 1 carta específica:**
```bash
node tools/audit-batch.js "Card Name"
```

---

## Available Batches

| Comando | Cards | Status |
|---------|-------|--------|
| `batch1` | Ambling Stormshell, Avenger of the Fallen, Boulderborn Dragon, Descendant of Storms, Marshal of the Lost | Audit |
| `batch2` | Bone-Cairn Butcher, Dalkovan Packbeasts, Dragonback Lancer, Equilibrium Adept, Jeskai Devotee | Audit |
| `batch3` | Jeskai Shrinekeeper, Kotis the Fangkeeper, Mardu Siegebreaker, Nightblade Brigade, Reputable Merchant | Audit |
| `batch4` | Rescue Leopard, Reigning Victor, Shock Brigade, Sinkhole Surveyor, Stadium Headliner | Audit |
| `batch5` | Starry-Eyed Skyrider, Tempest Hawk, Traveling Botanist, Voice of Victory, Veteran Ice Climber, Zurgo's Vanguard, Zurgo Thunder's Decree | Audit |
| `all25` | All 25 cards | Audit |

---

## Report Output

### Status Indicators:
- ✅ **COMPLETE & VERIFIED** - Tudo implementado e verificado
- ⚠️ **INCOMPLETE** - Faltam implementações (lista o quê)
- ⚠️ **POTENTIAL ENGINE ISSUES** - Effect types não encontrados no engine
- ❌ **NOT IN DATABASE** - Carta não tem entry no CardEffectsDB

### Checklist Gerado:
```
Cast Effects:     Oracle=false | DB=false | Match=✅
ETB Effects:      Oracle=true  | DB=true  | Match=✅
Triggered:        Oracle=true  | DB=true  | Match=✅
Activated:        Oracle=false | DB=false | Match=✅
Static:           Oracle=true  | DB=true  | Match=✅
```

### Triggered Events:
```
Triggered Events Found: attacks, cast_spell
Triggered in DB:
  - Event: attacks, Self: true, Condition: none
  - Event: cast_spell ❌ MISSING!
```

---

## Workflow: Auditar + Corrigir

### 1️⃣ **Auditar Batch**
```bash
node tools/audit-batch.js batch1
```

### 2️⃣ **Ler o relatório e identificar gaps:**
- ❌ Triggered events missing
- ❌ Effect types not supported
- ❌ Conditions missing

### 3️⃣ **Corrigir manualmente:**
- Adicionar entries faltantes no CardEffectsDB
- Adicionar validação de `self` no engine (se necessário)
- Adicionar conditions ao trigger

### 4️⃣ **Re-auditar para confirmar:**
```bash
node tools/audit-batch.js "Card Name"
```

---

## Examples

### Audit Batch 1 (primeiras 5 cartas):
```bash
node tools/audit-batch.js batch1
```

Output:
```
📊 BATCH: BATCH1
Cards: Ambling Stormshell, Avenger of the Fallen, ...
🔍 Starting audit for 5 card(s)...

====================================================================================================
AUDITING: Ambling Stormshell
...
Overall Status: ⚠️  POTENTIAL ENGINE ISSUES

⚠️  ENGINE CONCERNS:
   ⚠️  Effect type 'stun_counter_self' may not be in stack.js

CHECKLIST:
  Cast Effects: Oracle=false | DB=false | Match=✅
  ETB Effects: Oracle=false | DB=false | Match=✅
  Triggered: Oracle=true | DB=true | Match=✅

  Triggered Events Found: attacks, cast_spell
  Triggered in DB:
    - Event: attacks ✅
    - Event: cast_spell ❌ MISSING!
```

---

## Key Findings Format

### ✅ Card is Complete
- Todas as abilities do oracle estão implementadas
- Engine suporta todos os effect types
- Nenhuma warning

### ⚠️ Card Missing Implementation
- Some abilities no oracle não estão no DB
- Example: "Whenever you cast a Turtle spell" não está como segundo trigger

### ⚠️ Card Has Engine Issue
- Effect type existe no DB mas não em stack.js
- Example: `stun_counter_self` pode não estar em stack.js

---

## Integration with Workflow

**Standard Flow:**
```
1. Run audit: node tools/audit-batch.js batch1
2. Review gaps and missing implementations
3. Fix CardEffectsDB entries
4. Fix engine if needed (add event support, effect handler)
5. Re-audit to verify
6. Commit when all ✅
```

---

## Architecture

### card-completeness-auditor.js
Core auditor que:
1. Fetches card from Scryfall
2. Parses oracle text for ability patterns
3. Checks CardEffectsDB for implementation
4. Validates engine support (grep for event/effect types)
5. Generates report

### audit-batch.js
Wrapper que simplifica comando:
- Predefined batches of 5 cards
- Run one batch: `batch1`, `batch2`, etc
- Run all: `all25`
- Run single: `"Card Name"`

