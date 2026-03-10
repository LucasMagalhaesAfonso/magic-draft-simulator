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
  return (card.type_line || '').includes('Creature') || !!(card as any)._vehicleActive;
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
  // Card with lose_all_abilities has no keywords
  if ((card as any)._losesAllAbilities) return false;

  // Normalize: treat underscores as spaces ("double_strike" === "double strike")
  const kwLower = keyword.toLowerCase().replace(/_/g, ' ');

  const normalize = (k: string) => k.toLowerCase().replace(/_/g, ' ');

  // Check regular keywords
  if ((card.keywords || []).some(k => k && typeof k === 'string' && normalize(k) === kwLower)) {
    return true;
  }

  // Check keyword counters (stored as-is, try both formats)
  if (card._counters?.[kwLower] && card._counters[kwLower] > 0) {
    return true;
  }
  const kwUnderscore = kwLower.replace(/ /g, '_');
  if (card._counters?.[kwUnderscore] && card._counters[kwUnderscore] > 0) {
    return true;
  }

  // Check temporary keywords (end-of-turn grants)
  if (card._tempKeywords?.some(k => k && typeof k === 'string' && normalize(k) === kwLower)) {
    return true;
  }

  // Check grants from other permanents (requires gameState)
  if (gameState && card._isToken && card._attacking) {
    const cardController = findCardController(gameState, card);
    if (cardController !== null) {
      const battlefield = gameState.players[cardController].zones.battlefield.cards;
      for (const granter of battlefield) {
        if (granter._grantAttackingTokens) {
          const granted = String(granter._grantAttackingTokens).split(',').map((k: string) => k.trim().toLowerCase());
          if (granted.includes(kwLower)) return true;
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
          const grantedKeywords = String(granter._grantDragons).split(',').map((k: string) => k.trim().toLowerCase());
          if (grantedKeywords.includes(kwLower)) return true;
        }
        // Dragonologist-style: grant keywords to untapped dragons only
        if ((granter as any)._grantUntappedDragons && !card._tapped) {
          const grantedKeywords = String((granter as any)._grantUntappedDragons).split(',').map((k: string) => k.trim().toLowerCase());
          if (grantedKeywords.includes(kwLower)) return true;
        }
      }
    }
  }

  // Tom Bombadil: conditional keywords that require 4+ lore counters across sagas
  if ((card as any)._conditionalKeywordsFourLore?.length > 0 && gameState) {
    const kwsLore = ((card as any)._conditionalKeywordsFourLore as string[]).map(k => k.toLowerCase().replace(/_/g, ' '));
    if (kwsLore.includes(kwLower)) {
      // Check if controller has any saga with 4+ lore counters total
      const cardController = findCardController(gameState, card);
      if (cardController !== null) {
        const sagas = gameState.players[cardController].zones.battlefield.cards.filter(
          (c: any) => isSaga(c as GameCard) && (c._sagaChapter || 0) >= 4
        );
        if (sagas.length > 0) return true;
      }
    }
  }

  return false;
}

export function hasIndestructible(card: GameCard, gameState: EngineGameState | null = null): boolean {
  return hasKeyword(card, 'Indestructible', gameState);
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
  // Handle DFC/adventure cards: "Creature — Dragon // Instant — Omen"
  // Check each face's subtype section separately
  const typeLower = type.toLowerCase();
  const faces = typeLine.split('//');
  for (const face of faces) {
    if (!face.includes('—')) continue;
    const subtypes = face.split('—').pop()!.trim().toLowerCase();
    if (subtypes.includes(typeLower)) return true;
  }
  return false;
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
  // Star power (*/*)
  if (isNaN(p) && card._starPower && card._starValue != null) {
    p = card._starValue;
  }

  const counterBonus = card._counters
    ? (card._counters['+1/+1'] || 0) - (card._counters['-1/-1'] || 0)
    : 0;

  return isNaN(p) ? 0 : p + (card._powerMod || 0) + counterBonus;
}

export function getToughness(card: GameCard): number {
  let t = parseInt(card.toughness as string);
  // Star toughness (*/*)
  if (isNaN(t) && (card as any)._starPower && (card as any)._starValue != null) {
    t = (card as any)._starValue;
  }
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
  if (card._cantAttack) return false;
  if (hasKeyword(card, 'Defender') && !hasKeyword(card, 'Can_attack')) return false;
  if (card._summoningSick && !hasKeyword(card, 'Haste')) return false;
  return true;
}

