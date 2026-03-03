// @ts-nocheck
// stack-part2.ts — Second half of stack module (legacy stack.js lines 1701-3457)

import * as Cards from './cards';
import * as Mana from './mana';
import * as CardUtils from './card-utils';
import * as GameState from './game-state';

// Legacy name aliases
const CardEngine = { ...Cards, ...CardUtils };
const ManaSystem = Mana;

// ============================================================
// _resolveItem case handlers — lines 1701-3321 (continuation)
// ============================================================
// These are exported as standalone functions that correspond to
// the switch-case arms inside _resolveItem in the legacy code.
// Each function receives the same local variables that were in
// scope inside that switch statement and mutates them in place,
// returning any log messages via the shared `log` array.

export function handleBuffAll(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const targetId = effect.target === 'own_creatures' ? controller : opponent;
  const creatures = state.players[targetId].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );
  for (const c of creatures) {
    const p = effect.power === 'double' ? CardEngine.getPower(c) : (effect.power || 0);
    const t = effect.toughness === 'double' ? CardEngine.getToughness(c) : (effect.toughness || 0);
    c._powerMod = (c._powerMod || 0) + p;
    c._toughnessMod = (c._toughnessMod || 0) + t;
    c._tempPowerMod = (c._tempPowerMod || 0) + p;
    c._tempToughnessMod = (c._tempToughnessMod || 0) + t;
  }
  if (effect.keywords) {
    for (const c of creatures) {
      if (!c._tempKeywords) c._tempKeywords = [];
      effect.keywords.forEach((kw: string) => {
        if (!c._tempKeywords.includes(kw)) c._tempKeywords.push(kw);
      });
    }
  }
  log.push(`All your creatures get buffed until end of turn.`);
}

export function handleBlight(
  state: any,
  effect: any,
  controller: number,
  effects: any[],
  ei: number,
  log: string[]
): string[] | null {
  const blightAmt = effect.amount || 1;
  if (controller === 0 && state.players[0].isHuman) {
    const hasCreatures = state.players[controller].zones.battlefield.cards.some((c: any) =>
      CardEngine.isCreature(c)
    );
    if (hasCreatures) {
      GameState._setupBlightChoice(state, controller, blightAmt, () => {
        if (effect.bonus && effect.bonus.length > 0) {
          effects.splice(ei + 1, 0, ...effect.bonus);
        }
      });
      log.push(`Blight ${blightAmt}: escolha uma criatura.`);
    }
  } else {
    const blightResult = GameState._performBlight(state, controller, blightAmt);
    if (blightResult) {
      log.push(blightResult);
      if (effect.bonus && effect.bonus.length > 0) {
        effects.splice(ei + 1, 0, ...effect.bonus);
      }
    }
  }
  return null;
}

export function handleBlightOpponent(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const blightOppAmt = effect.amount || 1;
  const blightOppResult = GameState._performBlight(state, opponent, blightOppAmt);
  if (blightOppResult) log.push(blightOppResult);
}

export function handleGrantHaste(
  state: any,
  controller: number,
  log: string[]
): void {
  const hasteCreatures = state.players[controller].zones.battlefield.cards.filter(
    (c: any) => CardEngine.isCreature(c) && c._summoningSick
  );
  if (hasteCreatures.length > 0) {
    hasteCreatures.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
    const hasteTarget = hasteCreatures[0];
    hasteTarget._summoningSick = false;
    log.push(`${hasteTarget.name} gains Haste!`);
  }
}

export function handleGrantHarmonize(
  state: any,
  controller: number,
  log: string[]
): void {
  const gySpells = state.players[controller].zones.graveyard
    .getAll()
    .filter((c: any) => CardEngine.isInstant(c) || CardEngine.isSorcery(c));
  if (gySpells.length > 0) {
    gySpells.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const grantedSpell = gySpells[0];
    grantedSpell._harmonizeGranted = true;
    log.push(`${grantedSpell.name} gains harmonize (cost: ${grantedSpell.mana_cost}).`);
  } else {
    log.push('No instant/sorcery in graveyard to gain harmonize.');
  }
}

export function handleStun(
  state: any,
  effect: any,
  targets: any[],
  log: string[]
): void {
  const stunAmt = effect.amount || 1;
  if (targets && targets.length > 0) {
    const stunTarget = targets[0];
    const stunCreature = state.players[stunTarget.player].zones.battlefield.get(stunTarget.uid);
    if (stunCreature) {
      stunCreature._stunCounters = (stunCreature._stunCounters || 0) + stunAmt;
      log.push(`${stunCreature.name} gets ${stunAmt} stun counter(s).`);
    }
  }
}

export function handleStunCounterSelf(
  state: any,
  effect: any,
  card: any,
  log: string[]
): void {
  const stunAmt = effect.amount || 1;
  if (card) {
    card._stunCounters = (card._stunCounters || 0) + stunAmt;
    log.push(`${card.name} gets ${stunAmt} stun counter(s).`);
  }
}

export function handleThreaten(
  state: any,
  effect: any,
  targets: any[],
  controller: number,
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const stolenTargetInfo = targets[0];
    const stolenCard = state.players[stolenTargetInfo.player].zones.battlefield.get(
      stolenTargetInfo.uid
    );
    if (stolenCard && stolenTargetInfo.player !== controller) {
      const originalOwner = stolenTargetInfo.player;
      state.players[originalOwner].zones.battlefield.remove(stolenCard._uid);
      stolenCard._tapped = false;
      stolenCard._summoningSick = false;
      stolenCard._stolenFrom = originalOwner;
      stolenCard._tempKeywords = stolenCard._tempKeywords || [];
      if (!stolenCard._tempKeywords.includes('Haste')) stolenCard._tempKeywords.push('Haste');
      state.players[controller].zones.battlefield.add(stolenCard);
      const ctrlLabel = controller === 0 ? 'You' : 'Opponent';
      log.push(`${ctrlLabel} steal${controller === 0 ? '' : 's'} ${stolenCard.name} until end of turn!`);
    }
  }
}

export function handleClash(
  state: any,
  effect: any,
  card: any,
  controller: number,
  effects: any[],
  ei: number,
  targets: any[],
  log: string[]
): string[] | null {
  const opponent = controller === 0 ? 1 : 0;
  const myLib = state.players[controller].zones.library;
  const oppLib = state.players[opponent].zones.library;
  const myCard = myLib.drawFromTop();
  const oppCard = oppLib.drawFromTop();

  if (!myCard && !oppCard) {
    log.push('Clash: both libraries are empty.');
    return null;
  }

  const myCmc = myCard ? (myCard.cmc || 0) : -1;
  const oppCmc = oppCard ? (oppCard.cmc || 0) : -1;
  const won = myCmc > oppCmc;

  if (controller === 0 && state.players[0].isHuman) {
    state._pendingClash = {
      cardName: card.name,
      myCard,
      oppCard,
      myCmc,
      oppCmc,
      won,
      controller,
      card,
      bonusEffects: effect.bonus || [],
      remainingEffects: effects.slice(ei + 1),
      targets,
    };
    state.waitingForInput = { type: 'clash', playerId: controller };
    const myName = myCard ? myCard.name : '(empty)';
    const oppName = oppCard ? oppCard.name : '(empty)';
    log.push(
      `Clash! You reveal ${myName} (${myCmc}), opponent reveals ${oppName} (${oppCmc}).`
    );
    log.push(won ? 'You win the clash!' : 'Opponent wins the clash.');
    return log; // Pause — wait for human to choose top/bottom
  } else {
    const myName = myCard ? myCard.name : '(empty)';
    const oppName = oppCard ? oppCard.name : '(empty)';
    log.push(
      `Clash! ${controller === 0 ? 'You reveal' : 'AI reveals'} ${myName} (${myCmc}) vs ${oppName} (${oppCmc}).`
    );

    if (myCard) {
      const keepOnTop = myCmc >= 3 || CardEngine.isCreature(myCard);
      if (keepOnTop) myLib.addToTop(myCard);
      else myLib.addToBottom(myCard);
    }
    if (oppCard) {
      const keepOnTop = oppCmc >= 3 || CardEngine.isCreature(oppCard);
      if (keepOnTop) oppLib.addToTop(oppCard);
      else oppLib.addToBottom(oppCard);
    }

    const aiWon = controller === 1 ? oppCmc > myCmc : won;
    if (aiWon) {
      log.push(`${controller === 0 ? 'You win' : 'AI wins'} the clash!`);
      if (effect.bonus && effect.bonus.length > 0) {
        effects.splice(ei + 1, 0, ...effect.bonus);
      }
    } else {
      log.push(`${controller === 0 ? 'You lose' : 'AI loses'} the clash.`);
    }
  }
  return null;
}

/**
 * Undo a counter spell that can't legally resolve — return spell to hand + restore mana.
 */
function _undoCounterSpell(state: any, controller: number, log: string[]) {
  // Use existing pre-cast mana snapshot if available
  if (state._preCastManaSnapshot) {
    state.manaPool[controller] = { ...state._preCastManaSnapshot.pool };
    const bf = state.players[controller].zones.battlefield;
    for (const land of bf.cards) {
      if (state._preCastManaSnapshot.tapped.includes(land._uid)) {
        land._tapped = true;
      } else {
        land._tapped = false;
      }
    }
    state._preCastManaSnapshot = null;
  }
  // Return spell from GY or pending to hand
  if (state._pendingSpellToGY && state._pendingSpellToGY.card) {
    state.players[controller].zones.hand.add(state._pendingSpellToGY.card);
    state._pendingSpellToGY = null;
    log.push('Spell returns to hand (illegal target).');
  } else {
    // Try to find it in GY
    const gy = state.players[controller].zones.graveyard;
    const allGy = gy.getAll();
    const last = allGy[allGy.length - 1];
    if (last) {
      gy.remove(last._uid);
      state.players[controller].zones.hand.add(last);
      log.push('Spell returns to hand (illegal target).');
    }
  }
  // Show notification
  if (!state._triggerToastQueue) state._triggerToastQueue = [];
  state._triggerToastQueue.push({
    id: Date.now(),
    cardName: 'Counter falhou',
    effectDesc: 'Alvo é creature spell — não pode ser counterado por este efeito. Magia volta para a mão.',
    controllerId: controller,
    imageUrl: null,
    imageUrlLarge: null,
  });
}

export function handleCounterSpell(
  state: any,
  effect: any,
  targets: any[],
  controller: number,
  log: string[]
): string[] | null {
  const opponent = controller === 0 ? 1 : 0;
  if (!targets || targets.length === 0) {
    log.push('Counter spell requires a target (spell on the stack).');
    return null;
  }

  // targets[0] may be the card object directly, or a wrapper with .card/.uid
  const targetSpell = targets[0]?.card ?? targets[0];
  if (!targetSpell || !targetSpell.name) {
    log.push('Invalid target for counter.');
    return null;
  }
  // Surrak, Elusive Hunter — "This spell can't be countered"
  if (targetSpell._uncounterable) {
    log.push(`${targetSpell.name} can't be countered.`);
    return null;
  }

  // Validate noncreature_spell restriction (e.g. Riverwalk Technique counter mode)
  if (effect.target === 'noncreature_spell') {
    const tl = (targetSpell.type_line || '').toLowerCase();
    if (tl.includes('creature')) {
      log.push(`${targetSpell.name} is a creature spell — can't be countered by this effect.`);
      // Return spell to hand + restore mana (undo)
      _undoCounterSpell(state, controller, log);
      return null;
    }
  }

  if (effect.max_mana_value !== undefined) {
    const spellCMC = targetSpell.cmc || 0;
    if (spellCMC > effect.max_mana_value) {
      log.push(
        `${targetSpell.name} has mana value ${spellCMC}, can't be countered (max ${effect.max_mana_value}).`
      );
      return null;
    }
  }

  if (effect.unless_pay !== undefined) {
    const wasDragonBeheld = !!(state._beholding && state._beholding[controller]);
    // If unless_pay is "X", use the actual X value that was paid (e.g. Spectral Denial)
    const basePayNum = effect.unless_pay === 'X' ? (state._currentXValue || 0) : effect.unless_pay;
    const baseCost = basePayNum;
    const costWithBehold = effect.unless_pay_with_behold !== undefined
      ? (effect.unless_pay_with_behold === 'X' ? (state._currentXValue || 0) : effect.unless_pay_with_behold)
      : baseCost;
    const finalCost = wasDragonBeheld ? costWithBehold : baseCost;
    const costStr = `{${finalCost}}`;

    const fakeCard = { mana_cost: costStr, cmc: finalCost };
    const canPay = ManaSystem.canAfford(state, opponent, fakeCard, costStr, finalCost);

    if (canPay) {
      if (state.players[opponent].isHuman && opponent === 0) {
        state._pendingUnlessPay = {
          spell: targetSpell,
          cost: finalCost,
          costStr,
          spellController: controller,
          effect,
          wasDragonBeheld,
        };
        state.waitingForInput = { type: 'unless_pay_decision', playerId: opponent };
        return null; // Pause for human decision
      } else {
        GameState.autoTapForSpell(state, opponent, costStr, finalCost);
        state.manaPool[opponent] = ManaSystem.payMana(
          state.manaPool[opponent],
          costStr,
          finalCost
        );
        const label = wasDragonBeheld ? `{${finalCost}} (Dragon beheld)` : `{${finalCost}}`;
        log.push(
          `${targetSpell.name} was not countered (${opponent === 0 ? 'You' : 'AI'} paid ${label}).`
        );
        return null; // Don't counter
      }
    }
  }

  targetSpell._countered = true;
  log.push(`${targetSpell.name} is countered.`);
  return null;
}

