// @ts-nocheck
// game-ai-part1.ts — First half of AI module (lines 1-1500 of legacy game-ai.js)

import * as Cards from './cards';
import * as Mana from './mana';
import * as Combat from './combat';
import * as CombatSim from './combat-sim';
import * as CardUtils from './card-utils';
import { CardEffectsDB } from './card-effects';
import * as GameState from './game-state';
import * as GameAIPart2 from './game-ai-part2';

// Legacy name aliases
const CardEngine = { ...Cards, ...CardUtils };
const ManaSystem = Mana;
const CombatSystem = Combat;

// ---------------------------------------------------------------------------
// Internal helpers (not exported — treated as private)
// ---------------------------------------------------------------------------

function _getColorNeeds(hand: any[]): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const card of hand) {
    const cost = card.mana_cost || '';
    const matches = cost.match(/\{([WUBRG])\}/g) || [];
    for (const m of matches) {
      const color = m[1];
      needs[color] = (needs[color] || 0) + 1;
    }
  }
  return needs;
}

export function _getAbilityManaCost(ability: any): { manaCost: string; cmc: number } {
  const cost = ability.cost;
  if (!cost || cost.mana === undefined || cost.mana === null || cost.mana === 0) {
    return { manaCost: '', cmc: 0 };
  }
  if (typeof cost.mana === 'number') return { manaCost: `{${cost.mana}}`, cmc: cost.mana };
  const str = String(cost.mana);
  let manaCost = '';
  let cmc = 0;
  let i = 0;
  while (i < str.length) {
    if (/\d/.test(str[i])) {
      let num = '';
      while (i < str.length && /\d/.test(str[i])) { num += str[i]; i++; }
      manaCost += `{${num}}`;
      cmc += parseInt(num);
    } else if (/[WUBRGCXS]/i.test(str[i])) {
      manaCost += `{${str[i].toUpperCase()}}`;
      if (str[i].toUpperCase() !== 'X') cmc += 1;
      i++;
    } else { i++; }
  }
  return { manaCost, cmc };
}

export function _evaluateBoard(state: any, playerId: number): number {
  const oppId = playerId === 0 ? 1 : 0;
  const myLife = state.players[playerId].life;
  const oppLife = state.players[oppId].life;
  const myBf = state.players[playerId].zones.battlefield;
  const oppBf = state.players[oppId].zones.battlefield;
  const myCreatures = myBf.cards.filter((c: any) => CardEngine.isCreature(c));
  const oppCreatures = oppBf.cards.filter((c: any) => CardEngine.isCreature(c));

  let score = 0;

  // Life advantage (max ~10 points)
  score += (myLife - oppLife) * 0.5;

  // Board power advantage
  const myPower = myCreatures.reduce((s: number, c: any) => s + CardEngine.getPower(c), 0);
  const oppPower = oppCreatures.reduce((s: number, c: any) => s + CardEngine.getPower(c), 0);
  score += (myPower - oppPower) * 2;

  // Board toughness (resilience)
  const myTough = myCreatures.reduce((s: number, c: any) => s + CardEngine.getToughness(c), 0);
  const oppTough = oppCreatures.reduce((s: number, c: any) => s + CardEngine.getToughness(c), 0);
  score += (myTough - oppTough) * 0.5;

  // Creature count
  score += (myCreatures.length - oppCreatures.length) * 3;

  // Evasion advantage
  const countEvasion = (creatures: any[]) => creatures.filter((c: any) =>
    CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace')
  ).length;
  score += (countEvasion(myCreatures) - countEvasion(oppCreatures)) * 4;

  // Card advantage
  const myHand = state.players[playerId].zones.hand.count();
  const oppHand = state.players[oppId].zones.hand.count();
  score += (myHand - oppHand) * 1.5;

  // Keyword quality — context-sensitive scoring
  const lowLife = myLife <= 8;
  const oppLowLife = oppLife <= 8;
  const _keywordScore = (c: any, sign: number) => {
    let s = 0;
    if (CardEngine.hasKeyword(c, 'Deathtouch')) s += 2;
    if (CardEngine.hasKeyword(c, 'First Strike') || CardEngine.hasKeyword(c, 'Double Strike')) s += 2;
    if (CardEngine.hasKeyword(c, 'Lifelink')) s += lowLife ? 3 : 1;
    if (CardEngine.hasKeyword(c, 'Trample')) s += oppLowLife ? 2 : 1;
    if (CardEngine.hasIndestructible(c)) s += 4;
    if (CardEngine.hasKeyword(c, 'Vigilance')) s += 1;
    if (CardEngine.hasKeyword(c, 'Reach')) s += 1;
    if (c._anthem) s += 3;
    if (c._triggers && c._triggers.length > 0) s += 1;
    const abilities = CardEngine.getActivatedAbilities(c);
    if (abilities.length > 0) s += 1;
    return s * sign;
  };
  for (const c of myCreatures) score += _keywordScore(c, 1);
  for (const c of oppCreatures) score += _keywordScore(c, -1);

  // Mana advantage
  const myLands = state.players[playerId].zones.battlefield.cards.filter((c: any) => CardEngine.isLand(c));
  const oppLands = state.players[oppId].zones.battlefield.cards.filter((c: any) => CardEngine.isLand(c));
  const myUntappedLands = myLands.filter((c: any) => !c._tapped).length;
  const oppUntappedLands = oppLands.filter((c: any) => !c._tapped).length;
  score += (myUntappedLands - oppUntappedLands) * 0.5;

  return Math.max(-100, Math.min(100, score));
}

export function _creatureValue(card: any): number {
  let val = CardEngine.getPower(card) + CardEngine.getToughness(card);
  if (CardEngine.hasKeyword(card, 'Flying')) val += 3;
  if (CardEngine.hasKeyword(card, 'Deathtouch')) val += 3;
  if (CardEngine.hasKeyword(card, 'First Strike') || CardEngine.hasKeyword(card, 'Double Strike')) val += 2;
  if (CardEngine.hasKeyword(card, 'Lifelink')) val += 2;
  if (CardEngine.hasKeyword(card, 'Trample')) val += 1;
  if (CardEngine.hasKeyword(card, 'Menace')) val += 1;
  if (CardEngine.hasIndestructible(card)) val += 6;
  if (CardEngine.hasKeyword(card, 'Vigilance')) val += 1;
  if (CardEngine.hasKeyword(card, 'Haste')) val += 1;
  if (CardEngine.hasKeyword(card, 'Hexproof')) val += 2;
  if (card._isToken) val -= 2;
  const cmc = card.cmc || 0;
  val += Math.min(cmc, 6) * 0.5;
  const abilities = CardEngine.getActivatedAbilities(card);
  for (const ab of abilities) {
    const effs = ab.effects || [];
    if (effs.some((e: any) => e.type === 'draw')) val += 4;
    else if (effs.some((e: any) => e.type === 'damage' || e.type === 'destroy')) val += 3;
    else if (effs.some((e: any) => e.type === 'create_token')) val += 3;
    else if (effs.some((e: any) => e.type === 'counter_self' || e.type === 'buff')) val += 2;
    else val += 1;
  }
  if (card._triggers) {
    for (const trig of card._triggers) {
      if (!trig) continue;
      const effs = trig.effects || [];
      if (effs.some((e: any) => e.type === 'draw')) val += 3;
      else if (effs.some((e: any) => e.type === 'damage' || e.type === 'destroy')) val += 2;
      else if (effs.some((e: any) => e.type === 'create_token')) val += 2;
      else val += 1;
    }
  }
  if (card._anthem) val += 4;
  if (card._attachments && card._attachments.length > 0) {
    val += card._attachments.length * 2;
  }
  return val;
}

