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
import { aiBrain } from './ai-brain';

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
    const cmc = card.cmc || 1;
    // Weight by CMC: higher-cost cards need more lands to cast, so prioritize their colors more
    const weight = Math.min(cmc * 0.3 + 0.5, 2.5);

    // Regular colored mana {W}, {U}, {B}, {R}, {G}
    const colored = cost.match(/\{([WUBRG])\}/g) || [];
    for (const m of colored) {
      const color = m[1];
      needs[color] = (needs[color] || 0) + weight;
    }

    // Hybrid mana {W/U}, {B/R}, etc. — counts toward both colors at 60% each
    const hybrid = cost.match(/\{([WUBRG])\/([WUBRG])\}/g) || [];
    for (const m of hybrid) {
      const c1 = m[1];
      const c2 = m[3];
      needs[c1] = (needs[c1] || 0) + weight * 0.6;
      needs[c2] = (needs[c2] || 0) + weight * 0.6;
    }

    // Phyrexian mana {W/P} — can be paid with life, lower priority
    const phyrexian = cost.match(/\{([WUBRG])\/P\}/g) || [];
    for (const m of phyrexian) {
      const c = m[1];
      needs[c] = (needs[c] || 0) + weight * 0.3;
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
  const criticalLife = myLife <= 4;
  const oppLowLife = oppLife <= 8;
  const oppCriticalLife = oppLife <= 4;
  const boardPressure = oppCreatures.reduce((s: number, c: any) => s + CardEngine.getPower(c), 0) >= myLife * 0.5;
  const _keywordScore = (c: any, sign: number) => {
    let s = 0;
    if (CardEngine.hasKeyword(c, 'Deathtouch')) s += 3; // Better than raw stats — blocks any creature
    if (CardEngine.hasKeyword(c, 'Double Strike')) s += 4;
    if (CardEngine.hasKeyword(c, 'First Strike')) s += 2;
    if (CardEngine.hasKeyword(c, 'Lifelink')) s += criticalLife ? 5 : lowLife ? 3 : boardPressure ? 2 : 1;
    if (CardEngine.hasKeyword(c, 'Trample')) s += oppCriticalLife ? 4 : oppLowLife ? 2 : 1;
    if (CardEngine.hasIndestructible(c)) s += 4;
    if (CardEngine.hasKeyword(c, 'Vigilance')) s += 2; // Vigilance is real — attacks + blocks
    if (CardEngine.hasKeyword(c, 'Reach')) s += 1;
    if (CardEngine.hasKeyword(c, 'Hexproof')) s += 2;
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

  // === BOARD STATE TYPE: stall penalty, evasion superiority bonus ===
  if (myCreatures.length > 0 && oppCreatures.length > 0) {
    // Evasion superiority: I have fliers/menace they can't answer
    const myEvasionCount = myCreatures.filter((c: any) =>
      (CardEngine.hasKeyword(c, 'Flying') && !oppCreatures.some((b: any) => CardEngine.hasKeyword(b, 'Flying') || CardEngine.hasKeyword(b, 'Reach'))) ||
      (CardEngine.hasKeyword(c, 'Menace') && oppCreatures.length < 2)
    ).length;
    const oppEvasionCount = oppCreatures.filter((c: any) =>
      (CardEngine.hasKeyword(c, 'Flying') && !myCreatures.some((b: any) => CardEngine.hasKeyword(b, 'Flying') || CardEngine.hasKeyword(b, 'Reach'))) ||
      (CardEngine.hasKeyword(c, 'Menace') && myCreatures.length < 2)
    ).length;
    score += (myEvasionCount - oppEvasionCount) * 3; // uncontested evasion is a big deal

    // Stall penalty: if neither side has evasion and boards are similar, game is stuck
    const trulyStalled = myEvasionCount === 0 && oppEvasionCount === 0 &&
      myCreatures.length >= 2 && oppCreatures.length >= 2;
    if (trulyStalled) score -= 4; // Being stalled is bad — makes this board state worse
  }

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
  // Score triggered abilities for trade value — recurring ones make trading MUCH more important
  const cardTriggeredAbilities = (CardEngine as any).getTriggeredAbilities
    ? (CardEngine as any).getTriggeredAbilities(card) : [];
  for (const trig of cardTriggeredAbilities) {
    if (!trig) continue;
    const effs = trig.effects || [];
    const isRecurring = ['attacks', 'upkeep', 'enters_or_attacks', 'combat_begin', 'end_step'].includes(trig.event);
    const base = isRecurring ? 4 : 1; // recurring triggers are compound — very high trade value
    if (effs.some((e: any) => e.type === 'draw')) val += base + 3;
    else if (effs.some((e: any) => e.type === 'damage' || e.type === 'destroy')) val += base + 2;
    else if (effs.some((e: any) => e.type === 'create_token')) val += base + 2;
    else val += base;
  }
  if (cardTriggeredAbilities.length === 0 && card._triggers) {
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

  // Score triggered abilities — recurring triggers (attacks/upkeep) are far more valuable
  const triggeredAbilities = (CardEngine as any).getTriggeredAbilities
    ? (CardEngine as any).getTriggeredAbilities(card) : [];
  for (const trig of triggeredAbilities) {
    const effs = trig.effects || [];
    // Recurring events fire every combat/upkeep = compound advantage
    const isRecurring = ['attacks', 'upkeep', 'enters_or_attacks', 'combat_begin', 'end_step'].includes(trig.event);
    const base = isRecurring ? 5 : 2;
    if (effs.some((e: any) => e.type === 'draw')) score += base + 4;
    else if (effs.some((e: any) => e.type === 'damage' || e.type === 'destroy' || e.type === 'exile')) score += base + 3;
    else if (effs.some((e: any) => e.type === 'create_token')) score += base + 3;
    else if (effs.some((e: any) => e.type === 'counter_self' || e.type === 'buff')) score += base + 1;
    else score += base;
  }
  if (triggeredAbilities.length === 0 && card._triggers && card._triggers.length > 0) {
    score += card._triggers.length * 2; // fallback: instance triggers
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
  let _mainLoopGuard = 0;
  while (playedSomething) {
    if (++_mainLoopGuard > 40) { break; } // Safety: max 40 spells per main phase
    playedSomething = false;
    const playable = GameState.getPlayableCards(state, playerId)
      .filter((c: any) => !CardEngine.isLand(c));

    if (playable.length === 0) {
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

    const gamePlan = _computeGamePlan(state, playerId);
    const boardStalled = _isBoardStalled(state, playerId);

    // Game phase context: early (≤3 lands), mid (4-6), late (7+)
    const gamePhase: 'early' | 'mid' | 'late' = landCount <= 3 ? 'early' : landCount <= 6 ? 'mid' : 'late';
    const boardScore_outer = _evaluateBoard(state, playerId);

    const scored = playable.map((card: any) => {
      let score = 0;
      const effects = CardEngine.getSpellEffects(card);
      const cmc = card.cmc || 0;

      // Base: prefer playing bigger spells when we can (on curve)
      score += Math.min(cmc, 5);

      // === RAMP ===
      if (effects.some((e: any) => e.type === 'ramp')) {
        const oppBoardPower = opponentCreatures.reduce((sum: number, c: any) => sum + CardEngine.getPower(c), 0);
        const rampBoardScore = _evaluateBoard(state, playerId);
        // Expanded pressure detection: lower threshold + board state + creature count
        const underBoardPressure = oppBoardPower >= myLife * 0.5 ||
          (opponentCreatures.length >= 3 && rampBoardScore < 0) ||
          rampBoardScore < -10;
        if (underBoardPressure) {
          score += 1; // Don't ramp when under heavy pressure — stabilize instead
        } else if (gamePhase === 'early') score += 15;
        else if (gamePhase === 'mid') score += 6;
        else score -= 3; // Late game: ramp is a waste — play threats instead

        // === FUTURE MANA PLANNING: ramp is extra valuable if we have a high-cmc payoff ===
        // Check hand for the most expensive uncastable spell — ramp enables it sooner
        const handCards = hand.getAll().filter((c: any) => !CardEngine.isLand(c));
        const maxUncastableCmc = handCards
          .filter((c: any) => (c.cmc || 0) > landCount + 1) // can't cast next turn without ramp
          .reduce((max: number, c: any) => Math.max(max, c.cmc || 0), 0);
        if (maxUncastableCmc >= 5) score += 8;  // Ramp to enable 5+ cmc powerhouse
        else if (maxUncastableCmc >= 4) score += 4; // Ramp to enable 4 cmc
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
        else if (boardScore > 25 && myCreatures.length >= 4) score += 2; // Way ahead — don't overextend into sweeper
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
        // === ETB SEQUENCING: check if this creature's ETB scales with board state ===
        // If yes, check if we have other creatures in hand to play first for higher value
        const etbScalesWithMyCreatures = etbEffects.some((etb: any) =>
          etb.type === 'fight' || // fight is better with bigger creature
          etb.amount_from === 'creature_count' ||
          etb.type === 'damage' && etb.amount_each_creature // damage per creature
        );
        const creaturesInHandToPlayFirst = hand.getAll().filter((c: any) =>
          CardEngine.isCreature(c) && c._uid !== card._uid && (c.cmc || 0) < cmc
        );
        if (etbScalesWithMyCreatures && creaturesInHandToPlayFirst.length > 0) {
          // Deprioritize slightly — cheaper creatures should enter first to maximize ETB
          score -= creaturesInHandToPlayFirst.length * 2;
        }

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
            // Fight value scales with my biggest creature — reward if we have a big one
            const myBestPower = myCreatures.reduce((max: number, c: any) => Math.max(max, CardEngine.getPower(c)), 0);
            if (myCreatures.length > 0 && opponentCreatures.length > 0) {
              const weakestOppTough = Math.min(...opponentCreatures.map((c: any) => CardEngine.getToughness(c)));
              if (myBestPower >= weakestOppTough + 1) score += 7; // Will kill + survive
              else if (myBestPower >= weakestOppTough) score += 5; // Will trade
              else score += 2; // Will lose fight — still some value
            } else score += 1;
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
          if (bfCard._anthem) score += 3; // increased from 2: entering under anthem is more valuable
        }

        // === SPELL SEQUENCING: "second_spell" triggers ===
        // If this card triggers on being the 2nd+ spell, check if we have a cheap spell to play first
        const cardTriggers = (CardEngine as any).getTriggeredAbilities
          ? (CardEngine as any).getTriggeredAbilities(card) : [];
        const hasSecondSpellTrigger = cardTriggers.some((t: any) =>
          t.event === 'second_spell' || t.condition === 'cast_with_another_spell'
        );
        const spellsThisTurn = state._spellsThisTurn ? (state._spellsThisTurn[playerId] || 0) : 0;
        if (hasSecondSpellTrigger && spellsThisTurn === 0) {
          // We haven't cast a spell yet — check if there's a cheap spell in hand to play first
          const cheapFirst = hand.getAll().filter((c: any) =>
            !CardEngine.isLand(c) && c._uid !== card._uid && (c.cmc || 0) <= 2
          );
          if (cheapFirst.length > 0) {
            // Strong deprioritization: push this card below the cheap spell in score order
            // so cheap spell plays first, THEN this triggers as 2nd spell
            // -10 is large enough to ensure the cheap card (typically score ~8) goes first
            score -= 10;
          }
          // If we already cast something this turn, this is the 2nd spell — trigger fires
        } else if (hasSecondSpellTrigger && spellsThisTurn >= 1) {
          score += 6; // This IS the 2nd spell — trigger fires! Big bonus
        }
      }

      // === AURAS ===
      if (CardEngine.isAura(card)) {
        const db = CardEngine.getPreprocessedEffects(card);
        const isDebuffAura = db?.static?.some((s: any) =>
          s.type === 'aura_debuff' || s.type === 'aura_prevent_untap' || s.type === 'loses_abilities'
        ) || (card.oracle_text || '').toLowerCase().match(/enchanted creature (can't|doesn't|gets -|loses)/);

        if (isDebuffAura) {
          // Debuff aura: need opponent creatures to target
          if (opponentCreatures.length > 0) {
            score += 6;
            if (opponentCreatures.some((c: any) => CardEngine.getPower(c) >= 4)) score += 3;
          } else {
            score -= 20; // No valid targets
          }
        } else if (myCreatures.length > 0) {
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
        if (myHandSize <= 1) score += 8;       // Desperately need cards
        else if (myHandSize <= 2) score += 5;
        else if (myHandSize <= 3) score += 2;
        if (gamePhase === 'late' && myHandSize <= 3) score += 3; // Card advantage is key in late game
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

      // === INSTANTS: Context-aware hold/play decision ===
      if ((card.type_line || '').toLowerCase().includes('instant')) {
        const isRemoval = effects.some((e: any) => e.type === 'destroy' || e.type === 'exile');
        const isDamage = effects.some((e: any) => e.type === 'damage' && (e.target === 'creature' || e.target === 'any' || e.target === 'any_target'));
        const isBuff = effects.some((e: any) => e.type === 'buff');
        const isCounter = effects.some((e: any) => e.type === 'counter' && (e.target === 'spell' || e.target === 'creature_spell' || e.target === 'noncreature_spell'));
        const isDraw = effects.some((e: any) => e.type === 'draw');
        const isBounce = effects.some((e: any) => e.type === 'bounce');

        if (isCounter) {
          // Counter spells: almost never cast preemptively — hold for opponent's cast
          score -= 22;
        } else if (isBuff) {
          // Combat tricks: play main1 only if we have attackers and a bad trade looms
          const myAttackers = myCreatures.filter((c: any) => CardEngine.canAttack(c));
          const wouldLoseTrade = myCreatures.some((c: any) =>
            opponentCreatures.some((b: any) => CardEngine.getPower(b) >= CardEngine.getToughness(c) && CardEngine.canBlock(b, c, state))
          );
          if (state.phase === 'main1' && myAttackers.length >= 2 && wouldLoseTrade) {
            score -= 4; // Pre-combat trick that saves a creature is acceptable
          } else {
            score -= 14; // Hold for combat window
          }
        } else if (isRemoval || isDamage) {
          // Removal/damage: play main1 pre-combat when it clears a blocker; otherwise hold
          const bigThreat = opponentCreatures
            .filter((c: any) => CardEngine.canBeTargeted(c, playerId))
            .some((c: any) => CardEngine.getPower(c) >= 4 || _threatScore(c) >= 5);
          if (state.phase === 'main1' && bigThreat && myCreatures.length > 0) {
            score -= 1; // Pre-combat removal is very good — small penalty
          } else if (state.phase === 'main1' && opponentCreatures.length > 0) {
            score -= 4;
          } else {
            score -= 8; // Hold for end of opponent's turn
          }
        } else if (isDraw) {
          // Draw spells: prefer holding until end of opponent's turn (more info)
          score -= 6;
        } else if (isBounce) {
          // Bounce: best used reactively — hold slightly
          if (state.phase === 'main1' && opponentCreatures.length > 0) score -= 3;
          else score -= 7;
        } else {
          score -= 9;
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
        // Bonus: if we have creature spells in hand ready to deploy AFTER anthem, prioritize anthem first
        const creaturesInHand = hand.getAll().filter((c: any) => CardEngine.isCreature(c));
        if (creaturesInHand.length >= 1) score += 4; // creatures will enter buffed = sequencing bonus
        if (creaturesInHand.length >= 2) score += 2; // even better with multiple creatures
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

      // === EFFICIENCY + CURVE OPTIMIZATION ===
      const availableMana = bf.cards.filter((c: any) => CardEngine.isLand(c) && !c._tapped).length
        + ManaSystem.poolTotal(state.manaPool[playerId]);
      if (cmc === availableMana) score += 2;
      if (cmc <= availableMana && cmc >= availableMana - 1) score += 1;

      // MULTI-SPELL BONUS: Prefer playing 2 cheap spells over 1 expensive when possible
      // If there are other playable spells in hand that fit in remaining mana, reward smaller spells
      if (cmc > 0 && cmc < availableMana) {
        const manaLeft = availableMana - cmc;
        const otherPlayable = playable.filter((c: any) =>
          c._uid !== card._uid && (c.cmc || 0) <= manaLeft && !CardEngine.isLand(c)
        );
        if (otherPlayable.length > 0 && CardEngine.isCreature(card)) {
          // Playing this card leaves room for another spell — small bonus (2 bodies > 1 big body)
          score += 2;
        }
      }

      // === URGENCY: if we're losing the race fast, bypass mana hold and play threats now ===
      const _ttl = _turnsToLethal(state, playerId);
      const losingRaceBadly = _ttl.opp <= 2 && _ttl.mine > _ttl.opp + 2;
      if (losingRaceBadly) {
        // Opponent kills us in ≤2 turns and we're slower — urgency! Don't hold mana
        if (CardEngine.isCreature(card) && (CardEngine.hasKeyword(card, 'Flying') || CardEngine.hasKeyword(card, 'Lifelink') ||
            CardEngine.hasKeyword(card, 'Deathtouch') || CardEngine.hasKeyword(card, 'Haste'))) {
          score += 10; // Lifelink/flying/haste/deathtouch can swing the race immediately
        }
        if (effects.some((e: any) => e.type === 'gainLife' || e.type === 'drain')) score += 8;
        if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile')) score += 6;
      }

      // === MANA HOLD: Don't tap out for mediocre spells when holding instants ===
      if (hasValuableInstant && cmc > 0 && !losingRaceBadly) {
        const manaAfterCast = availableMana - cmc;
        if (manaAfterCast < cheapestInstantCost && score < 20) {
          const hasCombatTrick = instantsInHand.some((c: any) => {
            const effs = CardEngine.getSpellEffects(c);
            return effs.some((e: any) => e.type === 'buff');
          });
          const hasInstantRemoval = instantsInHand.some((c: any) => {
            const effs = CardEngine.getSpellEffects(c);
            return effs.some((e: any) => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage');
          });
          const hasCounter = instantsInHand.some((c: any) => {
            const effs = CardEngine.getSpellEffects(c);
            return effs.some((e: any) => e.type === 'counter');
          });
          // main2: combat is over — combat tricks are useless now, only hold for removal/counter
          const isPostCombat = state.phase === 'main2';
          if (hasCounter) {
            // Hold mana for counter spells — scale penalty by how many threats opponent has
            // More threats = more likely they'll play something worth countering
            const counterPenalty = opponentCreatures.length >= 3 ? 18  // Lots of threats, definitely hold
              : opponentCreatures.length >= 1 ? 14                      // At least one threat
              : isPostCombat ? 8 : 12;                                  // No creatures yet (early game)
            score -= counterPenalty;
          } else if (!isPostCombat && hasCombatTrick && myCreatures.length >= 2) {
            // main1 only: hold for combat tricks when we have attackers
            score -= 10;
          } else if (hasInstantRemoval && opponentCreatures.length > 0) {
            // Both phases: hold for removal (relevant pre and post combat)
            score -= isPostCombat ? 4 : 7;
          } else if (isPostCombat) {
            // main2 with only tricks to hold for: ignore — play the spell
            score -= 1;
          } else {
            score -= 5;
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

      // === SMART REMOVAL: hold for real threats, don't waste on small creatures ===
      if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile')) {
        if (opponentCreatures.length > 0) {
          const maxOppThreat = opponentCreatures.reduce((mx: number, c: any) =>
            Math.max(mx, _threatScore(c)), 0);
          const myLife = state.players[playerId].life;
          const notInDanger = myLife > 10;
          // If all opponent creatures are small/irrelevant AND we're not at risk → save removal
          if (notInDanger && score < 30) {
            if (maxOppThreat < 5) {
              // Only tiny creatures (1/1s, 2/2s) — heavily penalize wasting removal here
              score -= 10;
            } else if (maxOppThreat < 9) {
              // Moderate threats but nothing game-ending — light penalty
              score -= 5;
            }
          }
          // Bonus for removing creatures with dangerous keywords (evasion + power 4+)
          const hasHighEvasionThreat = opponentCreatures.some((c: any) =>
            CardEngine.getPower(c) >= 4 && (
              CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasIndestructible(c) ||
              CardEngine.hasKeyword(c, 'Deathtouch') || CardEngine.hasKeyword(c, 'Lifelink')
            )
          );
          if (hasHighEvasionThreat) score += 8; // Remove dangerous evasive creatures NOW
        }
      }

      // === BOARD STALL: priorizar evasion + removal + card draw ===
      if (boardStalled) {
        if (effects.some((e: any) => e.type === 'draw')) score += 5;
        if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile')) score += 4;
        if (effects.some((e: any) => e.type === 'bounce')) score += 3;
        if (CardEngine.isCreature(card)) {
          const hasEvasion = CardEngine.hasKeyword(card, 'Flying') || CardEngine.hasKeyword(card, 'Menace') ||
            CardEngine.hasKeyword(card, 'Trample') ||
            !opponentCreatures.some((b: any) => CardEngine.canBlock(b, card, state));
          if (hasEvasion) score += 5; // Evasion BREAKS the stall — very high value
          else score -= 3;            // Another ground body just deepens the stall
        }
        if (effects.some((e: any) => e.type === 'anthem')) score += 4; // Anthem can push through stalls
        if (effects.some((e: any) => e.type === 'grant' || e.type === 'grant_all')) {
          const grantsEvasion = effects.some((e: any) =>
            (e.keywords || []).some((k: string) => ['flying', 'menace', 'trample'].includes(k.toLowerCase()))
          );
          if (grantsEvasion) score += 6; // Grant evasion to ground army
        }
      }

      // === GAME PLAN ADAPTATIVO ===
      if (gamePlan === 'stabilizing') {
        if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile')) score += 8;
        if (effects.some((e: any) => e.type === 'bounce')) score += 5;
        if (effects.some((e: any) => e.type === 'gainLife' || e.type === 'drain')) score += 6;
        // Don't penalize creatures in stabilizing — AI still needs board presence
      }
      if (gamePlan === 'reactive') {
        if (effects.some((e: any) => e.type === 'destroy' || e.type === 'exile')) score += 4;
        if (effects.some((e: any) => e.type === 'draw')) score += 3;
      }
      if (gamePlan === 'proactive') {
        if (CardEngine.isCreature(card)) score += 3;
        // When ahead: prioritize threats and evasion, not vanilla creatures
        if (CardEngine.isCreature(card) && (CardEngine.hasKeyword(card, 'Flying') || CardEngine.hasKeyword(card, 'Haste'))) score += 3;
        score += 1; // Small bonus — being ahead is good but don't blindly dump hand
      }

      return { card, score };
    }).sort((a: any, b: any) => b.score - a.score);

    if (scored.length > 0) {
      // AiBrain: re-rank top-3 heuristic candidates with neural network
      const _nnTop = scored.slice(0, Math.min(3, scored.length));
      let card: any;
      if (_nnTop.length > 1 && aiBrain.isReady()) {
        const _nnBf = aiBrain.extractBoardFeatures(state, playerId);
        const _nnRank = aiBrain.scoreActionsSync(_nnBf, _nnTop.map((s: any) => s.card), 'play');
        card = _nnTop[_nnRank[0]].card;
        aiBrain.recordDecision(_nnBf, aiBrain.extractActionFeatures(card, 'play'));
      } else {
        card = scored[0].card;
      }
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
        const db = CardEngine.getPreprocessedEffects(card);
        const isDebuff = db?.static?.some((s: any) =>
          s.type === 'aura_debuff' || s.type === 'aura_prevent_untap' || s.type === 'loses_abilities'
        );
        if (isDebuff) {
          const oppCreaturesNow = state.players[opponentId].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c));
          if (oppCreaturesNow.length === 0) break;
        } else {
          const myCreaturesNow = bf.cards.filter((c: any) => CardEngine.isCreature(c));
          if (myCreaturesNow.length === 0) break;
        }
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

  // If a spell is pending on the stack (waiting for human response), don't do anything else
  if (state.waitingForInput) return;

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

    const fakeCard = { mana_cost: manaCost, cmc } as any;
    if (!ManaSystem.canAfford(state, playerId, fakeCard, manaCost, cmc)) continue;

    // Score each creature: evasion > attack triggers > raw stats
    const _scoreCreatureForEquip = (c: any): number => {
      let score = CardEngine.getPower(c) + CardEngine.getToughness(c);
      if (CardEngine.hasKeyword(c, 'Flying')) score += 5;   // Best: unblockable by ground
      if (CardEngine.hasKeyword(c, 'Menace')) score += 3;
      if (CardEngine.hasKeyword(c, 'Trample')) score += 2;
      if (CardEngine.hasKeyword(c, 'Deathtouch')) score += 3; // Deathtouch + power = threat
      if (CardEngine.hasKeyword(c, 'Lifelink')) score += 2;
      if (CardEngine.hasKeyword(c, 'First Strike') || CardEngine.hasKeyword(c, 'Double Strike')) score += 2;
      if (!c._summoningSick) score += 2; // Ready to attack immediately
      // Penalize stacking multiple equipment on one creature — spread the wealth
      const existingEquipCount = (c._attachments || []).filter((uid: string) => {
        const attached = bf.cards.find((b: any) => b._uid === uid);
        return attached && CardEngine.isEquipment(attached);
      }).length;
      if (existingEquipCount >= 1) score -= 5 * existingEquipCount; // Strong penalty per extra equipment
      // Attack/damage triggers benefit most from power boosts
      const triggers = CardEngine.getTriggeredAbilities(c);
      if (triggers.some((t: any) => t.event === 'attacks' || t.event === 'combat_damage_player')) score += 3;
      return score;
    };

    const sorted = creatures
      .filter((c: any) => !(c._attachments || []).includes(equip._uid))
      .sort((a: any, b: any) => _scoreCreatureForEquip(b) - _scoreCreatureForEquip(a));

    if (sorted.length > 0) {
      GameState.autoTapForSpell(state, playerId, manaCost, cmc);
      state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
      GameState.equipCreature(state, playerId, equip._uid, sorted[0]._uid);
    }
  }
}

// Score an activated ability's effects to determine if/how worthwhile it is to activate
// Optional: pass the source creature to check death-trigger synergy for sacrifice costs
function _scoreActivatedAbility(effects: any[], state: any, playerId: number, sourceCard?: any): number {
  let score = 0;
  for (const eff of effects) {
    switch (eff.type) {
      case 'draw':              score += 10; break;
      case 'destroy':
      case 'exile':             score += 8; break;
      case 'damage':            score += 7; break;
      case 'create_token':      score += 5; break;
      case 'drain':             score += 5; break;
      case 'counter_self':      score += 4; break;
      case 'grant_counter':
      case 'grant_counters':
      case 'double_counters':   score += 4; break;
      case 'buff_self':
      case 'buff_all':
      case 'grant':
      case 'grant_all':         score += 3; break;
      case 'gainLife':          score += 3; break;
      case 'loot':              score += 4; break;
      case 'look_top':
      case 'exile_top_play':    score += 4; break;
      case 'bounce':            score += 4; break;
      case 'tap_target':        score += 4; break;
      case 'discard':           score += 4; break;
      case 'search_library':    score += 6; break;
      case 'fight':             score += 5; break;
      case 'add_mana':          score += 3; break;
      case 'mill':              score += 3; break;
      case 'return_from_graveyard': score += 5; break;
      case 'regenerate':        score += 3; break;
      case 'untap_self':        score += 3; break;
      case 'damage_each_opponent': score += 4; break;
      case 'cant_block':        score += 3; break;
    }
  }

  // Sacrifice-self synergy: check if the creature has death triggers that add bonus value
  // e.g., "sacrifice: draw 2 cards" + creature has "dies: draw 1 card" = extra +5
  if (sourceCard) {
    const triggers = CardEngine.getTriggeredAbilities(sourceCard);
    const deathTriggers = triggers.filter((t: any) =>
      t.event === 'dies' || t.event === 'any_creature_dies'
    );
    for (const dt of deathTriggers) {
      for (const eff of (dt.effects || [])) {
        if (eff.type === 'draw') score += 5;
        else if (eff.type === 'create_token') score += 3;
        else if (eff.type === 'gainLife') score += 2;
        else if (eff.type === 'damage') score += 2;
      }
    }
  }

  return score;
}

function _tryActivatedAbilities(state: any, playerId: number): void {
  // Clarion Conqueror: if activated abilities of creatures/artifacts/planeswalkers are globally locked, skip
  const globallyLocked = state.players.some((p: any) =>
    p.zones.battlefield.cards.some((c: any) => c._preventActivatedAbilities)
  );
  if (globallyLocked) return;

  const bf = state.players[playerId].zones.battlefield;
  const creatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));

  for (const creature of creatures) {
    const rawAbilities = CardEngine.getActivatedAbilities(creature);
    if (rawAbilities.length === 0) continue;

    // Sort: non-tap first (preserve tap availability), then by score
    // This prevents accidentally tapping a creature before using its tap-free abilities
    const abilities = rawAbilities
      .map((ab: any) => ({
        ab,
        score: _scoreActivatedAbility(ab.effects, state, playerId, ab.cost.sacrifice ? creature : undefined),
        hasTapCost: !!ab.cost.tap,
      }))
      .sort((x: any, y: any) => {
        // Non-tap abilities go first (don't tap creature unnecessarily)
        if (x.hasTapCost !== y.hasTapCost) return x.hasTapCost ? 1 : -1;
        return y.score - x.score;
      })
      .map((x: any) => x.ab);

    for (const ability of abilities) {
      if (ability.cost.tap && (creature._tapped || creature._summoningSick)) continue;

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
      if (ability.cost.sacrifice) {
        // Sacrifice SELF — only worthwhile if score is very high (losing the creature)
        // Score threshold enforced later; just mark feasible here
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

      // Validate that destroy effects have valid targets before activating
      const oppId = playerId === 0 ? 1 : 0;
      const destroyEff = ability.effects.find((e: any) => e.type === 'destroy');
      if (destroyEff) {
        const tgt = destroyEff.target as string;
        const oppBF = state.players[oppId].zones.battlefield.cards;
        if (tgt === 'artifact_or_enchantment' || tgt === 'opponent_artifact_or_enchantment') {
          if (!oppBF.some((c: any) => CardEngine.isArtifact(c) || CardEngine.isEnchantment(c))) continue;
        } else if (tgt === 'opponent_artifact_or_creature') {
          if (!oppBF.some((c: any) => CardEngine.isArtifact(c) || CardEngine.isCreature(c))) continue;
        } else if (tgt === 'opponent_nonland') {
          if (!oppBF.some((c: any) => !CardEngine.isLand(c))) continue;
        } else if (tgt === 'artifact') {
          if (!oppBF.some((c: any) => CardEngine.isArtifact(c))) continue;
        } else if (tgt === 'enchantment') {
          if (!oppBF.some((c: any) => CardEngine.isEnchantment(c))) continue;
        } else if (tgt === 'creature_with_flying') {
          if (!oppBF.some((c: any) => CardEngine.isCreature(c) && CardEngine.hasKeyword(c, 'Flying'))) continue;
        }
      }

      // Score each effect to find the best ability to activate
      const abilityScore = _scoreActivatedAbility(ability.effects, state, playerId, ability.cost.sacrifice ? creature : undefined);
      // Sacrifice-self abilities need higher bar (losing the creature permanently)
      const minScore = ability.cost.sacrifice ? 10 : 3;
      if (abilityScore < minScore) continue; // Threshold: not worth activating

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
        // Priority: tokens first, then fewest death triggers, then lowest power
        const others = state.players[playerId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && c._uid !== creature._uid)
          .sort((a: any, b: any) => {
            // Tokens are most expendable
            if (a._isToken !== b._isToken) return a._isToken ? -1 : 1;
            // Fewer death triggers = cheaper to lose
            const aDt = CardEngine.getTriggeredAbilities(a).filter((t: any) => t.event === 'dies').length;
            const bDt = CardEngine.getTriggeredAbilities(b).filter((t: any) => t.event === 'dies').length;
            if (aDt !== bDt) return aDt - bDt;
            // Lowest power last resort
            return CardEngine.getPower(a) - CardEngine.getPower(b);
          });
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
          // Fire card_leaves_graveyard trigger (e.g. Attuned Hunter)
          const gyLeaveLogs = GameState.fireTrigger(state, 'card_leaves_graveyard', { playerId, card: victim });
          state.log.push(...gyLeaveLogs);
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

      if (ability.cost.sacrifice) {
        // Sacrifice self as cost — remove from battlefield, trigger die events
        GameState.creatureDies(state, creature, playerId);
        state.log.push(`Sacrifica ${creature.name} como custo.`);
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
  const oppId = playerId === 0 ? 1 : 0;
  const oppCreatures = state.players[oppId].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c));
  const myLife = state.players[playerId].life;
  const underPressure = myLife <= 8 || oppCreatures.length >= 3;

  for (const pw of planeswalkers) {
    const abilities = CardEngine.getLoyaltyAbilities(pw);
    if (abilities.length === 0) continue;

    const currentLoyalty = pw._loyalty || 0;

    // Find the ult ability (highest negative loyalty cost / best effects)
    // and check how many turns to reach it
    let ultIdx = -1;
    let ultCost = 0;
    let plusIdx = -1;
    let plusGain = 0;
    let bestDefIdx = -1; // Best defensive ability when under pressure

    const safeAmt = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 1; };

    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      const loyaltyCost = typeof ab.cost.loyalty === 'number' ? ab.cost.loyalty : 0;

      if (loyaltyCost > 0) {
        if (loyaltyCost > plusGain) { plusGain = loyaltyCost; plusIdx = i; }
      } else if (loyaltyCost < 0) {
        // Check if this is an ult-tier ability (high negative cost, powerful effects)
        const isUltTier = ab.effects.some((e: any) =>
          e.type === 'counter_all' || e.type === 'gain_control' || e.type === 'exile_all' ||
          e.type === 'destroy_all' || e.type === 'extra_combat' || (e.type === 'draw' && safeAmt(e.amount) >= 3)
        );
        if (isUltTier && loyaltyCost < ultCost) { ultCost = loyaltyCost; ultIdx = i; }
      }
    }

    // Check if ult is available now or soon
    if (ultIdx >= 0 && currentLoyalty + ultCost >= 0) {
      // Can ult NOW — but check if board-wipe ult would hurt us too
      const ultAb = abilities[ultIdx];
      const isBoardWipeUlt = ultAb.effects.some((e: any) =>
        e.type === 'counter_all' || e.type === 'destroy_all' || e.type === 'damage_all'
      );
      const myCreatureCount = state.players[playerId].zones.battlefield.cards
        .filter((c: any) => CardEngine.isCreature(c)).length;
      // Skip board-wipe ult if it would kill more of our creatures than opponent's
      if (isBoardWipeUlt && myCreatureCount > oppCreatures.length) {
        // Skip ult this turn — board wipe hurts us more
      } else {
        GameState.activateLoyaltyAbility(state, playerId, pw._uid, ultIdx);
        continue;
      }
    }

    // If ult is 1-2 turns away and we're not under pressure, pump loyalty
    if (ultIdx >= 0 && plusIdx >= 0 && !underPressure) {
      const turnsToUlt = Math.ceil((-ultCost - currentLoyalty) / plusGain);
      if (turnsToUlt <= 2) {
        // Rush toward the ult — use +loyalty ability
        GameState.activateLoyaltyAbility(state, playerId, pw._uid, plusIdx);
        continue;
      }
    }

    // Under pressure: prioritize defensive abilities (removal, token, lifegain)
    if (underPressure) {
      let bestDefScore = -Infinity;
      for (let i = 0; i < abilities.length; i++) {
        const ab = abilities[i];
        const loyaltyCost = typeof ab.cost.loyalty === 'number' ? ab.cost.loyalty : 0;
        if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) continue;
        let defScore = 0;
        for (const eff of ab.effects) {
          if (eff.type === 'destroy' || eff.type === 'exile') defScore += 8;
          if (eff.type === 'create_token') defScore += 5;
          if (eff.type === 'damage' && oppCreatures.length > 0) defScore += 3 * safeAmt(eff.amount);
          if (eff.type === 'gainLife' || eff.type === 'gain_life') defScore += 4;
          if (eff.type === 'counter_all') defScore += 10;
          if (eff.type === 'draw') defScore += 2 * safeAmt(eff.amount);
        }
        if (loyaltyCost > 0) defScore -= 2; // Prefer abilities that don't risk the PW dying
        if (defScore > bestDefScore) { bestDefScore = defScore; bestDefIdx = i; }
      }
      if (bestDefIdx >= 0) {
        GameState.activateLoyaltyAbility(state, playerId, pw._uid, bestDefIdx);
        continue;
      }
    }

    // Default: pick best overall ability by effect score
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      const loyaltyCost = typeof ab.cost.loyalty === 'number' ? ab.cost.loyalty : 0;
      if (loyaltyCost < 0 && currentLoyalty + loyaltyCost < 0) continue;

      let score = 0;
      for (const eff of ab.effects) {
        if (eff.type === 'draw') score += 4 * safeAmt(eff.amount);
        if (eff.type === 'create_token') score += 3;
        if (eff.type === 'damage') score += 2 * safeAmt(eff.amount);
        if (eff.type === 'destroy') score += 5;
        if (eff.type === 'counter_all') score += 3;
        if (eff.type === 'gain_life' || eff.type === 'gainLife') score += 1;
        if (eff.type === 'discard') score += 3;
        if (eff.type === 'grant_all') score += 2;
        if (eff.type === 'untap') score += 2;
        if (eff.type === 'optional_pay_counters') score += 5;
        if (eff.type === 'add_mana') score += 1;
        if (eff.type === 'exile') score += 4;
      }

      if (loyaltyCost > 0) score += 2; // Slightly prefer building loyalty
      if (loyaltyCost < 0 && currentLoyalty + loyaltyCost <= 1) score -= 5; // Risky low-loyalty use

      if (score > bestScore) { bestScore = score; bestIdx = i; }
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
        const costStr = ManaSystem.formatManaCost(ability.cost.mana);
        const parsed = ManaSystem.parseCost(costStr);
        const fakeCard = { mana_cost: costStr, cmc: parsed.total || 0 } as any;
        if (!ManaSystem.canAfford(state, playerId, fakeCard, costStr, parsed.total || 0)) continue;

        GameState.autoTapForSpell(state, playerId, costStr, fakeCard.cmc);
        state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], costStr, fakeCard.cmc);
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

        // Score a creature as a target for graveyard counter/buff effects
        const _scoreGYTarget = (c: any): number => {
          let s = CardEngine.getPower(c) + CardEngine.getToughness(c);
          if (CardEngine.hasKeyword(c, 'Flying')) s += 4;
          if (CardEngine.hasKeyword(c, 'Menace')) s += 2;
          if (CardEngine.hasKeyword(c, 'Trample')) s += 1;
          if (CardEngine.hasKeyword(c, 'Deathtouch')) s += 3;
          if (!c._summoningSick) s += 2; // Can attack immediately
          // Attack/combat triggers benefit most from counter/buff
          const triggers = CardEngine.getTriggeredAbilities(c);
          if (triggers.some((t: any) => t.event === 'attacks' || t.event === 'combat_damage_player')) s += 3;
          // Don't stack counters on already-pumped creatures
          const existingCounters = (c._counters && c._counters['+1/+1']) || 0;
          s -= existingCounters * 1;
          return s;
        };

        if (effect.target === 'same' && sharedTargets) {
          targets = [...sharedTargets];
        } else if (effect.type === 'grant_counter' && effect.target === 'creature') {
          const allCreatures = state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a: any, b: any) => _scoreGYTarget(b) - _scoreGYTarget(a));
          if (allCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: allCreatures[0]._uid });
            if (!sharedTargets) sharedTargets = [...targets];
          }
        } else if (effect.type === 'counter' && effect.target === 'creature') {
          const allCreatures = state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c))
            .sort((a: any, b: any) => _scoreGYTarget(b) - _scoreGYTarget(a));
          if (allCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: allCreatures[0]._uid });
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

