# Relatório: Definições Não Implementadas

**Data**: 2026-02-16
**Total de problemas**: 52 definições não implementadas
**Cartas afetadas**: 24 cartas

---

## 🔴 CRÍTICO: Cartas Quebradas (24)

### Effects Não Implementados (12)

#### 1. `bounce_to_library` - 1 carta
- **riverwalk technique**
- Fix: Adicionar case no stack.js

#### 2. `damage_divided` - 1 carta
- **ureni, the song unending**
- Fix: Adicionar case no stack.js (dividir dano entre múltiplos alvos)

#### 3. `damage_each_opponent` - 1 carta
- **cori mountain stalwart**
- Fix: Adicionar case no stack.js

#### 4. `optional_discard_draw` - 1 carta
- **rescue leopard**
- Fix: Adicionar case no stack.js (descarta depois puxa)

#### 5. `sacrifice` - 3 cartas
- **felothar, dawn of the abzan**
- **duty beyond death**
- **worthy cost**
- Fix: Adicionar case no stack.js

#### 6. `multi_buff_up_to` - Provavelmente implementado
- Verificar: pode estar em outro lugar

#### 7. `opponent_loses_half_life` - Provavelmente implementado
- Verificar: pode estar em outro lugar

#### 8. `register_temp_trigger` - Provavelmente implementado
- Verificar: pode estar em outro lugar

#### 9-12. Outros (menos críticos)
- `exile_top_choose`, `exile_with_suspend`, `return_to_hand`, `untap_self`

---

### Targets Não Implementados (34)

#### CRÍTICOS (usados por cartas):

1. **`colored_permanent`** - ugin, eye of the storms
2. **`creature_power2_or_less`** - smile at death
3. **`creature_power_3_or_less`** - disruptive stormbrood
4. **`creature_without_flying`** - twinmaw stormbrood
5. **`creatures_and_planeswalkers`** - dragonback assault
6. **`distribute_creatures`** - armament dragon
7. **`divided`** - twin bolt (dano dividido)
8. **`dragons`** - call the spirit dragons
9. **`instant_or_sorcery`** - kishla trawlers
10. **`nonland_permanent`** - 4 cartas (felothar, awaken, riverwalk, inevitable)
11. **`opponent_spell`** - runescale stormbrood
12. **`other_own_creature`** - loxodon battle priest
13. **`spell_or_permanent`** - jeskai revelation

#### Menos Críticos (não encontrados em cartas):
- attacking_creature, attacking_tokens, colorless_nonland, creature_mv_plus1, creature_or_land, creature_power4+, creatures_entered_this_turn, creatures_with_counters, dragon_each_color, nonbasic_land, noncreature_artifact, opponent_artifact_or_creature, opponent_creature_mv3+, other_dragons, own_creature_power2, own_creature_power4, own_nonland, permanent_mv3+, returned_creatures, sorcery_and_dragon_spells, artifacts_creatures_planeswalkers

---

### Conditions Não Implementados (6)

#### CRÍTICO (usado por carta):

1. **`three_counter_types`** - hundred-battle veteran

#### Provavelmente Implementados (verificar):

2-6. `toughness_10+`, `toughness_20+`, `toughness_40+`, `if_library_empty`, `if_no_draw`

---

## 📋 Prioridade de Implementação

### 🔴 ALTA (Cartas completamente quebradas)

1. **sacrifice** (3 cartas) - CRÍTICO
2. **nonland_permanent** target (4 cartas)
3. **damage_divided** - ureni quebrado
4. **creature_without_flying** - twinmaw quebrado
5. **dragons** target - call spirit dragons quebrado
6. **instant_or_sorcery** target - kishla trawlers quebrado

### 🟡 MÉDIA (Cartas parcialmente quebradas)

7. bounce_to_library
8. damage_each_opponent
9. optional_discard_draw
10. colored_permanent
11. creature_power2_or_less
12. creature_power_3_or_less
13. creatures_and_planeswalkers
14. distribute_creatures
15. divided
16. opponent_spell
17. other_own_creature
18. spell_or_permanent
19. three_counter_types

### 🟢 BAIXA (Verificar se já implementado)

20. multi_buff_up_to
21. opponent_loses_half_life
22. register_temp_trigger
23. toughness_10+, 20+, 40+
24. Outros targets não usados

---

## ✅ Próximos Passos

1. Implementar `sacrifice` effect (3 cartas dependem)
2. Implementar `nonland_permanent` target (4 cartas dependem)
3. Implementar targets críticos: `dragons`, `instant_or_sorcery`, `creature_without_flying`
4. Implementar `damage_divided` para Ureni
5. Verificar se `multi_buff_up_to`, `opponent_loses_half_life`, `register_temp_trigger` já existem com outros nomes
6. Implementar targets restantes conforme necessidade

---

**Ferramentas**:
- `node tools/check-unimplemented.js` - Relatório completo
- `node tools/check-critical-unimplemented.js` - Apenas críticos