export function _threatScore(card: any): number {
  let score = 0;
  const power = CardEngine.getPower(card);
  const toughness = CardEngine.getToughness(card);

  score += power * 1.5;
  score += toughness * 0.5;

  if (CardEngine.hasKeyword(card, 'Flying')) score += 4;
  if (CardEngine.hasKeyword(card, 'Menace')) score += 2;
  if (CardEngine.hasKeyword(card, 'Trample')) score += 2;
  if (CardEngine.hasKeyword(card, 'Deathtouch')) score += 3;
  if (CardEngine.hasKeyword(card, 'Lifelink')) score += 3;
  if (CardEngine.hasKeyword(card, 'Double Strike')) score += 5;
  if (CardEngine.hasKeyword(card, 'First Strike')) score += 1;
  if (CardEngine.hasIndestructible(card)) score += 4;
  if (CardEngine.hasKeyword(card, 'Haste')) score += 1;

  const abilities = CardEngine.getActivatedAbilities(card);
  for (const ab of abilities) {
    const effects = ab.effects || [];
    for (const eff of effects) {
      if (eff.type === 'draw') score += 5;
      if (eff.type === 'damage') score += 3;
      if (eff.type === 'create_token') score += 4;
      if (eff.type === 'counter' && eff.counter === '+1/+1') score += 3;
      if (eff.type === 'buff') score += 2;
      if (eff.type === 'destroy' || eff.type === 'exile') score += 4;
    }
  }

  if (card._triggers && card._triggers.length > 0) {
    score += card._triggers.length * 2;
  }

  if (card.rarity === 'mythic') score += 4;
  else if (card.rarity === 'rare') score += 2;

  const cmc = card.cmc || 0;
  score += Math.min(cmc, 6) * 0.5;

  if (card._anthem) score += 5;
  if (card._attachments && card._attachments.length > 0) score += 3;
  if (CardEngine.isPlaneswalker && CardEngine.isPlaneswalker(card)) score += 8;
  if (card._isToken) score -= 3;

  return score;
}

function _chooseTargets(state: any, playerId: number, card: any, effects?: any[]): any[] {
  return GameAIPart2._chooseTargets(state, playerId, card, effects);
}

function _findBestSpellOrder(state: any, playerId: number): any {
  return GameAIPart2._findBestSpellOrder(state, playerId);
}

// ---------------------------------------------------------------------------
// Exported AI entry points
// ---------------------------------------------------------------------------

