// bot-ai.ts — Bot AI for Draft Picks & Deck Building
// Ported from legacy bot-ai.js
//
// Uses BREAD (Bombs, Removal, Evasion, Aggro, Dregs) strategy,
// color signal reading, mana curve awareness, and archetype tracking.

import type { Card } from '../lib/types';

// ============================================
// Types
// ============================================

export interface BotState {
  id: number;
  name: string;
  pool: Card[];
  colorPips: Record<string, number>;
  colorCount: Record<string, number>;
  curveCounts: Record<number, number>;
  creatureCount: number;
  spellCount: number;
  removalCount: number;
  pickCount: number;
  packNumber: number;
  pickInPack: number;
  committedColors: string[] | null;
  signals: Record<string, number>;
  tribalCounts: Record<string, number>;
  keywordCounts: Record<string, number>;
}

export interface DeckBuildResult {
  deck: Card[];
  lands: Record<string, number>;
  sideboard: Card[];
}

// ============================================
// Constants
// ============================================

const PHASE_OPEN = 4;
const PHASE_COMMIT = 8;

const IDEAL_LANDS = 17;

const POWER_BOMB = 9.0;
const POWER_REMOVAL = 7.0;
const POWER_EVASION = 5.0;
const POWER_AGGRO = 3.5;
const POWER_FILLER = 2.0;
const POWER_DREG = 0.5;

const COLOR_PENALTY: Record<string, Record<string, number>> = {
  open: { onColor: 0.5, partial: 0, offColor: -0.5, thirdColor: -1.0 },
  commit: { onColor: 2.5, partial: 1.0, offColor: -3.0, thirdColor: -5.0 },
  locked: { onColor: 3.5, partial: 1.5, offColor: -6.0, thirdColor: -8.0 },
};

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

// ============================================
// Bot Creation
// ============================================

export function createBot(id: number): BotState {
  return {
    id,
    name: `Bot ${id}`,
    pool: [],
    colorPips: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    colorCount: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    curveCounts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    creatureCount: 0,
    spellCount: 0,
    removalCount: 0,
    pickCount: 0,
    packNumber: 0,
    pickInPack: 0,
    committedColors: null,
    signals: { W: 0, U: 0, B: 0, R: 0, G: 0 },
    tribalCounts: {},
    keywordCounts: {},
  };
}

// ============================================
// Main Pick Logic
// ============================================

