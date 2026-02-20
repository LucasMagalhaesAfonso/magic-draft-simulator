// card-utils.ts — Pure card utility functions
// Ported from legacy cards.js (helper section)
// No side effects, no global state

import type { GameCard, EngineGameState, ActivatedAbility, TriggerDefinition, Effect, CardEffectEntry } from './engine-types';

// Word-to-number conversion helper
const WORD_NUM_MAP: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function wordToNum(word: string | null | undefined): number | null {
  if (!word) return null;
  return WORD_NUM_MAP[word.toLowerCase()] ?? (parseInt(word) || null);
}

// ============================================
// Type Checks
// ============================================

export function isCreature(card: GameCard): boolean {
  return (card.type_line || '').includes('Creature');
}

export function isLand(card: GameCard): boolean {
  return (card.type_line || '').includes('Land');
}

export function isInstant(card: GameCard): boolean {
  const typeLine = card.type_line || '';
  // Adventure cards have combined type_line "Creature — X // Instant — Y" — check front face only
  const frontType = typeLine.includes(' // ') ? typeLine.split(' // ')[0] : typeLine;
  return frontType.includes('Instant');
}

export function isSorcery(card: GameCard): boolean {
  const typeLine = card.type_line || '';
  // Adventure cards have combined type_line "Creature — X // Sorcery — Y" — check front face only
  const frontType = typeLine.includes(' // ') ? typeLine.split(' // ')[0] : typeLine;
  return frontType.includes('Sorcery');
}

export function isEnchantment(card: GameCard): boolean {
  return (card.type_line || '').includes('Enchantment');
}

export function isArtifact(card: GameCard): boolean {
  return (card.type_line || '').includes('Artifact');
}

export function isPlaneswalker(card: GameCard): boolean {
  return (card.type_line || '').includes('Planeswalker');
}

export function isSaga(card: GameCard): boolean {
  return (card.type_line || '').toLowerCase().includes('saga');
}

export function isPermanent(card: GameCard): boolean {
  return !isInstant(card) && !isSorcery(card);
}

export function isBasicLand(card: GameCard): boolean {
  return (card.type_line || '').includes('Basic Land');
}

export function isKindred(card: GameCard): boolean {
  return (card.type_line || '').toLowerCase().includes('kindred');
}

// ============================================
// Keyword Detection
// ============================================