export function playMainPhase(state: any, playerId: number): void {
  console.log(`\n${'▓'.repeat(60)}`);
  console.log(`[🎮 AI MAIN PHASE] Player ${playerId} starting main phase`);
  console.log(`${'▓'.repeat(60)}\n`);
  const player = state.players[playerId];
  const hand = player.zones.hand;
  const bf = player.zones.battlefield;
  const opponentId = playerId === 0 ? 1 : 0;

  // 1. Play a land if possible (from hand or exiled playable)
  const handLands = hand.getAll().filter((c: any) => CardEngine.isLand(c));
  const exiledLands = (state._exiledPlayable
    ? Object.values(state._exiledPlayable).filter((e: any) => e.controller === playerId && CardEngine.isLand(e.card)).map((e: any) => e.card)
    : []);
  const lands = [...handLands, ...exiledLands];
  if (lands.length > 0 && !state.landPlayedThisTurn) {
    const colorNeeds = _getColorNeeds(hand.getAll());
    let bestLand = lands[0];
    let bestScore = -1;
    for (const land of lands) {
      const color = ManaSystem.getLandManaColor(land);
      const score = colorNeeds[color] || 0;
      if (score > bestScore) {
        bestScore = score;
        bestLand = land;
      }
    }
    GameState.playLand(state, playerId, bestLand._uid);
  }

  // 2. Cast spells strategically
  let playedSomething = true;
  while (playedSomething) {
    playedSomething = false;
    const playable = GameState.getPlayableCards(state, playerId)
      .filter((c: any) => !CardEngine.isLand(c));

    console.log(`[AI SPELL CASTING] Player ${playerId}: ${playable.length} playable spells`);
    if (playable.length === 0) {
      console.log(`[AI SPELL CASTING] No more playable spells, ending main phase`);
      break;
    }

    const landCount = bf.cards.filter((c: any) => CardEngine.isLand(c)).length;
    const opponentCreatures = state.players[opponentId].zones.battlefield.cards
      .filter((c: any) => CardEngine.isCreature(c));
    const myCreatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));
    const opponentLife = state.players[opponentId].life;
    const myLife = state.players[playerId].life;
    const myHandSize = hand.getAll().length;

    // Check for instants worth holding mana for
    const instantsInHand = hand.getAll().filter((c: any) => {
      const tl = (c.type_line || '').toLowerCase();
      return tl.includes('instant') || CardEngine.hasKeyword(c, 'Flash');
    });
    const cheapestInstantCost = instantsInHand.length > 0
      ? Math.min(...instantsInHand.map((c: any) => c.cmc || 1))
      : 99;
    const hasValuableInstant = instantsInHand.some((c: any) => {
      const effs = CardEngine.getSpellEffects(c);
      return effs.some((e: any) => e.type === 'buff' || e.type === 'destroy' || e.type === 'exile' || e.type === 'damage' || e.type === 'draw');
    });

    const scored = playable.map((card: any) => {
      let score = 0;
      const effects = CardEngine.getSpellEffects(card);
      const cmc = card.cmc || 0;

      // Base: prefer playing bigger spells when we can (on curve)
      score += Math.min(cmc, 5);

      // === RAMP ===
      if (effects.some((e: any) => e.type === 'ramp')) {
        const oppBoardPower = opponentCreatures.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);
        if (oppBoardPower >= myLife * 0.7) {
          score += 1;
        } else if (landCount <= 3) score += 15;
        else if (landCount <= 5) score += 8;
        else score += 2;
      }

      // === REMOVAL ===
      if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage' || e.type === 'debuff')) {
        const targetable = opponentCreatures.filter((c: any) => CardEngine.canBeTargeted(c, playerId));
        if (targetable.length > 0) {
          const biggestThreatScore = Math.max(...targetable.map((c: any) => _threatScore(c)), 0);
          const boardScore = _evaluateBoard(state, playerId);
          score += 6 + biggestThreatScore * 0.8;
          if (myCreatures.length === 0 && opponentCreatures.length > 0) score += 5;
          const totalOppPower = targetable.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);
          if (totalOppPower >= myLife) score += 8;
          const isPremiumRemoval = effects.some((e: any) => e.type === 'destroy' || e.type === 'exile');
          if (isPremiumRemoval && biggestThreatScore < 4 && boardScore > 0 && totalOppPower < myLife * 0.6) {
            score -= 6;
          }
          if (isPremiumRemoval && landCount <= 4 && biggestThreatScore < 5 && boardScore >= 0) {
            score -= 3;
          }
          if (boardScore > 20) score -= 4;
        } else if (opponentCreatures.length > 0) {
          score -= 5;
        } else {
          score -= 50;
        }
      }

      // === BOARD WIPES ===
      if (effects.some((e: any) => e.type === 'destroy_all' || e.type === 'damage_all_creatures' || e.type === 'exile_all')) {
        const oppBoardPower = opponentCreatures.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);
        const myBoardPower = myCreatures.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);
        if (opponentCreatures.length >= myCreatures.length + 2) score += 20;
        else if (oppBoardPower > myBoardPower * 1.5) score += 15;
        else if (opponentCreatures.length > myCreatures.length) score += 8;
        else score -= 8;
      }

      // === CREATURES ===
      if (CardEngine.isCreature(card)) {
        const boardScore = _evaluateBoard(state, playerId);
        if (myCreatures.length === 0) score += 10;
        else if (boardScore < -5) score += 8;
        else if (boardScore > 15) score += 5;
        else score += 7;

        if (cmc <= landCount && cmc >= landCount - 1) score += 3;
        if (cmc === 2 && landCount === 2) score += 4;

        const cardPow = CardEngine.getPower(card);
        const cardTough = CardEngine.getToughness(card);
        if (cardPow >= 3) score += 1;
        if (cardPow >= 5) score += 2;
        if (cardTough >= 4) score += 1;

        if (CardEngine.hasKeyword(card, 'Flying')) score += 2;
        if (CardEngine.hasKeyword(card, 'Haste')) score += 2;
        if (CardEngine.hasKeyword(card, 'Deathtouch')) score += 1;
        if (CardEngine.hasKeyword(card, 'Lifelink') && myLife < 10) score += 3;
        if (CardEngine.hasKeyword(card, 'Vigilance')) score += 1;
        if (CardEngine.hasKeyword(card, 'Trample') && cardPow >= 4) score += 1;

        const etbEffects = CardEngine.getETBEffects(card);
        for (const etb of etbEffects) {
          if (etb.type === 'destroy' || etb.type === 'exile') {
            if (opponentCreatures.length > 0) score += 8;
            else score += 1;
          } else if (etb.type === 'debuff') {
            if (opponentCreatures.length > 0) score += 6;
            else score += 0;
          } else if (etb.type === 'draw') score += 3 * (etb.amount || 1);
          else if (etb.type === 'create_token') score += 3 * (etb.count || 1);
          else if (etb.type === 'bounce') {
            if (opponentCreatures.length > 0) score += 5;
            else score += 1;
          } else if (etb.type === 'gainLife') score += 1;
          else if (etb.type === 'fight') {
            if (myCreatures.length > 0 && opponentCreatures.length > 0) score += 5;
            else score += 1;
          } else if (etb.type === 'damage') {
            if (opponentCreatures.length > 0) score += 3;
            else score += 0;
          } else if (etb.type === 'ramp') score += 4;
        }

        if (state._triggers) {
          for (const trig of state._triggers) {
            if (trig.playerId !== playerId) continue;
            if (trig.event === 'dragon_enters' && CardEngine.hasCreatureType(card, 'Dragon')) {
              score += 4;
            }
            if (trig.event === 'creature_etb' || trig.event === 'other_creature_enters') {
              score += 2;
            }
          }
        }
        const myBfCards = bf.cards;
        for (const bfCard of myBfCards) {
          if (bfCard._anthem) score += 2;
        }
      }

      // === AURAS ===
      if (CardEngine.isAura(card)) {
        if (myCreatures.length > 0) {
          score += 5;
          if (myCreatures.some((c: any) => CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace'))) {
            score += 3;
          }
          if (opponentCreatures.length > 0) {
            const oppHasRemoval = state.players[opponentId].zones.hand.count() >= 2;
            if (oppHasRemoval) score -= 2;
          }
          if (myCreatures.some((c: any) => CardEngine.hasKeyword(c, 'Hexproof') || CardEngine.hasKeyword(c, 'Indestructible'))) {
            score += 4;
          }
        } else {
          score -= 15;
        }
      }

      // === PLANESWALKERS ===
      if (CardEngine.isPlaneswalker(card)) {
        score += 8;
        if (opponentCreatures.length >= 3) score -= 3;
      }

      // === EQUIPMENT ===
      if (CardEngine.isEquipment(card)) {
        if (myCreatures.length > 0) score += 4;
        else score += 1;
      }

      // === CARD DRAW ===
      if (effects.some((e: any) => e.type === 'draw')) {
        const drawAmt = effects.find((e: any) => e.type === 'draw')?.amount || 1;
        score += 2 + drawAmt * 2;
        if (myHandSize <= 2) score += 4;
        if (CardEngine.isCreature(card)) score += 3;
      }

      // === TOKEN CREATION ===
      if (effects.some((e: any) => e.type === 'create_token')) {
        score += 4;
        if (myCreatures.length === 0) score += 3;
      }

      // === COUNTERS ===
      if (effects.some((e: any) => e.type === 'counter' || e.type === 'counter_all')) {
        if (myCreatures.length > 0) score += 4;
        if (myCreatures.length >= 3) score += 2;
      }

      // === INSTANTS: Strongly prefer holding ===
      if ((card.type_line || '').toLowerCase().includes('instant')) {
        const isRemoval = effects.some((e: any) => e.type === 'destroy' || e.type === 'exile');
        const isBuff = effects.some((e: any) => e.type === 'buff');
        if (isBuff) {
          score -= 15;
        } else if (isRemoval && state.phase === 'main1') {
          score -= 0;
        } else {
          score -= 10;
        }
      }

      // === DISCARD ===
      if (effects.some((e: any) => e.type === 'discard' && e.target === 'opponent')) score += 3;

      // === SCRY/SURVEIL ===
      if (effects.some((e: any) => e.type === 'scry' || e.type === 'surveil')) score += 2;

      // === DRAIN ===
      if (effects.some((e: any) => e.type === 'drain')) score += 5;

      // === LOOT ===
      if (effects.some((e: any) => e.type === 'loot')) {
        score += 3;
        if (myHandSize <= 2) score += 3;
      }

      // === LOOK_TOP ===
      if (effects.some((e: any) => e.type === 'look_top')) score += 3;

      // === GRANT / GRANT_ALL ===
      if (effects.some((e: any) => e.type === 'grant' || e.type === 'grant_all')) {
        if (myCreatures.length > 0) score += 3;
      }

      // === EXILE_TOP_PLAY ===
      if (effects.some((e: any) => e.type === 'exile_top_play')) score += 5;

      // === SEARCH_LIBRARY ===
      if (effects.some((e: any) => e.type === 'search_library')) score += 6;

      // === GAIN_CONTROL ===
      if (effects.some((e: any) => e.type === 'gain_control')) {
        if (opponentCreatures.length > 0) score += 12;
        else score -= 5;
      }

      // === DISTRIBUTE/GRANT COUNTERS ===
      if (effects.some((e: any) => e.type === 'distribute_counters' || e.type === 'grant_counter' || e.type === 'grant_counters')) {
        if (myCreatures.length > 0) score += 4;
      }

      // === EXTRA COMBAT ===
      if (effects.some((e: any) => e.type === 'extra_combat')) {
        if (myCreatures.length >= 2) score += 8;
        else score += 1;
      }

      // === COPY SPELL ===
      if (effects.some((e: any) => e.type === 'copy_spell' || e.type === 'copy_next_spell')) score += 4;

      // === ANTHEM ===
      if (effects.some((e: any) => e.type === 'anthem')) {
        score += 3 + myCreatures.length * 2;
      }

      // === BOUNCE_TO_LIBRARY_TOP ===
      if (effects.some((e: any) => e.type === 'bounce_to_library_top')) {
        if (opponentCreatures.length > 0) score += 7;
      }

      // === UNTAP_ALL ===
      if (effects.some((e: any) => e.type === 'untap_all')) score += 3;

      // === FIGHT ===
      if (effects.some((e: any) => e.type === 'fight')) {
        const targetableOpp = opponentCreatures.filter((c: any) => CardEngine.canBeTargeted(c, playerId));
        if (myCreatures.length > 0 && targetableOpp.length > 0) {
          const bestMyPower = Math.max(...myCreatures.map((c: any) => CardEngine.getPower(c)));
          const weakestOppTough = Math.min(...targetableOpp.map((c: any) => CardEngine.getToughness(c)));
          if (bestMyPower >= weakestOppTough) score += 8;
          else score -= 3;
        } else {
          score -= 5;
        }
      }

      // === BOUNCE ===
      if (effects.some((e: any) => e.type === 'bounce')) {
        const targetable = opponentCreatures.filter((c: any) => CardEngine.canBeTargeted(c, playerId));
        if (targetable.length > 0) {
          const biggestCmc = Math.max(...targetable.map((c: any) => c.cmc || 0), 0);
          score += 4 + biggestCmc;
        }
      }

      // === TAP ===
      if (effects.some((e: any) => e.type === 'tap')) {
        const targetable = opponentCreatures.filter((c: any) => CardEngine.canBeTargeted(c, playerId) && !c._tapped);
        if (targetable.length > 0) score += 3;
      }

      // === EFFICIENCY ===
      const availableMana = bf.cards.filter((c: any) => CardEngine.isLand(c) && !c._tapped).length
        + ManaSystem.poolTotal(state.manaPool[playerId]);
      if (cmc === availableMana) score += 2;
      if (cmc <= availableMana && cmc >= availableMana - 1) score += 1;

      // === MANA HOLD ===
      if (hasValuableInstant && cmc > 0) {
        const manaAfterCast = availableMana - cmc;
        if (manaAfterCast < cheapestInstantCost && score < 15) {
          const hasCombatTrick = instantsInHand.some((c: any) => {
            const effs = CardEngine.getSpellEffects(c);
            return effs.some((e: any) => e.type === 'buff');
          });
          const hasInstantRemoval = instantsInHand.some((c: any) => {
            const effs = CardEngine.getSpellEffects(c);
            return effs.some((e: any) => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage');
          });
          if (state.phase === 'main1' && hasCombatTrick && myCreatures.length > 0) {
            score -= 8;
          } else if (state.phase === 'main1' && hasInstantRemoval) {
            score -= 5;
          } else {
            score -= 4;
          }
        }
      }

      // === PRE-COMBAT REMOVAL ===
      if (state.phase === 'main1' && effects.some((e: any) => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage')) {
        const myAttackers = myCreatures.filter((c: any) => CardEngine.canAttack(c));
        if (myAttackers.length > 0 && opponentCreatures.length > 0) {
          score += 4;
        }
      }

      return { card, score };
    }).sort((a: any, b: any) => b.score - a.score);

    if (scored.length > 0) {
      let card = scored[0].card;
      if (typeof CombatSim !== 'undefined' && scored.length >= 2) {
        const simBest = _findBestSpellOrder(state, playerId);
        if (simBest && simBest._uid !== card._uid) {
          const inPlayable = scored.find((s: any) => s.card._uid === simBest._uid);
          if (inPlayable) {
            card = simBest;
          }
        }
      }

      if (CardEngine.isAura(card)) {
        const myCreaturesNow = bf.cards.filter((c: any) => CardEngine.isCreature(c));
        if (myCreaturesNow.length === 0) break;
      }

      const { cmc: reducedCmc } = GameState.getEffectiveCmcWithReduction(state, playerId, card);

      let useEvoke = false;
      if (!ManaSystem.canAfford(state, playerId, card, null, reducedCmc)) {
        let affordWithConvoke = false;
        if (CardEngine.hasConvoke(card)) {
          const convokeContrib = ManaSystem.getConvokeContribution(state, playerId);
          if (convokeContrib.count > 0) {
            const lc = bf.cards.filter((c: any) => CardEngine.isLand(c) && !c._tapped).length;
            const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
            const totalWithConvoke = lc + poolTotal + convokeContrib.count;
            if (totalWithConvoke >= reducedCmc) {
              const augmented = ManaSystem.getAvailableMana(state, playerId);
              Object.keys(convokeContrib.colors).forEach((clr: string) => {
                augmented[clr] = (augmented[clr] || 0) + convokeContrib.colors[clr];
              });
              affordWithConvoke = ManaSystem.canPay(augmented, card.mana_cost, reducedCmc);
            }
          }
        }
        if (!affordWithConvoke) {
          const evokeCost = CardEngine.getEvokeCost(card);
          if (evokeCost) {
            const evokeCmc = ManaSystem.parseCost(evokeCost).total || 0;
            const tempCard = { mana_cost: evokeCost, cmc: evokeCmc };
            if (ManaSystem.canAfford(state, playerId, tempCard)) {
              useEvoke = true;
            } else {
              break;
            }
          } else {
            break;
          }
        }
      }

      // Handle additional costs
      const addCosts = CardEngine.getAdditionalCosts(card);
      let skipCard = false;
      for (const ac of addCosts) {
        if (ac.type === 'sacrifice') {
          const bfZone = state.players[playerId].zones.battlefield;
          let candidates: any[] = [];
          if (ac.target === 'creature') candidates = bfZone.cards.filter((c: any) => CardEngine.isCreature(c));
          else if (ac.target === 'land') candidates = bfZone.cards.filter((c: any) => CardEngine.isLand(c));
          else if (ac.target === 'artifact') candidates = bfZone.cards.filter((c: any) => CardEngine.isArtifact(c));
          else candidates = [...bfZone.cards];
          if (candidates.length === 0) { skipCard = true; break; }
          candidates.sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));
          GameState.sacrifice(state, playerId, candidates[0]._uid);
          state.log.push(`Oponente sacrifica ${candidates[0].name} como custo.`);
        }
        if (ac.type === 'discard') {
          const handZone = state.players[playerId].zones.hand;
          if (handZone.count() <= (ac.amount || 1)) { skipCard = true; break; }
          const discardable = handZone.getAll().filter((c: any) => c._uid !== card._uid)
            .sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));
          for (let di = 0; di < (ac.amount || 1) && di < discardable.length; di++) {
            const d = handZone.remove(discardable[di]._uid);
            if (d) {
              state.players[playerId].zones.graveyard.add(d);
              state.log.push(`Oponente descarta ${d.name} como custo.`);
            }
          }
        }
        if (ac.type === 'tap_creature') {
          const untapped = state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c) && !c._tapped)
            .sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));
          if (untapped.length === 0) { skipCard = true; break; }
          untapped[0]._tapped = true;
          state.log.push(`Oponente vira ${untapped[0].name} como custo.`);
        }
      }
      if (skipCard) break;

      let castCost = useEvoke ? CardEngine.getEvokeCost(card) : card.mana_cost;
      const parsedCastCost = ManaSystem.parseCost(castCost);
      let castCmc = useEvoke
        ? (parsedCastCost.total || 0)
        : ((parsedCastCost.hybrids && parsedCastCost.hybrids.length > 0) ? parsedCastCost.total : card.cmc);

      if (!useEvoke) {
        const aiBf = state.players[playerId].zones.battlefield;
        for (const bfCard of aiBf.cards) {
          if (!bfCard._costReduction) continue;
          const cr = bfCard._costReduction;
          if (cr.target === 'dragon_spells' && CardEngine.hasCreatureType(card, 'Dragon')) {
            if (cr.reduction === 'free') { castCmc = 0; castCost = ''; }
            else { castCmc = Math.max(0, castCmc - (cr.reduction || 0)); }
          }
          if (cr.target === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
            castCmc = Math.max(0, castCmc - (cr.reduction || 0));
          }
          if (cr.target === 'creature_spells' && CardEngine.isCreature(card)) {
            castCmc = Math.max(0, castCmc - (cr.reduction || 0));
          }
          if (cr.target === 'spells' && cr.condition === 'per_power4_creature') {
            const p4count = aiBf.cards.filter((c: any) => CardEngine.isCreature(c) && CardEngine.getPower(c) >= 4).length;
            if (p4count > 0) castCmc = Math.max(0, castCmc - (cr.reduction || 0) * p4count);
          }
        }
        const aiDbEntry = typeof CardEffectsDB !== 'undefined' && CardEffectsDB[card.name?.toLowerCase()];
        if (aiDbEntry && aiDbEntry.self_cost_reduction) {
          const scr = aiDbEntry.self_cost_reduction;
          if (scr.condition === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
            castCmc = Math.max(0, castCmc - (scr.amount || 0));
          }
        }
      }

      GameState.autoTapForSpell(state, playerId, castCost, castCmc, card);
      const targets = _chooseTargets(state, playerId, card);

      if (targets && targets.length > 0) {
        for (const target of targets) {
          if (target.player === 0) {
            GameState.fireTrigger(state, 'creature_targeted_by_opponent', { playerId: 0 });
          }
        }
      }

      const result = GameState.castSpell(state, playerId, card._uid, targets, false, useEvoke);
      if (result.success) {
        if (!state._aiActions) state._aiActions = [];
        let targetDesc = '';
        if (targets && targets.length > 0) {
          const tgt = targets[0];
          const tgtCard = state.players[tgt.player].zones.battlefield.get(tgt.uid);
          if (tgtCard) targetDesc = ` em ${tgtCard.name}`;
        }
        const evokeLabel = useEvoke ? ' (Evocado)' : '';
        state._aiActions.push({
          type: 'cast',
          card: { name: card.name, image_normal: card.image_normal, image_small: card.image_small, type_line: card.type_line, mana_cost: card.mana_cost },
          description: `Oponente joga ${card.name}${targetDesc}${evokeLabel}`,
          targetDesc
        });
        playedSomething = true;
        if (result.pendingStack) break;
      } else {
        break;
      }
    }
  }

  // 3. Try to equip unattached equipment
  _tryEquipment(state, playerId);

  // 4. Try to activate abilities
  _tryActivatedAbilities(state, playerId);

  // 4b. Try to activate planeswalker loyalty abilities
  _tryLoyaltyAbilities(state, playerId);

  // 5. Try to activate graveyard abilities (Renew)
  _tryGraveyardAbilities(state, playerId);

  // 6. Try harmonize (cast from graveyard)
  _tryHarmonize(state, playerId);

  // 7. Try to activate hideaway lands
  _tryHideaway(state, playerId);

  // 8. Try to transform DFC creatures
  _tryTransform(state, playerId);
}

