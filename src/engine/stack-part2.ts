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
  log.push(`Todas as suas criaturas recebem buff ate o fim do turno.`);
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
    log.push(`${hasteTarget.name} ganha Haste!`);
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
    log.push(`${grantedSpell.name} ganha harmonize (custo: ${grantedSpell.mana_cost}).`);
  } else {
    log.push('Nenhum instant/sorcery no cemiterio para ganhar harmonize.');
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
      log.push(`${stunCreature.name} recebe ${stunAmt} stun counter(s).`);
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
    log.push(`${card.name} recebe ${stunAmt} stun counter(s).`);
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
      const ctrlLabel = controller === 0 ? 'Voce' : 'Oponente';
      log.push(`${ctrlLabel} rouba ${stolenCard.name} ate o fim do turno!`);
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
    log.push('Clash: ambas bibliotecas vazias.');
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
    const myName = myCard ? myCard.name : '(vazio)';
    const oppName = oppCard ? oppCard.name : '(vazio)';
    log.push(
      `Clash! Voce revela ${myName} (${myCmc}), oponente revela ${oppName} (${oppCmc}).`
    );
    log.push(won ? 'Voce vence o clash!' : 'Oponente vence o clash.');
    return log; // Pause — wait for human to choose top/bottom
  } else {
    const myName = myCard ? myCard.name : '(vazio)';
    const oppName = oppCard ? oppCard.name : '(vazio)';
    log.push(
      `Clash! ${controller === 0 ? 'Voce revela' : 'IA revela'} ${myName} (${myCmc}) vs ${oppName} (${oppCmc}).`
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
      log.push(`${controller === 0 ? 'Voce vence' : 'IA vence'} o clash!`);
      if (effect.bonus && effect.bonus.length > 0) {
        effects.splice(ei + 1, 0, ...effect.bonus);
      }
    } else {
      log.push(`${controller === 0 ? 'Voce perde' : 'IA perde'} o clash.`);
    }
  }
  return null;
}

