// bot-ai.ts — Bot AI for Draft Picks & Deck Building
// Ported from legacy bot-ai.js
//
// Uses BREAD (Bombs, Removal, Evasion, Aggro, Dregs) strategy,
// color signal reading, mana curve awareness, and archetype tracking.

import type { Card } from '../lib/types';

// ============================================
// Human Pick Learning System
// ============================================

const HUMAN_LEARN_KEY = 'md_human_draft_learn_v1';

interface HumanLearnData {
  picks: Record<string, number>;  // cardName → times picked
  passes: Record<string, number>; // cardName → times passed over
  totalPicks: number;
}

function _getHumanLearnData(): HumanLearnData {
  try {
    const stored = localStorage.getItem(HUMAN_LEARN_KEY);
    if (stored) return JSON.parse(stored) as HumanLearnData;
  } catch { /* ignore */ }
  return { picks: {}, passes: {}, totalPicks: 0 };
}

function _saveHumanLearnData(data: HumanLearnData): void {
  try { localStorage.setItem(HUMAN_LEARN_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** Called by DraftScreen when the human confirms a pick. Records the pick and all passed cards. */
export function recordHumanPick(pickedCard: Card, packCards: Card[]): void {
  const data = _getHumanLearnData();
  const pickedName = pickedCard.name || '';
  data.picks[pickedName] = (data.picks[pickedName] || 0) + 1;
  data.totalPicks++;
  for (const card of packCards) {
    const n = card.name || '';
    if (n !== pickedName) {
      data.passes[n] = (data.passes[n] || 0) + 1;
    }
  }
  _saveHumanLearnData(data);
}

/** Returns a score adjustment for a card based on human pick history (-2 to +2 range). */
function _humanLearnBonus(cardName: string): number {
  const data = _getHumanLearnData();
  const picks = data.picks[cardName] || 0;
  const passes = data.passes[cardName] || 0;
  const total = picks + passes;
  if (total < 2) return 0; // Need at least 2 data points
  const pickRate = picks / total;
  // 0.3 is the "neutral" pick rate (1 pick out of ~3 cards left when it appears).
  // +2.0 if always picked, -1.5 if always passed.
  return Math.max(-1.5, Math.min(2.0, (pickRate - 0.3) * 3.5));
}

/** Returns stats for the Settings screen display. */
export function getHumanLearnStats(): { totalPicks: number; topPicks: string[]; topPasses: string[] } {
  const data = _getHumanLearnData();
  const topPicks = Object.entries(data.picks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  const topPasses = Object.entries(data.passes)
    .filter(([name]) => !data.picks[name] || data.picks[name] / ((data.picks[name] || 0) + (data.passes[name] || 0)) < 0.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
  return { totalPicks: data.totalPicks, topPicks, topPasses };
}

/** Resets all human pick learning data. */
export function resetHumanLearn(): void {
  try { localStorage.removeItem(HUMAN_LEARN_KEY); } catch { /* ignore */ }
}

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

  // Hate drafting: in packs 2-3, take bombs away from opponents
  // when we have no good on-color card to pick anyway
  if (bot.committedColors && bot.packNumber >= 1 && bot.pickInPack >= 5) {
    const hateTarget = pack.find(c => {
      const power = _cardPower(c);
      if (power < 8.5) return false;
      const colors = _getCardColors(c);
      return colors.length > 0 && !colors.some(col => bot.committedColors!.includes(col));
    });
    if (hateTarget && bestScore < 6.0) {
      return _doPick(bot, hateTarget);
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
  score += _humanLearnBonus(card.name || ''); // learn from human picks
  return score;
}

// --- 1. Card Power (BREAD) ---
function _cardPower(card: Card): number {
  const text = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  const keywords = (card.keywords || []).map(k => k.toLowerCase());
  const rarity = card.rarity || 'common';
  let score = 0;

  // Non-basic lands: mana fixing is highly valuable in draft
  if (typeLine.includes('land') && !typeLine.includes('basic land')) {
    const landColors = card.color_identity || [];
    // Fetchlands — best possible fixing
    if (text.includes('search your library for a') && text.includes('land')) return 5.5;
    // Triomes, duals, etc — fix 2+ colors
    if (landColors.length >= 2) return 5.0;
    // Any non-basic producing colored mana
    if (text.includes('add {') || landColors.length === 1) return 4.0;
    return 3.0; // Generic colorless utility land
  }

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
    if (keywords.includes('flash')) score += 1.0; // Flash is strong tempo/surprise value
    if (keywords.includes('hexproof')) score += 1.0;
    if (keywords.includes('ward')) score += 0.8;
    if (keywords.includes('indestructible')) score += 2.0;

    if (text.includes('enters') || text.includes('when') || text.includes('whenever')) {
      if (text.includes('draw')) score += 1.5;
      if (text.includes('create') && text.includes('token')) score += 1.0;
      if (text.includes('destroy') || text.includes('exile')) score += 2.0;
      if (text.includes('deal') && text.includes('damage')) score += 1.0;
    }

    // Activated abilities (e.g. {T}: Draw a card)
    {
      const activatedPattern = /\{[^}]+\}[^:]*:\s*([^.]+)/g;
      let abBonus = 0;
      let m: RegExpExecArray | null;
      while ((m = activatedPattern.exec(text)) !== null) {
        const effect = m[1].toLowerCase();
        if (effect.includes('draw')) abBonus += 2.0;
        else if (effect.includes('destroy') || effect.includes('exile')) abBonus += 2.5;
        else if (effect.includes('create') && effect.includes('token')) abBonus += 1.5;
        else if (effect.includes('deal') && effect.includes('damage')) abBonus += 1.5;
        else if (effect.includes('add {') || effect.includes('add mana')) abBonus += 0.8;
        else if (effect.includes('gain') && effect.includes('life')) abBonus += 0.6;
        else if (effect.includes('+1/+1') || effect.includes('gets +')) abBonus += 0.8;
      }
      // Also detect "sacrifice this:" patterns
      if (/sacrifice [^:]+:/i.test(text)) abBonus += 1.0;
      score += Math.min(abBonus, 3.5); // Cap to avoid over-inflation
    }

    if ((!card.oracle_text || card.oracle_text.trim() === '') && keywords.length === 0) {
      score -= 1.0;
    }

    return score;
  }

  // Non-creature spells — evaluate card advantage, tempo, and board impact
  if (text.includes('draw') && text.includes('card')) {
    // Draw 3+ cards — massive card advantage
    if (text.includes('draw three') || text.includes('draw 3') || text.includes('draw four') || text.includes('draw 4') || text.includes('draw five') || text.includes('draw 5')) {
      score += 6.0;
    } else if (text.includes('draw two') || text.includes('draw 2')) {
      score += 5.0;
    } else {
      score += 3.5; // Draw one card
    }
  }
  if (text.includes('scry') || text.includes('surveil')) score += 0.5;
  if (text.includes('search your library for a basic land') || text.includes('add {')) score += 3.0; // ramp/fixing
  if (text.includes('create') && text.includes('token')) score += 2.5;
  if (text.includes('all creatures get') || text.includes('creatures you control get')) score += 2.0;
  // Bounce (tempo) — slightly weaker than hard removal
  if (text.includes('return target') && (text.includes("owner's hand") || text.includes('its owner'))) score += 1.5;
  // Counterspells — hard counters are premium removal equivalent
  if (text.includes('counter target spell') || text.includes('negate')) score += 4.0;
  else if (text.includes('counter target')) score += 3.0; // Conditional counters
  // Instants with multiple modes or conditional draw
  if (typeLine.includes('instant') && text.includes('if') && text.includes('draw')) score += 1.0;

  // Adventure cards: evaluate the instant/sorcery face bonus
  if ((card as any).back_face_oracle_text && (card as any).back_face_type_line) {
    const bfText = ((card as any).back_face_oracle_text || '').toLowerCase();
    const bfType = ((card as any).back_face_type_line || '').toLowerCase();
    if (bfType.includes('instant') || bfType.includes('sorcery')) {
      if (bfText.includes('destroy') || bfText.includes('exile')) score += 2.0;
      else if (bfText.includes('draw')) score += 1.5;
      else if (bfText.includes('counter target')) score += 1.5;
      else if (bfText.includes('create') && bfText.includes('token')) score += 1.0;
      else score += 0.5; // Any adventure face adds flexibility
    }
  }

  if (typeLine.includes('aura')) score = Math.max(score, POWER_FILLER) - 0.5;
  if (typeLine.includes('equipment')) {
    let eqScore = POWER_AGGRO; // 3.5 base
    // Bonus based on stat boost
    const statMatch = text.match(/equipped creature gets \+(\d+)\/\+(\d+)/);
    if (statMatch) {
      const pBonus = parseInt(statMatch[1]);
      const tBonus = parseInt(statMatch[2]);
      eqScore += (pBonus + tBonus) * 0.4;
    }
    // Keyword grants from equip are very strong
    if (text.includes('flying') && (text.includes('equipped') || text.includes('equip'))) eqScore += 1.0;
    if (text.includes('first strike') || text.includes('double strike')) eqScore += 0.8;
    if (text.includes('lifelink')) eqScore += 0.6;
    if (text.includes('indestructible')) eqScore += 1.5;
    if (text.includes('hexproof')) eqScore += 1.2;
    if (text.includes('trample')) eqScore += 0.5;
    // Equip cost matters — cheap equip is flexible
    const equipCostMatch = text.match(/\bequip[^{(]*[\({](\d+)[\)}]/);
    const equipCost = equipCostMatch ? parseInt(equipCostMatch[1]) : 2;
    if (equipCost === 0) eqScore += 1.0;
    else if (equipCost === 1) eqScore += 0.5;
    else if (equipCost >= 4) eqScore -= 0.5;
    score = Math.max(score, eqScore);
  }
  if (typeLine.includes('saga')) {
    // Sagas vary hugely — score based on what chapters actually do
    let sagaScore = POWER_EVASION; // 5.0 base
    if (text.includes('draw')) sagaScore += 1.5;
    if (text.includes('counter target')) sagaScore += 1.5;
    if (text.includes('destroy') || text.includes('exile')) sagaScore += 1.5;
    if (/deals \d+ damage to each/.test(text)) sagaScore += 2.5; // mass damage chapter
    if (text.includes('double') && (text.includes('power') || text.includes('toughness'))) sagaScore += 2.5; // double stats
    if (/create a [4-9]\/[4-9]/.test(text)) sagaScore += 2.0; // big token generator
    if (/create a [2-3]\/[2-3]/.test(text)) sagaScore += 0.5;
    score = Math.max(score, sagaScore);
  }

  // Rarity floor: rare/mythic cards are generally more powerful than commons
  // Apply a minimum score floor so we don't pass them for mediocre commons
  if (score >= POWER_DREG) {
    if (rarity === 'mythic') score = Math.max(score, 6.0);
    else if (rarity === 'rare') score = Math.max(score, 4.5);
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

  // NOTE: check stricter condition first, otherwise it is dead code
  if (cmc === 2 && bot.curveCounts[2] < 3) return 3.0;
  if (cmc === 2 && bot.curveCounts[2] < 5) return 2.0;
  if (cmc === 3 && bot.curveCounts[3] < 2) return 2.5;
  if (cmc === 3 && bot.curveCounts[3] < 4) return 1.5;
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
    signalBonus += (bot.signals[c] || 0) * 0.5;
  }
  return Math.min(signalBonus, 2.5);
}

function _readSignals(bot: BotState, pack: Card[]): void {
  if (bot.pickInPack < 2 || bot.pickInPack > 11) return;

  for (const card of pack) {
    const power = _cardPower(card);
    // Lower threshold (was 5.0) so mid-tier cards also send signals.
    // Start reading earlier (pick 3 instead of pick 4).
    if (power >= 3.5 && bot.pickInPack >= 3) {
      const colors = _getCardColors(card);
      colors.forEach(c => {
        if (bot.signals[c] !== undefined) {
          // Bombs (+2), removal/evasion (+1), solid cards (+0.5)
          bot.signals[c] += power >= 7.0 ? 2 : power >= 5.0 ? 1 : 0.5;
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
      // Include non-basic lands that are colorless OR contribute ≥2 deck colors (for duals/triomes)
      // or ≥1 deck color (for mono-colored non-basics). This avoids adding a WU dual to a mono-W deck.
      const landColors = card.color_identity || [];
      const isColorless  = landColors.length === 0;
      const matchingColors = landColors.filter(c => bestColors.includes(c));
      // For multi-color lands: require ≥2 matching colors. For mono-color lands: require ≥1.
      const partialMatch = landColors.length >= 2 ? matchingColors.length >= 2 : matchingColors.length >= 1;
      if (isColorless || partialMatch) {
        nonBasicLands.push(card);
      } else {
        offColor.push(card); // completely off-color → sideboard
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
      // Lower splash threshold: include evasion-quality+ cards, not only removal
      if (power >= POWER_EVASION) {
        splashable.push(card);
      } else {
        offColor.push(card);
      }
    } else {
      offColor.push(card);
    }
  }

  const archetype = _detectArchetype(onColor);

  const scored = onColor
    .filter(c => {
      const tl = (c.type_line || '').toLowerCase();
      return !tl.includes('land'); // exclude ALL lands from the 23 spell slots
    })
    .map(card => ({ card, score: _deckBuildScore(card, bestColors, archetype) }))
    .sort((a, b) => b.score - a.score);

  const spells = _selectDeckCards(scored, splashable, archetype);
  const deck = [...spells, ...nonBasicLands];
  const lands = _calculateLands(deck, bestColors, archetype);

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
    // Was too harsh (min 2pt penalty), making 3-color almost never viable.
    // Now: 2 fixers = 0 penalty (3-color viable with 2 fixers), 0 fixers = 4pt penalty.
    if (is3Color) {
      const fixerDiscount = Math.min(4, totalFixers * 2); // 2pts per fixer, up to 4
      pairScore -= Math.max(0, 4 - fixerDiscount);
    }

    if (pairScore > bestPairScore) {
      bestPairScore = pairScore;
      bestPair = combo;
    }
  }

  return bestPair;
}

// ── Archetype detection ──────────────────────────────────────────────────────
function _detectArchetype(cards: Card[]): 'aggro' | 'control' | 'midrange' {
  let aggro = 0, control = 0;
  for (const card of cards) {
    const tl = (card.type_line || '').toLowerCase();
    const oracle = (card.oracle_text || '').toLowerCase();
    const cmc = card.cmc || 0;
    if (tl.includes('creature') && cmc <= 2) aggro += 2;
    if (tl.includes('creature') && cmc >= 5) control += 0.5;
    if (oracle.includes('destroy') || oracle.includes('exile') || oracle.includes('counter target')) control += 2;
    if (oracle.includes('draw') && !tl.includes('creature')) control += 1;
    if (oracle.includes('haste') || oracle.includes('+1/+0')) aggro += 1;
    if (tl.includes('creature') && cmc <= 3 && !(oracle.includes('destroy') || oracle.includes('exile'))) aggro += 0.5;
  }
  if (aggro > control * 1.6) return 'aggro';
  if (control > aggro * 1.6) return 'control';
  return 'midrange';
}

// ── Situational card detection (better in sideboard than main) ───────────────
function _isSituational(card: Card): boolean {
  const oracle = (card.oracle_text || '').toLowerCase();
  const tl = (card.type_line || '').toLowerCase();
  if (tl.includes('creature')) return false; // Creatures always playable
  // Pure artifact/enchantment hate with no other effect
  const destroysOnlyArtEnch = (oracle.includes('destroy target artifact') || oracle.includes('destroy target enchantment'))
    && !oracle.includes('creature') && !oracle.includes('draw') && !oracle.includes('player');
  if (destroysOnlyArtEnch) return true;
  // Pure graveyard hate
  const pureGyHate = (oracle.includes('exile target card from a graveyard') || oracle.includes('exile all cards from all graveyards'))
    && !oracle.includes('draw') && !oracle.includes('creature') && !oracle.includes('damage');
  if (pureGyHate) return true;
  return false;
}

function _deckBuildScore(card: Card, colors: string[], archetype?: 'aggro' | 'control' | 'midrange'): number {
  let score = _cardPower(card);
  const rarityBonus: Record<string, number> = { mythic: 0.3, rare: 0.2, uncommon: 0.1, common: 0 };
  score += rarityBonus[card.rarity] || 0;

  const cardColors = _getCardColors(card);
  if (cardColors.length > 0 && cardColors.every(c => colors.includes(c))) {
    score += 0.1;
  }

  // ── Situational card penalty ───────────────────────────────────────────────
  if (_isSituational(card)) score -= 2.5;

  // ── Archetype adjustments ──────────────────────────────────────────────────
  if (archetype) {
    const cmc = card.cmc || 0;
    const tl = (card.type_line || '').toLowerCase();
    const oracle = (card.oracle_text || '').toLowerCase();
    if (archetype === 'aggro') {
      if (cmc <= 2) score += 0.6;          // 2-drops are gold in aggro
      if (cmc === 3) score += 0.2;
      if (cmc >= 5) score -= 1.2;          // Top-end cards slow aggro down
      if (oracle.includes('haste')) score += 0.8;
      if (oracle.includes('trample')) score += 0.4;
    } else if (archetype === 'control') {
      if (cmc >= 5 && tl.includes('creature')) score += 0.5; // Big finishers are fine
      if (oracle.includes('draw') || oracle.includes('scry')) score += 0.6;
      if (oracle.includes('counter target')) score += 0.5;
      if (cmc <= 1 && tl.includes('creature') && !oracle.includes('draw')) score -= 0.6;
    }
    // midrange: balanced, no adjustment needed
  }

  return score;
}

function _selectDeckCards(scoredCards: { card: Card; score: number }[], splashable: Card[], archetype?: 'aggro' | 'control' | 'midrange'): Card[] {
  const deck: Card[] = [];
  let creatures = 0;
  let spells = 0;
  const cmcBuckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  // Dynamic creature cap: token/tribal synergy decks can run up to 20 creatures.
  // Detect: 3+ "create N token" effects or 4+ of same creature type in the scored pool.
  const allCards = scoredCards.map(s => s.card);
  const tokenMakers = allCards.filter(c => {
    const o = (c.oracle_text || '').toLowerCase();
    return o.includes('create') && o.includes('token');
  }).length;
  const typeMap: Record<string, number> = {};
  for (const c of allCards) {
    if (!(c.type_line || '').toLowerCase().includes('creature')) continue;
    const parts = (c.type_line || '').split('—');
    const subtypes = (parts[1] || '').trim().split(' ');
    for (const st of subtypes) {
      if (st.length > 2) typeMap[st] = (typeMap[st] || 0) + 1;
    }
  }
  const strongTribal = Object.values(typeMap).some(v => v >= 4);
  const creatureCap = (tokenMakers >= 3 || strongTribal) ? 20 : 18;

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
    if (isCreatureCard && creatures >= creatureCap && score < POWER_EVASION) continue;
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

  // ── Curve enforcement: ensure at least 2 creatures at CMC 2 and CMC 3 ────
  // Without this, decks can have 0 two-drops and 0 three-drops — unplayable hands.
  const minAtCmc: Record<number, number> = archetype === 'aggro'
    ? { 2: 3, 3: 2 }
    : { 2: 2, 3: 2 };
  for (const [cmcStr, minCount] of Object.entries(minAtCmc)) {
    const cmc = parseInt(cmcStr);
    if ((cmcBuckets[cmc] || 0) < minCount && deck.length < 23) {
      for (const { card } of scoredCards) {
        if (deck.length >= 23) break;
        if (deck.includes(card)) continue;
        const tl = (card.type_line || '').toLowerCase();
        if (tl.includes('land')) continue;
        if (Math.ceil(card.cmc || 0) === cmc && tl.includes('creature')) {
          deck.push(card);
          creatures++;
          cmcBuckets[cmc] = (cmcBuckets[cmc] || 0) + 1;
          if ((cmcBuckets[cmc] || 0) >= minCount) break;
        }
      }
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

function _calculateLands(deck: Card[], mainColors: string[], archetype?: 'aggro' | 'control' | 'midrange'): Record<string, number> {
  const lands: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const pipCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const dualLandColors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let nonBasicLandCount = 0;
  // Aggro wants fewer lands (lower curve), control wants more
  const IDEAL_LANDS_FOR_ARCHETYPE = archetype === 'aggro' ? 16 : archetype === 'control' ? 18 : 17;

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
  const totalLands = Math.max(0, IDEAL_LANDS_FOR_ARCHETYPE - nonBasicLandCount);

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