function _tryEquipment(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const equipment = bf.cards.filter((c: any) => CardEngine.isEquipment(c) && !c._attachedTo);
  const creatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));

  if (equipment.length === 0 || creatures.length === 0) return;

  for (const equip of equipment) {
    const effects = CardEngine.parseEquipmentEffects(equip);
    const costEffect = effects.find((e: any) => e.type === 'equip_cost');
    const manaCost = costEffect ? costEffect.cost : '{3}';
    const parsedCost = ManaSystem.parseCost(manaCost);
    const cmc = parsedCost.total;

    const fakeCard = { mana_cost: manaCost, cmc };
    if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;

    const sorted = creatures
      .filter((c: any) => !(c._attachments || []).includes(equip._uid))
      .sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));

    if (sorted.length > 0) {
      GameState.autoTapForSpell(state, playerId, manaCost, cmc);
      state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
      GameState.equipCreature(state, playerId, equip._uid, sorted[0]._uid);
    }
  }
}

function _tryActivatedAbilities(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const creatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));

  for (const creature of creatures) {
    const abilities = CardEngine.getActivatedAbilities(creature);
    if (abilities.length === 0) continue;

    for (const ability of abilities) {
      if (ability.cost.tap && creature._tapped) continue;

      const { manaCost, cmc } = _getAbilityManaCost(ability);
      if (cmc > 0) {
        const fakeCard = { mana_cost: manaCost, cmc };
        if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;
      }

      if (ability.cost.removeCounter) {
        if (!creature._counters || (creature._counters[ability.cost.removeCounter] || 0) <= 0) continue;
      }
      if (ability.cost.blight) {
        const hasCreature = state.players[playerId].zones.battlefield.cards.some((c: any) => CardEngine.isCreature(c));
        if (!hasCreature) continue;
      }
      if (ability.cost.once_per_turn) {
        if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
        const key = creature._uid + '_' + JSON.stringify(ability.effects.map((e: any) => e.type));
        if (state._abilityUsedThisTurn[key]) continue;
      }
      if (ability.cost.sacrifice_creature) {
        const otherCreatures = state.players[playerId].zones.battlefield.cards.filter((c: any) =>
          CardEngine.isCreature(c) && c._uid !== creature._uid
        );
        if (otherCreatures.length === 0) continue;
      }
      if (ability.cost.sacrifice_token) {
        const tokens = state.players[playerId].zones.battlefield.cards.filter((c: any) =>
          CardEngine.isCreature(c) && c._isToken && c._uid !== creature._uid
        );
        if (tokens.length === 0) continue;
      }
      if (ability.cost.exile_gy_creature) {
        const gyCreatures = state.players[playerId].zones.graveyard.getAll().filter((c: any) => CardEngine.isCreature(c));
        if (gyCreatures.length === 0) continue;
      }
      if (ability.cost.discard_hand) {
        if (state.players[playerId].zones.hand.count() === 0) continue;
      }
      if (ability.cost.tap_creature) {
        const untappedCreatures = state.players[playerId].zones.battlefield.cards.filter((c: any) =>
          CardEngine.isCreature(c) && !c._tapped && c._uid !== creature._uid
        );
        if (untappedCreatures.length === 0) continue;
      }
      if (ability.cost.life) {
        const lifeCost = typeof ability.cost.life === 'number' ? ability.cost.life : 1;
        if (state.players[playerId].life <= lifeCost) continue;
      }
      if (ability.condition) {
        if (!GameState._checkEffectCondition(state, playerId, { condition: ability.condition })) continue;
      }

      let useful = false;
      for (const eff of ability.effects) {
        if (eff.type === 'draw') useful = true;
        if (eff.type === 'gainLife') useful = true;
        if (eff.type === 'damage') useful = true;
        if (eff.type === 'counter_self') useful = true;
        if (eff.type === 'create_token') useful = true;
        if (eff.type === 'buff_self') useful = true;
        if (eff.type === 'cant_block') useful = true;
        if (eff.type === 'buff_all') useful = true;
        if (eff.type === 'damage_each_opponent') useful = true;
        if (eff.type === 'drain') useful = true;
        if (eff.type === 'loot') useful = true;
        if (eff.type === 'look_top') useful = true;
        if (eff.type === 'grant') useful = true;
        if (eff.type === 'grant_all') useful = true;
        if (eff.type === 'exile_top_play') useful = true;
        if (eff.type === 'regenerate') useful = true;
        if (eff.type === 'bounce') useful = true;
        if (eff.type === 'untap_self') useful = true;
        if (eff.type === 'tap_target') useful = true;
        if (eff.type === 'mill') useful = true;
        if (eff.type === 'grant_counter') useful = true;
        if (eff.type === 'grant_counters') useful = true;
        if (eff.type === 'double_counters') useful = true;
      }
      if (!useful) continue;

      if (cmc > 0) {
        GameState.autoTapForSpell(state, playerId, manaCost, cmc);
        state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
      }
      if (ability.cost.tap) creature._tapped = true;
      if (ability.cost.removeCounter && creature._counters) {
        creature._counters[ability.cost.removeCounter] = (creature._counters[ability.cost.removeCounter] || 0) - 1;
      }
      if (ability.cost.once_per_turn) {
        if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
        const key = creature._uid + '_' + JSON.stringify(ability.effects.map((e: any) => e.type));
        state._abilityUsedThisTurn[key] = true;
      }
      if (ability.cost.sacrifice_creature) {
        const others = state.players[playerId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && c._uid !== creature._uid)
          .sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));
        if (others.length > 0) {
          const victim = others[0];
          GameState.creatureDies(state, victim, playerId);
          state.log.push(`Sacrifica ${victim.name} como custo.`);
        }
      }
      if (ability.cost.sacrifice_token) {
        const tokens = state.players[playerId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && c._isToken && c._uid !== creature._uid)
          .sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));
        if (tokens.length > 0) {
          GameState.creatureDies(state, tokens[0], playerId);
          state.log.push(`Sacrifica ${tokens[0].name} token como custo.`);
        }
      }
      if (ability.cost.exile_gy_creature) {
        const gyCreatures = state.players[playerId].zones.graveyard.getAll().filter((c: any) => CardEngine.isCreature(c));
        if (gyCreatures.length > 0) {
          const victim = gyCreatures.sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0))[0];
          state.players[playerId].zones.graveyard.remove(victim._uid);
          state.players[playerId].zones.exile.add(victim);
          state.log.push(`Exila ${victim.name} do cemiterio como custo.`);
        }
      }
      if (ability.cost.discard_hand) {
        const handZone = state.players[playerId].zones.hand;
        const cards = handZone.getAll();
        for (const c of cards) {
          handZone.remove(c._uid);
          state.players[playerId].zones.graveyard.add(c);
        }
        if (cards.length > 0) state.log.push(`Descarta mao (${cards.length} cartas) como custo.`);
      }
      if (ability.cost.tap_creature) {
        const untapped = state.players[playerId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && !c._tapped && c._uid !== creature._uid)
          .sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));
        if (untapped.length > 0) {
          untapped[0]._tapped = true;
          state.log.push(`Vira ${untapped[0].name} como custo.`);
        }
      }
      if (ability.cost.life) {
        const lifeCost = typeof ability.cost.life === 'number' ? ability.cost.life : 1;
        state.players[playerId].life -= lifeCost;
        state.log.push(`Paga ${lifeCost} vida como custo.`);
      }

      state.log.push(`${creature.name}: habilidade ativada!`);
      for (const effect of ability.effects) {
        const data: any = { cardUid: creature._uid, card: creature };
        if (ability.cost.zone) {
          data.fromZone = ability.cost.zone;
        }
        const result = GameState._resolveSimpleEffect(state, playerId, effect, data);
        if (result) state.log.push(result);
      }
    }
  }
}