export function handleEndure(
  state: any,
  effect: any,
  card: any,
  controller: number,
  resolveAmount: (v: any) => number,
  log: string[]
): string[] | null {
  const endureAmt = resolveAmount(effect.amount) || 1;
  const endureCard = state.players[controller].zones.battlefield.get(card._uid);
  if (!endureCard || !CardEngine.isCreature(endureCard)) {
    for (let i = 0; i < endureAmt; i++) {
      const token = CardEngine.createToken(controller, 1, 1, 'Spirit', []);
      state.players[controller].zones.battlefield.add(token);
    }
    log.push(`Endure ${endureAmt}: creates ${endureAmt} 1/1 Spirit(s).`);
  } else if (state.players[controller].isHuman) {
    state._pendingEndure = { cardUid: card._uid, amount: endureAmt, controllerId: controller };
    state.waitingForInput = { type: 'endure_choice', playerId: controller };
    log.push(`Endure ${endureAmt} - choose between counters or tokens.`);
    return log;
  } else {
    if (!endureCard._counters) endureCard._counters = { '+1/+1': 0, '-1/-1': 0 };
    endureCard._counters['+1/+1'] += endureAmt;
    log.push(`${endureCard.name} endure ${endureAmt}: +${endureAmt} +1/+1 counters.`);
  }
  return null;
}

export function handleLoseLife(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const loseTarget = effect.target === 'self' ? controller : opponent;
  state.players[loseTarget].life -= effect.amount || 0;
  GameState._checkWinner(state);
  log.push(
    `${loseTarget === controller ? 'You lose' : 'Opponent loses'} ${effect.amount} life.`
  );
}

export function handleGainLife(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const gainTarget = effect.target === 'opponent' ? opponent : controller;
  state.players[gainTarget].life += effect.amount || 0;
  log.push(
    `${gainTarget === controller ? 'You gain' : 'Opponent gains'} ${effect.amount} life.`
  );
}

export function handleDrain(
  state: any,
  effect: any,
  controller: number,
  resolveAmount: (v: any) => number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const drainAmt = resolveAmount(effect.amount);
  state.players[opponent].life -= drainAmt;
  state.players[controller].life += drainAmt;
  GameState._checkWinner(state);
  log.push(
    `Drain ${drainAmt}: opponent loses ${drainAmt} life, you gain ${drainAmt} life.`
  );
  const drainGainLogs = GameState.fireTrigger(state, 'gain_life', { playerId: controller });
  log.push(...drainGainLogs);
}

export function handleLoot(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): string[] | null {
  const drawAmt = effect.draw || effect.amount || 1;
  const discardAmt = effect.discard || effect.amount || 1;

  const drawnCards: any[] = [];
  for (let i = 0; i < drawAmt; i++) {
    const drawn = state.players[controller].zones.library.drawFromTop();
    if (drawn) {
      state.players[controller].zones.hand.add(drawn);
      drawnCards.push(drawn);
    }
  }
  if (drawnCards.length === 0) return null;

  log.push(`Draw ${drawnCards.length} card(s) (loot).`);

  if (state.players[controller].isHuman) {
    state._pendingLoot = { amount: discardAmt, controller };
    state.waitingForInput = { type: 'discard_for_loot', playerId: controller };
    log.push(`Choose ${discardAmt} card(s) to discard.`);
    return log;
  } else {
    const handCards = state.players[controller].zones.hand
      .getAll()
      .sort((a: any, b: any) => {
        if (CardEngine.isLand(a) && !CardEngine.isLand(b)) return -1;
        if (!CardEngine.isLand(a) && CardEngine.isLand(b)) return 1;
        return (a.cmc || 0) - (b.cmc || 0);
      });
    for (let i = 0; i < discardAmt && handCards.length > 0; i++) {
      const worst = handCards.shift();
      state.players[controller].zones.hand.remove(worst._uid);
      state.players[controller].zones.graveyard.add(worst);
      log.push(`Discards ${worst.name} (loot).`);
    }
  }
  return null;
}

export function handleRummage(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): string[] | null {
  const rummageAmt = effect.amount || 1;
  const isOptional = effect.optional !== false;
  const upTo = effect.upTo || false;
  const handSize = state.players[controller].zones.hand.count();

  if (handSize === 0) {
    log.push('No cards in hand to discard.');
    return null;
  }

  if (state.players[controller].isHuman && controller === 0) {
    state._pendingRummage = {
      amount: rummageAmt,
      optional: isOptional,
      upTo,
      controller,
      selected: [],
    };
    state.waitingForInput = { type: 'rummage_discard', playerId: controller };
    return log;
  } else {
    const hand = state.players[controller].zones.hand;
    const handCards = hand.getAll().sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));
    let toDiscard = Math.min(rummageAmt, handCards.length);
    if (isOptional && handCards.length <= 2) toDiscard = 0;
    if (upTo && handCards.length <= 3) toDiscard = Math.min(1, toDiscard);

    for (let i = 0; i < toDiscard; i++) {
      const worst = handCards.shift();
      if (worst) {
        hand.remove(worst._uid);
        state.players[controller].zones.graveyard.add(worst);
        log.push(`Discards ${worst.name} (rummage).`);
      }
    }
    if (toDiscard > 0) {
      for (let i = 0; i < toDiscard; i++) {
        const drawn = state.players[controller].zones.library.drawFromTop();
        if (drawn) hand.add(drawn);
      }
      log.push(`Draws ${toDiscard} card(s) (rummage).`);
    } else if (isOptional) {
      log.push('Opponent chooses not to discard.');
    }
  }
  return null;
}

export function handleBounceSelf(
  state: any,
  card: any,
  controller: number,
  log: string[]
): void {
  const bsCard = state.players[controller].zones.battlefield.get(card._uid);
  if (bsCard) {
    state.players[controller].zones.battlefield.remove(bsCard._uid);
    GameState._unregisterCardTriggers(state, bsCard._uid);
    state.players[controller].zones.hand.add(bsCard);
    log.push(`${bsCard.name} returns to its owner's hand.`);
  }
}

/**
 * Traveling Botanist: "Look at the top card of your library.
 * If it's a land card, you may reveal it and put it into your hand.
 * If you don't put the card into your hand, you may put it into your graveyard."
 */
export function handleLookTopBotanist(
  state: any,
  controller: number,
  log: string[]
): string[] | null {
  const lib = state.players[controller].zones.library;
  if (lib.count() === 0) return null;
  const topCard = lib.drawFromTop();
  if (!topCard) return null;
  const isLand = CardEngine.isLand(topCard);

  if (state.players[controller].isHuman) {
    // Human: always show the card and let them choose
    state._pendingBotanistLook = {
      card: topCard,
      isLand,
      controllerId: controller,
    };
    state.waitingForInput = { type: 'botanist_look', playerId: controller };
    return log;
  }

  // AI: if land, take it; otherwise put on top (conservative)
  if (isLand) {
    state.players[controller].zones.hand.add(topCard);
    log.push(`${topCard.name} (land) goes to hand.`);
  } else {
    // AI puts non-land back on top (could be graveyard but top is safer)
    lib.addToTop(topCard);
    log.push(`Looked at top card, kept on top.`);
  }
  return null;
}