export function canBlock(card: GameCard, attacker: GameCard, gameState: EngineGameState | null = null): boolean {
  if (!isCreature(card)) return false;
  if (card._tapped) return false;
  if (card._cantBlockThisTurn) return false;
  // Permanent cant_block tied to a saga (There and Back Again Ch.I: "for as long as you control this Saga")
  if ((card as any)._cantBlockSagaUid && gameState) {
    const sagaUid = (card as any)._cantBlockSagaUid;
    let sagaFound = false;
    const gs = gameState as any;
    if (gs.players) {
      for (const p of gs.players) {
        if (p.zones?.battlefield?.get?.(sagaUid)) { sagaFound = true; break; }
      }
    }
    if (!sagaFound) {
      delete (card as any)._cantBlockSagaUid; // Saga left, clear restriction
    } else {
      return false; // Saga still in play, can't block
    }
  }

  // Unblockable
  if (attacker._unblockable || hasKeyword(attacker, 'Unblockable', gameState)) return false;

  // Cant be blocked by creatures with power less than attacker (Formation Breaker)
  if ((attacker as any)._cantBeBlockedBySmaller && getPower(card) < getPower(attacker)) return false;

  // Can't be blocked except by legendary creatures (The Balrog)
  if ((attacker as any)._cantBeBlockedExceptLegendary) {
    const blockerType = (card.type_line || '').toLowerCase();
    if (!blockerType.includes('legendary')) return false;
  }

  // Ring-bearer Level 1+: can't be blocked by creatures with greater power
  if (gameState && (gameState as any)._ringLevel && (gameState as any)._ringBearer) {
    let attackerPid = attacker._controller ?? (attacker as any)._ownerId ?? attacker._owner;
    // Fallback: find which player's battlefield contains this attacker
    if (attackerPid === undefined) {
      const gs = gameState as any;
      if (gs.players) {
        for (let p = 0; p < gs.players.length; p++) {
          if (gs.players[p]?.zones?.battlefield?.cards?.some((c: any) => c._uid === attacker._uid)) {
            attackerPid = p;
            break;
          }
        }
      }
    }
    if (attackerPid !== undefined &&
        (gameState as any)._ringLevel[attackerPid] >= 1 &&
        (gameState as any)._ringBearer[attackerPid] === attacker._uid &&
        getPower(card) > getPower(attacker)) {
      return false;
    }
  }

  // Decayed creatures can't block
  if (hasKeyword(card, 'Decayed', gameState) || ((card as any)._counters?.['decayed'] || 0) > 0) return false;

  // Can't block unless condition (e.g. Olog-hai Crusher: can't block unless you control a Goblin or Orc)
  if ((card as any)._cantBlockUnless && gameState) {
    const cond = (card as any)._cantBlockUnless;
    const blockerPid = (card as any)._controller ?? (card as any)._ownerId ?? (card as any)._owner;
    if (blockerPid !== undefined && cond === 'control_goblin_or_orc') {
      const bf = (gameState as any).players[blockerPid]?.zones?.battlefield?.cards || [];
      const hasGoblinOrOrc = bf.some((c: any) =>
        c._uid !== card._uid && isCreature(c) &&
        (hasCreatureType(c, 'Goblin') || hasCreatureType(c, 'Orc'))
      );
      if (!hasGoblinOrOrc) return false;
    }
  }

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
  if (!gameState || !gameState.players) return null;
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

// Can be targeted check (respects hexproof, shroud, hexproof from monocolored)
export function canBeTargeted(card: GameCard, byPlayerId: number, gameState: EngineGameState | null = null, sourceCard?: GameCard | null): boolean {
  if (hasKeyword(card, 'Shroud', gameState)) return false;

  if (hasKeyword(card, 'Hexproof', gameState)) {
    // Hexproof only prevents targeting by opponents
    if (!gameState) return false; // Can't determine controller, assume protected
    const controller = findCardController(gameState, card);
    if (controller !== null && controller !== byPlayerId) return false;
  }

  // Conditional hexproof: hexproof until this creature deals damage (Karakyk Guardian)
  if ((card as any)._hexproofUntilDamage && !(card as any)._hasDealtDamage) {
    if (!gameState) return false;
    const controller = findCardController(gameState, card);
    if (controller !== null && controller !== byPlayerId) return false;
  }

  // Hexproof from monocolored: can't be targeted by monocolored sources from opponents
  if ((card.keywords || []).some(k => typeof k === 'string' && k.toLowerCase() === 'hexproof_from_monocolored') ||
      (card._grantedKeywords || []).some((k: string) => k.toLowerCase() === 'hexproof_from_monocolored')) {
    const controller = gameState ? findCardController(gameState, card) : null;
    if (controller !== null && controller !== byPlayerId) {
      // Check if the source/spell is monocolored (1 color or colorless counts as mono)
      if (sourceCard) {
        const srcColors = getCardColors(sourceCard);
        if (srcColors.length <= 1) return false; // monocolored or colorless — blocked
      } else {
        // No source info — assume monocolored (conservative protection)
        return false;
      }
    }
  }

  // Protection from colors: can't be targeted by sources of protected colors from opponents
  const protColors = getProtectionColors(card);
  if (protColors.length > 0 && sourceCard) {
    const controller = gameState ? findCardController(gameState, card) : null;
    if (controller !== null && controller !== byPlayerId) {
      const srcColors = getCardColors(sourceCard);
      if (srcColors.some(c => protColors.includes(c))) return false;
    }
  }

  return true;
}

// ============================================
// Vivid Colors (needs game state)
// ============================================

const COLOR_NAME_MAP: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function getProtectionColors(card: GameCard): string[] {
  const kws: string[] = (card.keywords || []).concat((card as any)._tempKeywords || []).concat((card as any)._grantedKeywords || []);
  const colors: string[] = [];
  for (const kw of kws) {
    if (typeof kw !== 'string') continue;
    // Format: "protection from white" / "protection from blue" etc.
    const m = kw.match(/^protection from (\w+)$/i);
    if (m && COLOR_NAME_MAP[m[1].toLowerCase()]) {
      colors.push(COLOR_NAME_MAP[m[1].toLowerCase()]);
      continue;
    }
    // Format: "protection_from_W" (temporary, from Éowyn effect)
    const m2 = kw.match(/^protection_from_([WUBRG])$/);
    if (m2) { colors.push(m2[1]); continue; }
  }
  return [...new Set(colors)];
}

export function countVividColors(state: EngineGameState, playerId: number): number {
  const bf = state.players[playerId].zones.battlefield;
  const colors = new Set<string>();
  bf.cards.forEach((c: GameCard) => {
    const cardColors = (c as any).colors || (c as any).color_identity || [];
    cardColors.forEach((clr: string) => colors.add(clr));
  });
  return colors.size;
}