export function handleCounterSpell(
  state: any,
  effect: any,
  targets: any[],
  controller: number,
  log: string[]
): string[] | null {
  const opponent = controller === 0 ? 1 : 0;
  console.log(`[COUNTER_SPELL RESOLVE] Targets:`, targets, `Controller: ${controller}`);

  if (!targets || targets.length === 0) {
    log.push('Counter spell requer um alvo (spell na stack).');
    console.log(`[COUNTER_SPELL] FAILED: No targets`);
    return null;
  }

  const targetSpell = targets[0];
  if (!targetSpell || !targetSpell.name) {
    log.push('Alvo invalido para counter.');
    console.log(`[COUNTER_SPELL] FAILED: Invalid target`, targetSpell);
    return null;
  }
  console.log(`[COUNTER_SPELL] Targeting: ${targetSpell.name}`);

  if (effect.max_mana_value !== undefined) {
    const spellCMC = targetSpell.cmc || 0;
    if (spellCMC > effect.max_mana_value) {
      log.push(
        `${targetSpell.name} tem mana value ${spellCMC}, nao pode ser anulado (max ${effect.max_mana_value}).`
      );
      return null;
    }
  }

  if (effect.unless_pay !== undefined) {
    const wasDragonBeheld = !!(state._beholding && state._beholding[controller]);
    const baseCost = effect.unless_pay;
    const costWithBehold = effect.unless_pay_with_behold || baseCost;
    const finalCost = wasDragonBeheld ? costWithBehold : baseCost;
    const costStr = `{${finalCost}}`;

    const fakeCard = { mana_cost: costStr, cmc: finalCost };
    const canPay = ManaSystem.canAfford(state, opponent, fakeCard);
    console.log(
      `[COUNTER_SPELL] Unless pay {${finalCost}}: canPay=${canPay}, beheld=${wasDragonBeheld}`
    );

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
          `${targetSpell.name} nao foi anulado (${opponent === 0 ? 'Voce' : 'IA'} pagou ${label}).`
        );
        console.log(`[COUNTER_SPELL] AI paid ${label} to save ${targetSpell.name}`);
        return null; // Don't counter
      }
    }
  }

  targetSpell._countered = true;
  console.log(`[COUNTER_SPELL] SUCCESS! ${targetSpell.name} marked as _countered=true`);
  log.push(`${targetSpell.name} foi anulado.`);
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
    log.push(`Endure ${endureAmt}: cria ${endureAmt} Spirit(s) 1/1.`);
  } else if (state.players[controller].isHuman) {
    state._pendingEndure = { cardUid: card._uid, amount: endureAmt, controllerId: controller };
    state.waitingForInput = { type: 'endure_choice', playerId: controller };
    log.push(`Endure ${endureAmt} - escolha entre contadores ou tokens.`);
    return log;
  } else {
    if (!endureCard._counters) endureCard._counters = { '+1/+1': 0, '-1/-1': 0 };
    endureCard._counters['+1/+1'] += endureAmt;
    log.push(`${endureCard.name} endure ${endureAmt}: +${endureAmt} contadores +1/+1.`);
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
    `${loseTarget === controller ? 'Voce perde' : 'Oponente perde'} ${effect.amount} vida.`
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
    `${gainTarget === controller ? 'Voce ganha' : 'Oponente ganha'} ${effect.amount} vida.`
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
    `Drain ${drainAmt}: oponente perde ${drainAmt} vida, voce ganha ${drainAmt} vida.`
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

  log.push(`Compra ${drawnCards.length} carta(s) (loot).`);

  if (state.players[controller].isHuman) {
    state._pendingLoot = { amount: discardAmt, controller };
    state.waitingForInput = { type: 'discard_for_loot', playerId: controller };
    log.push(`Escolha ${discardAmt} carta(s) para descartar.`);
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
      log.push(`Descarta ${worst.name} (loot).`);
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
    log.push('Sem cartas na mao para descartar.');
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
        log.push(`Descarta ${worst.name} (rummage).`);
      }
    }
    if (toDiscard > 0) {
      for (let i = 0; i < toDiscard; i++) {
        const drawn = state.players[controller].zones.library.drawFromTop();
        if (drawn) hand.add(drawn);
      }
      log.push(`Compra ${toDiscard} carta(s) (rummage).`);
    } else if (isOptional) {
      log.push('Oponente opta por nao descartar.');
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
    log.push(`${bsCard.name} volta para a mao do dono.`);
  }
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
      log.push(`Escolha qual(is) terreno(s) colocar na mao (até ${pickCount}).`);
      return log;
    } else {
      const toHand = lands.slice(0, pickCount);
      const toBottom = [...lands.slice(pickCount), ...nonLands];
      toHand.forEach((c: any) => {
        state.players[controller].zones.hand.add(c);
        log.push(`${c.name} (terreno) vai para a mao.`);
      });
      toBottom.forEach((c: any) => lib.addToBottom(c));
      if (lands.length === 0)
        log.push(`Nenhum terreno encontrado entre as ${looked.length} cartas do topo.`);
    }
  } else if (effect.rest_to === 'graveyard') {
    const pickCount = effect.pick || 1;

    if (state.players[controller].isHuman && pickCount > 0 && looked.length >= pickCount) {
      state._pendingLookTop = {
        type: 'look_top_choice',
        cards: looked,
        pickCount,
        choices: new Array(looked.length).fill('graveyard'),
        playerId: controller,
      };
      state.waitingForInput = { type: 'look_top_choice', playerId: controller };
      log.push(`Escolha ${pickCount} carta(s) para a mao.`);
      return log;
    } else {
      looked.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const picked = looked.slice(0, pickCount);
      const rest = looked.slice(pickCount);
      picked.forEach((c: any) => {
        state.players[controller].zones.hand.add(c);
        log.push(`${c.name} vai para a mao.`);
      });
      rest.forEach((c: any) => state.players[controller].zones.graveyard.add(c));
      if (rest.length > 0) log.push(`${rest.length} carta(s) vao para o cemiterio.`);
    }
  } else if (effect.put_onto_battlefield && effect.condition === 'noncreature_nonland_mv3') {
    const putCount = effect.put_onto_battlefield || 0;
    const candidates = looked.filter(
      (c: any) => !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3
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
        `Escolha até ${putCount} permanentes nao-criatura nao-terreno (CMC <= 3) para colocar no campo.`
      );
      return log;
    } else {
      candidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const toBf = candidates.slice(0, putCount);
      const toBottom = [...candidates.slice(putCount), ...rest];
      toBf.forEach((c: any) => {
        state.players[controller].zones.battlefield.add(c);
        log.push(`${c.name} entra no campo.`);
      });
      const shuffled = toBottom.sort(() => Math.random() - 0.5);
      shuffled.forEach((c: any) => lib.addToBottom(c));
      if (toBf.length === 0) log.push(`Nenhum permanente elegivel encontrado.`);
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
        `Escolha ${pickCount} carta(s) para a mao (as outras vao para o fundo do deck).`
      );
      return log;
    } else {
      looked.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
      const picked = looked.slice(0, pickCount);
      const rest = looked.slice(pickCount);
      picked.forEach((c: any) => {
        state.players[controller].zones.hand.add(c);
        log.push(`${c.name} vai para a mao.`);
      });
      rest.forEach((c: any) => lib.addToBottom(c));
      if (rest.length > 0) log.push(`${rest.length} carta(s) vao para o fundo do deck.`);
    }
  } else {
    looked.reverse().forEach((c: any) => lib.addToTop(c));
    log.push(`Olhou ${looked.length} carta(s) do topo.`);
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
          log.push(`${creature.name} recebe ${dmgAllAmt} dano e morre.`);
        } else {
          log.push(`${creature.name} recebe ${dmgAllAmt} dano.`);
        }
      }

      for (const pw of planeswalkers) {
        GameState.damagePlaneswalker(state, pw, dmgAllAmt, pid);
        log.push(`${pw.name} recebe ${dmgAllAmt} dano.`);
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
          log.push(`${creature.name} recebe ${dmgAllAmt} dano e morre.`);
        } else {
          log.push(`${creature.name} recebe ${dmgAllAmt} dano.`);
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
  log.push(`Desvirou todos os permanentes${effect.target ? ' (' + effect.target + ')' : ''}.`);
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
  const who = dhTarget === 0 ? 'Voce descarta' : 'Oponente descarta';
  log.push(`${who} toda a mao (${count} carta(s)).`);
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
    log.push(`Mao revelada: ${rhCards.map((c: any) => c.name).join(', ')}.`);
  } else {
    log.push('Mao vazia.');
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
  if (egCards.length > 0) log.push(`${egCards.length} carta(s) exilada(s) do cemiterio.`);
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
        state._pendingGraveyardChoice = { effect, controller, opponent };
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
  const efgCards = efgGy.getAll();

  if (efgCards.length > 0) {
    if (effect.choose_cards && controller === 0) {
      let maxAmount: number, minAmount: number;
      if (effect.exact_amount && effect.optional) {
        maxAmount = efgAmt;
        minAmount = 0;
      } else if (effect.up_to_max) {
        maxAmount = efgAmt;
        minAmount = 0;
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
        log.push(`${picked.name} exilado do cemiterio.`);
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
      log.push(`${topCard.name} exilado do topo da biblioteca.`);
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
        log.push(`${btlCreature.name} nao pode ser alvo (hexproof/shroud).`);
        return;
      }
      btlBf.remove(btlCreature._uid);
      GameState._unregisterCardTriggers(state, btlCreature._uid);
      state.players[btlTarget.player].zones.library.addToTop(btlCreature);
      log.push(`${btlCreature.name} colocado no topo da biblioteca.`);
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
      log.push(`${land.name} volta do cemiterio para a mao.`);
    } else {
      const bfLand = CardEngine.prepareForBattlefield(land);
      bfLand._tapped = true;
      state.players[controller].zones.battlefield.add(bfLand);
      log.push(`${land.name} volta do cemiterio para o campo virado.`);
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
      log.push(`${regCreature.name} ganha escudo de regeneracao.`);
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
        log.push(`Goblins ganham escudo de regeneracao.`);
      }
    } else {
      const selfCard = regBf.get(card._uid);
      if (selfCard) {
        selfCard._regenerateShield = true;
        log.push(`${selfCard.name} ganha escudo de regeneracao.`);
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
      log.push(`${csifCard.name} recebe +1/+1 counter (nenhuma carta comprada extra).`);
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
  const grantKw = effect.keyword;
  if (!grantKw) return;
  const grantDuration = effect.duration || 'end_of_turn';

  if (targets && targets.length > 0) {
    const gTarget = targets[0];
    const gCreature = state.players[gTarget.player].zones.battlefield.get(gTarget.uid);
    if (gCreature) {
      if (!CardEngine.canBeTargeted(gCreature, controller)) {
        log.push(`${gCreature.name} nao pode ser alvo (hexproof/shroud).`);
        return;
      }
      if (!gCreature.keywords) gCreature.keywords = [];
      const kwCap = grantKw.charAt(0).toUpperCase() + grantKw.slice(1);
      if (!gCreature.keywords.includes(kwCap)) gCreature.keywords.push(kwCap);
      if (grantDuration === 'end_of_turn') {
        if (!gCreature._tempKeywords) gCreature._tempKeywords = [];
        gCreature._tempKeywords.push(kwCap);
      }
      if (kwCap === 'Haste') gCreature._summoningSick = false;
      log.push(`${gCreature.name} ganha ${kwCap} ate o fim do turno.`);
    }
  } else {
    const gSelf = state.players[controller].zones.battlefield.get(card._uid);
    if (gSelf) {
      if (!gSelf.keywords) gSelf.keywords = [];
      const kwCap = grantKw.charAt(0).toUpperCase() + grantKw.slice(1);
      if (!gSelf.keywords.includes(kwCap)) gSelf.keywords.push(kwCap);
      if (grantDuration === 'end_of_turn') {
        if (!gSelf._tempKeywords) gSelf._tempKeywords = [];
        gSelf._tempKeywords.push(kwCap);
      }
      if (kwCap === 'Haste') gSelf._summoningSick = false;
      log.push(`${gSelf.name} ganha ${kwCap}.`);
    }
  }
}

export function handleRegisterTempTrigger(
  state: any,
  effect: any,
  card: any,
  controller: number,
  log: string[]
): void {
  if (!state._tempTriggers) state._tempTriggers = [];

  const tempTrigger = {
    event: effect.event,
    effects: effect.effects || [],
    condition: effect.condition,
    controller,
    sourceCard: card,
    expiresAt: 'end_of_turn',
    once: effect.once || false,
  };

  state._tempTriggers.push(tempTrigger);
  log.push(
    `Trigger temporario registrado: ${effect.event}${effect.once ? ' (uma vez)' : ''}.`
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
  log.push(`Todas as criaturas ganham ${gaKwCap} ate o fim do turno.`);
}

export function handleGrantCounters(
  state: any,
  effect: any,
  controller: number,
  targets: any[],
  log: string[]
): void {
  if (targets && targets.length > 0) {
    const gcTarget = targets[0];
    const gcCreature = state.players[gcTarget.player].zones.battlefield.get(gcTarget.uid);
    if (gcCreature) {
      if (!CardEngine.canBeTargeted(gcCreature, controller)) {
        log.push(`${gcCreature.name} nao pode ser alvo (hexproof/shroud).`);
        return;
      }
      if (!gcCreature._counters) gcCreature._counters = { '+1/+1': 0, '-1/-1': 0 };
      const gcAmt = effect.amount || 1;
      const gcType = effect.counter || '+1/+1';
      gcCreature._counters[gcType] = (gcCreature._counters[gcType] || 0) + gcAmt;
      log.push(`${gcCreature.name} recebe ${gcAmt} contador(es) ${gcType}.`);
    }
  }
}

export function handleExileTopPlay(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): void {
  const etpLib = state.players[controller].zones.library;
  const etpAmt = effect.amount || 1;

  for (let i = 0; i < etpAmt; i++) {
    let cardFound: any = null;

    if (effect.condition) {
      let filter: (c: any) => boolean = () => true;

      if (effect.condition === 'nonland') {
        filter = (c: any) => !CardEngine.isLand(c);
      } else if (effect.condition === 'noncreature_nonland_mv3') {
        filter = (c: any) =>
          !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3;
      }

      if (effect.max_mv) {
        const originalFilter = filter;
        filter = (c: any) => originalFilter(c) && (c.cmc || 0) <= effect.max_mv;
      }

      const candidates = etpLib.cards.filter(filter);
      if (candidates.length > 0) {
        cardFound = effect.random
          ? candidates[Math.floor(Math.random() * candidates.length)]
          : candidates[0];
        const idx = etpLib.cards.indexOf(cardFound);
        if (idx !== -1) etpLib.cards.splice(idx, 1);
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

      state._exiledPlayable[cardFound._uid] = {
        card: cardFound,
        controller,
        turn: state.turn,
        freeCast: effect.free || false,
        duration: effect.duration || 'permanent',
      };
      console.log(
        `[BREACHING DEBUG] Exiled ${cardFound.name}, freeCast: ${effect.free || false}, cmc: ${cardFound.cmc}, duration: ${effect.duration || 'permanent'}`
      );

      const who = state.players[controller].isHuman ? 'Voce exila' : 'Oponente exila';
      const playableText = effect.free
        ? ' (pode jogar de graca neste turno)'
        : ' (pode jogar neste turno)';
      log.push(`${who} ${cardFound.name}${playableText}.`);
    } else if (effect.condition) {
      const who = state.players[controller].isHuman ? 'Voce' : 'Oponente';
      log.push(`${who} nao encontra carta valida na biblioteca.`);
    }
  }
}

export function handleSearchLibrary(
  state: any,
  effect: any,
  controller: number,
  log: string[]
): string[] | null {
  console.log('[SEARCH_LIBRARY] Starting search_library effect', effect);
  const slLib = state.players[controller].zones.library;
  const bf = state.players[controller].zones.battlefield;
  console.log('[SEARCH_LIBRARY] Library size:', slLib.cards.length);

  let slFilter: (c: any) => boolean;
  if (effect.target === 'creature') {
    slFilter = (c: any) => CardEngine.isCreature(c);
  } else if (effect.target === 'land' || effect.target === 'basic_land') {
    slFilter = (c: any) => CardEngine.isLand(c);
  } else if (effect.target === 'named_card' && (effect.name || effect.names)) {
    if (effect.name) {
      slFilter = (c: any) => c.name === effect.name;
    } else {
      slFilter = (c: any) => effect.names.includes(c.name);
    }
  } else {
    slFilter = () => true;
  }

  const slCandidates = slLib.cards.filter(slFilter);
  console.log('[SEARCH_LIBRARY] Candidates found:', slCandidates.length);

  if (slCandidates.length === 0) {
    slLib.shuffle();
    log.push('Nenhuma carta encontrada na biblioteca.');
    console.log('[SEARCH_LIBRARY] No candidates, breaking');
    return null;
  }

  let toTop = effect.to_top || false;
  let toHand = effect.to_hand !== false;
  let toBattlefield = false;
  let tappedDest = effect.tapped || false;

  if (effect.condition === 'control_dragon') {
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

  console.log('[SEARCH_LIBRARY] Controller:', controller, 'isHuman:', state.players[controller].isHuman);

  if (state.players[controller].isHuman && slCandidates.length > 0) {
    const landOptions: any[] = [];
    const seenNames = new Set<string>();
    for (const c of slCandidates) {
      if (!seenNames.has(c.name)) {
        seenNames.add(c.name);
        landOptions.push(c);
      }
    }
    console.log('[SEARCH_LIBRARY] Setting up human choice. Options:', landOptions.length);
    console.log(
      '[SEARCH_LIBRARY] Destination - toTop:',
      toTop,
      'toHand:',
      toHand,
      'toBattlefield:',
      toBattlefield,
      'tapped:',
      tappedDest
    );
    state._pendingSearch = {
      candidates: landOptions,
      controller,
      toHand,
      toBattlefield,
      toTop,
      tapped: tappedDest,
      optional: effect.optional || false,
    };
    state.waitingForInput = { type: 'search_library', playerId: controller };
    log.push(
      effect.optional
        ? 'Escolha uma carta da sua biblioteca (ou declinar).'
        : 'Escolha uma carta da sua biblioteca.'
    );
    console.log('[SEARCH_LIBRARY] Waiting for input set. Returning log.');
    return log;
  } else {
    console.log('[SEARCH_LIBRARY] AI path - auto-picking best card');
    slCandidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const picked = slCandidates[0];
    const idx = slLib.cards.indexOf(picked);
    if (idx !== -1) slLib.cards.splice(idx, 1);

    if (toHand) {
      state.players[controller].zones.hand.add(picked);
      slLib.shuffle();
      log.push(`Busca ${picked.name} da biblioteca para a mao.`);
    } else if (toTop) {
      slLib.cards.unshift(picked);
      log.push(`Busca ${picked.name} e coloca no topo do grimorio.`);
    } else if (toBattlefield) {
      const bfCard = CardEngine.prepareForBattlefield(picked);
      bfCard._tapped = tappedDest;
      bfCard._summoningSickness = false;
      bfCard._ownerId = controller;
      bf.add(bfCard);
      GameState._registerCardTriggers(state, bfCard, controller);
      slLib.shuffle();
      log.push(`Busca ${picked.name} e coloca no campo${tappedDest ? ' virado' : ''}.`);
    } else {
      state.players[controller].zones.hand.add(picked);
      slLib.shuffle();
      log.push(`Busca ${picked.name} da biblioteca para a mao.`);
    }
  }
  return null;
}

export function handleSearchLibraryToGraveyard(
  state: any,
  controller: number,
  log: string[]
): void {
  const sltgLib = state.players[controller].zones.library;
  const sltgGy = state.players[controller].zones.graveyard;
  const sltgCards = sltgLib.cards.filter((c: any) => !CardEngine.isLand(c));
  if (sltgCards.length > 0) {
    sltgCards.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const picked = sltgCards[0];
    const idx = sltgLib.cards.indexOf(picked);
    if (idx !== -1) sltgLib.cards.splice(idx, 1);
    sltgGy.add(picked);
    sltgLib.shuffle();
    log.push(`Busca ${picked.name} e coloca no cemiterio.`);
  } else {
    sltgLib.shuffle();
    log.push('Nenhuma carta encontrada.');
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
    sourceCreature = state.players[controller].zones.battlefield.get(card._uid);
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
    if (effect.tapped) token._tapped = true;
    if (effect.attacking && state.combat && state.combat.phase !== 'none') {
      token._attacking = true;
      token._tapped = true;
      token._summoningSickness = false;
      state.combat.attackers.push({ uid: token._uid, card: token });
    }
    state.players[controller].zones.battlefield.add(token);
    GameState._registerCardTriggers(state, token, controller);
    log.push(`Cria copia de ${sourceCreature.name}.`);
  } else {
    log.push('Nenhuma criatura para copiar.');
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

      log.push(`${card.name} vira uma copia de ${templateCreature.name}.`);
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
        creature.mana_cost = templateCreature.mana_cost;
        creature.cmc = templateCreature.cmc;
      });

      log.push(`Outras criaturas viram copias de ${templateCreature.name} ate o fim do turno.`);
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
      log.push(`Ganha controle de ${gcCreature.name}!`);
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
    `Anthem: todas as criaturas ganham +${anthemPower}/+${anthemTough}${
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
    log.push(`${card.name}: habilidade ativada registrada (${effect.event}).`);
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
  const dcAmt = effect.amount || 1;
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
  log: string[]
): void {
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
  log: string[]
): void {
  state._pendingSpellCopy = state._pendingSpellCopy || {};
  state._pendingSpellCopy[controller] = true;
  log.push('Proxima magia sera copiada!');
}

export function handleExtraCombat(
  state: any,
  log: string[]
): void {
  state._extraCombat = true;
  log.push('Fase de combate adicional!');
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
  const egccExile = state.players[controller].zones.exile;
  let egccCandidates = egccGy.getAll().filter((c: any) => !CardEngine.isLand(c));
  if (effect.target === 'nonland_mv3_or_less') {
    egccCandidates = egccCandidates.filter((c: any) => (c.cmc || 0) <= 3);
  }
  if (egccCandidates.length > 0) {
    egccCandidates.sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
    const picked = egccCandidates[0];
    egccGy.remove(picked._uid);
    egccExile.add(picked);
    const copyEffects = CardEngine.getSpellEffects(picked);
    if (copyEffects.length > 0) {
      effects.splice(ei + 1, 0, ...copyEffects);
      log.push(`Exila ${picked.name} do cemiterio e joga copia de graca!`);
    } else {
      log.push(`Exila ${picked.name} do cemiterio.`);
    }
  } else {
    log.push('Nenhuma carta valida no cemiterio.');
  }
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
    case 'register_temp_trigger':
      handleRegisterTempTrigger(state, effect, card, controller, log);
      return null;
    case 'grant_all':
      handleGrantAll(state, effect, controller, log);
      return null;
    case 'grant_counters':
      handleGrantCounters(state, effect, controller, targets, log);
      return null;
    case 'exile_top_play':
      handleExileTopPlay(state, effect, controller, log);
      return null;
    case 'search_library':
      return handleSearchLibrary(state, effect, controller, log);
    case 'search_library_to_graveyard':
      handleSearchLibraryToGraveyard(state, controller, log);
      return null;
    case 'create_token_copy':
    case 'clone':
    case 'copy_self':
      handleCreateTokenCopy(state, effect, card, controller, targets, log);
      return null;
    case 'become_copy':
      handleBecomeCopy(state, card, controller, targets, log);
      return null;
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
      handleAttach(state, card, controller, targets, log);
      return null;
    case 'exile_top_opponent':
      handleExileTopOpponent(state, effect, controller, log);
      return null;
    case 'copy_spell':
    case 'copy_next_spell':
      handleCopySpell(state, controller, log);
      return null;
    case 'extra_combat':
      handleExtraCombat(state, log);
      return null;
    case 'exile_graveyard_cast_copy':
      handleExileGraveyardCastCopy(state, effect, controller, effects, ei, log);
      return null;
    default:
      log.push(`[DEBUG] Efeito "${effect.type}" nao implementado em stack-part2.`);
      return null;
  }
}
