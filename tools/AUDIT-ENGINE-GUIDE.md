# Card Audit Engine — Guia de Uso Genérico

## O que é

Ferramenta de auditoria 3-layer que verifica se **todas** as cartas de um set estão corretamente implementadas na engine do jogo. Compara oracle text do Scryfall contra o `CardEffectsDB` e os handlers do engine.

## 3 Layers de Verificação

| Layer | Nome | O que verifica |
|-------|------|----------------|
| **L1** | Data | Carta tem entry no CardEffectsDB? Se o oracle tem abilities, deveria ter. |
| **L2** | Engine | Todo `effect.type`, `trigger.event`, `trigger.condition` e `grant.target` do DB tem handler correspondente no engine (`game-state.ts`)? |
| **L3** | Oracle Match | Oracle text do Scryfall bate com o que está no DB? (ETB, triggered, activated, keywords, scry, amass, ring tempts, etc.) |

## Como usar para um novo set

### 1. Preparar dados

```bash
# Baixar cartas do Scryfall (já ter o JSON em legacy-pure-js/js/data/)
# Formato: { "set": "XXX", "total": N, "cards": [...] }

# Criar lista de nomes das cartas (1 por linha)
# Arquivo: <set>_audit_list.txt na raiz do projeto
```

### 2. Criar cópia do audit engine

Copiar `tools/ltr-audit-engine.ts` e ajustar:

```typescript
// Linha 21 — Caminho do JSON do Scryfall
const scryfallPath = path.resolve(__dirname, '../legacy-pure-js/js/data/scryfall-<SET>.json');

// Linha 575 — Caminho da lista de cartas
const auditListPath = path.resolve(__dirname, '../<set>_audit_list.txt');

// Linhas 77-206 — Sets de valores suportados
// Adicionar novos conditions/events/effects específicos do set
```

### 3. Rodar

```bash
# Auditar TODAS as cartas
npx tsx tools/<set>-audit-engine.ts

# Auditar cartas 16-20
npx tsx tools/<set>-audit-engine.ts 16 20

# Buscar carta por nome
npx tsx tools/<set>-audit-engine.ts "Gandalf"

# Auditar 5 cartas a partir da #50
npx tsx tools/<set>-audit-engine.ts 50
```

### 4. Interpretar resultados

```
✅ = OK, sem problemas
❌ = ERRO — handler faltando no engine ou carta sem entry no DB
⚠️  = WARNING — ability parcialmente implementada ou false positive
ℹ️  = INFO — vanilla/keyword-only, sem necessidade de entry no DB
```

## Estrutura do Audit

### `parseOracle(card)` — Extrai flags do oracle text via regex

| Flag | Regex |
|------|-------|
| `hasETB` | `when .* enters` |
| `hasTriggered` | `whenever\|when\|at the beginning` |
| `hasActivated` | `{cost}...:` (stripping reminder text) |
| `hasAnthem` | `creatures you control get +X/+Y` |
| `hasDamage` | `deals N damage` |
| `hasDestroy` | `destroy` |
| `hasDraw` | `draw` |
| `hasCounter` | `+1/+1 counter` (não counterspell) |
| `hasCounterSpell` | `counter target spell` |
| `hasExile` | `exile` |
| `hasBounce` | `return to hand/owner` |
| `hasRamp` | `search library land` |
| `hasScry` | `scry` |
| `hasSurveil` | `surveil` |
| `hasTokens` | `create token` |
| `hasRingTempts` | `ring tempts you` |
| `hasAmass` | `amass` |
| `hasCycling` | `cycling` keyword |
| `hasFlash` | `flash` keyword |
| `hasPreventUntap` | `doesn't untap` |
| `hasGainControl` | `gain control` |
| `hasLoseAbilities` | `loses all abilities` |

### `collectEffects(db)` — Flattena TODOS os efeitos de uma entry

Coleta de: `cast`, `etb`, `triggered[].effects`, `activated[].effects`, `static`, `chapters[1-3]`, `graveyard[].effects`

### `flattenEffects(effects)` — Expande modais

Se um efeito é `type: "modal"`, expande cada modo para verificação individual.

### `auditCard(cardName, scryfallCard)` — Audita uma carta

1. **L1**: Verifica se key existe no CardEffectsDB
2. **L2**: Para cada efeito, verifica se o `type` está no `SUPPORTED_EFFECT_TYPES`; para cada trigger, verifica `event` e `condition`; para grant, verifica `target`
3. **L3**: Compara flags do oracle contra o que existe no DB

### False positive handling

O audit já trata:
- **Reminder text** de Food/Treasure (strip antes de checar activated)
- **Equip/cycling** cobrem activated abilities (não duplica warning)
- **Chapters de saga** incluídos na verificação de effects
- **`aura_grant_triggered`** conta como triggered ability
- **Ward {N}** não é activated ability
- **Scry como trigger event** (ex: "whenever you scry")
- **Keywords em chapters** de sagas

## Sets de valores suportados

Os 4 sets (`SUPPORTED_*`) devem ser mantidos sincronizados com o engine:

| Set | Onde no engine |
|-----|----------------|
| `SUPPORTED_TRIGGER_CONDITIONS` | `_checkTriggerCondition()` em game-state.ts |
| `SUPPORTED_EFFECT_CONDITIONS` | `_checkEffectCondition()` em game-state.ts |
| `SUPPORTED_TRIGGER_EVENTS` | `fireTrigger()` — cada `if (trigger.event === 'xxx')` |
| `SUPPORTED_EFFECT_TYPES` | `_resolveSimpleEffect()` — cada `case 'xxx':` |
| `SUPPORTED_GRANT_TARGETS` | `case 'grant':` — cada target handler |

### Para adicionar um novo set

1. Copiar os sets existentes
2. Adicionar conditions/events/effects específicos do novo set (ex: `'ring_tempts'` para LTR)
3. Se implementar novo effect type no engine, adicionar ao `SUPPORTED_EFFECT_TYPES`

## Workflow de auditoria completa

```
1. Rodar audit → ver erros
2. Priorizar: ❌ errors primeiro, depois ⚠️ warnings
3. Para cada erro:
   a. Buscar oracle text no Scryfall
   b. Adicionar/corrigir entry no CardEffectsDB
   c. Se effect type novo: implementar handler no engine
4. Re-rodar audit → repetir até 0 errors, 0 warnings
5. Resultado: "262 cards | 0 errors | 0 warnings"
```

## Exemplo de output

```
╔══════════════════════════════════════════════════════════╗
║         CARD AUDIT — 3-Layer Verification                ║
╠══════════════════════════════════════════════════════════╣
║  Cards audited: 262   | Errors: 0     | Warnings: 0    ║
╚══════════════════════════════════════════════════════════╝

  #  1 ✅ Andúril, Flame of the West
  #  2 ✅ Aragorn, Company Leader
  #  3 ✅ Aragorn, the Uniter
  ...
  #262 ✅ Wose Pathfinder

Layer 1 = Data (DB exists?)  |  Layer 2 = Engine (handlers exist?)  |  Layer 3 = Oracle match
Total: 262 cards  |  0 errors  |  0 warnings
```
