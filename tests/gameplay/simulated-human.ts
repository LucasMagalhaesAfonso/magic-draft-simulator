// @ts-nocheck
// simulated-human.ts — Bot that responds to ALL waitingForInput types
// Simulates a human player making reasonable decisions

import * as GameState from '../../src/engine/game-state';
import * as Cards from '../../src/engine/cards';
import * as CardUtils from '../../src/engine/card-utils';

/**
 * Auto-tap lands and cast a spell. Returns true if cast succeeded.
 * Mimics what useGameEngine does: autoTapForSpell → castSpell.
 */
function tryCast(gs: any, pid: number, card: any): boolean {
  const manaCost = card.mana_cost || '';
  const cmc = card.cmc || 0;
  if (!manaCost && !CardUtils.isLand(card)) return false;

  // Snapshot for rollback on failure
  const poolBefore = { ...gs.manaPool[pid] };
  const tappedBefore = new Set(
    gs.players[pid].zones.battlefield.cards
      .filter((c: any) => c._tapped)
      .map((c: any) => c._uid)
  );

  // Auto-tap lands to fill mana pool (same as useGameEngine does)
  GameState.autoTapForSpell(gs, pid, manaCost, cmc, card);

  // Try to cast
  const result = GameState.castSpell(gs, pid, card._uid);
  if (result?.success || result?.waitForInput || result?.waitForChoice || result?.pendingStack) {
    return true;
  }

  // Failed — rollback: restore pool and untap lands that were tapped
  gs.manaPool[pid] = poolBefore;
  for (const bf of gs.players[pid].zones.battlefield.cards) {
    if (bf._tapped && !tappedBefore.has(bf._uid)) {
      bf._tapped = false;
    }
  }
  return false;
}

export interface HumanAction {
  type: string;
  detail: string;
}

export interface SimHumanOptions {
  /** Card name we want to cast ASAP */
  targetCardName?: string;
  /** Force specific modal choice (0-indexed) */
  forceModalChoice?: number;
  /** Force scry choice: 'top' or 'bottom' */
  forceScryChoice?: 'top' | 'bottom';
  /** Max lands to play per main phase */
  maxLandsToPlay?: number;
  /** Cards to NOT cast (by name) */
  dontCast?: string[];
  /** Attack with everything when possible */
  attackAll?: boolean;
  /** Don't attack */
  dontAttack?: boolean;
}

/**
 * Respond to a waitingForInput state, returning a log of what was done.
 * Returns null if no waitingForInput or nothing to do.
 */
