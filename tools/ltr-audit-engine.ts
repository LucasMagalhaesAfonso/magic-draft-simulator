/**
 * LTR Card Audit Engine — 3-Layer Verification
 *
 * Layer 1 (Data): Oracle text vs CardEffectsDB
 * Layer 2 (Engine): Every target/condition/event/effect type has a handler in the engine
 * Layer 3 (Oracle): Regex parse oracle → compare against DB for missing abilities
 *
 * Usage:
 *   npx tsx tools/ltr-audit-engine.ts                  # audit all
 *   npx tsx tools/ltr-audit-engine.ts 16 20             # audit cards 16-20
 *   npx tsx tools/ltr-audit-engine.ts "Gandalf"         # search by name
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Load data ────────────────────────────────────────────────────────────
const scryfallPath = path.resolve(__dirname, '../legacy-pure-js/js/data/scryfall-ltr.json');
const scryfallData = JSON.parse(fs.readFileSync(scryfallPath, 'utf-8'));
const scryfallCards: any[] = scryfallData.cards;

// Import CardEffectsDB
// We need to extract it from the TS source since it's an ES module
const cardEffectsPath = path.resolve(__dirname, '../src/engine/card-effects.ts');
const cardEffectsSource = fs.readFileSync(cardEffectsPath, 'utf-8');

// Parse CardEffectsDB keys
function getDBKeys(): Set<string> {
  const keys = new Set<string>();
  const regex = /^\s*"([^"]+)":\s*\{/gm;
  let m;
  while ((m = regex.exec(cardEffectsSource)) !== null) {
    keys.add(m[1].toLowerCase());
  }
  return keys;
}

function getDBEntry(cardName: string): any | null {
  const key = cardName.toLowerCase();
  // Find the entry in the source and parse it (rough extraction)
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`"${escapedKey}":\\s*\\{`, 'i');
  const match = regex.exec(cardEffectsSource);
  if (!match) return null;

  // Extract the object by counting braces
  let depth = 0;
  let start = match.index + match[0].length - 1;
  let i = start;
  for (; i < cardEffectsSource.length; i++) {
    if (cardEffectsSource[i] === '{') depth++;
    else if (cardEffectsSource[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const objStr = cardEffectsSource.substring(start, i + 1);
  try {
    // Convert JS object literal to JSON-like (handle unquoted keys, trailing commas)
    const jsonStr = objStr
      .replace(/\/\/[^\n]*/g, '') // remove comments
      .replace(/(\w+)\s*:/g, '"$1":') // quote keys
      .replace(/'/g, '"') // single to double quotes
      .replace(/,\s*([}\]])/g, '$1') // trailing commas
      .replace(/\b(true|false|null)\b/g, '$&'); // keep literals
    return JSON.parse(jsonStr);
  } catch {
    return { _raw: true }; // Could not parse, but entry exists
  }
}

// ── Engine supported values (extracted from game-state.ts) ───────────────

const SUPPORTED_TRIGGER_CONDITIONS = new Set([
  '7+_attacking', 'attacks_alone', 'attacked_this_turn', 'attacked_with_two',
  'cast_creature_and_noncreature', 'cast_turtle_spell',
  'cast_white_spell', 'cast_blue_spell', 'cast_red_spell', 'cast_green_spell', 'cast_black_spell',
  'cast_with_another_spell', 'creature_died', 'creature_with_counter',
  'control_creature_with_counter', 'elemental', 'equipped_creature',
  'frostcliff_jeskai_mode', 'frostcliff_temur_mode', 'glacierwood_temur_mode',
  'has_combat_draw', 'have_dragon', 'is_citizen', 'is_scout',
  'no_creatures_opponent', 'nontoken', 'opponent_lost_life', 'own_creature', 'own_turn',
  'ring_bearer_not_self', 'seven_cards_in_gy',
  'toughness_10+', 'toughness_20+', 'toughness_40+',
  'three_counter_types', 'two_or_more_attacking', 'two_spells_this_turn',
  'creature_died_this_turn',
  // LTR-specific conditions
  'elf_attacks', 'human_enters', 'human_enters_or_self', 'any_own_creature',
  'has_counter', 'army_attacks', 'army_deals_damage', 'goblin_or_orc_deals_damage',
  'treefolk_enters', 'treefolk_attacking', 'nontoken_creature', 'permanent_left_this_turn',
  'in_graveyard', 'target_is_goblin_or_orc', 'dealt_damage_to_goblin_or_orc',
  'goblin_or_orc_attacks', 'attacks_with_legendary', 'self_tapped', 'control_legendary',
  // Also conditions that go through _checkEffectCondition
  'control_2_legendary', 'legendary_creature',
]);