function _tryLoyaltyAbilities(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const planeswalkers = bf.cards.filter((c: any) => CardEngine.isPlaneswalker(c) && !c._loyaltyUsedThisTurn);

  for (const pw of planeswalkers) {
    const abilities = CardEngine.getLoyaltyAbilities(pw);
    if (abilities.length === 0) continue;

    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      const loyaltyCost = ab.cost.loyalty;

      if (typeof loyaltyCost === 'number' && loyaltyCost < 0) {
        if ((pw._loyalty || 0) + loyaltyCost < 0) continue;
      }

      let score = 0;
      for (const eff of ab.effects) {
        if (eff.type === 'draw') score += 4 * (eff.amount || 1);
        if (eff.type === 'create_token') score += 3;
        if (eff.type === 'damage') score += 2 * (eff.amount || 1);
        if (eff.type === 'destroy') score += 5;
        if (eff.type === 'counter_all') score += 3;
        if (eff.type === 'gain_life' || eff.type === 'gainLife') score += 1;
        if (eff.type === 'discard') score += 3;
        if (eff.type === 'grant_all') score += 2;
        if (eff.type === 'untap') score += 2;
        if (eff.type === 'add_mana') score += 1;
        if (eff.type === 'exile') score += 4;
      }

      if (typeof loyaltyCost === 'number' && loyaltyCost > 0) score += 2;
      if (typeof loyaltyCost === 'number' && (pw._loyalty || 0) + loyaltyCost <= 0) score -= 10;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      GameState.activateLoyaltyAbility(state, playerId, pw._uid, bestIdx);
    }
  }
}

