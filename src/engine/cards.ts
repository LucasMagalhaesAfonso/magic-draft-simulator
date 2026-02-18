// cards.ts — Card effect retrieval, parsing, and card factory functions
// Ported from legacy cards.js (CardEngine object)
// Depends on card-utils.ts for basic type/keyword checks

import type {
  GameCard, EngineGameState, Effect, TriggerDefinition,
  ActivatedAbility, CardEffectEntry,
} from './engine-types';
import {
  isCreature, isInstant, isSorcery, isPlaneswalker, isSaga,
  hasKeyword, hasCreatureType, wordToNum, isDragon,
  getStartingLoyalty, isLand, isPermanent, getPower, getToughness, canBeTargeted,
  isArtifact, isEnchantment, isBasicLand, hasLifelink, hasIndestructible,
} from './card-utils';

// Re-export card-utils functions so stack/game-state can import them from cards
export {
  isCreature, isInstant, isSorcery, isPlaneswalker, isSaga,
  hasKeyword, hasCreatureType, wordToNum, isDragon,
  getStartingLoyalty, isLand, isPermanent, getPower, getToughness, canBeTargeted,
  isArtifact, isEnchantment, isBasicLand, hasLifelink, hasIndestructible,
} from './card-utils';
import { parseCost, costToString, getLandManaColors } from './mana';
export { getLandManaColors } from './mana';

// ============================================
// Effect Database Lookup
// ============================================

// In the new architecture, effects come from SQLite via CardEffectEntry.
// This module provides a local cache that game-state populates at game start.

const effectsCache = new Map<string, CardEffectEntry>();

export function setEffectsCache(entries: Map<string, CardEffectEntry>): void {
  effectsCache.clear();
  for (const [key, val] of entries) {
    effectsCache.set(key.toLowerCase(), val);
  }
}

export function addEffectEntry(cardName: string, entry: CardEffectEntry): void {
  effectsCache.set(cardName.toLowerCase(), entry);
}

export function getPreprocessedEffects(card: GameCard): CardEffectEntry | null {
  return effectsCache.get(card.name.toLowerCase()) ?? null;
}

export function hasAnyEffects(card: GameCard): boolean {
  const db = getPreprocessedEffects(card);
  if (db) return true;
  if (parseETBEffects(card).length > 0) return true;
  if (parseTriggeredAbilities(card).length > 0) return true;
  if (parseActivatedAbilities(card).length > 0) return true;
  return false;
}

// ============================================
// Effect Retrieval (DB first, regex fallback)
// ============================================

export function getETBEffects(card: GameCard): Effect[] {
  const db = getPreprocessedEffects(card);
  if (db) {
    // Modal ETB (Siege enchantments)
    if (db.modal && (db.modal as any).chooseOnETB && (db.modal as any).modes) {
      const normalizedModes = ((db.modal as any).modes as any[]).map(m => {
        if (m.effects && Array.isArray(m.effects)) return m.effects;
        return [m];
      });
      return [{ type: 'modal', modes: normalizedModes, chooseTwo: false, isETBModal: true } as any];
    }
    if (db.etb) return db.etb;
  }
  return parseETBEffects(card);
}

export function getSpellEffects(card: GameCard): Effect[] {
  const db = getPreprocessedEffects(card);
  if (db) {
    if ((db as any).modal && (db as any).modes) {
      return [{ type: 'modal', modes: (db as any).modes, chooseTwo: (db as any).chooseTwo || false } as any];
    }
    if (db.cast) return db.cast;
  }
  return parseSpellEffects(card);
}

export function getTriggeredAbilities(card: GameCard): TriggerDefinition[] {
  const db = getPreprocessedEffects(card);
  if (db && db.triggered) return db.triggered;
  return parseTriggeredAbilities(card);
}

export function getActivatedAbilities(card: GameCard): ActivatedAbility[] {
  if ((card as any)._losesAllAbilities) return [];

  const db = getPreprocessedEffects(card);
  if (db && db.activated) {
    return db.activated.filter(a => {
      const cost = a.cost as any;
      if (cost && cost.zone === 'graveyard') return false;
      if (cost && cost.loyalty !== undefined) return false;
      return true;
    });
  }

  // Treasure tokens
  if (card._isToken && card.name?.toLowerCase() === 'treasure') {
    return [{
      cost: { tap: true, sacrifice: true } as any,
      effects: [{ type: 'add_mana', colors: ['W', 'U', 'B', 'R', 'G'], choose: 1 } as any],
      text: '{T}, Sacrifice this artifact: Add one mana of any color.',
    } as any];
  }

  return parseActivatedAbilities(card);
}

export function getManaAbilities(card: GameCard): ActivatedAbility[] {
  const all = getActivatedAbilities(card);
  return all.filter(ability =>
    ability.effects?.some(e => e.type === 'add_mana')
  );
}

export function getLoyaltyAbilities(card: GameCard): ActivatedAbility[] {
  const db = getPreprocessedEffects(card);
  if (db && db.activated) {
    return db.activated.filter(a => (a.cost as any)?.loyalty !== undefined);
  }
  return [];
}

export function getGraveyardAbilities(card: GameCard): ActivatedAbility[] {
  const db = getPreprocessedEffects(card);
  const abilities: ActivatedAbility[] = [];
  if (db && db.activated) {
    abilities.push(...db.activated.filter(a => (a.cost as any)?.zone === 'graveyard'));
  }
  if (db && (db as any).graveyard) {
    abilities.push(...(db as any).graveyard);
  }
  return abilities;
}

export function getSagaChapters(card: GameCard): any[] | null {
  const db = getPreprocessedEffects(card);
  if (db && (db as any).saga && (db as any).chapters) return (db as any).chapters;
  return null;
}

// ============================================
// Harmonize
// ============================================

export function getHarmonizeCost(card: GameCard): string | null {
  const db = getPreprocessedEffects(card);
  if (db && db.harmonize) return db.harmonize;

  const text = card.oracle_text || '';
  const match = text.match(/[Hh]armonize\s+((?:\{[^}]+\})+)/);
  if (match) return match[1];

  if ((card as any)._harmonizeGranted) return card.mana_cost || '{0}';
  return null;
}

export function hasHarmonize(card: GameCard): boolean {
  return getHarmonizeCost(card) !== null;
}

export function getHarmonizeCMC(card: GameCard): number {
  const cost = getHarmonizeCost(card);
  if (!cost) return 0;
  const parsed = parseCost(cost);
  return parsed.total || 0;
}

// ============================================
// Additional Costs
// ============================================

export function getAdditionalCosts(card: GameCard): any[] {
  const db = getPreprocessedEffects(card);
  if (db && (db as any).additional_costs) return (db as any).additional_costs;
  return parseAdditionalCosts(card);
}