const SUPPORTED_EFFECT_CONDITIONS = new Set([
  'attacked_with_two', 'card_left_graveyard', 'cast_noncreature',
  'control_creature_with_counter', 'control_dragon', 'control_faerie',
  'control_kithkin', 'control_treefolk', 'dealt_damage_this_turn',
  'faeries_you_control', 'frostcliff_jeskai_mode', 'frostcliff_temur_mode',
  'glacierwood_sultai_mode', 'glacierwood_temur_mode',
  'if_beheld_dragon', 'if_cast', 'if_discarded_nonland', 'if_exiled',
  'if_library_empty', 'if_no_draw', 'is_citizen', 'is_scout',
  'main_phase', 'mv_X_or_less', 'no_legendary', 'sacrificed_legendary',
  'three_counter_types', 'toughness_10+', 'toughness_20+', 'toughness_40+',
  'unless_creature', 'your_turn',
  // Also some that work via trigger condition
  'legendary_creature', 'control_2_legendary',
  // conditions that are filters, not checks
  'land_to_hand', 'nonland', 'noncreature_nonland_mv3',
  // third trigger condition
  'third_trigger_this_turn', 'two_creatures_died',
  // target tapped
  'target_tapped', 'second_spell',
  // creature died this turn
  'creature_died_this_turn',
  // LTR-specific effect conditions
  'second_etb_this_turn', 'legendary', 'control_goblin_or_orc', 'was_cast',
  'power_3_or_greater', 'army_goblin_orc', 'not_chosen_two',
  'nonlegendary_creature',
]);

const SUPPORTED_TRIGGER_EVENTS = new Set([
  'any_creature_dies', 'attacks', 'becomes_blocked', 'becomes_tapped',
  'card_leaves_graveyard', 'cast_colorless', 'cast_instant_sorcery',
  'cast_noncreature', 'cast_noncreature_or_dragon', 'cast_spell',
  'cast_with_another_spell', 'combat_begin', 'combat_damage_player',
  'counter_placed', 'creature_dies_with_counters', 'creature_enters_cast',
  'creature_etb', 'creature_targeted_by_opponent', 'dies',
  'dragon_enters', 'end_step', 'enters_or_attacks', 'enters_or_dies',
  'equipped_attacks', 'equipped_blocked_by', 'equipped_blocks',
  'gain_life', 'landfall', 'leaves_battlefield',
  'opponent_creature_dies_from_damage', 'other_creature_dies',
  'other_creature_enters', 'prevent_damage', 'ring_tempts', 'scry',
  'second_spell', 'second_draw', 'target_dies', 'token_created', 'upkeep',
  'enters_battlefield', 'permanent_enters',
  // LTR-specific events
  'opponent_casts_spell', 'opponent_casts_free_spell', 'cast_historic',
  'own_creature_targeted_by_opponent', 'spell_targets_self', 'spell_targets_opponent_creature',
  'opponent_creature_dies', 'draw_on_opponent_turn', 'saga_final_chapter', 'combat_damage_to_me',
  'combat_damage_player_self', 'excess_noncombat_damage', 'deals_damage_to_creature',
  'phase_in',
]);

const SUPPORTED_GRANT_TARGETS = new Set([
  'self', 'same', 'enchanted', 'self_controller',
  'own_creature', 'creature', 'other_own_creature', 'other_creature',
  'attacking_creature', 'legendary_creature', 'opponent_creature',
  'own_creature_power2', 'own_creature_power4',
  'own_creatures', 'all_own_creatures', 'attacking_tokens', 'dragons',
  'each_blocker', 'blocking_creature', 'blocked_creature', 'damaged_creature',
]);