export function pickCard(bot: BotState, pack: Card[]): Card | null {
  if (pack.length === 0) return null;
  if (pack.length === 1) return _doPick(bot, pack[0]);

  _readSignals(bot, pack);

  let bestCard = pack[0];
  let bestScore = -Infinity;

  for (const card of pack) {
    const score = _evaluateCard(bot, card);
    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return _doPick(bot, bestCard);
}

function _doPick(bot: BotState, card: Card): Card {
  bot.pool.push(card);
  bot.pickCount++;
  bot.pickInPack++;

  // Track color pips
  const mc = card.mana_cost || '';
  const pips = mc.match(/\{([WUBRG])\}/g) || [];
  pips.forEach(m => {
    const c = m.replace(/[{}]/g, '');
    if (bot.colorPips[c] !== undefined) bot.colorPips[c]++;
  });

  // Track color by card count
  const colors = _getCardColors(card);
  colors.forEach(c => { if (bot.colorCount[c] !== undefined) bot.colorCount[c]++; });

  // Track curve
  const cmcSlot = Math.min(Math.max(Math.ceil(card.cmc || 0), 0), 6);
  bot.curveCounts[cmcSlot] = (bot.curveCounts[cmcSlot] || 0) + 1;

  // Track creature/spell balance
  const typeLine = (card.type_line || '').toLowerCase();
  if (typeLine.includes('creature')) {
    bot.creatureCount++;
  } else if (!typeLine.includes('land')) {
    bot.spellCount++;
    const text = (card.oracle_text || '').toLowerCase();
    if (_isRemoval(text, typeLine)) bot.removalCount++;
  }

  // Track tribal subtypes
  if (card.type_line && card.type_line.includes('—')) {
    const subtypes = card.type_line.split('—').pop()!.trim().split(' ');
    subtypes.forEach(st => {
      const s = st.trim();
      if (s.length > 2) {
        bot.tribalCounts[s] = (bot.tribalCounts[s] || 0) + 1;
      }
    });
  }

  // Track keywords
  (card.keywords || []).forEach(kw => {
    bot.keywordCounts[kw] = (bot.keywordCounts[kw] || 0) + 1;
  });

  // Try to commit colors
  if (!bot.committedColors && bot.pickCount >= PHASE_OPEN) {
    _tryCommitColors(bot);
  }

  return card;
}

// ============================================
// Card Evaluation
// ============================================

function _evaluateCard(bot: BotState, card: Card): number {
  let score = 0;
  score += _cardPower(card);
  score += _colorFit(bot, card);
  score += _curveNeed(bot, card);
  score += _balanceNeed(bot, card);
  score += _synergyFit(bot, card);
  score += _signalBonus(bot, card);
  return score;
}

// --- 1. Card Power (BREAD) ---
function _cardPower(card: Card): number {
  const text = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const keywords = (card.keywords || []).map(k => k.toLowerCase());
  const rarity = card.rarity || 'common';
  let score = 0;

  if (_isBomb(card, text, rarity)) {
    return POWER_BOMB + (rarity === 'mythic' ? 1.5 : 0);
  }

  if (_isRemoval(text, typeLine)) {
    score = POWER_REMOVAL;
    if (text.includes('destroy target creature') || text.includes('exile target creature')) {
      score += 1.0;
    }
    if (typeLine.includes('instant')) score += 0.5;
    if (text.includes('deals') && text.includes('damage to target')) {
      const dmgMatch = text.match(/deals (\d+)/);
      if (dmgMatch && parseInt(dmgMatch[1]) <= 2) score -= 1.0;
    }
    return score;
  }

  const hasEvasion = keywords.some(k =>
    ['flying', 'menace', 'trample', 'skulk', 'shadow', 'fear', 'intimidate'].includes(k)
  ) || text.includes("can't be blocked");

  if (typeLine.includes('creature')) {
    const power = parseInt(card.power as string) || 0;
    const toughness = parseInt(card.toughness as string) || 0;
    const cmc = card.cmc || 0;
    const statTotal = power + toughness;

    if (hasEvasion) {
      score = POWER_EVASION;
      if (power >= 3) score += 0.5;
      if (keywords.includes('flying') && power >= 2) score += 0.5;
    } else if (statTotal >= cmc * 2 + 1 || power >= cmc) {
      score = POWER_AGGRO;
    } else {
      score = POWER_FILLER;
    }

    if (keywords.includes('deathtouch')) score += 1.5;
    if (keywords.includes('lifelink')) score += 1.0;
    if (keywords.includes('first strike') || keywords.includes('double strike')) score += 1.0;
    if (keywords.includes('vigilance')) score += 0.5;
    if (keywords.includes('haste')) score += 0.5;
    if (keywords.includes('reach')) score += 0.3;
    if (keywords.includes('flash')) score += 0.5;
    if (keywords.includes('hexproof')) score += 1.0;
    if (keywords.includes('indestructible')) score += 2.0;

    if (text.includes('enters') || text.includes('when') || text.includes('whenever')) {
      if (text.includes('draw')) score += 1.5;
      if (text.includes('create') && text.includes('token')) score += 1.0;
      if (text.includes('destroy') || text.includes('exile')) score += 2.0;
      if (text.includes('deal') && text.includes('damage')) score += 1.0;
    }

    if ((!card.oracle_text || card.oracle_text.trim() === '') && keywords.length === 0) {
      score -= 1.0;
    }

    return score;
  }

  // Non-creature spells — evaluate card advantage, tempo, and board impact
  if (text.includes('draw') && text.includes('card')) {
    score += text.includes('draw two') || text.includes('draw 2') ? 4.0 : 3.0;
  }
  if (text.includes('scry') || text.includes('surveil')) score += 0.5;
  if (text.includes('search your library for a basic land') || text.includes('add {')) score += 3.0; // ramp/fixing
  if (text.includes('create') && text.includes('token')) score += 2.5;
  if (text.includes('all creatures get') || text.includes('creatures you control get')) score += 2.0;
  // Bounce (tempo) — slightly weaker than hard removal
  if (text.includes('return target') && (text.includes("owner's hand") || text.includes('its owner'))) score += 1.5;
  // Counterspells — valued as hard removal
  if (text.includes('counter target')) score += 2.0;
  // Instants with multiple modes or conditional draw
  if (typeLine.includes('instant') && text.includes('if') && text.includes('draw')) score += 1.0;

  if (typeLine.includes('aura')) score = Math.max(score, POWER_FILLER) - 0.5;
  if (typeLine.includes('equipment')) score = Math.max(score, POWER_AGGRO);
  if (typeLine.includes('saga')) {
    // Sagas vary hugely — score based on what chapters actually do
    let sagaScore = POWER_EVASION; // 5.0 base
    if (text.includes('draw')) sagaScore += 1.0;
    if (text.includes('destroy') || text.includes('exile')) sagaScore += 1.5;
    if (/deals \d+ damage to each/.test(text)) sagaScore += 2.5; // mass damage chapter
    if (text.includes('double') && (text.includes('power') || text.includes('toughness'))) sagaScore += 2.5; // double stats
    if (/create a [4-9]\/[4-9]/.test(text)) sagaScore += 2.0; // big token generator
    if (/create a [2-3]\/[2-3]/.test(text)) sagaScore += 0.5;
    score = Math.max(score, sagaScore);
  }

  return Math.max(score, POWER_DREG);
}

function _isBomb(card: Card, text: string, rarity: string): boolean {
  // Mass damage sweepers are bombs at ANY rarity — board wipes via damage
  if (/deals \d+ damage to (each|all) (creature|planeswalker)/.test(text)) return true;
  // Mass -X/-X debuffs to opponent creatures
  if (/all creatures get -\d+\/-\d+/.test(text) && !text.includes('you control')) return true;

  if (rarity !== 'rare' && rarity !== 'mythic') return false;

  if (text.includes('you win the game')) return true;
  if (text.includes('each opponent loses')) return true;
  if (text.includes('destroy all') && !text.includes('you control')) return true;

  const typeLine = (card.type_line || '').toLowerCase();

  // Sagas that create big tokens or double stats are bombs
  if (typeLine.includes('saga')) {
    if (/create a [4-9]\/[4-9]/.test(text)) return true;
    if (text.includes('double') && (text.includes('power') || text.includes('toughness'))) return true;
    if (text.includes('create two') && text.includes('token') && text.includes('4')) return true;
  }

  if (typeLine.includes('creature')) {
    const power = parseInt(card.power as string) || 0;
    const toughness = parseInt(card.toughness as string) || 0;
    const keywords = (card.keywords || []).map(k => k.toLowerCase());

    if (power + toughness >= 8 && keywords.length >= 1) return true;
    if (power >= 5 && keywords.includes('flying')) return true;
    if (power >= 4 && keywords.includes('trample') && keywords.includes('haste')) return true;
    // Hexproof creature with 3+ keywords is almost always a bomb
    if (keywords.includes('hexproof') && keywords.length >= 3) return true;
    if (text.includes('draw') && text.includes('card') && (text.includes('whenever') || text.includes('each'))) return true;
    if (text.includes('create') && text.includes('token') && text.includes('whenever')) return true;
  }

  if (typeLine.includes('planeswalker')) return true;
  if (rarity === 'rare' && text.includes('draw') && text.includes('each') && text.includes('turn')) return true;
  // Hard counter that also draws or has massive effect
  if (rarity === 'rare' && text.includes('counter target spell') && (text.includes('draw') || text.includes('gain control'))) return true;
  // Mass bounce / wrath effects
  if (text.includes('return all') || (text.includes('each player') && text.includes('return'))) return true;

  return false;
}

function _isRemoval(text: string, typeLine: string): boolean {
  if (text.includes('destroy target creature')) return true;
  if (text.includes('destroy target nonland')) return true;
  if (text.includes('exile target creature')) return true;
  if (text.includes('exile target nonland')) return true;
  if (/deals \d+ damage to (target|any)/.test(text)) return true;
  if (text.includes('target creature gets -') && text.includes('until end of turn')) return true;
  if (text.includes('fight')) return true;
  if (text.includes("target creature's owner")) return true;
  // Counterspells — blue's signature removal equivalent
  if (text.includes('counter target spell') || text.includes('counter target creature') || text.includes('counter target instant') || text.includes('counter target sorcery')) return true;
  // Bounce — tempo removal
  if (text.includes('return target') && (text.includes("owner's hand") || text.includes('its owner'))) return true;
  return false;
}

// --- 2. Color Fit ---
function _colorFit(bot: BotState, card: Card): number {
  const colors = _getCardColors(card);
  if (colors.length === 0) return 1.0;

  const phase = bot.pickCount < PHASE_OPEN ? 'open'
    : bot.pickCount < PHASE_COMMIT ? 'commit' : 'locked';

  const penalties = COLOR_PENALTY[phase];
  const topColors = bot.committedColors || _getTopColors(bot, 2);

  if (topColors.length === 0) return colors.length === 1 ? 0.3 : 0;

  const onColorCount = colors.filter(c => topColors.includes(c)).length;

  if (onColorCount === colors.length) {
    return penalties.onColor;
  } else if (onColorCount > 0) {
    return penalties.partial;
  } else {
    const currentColors = new Set(topColors);
    const newColors = colors.filter(c => !currentColors.has(c));
    if (newColors.length > 0 && currentColors.size >= 2) {
      return penalties.thirdColor;
    }
    return penalties.offColor;
  }
}

// --- 3. Mana Curve Needs ---
function _curveNeed(bot: BotState, card: Card): number {
  const typeLine = (card.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) return 0;

  const cmc = Math.ceil(card.cmc || 0);
  if (bot.creatureCount < 5) return 0;

  if (cmc === 2 && bot.curveCounts[2] < 5) return 2.0;
  if (cmc === 2 && bot.curveCounts[2] < 3) return 3.0;
  if (cmc === 3 && bot.curveCounts[3] < 4) return 1.5;
  if (cmc === 3 && bot.curveCounts[3] < 2) return 2.5;
  if (cmc === 4 && bot.curveCounts[4] < 3) return 1.0;
  if (cmc === 1 && bot.curveCounts[1] < 2) return 0.5;

  const highCmc = (bot.curveCounts[5] || 0) + (bot.curveCounts[6] || 0);
  if (cmc >= 5 && highCmc < 2) return 0.5;
  if (cmc >= 5 && highCmc >= 3) return -2.0;
  if (cmc >= 6 && highCmc >= 2) return -2.5;
  if (bot.curveCounts[cmc] >= 5) return -1.5;

  return 0;
}

// --- 4. Creature/Spell Balance ---
function _balanceNeed(bot: BotState, card: Card): number {
  const typeLine = (card.type_line || '').toLowerCase();
  const isCreatureCard = typeLine.includes('creature');
  if (typeLine.includes('land')) return 0;

  const total = bot.creatureCount + bot.spellCount;
  if (total < 6) return 0;

  const creatureRatio = bot.creatureCount / total;

  if (isCreatureCard) {
    if (creatureRatio < 0.50) return 2.0;
    if (creatureRatio < 0.60) return 1.0;
    if (creatureRatio > 0.75) return -1.0;
  } else {
    if (creatureRatio > 0.70) return 1.5;
    if (creatureRatio > 0.65) return 0.5;
    if (creatureRatio < 0.45) return -1.0;
  }

  if (!isCreatureCard && bot.removalCount < 3 && _isRemoval(
    (card.oracle_text || '').toLowerCase(), typeLine
  )) {
    return 1.0;
  }

  return 0;
}

// --- 5. Synergy ---
function _synergyFit(bot: BotState, card: Card): number {
  let bonus = 0;
  const text = (card.oracle_text || '').toLowerCase();
  const keywords = (card.keywords || []).map(k => k.toLowerCase());

  // Tribal
  if (card.type_line && card.type_line.includes('—')) {
    const subtypes = card.type_line.split('—').pop()!.trim().split(' ');
    for (const st of subtypes) {
      const s = st.trim();
      if (s.length > 2 && bot.tribalCounts[s]) {
        const count = bot.tribalCounts[s];
        if (count >= 4) bonus += 2.0;
        else if (count >= 2) bonus += 1.0;
        else bonus += 0.3;
      }
    }
  }

  // Cards referencing our tribal types
  for (const [type, count] of Object.entries(bot.tribalCounts)) {
    if (count >= 2 && type.length > 3 && text.includes(type.toLowerCase())) {
      bonus += 1.5;
    }
  }

  // Keyword synergy
  for (const kw of keywords) {
    if (bot.keywordCounts[kw] && bot.keywordCounts[kw] >= 2) {
      bonus += 0.3;
    }
  }

  // Text-based synergy
  if (text.includes('for each creature') || text.includes('creature you control')) {
    if (bot.creatureCount >= 8) bonus += 1.5;
  }

  return Math.min(bonus, 3.0);
}

// --- 6. Signal Reading ---
function _signalBonus(bot: BotState, card: Card): number {
  if (bot.pickCount < 3) return 0;
  const colors = _getCardColors(card);
  if (colors.length === 0) return 0;

  let signalBonus = 0;
  for (const c of colors) {
    signalBonus += (bot.signals[c] || 0) * 0.3;
  }
  return Math.min(signalBonus, 1.5);
}

function _readSignals(bot: BotState, pack: Card[]): void {
  if (bot.pickInPack < 3 || bot.pickInPack > 10) return;

  for (const card of pack) {
    const power = _cardPower(card);
    if (power >= 5.0 && bot.pickInPack >= 4) {
      const colors = _getCardColors(card);
      colors.forEach(c => {
        if (bot.signals[c] !== undefined) {
          bot.signals[c] += (power >= 7.0) ? 2 : 1;
        }
      });
    }
  }
}

// ============================================
// Color Management
// ============================================

function _tryCommitColors(bot: BotState): void {
  const colorScores: Record<string, number> = {};
  for (const c of COLORS) {
    colorScores[c] = (bot.colorPips[c] || 0) * 2
      + (bot.colorCount[c] || 0) * 1.5
      + (bot.signals[c] || 0) * 0.5;
  }

  const sorted = Object.entries(colorScores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length >= 2) {
    const top = sorted[0][1];
    const second = sorted[1][1];
    const third = sorted[2] ? sorted[2][1] : 0;

    if (top + second > third * 3 && bot.pickCount >= PHASE_OPEN) {
      bot.committedColors = [sorted[0][0], sorted[1][0]];
    }
  } else if (sorted.length === 1 && bot.pickCount >= PHASE_COMMIT) {
    const signalSort = Object.entries(bot.signals)
      .filter(([c]) => c !== sorted[0][0] && bot.signals[c] > 0)
      .sort((a, b) => b[1] - a[1]);
    if (signalSort.length > 0) {
      bot.committedColors = [sorted[0][0], signalSort[0][0]];
    }
  }
}

function _getCardColors(card: Card): string[] {
  if (card.colors && card.colors.length > 0) return card.colors;
  if (card.color_identity && card.color_identity.length > 0) return card.color_identity;

  const colors: string[] = [];
  const mc = card.mana_cost || '';
  if (mc.includes('W')) colors.push('W');
  if (mc.includes('U')) colors.push('U');
  if (mc.includes('B')) colors.push('B');
  if (mc.includes('R')) colors.push('R');
  if (mc.includes('G')) colors.push('G');
  return colors;
}

function _getTopColors(bot: BotState, count: number): string[] {
  const scores: Record<string, number> = {};
  for (const c of COLORS) {
    scores[c] = (bot.colorPips[c] || 0) * 2 + (bot.colorCount[c] || 0);
  }
  return Object.entries(scores)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([k]) => k);
}