export function handleLookTop(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): string[] | null {
  const lookAmt = effect.amount || 1;
  const lib = state.players[controller].zones.library;
  const looked: any[] = [];
  for (let i = 0; i < lookAmt && lib.count() > 0; i++) {
    looked.push(lib.drawFromTop());
  }
  if (looked.length === 0) return null;

  // Reveal + pick one matching card (e.g. Dragonologist: reveal instant/sorcery/Dragon → hand)
  if (effect.reveal) {
    let revealFilter: (c: any) => boolean = () => true;
    if (effect.reveal === 'instant_sorcery_or_dragon') {
      revealFilter = (c: any) => {
        const tl = (c.type_line || '').toLowerCase();
        return tl.includes('instant') || tl.includes('sorcery') || tl.includes('dragon');
      };
    }
    const validCards = looked.filter(revealFilter);
    if (state.players[controller].isHuman) {
      state._pendingRevealPick = {
        cards: looked,
        validUids: validCards.map((c: any) => c._uid),
        controllerId: controller,
        optional: effect.optional !== false,
      };
      state.waitingForInput = { type: 'reveal_pick', playerId: controller };
      return log;
    }
    // AI: pick highest CMC valid card
    if (validCards.length > 0) {
      validCards.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const picked = validCards[0];
      state.players[controller].zones.hand.add(picked);
      log.push(`AI picks ${picked.name} from revealed cards.`);
      const rest = looked.filter((c: any) => c !== picked);
      rest.sort(() => Math.random() - 0.5);
      rest.forEach((c: any) => lib.addToBottom(c));
    } else {
      looked.sort(() => Math.random() - 0.5);
      looked.forEach((c: any) => lib.addToBottom(c));
      log.push('No valid cards to pick from revealed cards.');
    }
    return null;
  }

  if (effect.condition === 'land_to_hand') {
    const lands = looked.filter((c: any) => CardEngine.isLand(c));
    const nonLands = looked.filter((c: any) => !CardEngine.isLand(c));
    const pickCount = effect.pick || 1;
    const isOptional = effect.optional !== false;

    if (state.players[controller].isHuman && lands.length > 0 && isOptional) {
      state._pendingLookTop = {
        type: 'look_top_land_choice',
        cards: looked,
        lands,
        nonLands,
        pickCount,
        playerId: controller,
        selected: [],
      };
      state.waitingForInput = { type: 'look_top_land_choice', playerId: controller };
      log.push(`Choose which land(s) to put into hand (up to ${pickCount}).`);
      return log;
    } else {
      const toHand = lands.slice(0, pickCount);
      const toBottom = [...lands.slice(pickCount), ...nonLands];
      toHand.forEach((c: any) => {
        state.players[controller].zones.hand.add(c);
        log.push(`${c.name} (land) goes to hand.`);
      });
      toBottom.forEach((c: any) => lib.addToBottom(c));
      if (lands.length === 0)
        log.push(`No land found among the top ${looked.length} cards.`);
    }
  } else if (effect.rest_to === 'graveyard') {
    const pickCount = effect.pick || 1;

    if (state.players[controller].isHuman && pickCount > 0 && looked.length >= pickCount) {
      const pickDest = effect.pick_to || 'hand';
      state._pendingLookTop = {
        type: 'look_top_choice',
        cards: looked,
        pickCount,
        pickTo: pickDest,
        choices: new Array(looked.length).fill('graveyard'),
        playerId: controller,
      };
      state.waitingForInput = { type: 'look_top_choice', playerId: controller };
      log.push(pickDest === 'top' ? `Choose ${pickCount} card(s) for top of library.` : `Choose ${pickCount} card(s) for hand.`);
      return log;
    } else {
      looked.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const picked = looked.slice(0, pickCount);
      const rest = looked.slice(pickCount);
      const pickDest2 = effect.pick_to || 'hand';
      picked.forEach((c: any) => {
        if (pickDest2 === 'top') {
          state.players[controller].zones.library.addToTop(c);
          log.push(`${c.name} goes to top of library.`);
        } else {
          state.players[controller].zones.hand.add(c);
          log.push(`${c.name} goes to hand.`);
        }
      });
      rest.forEach((c: any) => state.players[controller].zones.graveyard.add(c));
      if (rest.length > 0) log.push(`${rest.length} card(s) go to the graveyard.`);
    }
  } else if (effect.put_onto_battlefield && effect.condition === 'noncreature_nonland_mv3') {
    const putCount = effect.put_onto_battlefield || 0;
    const candidates = looked.filter(
      (c: any) => CardEngine.isPermanent(c) && !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3
    );
    const rest = looked.filter((c: any) => !candidates.includes(c));

    if (state.players[controller].isHuman && candidates.length > 0) {
      state._pendingLookTop = {
        type: 'look_top_permanent_choice',
        cards: looked,
        candidates,
        rest,
        putCount,
        selected: [],
        playerId: controller,
      };
      state.waitingForInput = { type: 'look_top_permanent_choice', playerId: controller };
      log.push(
        `Choose up to ${putCount} noncreature nonland permanents (CMC <= 3) to put onto the battlefield.`
      );
      return log;
    } else {
      candidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const toBf = candidates.slice(0, putCount);
      const toBottom = [...candidates.slice(putCount), ...rest];
      toBf.forEach((c: any) => {
        const bfCard = Cards.prepareForBattlefield(c);
        bfCard._ownerId = controller;
        state.players[controller].zones.battlefield.add(bfCard);
        log.push(`${c.name} enters the battlefield.`);
      });
      const shuffled = toBottom.sort(() => Math.random() - 0.5);
      shuffled.forEach((c: any) => lib.addToBottom(c));
      if (toBf.length === 0) log.push(`No eligible permanent found.`);
    }
  } else if (effect.rest_to === 'bottom') {
    const pickCount = effect.pick || 1;

    if (state.players[controller].isHuman && pickCount > 0 && looked.length > 0) {
      state._pendingLookTop = {
        type: 'look_top_choice',
        cards: looked,
        pickCount,
        destination: 'hand',
        restDestination: 'bottom',
        choices: looked.map((_c: any, i: number) => (i < pickCount ? 'hand' : 'bottom')),
        playerId: controller,
      };
      state.waitingForInput = { type: 'look_top_choice', playerId: controller };
      log.push(
        `Choose ${pickCount} card(s) for hand (the rest go to the bottom of library).`
      );
      return log;
    } else {
      looked.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const picked = looked.slice(0, pickCount);
      const rest = looked.slice(pickCount);
      picked.forEach((c: any) => {
        state.players[controller].zones.hand.add(c);
        log.push(`${c.name} goes to hand.`);
      });
      rest.forEach((c: any) => lib.addToBottom(c));
      if (rest.length > 0) log.push(`${rest.length} card(s) go to the bottom of library.`);
    }
  } else {
    looked.reverse().forEach((c: any) => lib.addToTop(c));
    log.push(`Looked at the top ${looked.length} card(s).`);
  }
  return null;
}

export function handleDamageAll(
  state: any,
  effect: any,
  controller: number,
  resolveAmount: (v: any) => number,
  log: string[]
): void {
  const dmgAllAmt = resolveAmount(effect.amount);

  if (effect.target === 'creatures_and_planeswalkers') {
    for (const pid of [0, 1]) {
      const bf = state.players[pid].zones.battlefield;
      const creatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));
      const planeswalkers = bf.cards.filter((c: any) => CardEngine.isPlaneswalker(c));
      const dying: any[] = [];

      for (const creature of creatures) {
        creature._damage += dmgAllAmt;
        creature._damagedThisTurn = true;
        if (creature._damage >= CardEngine.getToughness(creature)) {
          dying.push(creature);
          log.push(`${creature.name} takes ${dmgAllAmt} damage and dies.`);
        } else {
          log.push(`${creature.name} takes ${dmgAllAmt} damage.`);
        }
      }

      for (const pw of planeswalkers) {
        GameState.damagePlaneswalker(state, pw, dmgAllAmt, pid);
        log.push(`${pw.name} takes ${dmgAllAmt} damage.`);
      }

      dying.forEach((c: any) => GameState.creatureDies(state, c, pid));
    }
  } else {
    for (const pid of [0, 1]) {
      const bf = state.players[pid].zones.battlefield;
      const creatures = bf.cards.filter((c: any) => CardEngine.isCreature(c));
      const dying: any[] = [];
      for (const creature of creatures) {
        creature._damage += dmgAllAmt;
        creature._damagedThisTurn = true;
        if (creature._damage >= CardEngine.getToughness(creature)) {
          dying.push(creature);
          log.push(`${creature.name} takes ${dmgAllAmt} damage and dies.`);
        } else {
          log.push(`${creature.name} takes ${dmgAllAmt} damage.`);
        }
      }
      dying.forEach((c: any) => GameState.creatureDies(state, c, pid));
    }
  }
}

export function handleUntapAll(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const bf = state.players[controller].zones.battlefield;
  bf.cards.forEach((c: any) => {
    if (
      effect.target === 'merfolk' ||
      effect.target === 'forests' ||
      effect.target === 'elves'
    ) {
      const matchType =
        effect.target === 'forests'
          ? 'Forest'
          : effect.target.charAt(0).toUpperCase() + effect.target.slice(1);
      if (
        (CardEngine.hasCreatureType && CardEngine.hasCreatureType(c, matchType)) ||
        (c.type_line || '').toLowerCase().includes(effect.target.toLowerCase()) ||
        (c.subtypes && c.subtypes.some((s: string) => s.toLowerCase() === effect.target.toLowerCase()))
      ) {
        c._tapped = false;
      }
    } else {
      c._tapped = false;
    }
  });
  log.push(`Untapped all permanents${effect.target ? ' (' + effect.target + ')' : ''}.`);
}

export function handleDiscardHand(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const dhTarget = effect.target === 'self' ? controller : opponent;
  const dhHand = state.players[dhTarget].zones.hand;
  const dhGy = state.players[dhTarget].zones.graveyard;
  const dhCards = dhHand.getAll();
  const count = dhCards.length;
  dhCards.forEach((c: any) => {
    dhHand.remove(c._uid);
    dhGy.add(c);
  });
  const who = dhTarget === 0 ? 'You discard' : 'Opponent discards';
  log.push(`${who} entire hand (${count} card(s)).`);
}

export function handleRevealHand(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const rhTarget = effect.target === 'opponent' ? opponent : controller;
  const rhCards = state.players[rhTarget].zones.hand.getAll();
  if (rhCards.length > 0) {
    log.push(`Hand revealed: ${rhCards.map((c: any) => c.name).join(', ')}.`);
  } else {
    log.push('Hand is empty.');
  }
}

export function handleExileGraveyard(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const egAmt = effect.amount || 999;
  const egPid = effect.target === 'opponent' ? opponent : controller;
  const egGy = state.players[egPid].zones.graveyard;
  const egExile = state.players[egPid].zones.exile;
  const egCards = egGy.getAll().slice(0, egAmt);

  if (effect.optional && state.players[controller].isHuman && egPid === controller) {
    state.waitingForInput = {
      type: 'confirm_optional',
      playerId: controller,
      message: `Exile ${egAmt} cards from your graveyard?`,
    };
    state._pendingExileGraveyard = { cards: egCards, egGy, egExile };
    return;
  }

  egCards.forEach((c: any) => {
    egGy.remove(c._uid);
    egExile.add(c);
  });
  if (egCards.length > 0) log.push(`${egCards.length} card(s) exiled from graveyard.`);
}

export function handleExileFromGraveyard(
  state: any,
  effect: any,
  controller: number,
  effects: any[],
  ei: number,
  targets: any[],
  resolveAmount: (v: any) => number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  let efgPid: number;

  if (effect.target === 'any_graveyard') {
    const myGy = state.players[controller].zones.graveyard.getAll();
    const oppGy = state.players[opponent].zones.graveyard.getAll();

    if (myGy.length > 0 && oppGy.length > 0) {
      if (controller === 0) {
        state.waitingForInput = { type: 'graveyard_choice', playerId: controller };
        state._pendingGraveyardChoice = { effect, controller, opponent, remainingEffects: effects ? effects.slice(ei + 1) : [], targets };
        return;
      } else {
        efgPid = opponent;
      }
    } else if (myGy.length > 0) {
      efgPid = controller;
    } else {
      efgPid = opponent;
    }
  } else {
    efgPid = effect.target === 'opponent' ? opponent : controller;
  }

  const efgGy = state.players[efgPid].zones.graveyard;
  const efgExile = state.players[efgPid].zones.exile;
  const efgAmt = resolveAmount(effect.amount) || 1;
  let efgCards = efgGy.getAll();
  // Filter by type when specified
  if (effect.target === 'creature') {
    efgCards = efgCards.filter((c: any) => CardEngine.isCreature(c));
  } else if (effect.target === 'noncreature') {
    efgCards = efgCards.filter((c: any) => !CardEngine.isCreature(c) && !CardEngine.isLand(c));
  }

  if (efgCards.length > 0) {
    if (effect.choose_cards && controller === 0) {
      let maxAmount: number, minAmount: number;
      if (effect.optional || effect.up_to_max) {
        maxAmount = efgAmt;
        minAmount = 0;
      } else if (effect.exact_amount) {
        maxAmount = efgAmt;
        minAmount = efgAmt;
      } else {
        maxAmount = efgAmt;
        minAmount = efgAmt;
      }

      state.waitingForInput = { type: 'graveyard_card_choice', playerId: controller };
      state._pendingGraveyardCardChoice = {
        playerId: efgPid,
        amount: maxAmount,
        minAmount,
        exactAmount: effect.exact_amount || false,
        cards: efgCards,
        effect,
        controller,
        remainingEffects: effects ? effects.slice(ei + 1) : [],
        targets,
      };
      return;
    } else {
      efgCards.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const pickedCount = Math.min(efgAmt, efgCards.length);
      for (let efgI = 0; efgI < pickedCount; efgI++) {
        const picked = efgCards[efgI];
        efgGy.remove(picked._uid);
        efgExile.add(picked);
        log.push(`${picked.name} exiled from graveyard.`);
      }
      if (pickedCount > 0) {
        state._exiledThisResolution = true;
      }
    }
  }
}

export function handleExileTop(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const etLib = state.players[controller].zones.library;
  const etExile = state.players[controller].zones.exile;
  const etAmt = effect.amount || 1;
  for (let i = 0; i < etAmt; i++) {
    const topCard = etLib.drawFromTop();
    if (topCard) {
      etExile.add(topCard);
      log.push(`${topCard.name} exiled from the top of library.`);
    }
  }
}

export function handleDoubleCounters(
  state: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  const targetUid = targets && targets.length > 0 ? targets[0].uid : card._uid;
  const targetPid = targets && targets.length > 0 ? targets[0].player : controller;

  const dcCard = state.players[targetPid].zones.battlefield.get(targetUid);
  if (dcCard && dcCard._counters) {
    const plus = dcCard._counters['+1/+1'] || 0;
    if (plus > 0) {
      dcCard._counters['+1/+1'] = plus * 2;
      log.push(`${dcCard.name}: contadores +1/+1 dobrados (${plus} -> ${plus * 2}).`);
    }
  }
}