export function _computeGamePlan(state: any, playerId: number): string {
  const myLife = state.players[playerId].life;
  const boardScore = _evaluateBoard(state, playerId);
  const oppId = playerId === 0 ? 1 : 0;
  const oppCreatures = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c));
  const myCreatures = state.players[playerId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c));

  if (myLife <= 4 || boardScore < -35) return 'stabilizing';
  if (boardScore < -8 && oppCreatures.length >= 2) return 'reactive';
  if (boardScore > 12 || (myCreatures.length >= 3 && oppCreatures.length === 0)) return 'proactive';

  // Stall detection: if boardScore looks neutral but neither side can attack profitably
  // → neither player is "ahead" in the normal sense; need to break parity differently
  if (myCreatures.length >= 2 && oppCreatures.length >= 2 && boardScore >= -8 && boardScore <= 12) {
    // Check if all my creatures are blocked (stalled) while opponent has no evasion either
    const myEvasion = myCreatures.some((c: any) =>
      CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace') ||
      !oppCreatures.some((b: any) => CardEngine.canBlock(b, c, state))
    );
    const oppEvasion = oppCreatures.some((c: any) =>
      CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace') ||
      !myCreatures.some((b: any) => CardEngine.canBlock(b, c, state))
    );
    if (!myEvasion && !oppEvasion) return 'reactive'; // True stall → be reactive, find an out
  }

  return 'neutral';
}