const SUPPORTED_EFFECT_TYPES = new Set([
  'add_mana', 'amass', 'anthem', 'attach', 'aura_debuff',
  'become_copy', 'become_creature', 'become_dragon', 'behold_dragon',
  'blight', 'bounce', 'bounce_self', 'bounce_to_library_top',
  'buff', 'buff_all', 'buff_self',
  'cant_be_blocked_by_smaller', 'cant_block', 'cant_block_unless',
  'clone', 'clone_optional', 'conditional_buff',
  'conditional_discard_return', 'copy_counters_to_target',
  'copy_last_spell', 'copy_next_spell', 'copy_self', 'copy_spell',
  'cost_reduction', 'counter', 'counter_all', 'counter_self',
  'counter_self_if_no_draw', 'counter_spell',
  'create_token', 'create_token_copy',
  'damage', 'damage_all', 'damage_divided', 'damage_each_opponent',
  'debuff', 'debuff_all', 'destroy', 'destroy_all',
  'discard', 'discard_hand', 'discard_trigger',
  'distribute_counters', 'double_counters', 'double_damage',
  'drain', 'draw',
  'endure', 'exile', 'exile_from_graveyard', 'exile_graveyard',
  'exile_graveyard_cast_copy', 'exile_self', 'exile_top',
  'exile_top_choose', 'exile_top_opponent', 'exile_top_play',
  'exile_until_leaves', 'exile_with_suspend', 'extra_combat',
  'fight', 'gain_control', 'gain_life', 'gainLife', 'goad', 'grant', 'grant_all',
  'grant_counter', 'grant_counters', 'grant_delve', 'grant_flash',
  'grant_harmonize', 'grant_haste',
  'look_top', 'look_top_botanist', 'loot',
  'lose_all_abilities', 'lose_life', 'loseLife',
  'mill', 'modal', 'modal_counter_self',
  'move_counters', 'move_counters_from_self', 'move_counters_to_self',
  'multi_buff_up_to',
  'opponent_loses_half_life', 'optional_discard', 'optional_discard_draw',
  'peek_top_land', 'prevent_activated_abilities',
  'put_card_on_bottom', 'ramp', 'regenerate',
  'register_temp_trigger', 'remove_counter', 'remove_counters', 'remove_counters_all',
  'return_from_graveyard', 'return_land_from_mill', 'return_to_hand',
  'reveal_hand', 'ring_tempts', 'rummage',
  'sacrifice', 'scry', 'search_library', 'search_library_to_graveyard',
  'shuffle_graveyard_to_library', 'stun_counter', 'stun_counter_self',
  'surveil', 'tap', 'tap_target', 'token_doubling', 'transform',
  'unblockable', 'uncounterable', 'untap', 'untap_all', 'untap_self',
  // Additional effect types found in engine
  'eowyn_grant', 'equip_cost_reduction', 'palantir_choice',
  'enters_tapped_conditional', 'enters_tapped_with_counters',
  'counter_spell', 'power_toughness_star',
  'creatures_tap_for_mana', 'mana_pool_no_lose',
  'draw_replacement_empty_hand', 'life_gain_double_low_life',
  'aura_grant_triggered', 'counter_bonus', 'tap_self',
  'cast_resume', 'cleanup',
  'phase_out', 'untap_self', 'add_mana',
]);

// ── Oracle text parsers ──────────────────────────────────────────────────

interface OracleParsed {
  hasETB: boolean;
  hasTriggered: boolean;
  hasActivated: boolean;
  hasStatic: boolean;
  keywords: string[];
  hasAnthem: boolean;
  anthemText: string | null;
  hasDamage: boolean;
  hasDestroy: boolean;
  hasDraw: boolean;
  hasCounter: boolean;  // +1/+1 counters
  hasCounterSpell: boolean;
  hasExile: boolean;
  hasBounce: boolean;
  hasRamp: boolean;
  hasLifegain: boolean;
  hasScry: boolean;
  hasSurveil: boolean;
  hasMill: boolean;
  hasTokens: boolean;
  hasFight: boolean;
  hasBuff: boolean;
  hasDebuff: boolean;
  hasRingTempts: boolean;
  hasAmass: boolean;
  hasEquip: boolean;
  hasCycling: boolean;
  hasFlash: boolean;
  hasPreventUntap: boolean;
  hasExileOnDeath: boolean;
  hasGainControl: boolean;
  hasLoseAbilities: boolean;
  isAura: boolean;
}