export function handleBounceToLibraryTop(
  state: any,
  targets: any[],
  controller: number,
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const btlTarget = targets[0];
    const btlBf = state.players[btlTarget.player].zones.battlefield;
    const btlCreature = btlBf.get(btlTarget.uid);
    if (btlCreature) {
      if (!CardEngine.canBeTargeted(btlCreature, controller)) {
        log.push(`${btlCreature.name} can't be targeted (hexproof/shroud).`);
        return;
      }
      btlBf.remove(btlCreature._uid);
      GameState._unregisterCardTriggers(state, btlCreature._uid);
      state.players[btlTarget.player].zones.library.addToTop(btlCreature);
      log.push(`${btlCreature.name} put on top of library.`);
    }
  }
}

export function handleReturnLandFromMill(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const rlmGy = state.players[controller].zones.graveyard;
  const rlmLands = rlmGy.getAll().filter((c: any) => CardEngine.isLand(c));
  if (rlmLands.length > 0) {
    const land = rlmLands[rlmLands.length - 1];
    rlmGy.remove(land._uid);
    if (effect.to_hand) {
      state.players[controller].zones.hand.add(land);
      log.push(`${land.name} returns from graveyard to hand.`);
    } else {
      const bfLand = CardEngine.prepareForBattlefield(land);
      bfLand._tapped = true;
      state.players[controller].zones.battlefield.add(bfLand);
      log.push(`${land.name} returns from graveyard to the battlefield tapped.`);
    }
  }
}

export function handleRegenerate(
  state: any,
  effect: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const regTarget = targets[0];
    const regCreature = state.players[regTarget.player].zones.battlefield.get(regTarget.uid);
    if (regCreature) {
      regCreature._regenerateShield = true;
      log.push(`${regCreature.name} gains regeneration shield.`);
    }
  } else {
    const regBf = state.players[controller].zones.battlefield;
    if (effect.target === 'goblin') {
      const goblins = regBf.cards.filter(
        (c: any) =>
          CardEngine.isCreature(c) &&
          CardEngine.hasCreatureType &&
          CardEngine.hasCreatureType(c, 'Goblin')
      );
      if (goblins.length > 0) {
        goblins.forEach((g: any) => {
          g._regenerateShield = true;
        });
        log.push(`Goblins gain regeneration shield.`);
      }
    } else {
      const selfCard = regBf.get(card._uid);
      if (selfCard) {
        selfCard._regenerateShield = true;
        log.push(`${selfCard.name} gains regeneration shield.`);
      }
    }
  }
}

export function handleCounterSelfIfNoDraw(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  if (!state._drewExtraThisTurn || !state._drewExtraThisTurn[controller]) {
    const csifCard = state.players[controller].zones.battlefield.get(card._uid);
    if (csifCard) {
      if (!csifCard._counters) csifCard._counters = { '+1/+1': 0, '-1/-1': 0 };
      csifCard._counters[effect.counter || '+1/+1'] += 1;
      log.push(`${csifCard.name} gets +1/+1 counter (no extra card drawn).`);
    }
  }
}

export function handleRemoveCounters(
  state: any,
  effect: any,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const rcTarget = targets[0];
    const rcCreature = state.players[rcTarget.player].zones.battlefield.get(rcTarget.uid);
    if (rcCreature && rcCreature._counters) {
      const counterType = effect.counter || '+1/+1';
      const removeAmt = effect.amount || rcCreature._counters[counterType] || 0;
      rcCreature._counters[counterType] = Math.max(
        0,
        (rcCreature._counters[counterType] || 0) - removeAmt
      );
      log.push(`Remove ${removeAmt} contador(es) ${counterType} de ${rcCreature.name}.`);
      if (CardEngine.getToughness(rcCreature) <= 0) {
        GameState.creatureDies(state, rcCreature, rcTarget.player);
        log.push(`${rcCreature.name} morre.`);
      }
    }
  }
}

export function handleRemoveCountersAll(
  state: any,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const rcaTarget = targets[0];
    const rcaCreature = state.players[rcaTarget.player].zones.battlefield.get(rcaTarget.uid);
    if (rcaCreature && rcaCreature._counters) {
      let totalRemoved = 0;
      for (const counterType in rcaCreature._counters) {
        totalRemoved += rcaCreature._counters[counterType];
        rcaCreature._counters[counterType] = 0;
      }
      log.push(`Remove todos os ${totalRemoved} contador(es) de ${rcaCreature.name}.`);
      if (CardEngine.getToughness(rcaCreature) <= 0) {
        GameState.creatureDies(state, rcaCreature, rcaTarget.player);
        log.push(`${rcaCreature.name} morre.`);
      }
    }
  }
}

export function handleGrant(
  state: any,
  effect: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  // Support both singular (effect.keyword) and plural (effect.keywords) forms
  const kwList: string[] = [];
  if (effect.keyword) kwList.push(effect.keyword);
  if (Array.isArray(effect.keywords)) kwList.push(...effect.keywords);
  if (kwList.length === 0) return;

  const grantDuration = effect.duration || 'end_of_turn';

  const applyGrant = (gCard: any) => {
    if (!gCard.keywords) gCard.keywords = [];
    if (!gCard._tempKeywords) gCard._tempKeywords = [];
    const granted: string[] = [];
    for (const kw of kwList) {
      const kwCap = kw.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (!gCard.keywords.includes(kwCap)) gCard.keywords.push(kwCap);
      if (grantDuration === 'end_of_turn') {
        gCard._tempKeywords.push({ keyword: kwCap, appliedTurn: state.turn, duration: grantDuration });
      }
      if (kwCap === 'Haste') gCard._summoningSick = false;
      granted.push(kwCap);
    }
    return granted.join(', ');
  };

  if (targets && targets.length > 0) {
    // Apply to all provided targets (e.g., multi-target grants)
    for (const gTarget of targets) {
      const gCreature = state.players[gTarget.player].zones.battlefield.get(gTarget.uid);
      if (gCreature) {
        if (!CardEngine.canBeTargeted(gCreature, controller)) {
          log.push(`${gCreature.name} can't be targeted (hexproof/shroud).`);
          continue;
        }
        const granted = applyGrant(gCreature);
        log.push(`${gCreature.name} gains ${granted}.`);
      }
    }
  } else if (effect.target === 'creatures_with_counters') {
    // Synchronized Charge: grant to all own creatures with +1/+1 counters
    const bf = state.players[controller].zones.battlefield.cards;
    const withCounters = bf.filter((c: any) =>
      CardEngine.isCreature(c) && c._counters && (c._counters['+1/+1'] || 0) > 0
    );
    for (const c of withCounters) {
      const granted = applyGrant(c);
      log.push(`${c.name} gains ${granted}.`);
    }
  } else if (effect.target === 'own_creatures' || effect.target === 'all_creatures') {
    // Grant to all own creatures (or all creatures)
    const bf = state.players[controller].zones.battlefield.cards;
    const creatures = bf.filter((c: any) => CardEngine.isCreature(c));
    for (const c of creatures) {
      applyGrant(c);
    }
    if (creatures.length > 0) log.push(`All creatures gain ${kwList.join(', ')}.`);
  } else if (effect.target === 'own_creature' || effect.target === 'creature') {
    // Grant to a single own creature (pick best, same as the buff auto-pick)
    const ownBf = state.players[controller].zones.battlefield.cards.filter(
      (c: any) => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, controller)
    );
    if (ownBf.length > 0) {
      ownBf.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
      const gTarget = ownBf[0];
      const granted = applyGrant(gTarget);
      log.push(`${gTarget.name} gains ${granted}.`);
    }
  } else if (effect.target === 'opponent_creature' || effect.target === 'opponent_creatures') {
    // Grant keyword(s) to an opponent's creature (e.g. Summit Intimidator: "can't block this turn")
    const oppId = controller === 0 ? 1 : 0;
    const oppBf = state.players[oppId].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c));
    if (oppBf.length > 0) {
      // AI: pick strongest; human: pick weakest to be strategic (or first for simplicity)
      oppBf.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
      const gTarget = oppBf[0];
      const granted = applyGrant(gTarget);
      log.push(`${gTarget.name} gains ${granted} (opponent).`);
    }
  } else if (effect.target === 'next_spell') {
    // Grant uncounterable/etc. to next spell cast this turn
    state._nextSpellGrant = kwList;
    log.push(`Next spell gains ${kwList.join(', ')}.`);
  } else {
    // Default: grant to self (the card itself on the battlefield)
    const gSelf = state.players[controller].zones.battlefield.get(card._uid);
    if (gSelf) {
      const granted = applyGrant(gSelf);
      log.push(`${gSelf.name} gains ${granted}.`);
    }
  }
}

export function handleRegisterTempTrigger(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[],
  targets?: any[]
): void {
  if (!state._tempTriggers) state._tempTriggers = [];

  const tempTrigger: any = {
    event: effect.event,
    effects: effect.effects || [],
    condition: effect.condition,
    controller,
    sourceCard: card,
    expiresAt: 'end_of_turn',
    once: effect.once || false,
  };

  // bind_target: bind to the specific targeted creature (e.g. Desperate Measures: "when it dies")
  if (effect.bind_target && targets && targets.length > 0) {
    tempTrigger.targetCardUid = targets[0].uid || targets[0]._uid;
  }

  state._tempTriggers.push(tempTrigger);
  log.push(
    `Temporary trigger registered: ${effect.event}${effect.once ? ' (once)' : ''}.`
  );
}

export function handleGrantAll(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const gaKw = effect.keyword;
  if (!gaKw) return;
  const gaKwCap = gaKw.charAt(0).toUpperCase() + gaKw.slice(1);
  const gaPid = effect.target === 'opponent_creatures' ? opponent : controller;
  const gaCreatures = state.players[gaPid].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );
  gaCreatures.forEach((c: any) => {
    if (!c.keywords) c.keywords = [];
    if (!c.keywords.includes(gaKwCap)) c.keywords.push(gaKwCap);
    if (!c._tempKeywords) c._tempKeywords = [];
    c._tempKeywords.push(gaKwCap);
    if (gaKwCap === 'Haste') c._summoningSick = false;
  });
  log.push(`All creatures gain ${gaKwCap} until end of turn.`);
}

export function handleGrantCounters(
  state: any,
  effect: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    // Iterate ALL targets (e.g. Rot-Curse Rakshasa: put decayed counter on each of X creatures)
    for (const gcTarget of targets) {
      const gcCreature = state.players[gcTarget.player].zones.battlefield.get(gcTarget.uid);
      if (!gcCreature) continue;
      if (!CardEngine.canBeTargeted(gcCreature, controller)) {
        log.push(`${gcCreature.name} can't be targeted (hexproof/shroud).`);
        continue;
      }
      if (!gcCreature._counters) gcCreature._counters = { '+1/+1': 0, '-1/-1': 0 };

      // Array of keyword counters (e.g. Qarsi Revenant: ["flying","deathtouch","lifelink"])
      if (effect.counters && Array.isArray(effect.counters)) {
        if (!gcCreature.keywords) gcCreature.keywords = [];
        for (const kw of effect.counters) {
          const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
          gcCreature._counters[kwCap] = (gcCreature._counters[kwCap] || 0) + 1;
          if (!gcCreature.keywords.includes(kwCap)) gcCreature.keywords.push(kwCap);
          if (kwCap === 'Haste') gcCreature._summoningSick = false;
        }
        log.push(`${gcCreature.name} gets counters: ${effect.counters.join(', ')}.`);
      } else {
        // Standard numeric counter — resolve "X" dynamically
        const gcAmt = effect.amount === 'X' ? (state._currentXValue || 1) : (effect.amount || 1);
        const gcType = effect.counter || '+1/+1';
        gcCreature._counters[gcType] = (gcCreature._counters[gcType] || 0) + gcAmt;
        // Keyword counter (e.g. decayed): add to keywords array too
        if (gcType !== '+1/+1' && gcType !== '-1/-1') {
          if (!gcCreature.keywords) gcCreature.keywords = [];
          const kwCap = gcType.charAt(0).toUpperCase() + gcType.slice(1);
          if (!gcCreature.keywords.includes(kwCap)) gcCreature.keywords.push(kwCap);
        }
        log.push(`${gcCreature.name} gets ${gcAmt} ${gcType} counter(s).`);
      }
    }
  }
}