export function newPack(bot: BotState): void {
  bot.packNumber++;
  bot.pickInPack = 0;
}

// ============================================
// Deck Building
// ============================================

export function buildDeck(pool: Card[]): DeckBuildResult {
  if (!pool || pool.length === 0) return { deck: [], lands: { W: 0, U: 0, B: 0, R: 0, G: 0 }, sideboard: [] };

  const bestColors = _findBestColorPair(pool);
  const onColor: Card[] = [];
  const splashable: Card[] = [];
  const offColor: Card[] = [];

  const nonBasicLands: Card[] = [];

  for (const card of pool) {
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('land') && !typeLine.includes('basic')) {
      // Only include non-basic lands whose colors overlap with the chosen colors
      const landColors = card.color_identity || [];
      const isColorless = landColors.length === 0;
      const matchesDeck = landColors.every(c => bestColors.includes(c));
      if (isColorless || matchesDeck) {
        nonBasicLands.push(card);
      } else {
        offColor.push(card); // wrong-color dual → sideboard
      }
      continue;
    }

    const colors = _getCardColors(card);
    if (colors.length === 0) {
      onColor.push(card);
    } else if (colors.every(c => bestColors.includes(c))) {
      onColor.push(card);
    } else if (colors.some(c => bestColors.includes(c))) {
      const power = _cardPower(card);
      if (power >= POWER_REMOVAL) {
        splashable.push(card);
      } else {
        offColor.push(card);
      }
    } else {
      offColor.push(card);
    }
  }

  const scored = onColor
    .filter(c => {
      const tl = (c.type_line || '').toLowerCase();
      return !tl.includes('land'); // exclude ALL lands from the 23 spell slots
    })
    .map(card => ({ card, score: _deckBuildScore(card, bestColors) }))
    .sort((a, b) => b.score - a.score);

  const spells = _selectDeckCards(scored, splashable);
  const deck = [...spells, ...nonBasicLands];
  const lands = _calculateLands(deck, bestColors);

  const deckIds = new Set(deck.map(c => c.id));
  const sideboard = pool.filter(c => !deckIds.has(c.id));

  return { deck, lands, sideboard };
}