export function hasAdditionalCosts(card: GameCard): boolean {
  return getAdditionalCosts(card).length > 0;
}

// ============================================
// Adventure Support
// ============================================

export function isAdventureInstant(card: GameCard): boolean {
  return !!(card.adventure?.name) && (card.adventure.type_line || '').includes('Instant');
}

export function isAdventureSorcery(card: GameCard): boolean {
  return !!(card.adventure?.name) && (card.adventure.type_line || '').includes('Sorcery');
}

export function getAdventureCost(card: GameCard): string {
  return card.adventure?.mana_cost ?? '';
}

export function getAdventureCMC(card: GameCard): number {
  if (!card.adventure) return 0;
  const parsed = parseCost(card.adventure.mana_cost);
  return parsed.total || 0;
}

// ============================================
// Transform / DFC
// ============================================

export function getTransformCost(card: GameCard): string | null {
  const text = (card.oracle_text || '').toLowerCase();
  const match = text.match(/\{([^}]+)\}(?:\{([^}]+)\})?(?:\{([^}]+)\})?:\s*transform/);
  if (match) {
    let cost = `{${match[1]}}`;
    if (match[2]) cost += `{${match[2]}}`;
    if (match[3]) cost += `{${match[3]}}`;
    return cost;
  }
  return null;
}

export function transformCard(card: GameCard): boolean {
  const backFace = (card as any)._backFace || card.backFace;
  if (!backFace) return false;

  if (card._transformed) {
    // Revert to front face
    const front = card._frontFaceData;
    if (front) {
      card.name = front.name || card.name;
      card.type_line = front.type_line || card.type_line;
      card.oracle_text = front.oracle_text || card.oracle_text;
      card.power = front.power;
      card.toughness = front.toughness;
      card.colors = (front.colors as any) || card.colors;
      card.image_small = front.image_small || card.image_small;
      card.image_normal = front.image_normal || card.image_normal;
      card.keywords = (front.keywords as any) || card.keywords;
    }
    card._transformed = false;
  } else {
    // Save front face data
    if (!card._frontFaceData) {
      card._frontFaceData = {
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        power: card.power,
        toughness: card.toughness,
        colors: [...card.colors],
        image_small: card.image_small,
        image_normal: card.image_normal,
        keywords: [...(card.keywords || [])],
      };
    }
    // Apply back face
    card.name = backFace.name;
    card.type_line = backFace.type_line;
    card.oracle_text = backFace.oracle_text;
    card.power = backFace.power;
    card.toughness = backFace.toughness;
    card.colors = backFace.colors || card.colors;
    card.image_small = backFace.image_small || card.image_small;
    card.image_normal = backFace.image_normal || card.image_normal;
    if (backFace.keywords) card.keywords = backFace.keywords;
    card._transformed = true;
  }
  return true;
}

// ============================================
// Vivid Colors
// ============================================

export function countVividColors(state: EngineGameState, playerId: number): number {
  const bf = state.players[playerId].zones.battlefield;
  const colors = new Set<string>();
  bf.cards.forEach(c => {
    (c.colors || (c as any).color_identity || []).forEach((clr: string) => colors.add(clr));
  });
  return colors.size;
}

// ============================================
// Subtypes
// ============================================

export function getSubtypes(card: GameCard): string[] {
  const typeLine = card.type_line || '';
  if (!typeLine.includes('—')) return [];
  return typeLine.split('—').pop()!.trim().split(' ').map(s => s.trim()).filter(s => s.length > 0);
}

// ============================================
// Evoke
// ============================================