// =================== TURNS TO LETHAL HELPER ===================
// Returns estimated turns until each player wins at current board state.
// mine: turns for us to kill opponent (evasion power only — assumes optimal blocks)
// opp:  turns for opponent to kill us (their evasion power vs our blocks)
export function _turnsToLethal(state: any, playerId: number): { mine: number; opp: number } {
  const oppId = playerId === 0 ? 1 : 0;
  const myLife = state.players[playerId].life;
  const oppLife = state.players[oppId].life;
  const myCreatures = state.players[playerId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c));
  const oppCreatures = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && !c._tapped);
  const oppAttackers = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canAttack(c));

  // My clock: evasion power — count creatures that can reliably deal damage
  let myEvasionPower = 0;
  for (const c of myCreatures.filter((c: any) => CardEngine.canAttack(c))) {
    const pwr = CardEngine.getPower(c);
    if (CardEngine.hasKeyword(c, 'Vigilance') || CardEngine.hasIndestructible(c) ||
        CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace') ||
        !oppCreatures.some((b: any) => CardEngine.canBlock(b, c, state))) {
      myEvasionPower += pwr;
    }
  }

  // Opp clock: power that can't be blocked
  let oppEffPower = 0;
  for (const c of oppAttackers) {
    if (!myCreatures.some((b: any) => CardEngine.canBlock(b, c, state))) {
      oppEffPower += CardEngine.getPower(c);
    }
  }

  return {
    mine: myEvasionPower > 0 ? Math.ceil(oppLife / myEvasionPower) : 99,
    opp: oppEffPower > 0 ? Math.ceil(myLife / oppEffPower) : 99,
  };
}