function _countManaFixers(cards: Card[]): number {
  let count = 0;
  for (const card of cards) {
    const text = (card.oracle_text || '').toLowerCase();
    const tl = (card.type_line || '').toLowerCase();
    // Non-basic lands that produce multiple colors
    if (tl.includes('land') && !tl.includes('basic')) { count++; continue; }
    // Ramp spells / creatures that search for basic lands
    if (text.includes('search your library for a basic land')) { count++; continue; }
    // Cards that add any color of mana
    if (text.includes('add one mana of any color') || text.includes('add mana of any color')) { count++; continue; }
    // Landcycling
    if (/landcycling|land cycling/.test(text)) { count++; continue; }
  }
  return count;
}

function _findBestColorPair(pool: Card[]): string[] {
  const cardScores = pool.map(card => ({
    card,
    score: _cardPower(card),
    colors: _getCardColors(card),
  }));

  // Count mana fixers once for the whole pool
  const totalFixers = _countManaFixers(pool);

  // All 2-color pairs + all 10 3-color combinations (wedges/shards)
  const colorCombos: string[][] = [
    // 2-color
    ['W', 'U'], ['W', 'B'], ['W', 'R'], ['W', 'G'],
    ['U', 'B'], ['U', 'R'], ['U', 'G'],
    ['B', 'R'], ['B', 'G'],
    ['R', 'G'],
    // 3-color
    ['W', 'U', 'B'], ['W', 'U', 'R'], ['W', 'U', 'G'],
    ['W', 'B', 'R'], ['W', 'B', 'G'], ['W', 'R', 'G'],
    ['U', 'B', 'R'], ['U', 'B', 'G'], ['U', 'R', 'G'],
    ['B', 'R', 'G'],
  ];

  let bestPair = ['W', 'U'];
  let bestPairScore = -Infinity;

  for (const combo of colorCombos) {
    const is3Color = combo.length === 3;
    let pairScore = 0;
    let pairCreatures = 0;
    let pairRemoval = 0;
    const pairCards: { card: Card; score: number }[] = [];

    for (const { card, score, colors } of cardScores) {
      if (colors.length === 0 || colors.every(c => combo.includes(c))) {
        pairCards.push({ card, score });
        const tl = (card.type_line || '').toLowerCase();
        if (tl.includes('creature')) pairCreatures++;
        else if (!tl.includes('land')) {
          if (_isRemoval((card.oracle_text || '').toLowerCase(), tl)) pairRemoval++;
        }
      }
    }

    if (pairCards.length < 18) continue;

    pairCards.sort((a, b) => b.score - a.score);
    const top23 = pairCards.slice(0, 23);
    pairScore = top23.reduce((sum, c) => sum + c.score, 0);

    const creatureTarget = Math.min(pairCreatures, 17);
    if (creatureTarget >= 13 && creatureTarget <= 17) pairScore += 5;
    if (creatureTarget < 10) pairScore -= 10;

    if (pairRemoval >= 3) pairScore += 5;
    if (pairRemoval >= 1) pairScore += 2;

    const twos = pairCards.filter(c =>
      Math.ceil(c.card.cmc || 0) === 2 && (c.card.type_line || '').toLowerCase().includes('creature')
    ).length;
    if (twos >= 3) pairScore += 3;
    if (twos < 2) pairScore -= 3;

    // 3-color penalty: reduced when pool has mana fixers (lands, ramp, etc.)
    if (is3Color) {
      const fixerDiscount = Math.min(6, totalFixers * 2); // 2pts discount per fixer, up to 6
      pairScore -= Math.max(2, 8 - fixerDiscount);
    }

    if (pairScore > bestPairScore) {
      bestPairScore = pairScore;
      bestPair = combo;
    }
  }

  return bestPair;
}