export function getEvokeCost(card: GameCard): string | null {
  if (!hasKeyword(card, 'Evoke')) return null;
  const text = card.oracle_text || '';
  const match = text.match(/evoke\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (match) return match[1];
  const match2 = text.match(/evoke[—\-]+\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (match2) return match2[1];
  return null;
}

// ============================================
// Affinity
// ============================================

export function getAffinityType(card: GameCard): string | null {
  const db = getPreprocessedEffects(card);
  if (db && (db as any).affinity) return (db as any).affinity.type;
  const text = (card.oracle_text || '').toLowerCase();
  const match = text.match(/affinity\s+for\s+(\w+)/);
  return match ? match[1] : null;
}

export function hasAffinity(card: GameCard): boolean {
  return getAffinityType(card) !== null;
}

// ============================================
// Champion
// ============================================

export function getChampionType(card: GameCard): string | null {
  if (!hasKeyword(card, 'Champion')) return null;
  const text = (card.oracle_text || '').toLowerCase();
  const match = text.match(/champion (?:a|an) (\w+)/);
  return match ? match[1] : 'creature';
}

// ============================================
// Enters Tapped Unless
// ============================================

export function getEntersTappedUnlessCondition(card: GameCard): string[] | null {
  const text = (card.oracle_text || '').toLowerCase();
  const match = text.match(/enters tapped unless you control (?:a |an )?(.+?)(?:\.|$)/i);
  if (!match) return null;

  const conditionText = match[1];
  const types: string[] = [];
  const landMatches = conditionText.match(/(?:a |an )?([A-Z][a-z]+)/g);
  if (landMatches) {
    landMatches.forEach(m => {
      const type = m.replace(/^(?:a |an )\s*/i, '').trim();
      if (!types.includes(type)) types.push(type);
    });
  }
  return types.length > 0 ? types : null;
}

// ============================================
// Conditional Flash
// ============================================

export function canCastWithConditionalFlash(card: GameCard, state: EngineGameState, playerId: number): boolean {
  const db = getPreprocessedEffects(card);
  if (!db || !db.static) return false;

  const conditionalFlash = db.static.find(s => s.type === 'conditional_flash');
  if (!conditionalFlash) return false;

  if (conditionalFlash.condition === 'behold_dragon') {
    const bf = state.players[playerId].zones.battlefield.cards;
    const hasDragonBF = bf.some(c => isCreature(c) && hasCreatureType(c, 'Dragon'));
    const hand = state.players[playerId].zones.hand;
    const handCards = hand.cards ?? (hand as any).getAll?.() ?? [];
    const hasDragonHand = handCards.some((c: GameCard) =>
      hasCreatureType(c, 'Dragon') && c._uid !== card._uid
    );
    return hasDragonBF || hasDragonHand;
  }
  return false;
}

// ============================================
// Conditional Cost
// ============================================

export function getConditionalCost(card: GameCard, targetCard: GameCard | null = null): string | null {
  const db = getPreprocessedEffects(card);
  if (!db || !(db as any).conditional_cost) return null;

  const condition = (db as any).conditional_cost.condition;
  const additionalMana = (db as any).conditional_cost.additional_mana;

  if (condition === 'target_dragon' && targetCard && isDragon(targetCard)) {
    return additionalMana;
  }
  return null;
}

export function getEffectiveManaCost(card: GameCard, targetCard: GameCard | null = null): string {
  const baseCost = card.mana_cost || '{0}';
  const conditionalCost = getConditionalCost(card, targetCard);

  if (conditionalCost) {
    const baseParsed = parseCost(baseCost);
    const additionalParsed = parseCost(conditionalCost);

    // Build flat cost object for costToString
    const flat: Record<string, number> = {
      generic: baseParsed.generic + additionalParsed.generic,
    };
    const allColors = new Set([
      ...Object.keys(baseParsed.colored),
      ...Object.keys(additionalParsed.colored),
    ]);
    for (const color of allColors) {
      flat[color] = (baseParsed.colored[color] || 0) + (additionalParsed.colored[color] || 0);
    }

    return costToString(flat);
  }
  return baseCost;
}

// ============================================
// Behold
// ============================================

export function getBeholdCost(card: GameCard): any | null {
  const costs = getAdditionalCosts(card);
  return costs.find((c: any) => c.type === 'behold') || null;
}

// ============================================
// Type Checks (aura, equipment, legendary)
// ============================================

export function isAura(card: GameCard): boolean {
  const tl = (card.type_line || '').toLowerCase();
  return tl.includes('enchantment') && tl.includes('aura');
}

export function isEquipment(card: GameCard): boolean {
  const tl = (card.type_line || '').toLowerCase();
  return tl.includes('artifact') && tl.includes('equipment');
}

export function isLegendary(card: GameCard): boolean {
  return (card.type_line || '').toLowerCase().includes('legendary');
}

export function findLegendaryDuplicates(state: EngineGameState, playerId: number, cardName: string): GameCard[] {
  return state.players[playerId].zones.battlefield.cards.filter(
    c => isLegendary(c) && c.name === cardName
  );
}

// ============================================
// Aura / Equipment Effects
// ============================================

export function parseAuraEffects(card: GameCard): any[] {
  const text = (card.oracle_text || '').toLowerCase();
  const effects: any[] = [];
  if (!text.includes('enchant')) return effects;

  const buffMatch = text.match(/enchanted creature gets? ([+-]\d+)\/([+-]\d+)/);
  if (buffMatch) {
    effects.push({ type: 'buff', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });
  }

  const kwGrant = text.match(/enchanted creature (?:has|gains) ([\w\s,]+?)(?:\.|$)/);
  if (kwGrant) {
    const kwText = kwGrant[1];
    const possibleKw = ['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
      'trample', 'vigilance', 'haste', 'reach', 'menace', 'hexproof', 'indestructible', 'defender'];
    possibleKw.forEach(kw => {
      if (kwText.includes(kw)) {
        effects.push({ type: 'grant_keyword', keyword: kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') });
      }
    });
  }

  if (text.includes("enchanted creature can't attack")) {
    effects.push({ type: 'grant_keyword', keyword: 'Defender' });
  }
  if (text.includes("enchanted creature can't block")) {
    effects.push({ type: 'cant_block' });
  }

  const baseMatch = text.match(/enchanted creature (?:has base power and toughness|is) (\d+)\/(\d+)/);
  if (baseMatch) {
    effects.push({ type: 'set_pt', power: parseInt(baseMatch[1]), toughness: parseInt(baseMatch[2]) });
  }

  return effects;
}

export function parseEquipmentEffects(card: GameCard): any[] {
  const text = (card.oracle_text || '').toLowerCase();
  const effects: any[] = [];

  const buffMatch = text.match(/equipped creature gets? ([+-]\d+)\/([+-]\d+)/);
  if (buffMatch) {
    effects.push({ type: 'buff', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });
  }

  const kwGrant = text.match(/equipped creature (?:has|gains) ([\w\s,]+?)(?:\.|$)/);
  if (kwGrant) {
    const kwText = kwGrant[1];
    const possibleKw = ['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
      'trample', 'vigilance', 'haste', 'reach', 'menace', 'hexproof', 'indestructible'];
    possibleKw.forEach(kw => {
      if (kwText.includes(kw)) {
        effects.push({ type: 'grant_keyword', keyword: kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') });
      }
    });
  }

  // Equip cost
  const equipMatch = text.match(/equip(?:—| )?((?:\{[^}]+\})+)/);
  if (equipMatch) {
    effects.push({ type: 'equip_cost', cost: equipMatch[1] });
  } else {
    const numericMatch = text.match(/equip(?:—| )?\{(\d+)\}/);
    if (numericMatch) {
      effects.push({ type: 'equip_cost', cost: `{${numericMatch[1]}}` });
    } else {
      effects.push({ type: 'equip_cost', cost: '{3}' });
    }
  }

  return effects;
}

// ============================================
// Card Factory
// ============================================

export function prepareForBattlefield(card: GameCard): GameCard {
  const creature = isCreature(card);
  const prepared: GameCard = {
    ...card,
    _tapped: false,
    _summoningSick: creature,
    _powerMod: 0,
    _toughnessMod: 0,
    _tempPowerMod: 0,
    _tempToughnessMod: 0,
    _damage: 0,
    _attacking: false,
    _blocking: null,
    _blockedBy: [],
    _counters: { '+1/+1': 0, '-1/-1': 0 },
    _stunCounters: 0,
    _hasDiedThisTurn: false,
    _damageMarked: 0,
    _tempKeywords: [],
    _attachments: [],
    _isToken: card._isToken || false,
  };

  // Preserve back face data for transform cards
  if (card.backFace) {
    (prepared as any)._backFace = card.backFace;
    prepared._transformed = false;
  }

  // Initialize planeswalker loyalty
  if (isPlaneswalker(card)) {
    (prepared as any)._loyalty = getStartingLoyalty(card);
    prepared._loyaltyUsedThisTurn = false;
  }

  return prepared;
}

export function createToken(
  controller: number,
  power: number,
  toughness: number,
  name: string,
  keywords: string[] = [],
): GameCard {
  const uid = 'token_' + Math.random().toString(36).slice(2, 8);
  const isTreasure = name?.toLowerCase() === 'treasure';

  const token: GameCard = {
    id: uid,
    _uid: uid,
    _owner: controller,
    _controller: controller,
    _zone: 'battlefield',
    oracle_id: '',
    name: name || 'Token',
    type_line: isTreasure ? 'Artifact Token' : 'Creature Token',
    power: isTreasure ? '' : String(power),
    toughness: isTreasure ? '' : String(toughness),
    oracle_text: isTreasure ? '{T}, Sacrifice this artifact: Add one mana of any color.' : '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    rarity: 'common' as any,
    keywords,
    set_code: '',
    set_name: '',
    collector_number: '',
    image_small: '',
    image_normal: '',
    image_art_crop: '',
    layout: 'token',
    _isToken: true,
    _tapped: false,
    _summoningSick: !isTreasure,
    _powerMod: 0,
    _toughnessMod: 0,
    _tempPowerMod: 0,
    _tempToughnessMod: 0,
    _damage: 0,
    _attacking: false,
    _blocking: null,
    _blockedBy: [],
    _counters: { '+1/+1': 0, '-1/-1': 0 },
    _stunCounters: 0,
    _hasDiedThisTurn: false,
    _damageMarked: 0,
    _tempKeywords: [],
    _attachments: [],
  };

  return token;
}

// ============================================
// Regex Parsers
// ============================================

export function parseSpellEffects(card: GameCard): Effect[] {
  const text = (card.oracle_text || '').toLowerCase();
  const effects: Effect[] = [];

  // --- Damage ---
  const dmgMatch = text.match(/deals? (\d+) damage to (any target|(?:target )?(creature|player|opponent|creature or player|creature or planeswalker))/);
  if (dmgMatch) {
    let dmgTarget = dmgMatch[2];
    if (dmgTarget !== 'any target') dmgTarget = dmgTarget.replace(/^target /, '');
    effects.push({ type: 'damage', amount: parseInt(dmgMatch[1]), target: dmgTarget });
  }

  const dmgAllMatch = text.match(/deals? (\d+) damage to each creature/);
  if (dmgAllMatch) {
    effects.push({ type: 'damage_all_creatures', amount: parseInt(dmgAllMatch[1]) });
  }

  const dmgOppMatch = text.match(/deals? (\d+) damage to each opponent/);
  if (dmgOppMatch) {
    effects.push({ type: 'damage', amount: parseInt(dmgOppMatch[1]), target: 'opponent' });
  }

  // --- Destroy ---
  if (text.includes('destroy target creature') || text.includes('destroy target nonland permanent')) {
    effects.push({ type: 'destroy', target: 'creature' });
  }
  if (text.includes('destroy all creatures')) {
    effects.push({ type: 'destroy_all', target: 'creatures' });
  }
  if (text.includes('destroy all nonland permanents')) {
    effects.push({ type: 'destroy_all', target: 'nonland' });
  }
  if (text.match(/destroy all creatures (?:target )?opponent controls/)) {
    effects.push({ type: 'destroy_all', target: 'opponent_creatures' });
  }

  // --- Exile ---
  if (text.includes('exile target creature') || text.includes('exile target nonland permanent')) {
    effects.push({ type: 'exile', target: 'creature' });
  }
  if (text.includes('exile all creatures')) {
    effects.push({ type: 'exile_all', target: 'creatures' });
  }

  // --- Draw cards ---
  const drawMatch = text.match(/draw (?:a |an |(\w+) )?cards?/);
  if (drawMatch) {
    effects.push({ type: 'draw', amount: drawMatch[1] ? (wordToNum(drawMatch[1]) || 1) : 1 });
  }

  // --- Gain life ---
  const lifeMatch = text.match(/gain (\d+) life/);
  if (lifeMatch) {
    effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });
  }

  // --- Lose life (opponent) ---
  const loseLifeMatch = text.match(/(?:target (?:opponent|player)|each opponent) loses? (\d+) life/);
  if (loseLifeMatch) {
    effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });
  }

  // --- Drain ---
  if (!loseLifeMatch) {
    const drainMatch = text.match(/loses? (\d+) life.*?(?:you )?gain (\d+) life/);
    if (drainMatch) {
      effects.push({ type: 'loseLife', amount: parseInt(drainMatch[1]), target: 'opponent' });
      effects.push({ type: 'gainLife', amount: parseInt(drainMatch[2]) });
    }
  }

  // --- Buff ---
  const buffMatch = text.match(/(?:target creature |creatures you control )gets? ([+-]\d+)\/([+-]\d+)/);
  if (buffMatch) {
    effects.push({
      type: 'buff',
      power: parseInt(buffMatch[1]),
      toughness: parseInt(buffMatch[2]),
      target: text.includes('creatures you control') ? 'all_own_creatures' : 'creature',
    });
  }

  // --- +1/+1 counters ---
  const counterMatch = text.match(/put (?:a |(\w+) )?(\+1\/\+1) counters? on (target creature|it|a creature you control|each creature you control)/);
  if (counterMatch) {
    const amount = counterMatch[1] ? (wordToNum(counterMatch[1]) || parseInt(counterMatch[1]) || 1) : 1;
    const target = counterMatch[3];
    if (target === 'each creature you control') {
      effects.push({ type: 'counter_all', counter: '+1/+1', amount } as any);
    } else {
      effects.push({ type: 'counters', counter: '+1/+1', amount, target: 'creature' } as any);
    }
  }

  // --- -1/-1 counters ---
  const negCounterMatch = text.match(/put (?:a |(\w+) )?(-1\/-1) counters? on (target creature)/);
  if (negCounterMatch) {
    effects.push({
      type: 'counters',
      counter: '-1/-1',
      amount: negCounterMatch[1] ? (wordToNum(negCounterMatch[1]) || parseInt(negCounterMatch[1]) || 1) : 1,
      target: 'creature',
    } as any);
  }

  // --- Bounce ---
  if (text.includes("return target creature to its owner's hand") || text.includes("return target nonland permanent to its owner's hand")) {
    effects.push({ type: 'bounce', target: 'creature' });
  }

  // --- Scry ---
  const scryMatch = text.match(/scry (\d+)/);
  if (scryMatch) effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });

  // --- Surveil ---
  const surveilMatch = text.match(/surveil (\d+)/);
  if (surveilMatch) effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });

  // --- Mill ---
  const millMatch = text.match(/(?:target player )?(?:mills?|puts? the top) (\d+) cards/);
  if (millMatch) {
    const millTarget = text.includes('target player') || text.includes('target opponent') ? 'opponent' : 'self';
    effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: millTarget });
  }

  // --- Ramp ---
  if (text.match(/search your library for a basic land card/)) {
    effects.push({ type: 'ramp', landType: 'basic', tapped: text.includes('tapped') } as any);
  }
  if (text.match(/search your library for a land card/) && !text.includes('basic')) {
    effects.push({ type: 'ramp', landType: 'any', tapped: text.includes('tapped') } as any);
  }

  // --- Tokens ---
  const tokenMatch = text.match(/create (?:a |an |(\w+) )?(\d+)\/(\d+) (\w+(?:\s\w+)?)(?: creature)? tokens?/);
  if (tokenMatch) {
    effects.push({
      type: 'create_token',
      count: tokenMatch[1] ? (wordToNum(tokenMatch[1]) || 1) : 1,
      power: parseInt(tokenMatch[2]),
      toughness: parseInt(tokenMatch[3]),
      name: tokenMatch[4],
    } as any);
  }
  if (!tokenMatch) {
    const tokenMatch2 = text.match(/create (?:a |an |(\w+) )?(\d+)\/(\d+) (\w+) (\w+(?:\s\w+)?)(?: creature)? tokens?/);
    if (tokenMatch2) {
      effects.push({
        type: 'create_token',
        count: tokenMatch2[1] ? (wordToNum(tokenMatch2[1]) || 1) : 1,
        power: parseInt(tokenMatch2[2]),
        toughness: parseInt(tokenMatch2[3]),
        name: tokenMatch2[5],
        color: tokenMatch2[4],
      } as any);
    }
  }
  if (effects.every(e => e.type !== 'create_token')) {
    const simpleToken = text.match(/create (?:a |an? |(\w+) )?(\d+)\/(\d+)\b[^.]*?tokens?/);
    if (simpleToken) {
      effects.push({
        type: 'create_token',
        count: simpleToken[1] ? (wordToNum(simpleToken[1]) || 1) : 1,
        power: parseInt(simpleToken[2]),
        toughness: parseInt(simpleToken[3]),
        name: 'Token',
      } as any);
    }
  }

  // --- Discard ---
  const discardMatch = text.match(/(?:target (?:player|opponent) )?discards? (?:a |(\w+) )?cards?/);
  if (discardMatch && !text.includes('you discard') && !text.includes('as an additional cost')) {
    const discardTarget = text.includes('target opponent') || text.includes('target player') || text.includes('each opponent') ? 'opponent' : 'self';
    if (discardTarget === 'opponent') {
      effects.push({ type: 'discard', amount: discardMatch[1] ? (wordToNum(discardMatch[1]) || parseInt(discardMatch[1]) || 1) : 1, target: 'opponent' });
    }
  }

  // --- Fight ---
  if (text.includes('fights target') || text.includes('fight another target') || text.includes('fight target')) {
    effects.push({ type: 'fight', target: 'creature' });
  }

  // --- Tap/Untap ---
  if (text.includes('tap target creature')) effects.push({ type: 'tap', target: 'creature' });
  if (text.includes('untap target creature')) effects.push({ type: 'untap', target: 'creature' });

  // --- Prevent damage ---
  const preventMatch = text.match(/prevent (?:the next )?(\d+) damage/);
  if (preventMatch) effects.push({ type: 'prevent_damage', amount: parseInt(preventMatch[1]) });

  // --- Blight ---
  const blightMatch = text.match(/(?:you may )?blight (\d+)/);
  if (blightMatch && !text.includes('as an additional cost')) {
    effects.push({ type: 'blight', amount: parseInt(blightMatch[1]), optional: text.includes('you may blight') } as any);
  }

  return effects;
}