function _tryGraveyardAbilities(state: any, playerId: number): void {
  const gy = state.players[playerId].zones.graveyard;
  const cards = gy.getAll();

  for (const card of cards) {
    const abilities = CardEngine.getGraveyardAbilities(card);
    if (abilities.length === 0) continue;

    for (const ability of abilities) {
      if (ability.sorcerySpeed && state.phase !== 'main1' && state.phase !== 'main2') {
        continue;
      }
      if (ability.cost.mana) {
        const parsed = ManaSystem.parseCost(ManaSystem.formatManaCost(ability.cost.mana));
        const fakeCard = { mana_cost: ManaSystem.formatManaCost(ability.cost.mana), cmc: parsed.total || 0 };
        if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;

        GameState.autoTapForSpell(state, playerId, ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
        state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
      }

      state.log.push(`${card.name}: habilidade do cemiterio ativada!`);

      gy.remove(card._uid);
      if (ability.cost.exile) {
        if (state.players[playerId].zones.exile) {
          state.players[playerId].zones.exile.add(card);
        }
      }

      let sharedTargets: any[] | null = null;

      for (const effect of ability.effects) {
        let targets: any[] = [];

        if (effect.target === 'same' && sharedTargets) {
          targets = [...sharedTargets];
        } else if (effect.type === 'grant_counter' && effect.target === 'creature') {
          const allCreatures = state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId));
          if (allCreatures.length > 0) {
            let bestTarget = allCreatures.find((c: any) => !CardEngine.hasKeyword(c, 'Lifelink'));
            if (!bestTarget) bestTarget = allCreatures[0];
            targets.push({ type: 'creature', player: playerId, uid: bestTarget._uid });
            if (!sharedTargets) sharedTargets = [...targets];
          }
        } else if (effect.type === 'counter' && effect.target === 'creature') {
          const allCreatures = state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c));
          if (allCreatures.length > 0) {
            const bestTarget = allCreatures.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a))[0];
            targets.push({ type: 'creature', player: playerId, uid: bestTarget._uid });
            if (!sharedTargets) sharedTargets = [...targets];
          }
        }

        const result = GameState._resolveSimpleEffect(state, playerId, effect, { cardUid: card._uid, card, fromZone: 'graveyard', targets });
        if (result) state.log.push(result);
      }

      break; // One graveyard ability per card per turn
    }
  }
}