export function respondToInput(gs: any, options: SimHumanOptions = {}): HumanAction | null {
  const wi = gs.waitingForInput;
  if (!wi) return null;

  const pid = wi.playerId ?? gs.activePlayer;
  const isOurTurn = pid === 0; // Player 0 is always the simulated human

  switch (wi.type) {
    // ── Mulligan ──────────────────────────────────────────────────────
    case 'mulligan': {
      GameState.keepHand(gs, pid, []);
      return { type: 'mulligan', detail: 'kept hand' };
    }

    // ── Main phase — cast spells + play lands ────────────────────────
    case 'main_phase': {
      if (!isOurTurn) {
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
        return { type: 'main_phase', detail: 'not our turn, pass' };
      }
      return handleMainPhase(gs, pid, options);
    }

    // ── Combat ───────────────────────────────────────────────────────
    case 'declare_attackers': {
      if (!isOurTurn) {
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
        return { type: 'declare_attackers', detail: 'not our turn' };
      }
      return handleDeclareAttackers(gs, pid, options);
    }

    case 'declare_blockers': {
      if (isOurTurn) {
        // We're attacking, just pass
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
        return { type: 'declare_blockers', detail: 'we are attacking, pass' };
      }
      return handleDeclareBlockers(gs, pid);
    }

    case 'order_blockers': {
      // Just accept default order
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
      return { type: 'order_blockers', detail: 'accepted default order' };
    }

    // ── Priority windows ─────────────────────────────────────────────
    case 'instant_priority':
    case 'stack_priority':
    case 'trigger_priority':
    case 'end_step_pause': {
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
      return { type: wi.type, detail: 'pass priority' };
    }

    // ── Scry / Surveil ───────────────────────────────────────────────
    case 'scry':
    case 'surveil': {
      return handleScry(gs, options);
    }

    // ── Modal choice ─────────────────────────────────────────────────
    case 'modal_choice': {
      return handleModal(gs, options);
    }

    // ── Sacrifice ────────────────────────────────────────────────────
    case 'sacrifice': {
      return handleSacrifice(gs, pid);
    }

    // ── Discard ──────────────────────────────────────────────────────
    case 'discard':
    case 'discard_for_loot':
    case 'rummage_discard':
    case 'optional_discard_choice':
    case 'mandatory_discard': {
      return handleDiscard(gs, pid);
    }

    // ── Search library ───────────────────────────────────────────────
    case 'search_library':
    case 'search_library_choice':
    case 'search_library_to_gy': {
      return handleSearchLibrary(gs, wi.type);
    }

    // ── ETB targeting ────────────────────────────────────────────────
    case 'etb_counter_target':
    case 'grant_counter_target': {
      return handleETBTarget(gs, pid, 'counter');
    }
    case 'etb_destroy_target': {
      return handleETBTarget(gs, pid, 'destroy');
    }
    case 'etb_damage_target':
    case 'etb_any_damage_target':
    case 'damage_creature_target': {
      return handleETBDamageTarget(gs, pid);
    }
    case 'etb_bounce_target': {
      return handleETBTarget(gs, pid, 'bounce');
    }
    case 'etb_tap_target': {
      return handleETBTarget(gs, pid, 'tap');
    }
    case 'etb_exile_target': {
      return handleETBTarget(gs, pid, 'exile');
    }
    case 'etb_cant_block_target':
    case 'cant_block_target': {
      return handleETBTarget(gs, pid, 'cant_block');
    }
    case 'etb_clone_target': {
      return handleETBTarget(gs, pid, 'clone');
    }
    case 'etb_remove_counters_target': {
      return handleETBTarget(gs, pid, 'remove_counters');
    }

    // ── Post-modal target (spell needs BF target after cast) ────────
    case 'post_modal_target': {
      return handlePostModalTarget(gs, pid, wi);
    }

    // ── Buff choice ──────────────────────────────────────────────────
    case 'buff_choice':
    case 'multi_buff_choice': {
      return handleBuffChoice(gs, pid);
    }

    // ── Grant target ─────────────────────────────────────────────────
    case 'grant_target_choice':
    case 'eowyn_grant_choice': {
      return handleGrantTarget(gs, pid);
    }

    // ── Distribute counters ──────────────────────────────────────────
    case 'distribute_counters': {
      return handleDistributeCounters(gs, pid);
    }

    // ── Distribute damage ────────────────────────────────────────────
    case 'distribute_damage': {
      return handleDistributeDamage(gs, pid);
    }

    // ── Confirm optional ─────────────────────────────────────────────
    case 'confirm_optional': {
      GameState.resolveConfirmOptional(gs, true);
      return { type: 'confirm_optional', detail: 'confirmed' };
    }

    // ── Look top ─────────────────────────────────────────────────────
    case 'look_top_choice':
    case 'look_top_land_choice':
    case 'look_top_permanent_choice':
    case 'botanist_look':
    case 'traveling_botanist_choice': {
      return handleLookTop(gs);
    }

    // ── Graveyard interactions ────────────────────────────────────────
    case 'choose_gy_return':
    case 'graveyard_choice':
    case 'graveyard_card_choice':
    case 'graveyard_cast_choice': {
      return handleGraveyardChoice(gs);
    }

    // ── Legend rule ───────────────────────────────────────────────────
    case 'legend_rule_sacrifice':
    case 'legendary_choice_pre_cast': {
      return handleLegendRule(gs);
    }

    // ── Ward ─────────────────────────────────────────────────────────
    case 'ward_choice': {
      GameState.resolveWardChoice(gs, 'pay');
      return { type: 'ward_choice', detail: 'paid ward cost' };
    }

    // ── Ramp ─────────────────────────────────────────────────────────
    case 'ramp_choice': {
      return handleSearchLibrary(gs, 'search_library');
    }

    // ── Hideaway ─────────────────────────────────────────────────────
    case 'hideaway': {
      const cards = gs._pendingHideaway?.cards || [];
      const pick = cards[0];
      GameState.resolveHideaway(gs, pick?._uid || null);
      return { type: 'hideaway', detail: `hid ${pick?.name || 'nothing'}` };
    }

    // ── Clash ────────────────────────────────────────────────────────
    case 'clash': {
      GameState.resolveClash(gs, true);
      return { type: 'clash', detail: 'keep on top' };
    }

    // ── Mana color choice ────────────────────────────────────────────
    case 'mana_color_choice':
    case 'add_mana': {
      GameState.resolveManaChoice(gs, 'W');
      return { type: 'mana_color_choice', detail: 'chose W' };
    }

    // ── Ring bearer choice ───────────────────────────────────────────
    case 'ring_bearer_choice': {
      // Pick first creature
      const creatures = gs.players[pid].zones.battlefield.cards.filter((c: any) => CardUtils.isCreature(c));
      const pick = creatures[0];
      if (pick) {
        GameState.resolveRingBearerChoice(gs, pick._uid);
      } else {
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
      }
      return { type: 'ring_bearer_choice', detail: `chose ${pick?.name || 'none'}` };
    }

    // ── Behold ───────────────────────────────────────────────────────
    case 'behold_choice_multiple': {
      // Pass on behold
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
      return { type: 'behold', detail: 'passed' };
    }

    // ── Player choice ────────────────────────────────────────────────
    case 'player_choice': {
      GameState.resolvePlayerChoice(gs, 1); // Target opponent
      return { type: 'player_choice', detail: 'chose opponent' };
    }

    // ── Choose X cost ────────────────────────────────────────────────
    case 'choose_x_cost': {
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
      return { type: 'choose_x_cost', detail: 'X=0 (default)' };
    }

    // ── Endure ───────────────────────────────────────────────────────
    case 'endure_choice': {
      GameState.resolveEndureChoice(gs, 'take');
      return { type: 'endure', detail: 'take damage' };
    }

    // ── Blight ───────────────────────────────────────────────────────
    case 'blight_choice': {
      const oppCreatures = gs.players[1].zones.battlefield.cards.filter((c: any) => CardUtils.isCreature(c));
      if (oppCreatures.length > 0) {
        GameState.resolveBlightChoice(gs, oppCreatures[0]._uid);
      } else {
        gs.waitingForInput = null;
        GameState.reprocessCurrentPhase(gs);
      }
      return { type: 'blight', detail: 'applied blight' };
    }

    // ── AI visual pauses ─────────────────────────────────────────────
    case 'ai_untap_visual': {
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
      return { type: 'ai_visual', detail: 'skipped animation pause' };
    }

    // ── Fallback: unknown type ───────────────────────────────────────
    default: {
      // Try to just clear it and continue
      gs.waitingForInput = null;
      try {
        GameState.reprocessCurrentPhase(gs);
      } catch {
        // ignore
      }
      return { type: wi.type, detail: `UNKNOWN — cleared and continued` };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Handler helpers
// ═══════════════════════════════════════════════════════════════════════

function handleMainPhase(gs: any, pid: number, options: SimHumanOptions): HumanAction {
  const hand = gs.players[pid].zones.hand;
  const bf = gs.players[pid].zones.battlefield;
  const targetName = options.targetCardName?.toLowerCase();

  // 1. Play a land if we haven't
  if (!gs.landPlayedThisTurn) {
    const lands = hand.getAll().filter((c: any) => CardUtils.isLand(c));
    if (lands.length > 0) {
      GameState.castSpell(gs, pid, lands[0]._uid);
      return { type: 'main_phase', detail: `played land ${lands[0].name}` };
    }
  }

  // 2. Cast target card if in hand
  if (targetName) {
    const target = hand.getAll().find((c: any) => c.name.toLowerCase() === targetName);
    if (target && !CardUtils.isLand(target)) {
      if (tryCast(gs, pid, target)) {
        return { type: 'main_phase', detail: `cast target: ${target.name}` };
      }
    }
  }

  // 3. Cast any affordable spell (creatures first)
  const playable = GameState.getPlayableCards(gs, pid);
  if (playable && playable.length > 0) {
    // Prefer creatures
    const creatures = playable.filter((c: any) => CardUtils.isCreature(c) && !CardUtils.isLand(c));
    const others = playable.filter((c: any) => !CardUtils.isCreature(c) && !CardUtils.isLand(c));
    const sorted = [...creatures, ...others];

    for (const card of sorted) {
      if (options.dontCast?.includes(card.name)) continue;
      if (CardUtils.isLand(card)) continue;
      if (tryCast(gs, pid, card)) {
        return { type: 'main_phase', detail: `cast ${card.name}` };
      }
    }
  }

  // 4. Nothing to do — pass
  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'main_phase', detail: 'pass (nothing playable)' };
}

function handleDeclareAttackers(gs: any, pid: number, options: SimHumanOptions): HumanAction {
  if (options.dontAttack) {
    gs.waitingForInput = null;
    GameState.reprocessCurrentPhase(gs);
    return { type: 'declare_attackers', detail: 'chose not to attack' };
  }

  const bf = gs.players[pid].zones.battlefield;
  const creatures = bf.cards.filter((c: any) => CardUtils.isCreature(c) && CardUtils.canAttack(c));

  if (options.attackAll !== false && creatures.length > 0) {
    for (const c of creatures) {
      if (gs.combat) {
        gs.combat.attackers.push({ uid: c._uid, card: c });
        c._attacking = true;
      }
    }
    gs.waitingForInput = null;
    GameState.reprocessCurrentPhase(gs);
    return { type: 'declare_attackers', detail: `attacked with ${creatures.length} creatures` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'declare_attackers', detail: 'no attackers' };
}

function handleDeclareBlockers(gs: any, pid: number): HumanAction {
  // Simple: block biggest attacker with biggest blocker
  const myCreatures = gs.players[pid].zones.battlefield.cards
    .filter((c: any) => CardUtils.isCreature(c) && !c._tapped);
  const attackers = gs.combat?.attackers || [];

  let blocked = 0;
  for (const att of attackers) {
    if (myCreatures.length === 0) break;
    // Find a creature that can survive blocking
    const blocker = myCreatures.shift();
    if (blocker && gs.combat) {
      if (!gs.combat.blockers[att.uid]) gs.combat.blockers[att.uid] = [];
      gs.combat.blockers[att.uid].push({ uid: blocker._uid, card: blocker });
      blocker._blocking = att.uid;
      blocked++;
    }
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'declare_blockers', detail: `blocked ${blocked} attackers` };
}

function handleScry(gs: any, options: SimHumanOptions): HumanAction {
  const pending = gs._pendingScry;
  if (!pending?.cards?.length) {
    gs.waitingForInput = null;
    GameState.reprocessCurrentPhase(gs);
    return { type: 'scry', detail: 'no cards to scry' };
  }

  const forced = options.forceScryChoice || 'top';
  const isSurveil = pending.type === 'surveil';
  const choices = pending.cards.map(() => isSurveil && forced === 'bottom' ? 'graveyard' : forced);
  GameState.resolveScry(gs, choices);
  return { type: pending.type || 'scry', detail: `${choices.length} cards → ${forced}` };
}

function handleModal(gs: any, options: SimHumanOptions): HumanAction {
  const pending = gs._pendingModal;
  if (!pending) {
    gs.waitingForInput = null;
    GameState.reprocessCurrentPhase(gs);
    return { type: 'modal', detail: 'no pending modal' };
  }

  const choice = options.forceModalChoice ?? 0;
  GameState.resolveModal(gs, [choice]);
  return { type: 'modal', detail: `chose mode ${choice}` };
}

function handleSacrifice(gs: any, pid: number): HumanAction {
  const bf = gs.players[pid].zones.battlefield;
  // Sacrifice cheapest creature (by CMC)
  const creatures = bf.cards.filter((c: any) => CardUtils.isCreature(c));
  creatures.sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));

  if (creatures.length > 0) {
    GameState.resolveSacrifice(gs, creatures[0]._uid);
    return { type: 'sacrifice', detail: `sacrificed ${creatures[0].name}` };
  }

  GameState.resolveSacrifice(gs, null);
  return { type: 'sacrifice', detail: 'nothing to sacrifice' };
}

function handleDiscard(gs: any, pid: number): HumanAction {
  const hand = gs.players[pid].zones.hand;
  const cards = hand.getAll();
  const amount = gs.waitingForInput?.amount || 1;

  // Discard highest CMC non-land cards
  const sorted = [...cards].sort((a: any, b: any) => (b.cmc || 0) - (a.cmc || 0));
  const toDiscard = sorted.slice(0, amount).map((c: any) => c._uid);

  GameState.resolveMandatoryDiscard(gs, toDiscard);
  return { type: 'discard', detail: `discarded ${toDiscard.length} cards` };
}

function handleSearchLibrary(gs: any, type: string): HumanAction {
  const pending = gs._pendingSearchLibrary || gs._pendingSearchChoice || gs._pendingRamp;
  const choices = pending?.choices || pending?.candidates || [];

  if (choices.length > 0) {
    // Pick first valid
    const pick = choices[0];
    if (type === 'search_library_to_gy') {
      GameState.resolveSearchToGY(gs, pick._uid || pick);
    } else {
      GameState.resolveSearchLibrary(gs, pick._uid || pick);
    }
    return { type: 'search_library', detail: `picked ${pick.name || pick}` };
  }

  // No choices — decline
  if (type === 'search_library_to_gy') {
    GameState.resolveSearchToGY(gs, null);
  } else {
    GameState.resolveSearchLibrary(gs, null);
  }
  return { type: 'search_library', detail: 'no choices, declined' };
}

function handleETBTarget(gs: any, pid: number, effectType: string): HumanAction {
  const oppBf = gs.players[1 - pid]?.zones.battlefield.cards || [];
  const myBf = gs.players[pid]?.zones.battlefield.cards || [];
  const oppCreatures = oppBf.filter((c: any) => CardUtils.isCreature(c));
  const myCreatures = myBf.filter((c: any) => CardUtils.isCreature(c));

  let targetUid: string | null = null;
  let targetName = 'none';

  switch (effectType) {
    case 'counter':
    case 'clone': {
      // Target own creature
      const t = myCreatures[0];
      targetUid = t?._uid || null;
      targetName = t?.name || 'none';
      break;
    }
    case 'remove_counters':
    case 'destroy':
    case 'bounce':
    case 'tap':
    case 'exile':
    case 'cant_block': {
      // Target opponent creature
      const t = oppCreatures[0];
      targetUid = t?._uid || null;
      targetName = t?.name || 'none';
      break;
    }
  }

  // Call appropriate resolve function
  switch (effectType) {
    case 'counter': GameState.resolveETBCounterTarget(gs, targetUid); break;
    case 'destroy': GameState.resolveETBDestroyTarget(gs, targetUid); break;
    case 'bounce': GameState.resolveETBBounceTarget(gs, targetUid ? [targetUid] : []); break;
    case 'tap': GameState.resolveETBTapTarget(gs, targetUid ? [targetUid] : []); break;
    case 'exile': GameState.resolveETBExileTarget(gs, targetUid ? [targetUid] : []); break;
    case 'cant_block': GameState.resolveCantBlockTarget(gs, targetUid || ''); break;
    case 'clone': GameState.resolveETBCloneTarget(gs, targetUid); break;
    case 'remove_counters': GameState.resolveETBRemoveCountersTarget?.(gs, targetUid); break;
    default:
      gs.waitingForInput = null;
      GameState.reprocessCurrentPhase(gs);
  }

  return { type: `etb_${effectType}`, detail: `targeted ${targetName}` };
}

function handleETBDamageTarget(gs: any, pid: number): HumanAction {
  const oppCreatures = gs.players[1 - pid]?.zones.battlefield.cards
    .filter((c: any) => CardUtils.isCreature(c)) || [];

  if (oppCreatures.length > 0) {
    GameState.resolveETBDamageTarget(gs, { type: 'creature', uid: oppCreatures[0]._uid });
    return { type: 'etb_damage', detail: `damaged ${oppCreatures[0].name}` };
  }

  // Hit opponent player
  GameState.resolveETBDamageTarget(gs, { type: 'player', player: 1 - pid });
  return { type: 'etb_damage', detail: 'damaged opponent player' };
}

function handlePostModalTarget(gs: any, pid: number, wi: any): HumanAction {
  const targetType = wi.targetType || '';
  const myBF = gs.players[pid].zones.battlefield.cards;
  const oppBF = gs.players[1 - pid]?.zones.battlefield.cards || [];

  let candidates: any[] = [];
  if (targetType.startsWith('own_') || targetType === 'own_creature') {
    candidates = myBF.filter((c: any) => CardUtils.isCreature(c));
  } else if (targetType.startsWith('opponent_') || targetType === 'opponent_creature') {
    candidates = oppBF.filter((c: any) => CardUtils.isCreature(c));
  } else if (targetType === 'creature' || targetType === 'any') {
    // Prefer opponent creatures for fight/damage
    candidates = [...oppBF.filter((c: any) => CardUtils.isCreature(c)), ...myBF.filter((c: any) => CardUtils.isCreature(c))];
  } else {
    // Fallback: any creature on either side
    candidates = [...myBF, ...oppBF].filter((c: any) => CardUtils.isCreature(c));
  }

  if (candidates.length > 0) {
    const picked = candidates[0];
    const pickedPid = myBF.includes(picked) ? pid : 1 - pid;
    GameState.resolvePostModalTarget(gs, { type: 'creature', uid: picked._uid, player: pickedPid });
    return { type: 'post_modal_target', detail: `targeted ${picked.name}` };
  }

  // No valid target — cancel
  GameState.resolvePostModalTarget(gs, null);
  return { type: 'post_modal_target', detail: 'no valid target, cancelled' };
}

function handleBuffChoice(gs: any, pid: number): HumanAction {
  const myCreatures = gs.players[pid].zones.battlefield.cards.filter((c: any) => CardUtils.isCreature(c));
  if (myCreatures.length > 0) {
    GameState.resolveBuffChoice(gs, myCreatures[0]._uid);
    return { type: 'buff_choice', detail: `buffed ${myCreatures[0].name}` };
  }
  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'buff_choice', detail: 'no targets' };
}