export function parseETBEffects(card: GameCard): Effect[] {
  const text = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();

  const normalizedText = text.replace(new RegExp(cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');

  const selfETBPatterns = [
    /when ~ enters/,
    /when ~ enters the battlefield/,
    /when this creature enters/,
    /when this (?:artifact|enchantment|permanent) enters/,
    /~ enters the battlefield with/,
    /~ enters the battlefield,/,
    /as ~ enters/,
    /as this creature enters/,
  ];

  const excludePatterns = [
    /whenever (?:a|another) creature enters/,
    /whenever (?:a|another) (?:artifact|permanent) enters/,
    /whenever a creature enters the battlefield under/,
  ];

  if (excludePatterns.some(p => p.test(normalizedText))) {
    if (!selfETBPatterns.some(p => p.test(normalizedText))) return [];
  } else {
    if (!selfETBPatterns.some(p => p.test(normalizedText))) return [];
  }

  const effects: Effect[] = [];

  // ETB damage
  const dmgMatch = text.match(/enters[^.]*?deals? (\d+) damage/);
  if (dmgMatch) {
    const dmgTarget = text.match(/enters[^.]*?deals? \d+ damage to (any target|target creature|each opponent|target player|target opponent|creature or player|creature or planeswalker)/);
    let target = 'any target';
    let condition: string | undefined;

    if (dmgTarget) {
      if (dmgTarget[1].includes('opponent')) target = 'opponent';
      else if (dmgTarget[1].includes('creature')) target = 'creature';
      else if (dmgTarget[1].includes('player')) target = 'player';
      else target = dmgTarget[1];
    }

    const conditionalMatch = text.match(/enters[^.]*?deals? \d+ damage to target creature an opponent controls that was dealt damage this turn/);
    if (conditionalMatch) {
      target = 'opponent_creature';
      condition = 'dealt_damage_this_turn';
    }

    const effect: any = { type: 'damage', amount: parseInt(dmgMatch[1]), target };
    if (condition) effect.condition = condition;
    effects.push(effect);
  }

  // ETB draw
  const drawCheck = text.match(/enters[^.]*?(?:you )?(?:may )?draw (?:a |an |(\w+) )?cards?/);
  if (drawCheck) {
    effects.push({ type: 'draw', amount: drawCheck[1] ? (wordToNum(drawCheck[1]) || 1) : 1 });
  }

  // ETB gain life
  const lifeMatch = text.match(/enters[^.]*?(?:you )?gain (\d+|\w+) life/);
  if (lifeMatch) {
    const amt = parseInt(lifeMatch[1]) || wordToNum(lifeMatch[1]);
    if (amt) effects.push({ type: 'gainLife', amount: amt });
  }

  // ETB scry
  const scryMatch = text.match(/enters[^.]*?scry (\d+)/);
  if (scryMatch) effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });

  // ETB create token
  const tokenMatch = text.match(/enters[^.]*?create (?:a |an |(\w+) )?(\d+)\/(\d+)/);
  if (tokenMatch) {
    effects.push({
      type: 'create_token',
      count: tokenMatch[1] ? (wordToNum(tokenMatch[1]) || 1) : 1,
      power: parseInt(tokenMatch[2]),
      toughness: parseInt(tokenMatch[3]),
      name: 'Token',
    } as any);
  }

  // ETB +1/+1 counter on itself
  const counterSelfMatch = text.match(/enters[^.]*?with (?:a |(\w+) )?\+1\/\+1 counter/);
  if (counterSelfMatch) {
    effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterSelfMatch[1] ? (wordToNum(counterSelfMatch[1]) || 1) : 1 } as any);
  }

  // ETB +1/+1 counter on target
  const counterTargetMatch = text.match(/enters[^.]*?put (?:a |(\w+) )?\+1\/\+1 counters? on (target creature|another target creature|each creature you control)/);
  if (counterTargetMatch) {
    const amount = counterTargetMatch[1] ? (wordToNum(counterTargetMatch[1]) || 1) : 1;
    if (counterTargetMatch[2] === 'each creature you control') {
      effects.push({ type: 'counter_all', counter: '+1/+1', amount } as any);
    } else {
      effects.push({ type: 'counters', counter: '+1/+1', amount, target: 'creature' } as any);
    }
  }

  // ETB ramp
  if (text.match(/enters[^.]*?search your library for a basic land/)) {
    effects.push({ type: 'ramp', landType: 'basic', tapped: text.includes('tapped') } as any);
  }

  // ETB opponent loses life
  const loseMatch = text.match(/enters[^.]*?(?:each opponent|target opponent|opponents?) loses? (\d+) life/);
  if (loseMatch) effects.push({ type: 'loseLife', amount: parseInt(loseMatch[1]), target: 'opponent' });

  // ETB mill
  const millMatch = text.match(/enters[^.]*?(?:target player mills?|mills?|puts? the top) (\d+)/);
  if (millMatch) {
    const millTarget = text.includes('target player') || text.includes('opponent') ? 'opponent' : 'self';
    effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: millTarget });
  }

  // ETB surveil
  const surveilMatch = text.match(/enters[^.]*?surveil (\d+)/);
  if (surveilMatch) effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });

  // ETB destroy
  if (text.match(/enters[^.]*?destroy (?:target |up to one target )?(?:creature|nonland permanent|artifact|enchantment)/)) {
    effects.push({ type: 'destroy', target: 'creature' });
  }

  // ETB exile
  if (text.match(/enters[^.]*?exile (?:target |up to one target )?(?:creature|nonland permanent|card|artifact)/)) {
    effects.push({ type: 'exile', target: 'creature' });
  }

  // ETB bounce
  if (text.match(/enters[^.]*?return (?:target |up to one target )?(?:creature|nonland permanent|another)[^.]*?to its owner's hand/)) {
    effects.push({ type: 'bounce', target: 'creature' });
  }

  // ETB fight
  if (text.match(/enters[^.]*?(?:it )?fights? (?:up to one )?(?:target|another target)/)) {
    effects.push({ type: 'fight', target: 'creature' });
  }

  // ETB tap
  if (text.match(/enters[^.]*?tap (?:up to (?:\w+ )?)?(?:target )?creature/)) {
    effects.push({ type: 'tap', target: 'creature' });
  }

  // ETB complex buff/debuff
  const complexETBMatch = text.match(/enters[^.]*?target creature an opponent controls gets ([+-]\d+)\/([+-]\d+)[^.]*?and target creature you control gets ([+-]\d+)\/([+-]\d+)/);
  if (complexETBMatch) {
    effects.push({
      type: 'buff' as any,
      power: parseInt(complexETBMatch[1]),
      toughness: parseInt(complexETBMatch[2]),
      target: 'opponent_creature',
      duration: 'end_of_turn',
    } as any);
    effects.push({
      type: 'buff',
      power: parseInt(complexETBMatch[3]),
      toughness: parseInt(complexETBMatch[4]),
      target: 'own_creature',
      duration: 'end_of_turn',
    } as any);
  } else {
    const etbBuffMatch = text.match(/enters[^.]*?(?:target creature |another target creature |creatures you control )gets? ([+-]\d+)\/([+-]\d+)/);
    if (etbBuffMatch) {
      effects.push({
        type: 'buff',
        power: parseInt(etbBuffMatch[1]),
        toughness: parseInt(etbBuffMatch[2]),
        target: text.match(/enters[^.]*?creatures you control/) ? 'all_own_creatures' : 'creature',
      });
    }
  }

  // ETB discard opponent
  const discardMatch = text.match(/enters[^.]*?(?:target opponent|each opponent|opponents?) discards? (?:a |(\w+) )?cards?/);
  if (discardMatch) {
    effects.push({ type: 'discard', amount: discardMatch[1] ? (wordToNum(discardMatch[1]) || 1) : 1, target: 'opponent' });
  }

  // ETB prevent damage
  const preventMatch = text.match(/enters[^.]*?prevent (?:the next )?(\d+) damage/);
  if (preventMatch) effects.push({ type: 'prevent_damage', amount: parseInt(preventMatch[1]) });

  // ETB blight
  const blightMatch = text.match(/enters[^.]*?(?:you may )?blight (\d+)/);
  if (blightMatch) {
    effects.push({ type: 'blight', amount: parseInt(blightMatch[1]), optional: text.includes('you may blight') } as any);
  }

  return effects;
}