export function handleExileTopPlay(
  state: any,
  effect: any,
  controller: number,
  log: string[],
  sourceCardUid?: string
): void {
  const fromGraveyard = effect.from === 'graveyard';
  const etpLib = state.players[controller].zones.library;
  const etpGY = state.players[controller].zones.graveyard;
  const etpAmt = effect.amount || 1;

  for (let i = 0; i < etpAmt; i++) {
    let cardFound: any = null;

    if (fromGraveyard) {
      // Tersa Lightshatter: exile a card from graveyard to play
      const gyCands = etpGY.getAll().filter((c: any) => !CardEngine.isLand(c));
      if (gyCands.length > 0) {
        cardFound = effect.random
          ? gyCands[Math.floor(Math.random() * gyCands.length)]
          : gyCands[0];
        etpGY.remove(cardFound._uid);
      }
    } else if (effect.condition) {
      let filter: (c: any) => boolean = () => true;

      if (effect.condition === 'nonland') {
        filter = (c: any) => !CardEngine.isLand(c);
      } else if (effect.condition === 'noncreature_nonland_mv3') {
        filter = (c: any) =>
          !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3;
      }

      // Exile from top of library until we find a card matching the condition
      // (e.g. Breaching Dragonstorm: exile cards from top until nonland found)
      while (etpLib.cards.length > 0) {
        const topCard = etpLib.cards.shift();
        if (!topCard) break;
        if (filter(topCard)) {
          cardFound = topCard;
          break;
        } else {
          // Card doesn't match — exile it (lands exiled along the way)
          state.players[controller].zones.exile.add(topCard);
          log.push(`${topCard.name} exilado (revelado do topo).`);
        }
      }
    } else {
      cardFound = etpLib.drawFromTop();

      if (cardFound && effect.max_mv && (cardFound.cmc || 0) > effect.max_mv) {
        etpLib.cards.unshift(cardFound);
        cardFound = null;
      }
    }

    if (cardFound) {
      state.players[controller].zones.exile.add(cardFound);
      if (!state._exiledPlayable) state._exiledPlayable = {};

      // freeCast: true if effect.free AND card's CMC is within max_mv (or no max_mv limit)
      const isFree = !!(effect.free && (!effect.max_mv || (cardFound.cmc || 0) <= effect.max_mv));
      state._exiledPlayable[cardFound._uid] = {
        card: cardFound,
        controller,
        turn: state.turn,
        freeCast: isFree,
        duration: effect.duration || 'end_of_turn',
        toHand: effect.optional === true, // if optional, put card back to hand when expired
      };

      // Track exiled card under source permanent for visual display (card peeking from under permanent)
      if (sourceCardUid) {
        const srcCard = state.players[controller].zones.battlefield.get(sourceCardUid);
        if (srcCard) {
          if (!srcCard._exiledCards) srcCard._exiledCards = [];
          srcCard._exiledCards.push({ name: cardFound.name, image_uris: cardFound.image_uris, image_small: cardFound.image_small, _uid: cardFound._uid });
        }
      }

      const who = state.players[controller].isHuman ? 'You exile' : 'Opponent exiles';
      const playableText = effect.free
        ? ' (may play for free this turn)'
        : ' (may play this turn)';
      log.push(`${who} ${cardFound.name}${playableText}.`);

      // Show exile reveal overlay so human can cast immediately
      if (state.players[controller].isHuman && (effect.free || effect.optional)) {
        state._pendingExileReveal = {
          cards: [cardFound],
          controllerId: controller,
          canPlay: true,
        };
        state.waitingForInput = { type: 'exile_reveal', playerId: controller };
      }
    } else if (effect.condition) {
      const who = state.players[controller].isHuman ? 'You' : 'Opponent';
      log.push(`${who} find${state.players[controller].isHuman ? '' : 's'} no valid card in library.`);
    }
  }
}

export function handleSearchLibrary(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): string[] | null {
  // Support effect.controller: "opponent" (e.g., Magmatic Hellkite - opponent searches their library)
  const opponent = controller === 0 ? 1 : 0;
  const resolvedController = effect.controller === 'opponent' ? opponent : controller;

  const slLib = state.players[resolvedController].zones.library;
  const bf = state.players[resolvedController].zones.battlefield;

  let slFilter: (c: any) => boolean;
  if (effect.target === 'creature') {
    slFilter = (c: any) => CardEngine.isCreature(c);
  } else if (effect.target === 'basic_land') {
    slFilter = (c: any) => CardEngine.isBasicLand(c);
  } else if (effect.target === 'land') {
    slFilter = (c: any) => CardEngine.isLand(c);
  } else if (effect.target === 'dragon') {
    slFilter = (c: any) => CardEngine.isDragon(c) || (c.type_line && c.type_line.toLowerCase().includes('dragon'));
  } else if (effect.target === 'named_card' && (effect.name || effect.names)) {
    if (effect.name) {
      slFilter = (c: any) => c.name === effect.name;
    } else {
      slFilter = (c: any) => effect.names.includes(c.name);
    }
  } else {
    slFilter = () => true;
  }

  let slCandidates = slLib.cards.filter(slFilter);

  // X-cost filtering: when condition is mv_X_or_less, filter by CMC <= X paid
  if (effect.condition === 'mv_X_or_less') {
    const xVal = state._currentXValue !== undefined ? state._currentXValue : 0;
    console.log(`[SEARCH X-FILTER] X=${xVal}, before=${slCandidates.length} creatures`);
    slCandidates = slCandidates.filter((c: any) => (c.cmc || 0) <= xVal);
    console.log(`[SEARCH X-FILTER] after=${slCandidates.length} creatures (MV <= ${xVal})`);
  }

  if (slCandidates.length === 0) {
    slLib.shuffle();
    log.push('No card found in library.');
    return null;
  }

  let toTop = effect.to_top || false;
  let toHand = effect.to_hand !== false;
  let toBattlefield = false;
  let tappedDest = effect.tapped || false;

  // Explicit to_battlefield flag overrides default to_hand behavior
  if (effect.to_battlefield) {
    toBattlefield = true;
    toHand = false;
    toTop = false;
  }

  // dragon_condition: branch on whether controller has a Dragon (condition field renamed
  // to avoid stack-part1 from treating it as a gate condition and skipping the effect)
  if (effect.dragon_condition === 'control_dragon' || effect.condition === 'control_dragon') {
    const hasDragon = bf.cards.some((c: any) => CardEngine.hasCreatureType(c, 'Dragon'));
    if (hasDragon) {
      if (effect.if_true) {
        toTop = !!effect.if_true.to_top;
        toHand = !!effect.if_true.to_hand;
        toBattlefield = !toTop && !toHand;
        tappedDest = !!effect.if_true.tapped;
      }
    } else {
      if (effect.if_false) {
        toTop = !!effect.if_false.to_top;
        toHand = !!effect.if_false.to_hand;
        toBattlefield = !toTop && !toHand;
        tappedDest = !!effect.if_false.tapped;
      }
    }
  }

  if (state.players[resolvedController].isHuman && slCandidates.length > 0) {
    const landOptions: any[] = [];
    const seenNames = new Set<string>();
    for (const c of slCandidates) {
      if (!seenNames.has(c.name)) {
        seenNames.add(c.name);
        landOptions.push(c);
      }
    }
    state._pendingSearch = {
      candidates: landOptions,
      controller: resolvedController,
      toHand,
      toBattlefield,
      toTop,
      tapped: tappedDest,
      stunCounter: effect.stun_counter || 0,
      optional: effect.optional || false,
      maxMV: (effect.condition === 'mv_X_or_less' && state._currentXValue !== undefined) ? state._currentXValue : undefined,
    };
    state.waitingForInput = { type: 'search_library', playerId: resolvedController };
    log.push(
      effect.optional
        ? 'Choose a card from your library (or decline).'
        : 'Choose a card from your library.'
    );
    return log;
  } else {
    slCandidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const picked = slCandidates[0];
    const idx = slLib.cards.indexOf(picked);
    if (idx !== -1) slLib.cards.splice(idx, 1);

    if (toHand) {
      state.players[resolvedController].zones.hand.add(picked);
      slLib.shuffle();
      log.push(`Searches for ${picked.name} and puts it into hand.`);
    } else if (toTop) {
      slLib.cards.unshift(picked);
      log.push(`Searches for ${picked.name} and puts it on top of library.`);
    } else if (toBattlefield) {
      const bfCard = CardEngine.prepareForBattlefield(picked);
      bfCard._tapped = tappedDest;
      bfCard._summoningSick = false;
      bfCard._ownerId = resolvedController;
      // Apply stun counter if specified (e.g. Magmatic Hellkite)
      if (effect.stun_counter) {
        bfCard._stunCounters = (bfCard._stunCounters || 0) + effect.stun_counter;
      }
      bf.add(bfCard);
      GameState._registerCardTriggers(state, bfCard, resolvedController);
      slLib.shuffle();
      log.push(`Searches for ${picked.name} and puts it onto the battlefield${tappedDest ? ' tapped' : ''}.`);
    } else {
      state.players[resolvedController].zones.hand.add(picked);
      slLib.shuffle();
      log.push(`Searches for ${picked.name} and puts it into hand.`);
    }
  }
  return null;
}

export function handleSearchLibraryToGraveyard(
  state: any,
  controller: number,
  log: string[],
  effect?: any
): void {
  const sltgLib = state.players[controller].zones.library;
  const sltgGy = state.players[controller].zones.graveyard;

  // Lotuslight Dancers: search for one card of each specified color
  if (effect?.colors && Array.isArray(effect.colors)) {
    if (state.players[controller].isHuman) {
      // Human: show overlay per color
      const colorCandidates: Record<string, any[]> = {};
      for (const color of effect.colors) {
        colorCandidates[color] = sltgLib.cards.filter((c: any) => {
          const cardColors = c.colors || c.color_identity || [];
          const colorArr = typeof cardColors === 'string' ? JSON.parse(cardColors) : cardColors;
          return colorArr.includes(color);
        });
      }
      state._pendingSearchToGY = { colors: effect.colors, colorCandidates, controllerId: controller, chosen: [], currentColorIndex: 0 };
      const firstCandidates = colorCandidates[effect.colors[0]] || [];
      if (firstCandidates.length > 0) {
        state.waitingForInput = { type: 'search_library_to_gy', playerId: controller };
        return; // pause for human
      }
      sltgLib.shuffle();
      log.push('No matching cards found.');
      return;
    }
    // AI: auto-pick highest CMC per color
    const found: any[] = [];
    for (const color of effect.colors) {
      const candidates = sltgLib.cards.filter((c: any) => {
        if (found.some(f => f._uid === c._uid)) return false;
        const cardColors = c.colors || c.color_identity || [];
        const colorArr = typeof cardColors === 'string' ? JSON.parse(cardColors) : cardColors;
        return colorArr.includes(color);
      });
      if (candidates.length > 0) {
        candidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
        found.push(candidates[0]);
      }
    }
    if (found.length > 0) {
      for (const card of found) {
        const idx = sltgLib.cards.indexOf(card);
        if (idx !== -1) sltgLib.cards.splice(idx, 1);
        sltgGy.add(card);
      }
      sltgLib.shuffle();
      log.push(`Searches for ${found.map(c => c.name).join(', ')} and puts them into graveyard.`);
    } else {
      sltgLib.shuffle();
      log.push('No matching cards found.');
    }
    return;
  }

  // Default: search for highest CMC non-land card
  const sltgCards = sltgLib.cards.filter((c: any) => !CardEngine.isLand(c));
  if (sltgCards.length > 0) {
    sltgCards.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const picked = sltgCards[0];
    const idx = sltgLib.cards.indexOf(picked);
    if (idx !== -1) sltgLib.cards.splice(idx, 1);
    sltgGy.add(picked);
    sltgLib.shuffle();
    log.push(`Searches for ${picked.name} and puts it into graveyard.`);
  } else {
    sltgLib.shuffle();
    log.push('No card found.');
  }
}