function _tryHarmonize(state: any, playerId: number): void {
  const harmonizable = GameState.getHarmonizableCards(state, playerId);
  if (harmonizable.length === 0) return;

  harmonizable.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));

  for (const card of harmonizable) {
    const bf = state.players[playerId].zones.battlefield;
    const tapCandidates = bf.cards.filter((c: any) =>
      CardEngine.isCreature(c) && !c._tapped && !c._summoningSick && CardEngine.getPower(c) > 0
    ).sort((a: any, b: any) => CardEngine.getPower(a) - CardEngine.getPower(b));

    let tappedUid: string | null = null;
    if (tapCandidates.length > 0) {
      tappedUid = tapCandidates[0]._uid;
    }

    const effects = CardEngine.getSpellEffects(card);
    const targets = _chooseTargets(state, playerId, card, effects);

    const result = GameState.castHarmonize(state, playerId, card._uid, targets, tappedUid);
    if (result.success) {
      if (!state._aiActions) state._aiActions = [];
      state._aiActions.push({
        type: 'harmonize',
        card: { name: card.name, image_normal: card.image_normal, image_small: card.image_small, type_line: card.type_line, mana_cost: card.mana_cost },
        description: `Oponente harmoniza ${card.name} do cemiterio`
      });
      break;
    }
  }
}

function _tryTransform(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const transformable = bf.cards.filter((c: any) =>
    CardEngine.isTransformCard(c) && CardEngine.isCreature(c)
  );

  for (const card of transformable) {
    const costStr = CardEngine.getTransformCost(card);
    if (!costStr) continue;
    const cost = ManaSystem.parseCost(costStr);
    if (!ManaSystem.canAfford(state, playerId, { mana_cost: costStr, cmc: cost.total })) continue;

    const back = card._transformed ? card._frontFaceData : (card._backFace || card.backFace);
    if (!back) continue;

    const currentPower = CardEngine.getPower(card);
    const currentToughness = CardEngine.getToughness(card);
    const backPower = parseInt(back.power) || 0;
    const backToughness = parseInt(back.toughness) || 0;

    const statDiff = (backPower + backToughness) - (currentPower + currentToughness);
    if (statDiff > 0) {
      const result = GameState.transformCreature(state, playerId, card._uid);
      if (result.success) {
        state.log.push(`IA transforma ${card.name}!`);
        break;
      }
    }
  }
}

function _tryHideaway(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const hideawayLands = bf.cards.filter((c: any) => c._hideaway && c._hideawayCard && !c._tapped);

  for (const land of hideawayLands) {
    if (GameState._checkHideawayCondition(state, playerId, land)) {
      const result = GameState.activateHideaway(state, playerId, land._uid);
      if (result.success) {
        state.log.push(`IA ativa hideaway de ${land.name}!`);
        break;
      }
    }
  }
}