// ============================================
// Triggered Ability Parser
// ============================================

function _parseEffectFromTrigger(text: string, triggerPhrase: string): Effect[] | null {
  const effects: Effect[] = [];

  const drawMatch = text.match(new RegExp(triggerPhrase + '[^.]*?draw (?:a |an |(\\w+) )?cards?'));
  if (drawMatch) effects.push({ type: 'draw', amount: drawMatch[1] ? (wordToNum(drawMatch[1]) || 1) : 1 });

  const lifeMatch = text.match(new RegExp(triggerPhrase + '[^.]*?gain (\\d+) life'));
  if (lifeMatch) effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });

  const loseLifeMatch = text.match(new RegExp(triggerPhrase + '[^.]*?(?:each opponent|target opponent) loses? (\\d+) life'));
  if (loseLifeMatch) effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });

  const dmgMatch = text.match(new RegExp(triggerPhrase + '[^.]*?deals? (\\d+) damage'));
  if (dmgMatch) effects.push({ type: 'damage', amount: parseInt(dmgMatch[1]), target: 'opponent' });

  const buffMatch = text.match(new RegExp(triggerPhrase + '[^.]*?gets? ([+-]\\d+)\\/([+-]\\d+)'));
  if (buffMatch) effects.push({ type: 'buff_self' as any, power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });

  const counterMatch = text.match(new RegExp(triggerPhrase + '[^.]*?put (?:a |(\\d+) )?\\+1\\/\\+1 counter'));
  if (counterMatch) effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterMatch[1] ? parseInt(counterMatch[1]) : 1 } as any);

  const tokenMatch = text.match(new RegExp(triggerPhrase + '[^.]*?create (?:a |(\\d+) )?(\\d+)\\/(\\d+)'));
  if (tokenMatch) effects.push({ type: 'create_token', count: tokenMatch[1] ? parseInt(tokenMatch[1]) : 1, power: parseInt(tokenMatch[2]), toughness: parseInt(tokenMatch[3]), name: 'Token' } as any);

  const scryMatch = text.match(new RegExp(triggerPhrase + '[^.]*?scry (\\d+)'));
  if (scryMatch) effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });

  const millMatch = text.match(new RegExp(triggerPhrase + '[^.]*?mills? (\\d+)'));
  if (millMatch) effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: 'opponent' });

  const addManaMatch = text.match(new RegExp(triggerPhrase + '[^.]*?add \\{([wubrgc])\\}'));
  if (addManaMatch) effects.push({ type: 'add_mana', color: addManaMatch[1].toUpperCase() } as any);

  const surveilMatch = text.match(new RegExp(triggerPhrase + '[^.]*?surveil (\\d+)'));
  if (surveilMatch) effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });

  const dmgEachMatch = text.match(new RegExp(triggerPhrase + '[^.]*?deals? (\\d+) damage to each opponent'));
  if (dmgEachMatch) effects.push({ type: 'damage_each_opponent' as any, amount: parseInt(dmgEachMatch[1]) });

  const endureMatch = text.match(new RegExp(triggerPhrase + '[^.]*?endure (\\d+)'));
  if (endureMatch) effects.push({ type: 'endure' as any, amount: parseInt(endureMatch[1]) });

  // Create token with keywords
  if (effects.every(e => e.type !== 'create_token')) {
    const tokenKwMatch = text.match(new RegExp(triggerPhrase + '[^.]*?create (?:a |an? |(\\w+) )?(\\d+)\\/(\\d+)[^.]*?tokens?'));
    if (tokenKwMatch) {
      const count = tokenKwMatch[1] ? (wordToNum(tokenKwMatch[1]) || 1) : 1;
      const keywords: string[] = [];
      const tokenText = text.match(/create[^.]+/)?.[0] || '';
      ['flying', 'haste', 'lifelink', 'deathtouch', 'vigilance', 'trample', 'menace', 'prowess'].forEach(kw => {
        if (tokenText.includes(kw)) keywords.push(kw.charAt(0).toUpperCase() + kw.slice(1));
      });
      const attacking = tokenText.includes('tapped and attacking');
      effects.push({
        type: 'create_token',
        count,
        power: parseInt(tokenKwMatch[2]),
        toughness: parseInt(tokenKwMatch[3]),
        name: 'Token',
        keywords: keywords.length > 0 ? keywords : undefined,
        attacking: attacking || undefined,
      } as any);
    }
  }

  // Untap self
  if (text.match(new RegExp(triggerPhrase + '[^.]*?untap ~'))) {
    effects.push({ type: 'untap_self' as any });
  }

  // Peek top land
  if (text.match(/look at the top card.*if it'?s a land card.*put it into your hand/)) {
    effects.push({ type: 'peek_top_land' as any });
  }

  return effects.length > 0 ? effects : null;
}