export function handleCreateTokenCopy(
  state: any,
  effect: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  let sourceCreature: any = null;

  if (effect.type === 'copy_self') {
    // First try battlefield (normal case: already ETB'd)
    // Fallback to the card object itself (cast trigger fires before ETB, e.g. Sage of the Skies)
    sourceCreature = state.players[controller].zones.battlefield.get(card._uid) || card;
  } else if (effect.target === 'exiled_creature') {
    if (card._exiledUntilLeaves && card._exiledUntilLeaves.length > 0) {
      sourceCreature = card._exiledUntilLeaves[card._exiledUntilLeaves.length - 1];
    }
  } else if (targets && targets.length > 0) {
    const ctcTarget = targets[0];
    sourceCreature = state.players[ctcTarget.player].zones.battlefield.get(ctcTarget.uid);
  } else {
    const myCreatures = state.players[controller].zones.battlefield.cards.filter((c: any) =>
      CardEngine.isCreature(c)
    );
    if (myCreatures.length > 0) {
      myCreatures.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
      sourceCreature = myCreatures[0];
    }
  }

  if (sourceCreature) {
    const token = CardEngine.createToken(
      controller,
      sourceCreature.power || CardEngine.getPower(sourceCreature),
      sourceCreature.toughness || CardEngine.getToughness(sourceCreature),
      sourceCreature.name
    );
    if (sourceCreature.keywords) token.keywords = [...sourceCreature.keywords];
    token.type_line = sourceCreature.type_line;
    token.oracle_text = sourceCreature.oracle_text;
    token.mana_cost = sourceCreature.mana_cost;
    token.cmc = sourceCreature.cmc;
    if (sourceCreature.image_small) token.image_small = sourceCreature.image_small;
    if (sourceCreature.image_normal) token.image_normal = sourceCreature.image_normal;
    if (effect.tapped) token._tapped = true;
    if (effect.attacking && state.combat && state.combat.phase !== 'none') {
      token._attacking = true;
      token._tapped = true;
      token._summoningSick = false;
      state.combat.attackers.push({ uid: token._uid, card: token });
    }
    state.players[controller].zones.battlefield.add(token);
    GameState._registerCardTriggers(state, token, controller);
    log.push(`Creates a copy of ${sourceCreature.name}.`);
  } else {
    log.push('No creature to copy.');
  }
}

export function handleBecomeCopy(
  state: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  const selfCreature = state.players[controller].zones.battlefield.get(card._uid);
  if (selfCreature && targets && targets.length > 0) {
    const copyTarget = targets[0];
    const templateCreature = state.players[copyTarget.player].zones.battlefield.get(
      copyTarget.uid
    );
    if (templateCreature && CardEngine.isCreature(templateCreature)) {
      const preservedCounters = selfCreature._counters ? { ...selfCreature._counters } : {};
      const preservedAttachments = selfCreature._attachments
        ? [...selfCreature._attachments]
        : [];

      // Store original card data for revert on death (GY abilities like Naga Fleshcrafter)
      if (!selfCreature._originalCard) {
        selfCreature._originalCard = {
          name: selfCreature.name, power: selfCreature.power, toughness: selfCreature.toughness,
          type_line: selfCreature.type_line, keywords: selfCreature.keywords ? [...selfCreature.keywords] : [],
          oracle_text: selfCreature.oracle_text, mana_cost: selfCreature.mana_cost, cmc: selfCreature.cmc,
          image_normal: selfCreature.image_normal, image_small: selfCreature.image_small,
          colors: selfCreature.colors ? [...selfCreature.colors] : [],
        };
      }
      selfCreature._isCopy = true;
      selfCreature._copiedCardName = templateCreature.name;

      selfCreature.name = templateCreature.name;
      selfCreature.power = templateCreature.power || CardEngine.getPower(templateCreature);
      selfCreature.toughness =
        templateCreature.toughness || CardEngine.getToughness(templateCreature);
      selfCreature.type_line = templateCreature.type_line;
      selfCreature.keywords = templateCreature.keywords ? [...templateCreature.keywords] : [];
      selfCreature.oracle_text = templateCreature.oracle_text;
      selfCreature.mana_cost = templateCreature.mana_cost;
      selfCreature.cmc = templateCreature.cmc;
      selfCreature.colors = templateCreature.colors ? [...templateCreature.colors] : [];

      if (Object.keys(preservedCounters).length > 0) selfCreature._counters = preservedCounters;
      if (preservedAttachments.length > 0) selfCreature._attachments = preservedAttachments;

      // Re-register triggers from copied creature
      GameState._unregisterCardTriggers(state, selfCreature._uid);
      GameState._registerCardTriggers(state, selfCreature, controller);

      log.push(`${selfCreature._originalCard.name} becomes a copy of ${templateCreature.name}.`);
    }
  }
}

export function handleMassClone(
  state: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const templateTarget = targets[0];
    const templateCreature = state.players[templateTarget.player].zones.battlefield.get(
      templateTarget.uid
    );
    if (templateCreature && CardEngine.isCreature(templateCreature)) {
      const myCreatures = state.players[controller].zones.battlefield.cards.filter(
        (c: any) => CardEngine.isCreature(c) && c._uid !== templateCreature._uid
      );

      myCreatures.forEach((creature: any) => {
        if (!creature._originalCard) {
          creature._originalCard = {
            name: creature.name,
            power: creature.power,
            toughness: creature.toughness,
            type_line: creature.type_line,
            keywords: creature.keywords ? [...creature.keywords] : [],
            oracle_text: creature.oracle_text,
            mana_cost: creature.mana_cost,
            cmc: creature.cmc,
            image_normal: creature.image_normal,
            image_small: creature.image_small,
          };
        }

        creature._copyingUntilEOT = true;
        creature.name = templateCreature.name;
        creature.power = templateCreature.power || CardEngine.getPower(templateCreature);
        creature.toughness =
          templateCreature.toughness || CardEngine.getToughness(templateCreature);
        creature.type_line = templateCreature.type_line;
        creature.keywords = templateCreature.keywords ? [...templateCreature.keywords] : [];
        creature.oracle_text = templateCreature.oracle_text;
        creature.image_normal = templateCreature.image_normal;
        creature.image_small = templateCreature.image_small;
        creature.mana_cost = templateCreature.mana_cost;
        creature.cmc = templateCreature.cmc;
      });

      log.push(`Other creatures become copies of ${templateCreature.name} until end of turn.`);
    }
  }
}

export function handleGainControl(
  state: any,
  targets: any[],
  controller: number,
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const gcTarget = targets[0];
    const gcCreature = state.players[gcTarget.player].zones.battlefield.get(gcTarget.uid);
    if (gcCreature && gcTarget.player !== controller) {
      state.players[gcTarget.player].zones.battlefield.remove(gcCreature._uid);
      GameState._unregisterCardTriggers(state, gcCreature._uid);
      gcCreature._originalOwner = gcTarget.player;
      state.players[controller].zones.battlefield.add(gcCreature);
      GameState._registerCardTriggers(state, gcCreature, controller);
      log.push(`Gains control of ${gcCreature.name}!`);
    }
  }
}

export function handleAnthem(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  const anthemPower = effect.power || 0;
  const anthemTough = effect.toughness || 0;
  const anthemCreatures = state.players[controller].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );
  anthemCreatures.forEach((c: any) => {
    c._powerMod = (c._powerMod || 0) + anthemPower;
    c._toughnessMod = (c._toughnessMod || 0) + anthemTough;
  });
  const anthemCard = state.players[controller].zones.battlefield.get(card._uid);
  if (anthemCard) {
    anthemCard._anthem = {
      power: anthemPower,
      toughness: anthemTough,
      keywords: effect.keywords || [],
    };
  }
  if (effect.keywords) {
    anthemCreatures.forEach((c: any) => {
      effect.keywords.forEach((kw: string) => {
        const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
        if (!c.keywords) c.keywords = [];
        if (!c.keywords.includes(kwCap)) c.keywords.push(kwCap);
        if (!c._grantedKeywords) c._grantedKeywords = [];
        c._grantedKeywords.push(kwCap);
      });
    });
  }
  log.push(
    `Anthem: all creatures get +${anthemPower}/+${anthemTough}${
      effect.keywords ? ' ' + effect.keywords.join(', ') : ''
    }.`
  );
}

export function handleTriggered(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  const trigCard = state.players[controller].zones.battlefield.get(card._uid);
  if (trigCard) {
    const trigger = {
      event: effect.event,
      effects: effect.effects || [],
      self: effect.self || false,
      once_per_turn: effect.once_per_turn || false,
      condition: effect.condition || null,
      cardUid: trigCard._uid,
      cardName: trigCard.name,
      controllerId: controller,
    };
    if (!state._triggers) state._triggers = [];
    state._triggers.push(trigger);
    log.push(`${card.name}: triggered ability registered (${effect.event}).`);
  }
}

export function handleStatic(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  const staticCard = state.players[controller].zones.battlefield.get(card._uid);
  if (staticCard) {
    if (!staticCard._staticAbilities) staticCard._staticAbilities = [];
    staticCard._staticAbilities.push(effect);
    log.push(`${card.name}: habilidade estatica aplicada (${effect.ability || 'passive'}).`);
  }
}

export function handleMoveCounters(
  state: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const mcSource = state.players[controller].zones.battlefield.get(card._uid);
    const mcTarget = targets[0];
    const mcDest = state.players[mcTarget.player].zones.battlefield.get(mcTarget.uid);
    if (mcSource && mcDest && mcSource._counters) {
      const plus = mcSource._counters['+1/+1'] || 0;
      if (plus > 0) {
        mcSource._counters['+1/+1'] = 0;
        if (!mcDest._counters) mcDest._counters = { '+1/+1': 0, '-1/-1': 0 };
        mcDest._counters['+1/+1'] += plus;
        log.push(`Move ${plus} contador(es) +1/+1 de ${mcSource.name} para ${mcDest.name}.`);
        if (CardEngine.getToughness(mcSource) <= 0) {
          GameState.creatureDies(state, mcSource, controller);
          log.push(`${mcSource.name} morre.`);
        }
      }
    }
  }
}

export function handleDistributeCounters(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): string[] | null {
  // Resolve dynamic amounts (e.g. "lands_in_gy_count" for Lasyd Prowler)
  let dcAmt: number = 1;
  const rawAmt = effect.amount;
  if (typeof rawAmt === 'number') {
    dcAmt = rawAmt;
  } else if (rawAmt === 'lands_in_gy_count') {
    dcAmt = state.players[controller].zones.graveyard.getAll().filter((c: any) => CardEngine.isLand(c)).length;
  } else if (rawAmt === 'lands_count') {
    dcAmt = state.players[controller].zones.battlefield.cards.filter((c: any) => CardEngine.isLand(c)).length;
  } else if (rawAmt === 'creature_count') {
    dcAmt = state.players[controller].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c)).length;
  } else if (rawAmt) {
    dcAmt = parseInt(rawAmt) || 1;
  }
  const dcType = effect.counter || '+1/+1';
  const dcCreatures = state.players[controller].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );

  if (dcCreatures.length === 0) return null;

  if (state.players[controller].isHuman) {
    state._pendingDistribute = { amount: dcAmt, counter: dcType, controller, card };
    state.waitingForInput = { type: 'distribute_counters', playerId: controller };
    log.push(`Distribua ${dcAmt} contador(es) ${dcType} entre suas criaturas.`);
    return log;
  } else {
    dcCreatures.sort((a: any, b: any) => CardEngine.getPower(b) - CardEngine.getPower(a));
    const target = dcCreatures[0];
    if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
    target._counters[dcType] = (target._counters[dcType] || 0) + dcAmt;
    log.push(`${target.name} recebe ${dcAmt} contador(es) ${dcType}.`);
  }
  return null;
}