function parseOracle(card: any): OracleParsed {
  const oracle = (card.oracle_text || '').toLowerCase();
  const type = (card.type_line || '').toLowerCase();
  const kws = (card.keywords || []).map((k: string) => k.toLowerCase());

  return {
    hasETB: /when .* enters/i.test(oracle) || /enters the battlefield/i.test(oracle),
    hasTriggered: /\b(whenever|when|at the beginning)\b/i.test(oracle),
    hasActivated: (() => {
      // Strip Food/Treasure reminder text before checking (both parenthesized and quoted)
      const stripped = oracle
        .replace(/\(it's an artifact with "[^"]*"\)/gi, '')
        .replace(/\([^)]*sacrifice this token[^)]*\)/gi, '')
        .replace(/"[^"]*sacrifice this[^"]*"/gi, '')
        .replace(/ward \{\d+\}/gi, ''); // ward {N} is a keyword cost, not activated ability
      return /\{[0-9WUBRGTCX]+\}[^.]*:/i.test(stripped) || /\{T\}[^.]*:/i.test(stripped);
    })(),
    hasStatic: !!(kws.length > 0) || /\b(creatures you control|equipped creature)\b/i.test(oracle),
    keywords: kws,
    hasAnthem: /creatures you control get [+-]\d+\/[+-]\d+/i.test(oracle),
    anthemText: oracle.match(/(?:legendary |nonlegendary )?creatures you control get ([+-]\d+)\/([+-]\d+)/i)?.[0] || null,
    hasDamage: /deals? \d+ damage|damage equal/i.test(oracle),
    hasDestroy: /\bdestroy\b/i.test(oracle),
    hasDraw: /\bdraw/i.test(oracle),
    hasCounter: /\+1\/\+1 counter|counter on/i.test(oracle) && !/counter target spell/i.test(oracle),
    hasCounterSpell: /counter target spell/i.test(oracle),
    hasExile: /\bexile\b/i.test(oracle),
    hasBounce: /return .* to .* hand|return .* to .* owner/i.test(oracle),
    hasRamp: /search .* library .* land/i.test(oracle),
    hasLifegain: /gain \d+ life|gains? life/i.test(oracle),
    hasScry: /\bscry\b/i.test(oracle),
    hasSurveil: /\bsurveil\b/i.test(oracle),
    hasMill: /\bmill\b/i.test(oracle),
    hasTokens: /\bcreate\b.*\btoken/i.test(oracle),
    hasFight: /\bfight/i.test(oracle),
    hasBuff: /gets? [+-]\d+\/[+-]\d+/i.test(oracle),
    hasDebuff: /gets? -\d+\/-\d+/i.test(oracle),
    hasRingTempts: /ring tempts you/i.test(oracle),
    hasAmass: /\bamass\b/i.test(oracle),
    hasEquip: kws.includes('equip'),
    hasCycling: kws.includes('cycling') || /\bcycling\b/i.test(oracle),
    hasFlash: kws.includes('flash'),
    hasPreventUntap: /doesn't untap/i.test(oracle),
    hasExileOnDeath: /exile it instead|if .* would die .* exile/i.test(oracle),
    hasGainControl: /gain control/i.test(oracle),
    hasLoseAbilities: /loses? all abilities/i.test(oracle),
    isAura: type.includes('aura'),
  };
}

// ── Audit functions ──────────────────────────────────────────────────────

interface AuditIssue {
  severity: 'error' | 'warning' | 'info';
  layer: 1 | 2 | 3;
  message: string;
}