export function parseTriggeredAbilities(card: GameCard): TriggerDefinition[] {
  const rawText = (card.oracle_text || '').toLowerCase();
  const name = (card.name || '').toLowerCase();
  const text = rawText.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
  const triggers: TriggerDefinition[] = [];

  // "When ~ attacks" / "Whenever ~ attacks"
  if (text.match(/when(?:ever)?\s+(?:~|this creature|equipped creature|enchanted creature)\s+attacks/)) {
    const effect = _parseEffectFromTrigger(text, 'attacks');
    if (effect) triggers.push({ event: 'attacks', self: true, effects: effect });
  }

  // "Whenever ~ deals combat damage to a player"
  if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+deals combat damage to a player/)) {
    const effect = _parseEffectFromTrigger(text, 'deals combat damage');
    if (effect) triggers.push({ event: 'combat_damage_player', self: true, effects: effect });
  }

  // "When ~ dies"
  if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+dies/)) {
    const effect = _parseEffectFromTrigger(text, 'dies');
    if (effect) triggers.push({ event: 'dies', self: true, effects: effect });
  }

  // "Whenever a creature you control dies"
  if (text.match(/whenever a creature you control dies/)) {
    const effect = _parseEffectFromTrigger(text, 'dies');
    if (effect) triggers.push({ event: 'any_creature_dies', effects: effect } as any);
  }

  // Upkeep
  if (text.match(/at the beginning of your upkeep/)) {
    const effect = _parseEffectFromTrigger(text, 'upkeep');
    if (effect) triggers.push({ event: 'upkeep', self: true, effects: effect });
  }

  // Gain life
  if (text.match(/whenever you gain life/)) {
    const effect = _parseEffectFromTrigger(text, 'gain life');
    if (effect) triggers.push({ event: 'gain_life', self: true, effects: effect });
  }

  // Becomes tapped
  if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+becomes tapped/)) {
    const effect = _parseEffectFromTrigger(text, 'becomes tapped');
    if (effect) triggers.push({ event: 'becomes_tapped', self: true, effects: effect });
  }

  // Second spell
  if (text.match(/whenever you cast your second spell/)) {
    const effect = _parseEffectFromTrigger(text, 'second spell');
    if (effect) triggers.push({ event: 'second_spell', self: true, effects: effect });
  }

  // End step
  if (text.match(/at the (?:beginning of (?:your|each) end step|end of (?:your |each )?turn)/)) {
    const effect = _parseEffectFromTrigger(text, 'end step');
    if (effect) triggers.push({ event: 'end_step', self: true, effects: effect });
  }

  // Enters or attacks
  if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+enters[^.]*?or attacks/)) {
    const effect = _parseEffectFromTrigger(text, '(?:enters|attacks)');
    if (effect) triggers.push({ event: 'enters_or_attacks', self: true, effects: effect });
  }

  // Another creature you control dies
  if (text.match(/whenever another creature you control dies/)) {
    const effect = _parseEffectFromTrigger(text, 'dies');
    if (effect) triggers.push({ event: 'other_creature_dies', effects: effect } as any);
  }

  // Dragon enters
  if (text.match(/whenever a dragon enters/)) {
    const effect = _parseEffectFromTrigger(text, 'dragon enters');
    if (effect) triggers.push({ event: 'dragon_enters', effects: effect } as any);
  }

  return triggers;
}