export function handleBecomeCreature(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  const bcCard = state.players[controller].zones.battlefield.get(card._uid);
  if (bcCard) {
    bcCard._becomeCreature = true;
    bcCard._becomePower = effect.power || 3;
    bcCard._becomeToughness = effect.toughness || 3;
    if (!bcCard.power) bcCard.power = effect.power || 3;
    if (!bcCard.toughness) bcCard.toughness = effect.toughness || 3;
    if (!bcCard.keywords) bcCard.keywords = [];
    if (effect.keywords) {
      effect.keywords.forEach((kw: string) => {
        const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
        if (!bcCard.keywords.includes(kwCap)) bcCard.keywords.push(kwCap);
      });
    }
    if (effect.type === 'become_dragon') {
      if (effect.keyword) {
        const kwCap = effect.keyword.charAt(0).toUpperCase() + effect.keyword.slice(1);
        if (!bcCard.keywords.includes(kwCap)) bcCard.keywords.push(kwCap);
      }
      bcCard.type_line = (bcCard.type_line || '') + ' Dragon';
    }
    log.push(`${bcCard.name} se torna criatura ${effect.power || 3}/${effect.toughness || 3}.`);
  }
}

export function handleAttach(
  state: any,
  card: any,
  controller: number,
  targets: any[],
  log: string[],
  effect?: any
): void {
  // If effect specifies target: "token", attach the triggering card (equipment) to the last created token
  // e.g. Cori-Steel Cutter: "You may attach Cori-Steel Cutter to that [Monk] token."
  if (effect?.target === 'token' && state._lastCreatedToken) {
    const equipmentCard = state.players[controller].zones.battlefield.get(card._uid);
    const tokenRef = state._lastCreatedToken;
    const tokenUid = typeof tokenRef === 'string' ? tokenRef : tokenRef?._uid;
    const creatureToken = tokenUid ? state.players[controller].zones.battlefield.get(tokenUid) : null;

    if (equipmentCard && creatureToken) {
      // If optional and human player, ask for confirmation
      if (effect?.optional && state.players[controller].isHuman) {
        state._pendingAttachChoice = {
          controller,
          tokenUid: card._uid,          // equipment to attach
          targetUid: tokenUid,           // creature to attach to
          tokenName: equipmentCard.name,
          targetName: creatureToken.name
        };
        state.waitingForInput = { type: 'attach_choice', playerId: controller };
        log.push(`${creatureToken.name} criado. Deseja equipar ${equipmentCard.name} nele?`);
        state._lastCreatedToken = null;
        return;
      }

      // Detach from old creature first
      if (equipmentCard._attachedTo) {
        const oldTarget = state.players[controller].zones.battlefield.get(equipmentCard._attachedTo);
        if (oldTarget) {
          GameState._removeEquipmentEffects(equipmentCard, oldTarget);
          if (oldTarget._attachments) {
            oldTarget._attachments = oldTarget._attachments.filter((uid: string) => uid !== equipmentCard._uid);
          }
        }
      }
      // Auto-equip (AI or not optional): equipment attaches to creature token
      equipmentCard._attachedTo = creatureToken._uid;
      if (!creatureToken._attachments) creatureToken._attachments = [];
      creatureToken._attachments.push(equipmentCard._uid);
      GameState._applyEquipmentEffects(equipmentCard, creatureToken);
      log.push(`${equipmentCard.name} equipado em ${creatureToken.name}.`);
      state._lastCreatedToken = null;
    }
    return;
  }

  // Normal attach: target a creature
  if (targets && targets.length > 0) {
    const attTarget = targets[0];
    const attCreature = state.players[attTarget.player].zones.battlefield.get(attTarget.uid);
    const attCard = state.players[controller].zones.battlefield.get(card._uid);
    if (attCreature && attCard) {
      attCard._attachedTo = attCreature._uid;
      if (!attCreature._attachments) attCreature._attachments = [];
      attCreature._attachments.push(attCard._uid);
      GameState._applyEquipmentEffects(attCard, attCreature);
      log.push(`${attCard.name} equipado em ${attCreature.name}.`);
    }
  }
}

export function handleExileTopOpponent(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const opponent = controller === 0 ? 1 : 0;
  const etoLib = state.players[opponent].zones.library;
  const etoExile = state.players[opponent].zones.exile;

  let etoAmt = 1;
  if (typeof effect.amount === 'number') {
    etoAmt = effect.amount;
  } else if (effect.amount === 'X') {
    etoAmt = 1;
  } else if (effect.amount) {
    etoAmt = parseInt(effect.amount) || 1;
  }

  const exiled: string[] = [];
  for (let i = 0; i < etoAmt; i++) {
    const topCard = etoLib.drawFromTop();
    if (topCard) {
      etoExile.add(topCard);
      exiled.push(topCard.name);
    }
  }
  if (exiled.length > 0) {
    log.push(
      `${exiled.join(', ')} exilado(s) do topo da biblioteca do oponente (${exiled.length}).`
    );
  }
}

export function handleCopySpell(
  state: any,
  controller: number,
  log: string[],
  sourceUid?: string
): void {
  state._pendingSpellCopy = state._pendingSpellCopy || {};
  state._pendingSpellCopy[controller] = sourceUid || true;
  log.push('Proxima magia sera copiada!');
}

export function handleExtraCombat(
  state: any,
  log: string[]
): void {
  state._extraCombat = true;
  log.push('Fase de combate adicional!');
}

function _placeGYCopyOnBattlefield(state: any, controller: number, picked: any, effects: any[], ei: number, log: string[]): void {
  const egccGy = state.players[controller].zones.graveyard;
  const egccExile = state.players[controller].zones.exile;

  // Move original to exile
  egccGy.remove(picked._uid);
  egccExile.add(picked);

  // Create a clean copy for the battlefield
  const copy = CardEngine.prepareForBattlefield({ ...picked });
  copy._uid = `copy_${picked._uid}_${Date.now()}`;
  copy._isCopy = true;
  copy._ownerId = controller;
  // Clear stale data from previous life
  delete copy._exiledByPriest;
  delete copy._exiledCards;

  // CRITICAL: Skip automatic ETB in onAdd — we'll fire it manually AFTER legendary rule
  // This prevents waitingForInput contention between ETB and legendary rule
  copy._etbFired = true;

  // Manually register triggers (onAdd skips this when _etbFired is set)
  state.players[controller].zones.battlefield.add(copy);
  GameState._registerCardTriggers(state, copy, controller);

  // Legendary rule check FIRST (state-based action, happens before triggers in MTG rules)
  let legendRulePending = false;
  if (CardEngine.isLegendary(copy)) {
    const dupes = CardEngine.findLegendaryDuplicates(state, controller, copy.name)
      .filter((c: any) => c._uid !== copy._uid);
    if (dupes.length > 0) {
      if (state.players[controller].isHuman) {
        const allLegends = [copy, ...dupes];
        state._pendingLegendRuleSacrifice = {
          controllerId: controller,
          candidates: allLegends.map((c: any) => ({
            uid: c._uid, name: c.name,
            isCopy: !!c._isCopy,
            isNew: c._uid === copy._uid,
          })),
        };
        state.waitingForInput = { type: 'legend_rule_sacrifice', playerId: controller };
        // Defer ETB until after legend rule resolves
        state._deferredETB = { card: copy, playerId: controller };
        legendRulePending = true;
      } else {
        dupes.forEach((d: any) => {
          state.players[controller].zones.battlefield.remove(d._uid);
          GameState._unregisterCardTriggers(state, d._uid);
          state.players[controller].zones.graveyard.add(d);
        });
      }
    }
  }

  // Fire ETB now if no legend rule is blocking (AI or no duplicates)
  if (!legendRulePending) {
    GameState._fireETBOnEnter(state, copy, controller);
  }

  log.push(`Exila ${picked.name} do cemiterio e joga copia de graca!`);
}

export function handleExileGraveyardCastCopy(
  state: any,
  effect: any,
  controller: number,
  effects: any[],
  ei: number,
  log: string[]
): void {
  const egccGy = state.players[controller].zones.graveyard;
  let egccCandidates = egccGy.getAll().filter((c: any) => !CardEngine.isLand(c));
  if (effect.target === 'nonland_mv3_or_less') {
    egccCandidates = egccCandidates.filter((c: any) => (c.cmc || 0) <= 3);
  }
  if (egccCandidates.length === 0) {
    log.push('Nenhuma carta valida no cemiterio.');
    return;
  }

  // If human controller and multiple options, show overlay for choice
  if (controller === 0 && state.players[0].isHuman && egccCandidates.length > 1) {
    GameState._setupGraveyardCastChoice(state, controller, egccCandidates, (picked: any) => {
      if (!picked) return;
      _placeGYCopyOnBattlefield(state, controller, picked, effects, ei, log);
    });
    log.push(`Escolha uma criatura do cemiterio para exilar e jogar.`);
    return;
  }

  // AI or single option: auto-pick highest CMC
  egccCandidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
  const picked = egccCandidates[0];
  _placeGYCopyOnBattlefield(state, controller, picked, effects, ei, log);
}

// ============================================================
// isEmpty — line 3331
// ============================================================

export function isEmpty(stack: any): boolean {
  return stack.items.length === 0;
}

// ============================================================
// _processNextEffect — lines 3336-3353
// ============================================================

export function processNextEffect(state: any): string[] {
  if (state._pendingStackEffects) {
    const { card, controller, targets, effects, log } = state._pendingStackEffects;
    state._pendingStackEffects = null;

    const tempItem = { card, controller, targets, effects };
    // NOTE: _resolveItem is defined in stack-part1.ts; call via the GameStack object
    const remainingResults = GameStack._resolveItem(tempItem, state);

    if (Array.isArray(remainingResults)) {
      log.push(...remainingResults);
    }

    return log;
  }
  return [];
}

// ============================================================
// _payWardCost — lines 3356-3378
// ============================================================

export function payWardCost(
  creature: any,
  controller: number,
  state: any,
  log: string[]
): boolean {
  if (!CardEngine.hasWard(creature)) return true;
  const creatureOwner =
    creature._ownerId !== undefined ? creature._ownerId : controller === 0 ? 1 : 0;
  if (creatureOwner === controller) return true;

  const wardCost = CardEngine.getWardCost(creature);
  if (wardCost <= 0) return true;

  const pool = state.manaPool[controller];
  const poolTotal = ManaSystem.poolTotal(pool);
  if (poolTotal >= wardCost) {
    const fakeCost = `{${wardCost}}`;
    state.manaPool[controller] = ManaSystem.payMana(pool, fakeCost, wardCost);
    log.push(`Ward ${wardCost} de ${creature.name} pago.`);
    return true;
  } else {
    log.push(`Ward ${wardCost} de ${creature.name} nao pago — efeito anulado!`);
    return false;
  }
}

// ============================================================
// _aiScoreMode — lines 3380-3441
// ============================================================

export function aiScoreMode(
  mode: any,
  state: any,
  controller: number,
  opponent: number
): number {
  let score = 0;
  const type = mode.type;
  const oppCreatures = state.players[opponent].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );
  const myCreatures = state.players[controller].zones.battlefield.cards.filter((c: any) =>
    CardEngine.isCreature(c)
  );

  if (type === 'destroy' || type === 'exile') {
    score += oppCreatures.length > 0 ? 10 : -5;
  } else if (type === 'bounce' || type === 'bounce_to_library') {
    score += oppCreatures.length > 0 ? 8 : -3;
  } else if (type === 'damage') {
    score += oppCreatures.length > 0 ? 7 : 3;
  } else if (type === 'draw') {
    score += 6 + (mode.amount || 1);
  } else if (type === 'create_token') {
    score += 7;
  } else if (type === 'buff' || type === 'buff_all') {
    score += myCreatures.length > 0 ? 6 + myCreatures.length : -2;
  } else if (type === 'gain_life' || type === 'gainLife') {
    score += 4;
  } else if (type === 'counter' || type === 'counter_spell') {
    score += 8;
  } else if (type === 'tap') {
    score += oppCreatures.length > 0 ? 7 : -2;
  } else if (type === 'surveil') {
    score += 5;
  } else if (type === 'destroy_all') {
    score += oppCreatures.length > myCreatures.length ? 15 : -10;
  } else if (type === 'return_from_graveyard') {
    const gy = state.players[controller].zones.graveyard;
    score += gy && gy.cards && gy.cards.length > 0 ? 8 : -3;
  } else if (type === 'drain') {
    score += 7;
  } else if (type === 'loot') {
    score += 5;
  } else if (type === 'gain_control') {
    score += oppCreatures.length > 0 ? 12 : -5;
  } else if (type === 'bounce_to_library_top') {
    score += oppCreatures.length > 0 ? 9 : -3;
  } else if (type === 'grant' || type === 'grant_all') {
    score += myCreatures.length > 0 ? 5 : -2;
  } else if (type === 'search_library') {
    score += 7;
  } else if (type === 'extra_combat') {
    score += myCreatures.length >= 2 ? 9 : 2;
  } else if (type === 'untap_all') {
    score += 5;
  } else if (type === 'anthem') {
    score += 4 + myCreatures.length * 2;
  } else if (type === 'distribute_counters' || type === 'grant_counter') {
    score += myCreatures.length > 0 ? 6 : -2;
  } else if (type === 'exile_top_play') {
    score += 6;
  } else if (type === 'mill') {
    score += 4;
  } else if (type === 'discard_hand') {
    score += 8;
  } else {
    score += 3;
  }
  return score;
}