function _deckBuildScore(card: Card, colors: string[]): number {
  let score = _cardPower(card);
  const rarityBonus: Record<string, number> = { mythic: 0.3, rare: 0.2, uncommon: 0.1, common: 0 };
  score += rarityBonus[card.rarity] || 0;

  const cardColors = _getCardColors(card);
  if (cardColors.length > 0 && cardColors.every(c => colors.includes(c))) {
    score += 0.1;
  }

  return score;
}

function _selectDeckCards(scoredCards: { card: Card; score: number }[], splashable: Card[]): Card[] {
  const deck: Card[] = [];
  let creatures = 0;
  let spells = 0;
  const cmcBuckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const { card, score } of scoredCards) {
    if (deck.length >= 23) break;

    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('land')) continue; // skip all lands (non-basic already extracted)

    const isCreatureCard = typeLine.includes('creature');
    const cmc = Math.min(Math.max(Math.ceil(card.cmc || 0), 1), 6);

    const highCmc = (cmcBuckets[5] || 0) + (cmcBuckets[6] || 0);
    if (cmc >= 5 && highCmc >= 3 && score < POWER_REMOVAL) continue;
    if (cmc >= 6 && highCmc >= 2 && score < POWER_REMOVAL) continue;

    const isRemoval = !isCreatureCard && _isRemoval((card.oracle_text || '').toLowerCase(), typeLine);
    if (isCreatureCard && creatures >= 18 && score < POWER_EVASION) continue;
    if (!isCreatureCard && spells >= 10 && score < POWER_EVASION && !isRemoval) continue;

    deck.push(card);
    if (isCreatureCard) creatures++;
    else spells++;
    cmcBuckets[cmc] = (cmcBuckets[cmc] || 0) + 1;
  }

  // Add splashable bombs
  if (deck.length < 23) {
    const scoredSplash = splashable
      .map(card => ({ card, score: _cardPower(card) }))
      .sort((a, b) => b.score - a.score);

    for (const { card } of scoredSplash) {
      if (deck.length >= 23) break;
      deck.push(card);
    }
  }

  // Fill from remaining
  if (deck.length < 23) {
    for (const { card } of scoredCards) {
      if (deck.length >= 23) break;
      if (deck.includes(card)) continue;
      const typeLine = (card.type_line || '').toLowerCase();
      if (typeLine.includes('land')) continue; // skip all lands
      deck.push(card);
    }
  }

  return deck;
}