// ============================================
// Cycling Parser
// ============================================

function _parseCyclingCost(costStr: string): { cmc: number; manaCost: string } {
  const symbols = costStr.match(/\{[^}]+\}/g) || [];
  let cmc = 0;
  let manaCost = '';
  for (const sym of symbols) {
    manaCost += sym;
    const inner = sym.replace(/[{}]/g, '').toUpperCase();
    if (/^\d+$/.test(inner)) cmc += parseInt(inner);
    else cmc += 1;
  }
  return { cmc, manaCost };
}

export function parseCyclingAbility(card: GameCard): { type: string; cost: number; manaCost: string; searchType: string | null } | null {
  const text = (card.oracle_text || '').toLowerCase();

  const cyclingMatch = text.match(/(?<![a-z])cycling ((?:\{[^}]+\})+)/);
  if (cyclingMatch && !text.match(/landcycling/)) {
    const { cmc, manaCost } = _parseCyclingCost(cyclingMatch[1]);
    return { type: 'cycling', cost: cmc, manaCost, searchType: null };
  }

  const typeCyclingMatch = text.match(/(plains|island|swamp|mountain|forest)cycling ((?:\{[^}]+\})+)/);
  if (typeCyclingMatch) {
    const landTypeMap: Record<string, string> = {
      'plains': 'Plains', 'island': 'Island', 'swamp': 'Swamp',
      'mountain': 'Mountain', 'forest': 'Forest',
    };
    const { cmc, manaCost } = _parseCyclingCost(typeCyclingMatch[2]);
    return { type: 'typecycling', cost: cmc, manaCost, searchType: landTypeMap[typeCyclingMatch[1]] };
  }

  const basicLandCycling = text.match(/basic landcycling ((?:\{[^}]+\})+)/);
  if (basicLandCycling) {
    const { cmc, manaCost } = _parseCyclingCost(basicLandCycling[1]);
    return { type: 'basiclandcycling', cost: cmc, manaCost, searchType: 'basic' };
  }

  return null;
}