function collectEffects(db: any): any[] {
  const effects: any[] = [];
  if (db.cast) effects.push(...db.cast);
  if (db.etb) effects.push(...db.etb);
  if (db.triggered) {
    for (const t of db.triggered) {
      if (t.effects) effects.push(...t.effects);
    }
  }
  if (db.activated) {
    for (const a of db.activated) {
      if (a.effects) effects.push(...a.effects);
    }
  }
  if (db.static) effects.push(...db.static);
  if (db.chapters) {
    for (const chap of Object.values(db.chapters)) {
      if (Array.isArray(chap)) effects.push(...chap);
    }
  }
  if (db.graveyard) {
    for (const g of db.graveyard) {
      if (g.effects) effects.push(...g.effects);
      else effects.push(g);
    }
  }
  return effects;
}

function flattenEffects(effects: any[]): any[] {
  const flat: any[] = [];
  for (const eff of effects) {
    flat.push(eff);
    if (eff.type === 'modal' && eff.modes) {
      for (const mode of eff.modes) {
        if (Array.isArray(mode)) flat.push(...mode);
        else flat.push(mode);
      }
    }
  }
  return flat;
}

function auditCard(cardName: string, scryfallCard: any): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const dbKeys = getDBKeys();
  const key = cardName.toLowerCase();
  const db = getDBEntry(cardName);
  const oracle = parseOracle(scryfallCard);
  const type = (scryfallCard.type_line || '').toLowerCase();

  // Skip basic lands
  if (type.includes('basic land')) return issues;

  // ── Layer 1: Data presence ──
  if (!dbKeys.has(key)) {
    // Check if it's a vanilla creature (only keywords, no abilities)
    const hasAbility = oracle.hasETB || oracle.hasTriggered || oracle.hasActivated ||
                       oracle.hasDamage || oracle.hasDestroy || oracle.hasDraw || oracle.hasCounter ||
                       oracle.hasCounterSpell || oracle.hasExile || oracle.hasBounce || oracle.hasRamp ||
                       oracle.hasTokens || oracle.hasFight || oracle.hasRingTempts || oracle.hasAmass;
    if (hasAbility) {
      issues.push({ severity: 'error', layer: 1, message: `Card NOT in CardEffectsDB but has abilities in oracle` });
    } else if (oracle.keywords.length > 0) {
      issues.push({ severity: 'info', layer: 1, message: `Vanilla/keyword-only card, not in DB (OK)` });
    }
    return issues;
  }

  if (!db || db._raw) {
    issues.push({ severity: 'info', layer: 1, message: `Entry exists but could not parse for deep audit` });
    return issues;
  }

  // ── Layer 2: Engine handler verification ──
  const allEffects = collectEffects(db);
  const flatEffects = flattenEffects(allEffects);

  // Check effect types
  for (const eff of flatEffects) {
    if (!eff.type) continue;
    if (eff.type === 'has_keyword' || eff.type === 'ward' || eff.type === 'aura_prevent_untap' ||
        eff.type === 'aura_cant_attack_block' || eff.type === 'aura_grant_activated' ||
        eff.type === 'conditional_indestructible' || eff.type === 'opponents_cant_gain_life' ||
        eff.type === 'loses_abilities' || eff.type === 'enters_tapped') continue; // Static types handled separately

    if (!SUPPORTED_EFFECT_TYPES.has(eff.type)) {
      issues.push({ severity: 'error', layer: 2, message: `Effect type "${eff.type}" NOT handled in engine _resolveSimpleEffect` });
    }

    // Check grant targets
    if (eff.type === 'grant' && eff.target) {
      if (!SUPPORTED_GRANT_TARGETS.has(eff.target)) {
        issues.push({ severity: 'error', layer: 2, message: `Grant target "${eff.target}" NOT handled in engine grant case` });
      }
    }

    // Check effect conditions
    if (eff.condition) {
      if (!SUPPORTED_EFFECT_CONDITIONS.has(eff.condition) && !SUPPORTED_TRIGGER_CONDITIONS.has(eff.condition)) {
        issues.push({ severity: 'error', layer: 2, message: `Effect condition "${eff.condition}" NOT in engine _checkEffectCondition` });
      }
    }
  }

  // Check triggered ability events and conditions
  if (db.triggered) {
    for (const trig of db.triggered) {
      if (trig.event && !SUPPORTED_TRIGGER_EVENTS.has(trig.event)) {
        issues.push({ severity: 'error', layer: 2, message: `Trigger event "${trig.event}" NOT in engine fireTrigger` });
      }
      if (trig.condition && !SUPPORTED_TRIGGER_CONDITIONS.has(trig.condition) && !SUPPORTED_EFFECT_CONDITIONS.has(trig.condition)) {
        issues.push({ severity: 'error', layer: 2, message: `Trigger condition "${trig.condition}" NOT in engine _checkTriggerCondition` });
      }
    }
  }

  // Check activated ability conditions
  if (db.activated) {
    for (const act of db.activated) {
      if (act.condition && !SUPPORTED_EFFECT_CONDITIONS.has(act.condition) && !SUPPORTED_TRIGGER_CONDITIONS.has(act.condition)) {
        issues.push({ severity: 'error', layer: 2, message: `Activated condition "${act.condition}" NOT in engine` });
      }
    }
  }

  // ── Layer 3: Oracle vs DB comparison ──

  // ETB check
  if (oracle.hasETB && !db.etb && !db.triggered?.some((t: any) => t.event === 'enters_battlefield' || t.event === 'creature_etb')) {
    // Check if ETB is handled via triggered instead
    const oText = scryfallCard.oracle_text || '';
    if (/when .* enters the battlefield/i.test(oText)) {
      issues.push({ severity: 'warning', layer: 3, message: `Oracle has ETB but no "etb" in DB (may be handled via triggered)` });
    }
  }

  // Triggered abilities check
  const hasAuraGrantTriggered = db.static?.some((s: any) => s.type === 'aura_grant_triggered');
  if (oracle.hasTriggered && !db.triggered && !db.etb && !db.chapters && !hasAuraGrantTriggered) {
    // Strip Food/Treasure reminder text before re-checking
    const strippedOracle = (scryfallCard.oracle_text || '').replace(/\(It's an artifact with "[^"]*"\)/gi, '').replace(/\([^)]*Sacrifice this token[^)]*\)/gi, '');
    const reallyHasTriggered = /\b(whenever|at the beginning)\b/i.test(strippedOracle);
    // "When this creature enters" = ETB, not a separate triggered need if etb exists
    const hasWhenEnters = /when .* enters/i.test(strippedOracle);
    const onlyETB = hasWhenEnters && !/\bwhenever\b/i.test(strippedOracle) && !/at the beginning/i.test(strippedOracle);
    if (reallyHasTriggered && !onlyETB) {
      issues.push({ severity: 'warning', layer: 3, message: `Oracle has triggered abilities but no "triggered" or "etb" in DB` });
    }
  }

  // Activated abilities check
  if (oracle.hasActivated && !db.activated) {
    const oText = scryfallCard.oracle_text || '';
    // Skip if only mana abilities
    const onlyManaAbility = /\{T\}: Add \{/i.test(oText) && !/\{T\}.*:(?!.*Add \{)/i.test(oText);
    // Skip if equip/cycling already covers it
    const coveredByEquip = !!db.equip && oracle.hasEquip;
    const coveredByCycling = !!db.cycling && oracle.hasCycling;
    const coveredByGraveyard = !!db.graveyard;
    const coveredByStatic = db.static?.some((s: any) => s.type === 'creatures_tap_for_mana' || s.type === 'ward');
    if (!onlyManaAbility && !coveredByEquip && !coveredByCycling && !coveredByGraveyard && !coveredByStatic) {
      issues.push({ severity: 'warning', layer: 3, message: `Oracle has activated abilities but no "activated" in DB` });
    }
  }

  // Ring tempts check - only flag if card CREATES ring tempts (not responds to it)
  if (oracle.hasRingTempts) {
    const hasRingEffect = flatEffects.some(e => e.type === 'ring_tempts');
    const respondsToRing = db.triggered?.some((t: any) => t.event === 'ring_tempts');
    if (!hasRingEffect && !respondsToRing) {
      issues.push({ severity: 'error', layer: 3, message: `Oracle has "ring tempts you" but no ring_tempts effect or ring_tempts trigger in DB` });
    }
  }

  // Amass check
  if (oracle.hasAmass) {
    const hasAmass = flatEffects.some(e => e.type === 'amass');
    if (!hasAmass) {
      issues.push({ severity: 'error', layer: 3, message: `Oracle has "amass" but no amass effect in DB` });
    }
  }

  // Scry check
  if (oracle.hasScry && !oracle.hasCycling) {
    const hasScry = flatEffects.some(e => e.type === 'scry');
    // "whenever you scry" = trigger event, not scry effect needed
    const scryAsTriggerEvent = db.triggered?.some((t: any) => t.event === 'scry');
    // "scry" only in reminder text doesn't count
    const scryOnlyInReminder = /\bscry\b/i.test((scryfallCard.oracle_text || '').replace(/\([^)]*\)/g, '')) === false;
    if (!hasScry && !scryAsTriggerEvent && !scryOnlyInReminder) {
      issues.push({ severity: 'warning', layer: 3, message: `Oracle has "scry" but no scry effect in DB` });
    }
  }

  // Flash check
  if (oracle.hasFlash || oracle.keywords.includes('flash')) {
    const hasFlash = db.static?.some((s: any) => s.type === 'has_keyword' && s.keywords?.some((k: string) => k.toLowerCase() === 'flash'));
    if (!hasFlash) {
      issues.push({ severity: 'warning', layer: 3, message: `Card has flash but not in DB static keywords` });
    }
  }

  // Prevent untap check (auras)
  if (oracle.hasPreventUntap && oracle.isAura) {
    const hasPreventUntap = db.static?.some((s: any) => s.type === 'aura_prevent_untap');
    if (!hasPreventUntap) {
      issues.push({ severity: 'error', layer: 3, message: `Oracle says "doesn't untap" but no aura_prevent_untap in DB` });
    }
  }

  // Exile on death check
  if (oracle.hasExileOnDeath) {
    const hasExileFlag = flatEffects.some(e => e.exile_on_death);
    if (!hasExileFlag) {
      issues.push({ severity: 'error', layer: 3, message: `Oracle has "exile instead of die" but no exile_on_death flag in DB` });
    }
  }

  // Counter spell check
  if (oracle.hasCounterSpell) {
    const hasCounterSpell = flatEffects.some(e => e.type === 'counter_spell');
    if (!hasCounterSpell) {
      issues.push({ severity: 'error', layer: 3, message: `Oracle has "counter target spell" but no counter_spell in DB` });
    }
  }

  // Keyword counters check (lifelink, indestructible, etc.)
  const keywordCounterMatch = (scryfallCard.oracle_text || '').match(/(\w+) counter/gi) || [];
  for (const match of keywordCounterMatch) {
    const counterType = match.replace(/ counter$/i, '').toLowerCase();
    if (['+1/+1', '-1/-1', 'stun', 'finality', 'time', 'lore', 'page', 'loyalty'].includes(counterType)) continue;
    if (['a', 'that', 'each', 'all', 'any', 'the', 'another', 'remove', 'with'].includes(counterType)) continue;
    // Valid keyword counter — check if DB uses it
    const usesCounter = flatEffects.some(e =>
      (e.type === 'counter_self' || e.type === 'counter' || e.type === 'grant_counter') &&
      e.counter?.toLowerCase() === counterType
    );
    if (!usesCounter && !flatEffects.some(e => e.type === 'modal_counter_self')) {
      // Not necessarily an error, just info
    }
  }

  // Important keywords from Scryfall that should be in static
  const importantKeywords = ['flying', 'trample', 'lifelink', 'deathtouch', 'vigilance',
    'reach', 'first strike', 'double strike', 'menace', 'haste', 'ward', 'hexproof',
    'indestructible', 'defender'];
  for (const kw of oracle.keywords) {
    if (!importantKeywords.includes(kw)) continue;
    if (kw === 'equip') continue; // Equipment keyword handled separately
    const inDB = db.static?.some((s: any) =>
      s.type === 'has_keyword' && s.keywords?.some((k: string) => k.toLowerCase() === kw)
    );
    // Keywords in remove_keywords are granted via counter/modal, not static
    const inRemoveKw = db.remove_keywords?.some((k: string) => k.toLowerCase() === kw);
    // Ward handled by separate { type: "ward" } static
    const wardInDB = kw === 'ward' && db.static?.some((s: any) => s.type === 'ward');
    // Haste on tokens (e.g. Smaug in There and Back Again saga) — keyword is on the created token
    const kwInChapters = db.chapters && JSON.stringify(db.chapters).toLowerCase().includes(kw);
    if (!inDB && !inRemoveKw && !wardInDB && !kwInChapters && kw !== 'flash') {
      issues.push({ severity: 'warning', layer: 3, message: `Scryfall keyword "${kw}" not in DB static has_keyword` });
    }
  }

  return issues;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const auditListPath = path.resolve(__dirname, '../ltr_audit_list.txt');
  const cardNames = fs.readFileSync(auditListPath, 'utf-8').trim().split('\n').map(s => s.trim()).filter(Boolean);

  let startIdx = 0;
  let endIdx = cardNames.length;
  let searchName: string | null = null;

  if (args.length === 2 && !isNaN(Number(args[0]))) {
    startIdx = Number(args[0]) - 1;
    endIdx = Number(args[1]);
  } else if (args.length === 1 && isNaN(Number(args[0]))) {
    searchName = args[0].toLowerCase();
  } else if (args.length === 1) {
    // Single number: start from that card, do 5
    startIdx = Number(args[0]) - 1;
    endIdx = startIdx + 5;
  }

  const results: Array<{ idx: number; name: string; scryfallName: string; issues: AuditIssue[] }> = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (let i = startIdx; i < Math.min(endIdx, cardNames.length); i++) {
    const name = cardNames[i];
    if (searchName && !name.includes(searchName)) continue;

    // Find in scryfall
    const sf = scryfallCards.find((c: any) => c.name.toLowerCase() === name.toLowerCase());
    if (!sf) {
      results.push({ idx: i + 1, name, scryfallName: '???', issues: [{ severity: 'warning', layer: 1, message: 'Not found in Scryfall JSON' }] });
      continue;
    }

    const issues = auditCard(name, sf);
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    totalErrors += errors;
    totalWarnings += warnings;
    results.push({ idx: i + 1, name, scryfallName: sf.name, issues });
  }

  // ── Output ──
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         LTR CARD AUDIT — 3-Layer Verification           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Cards audited: ${results.length.toString().padEnd(5)} | Errors: ${totalErrors.toString().padEnd(5)} | Warnings: ${totalWarnings.toString().padEnd(5)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  for (const r of results) {
    const errors = r.issues.filter(i => i.severity === 'error');
    const warnings = r.issues.filter(i => i.severity === 'warning');
    const infos = r.issues.filter(i => i.severity === 'info');

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`  #${r.idx.toString().padStart(3)} ✅ ${r.scryfallName}`);
    } else if (errors.length > 0) {
      console.log(`  #${r.idx.toString().padStart(3)} ❌ ${r.scryfallName}`);
      for (const e of errors) {
        console.log(`         [L${e.layer}] ❌ ${e.message}`);
      }
      for (const w of warnings) {
        console.log(`         [L${w.layer}] ⚠️  ${w.message}`);
      }
    } else {
      console.log(`  #${r.idx.toString().padStart(3)} ⚠️  ${r.scryfallName}`);
      for (const w of warnings) {
        console.log(`         [L${w.layer}] ⚠️  ${w.message}`);
      }
    }
    for (const inf of infos) {
      console.log(`         [L${inf.layer}] ℹ️  ${inf.message}`);
    }
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log(`Layer 1 = Data (DB exists?)  |  Layer 2 = Engine (handlers exist?)  |  Layer 3 = Oracle match`);
  console.log(`Total: ${results.length} cards  |  ${totalErrors} errors  |  ${totalWarnings} warnings`);
  console.log('');
}

main();