function handleGrantTarget(gs: any, pid: number): HumanAction {
  const myCreatures = gs.players[pid].zones.battlefield.cards.filter((c: any) => CardUtils.isCreature(c));
  if (myCreatures.length > 0) {
    GameState.resolveGrantTarget(gs, myCreatures[0]._uid);
    return { type: 'grant_target', detail: `granted to ${myCreatures[0].name}` };
  }
  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'grant_target', detail: 'no targets' };
}

function handleDistributeCounters(gs: any, pid: number): HumanAction {
  const pending = gs._pendingDistribute;
  const amount = pending?.amount || 1;
  const myCreatures = gs.players[pid].zones.battlefield.cards.filter((c: any) => CardUtils.isCreature(c));

  if (myCreatures.length > 0) {
    // Put all on first creature
    const dist: Record<string, number> = {};
    dist[myCreatures[0]._uid] = amount;
    GameState.resolveDistributeCounters(gs, dist);
    return { type: 'distribute_counters', detail: `${amount} counters on ${myCreatures[0].name}` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'distribute_counters', detail: 'no targets' };
}

function handleDistributeDamage(gs: any, pid: number): HumanAction {
  const pending = gs._pendingDistributeDamage;
  const amount = pending?.amount || 1;
  const oppCreatures = gs.players[1 - pid]?.zones.battlefield.cards
    .filter((c: any) => CardUtils.isCreature(c)) || [];

  if (oppCreatures.length > 0) {
    const dist: Record<string, number> = {};
    dist[oppCreatures[0]._uid] = amount;
    GameState.resolveDistributeDamage(gs, dist);
    return { type: 'distribute_damage', detail: `${amount} damage on ${oppCreatures[0].name}` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'distribute_damage', detail: 'no targets' };
}

function handleLookTop(gs: any): HumanAction {
  const pending = gs._pendingLookTop;
  const cards = pending?.cards || [];

  if (cards.length > 0) {
    // Keep first, bottom the rest
    const choices = cards.map((_: any, i: number) => i === 0 ? 'hand' : 'bottom');
    GameState.resolveLookTop(gs, choices);
    return { type: 'look_top', detail: `kept ${cards[0]?.name || 'first'}, bottomed rest` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'look_top', detail: 'no cards' };
}

function handleGraveyardChoice(gs: any): HumanAction {
  const pending = gs._pendingGYReturn || gs._pendingGraveyardChoice || gs._pendingGraveyardCard || gs._pendingGraveyardCardChoice;
  const choices = pending?.cards || pending?.choices || [];

  if (choices.length > 0) {
    const pick = choices[0];
    const uid = pick._uid || pick;

    if (gs.waitingForInput?.type === 'graveyard_cast_choice') {
      GameState.resolveGraveyardCastChoice(gs, uid);
    } else if (gs.waitingForInput?.type === 'graveyard_card_choice') {
      GameState.resolveGraveyardCardChoice(gs, [uid]);
    } else {
      GameState.resolveGYReturn(gs, [uid]);
    }
    return { type: 'gy_choice', detail: `chose ${pick.name || uid}` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'gy_choice', detail: 'no choices' };
}

function handleLegendRule(gs: any): HumanAction {
  const pending = gs._pendingLegendRuleSacrifice;
  const candidates = pending?.candidates || [];

  if (candidates.length > 0) {
    // Sacrifice the newly cast copy, keeping the one already on battlefield
    const toSac = candidates.find((c: any) => c.isNew) || candidates[0];
    GameState.resolveLegendRuleSacrifice(gs, toSac.uid);
    return { type: 'legend_rule', detail: `sacrificed ${toSac.name}` };
  }

  gs.waitingForInput = null;
  GameState.reprocessCurrentPhase(gs);
  return { type: 'legend_rule', detail: 'no candidates' };
}