// ============================================================
// _aiChooseModes — lines 3444-3451
// ============================================================

export function aiChooseModes(
  modes: any[],
  count: number,
  state: any,
  controller: number,
  opponent: number,
  _targets?: any[]
): any[] {
  const scored = modes.map((mode: any, i: number) => ({
    mode,
    index: i,
    score: aiScoreMode(mode, state, controller, opponent),
  }));
  scored.sort((a: any, b: any) => b.score - a.score);
  return scored.slice(0, Math.min(count, modes.length)).map((s: any) => s.mode);
}

// ============================================================
// _aiChooseMode — lines 3453-3456 (backwards-compatible wrapper)
// ============================================================

export function aiChooseMode(
  modes: any[],
  state: any,
  controller: number,
  opponent: number,
  targets?: any[]
): any {
  return aiChooseModes(modes, 1, state, controller, opponent, targets)[0];
}

// ============================================================
// dispatch — master router for all part-2 effect handlers
// Called from stack-part1.ts default case
// ============================================================

export function dispatch(
  effect: any,
  state: any,
  card: any,
  controller: number,
  targets: any[],
  effects: any[],
  ei: number,
  log: string[],
  resolveAmount: (v: any) => number
): string[] | null {
  switch (effect.type) {
    case 'buff_all':
      handleBuffAll(state, effect, controller, log);
      return null;
    case 'blight':
      return handleBlight(state, effect, controller, effects, ei, log);
    case 'blight_opponent':
      handleBlightOpponent(state, effect, controller, log);
      return null;
    case 'grant_haste':
      handleGrantHaste(state, controller, log);
      return null;
    case 'grant_harmonize':
      handleGrantHarmonize(state, controller, log);
      return null;
    case 'stun_counter': // alias legacy
    case 'stun':
      handleStun(state, effect, targets, log);
      return null;
    case 'stun_counter_self':
      handleStunCounterSelf(state, effect, card, log);
      return null;
    case 'threaten':
      handleThreaten(state, effect, targets, controller, log);
      return null;
    case 'clash':
      return handleClash(state, effect, card, controller, effects, ei, targets, log);
    case 'counter_spell':
      return handleCounterSpell(state, effect, targets, controller, log);
    case 'endure':
      return handleEndure(state, effect, card, controller, resolveAmount, log);
    case 'drain':
      handleDrain(state, effect, controller, resolveAmount, log);
      return null;
    case 'loot':
      return handleLoot(state, effect, controller, log);
    case 'rummage':
      return handleRummage(state, effect, controller, log);
    case 'bounce_self':
      handleBounceSelf(state, card, controller, log);
      return null;
    case 'look_top':
      return handleLookTop(state, effect, controller, log);
    case 'look_top_botanist':
      return handleLookTopBotanist(state, controller, log);
    case 'damage_all':
      handleDamageAll(state, effect, controller, resolveAmount, log);
      return null;
    case 'untap_all':
      handleUntapAll(state, effect, controller, log);
      return null;
    case 'discard_hand':
      handleDiscardHand(state, effect, controller, log);
      return null;
    case 'reveal_hand':
      handleRevealHand(state, effect, controller, log);
      return null;
    case 'shuffle_gy_to_library': {
      // Target player shuffles up to N cards from their GY into their library
      const shuffleAmount = effect.amount || 4;

      // Determine target player
      let shuffleTargetPid: number;
      if (effect.target === 'self') {
        shuffleTargetPid = controller;
      } else if (effect.target === 'choose_player') {
        // Human: show player choice modal, then card selection
        if (state.players[controller].isHuman) {
          state._pendingShuffleGY = {
            amount: shuffleAmount,
            controller,
            upTo: !!effect.up_to,
            card,
            remainingEffects: effects.slice(ei + 1),
          };
          state.waitingForInput = { type: 'shuffle_gy_choose_player', playerId: controller };
          return log; // Pause for human choice
        }
        // AI: pick opponent (more disruptive)
        shuffleTargetPid = controller === 0 ? 1 : 0;
      } else {
        shuffleTargetPid = controller === 0 ? 1 : 0; // Default: opponent
      }

      const shuffleGY = state.players[shuffleTargetPid].zones.graveyard;
      const shuffleLib = state.players[shuffleTargetPid].zones.library;
      const gyAll = shuffleGY.getAll();
      const toShuffle = gyAll.slice(0, shuffleAmount);
      for (const sc of toShuffle) {
        shuffleGY.remove(sc._uid);
        shuffleLib.addToBottom(sc);
      }
      if (toShuffle.length > 0) {
        shuffleLib.shuffle();
        log.push(`${toShuffle.length} carta(s) do cemiterio embaralhadas na biblioteca.`);
      }
      return null;
    }
    case 'exile_graveyard':
      handleExileGraveyard(state, effect, controller, log);
      return null;
    case 'exile_from_graveyard':
      handleExileFromGraveyard(state, effect, controller, effects, ei, targets, resolveAmount, log);
      return null;
    case 'exile_top':
      handleExileTop(state, effect, controller, log);
      return null;
    case 'double_counters':
      handleDoubleCounters(state, card, controller, targets, log);
      return null;
    case 'bounce_to_library_top':
      handleBounceToLibraryTop(state, targets, controller, log);
      return null;
    case 'return_land_from_mill':
      handleReturnLandFromMill(state, effect, controller, log);
      return null;
    case 'regenerate':
      handleRegenerate(state, effect, card, controller, targets, log);
      return null;
    case 'counter_self_if_no_draw':
      handleCounterSelfIfNoDraw(state, effect, card, controller, log);
      return null;
    case 'remove_counters':
      handleRemoveCounters(state, effect, targets, log);
      return null;
    case 'remove_counters_all':
      handleRemoveCountersAll(state, targets, log);
      return null;
    case 'grant':
      handleGrant(state, effect, card, controller, targets, log);
      return null;
    case 'cant_block': {
      // Summit Intimidator: "target creature can't block this turn"
      const cbOpponent = controller === 0 ? 1 : 0;
      if (targets && targets.length > 0) {
        // Use explicitly chosen target
        const cbT = targets[0];
        const cbCreature = state.players[cbT.player].zones.battlefield.get(cbT.uid);
        if (cbCreature && CardEngine.isCreature(cbCreature)) {
          cbCreature._cantBlockThisTurn = true;
          log.push(`${cbCreature.name} nao pode bloquear neste turno.`);
        }
      } else {
        // Auto-pick: opponent's biggest-toughness creature (most impactful blocker to disable)
        const cbTargetId = effect.target === 'self' ? controller : cbOpponent;
        const cbCreatures = state.players[cbTargetId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && !c._cantBlockThisTurn);
        if (cbCreatures.length > 0) {
          cbCreatures.sort((a: any, b: any) => CardEngine.getToughness(b) - CardEngine.getToughness(a));
          cbCreatures[0]._cantBlockThisTurn = true;
          log.push(`${cbCreatures[0].name} nao pode bloquear neste turno.`);
        }
      }
      return null;
    }
    case 'register_temp_trigger':
      handleRegisterTempTrigger(state, effect, card, controller, log, targets);
      return null;
    case 'grant_all':
      handleGrantAll(state, effect, controller, log);
      return null;
    case 'grant_counter': // alias legacy (singular)
    case 'grant_counters':
      handleGrantCounters(state, effect, controller, targets, log);
      return null;
    case 'exile_top_play':
      handleExileTopPlay(state, effect, controller, log, card?._uid);
      // If waitingForInput was set (exile_reveal overlay for human), pause stack
      if (state.waitingForInput) {
        if (ei < effects.length - 1) {
          state._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
        }
        return log;
      }
      return null;
    case 'exile_top_choose':
    case 'behold_dragon':
    case 'optional_discard_hand_draw': {
      // Route to _resolveSimpleEffect which has the full implementation
      const routedResult = GameState._resolveSimpleEffect(state, controller, effect, { cardUid: card?._uid });
      if (routedResult) log.push(routedResult);
      return null;
    }
    case 'search_library':
      return handleSearchLibrary(state, effect, controller, log);
    case 'search_library_to_graveyard':
      handleSearchLibraryToGraveyard(state, controller, log, effect);
      return null;
    case 'create_token_copy':
    case 'clone':
    case 'copy_self':
      handleCreateTokenCopy(state, effect, card, controller, targets, log);
      return null;
    case 'become_copy': {
      // If human has no targets pre-selected, pause for choice
      if ((!targets || targets.length === 0) && state.players[controller].isHuman) {
        const allCreatures = [
          ...state.players[0].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c) && c._uid !== card._uid),
          ...state.players[1].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c) && c._uid !== card._uid),
        ];
        if (allCreatures.length > 0) {
          state._pendingETBClone = { effect, controller, cardUid: card._uid };
          state.waitingForInput = {
            type: 'etb_clone_target',
            playerId: controller,
            choices: allCreatures.map((c: any) => {
              const pid = state.players[0].zones.battlefield.get(c._uid) ? 0 : 1;
              return { ...c, _ownerPid: pid };
            }),
          };
          // Store remaining effects for after resolution
          if (ei < effects.length - 1) {
            state._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
          }
          return log;
        }
      }
      handleBecomeCopy(state, card, controller, targets, log);
      return null;
    }
    case 'mass_clone':
      handleMassClone(state, card, controller, targets, log);
      return null;
    case 'gain_control':
      handleGainControl(state, targets, controller, log);
      return null;
    case 'anthem':
      handleAnthem(state, effect, card, controller, log);
      return null;
    case 'triggered':
      handleTriggered(state, effect, card, controller, log);
      return null;
    case 'static':
      handleStatic(state, effect, card, controller, log);
      return null;
    case 'move_counters':
      handleMoveCounters(state, card, controller, targets, log);
      return null;
    case 'distribute_counters':
      return handleDistributeCounters(state, effect, card, controller, log);
    case 'become_creature':
    case 'become_dragon':
      handleBecomeCreature(state, effect, card, controller, log);
      return null;
    case 'attach':
      handleAttach(state, card, controller, targets, log, effect);
      return null;
    case 'exile_top_opponent':
      handleExileTopOpponent(state, effect, controller, log);
      return null;
    case 'copy_spell':
    case 'copy_next_spell':
      handleCopySpell(state, controller, log, card?._uid);
      return null;
    case 'extra_combat':
      handleExtraCombat(state, log);
      return null;
    case 'exile_graveyard_cast_copy':
      handleExileGraveyardCastCopy(state, effect, controller, effects, ei, log);
      return null;
    default: {
      // Fallback: route to _resolveSimpleEffect for any effect not explicitly handled here.
      // This ensures saga chapters, spell copies, and other stack-pushed effects work
      // even if the type is only implemented in _resolveSimpleEffect.
      const fallbackResult = GameState._resolveSimpleEffect(state, controller, effect, { cardUid: card?._uid, cardName: card?.name, targets });
      if (fallbackResult) log.push(fallbackResult);
      else log.push(`[DEBUG] Efeito "${effect.type}" nao resolvido.`);
      // If _resolveSimpleEffect set waitingForInput (e.g. buff_choice for human),
      // save remaining effects and pause resolution
      if (state.waitingForInput) {
        if (ei < effects.length - 1) {
          state._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
        }
        return log;
      }
      return null;
    }
  }
}