export function hasKeyword(card: GameCard, keyword: string, gameState: EngineGameState | null = null): boolean {
  const kwLower = keyword.toLowerCase();

  // Check regular keywords
  if ((card.keywords || []).some(k => k && typeof k === 'string' && k.toLowerCase() === kwLower)) {
    return true;
  }

  // Check keyword counters
  if (card._counters?.[kwLower] && card._counters[kwLower] > 0) {
    return true;
  }

  // Check temporary keywords (end-of-turn grants)
  if (card._tempKeywords?.some(k => k && typeof k === 'string' && k.toLowerCase() === kwLower)) {
    return true;
  }

  // Check grants from other permanents (requires gameState)
  if (gameState && card._isToken && card._attacking) {
    const cardController = findCardController(gameState, card);
    if (cardController !== null) {
      const battlefield = gameState.players[cardController].zones.battlefield.cards;
      for (const granter of battlefield) {
        if (granter._grantAttackingTokens && typeof granter._grantAttackingTokens === 'string' &&
            granter._grantAttackingTokens.toLowerCase() === kwLower) {
          return true;
        }
      }
    }
  }

  // Check dragon grants
  if (gameState && hasCreatureType(card, 'Dragon')) {
    const cardController = findCardController(gameState, card);
    if (cardController !== null) {
      const battlefield = gameState.players[cardController].zones.battlefield.cards;
      for (const granter of battlefield) {
        if (granter._grantDragons) {
          const grantedKeywords = Array.isArray(granter._grantDragons)
            ? granter._grantDragons
            : [granter._grantDragons];
          if (grantedKeywords.some(kw => typeof kw === 'string' && kw.toLowerCase() === kwLower)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

export function hasIndestructible(card: GameCard): boolean {
  return hasKeyword(card, 'Indestructible');
}

export function hasFlash(card: GameCard): boolean {
  return hasKeyword(card, 'Flash');
}

export function hasLifelink(card: GameCard): boolean {
  return hasKeyword(card, 'Lifelink');
}

export function hasConvoke(card: GameCard): boolean {
  return hasKeyword(card, 'Convoke') || (card.oracle_text || '').toLowerCase().includes('convoke');
}

export function hasChangeling(card: GameCard): boolean {
  return hasKeyword(card, 'Changeling');
}

export function hasCreatureType(card: GameCard, type: string): boolean {
  if (hasChangeling(card)) return true;
  const typeLine = card.type_line || '';
  if (!typeLine.includes('—')) return false;
  const subtypes = typeLine.split('—').pop()!.trim().toLowerCase();
  return subtypes.includes(type.toLowerCase());
}

export function hasLandType(card: GameCard, type: string): boolean {
  const typeLine = card.type_line || '';
  if (!typeLine.includes('—')) return false;
  const subtypes = typeLine.split('—').pop()!.trim().toLowerCase();
  return subtypes.includes(type.toLowerCase());
}

export function isDragon(card: GameCard): boolean {
  return hasCreatureType(card, 'Dragon');
}

// ============================================
// Power / Toughness
// ============================================

export function getPower(card: GameCard): number {
  let p = parseInt(card.power as string);

  // Vivid: * power
  if (isNaN(p) && card._vividPower) {
    p = card._vividPowerValue || 0;
  }
  // Dynamic power
  if (isNaN(p) && card._dynamicPower != null) {
    p = card._dynamicPower;
  }

  const counterBonus = card._counters
    ? (card._counters['+1/+1'] || 0) - (card._counters['-1/-1'] || 0)
    : 0;

  return isNaN(p) ? 0 : p + (card._powerMod || 0) + counterBonus;
}

export function getToughness(card: GameCard): number {
  const t = parseInt(card.toughness as string);
  const counterBonus = card._counters
    ? (card._counters['+1/+1'] || 0) - (card._counters['-1/-1'] || 0)
    : 0;

  return isNaN(t) ? 0 : t + (card._toughnessMod || 0) + counterBonus;
}

// ============================================
// Combat Checks
// ============================================

export function canAttack(card: GameCard): boolean {
  if (!isCreature(card)) return false;
  if (card._tapped) return false;
  if (hasKeyword(card, 'Defender')) return false;
  if (card._summoningSick && !hasKeyword(card, 'Haste')) return false;
  return true;
}

export function canBlock(card: GameCard, attacker: GameCard, gameState: EngineGameState | null = null): boolean {
  if (!isCreature(card)) return false;
  if (card._tapped) return false;
  if (card._cantBlockThisTurn) return false;

  // Unblockable
  if (attacker._unblockable || hasKeyword(attacker, 'Unblockable', gameState)) return false;

  // Cant be blocked by creatures with power less than attacker (Formation Breaker)
  if ((attacker as any)._cantBeBlockedBySmaller && getPower(card) < getPower(attacker)) return false;

  // Decayed creatures can't block
  if (hasKeyword(card, 'Decayed', gameState) || ((card as any)._counters?.['decayed'] || 0) > 0) return false;

  // Flying — can only be blocked by flying or reach
  if (hasKeyword(attacker, 'Flying', gameState)) {
    if (!hasKeyword(card, 'Flying', gameState) && !hasKeyword(card, 'Reach', gameState)) {
      return false;
    }
  }

  return true;
}

// ============================================
// Card Colors
// ============================================

export function getCardColors(card: GameCard): string[] {
  const colors: string[] = [];
  const manaCost = card.mana_cost || '';
  const colorLine = card.color_identity || card.colors || [];

  if (manaCost.includes('W')) colors.push('W');
  if (manaCost.includes('U')) colors.push('U');
  if (manaCost.includes('B')) colors.push('B');
  if (manaCost.includes('R')) colors.push('R');
  if (manaCost.includes('G')) colors.push('G');

  if (Array.isArray(colorLine)) {
    colorLine.forEach(color => {
      if (['W', 'U', 'B', 'R', 'G'].includes(color) && !colors.includes(color)) {
        colors.push(color);
      }
    });
  }

  return colors;
}

// ============================================
// Helpers
// ============================================

export function findCardController(gameState: EngineGameState, card: GameCard): number | null {
  for (let pid = 0; pid < gameState.players.length; pid++) {
    const bf = gameState.players[pid].zones.battlefield.cards;
    if (bf.some(c => c._uid === card._uid)) {
      return pid;
    }
  }
  return null;
}

// Ward cost extraction
export function hasWard(card: GameCard): boolean {
  return hasKeyword(card, 'Ward');
}

export function getWardCost(card: GameCard): number {
  if (!hasKeyword(card, 'Ward')) return 0;
  const text = (card.oracle_text || '').toLowerCase();
  const m = text.match(/ward\s*\{(\d+)\}/i) || text.match(/ward\s*\{(\w)\}/i);
  if (m) return parseInt(m[1]) || 1;
  return 1;
}

// Planeswalker loyalty
export function getStartingLoyalty(card: GameCard): number {
  if (card.loyalty) return parseInt(card.loyalty) || 0;
  return 3;
}

// Card has Vivid-based P/T
export function hasVividPT(card: GameCard): boolean {
  const text = (card.oracle_text || '').toLowerCase();
  return (card.power === '*' || card.toughness === '*') && text.includes('vivid');
}

// Adventure support
export function hasAdventure(card: GameCard): boolean {
  return !!(card.adventure && card.adventure.name);
}

// Transform/DFC support
export function isTransformCard(card: GameCard): boolean {
  return !!(card.backFace || card._backFace);
}

// Can be targeted check (respects hexproof, shroud)
export function canBeTargeted(card: GameCard, byPlayerId: number, gameState: EngineGameState | null = null): boolean {
  if (hasKeyword(card, 'Shroud', gameState)) return false;

  if (hasKeyword(card, 'Hexproof', gameState)) {
    // Hexproof only prevents targeting by opponents
    const controller = findCardController(gameState!, card);
    if (controller !== null && controller !== byPlayerId) return false;
  }

  return true;
}

// ============================================
// Vivid Colors (needs game state)
// ============================================

export function countVividColors(state: EngineGameState, playerId: number): number {
  const bf = state.players[playerId].zones.battlefield;
  const colors = new Set<string>();
  bf.cards.forEach((c: GameCard) => {
    const cardColors = (c as any).colors || (c as any).color_identity || [];
    cardColors.forEach((clr: string) => colors.add(clr));
  });
  return colors.size;
}