export function hasCycling(card: GameCard): boolean {
  return parseCyclingAbility(card) !== null;
}

// ============================================
// Additional Costs Parser
// ============================================

export function parseAdditionalCosts(card: GameCard): any[] {
  const text = (card.oracle_text || '').toLowerCase();
  const costs: any[] = [];

  const sacrificeMatch = text.match(/as an additional cost[^,]*,\s*sacrifice (?:a |an? )?(\w+)/);
  if (sacrificeMatch) {
    const type = sacrificeMatch[1];
    if (type === 'creature') costs.push({ type: 'sacrifice', target: 'creature' });
    else if (type === 'land') costs.push({ type: 'sacrifice', target: 'land' });
    else if (type === 'permanent') costs.push({ type: 'sacrifice', target: 'permanent' });
    else if (type === 'artifact') costs.push({ type: 'sacrifice', target: 'artifact' });
    else costs.push({ type: 'sacrifice', target: 'permanent' });
  }

  const discardMatch = text.match(/as an additional cost[^,]*,\s*discard (?:a |(\d+) )?cards?/);
  if (discardMatch) {
    costs.push({ type: 'discard', amount: discardMatch[1] ? parseInt(discardMatch[1]) : 1 });
  }

  const lifeMatch = text.match(/as an additional cost[^,]*,\s*pay (\d+) life/);
  if (lifeMatch) {
    costs.push({ type: 'pay_life', amount: parseInt(lifeMatch[1]) });
  }

  if (text.match(/as an additional cost[^,]*,\s*tap an untapped creature/)) {
    costs.push({ type: 'tap_creature' });
  }

  // Behold
  const beholdMatch = text.match(/behold (?:a |an )?(\w+)/);
  if (beholdMatch && text.includes('behold') && !text.match(/as though it had flash if you behold/i)) {
    const beholdType = beholdMatch[1];
    const orPayMatch = text.match(/behold[^.]*or pay \{(\d+)\}/);
    const mayBehold = !!text.match(/you may behold/i);
    costs.push({
      type: 'behold',
      subtype: beholdType.charAt(0).toUpperCase() + beholdType.slice(1),
      optional: !!orPayMatch || mayBehold,
      alternateCost: orPayMatch ? parseInt(orPayMatch[1]) : 0,
    });
  }

  return costs;
}

// ============================================
// Activated Abilities Parser
// ============================================

export function parseActivatedAbilities(card: GameCard): ActivatedAbility[] {
  const text = (card.oracle_text || '').toLowerCase();
  if (!text.includes(':')) return [];

  const abilities: ActivatedAbility[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Skip mana abilities and equip
    if (line.match(/\{t\}\s*:\s*add \{/)) continue;
    if (line.startsWith('equip')) continue;

    const costMatch = line.match(/^(?:\{([^}]+)\}(?:,\s*)?)+\s*:\s*(.+)/);
    if (!costMatch) continue;

    const costPart = line.split(':')[0].trim();
    const effectPart = line.split(':').slice(1).join(':').trim();

    let manaCostStr = '';
    let requiresTap = false;
    const costSymbols = costPart.match(/\{([^}]+)\}/g) || [];
    costSymbols.forEach(sym => {
      const val = sym.replace(/[{}]/g, '').toUpperCase();
      if (val === 'T') requiresTap = true;
      else manaCostStr += val;
    });

    const effects: Effect[] = [];

    const drawMatch = effectPart.match(/draw (?:a |(\d+) )?cards?/);
    if (drawMatch) effects.push({ type: 'draw', amount: drawMatch[1] ? parseInt(drawMatch[1]) : 1 });

    const buffMatch = effectPart.match(/gets? ([+-]\d+)\/([+-]\d+)/);
    if (buffMatch) effects.push({ type: 'buff_self' as any, power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });

    const dmgEachOppMatch = effectPart.match(/deals? (\d+) damage to each opponent/);
    if (dmgEachOppMatch) {
      effects.push({ type: 'damage_each_opponent' as any, amount: parseInt(dmgEachOppMatch[1]) });
    } else {
      const dmgMatch2 = effectPart.match(/deals? (\d+) damage/);
      if (dmgMatch2) {
        const target = effectPart.includes('target creature') ? 'creature' :
          effectPart.includes('any target') ? 'any target' : 'opponent';
        effects.push({ type: 'damage', amount: parseInt(dmgMatch2[1]), target });
      }
    }

    const lifeMatch = effectPart.match(/gain (\d+) life/);
    if (lifeMatch) effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });

    const loseLifeMatch = effectPart.match(/(?:target opponent|each opponent) loses? (\d+) life/);
    if (loseLifeMatch) effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });

    const counterMatch2 = effectPart.match(/put (?:a |(\d+) )?\+1\/\+1 counter/);
    if (counterMatch2) effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterMatch2[1] ? parseInt(counterMatch2[1]) : 1 } as any);

    const tokenMatch2 = effectPart.match(/create (?:a |(\d+) )?(\d+)\/(\d+)/);
    if (tokenMatch2) effects.push({ type: 'create_token', count: tokenMatch2[1] ? parseInt(tokenMatch2[1]) : 1, power: parseInt(tokenMatch2[2]), toughness: parseInt(tokenMatch2[3]), name: 'Token' } as any);

    const addManaMatch = effectPart.match(/add \{([wubrgc])\}/);
    if (addManaMatch) effects.push({ type: 'add_mana', color: addManaMatch[1].toUpperCase() } as any);

    if (effectPart.includes('destroy target')) effects.push({ type: 'destroy', target: 'creature' });
    if (effectPart.includes('tap target')) effects.push({ type: 'tap', target: 'creature' });
    if (effectPart.includes('untap')) effects.push({ type: 'untap_self' as any });

    if (effects.length > 0) {
      abilities.push({
        cost: manaCostStr || '0',
        effects,
        tap: requiresTap,
      } as any);
    }
  }

  return abilities;
}