function _calculateLands(deck: Card[], mainColors: string[]): Record<string, number> {
  const lands: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const pipCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const dualLandColors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let nonBasicLandCount = 0;

  for (const card of deck) {
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('land') && !typeLine.includes('basic land')) {
      nonBasicLandCount++;
      const landColors = card.color_identity || [];
      for (const c of landColors) {
        if (dualLandColors[c] !== undefined) dualLandColors[c]++;
      }
      continue;
    }

    const mc = card.mana_cost || '';
    const pips = mc.match(/\{([WUBRG])\}/g) || [];
    pips.forEach(m => {
      const c = m.replace(/[{}]/g, '');
      if (pipCounts[c] !== undefined) pipCounts[c]++;
    });
  }

  const totalPips = Object.values(pipCounts).reduce((a, b) => a + b, 0);
  const totalLands = Math.max(0, IDEAL_LANDS - nonBasicLandCount);

  if (totalPips === 0) {
    // Distribute evenly across all main colors (2 or 3)
    const perColor = Math.floor(totalLands / mainColors.length);
    const remainder = totalLands % mainColors.length;
    mainColors.forEach((c, i) => { lands[c] = perColor + (i < remainder ? 1 : 0); });
    return lands;
  }

  // Adjust pip needs by dual land contributions
  const adjustedPips: Record<string, number> = { ...pipCounts };
  for (const [color, count] of Object.entries(dualLandColors)) {
    if (adjustedPips[color] > 0) {
      adjustedPips[color] = Math.max(0, adjustedPips[color] - count);
    }
  }
  const adjustedTotal = Object.values(adjustedPips).reduce((a, b) => a + b, 0);

  const activeColors = Object.entries(adjustedTotal > 0 ? adjustedPips : pipCounts)
    .filter(([, v]) => v > 0);

  const distTotal = adjustedTotal > 0 ? adjustedTotal : totalPips;
  for (const [color, pips] of activeColors) {
    lands[color] = Math.max(1, Math.round((pips / distTotal) * totalLands));
  }

  // Limit splash to 2-3 lands
  for (const [color] of activeColors) {
    if (!mainColors.includes(color)) {
      const dualCoverage = dualLandColors[color] || 0;
      lands[color] = Math.min(lands[color], Math.max(0, 3 - dualCoverage));
    }
  }

  // Adjust total
  let currentTotal = Object.values(lands).reduce((a, b) => a + b, 0);
  const sortedLands = Object.entries(lands)
    .filter(([, v]) => v > 0)
    .sort((a, b) => {
      const aMain = mainColors.includes(a[0]) ? 1 : 0;
      const bMain = mainColors.includes(b[0]) ? 1 : 0;
      if (aMain !== bMain) return bMain - aMain;
      return b[1] - a[1];
    });

  while (currentTotal > totalLands) {
    let reduced = false;
    for (const entry of sortedLands) {
      if (entry[1] > 1 && currentTotal > totalLands) {
        entry[1]--;
        lands[entry[0]]--;
        currentTotal--;
        reduced = true;
      }
    }
    if (!reduced) break;
  }
  while (currentTotal < totalLands) {
    const mainColor = pipCounts[mainColors[0]] >= pipCounts[mainColors[1]]
      ? mainColors[0] : mainColors[1];
    lands[mainColor]++;
    currentTotal++;
  }

  return lands;
}