function _isBoardStalled(state: any, playerId: number): boolean {
  const oppId = playerId === 0 ? 1 : 0;
  const myCreatures = state.players[playerId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canAttack(c));
  const oppCreatures = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && !c._tapped);

  if (myCreatures.length === 0 || oppCreatures.length === 0) return false;

  for (const c of myCreatures) {
    const validBlockers = oppCreatures.filter((b: any) => CardEngine.canBlock(b, c, state));
    if (validBlockers.length === 0) return false; // Tem evasion — não está stalled
    if (CardEngine.hasKeyword(c, 'First Strike') || CardEngine.hasKeyword(c, 'Double Strike') ||
        CardEngine.hasKeyword(c, 'Deathtouch') || CardEngine.hasIndestructible(c)) return false;
    const bestBlocker = validBlockers.slice().sort((a: any, b: any) =>
      CardEngine.getPower(b) - CardEngine.getPower(a))[0];
    const creatureDies = CardEngine.getPower(bestBlocker) >= CardEngine.getToughness(c);
    const blockerDies = CardEngine.getPower(c) >= CardEngine.getToughness(bestBlocker);
    if (blockerDies && !creatureDies) return false; // Ataque favorável existe
  }
  return true; // Todos os ataques são ruins
}

export function declareAttackers(state: any, playerId: number): void {
  const bf = state.players[playerId].zones.battlefield;
  const creatures = bf.cards.filter((c: any) => CardEngine.canAttack(c));
  const oppId = playerId === 0 ? 1 : 0;
  const opponentLife = state.players[oppId].life;
  const myLife = state.players[playerId].life;
  const opponentCreatures = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && !c._tapped);
  const myCreatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));

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

  // Opponent removal risk: if opp has untapped mana and a small hand,
  // they may be holding an instant removal spell — reduce our trick confidence
  const oppUntappedLands = state.players[oppId].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isLand(c) && !c._tapped
  ).length;
  const oppHandSize = state.players[oppId].zones.hand.count();
  // Graveyard analysis: if opponent has ≥2 instants in GY they're playing an instant-heavy deck → likely holding more
  const oppGy = state.players[oppId].zones.graveyard?.getAll?.() ?? [];
  const oppInstantsInGy = oppGy.filter((c: any) => (c.type_line || '').toLowerCase().includes('instant')).length;
  // Likely holding removal: 2+ untapped mana + small hand, OR has played many instants already (pattern = instant player)
  const oppLikelyHasRemoval = (oppUntappedLands >= 2 && oppHandSize >= 1 && oppHandSize <= 4)
    || (oppInstantsInGy >= 2 && oppUntappedLands >= 1 && oppHandSize >= 1);
  // Reduce trick confidence when opponent probably has removal — our trick won't save the creature
  const effectiveCombatTrick = hasCombatTrick && !oppLikelyHasRemoval;

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
  // Better race calculation: only count opponent power we CAN'T stop
  const allOppAttackers = state.players[oppId].zones.battlefield.cards
    .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canAttack(c));
  let oppEffectivePower = 0;
  // First pass: pure evasion (no blockers at all)
  for (const c of allOppAttackers) {
    const myBlockers = myCreatures.filter((b: any) => CardEngine.canBlock(b, c, state));
    if (myBlockers.length === 0) oppEffectivePower += CardEngine.getPower(c);
  }
  // Second pass: if opponent has MORE attackers than I have blockers, add power of the extras
  const blockableAtks = allOppAttackers.filter((c: any) =>
    myCreatures.some((b: any) => CardEngine.canBlock(b, c, state))
  ).sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
  const surplusAtks = Math.max(0, blockableAtks.length - myCreatures.length);
  for (let i = 0; i < surplusAtks && i < blockableAtks.length; i++) {
    oppEffectivePower += CardEngine.getPower(blockableAtks[i]);
  }
  const myClockTurns = myEvasionPower > 0 ? Math.ceil(opponentLife / myEvasionPower) : 99;
  const oppClockTurns = oppEffectivePower > 0 ? Math.ceil(myLife / oppEffectivePower) : 99;
  const winningRace = myClockTurns <= oppClockTurns;

  const gamePlan = _computeGamePlan(state, playerId);

  // Stabilizing: só ataca com criaturas seguras — mantém criaturas para bloquear
  if (gamePlan === 'stabilizing') {
    // Safe = vigilance, indestructible, OR truly unblockable (can't be blocked at all)
    const safeCreatures = creatures.filter((c: any) =>
      CardEngine.hasKeyword(c, 'Vigilance') || CardEngine.hasIndestructible(c) ||
      !opponentCreatures.some((b: any) => CardEngine.canBlock(b, c, state))
    );
    if (safeCreatures.length === 0) return;
    // CombatSim with only safe creatures — don't risk losing our defenders
    const safeSnaps = safeCreatures.map((c: any) => CombatSim._snapshot(c, state));
    const oppSnaps2 = opponentCreatures.map((c: any) => CombatSim._snapshot(c, state));
    const safeResult = CombatSim.findBestAttackers(safeSnaps, oppSnaps2, opponentLife, myLife, boardScore, false);
    for (const idx of safeResult.attackerIndices) {
      CombatSystem.declareAttacker(state.combat, safeCreatures[idx]);
    }
    if (state.combat.attackers.length > 0) {
      state.combat.attackers.forEach(({ card: atkCard }: any) => {
        if (!CardEngine.hasKeyword(atkCard, 'Vigilance') && !atkCard._tapped) {
          atkCard._tapped = true;
          atkCard._tappedByAttack = true;
        }
      });
      state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s) seguras (estabilizando).`);
      if (!state._aiActions) state._aiActions = [];
      state._aiActions.push({
        type: 'attack',
        attackers: state.combat.attackers.filter((c: any) => c).map((c: any) => ({
          name: c.name || 'Criatura', image_normal: c.image_normal || '', image_small: c.image_small || '',
          power: CardEngine.getPower(c), toughness: CardEngine.getToughness(c)
        })),
        description: `Oponente ataca com ${state.combat.attackers.length} criatura(s) seguras`
      });
    }
    return;
  }

  const oppFlyerBlockers = opponentCreatures.filter((c: any) =>
    CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Reach')
  );

  // === CombatSim-based attack decision ===
  if (typeof CombatSim !== 'undefined') {
    const mySnaps = creatures.map((c: any) => CombatSim._snapshot(c, state));
    const oppSnaps = opponentCreatures.map((c: any) => CombatSim._snapshot(c, state));

    const simResult = CombatSim.findBestAttackers(mySnaps, oppSnaps, opponentLife, myLife, boardScore, effectiveCombatTrick);

    if (simResult.attackerIndices.length > 0) {
      for (const idx of simResult.attackerIndices) {
        CombatSystem.declareAttacker(state.combat, creatures[idx]);
      }
      if (state.combat.attackers.length > 0) {
        state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s).`);
        // AiBrain: use NN to identify the most strategically significant attacker to record
        if (aiBrain.isReady()) {
          try {
            const _atkBf = aiBrain.extractBoardFeatures(state, playerId);
            const _allAtkCards = state.combat.attackers
              .map((a: any) => a.card ?? a)
              .filter(Boolean);
            if (_allAtkCards.length > 1) {
              // Re-rank attackers by NN: record the one the NN deems most impactful
              const _nnRank = aiBrain.scoreActionsSync(_atkBf, _allAtkCards, 'attack');
              const _bestAtk = _allAtkCards[_nnRank[0]];
              if (_bestAtk) aiBrain.recordDecision(_atkBf, aiBrain.extractActionFeatures(_bestAtk, 'attack'));
            } else if (_allAtkCards[0]) {
              aiBrain.recordDecision(_atkBf, aiBrain.extractActionFeatures(_allAtkCards[0], 'attack'));
            }
          } catch { /* non-fatal */ }
        }
        state.combat.attackers.forEach(({ card }: any) => {
          if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
            card._tapped = true;
            card._tappedByAttack = true;
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
          }
        }
      }
    }

    // Race penalty: perdendo a corrida, só evasion attacks valem
    if (!winningRace && (gamePlan === 'reactive' || gamePlan === 'stabilizing')) {
      const hasEvasion = CardEngine.hasKeyword(creature, 'Flying') ||
        CardEngine.hasKeyword(creature, 'Menace') ||
        !opponentCreatures.some((b: any) => CardEngine.canBlock(b, creature, state));
      if (!hasEvasion) attackValue -= 8;
    }

    // Oponente tem mana livre + cartas na mão: suspeita de trick/removal
    const oppUntappedLands = state.players[oppId].zones.battlefield.cards
      .filter((c: any) => CardEngine.isLand(c) && !c._tapped).length;
    const oppHandSize = state.players[oppId].zones.hand.count();
    if (!CardEngine.hasKeyword(creature, 'Vigilance') && !CardEngine.hasIndestructible(creature) && oppHandSize > 0) {
      // Probability of trick scales with both mana available AND cards in hand
      if (oppUntappedLands >= 3 && oppHandSize >= 3) attackValue -= 3; // High alert
      else if (oppUntappedLands >= 2 && oppHandSize >= 2) attackValue -= 2; // Moderate concern
      else if (oppUntappedLands >= 2) attackValue -= 1; // Some mana but small hand
      else if (oppUntappedLands === 1 && oppHandSize >= 3) attackValue -= 1; // Probably a 1-mana trick
      // 0 untapped lands: no risk regardless of hand size
    }

    if (attackValue > 0) {
      CombatSystem.declareAttacker(state.combat, creature);
    }
  }

  // Log fallback attackers if any were declared
  if (state.combat.attackers && state.combat.attackers.length > 0) {
    state.combat.attackers.forEach(({ card }: any) => {
      if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
        card._tapped = true;
        card._tappedByAttack = true;
      }
    });
    state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s). (fallback)`);
  }
}

// --- CONTINUES IN game-ai-part2.ts ---