export function declareAttackers(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const creatures = bf.cards.filter((c: any) => CardEngine.canAttack(c));
  const oppId = playerId === 0 ? 1 : 0;
  const opponentLife = state.players[oppId].life;
  const myLife = state.players[playerId].life;
  const opponentCreatures = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && !c._tapped);

  if (creatures.length === 0) return;

  const totalPower = creatures.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);

  // Phase 1: Lethal check
  if (totalPower >= opponentLife) {
    let guaranteedDamage = 0;
    for (const c of creatures) {
      const power = CardEngine.getPower(c);
      const isFlying = CardEngine.hasKeyword(c, 'Flying');
      const isMenace = CardEngine.hasKeyword(c, 'Menace');
      const hasTrample = CardEngine.hasKeyword(c, 'Trample');
      const validBlockers = opponentCreatures.filter((b: any) => CardEngine.canBlock(b, c, state));

      if (validBlockers.length === 0) {
        guaranteedDamage += power;
      } else if (isMenace && validBlockers.length < 2) {
        guaranteedDamage += power;
      } else if (hasTrample) {
        const bestTough = Math.max(...validBlockers.map((b: any) => CardEngine.getToughness(b)), 0);
        guaranteedDamage += Math.max(0, power - bestTough);
      }
    }
    if (guaranteedDamage >= opponentLife) {
      creatures.forEach((c: any) => CombatSystem.declareAttacker(state.combat, c));
      state.combat.attackers.forEach(({ card }: any) => {
        if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
          card._tapped = true;
          card._tappedByAttack = true;
        }
      });
      state.log.push(`Oponente ataca com tudo! (${creatures.length} criaturas)`);
      return;
    }
  }

  const boardScore = _evaluateBoard(state, playerId);

  const hand = state.players[playerId].zones.hand;
  const hasCombatTrick = hand.getAll().some((c: any) => {
    const tl = (c.type_line || '').toLowerCase();
    if (!tl.includes('instant')) return false;
    const effs = CardEngine.getSpellEffects(c);
    return effs.some((e: any) => e.type === 'buff');
  });

  // Phase 2: Calculate race
  let myEvasionPower = 0;
  for (const c of creatures) {
    const power = CardEngine.getPower(c);
    if (CardEngine.hasKeyword(c, 'Vigilance') || CardEngine.hasIndestructible(c)) {
      myEvasionPower += power;
    } else if (CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace')) {
      myEvasionPower += power;
    } else {
      const canBeBlocked = opponentCreatures.some((b: any) => CardEngine.canBlock(b, c, state));
      if (!canBeBlocked) myEvasionPower += power;
    }
  }
  const oppAttackPower = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canAttack(c))
    .reduce((s: number, c: any) => s + CardEngine.getPower(c), 0);
  const myClockTurns = myEvasionPower > 0 ? Math.ceil(opponentLife / myEvasionPower) : 99;
  const oppClockTurns = oppAttackPower > 0 ? Math.ceil(myLife / oppAttackPower) : 99;
  const winningRace = myClockTurns <= oppClockTurns;

  const oppFlyerBlockers = opponentCreatures.filter((c: any) =>
    CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Reach')
  );

  // === CombatSim-based attack decision ===
  if (typeof CombatSim !== 'undefined') {
    const mySnaps = creatures.map((c: any) => CombatSim._snapshot(c, state));
    const oppSnaps = opponentCreatures.map((c: any) => CombatSim._snapshot(c, state));

    const simResult = CombatSim.findBestAttackers(mySnaps, oppSnaps, opponentLife, myLife, boardScore);

    if (simResult.attackerIndices.length > 0) {
      for (const idx of simResult.attackerIndices) {
        CombatSystem.declareAttacker(state.combat, creatures[idx]);
      }
      if (state.combat.attackers.length > 0) {
        state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s).`);
        state.combat.attackers.forEach(({ card }: any) => {
          if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
            card._tapped = true;
            card._tappedByAttack = true;
            const tapLogs = GameState.fireTrigger(state, 'becomes_tapped', {
              cardUid: card._uid, card: card, controllerId: playerId
            });
            if (tapLogs.length > 0) state.log.push(...tapLogs);
          }
        });
        if (!state._aiActions) state._aiActions = [];
        const attackerNames = state.combat.attackers.map((c: any) => `${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})`).join(', ');
        state._aiActions.push({
          type: 'attack',
          attackers: state.combat.attackers.filter((c: any) => c).map((c: any) => ({
            name: c.name || 'Criatura',
            image_normal: c.image_normal || '',
            image_small: c.image_small || '',
            power: CardEngine.getPower(c),
            toughness: CardEngine.getToughness(c)
          })),
          description: `Oponente ataca com ${state.combat.attackers.length} criatura(s): ${attackerNames}`
        });
      }
      return;
    }
    if (simResult.score <= 0 && !simResult.lethal) {
      return;
    }
  }

  // === Fallback: Heuristic scoring ===
  for (const creature of creatures) {
    const power = CardEngine.getPower(creature);
    const toughness = CardEngine.getToughness(creature);
    let attackValue = power;

    if (CardEngine.hasKeyword(creature, 'Vigilance')) {
      attackValue += 5;
    }
    if (CardEngine.hasIndestructible(creature)) {
      attackValue += 5;
    }

    const isFlying = CardEngine.hasKeyword(creature, 'Flying');
    const isMenace = CardEngine.hasKeyword(creature, 'Menace');
    if (isFlying) {
      const canBeBlockedByFlyer = oppFlyerBlockers.some((b: any) =>
        CardEngine.canBlock(b, creature, state)
      );
      if (!canBeBlockedByFlyer) {
        attackValue += power;
      } else {
        const bestFlyerBlocker = oppFlyerBlockers
          .filter((b: any) => CardEngine.canBlock(b, creature, state))
          .sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a))[0];
        if (bestFlyerBlocker) {
          const bPow = CardEngine.getPower(bestFlyerBlocker);
          const bTough = CardEngine.getToughness(bestFlyerBlocker);
          if (toughness > bPow && power >= bTough) attackValue += 4;
          else if (toughness <= bPow && power < bTough) attackValue -= 4;
        }
      }
    }
    if (isMenace && opponentCreatures.length < 2) {
      attackValue += power;
    }

    if (CardEngine.hasKeyword(creature, 'Trample')) {
      const bestBlockerTough = opponentCreatures
        .filter((b: any) => CardEngine.canBlock(b, creature, state))
        .reduce((max: number, b: any) => Math.max(max, CardEngine.getToughness(b)), 0);
      const trampleThrough = Math.max(0, power - bestBlockerTough);
      attackValue += trampleThrough * 0.5;
    }

    if (CardEngine.hasKeyword(creature, 'Deathtouch')) {
      attackValue += 3;
    }

    if (CardEngine.hasKeyword(creature, 'Lifelink')) {
      attackValue += power * 0.5;
    }

    if (CardEngine.hasKeyword(creature, 'First Strike') || CardEngine.hasKeyword(creature, 'Double Strike')) {
      const killsBeforeDamage = opponentCreatures.filter((b: any) =>
        CardEngine.canBlock(b, creature, state) && power >= CardEngine.getToughness(b)
      ).length > 0;
      if (killsBeforeDamage) attackValue += 3;
    }

    if (creature._isToken) {
      attackValue += 1;
    }

    if (!CardEngine.hasIndestructible(creature) && !CardEngine.hasKeyword(creature, 'Vigilance')) {
      const validBlockers = opponentCreatures.filter((b: any) => CardEngine.canBlock(b, creature, state));
      if (validBlockers.length > 0) {
        const bestBlocker = validBlockers.sort((a: any, b: any) => {
          const aKills = CardEngine.getPower(a) >= toughness || CardEngine.hasKeyword(a, 'Deathtouch');
          const bKills = CardEngine.getPower(b) >= toughness || CardEngine.hasKeyword(b, 'Deathtouch');
          if (aKills !== bKills) return (bKills ? 1 : 0) - (aKills ? 1 : 0);
          return CardEngine.getPower(b) - CardEngine.getPower(a);
        })[0];

        const blockerPower = CardEngine.getPower(bestBlocker);
        const blockerTough = CardEngine.getToughness(bestBlocker);
        const creatureDies = blockerPower >= toughness || CardEngine.hasKeyword(bestBlocker, 'Deathtouch');
        const blockerDies = power >= blockerTough || CardEngine.hasKeyword(creature, 'Deathtouch');

        if (creatureDies) {
          if (blockerDies) {
            // Mutual kill — evaluate trade quality
            const myVal = _creatureValue(creature);
            const theirVal = _creatureValue(bestBlocker);
            if (myVal > theirVal + 3) {
              attackValue -= 6; // Bad trade — our creature is worth more
            }
            // (line 1500 — continues in part2)
          }
        }
      }
    }
  }
}

// --- CONTINUES IN game-ai-part2.ts ---
