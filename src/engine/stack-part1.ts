// @ts-nocheck
// stack-part1.ts — First half of stack module (legacy stack.js lines 1-1700)

import * as Cards from './cards';
import * as Mana from './mana';
import * as CardUtils from './card-utils';
import * as GameState from './game-state';
import * as GameAI from './game-ai';
import * as StackPart2 from './stack-part2';
import { vfxPlay, vfxPlayText } from './vfx-bridge';

// Legacy name aliases
const CardEngine = { ...Cards, ...CardUtils };
const ManaSystem = Mana;
// StackEngine alias for legacy _processNextEffect calls
const StackEngine = { _processNextEffect: (s: any) => StackPart2.processNextEffect(s) };

// ---------------------------------------------------------------------------
// Stack data structure helpers
// ---------------------------------------------------------------------------

export function create() {
  return {
    items: [] // [{card, controller, targets, effects}]
  };
}

export function push(stack, item) {
  stack.items.push(item);
}

export function resolve(stack, state) {
  const log = [];
  let safetyCounter = 0;

  while (stack.items.length > 0) {
    safetyCounter++;
    if (safetyCounter > 50) {
      console.error('[STACK] Safety limit hit! Stack items:', stack.items.map(i => i.card?.name));
      state.log?.push('[ERRO] Stack em loop infinito - interrompido');
      break;
    }
    // Capture waitingForInput state BEFORE resolving this item
    const waitingBefore = state.waitingForInput?.type;
    const item = stack.items.pop();
    console.log(`[STACK] Resolving: ${item.card?.name} (${item.effects?.length} effects)`);
    const results = _resolveItem(item, state);
    console.log(`[STACK] Done: ${item.card?.name}, waitingForInput: ${state.waitingForInput?.type}`);
    // Ensure results is always an array
    if (Array.isArray(results)) {
      log.push(...results);
    } else {
      console.warn('[STACK] _resolveItem returned non-array:', results);
    }
    // If resolving this item set a NEW waitingForInput (human needs to make a choice),
    // stop resolving additional stack items to avoid overwriting the pending input state.
    const waitingAfter = state.waitingForInput?.type;
    if (waitingAfter && waitingAfter !== waitingBefore) {
      break;
    }
  }

  return log;
}

// Convenience: push + resolve in one call (used by adventure spells)
export function resolveEffects(state, controller, card, effects, targets) {
  push(state.stack, { card, controller, targets: targets || [], effects });
  const log = resolve(state.stack, state);
  state.log.push(...log);
}

// ---------------------------------------------------------------------------
// Internal: resolve a single stack item
// ---------------------------------------------------------------------------

export function _resolveItem(item, state) {
  // Alias for compatibility with code that passes `gameState`
  const gameState = state;
  const { card, controller, targets, effects } = item;
  const log = [];
  const opponent = controller === 0 ? 1 : 0;

  // Check if spell was countered
  if (card._countered) {
    log.push(`${card.name} was countered and does not resolve.`);
    return log;
  }

  log.push(`${card.name} resolve.`);

  // Helper: resolve dynamic amounts to numbers
  const resolveAmount = (amt) => {
    if (typeof amt === 'number') return amt;
    if (!amt) return 0;
    if (amt === 'vivid') return CardUtils.countVividColors ? CardUtils.countVividColors(gameState, controller) : 0;
    if (amt === 'X') return gameState._currentXValue || 0; // Use context X value
    if (amt === 'creature_count') return gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c)).length;
    if (amt === 'human_count') return gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c) && Cards.hasCreatureType?.(c, 'Human')).length;
    if (amt === 'attacking_count') return gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c) && (c as any)._attacking).length;
    if (amt === 'lands_count') return gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isLand(c)).length;
    if (amt === 'lands_in_gy_count') return gameState.players[controller].zones.graveyard.getAll().filter(c => Cards.isLand(c)).length;
    if (amt === 'spells_this_turn') return gameState._spellsThisTurn ? gameState._spellsThisTurn[controller] || 0 : 0;
    if (amt === 'returned_creature_power') return gameState._lastReturnedPower || 0; // For Lie in Wait
    if (amt === 'mana_value') return card.cmc || 0;
    if (amt === 'food_count') return gameState.players[controller].zones.battlefield.cards.filter(c => (c.name || '').toLowerCase() === 'food' || (c.type_line || '').toLowerCase().includes('food')).length;
    if (amt === 'prevented') return gameState._lastPreventedDamage || 0;
    if (amt === 'scry_amount') return gameState._lastScryAmount || 1;
    if (amt === 'instants_sorceries_in_gy') {
      return gameState.players[controller].zones.graveyard.getAll().filter(c => {
        const tl = (c.type_line || '').toLowerCase();
        return tl.includes('instant') || tl.includes('sorcery');
      }).length;
    }
    if (amt === 'creatures_plus_foods') {
      const bf = gameState.players[controller].zones.battlefield.cards;
      return bf.filter(c => Cards.isCreature(c)).length +
        bf.filter(c => (c.name || '').toLowerCase() === 'food' || (c.type_line || '').toLowerCase().includes('food')).length;
    }
    if (amt === 'double_attacking_treefolk') {
      return gameState.players[controller].zones.battlefield.cards.filter(
        c => Cards.isCreature(c) && (c as any)._attacking && Cards.hasCreatureType?.(c, 'Treefolk')
      ).length * 2;
    }
    if (amt === 'ring_bearer_power') {
      const bearerUid = gameState._ringBearer?.[controller];
      if (bearerUid) {
        const bearer = gameState.players[controller].zones.battlefield.get(bearerUid);
        if (bearer) return Cards.getPower ? Cards.getPower(bearer) : (parseInt(bearer.power) || 0) + (bearer._powerMod || 0) + (bearer._counters?.['+1/+1'] || 0) - (bearer._counters?.['-1/-1'] || 0);
      }
      return 0;
    }
    if (amt === 'creature_cards_in_gy') return gameState.players[controller].zones.graveyard.getAll().filter(c => Cards.isCreature(c)).length;
    if (amt === 'last_destroy_all_count') return gameState._lastDestroyAllCount || 0;
    if (amt === 'orc_army_power') {
      // Foray of Orcs: damage equal to the Orc Army token's power
      for (const p of gameState.players) {
        const army = p.zones.battlefield.cards.find((c: any) => (c.type_line || '').includes('Orc Army'));
        if (army) return Cards.getPower ? Cards.getPower(army) : (parseInt(army.power) || 0) + (army._powerMod || 0) + (army._counters?.['+1/+1'] || 0);
      }
      return 0;
    }
    if (amt === 'burden_counters') {
      // The One Ring: draw/lose life equal to burden counters on the source card
      const source = gameState.players[controller].zones.battlefield.get(card._uid);
      return source?._counters?.burden || 0;
    }
    if (amt === 'greatest_toughness') {
      const creatures = gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c));
      return creatures.length > 0 ? Math.max(...creatures.map(c => Cards.getToughness(c))) : 0;
    }
    // Safety: if still a string, parse as int or default to 0
    const parsed = parseInt(amt);
    return isNaN(parsed) ? 0 : parsed;
  };

  const waitingBefore = gameState.waitingForInput;
  effectLoop: for (let ei = 0; ei < effects.length; ei++) {
    const effect = effects[ei];
    console.log(`[EFFECT] ${card?.name} effect[${ei}]: type=${effect.type} target=${effect.target}`);
    // Check effect-level condition
    if (effect.condition) {
      // Special case: "if_cast" needs card context
      if (effect.condition === 'if_cast' && !card._wasCast) {
        continue; // Card was not cast, skip this effect
      }
      // Special case: "dealt_damage_this_turn" for targeted effects (Unsparing Boltcaster)
      // Checks if the TARGET creature was dealt damage — not the controller's damage dealt
      else if (effect.condition === 'dealt_damage_this_turn') {
        if (targets && targets.length > 0) {
          // Targets already chosen: verify the chosen target was actually damaged
          const target = targets[0];
          if (target.type === 'creature') {
            const bf = gameState.players[target.player].zones.battlefield;
            const targetCard = bf.get(target.uid);
            if (!targetCard || !targetCard._damagedThisTurn) {
              continue; // chosen target not damaged this turn
            }
          }
        } else {
          // No targets yet: check if ANY valid opponent creature was damaged this turn
          const oppBf = gameState.players[opponent].zones.battlefield;
          const validTargets = oppBf.cards.filter((c: any) =>
            Cards.isCreature(c) && c._damagedThisTurn && Cards.canBeTargeted(c, controller)
          );
          if (validTargets.length === 0) continue; // no valid target exists
        }
      }
      // Other conditions via GameState
      // Note: destroy_all/destroy_all_choose_spared use 'condition' as an internal filter
      // (e.g. power_3_or_greater), NOT as a prerequisite — skip the generic condition check for them.
      else if (effect.condition !== 'dealt_damage_this_turn'
          && effect.type !== 'destroy_all' && effect.type !== 'destroy_all_choose_spared'
          && typeof GameState._checkEffectCondition === 'function') {
        // For power-based conditions, pass the own-side target creature as card
        const ownTarget = targets?.find((t: any) => t.player === controller);
        const ownCard = ownTarget ? gameState.players[controller].zones.battlefield.get(ownTarget.uid) : null;
        const condData = ownCard ? { card: ownCard } : undefined;
        if (!GameState._checkEffectCondition(gameState, controller, effect, condData)) {
          continue; // Condition not met, skip
        }
      }
    }

    // If a previous effect in THIS resolution set waitingForInput (scry, surveil, etc.),
    // save remaining effects to resume after human input completes
    if (gameState.waitingForInput && gameState.waitingForInput !== waitingBefore && ei > 0) {
      gameState._pendingStackEffects = {
        card, controller, targets,
        effects: effects.slice(ei),
        log
      };
      return log;
    }

    switch (effect.type) {
      case 'modal': {
        const modes = effect.modes || [];
        if (modes.length === 0) break;
        let chooseCount = effect.chooseUpTo || (effect.chooseTwo ? 2 : (effect.chooseCount || 1));
        // Conditional chooseCount (e.g. Flame of Anor: choose 2 if controlling a Wizard)
        if (effect.chooseCountIfWizard && gameState.players[controller].zones.battlefield.cards
            .some((c: any) => (c.type_line || '').includes('Wizard'))) {
          chooseCount = effect.chooseCountIfWizard;
        }
        const minChoices = effect.minChoices || (effect.chooseUpTo ? 1 : chooseCount);
        const isUpTo = !!effect.chooseUpTo;

        if (controller === 0 && gameState.players[0].isHuman) {
          // Human player: show interactive modal choice overlay
          // Use pre-cast mana snapshot if available (captures state BEFORE payment)
          const preCast = gameState._preCastManaSnapshot;
          const _savedPool = preCast?.pool || { ...(gameState.manaPool?.[controller] || {}) };
          const _savedTapped = preCast?.tapped || gameState.players[controller].zones.battlefield.cards
            .filter((c: any) => c._tapped).map((c: any) => c._uid);
          // Compute disabled modes (e.g. Pippin's Bravery: mode that sacrifices Food when no Food available)
          const myBfForCastModal = gameState.players[controller].zones.battlefield.cards;
          const castDisabledModes: number[] = [];
          for (let mi = 0; mi < modes.length; mi++) {
            const m = modes[mi];
            const modeEffects = Array.isArray(m) ? m : (m?.effects || [m]);
            for (const me of modeEffects) {
              if (me.type === 'sacrifice' && me.target === 'Food') {
                const hasFood = myBfForCastModal.some((c: any) => c.name === 'Food' || (c.type_line || '').toLowerCase().includes('food'));
                if (!hasFood) castDisabledModes.push(mi);
              }
            }
          }
          gameState._pendingModal = {
            cardName: card.name,
            modes: modes.map((m: any, idx: number) => castDisabledModes.includes(idx) ? { ...m, disabled: true } : m),
            chooseCount: chooseCount,
            minChoices: minChoices,
            isUpTo: isUpTo,
            controller: controller,
            card: card,
            targets: targets,
            remainingEffects: effects.slice(ei + 1),
            savedPool: _savedPool,
            savedTapped: _savedTapped,
          };
          gameState.waitingForInput = { type: 'modal_choice', playerId: controller };
          log.push(`${card.name}: choose ${chooseCount === 1 ? 'a mode' : chooseCount + ' modes'}.`);
          return log; // Stop resolving — will continue after human picks
        } else {
          // AI picks best mode(s)
          const chosen = _aiChooseModes(modes, chooseCount, gameState, controller, opponent, targets);
          // Support both flat effect arrays and ModalMode objects { label, effects[] }
          const modeEffects = chosen.flatMap(m => {
            if (Array.isArray(m)) return m;
            if (m && m.effects && Array.isArray(m.effects)) return m.effects;
            return [m];
          });
          effects.splice(ei + 1, 0, ...modeEffects);
          log.push(`Mode(s) chosen: ${chosen.map((m: any) => m?.label || (Array.isArray(m) ? m.map((e: any) => e.type).join('+') : m.type)).join(', ')}.`);
        }
        break;
      }

      case 'damage': {
        const dmgAmt = resolveAmount(effect.amount);
        // Check for divided damage (Twin Bolt)
        if (effect.target === 'divided' && targets && targets.length > 0) {
          for (const target of targets) {
            const dividedDmg = target.dividedAmount || dmgAmt;
            if (target.type === 'creature') {
              const bf = gameState.players[target.player].zones.battlefield;
              const creature = bf.get(target.uid);
              if (creature) {
                if (!Cards.canBeTargeted(creature, controller)) {
                  log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
                  continue;
                }
                if (!_payWardCost(creature, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) continue;
                vfxPlay('damage', creature._uid);
                vfxPlayText(`-${dividedDmg}`, creature._uid, '#ff4a4a');
                creature._damage += dividedDmg;
                creature._damagedThisTurn = true;
                log.push(`${creature.name} takes ${dividedDmg} damage.`);
                GameState._checkCreatureDeath(gameState, creature, target.player);
              }
            } else if (target.type === 'player') {
              gameState.players[target.player].life -= dividedDmg;
              if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
              gameState._damageDealtThisTurn[target.player] = (gameState._damageDealtThisTurn[target.player] || 0) + dividedDmg;
              log.push(`${dividedDmg} damage to player ${target.player}. (Life: ${gameState.players[target.player].life})`);
              vfxPlay('playerDamage', 'p' + target.player);
              vfxPlayText(`-${dividedDmg}`, 'p' + target.player, '#ff4a4a');
            }
          }
          // Lifelink for total damage dealt
          if (card && Cards.isCreature(card) && Cards.hasLifelink(card)) {
            const totalDmg = targets.reduce((sum, t) => sum + (t.dividedAmount || 0), 0);
            gameState.players[controller].life += totalDmg;
            log.push(`Lifelink: +${totalDmg} life.`);
            vfxPlay('heal', 'p' + controller);
          }
        } else if (effect.target === 'opponent' || effect.target === 'player') {
          gameState.players[opponent].life -= dmgAmt;
          gameState._lastDamagedPlayer = opponent; // Track for "damaged_player" discard effects
          // Track damage dealt this turn (for Spinerock Knoll hideaway)
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[opponent] = (gameState._damageDealtThisTurn[opponent] || 0) + dmgAmt;
          log.push(`${dmgAmt} damage to opponent. (Life: ${gameState.players[opponent].life})`);
          vfxPlay('playerDamage', 'p' + opponent);
          // Lifelink on spell damage from source creature
          if (card && Cards.isCreature(card) && Cards.hasLifelink(card)) {
            gameState.players[controller].life += dmgAmt;
            log.push(`Lifelink: +${dmgAmt} life.`);
            vfxPlay('heal', 'p' + controller);
          }
        } else if (targets && targets.length > 0) {
          // Loop through all pre-selected targets (supports up_to: N multi-target effects)
          let totalLifelinkDmg = 0;
          for (const target of targets) {
            // Validate target (hexproof/shroud)
            if (target.type === 'creature') {
              const bf = gameState.players[target.player].zones.battlefield;
              const creature = bf.get(target.uid);
              if (creature) {
                if (!Cards.canBeTargeted(creature, controller)) {
                  log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
                  continue;
                }
                if (!_payWardCost(creature, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) {
                  // If ward set up a human prompt, save pending damage for after payment
                  if (gameState.waitingForInput?.type === 'ward_choice') {
                    gameState._pendingWardDamage = { target, amount: dmgAmt, controllerId: controller, sourceUid: card?._uid };
                    if (gameState._pendingWardChoice) gameState._pendingWardChoice.damageMode = true;
                  }
                  break;
                }
                vfxPlay('damage', creature._uid);
                creature._damage += dmgAmt;
                // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
                creature._damagedThisTurn = true;
                if (effect.exile_on_death) creature._exileOnDeath = true; // Smite the Deathless
                totalLifelinkDmg += dmgAmt;
                if (creature._damage >= Cards.getToughness(creature)) {
                  const died = GameState.creatureDies(gameState, creature, target.player);
                  log.push(died !== false
                    ? `${creature.name} takes ${dmgAmt} damage and dies.`
                    : `${creature.name} takes ${dmgAmt} damage (indestructible/regenerate).`);
                } else {
                  log.push(`${creature.name} takes ${dmgAmt} damage.`);
                }
              }
            } else if (target.type === 'player') {
              gameState.players[target.player].life -= dmgAmt;
              gameState._lastDamagedPlayer = target.player; // Track for "damaged_player" discard effects
              log.push(`${dmgAmt} damage to player. (Life: ${gameState.players[target.player].life})`);
              totalLifelinkDmg += dmgAmt;
            } else if (target.type === 'permanent') {
              // Planeswalker damage
              for (let pid = 0; pid < gameState.players.length; pid++) {
                const pw = gameState.players[pid].zones.battlefield.get(target.uid);
                if (pw && Cards.isPlaneswalker(pw)) {
                  GameState.damagePlaneswalker(gameState, pw, dmgAmt, pid);
                  totalLifelinkDmg += dmgAmt;
                  break;
                }
              }
            }
          }
          // Lifelink for total damage dealt across all targets
          if (card && Cards.isCreature(card) && Cards.hasLifelink(card) && totalLifelinkDmg > 0) {
            gameState.players[controller].life += totalLifelinkDmg;
            log.push(`Lifelink: +${totalLifelinkDmg} life.`);
            vfxPlay('heal', 'p' + controller);
          }
        } else if (effect.target === 'any' || effect.target === 'any_target') {
          // "Any target" damage — human picks creature or player; AI auto-damages opponent
          if (controller === 0 && gameState.players[0].isHuman) {
            gameState._pendingEtbAnyDamage = { amount: dmgAmt, controllerId: controller, sourceUid: card?._uid };
            gameState.waitingForInput = { type: 'etb_any_damage_target', playerId: 0 };
            // Save remaining effects (gainLife, discard, etc.) to resume after human picks
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = {
                card, controller, targets,
                effects: effects.slice(ei + 1),
                log,
              };
            }
            return log;
          }
          // AI: damage opponent player
          gameState.players[opponent].life -= dmgAmt;
          gameState._lastDamagedPlayer = opponent;
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[opponent] = (gameState._damageDealtThisTurn[opponent] || 0) + dmgAmt;
          log.push(`${dmgAmt} damage to opponent. (Life: ${gameState.players[opponent].life})`);
          vfxPlay('playerDamage', 'p' + opponent);
        } else if (effect.target === 'opponent_creature' || effect.target === 'creature') {
          // Auto-target: damage with no pre-selected targets (modal spells, ETB damage, etc.)
          // For 'creature': prefer opponent creatures (damage spells target opponents);
          // fall back to own creatures only if no opponent targets exist.
          let targetPid = opponent;
          let candidates = gameState.players[targetPid].zones.battlefield.cards
            .filter((c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller));
          // Fallback: if no opponent creatures, check own side (for 'creature' target only)
          if (candidates.length === 0 && effect.target === 'creature') {
            targetPid = controller;
            candidates = gameState.players[targetPid].zones.battlefield.cards
              .filter((c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller));
          }
          // Respect dealt_damage_this_turn condition — only damaged creatures are valid targets
          if (effect.condition === 'dealt_damage_this_turn') {
            candidates = candidates.filter((c: any) => c._damagedThisTurn);
          }
          if (candidates.length === 0) break;
          // Pick up to up_to: N targets (default 1), sorted by highest power
          const maxAutoTargets = (effect as any).up_to || 1;
          candidates.sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a));
          const autoTargets = candidates.slice(0, maxAutoTargets);
          for (const autoCreature of autoTargets) {
            if (!_payWardCost(autoCreature, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) break;
            vfxPlay('damage', autoCreature._uid);
            autoCreature._damage += dmgAmt;
            autoCreature._damagedThisTurn = true;
            if (effect.exile_on_death) autoCreature._exileOnDeath = true; // Smite the Deathless
            if (autoCreature._damage >= Cards.getToughness(autoCreature)) {
              const died = GameState.creatureDies(gameState, autoCreature, targetPid);
              log.push(died !== false
                ? `${autoCreature.name} takes ${dmgAmt} damage and dies.`
                : `${autoCreature.name} takes ${dmgAmt} damage (indestructible/regenerate).`);
            } else {
              log.push(`${autoCreature.name} takes ${dmgAmt} damage.`);
            }
          }
        }
        break;
      }

      case 'damage_all_creatures': {
        for (const pid of [0, 1]) {
          const bf = gameState.players[pid].zones.battlefield;
          const creatures = bf.cards.filter(c => Cards.isCreature(c));
          const dying = [];
          for (const creature of creatures) {
            creature._damage += effect.amount;
            if (creature._damage >= Cards.getToughness(creature)) {
              dying.push(creature);
              log.push(`${creature.name} takes ${effect.amount} damage and dies.`);
            } else {
              log.push(`${creature.name} takes ${effect.amount} damage.`);
            }
          }
          dying.forEach(c => GameState.creatureDies(gameState, c, pid));
        }
        break;
      }

      case 'damage_divided': {
        // Damage divided among any number of targets (e.g., Twin Bolt, Ureni)
        const totalDamage = resolveAmount(effect.amount);
        if (targets && targets.length > 0) {
          const isHuman = gameState.players[controller].isHuman;
          // Human with 2+ targets: show distribute UI
          if (isHuman && targets.length > 1) {
            gameState._pendingDistributeDamage = { totalDamage, targets, controller };
            gameState.waitingForInput = { type: 'distribute_damage', playerId: controller, totalDamage, targets };
            return null; // Pause for human input
          }
          // AI or single target: divide evenly
          const dmgPerTarget = Math.floor(totalDamage / targets.length);
          let remainingDmg = totalDamage;

          targets.forEach((target, idx) => {
            const dmg = (idx === targets.length - 1) ? remainingDmg : dmgPerTarget;
            remainingDmg -= dmg;

            if (target.type === 'creature') {
              const bf = gameState.players[target.player].zones.battlefield;
              const creature = bf.get(target.uid);
              if (creature && Cards.canBeTargeted(creature, controller)) {
                vfxPlay('damage', creature._uid);
                creature._damage += dmg;
                if (creature._damage >= Cards.getToughness(creature)) {
                  GameState.creatureDies(gameState, creature, target.player);
                  log.push(`${creature.name} takes ${dmg} damage and dies.`);
                } else {
                  log.push(`${creature.name} takes ${dmg} damage.`);
                }
              }
            } else if (target.type === 'player') {
              gameState.players[target.player].life -= dmg;
              log.push(`${dmg} damage to ${target.player === 0 ? 'you' : 'opponent'}. (Life: ${gameState.players[target.player].life})`);
              vfxPlay('playerDamage', 'p' + target.player);
            }
          });
        }
        break;
      }

      case 'sacrifice': {
        // Two modes:
        // 1. Targeted sacrifice (force opponent to sacrifice)
        // 2. Controller sacrifices own permanent (Felothar, Duty Beyond Death)

        if (targets && targets.length > 0 && !effect.target) {
          // Mode 1: Targeted sacrifice (e.g., Liliana forcing opponent to sac a pre-selected target)
          // Only when effect.target is NOT specified — if it IS specified (e.g. 'Food'), use filter path below
          const target = targets[0];
          GameState.sacrifice(gameState, target.player ?? target.playerId ?? opponent, target.uid);
          vfxPlay('death', target.uid);
          log.push(`Permanent sacrificed.`);
        } else if (effect.target === 'each_player_creature') {
          // Route to game-state.ts which handles both players + human overlay
          const r = GameState._resolveSimpleEffect(gameState, controller, effect, { cardUid: card?._uid });
          if (r && typeof r === 'string') log.push(r);
          if (gameState.waitingForInput) {
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          }
        } else {
          // Mode 2: Controller (or opponent) sacrifices a permanent
          // opponent_creature target → the OPPONENT of the controller sacrifices
          const targetPlayerId = (effect.target === 'opponent_creature') ? opponent : controller;
          const bf = gameState.players[targetPlayerId].zones.battlefield;

          // Filter permanents based on target
          let sacrificeable = bf.cards.filter(c => {
            if (effect.target === 'nonland_permanent') return !Cards.isLand(c);
            if (effect.target === 'creature' || effect.target === 'opponent_creature') return Cards.isCreature(c);
            if (effect.target === 'artifact_or_enchantment') return Cards.isArtifact(c) || Cards.isEnchantment(c);
            if (effect.target === 'Food') return c.name === 'Food' || (c.type_line || '').toLowerCase().includes('food');
            return true; // Default: can sacrifice anything
          });

          if (sacrificeable.length === 0) {
            if (!effect.optional) {
              log.push('No valid permanent to sacrifice.');
              break effectLoop; // abort remaining effects (e.g. buff from Pippin's Bravery mode 2)
            }
            break;
          }

          if (effect.optional && targetPlayerId !== 0) {
            // AI decides whether to sacrifice (only if good reason)
            const shouldSacrifice = sacrificeable.some(c =>
              c._isToken || // Sacrifice tokens freely
              Cards.getPower(c) <= 1 // Sacrifice weak creatures
            );
            if (!shouldSacrifice) {
              log.push('AI chooses not to sacrifice.');
              break;
            }
          }

          if (targetPlayerId === 0) {
            // Human player is the one who must sacrifice: interactive choice
            gameState.waitingForInput = {
              type: 'sacrifice',
              playerId: targetPlayerId,
              choices: sacrificeable,
              optional: effect.optional || false,
              cardUid: card._uid
            };
            log.push(`${effect.optional ? 'You may' : 'You must'} sacrifice ${effect.target === 'nonland_permanent' ? 'a nonland permanent' : 'a creature'}.`);
          } else {
            // AI player: auto-pick worst permanent
            // Prefer tokens > weak creatures > other permanents
            sacrificeable.sort((a, b) => {
              if (a._isToken !== b._isToken) return a._isToken ? -1 : 1;
              if (Cards.isCreature(a) && Cards.isCreature(b)) {
                return Cards.getPower(a) - Cards.getPower(b);
              }
              return (a.cmc || 0) - (b.cmc || 0);
            });
            const toSacrifice = sacrificeable[0];
            GameState.sacrifice(gameState, targetPlayerId, toSacrifice._uid);
            log.push(`AI sacrifices ${toSacrifice.name}.`);
          }
        }
        break;
      }

      case 'destroy': {
        // If no pre-selected target (e.g. modal spell cast without targeting), auto-pick
        let effectTargets = targets && targets.length > 0 ? targets : [];
        if (effectTargets.length === 0 && effect.target) {
          const tgt = effect.target as string;
          const allBFCards = [...gameState.players[0].zones.battlefield.cards.map(c => ({ c, pid: 0 })),
                              ...gameState.players[1].zones.battlefield.cards.map(c => ({ c, pid: 1 }))];
          let validChoices: { c: any; pid: number }[] = [];
          if (tgt === 'artifact') validChoices = allBFCards.filter(({ c }) => c.type_line?.includes('Artifact'));
          else if (tgt === 'enchantment') validChoices = allBFCards.filter(({ c }) => c.type_line?.includes('Enchantment'));
          else if (tgt === 'creature') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && Cards.isCreature(c) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'opponent_artifact_or_enchantment') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && (Cards.isArtifact(c) || Cards.isEnchantment(c)) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'opponent_artifact_or_creature') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && (Cards.isArtifact(c) || Cards.isCreature(c)) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'opponent_nonland') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && !Cards.isLand(c) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'creature_with_flying') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && Cards.hasKeyword(c, 'Flying') && Cards.canBeTargeted(c, controller));
          else if (tgt === 'noncreature_artifact') validChoices = allBFCards.filter(({ c }) => c.type_line?.includes('Artifact') && !c.type_line?.includes('Creature'));
          else if (tgt === 'creature_power4+') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && Cards.isCreature(c) && Cards.getPower(c) >= 4 && Cards.canBeTargeted(c, controller));
          else if (tgt === 'nonland_permanent') validChoices = allBFCards.filter(({ c }) => !Cards.isLand(c) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'artifact_or_land') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && (Cards.isArtifact(c) || Cards.isLand(c)) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'artifact_or_enchantment_or_flyer') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && (Cards.isArtifact(c) || Cards.isEnchantment(c) || (Cards.isCreature(c) && Cards.hasKeyword(c, 'Flying'))) && Cards.canBeTargeted(c, controller));
          else if (tgt === 'creature_blocked_or_blocked_legendary') validChoices = allBFCards.filter(({ c }) => Cards.isCreature(c) && !Cards.hasIndestructible?.(c, gameState) && (c._blockedLegendaryThisTurn || c._blockedByLegendaryThisTurn));

          if (validChoices.length === 0) {
            log.push(`No valid target to destroy.`);
            break;
          }

          // Human player: pause and let them choose
          if (gameState.players[controller].isHuman) {
            const maxDestroy = (effect as any).up_to || 1;
            gameState._pendingETBDestroy = { effect, controller, cardUid: card?._uid, maxDestroy };
            gameState.waitingForInput = {
              type: 'etb_destroy_target',
              playerId: controller,
              choices: validChoices.map(({ c, pid }) => ({ ...c, _ownerPid: pid })),
              optional: !!(effect as any).optional,
              maxDestroy,
            };
            break;
          }

          // AI: if optional and no great target, skip
          if ((effect as any).optional && validChoices.length === 0) break;
          // AI: auto-pick highest-power valid target (most threatening)
          validChoices.sort((a, b) => Cards.getPower(b.c) - Cards.getPower(a.c));
          const maxD = (effect as any).up_to || 1;
          const picks = validChoices.slice(0, maxD);
          if (picks.length) effectTargets = picks.map(p => ({ type: 'permanent', uid: p.c._uid, player: p.pid }));
        }
        if (effectTargets && effectTargets.length > 0) {
          const target = effectTargets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const permanent = bf.get(target.uid);
          if (permanent) {
            // Validate target type restriction
            const tgtType = effect.target as string;
            if (tgtType) {
              let valid = true;
              if (tgtType === 'artifact_or_enchantment' || tgtType === 'opponent_artifact_or_enchantment')
                valid = Cards.isArtifact(permanent) || Cards.isEnchantment(permanent);
              else if (tgtType === 'artifact') valid = Cards.isArtifact(permanent);
              else if (tgtType === 'enchantment') valid = Cards.isEnchantment(permanent);
              else if (tgtType === 'creature_with_flying')
                valid = Cards.isCreature(permanent) && Cards.hasKeyword(permanent, 'Flying');
              else if (tgtType === 'creature_power4+')
                valid = Cards.isCreature(permanent) && Cards.getPower(permanent) >= 4;
              else if (tgtType === 'noncreature_artifact')
                valid = Cards.isArtifact(permanent) && !Cards.isCreature(permanent);
              else if (tgtType === 'artifact_or_enchantment_or_flyer')
                valid = Cards.isArtifact(permanent) || Cards.isEnchantment(permanent) || (Cards.isCreature(permanent) && Cards.hasKeyword(permanent, 'Flying'));
              else if (tgtType === 'creature_blocked_or_blocked_legendary')
                valid = Cards.isCreature(permanent) && !!(permanent._blockedLegendaryThisTurn || permanent._blockedByLegendaryThisTurn);
              if (!valid) {
                log.push(`${permanent.name} is not a valid target for destroy (${tgtType}).`);
                break;
              }
            }
            // Check targeting
            if (!Cards.canBeTargeted(permanent, controller)) {
              log.push(`${permanent.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            // Check ward cost
            if (!_payWardCost(permanent, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) {
              if (gameState.waitingForInput?.type === 'ward_choice') {
                gameState._pendingWardDestroy = { target, controller };
                if (gameState._pendingWardChoice) gameState._pendingWardChoice.destroyMode = true;
              }
              break;
            }
            // Check indestructible
            if (Cards.hasIndestructible(permanent, gameState)) {
              log.push(`${permanent.name} is indestructible!`);
              break;
            }
            if (Cards.isCreature(permanent)) {
              const died = GameState.creatureDies(gameState, permanent, target.player);
              if (died) log.push(`${permanent.name} is destroyed.`);
            } else {
              // Non-creature permanent (enchantment, artifact, planeswalker)
              GameState.cleanupLeavingPermanent(gameState, permanent, target.player);
              bf.remove(permanent._uid);
              GameState._unregisterCardTriggers(gameState, permanent._uid);
              // Fire leaves_battlefield trigger
              const leaveLogs = GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, ownerId: target.player, card: permanent });
              log.push(...leaveLogs);
              // Return temporarily exiled cards (e.g. Stormplain Detainment)
              const returned = GameState.returnTemporaryExiles(gameState, permanent._uid);
              returned.forEach(name => log.push(`${name} retorna ao campo de batalha.`));
              // Clear legacy _exiledUntilLeaves (return handled by returnTemporaryExiles above)
              if (permanent._exiledUntilLeaves) permanent._exiledUntilLeaves = [];
              gameState.players[target.player].zones.graveyard.add(permanent);
              log.push(`${permanent.name} is destroyed.`);
              vfxPlay('destroy', permanent._uid);
            }
          }
        }
        break;
      }

      case 'destroy_all': {
        const players = effect.target === 'opponent_creatures' ? [opponent] : [0, 1];
        let totalDestroyed = 0; // Track total destroyed permanents for "X" value

        for (const pid of players) {
          const bf = gameState.players[pid].zones.battlefield;
          const toDestroy = bf.cards.filter(c => {
            if (effect.target === 'creatures' || effect.target === 'opponent_creatures') return Cards.isCreature(c);
            if (effect.target === 'creatures_and_enchantments') return Cards.isCreature(c) || (c.type_line && c.type_line.toLowerCase().includes('enchantment'));
            if (effect.target === 'nonland') return !Cards.isLand(c);
            if (effect.condition === 'nonlegendary_creature') return Cards.isCreature(c) && !Cards.isLegendary(c);
            if (effect.condition === 'power_3_or_greater') return Cards.isCreature(c) && Cards.getPower(c) >= 3;
            return false;
          });
          const dying = toDestroy.filter(c => !Cards.hasIndestructible(c, gameState));
          const surviving = toDestroy.filter(c => Cards.hasIndestructible(c, gameState));
          surviving.forEach(c => log.push(`${c.name} is indestructible!`));
          dying.forEach(c => {
            if (Cards.isCreature(c)) {
              GameState.creatureDies(gameState, c, pid);
            } else {
              // Non-creature permanent (enchantment, artifact)
              bf.remove(c._uid);
              GameState._unregisterCardTriggers(gameState, c._uid);
              const leaveLogs = GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: c._uid, ownerId: pid, card: c });
              log.push(...leaveLogs);
              const returned = GameState.returnTemporaryExiles(gameState, c._uid);
              returned.forEach(name => log.push(`${name} retorna ao campo de batalha.`));
              if (!c._isToken) {
                gameState.players[pid].zones.graveyard.add(c);
              }
            }
            log.push(`${c.name} is destroyed.`);
            totalDestroyed++;
          });
        }

        // Store total destroyed count for next effect with amount: "X" or count: "last_destroy_all_count"
        gameState._currentXValue = totalDestroyed;
        gameState._lastDestroyAllCount = totalDestroyed;
        break;
      }

      case 'exile': {
        if (effect.target === 'opponent_hand_nonland') {
          // Exile a nonland card from opponent's hand (e.g., Severance Priest)
          const opponentId = controller === 0 ? 1 : 0;
          const hand = gameState.players[opponentId].zones.hand;
          const nonlandCards = hand.getAll().filter(c => !Cards.isLand(c));

          if (nonlandCards.length === 0) {
            log.push('Opponent has no nonland cards in hand.');
            break;
          }

          if (gameState.players[controller].isHuman) {
            // Human player: show hand and let them choose which card to exile
            gameState._pendingHandExile = {
              controllerId: controller,
              targetPlayerId: opponentId,
              cardToExile: card, // The card doing the exiling (for storing exiled card)
              cards: nonlandCards,
              selected: null,
            };
            gameState.waitingForInput = { type: 'opponent_hand_exile', playerId: controller };
            log.push(`Choose a nonland card from opponent's hand to exile.`);
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          } else {
            // AI player: pick best card to exile
            nonlandCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const exiledCard = nonlandCards[0];
            hand.remove(exiledCard._uid);
            gameState.players[opponentId].zones.exile.add(exiledCard);

            // Store exiled card on the source card for LtB trigger
            if (!card._exiledByPriest) card._exiledByPriest = [];
            card._exiledByPriest.push({ card: exiledCard, cmc: exiledCard.cmc || 0 });
            // Visual: show exiled card underneath the priest
            if (!card._exiledCards) card._exiledCards = [];
            card._exiledCards.push(exiledCard);
            log.push(`${exiledCard.name} is exiled from opponent's hand.`);
          }
        } else if (effect.target === 'nonland_from_hand') {
          // Special case: exile from your own hand (Aggressive Negotiations)
          const targetPlayerId = controller; // FIX: exile from controller's hand, not opponent's
          const hand = gameState.players[targetPlayerId].zones.hand;
          const nonlandCards = hand.getAll().filter(c => !Cards.isLand(c));

          if (nonlandCards.length === 0) {
            log.push('No nonland cards in your hand to exile.');
            // Continue to next effect - spell still resolves partially
            break;
          }

          if (nonlandCards.length === 1 || !gameState.players[controller].isHuman) {
            // Only one card or AI: auto-pick
            const cardToExile = nonlandCards.length === 1
              ? nonlandCards[0]
              : GameAI._pickBestCardToExileFromHand(gameState, controller, nonlandCards);

            if (cardToExile) {
              hand.remove(cardToExile._uid);
              gameState.players[targetPlayerId].zones.exile.add(cardToExile);
              log.push(`${cardToExile.name} is exiled from your hand.`);
            } else {
              log.push('Error: no valid card found to exile.');
            }
          } else {
            // Human with multiple options: need choice overlay
            GameState._setupHandExileChoice(gameState, controller, targetPlayerId, nonlandCards, () => {
              StackEngine._processNextEffect(gameState);
            });
            return; // Wait for choice
          }
        } else if (targets && targets.length > 0) {
          const target = targets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const permanent = bf.get(target.uid);
          if (permanent) {
            if (!Cards.canBeTargeted(permanent, controller)) {
              log.push(`${permanent.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            // Check ward cost
            if (!_payWardCost(permanent, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) {
              if (gameState.waitingForInput?.type === 'ward_choice') {
                gameState._pendingWardExile = { target, controller };
                if (gameState._pendingWardChoice) gameState._pendingWardChoice.exileMode = true;
              }
              break;
            }
            // Exile bypasses indestructible
            vfxPlay('exile', permanent._uid);
            bf.remove(permanent._uid);
            GameState._unregisterCardTriggers(gameState, permanent._uid);
            // Fire leaves_battlefield for creatures
            if (Cards.isCreature(permanent)) {
              GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, card: permanent, ownerId: target.player });
            }
            gameState.players[target.player].zones.exile.add(permanent);

            // Store exiled creature reference if until_leaves or until_source_leaves is set
            // (until_leaves: for token creation like Mardu Siegebreaker)
            // (until_source_leaves: for returning creature when source leaves like Stormplain Detainment)
            if (effect.until_leaves || effect.until_source_leaves) {
              if (!card._exiledUntilLeaves) card._exiledUntilLeaves = [];
              permanent._owner = target.player; // Store original owner for later return
              card._exiledUntilLeaves.push(permanent);
              // Track on source for UI display (exiled card shown under enchantment)
              if (!card._exiledCards) card._exiledCards = [];
              card._exiledCards.push({ name: permanent.name, image_uris: permanent.image_uris, image_small: permanent.image_small, image_normal: permanent.image_normal, _uid: permanent._uid });
              // Track in _temporaryExiles for returnTemporaryExiles
              if (!gameState._temporaryExiles) gameState._temporaryExiles = {};
              gameState._temporaryExiles[permanent._uid] = { exilerUid: card._uid, originalOwner: target.player, originalZone: 'battlefield' };
            }

            // Flicker: return immediately to battlefield (e.g. Slip On the Ring)
            if (effect.return_immediately) {
              gameState.players[target.player].zones.exile.remove(permanent._uid);
              const refreshed = Cards.prepareForBattlefield(permanent);
              refreshed._ownerId = target.player;
              gameState.players[target.player].zones.battlefield.add(refreshed);
              GameState.fireTrigger(gameState, 'enters_battlefield', { cardUid: refreshed._uid, ownerId: target.player, card: refreshed });
              GameState._registerCardTriggers(gameState, refreshed, target.player);
              log.push(`${permanent.name} é exilado e retorna ao campo de batalha.`);
            } else {
              log.push(`${permanent.name} is exiled.`);
            }
          }
        } else if (effect.target && effect.target !== 'all') {
          // ETB exile with no pre-selected target — auto-target AI, pause for human
          const opponentId = controller === 0 ? 1 : 0;
          const isOwnTarget = effect.target?.startsWith('own_');
          const targetPid = isOwnTarget ? controller : opponentId;
          const bf = gameState.players[targetPid].zones.battlefield;

          let filterFn = (c: any) => !Cards.isLand(c);
          if (effect.target === 'opponent_artifact_or_creature') {
            filterFn = (c: any) => Cards.isCreature(c) || (c.type_line || '').toLowerCase().includes('artifact');
          } else if (effect.target === 'opponent_nonland') {
            filterFn = (c: any) => !Cards.isLand(c);
          } else if (effect.target === 'own_creature') {
            filterFn = (c: any) => Cards.isCreature(c) && (!effect.other || c._uid !== card?._uid);
          } else if (effect.target === 'creature_mv3_or_less_unless_teamwork') {
            const noTeamwork = !gameState._teamworkPaidThisCast;
            filterFn = (c: any) => Cards.isCreature(c) && (noTeamwork ? (c.cmc || 0) <= 3 : true);
          }

          const candidates = bf.cards
            .filter(filterFn)
            .filter((c: any) => Cards.canBeTargeted(c, controller));

          if (candidates.length === 0) break;

          const maxExile = effect.up_to || 1;
          if (gameState.players[controller].isHuman) {
            gameState._pendingETBExile = { effect, controller, cardUid: card?._uid, targetPid, maxExile };
            gameState.waitingForInput = {
              type: 'etb_exile_target',
              playerId: controller,
              choices: candidates,
              maxExile,
              optional: !!effect.up_to,
            };
            break;
          }

          // AI: pick highest-threat target(s)
          candidates.sort((a: any, b: any) =>
            (Cards.getPower(b) + Cards.getToughness(b)) - (Cards.getPower(a) + Cards.getToughness(a))
          );
          for (const perm of candidates.slice(0, maxExile)) {
            vfxPlay('exile', perm._uid);
            bf.remove(perm._uid);
            GameState._unregisterCardTriggers(gameState, perm._uid);
            if (Cards.isCreature(perm)) {
              GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: perm._uid, card: perm, ownerId: targetPid });
            }
            gameState.players[targetPid].zones.exile.add(perm);
            if (effect.until_leaves || effect.until_source_leaves) {
              if (!card._exiledUntilLeaves) card._exiledUntilLeaves = [];
              perm._owner = targetPid;
              perm._exiledByUid = card._uid; // tag for reliable lookup
              card._exiledUntilLeaves.push(perm);
              // Track on source for UI display
              if (!card._exiledCards) card._exiledCards = [];
              card._exiledCards.push({ name: perm.name, image_uris: perm.image_uris, image_small: perm.image_small, image_normal: perm.image_normal, _uid: perm._uid });
              // Track in _temporaryExiles for returnTemporaryExiles
              if (!gameState._temporaryExiles) gameState._temporaryExiles = {};
              gameState._temporaryExiles[perm._uid] = { exilerUid: card._uid, originalOwner: targetPid, originalZone: 'battlefield' };
            }
            // Flicker: return immediately (e.g. Slip On the Ring, AI path)
            if (effect.return_immediately) {
              gameState.players[targetPid].zones.exile.remove(perm._uid);
              const refreshed = Cards.prepareForBattlefield(perm);
              refreshed._ownerId = targetPid;
              gameState.players[targetPid].zones.battlefield.add(refreshed);
              GameState.fireTrigger(gameState, 'enters_battlefield', { cardUid: refreshed._uid, ownerId: targetPid, card: refreshed });
              GameState._registerCardTriggers(gameState, refreshed, targetPid);
              log.push(`${perm.name} é exilado e retorna ao campo de batalha.`);
            } else {
              log.push(`${perm.name} is exiled.`);
            }
          }
        }
        break;
      }

      case 'exile_all': {
        for (const pid of [0, 1]) {
          const bf = gameState.players[pid].zones.battlefield;
          const exile = gameState.players[pid].zones.exile;
          const toExile = bf.cards.filter(c => Cards.isCreature(c));
          for (const c of toExile) {
            GameState.cleanupLeavingPermanent(gameState, c, pid);
            bf.remove(c._uid);
            GameState._unregisterCardTriggers(gameState, c._uid);
            exile.add(c);
            log.push(`${c.name} is exiled.`);
          }
        }
        break;
      }

      case 'bounce': {
        // Auto-target when no explicit targets provided (e.g., ETB bounce effects)
        let resolvedBounceTargets = targets;
        if ((!resolvedBounceTargets || resolvedBounceTargets.length === 0) && effect.target) {
          const opponentId = controller === 0 ? 1 : 0;
          let autoTargetPlayer: number;
          let filterFn: (c: any) => boolean;
          if (effect.target === 'opponent_creature' || effect.target === 'creature') {
            autoTargetPlayer = opponentId;
            filterFn = (c: any) => Cards.isCreature(c);
          } else if (effect.target === 'nonland_permanent' || effect.target === 'spell_or_permanent') {
            // nonland_permanent: can target ANY player's nonland permanents
            autoTargetPlayer = -1; // special: both players
            filterFn = (c: any) => !Cards.isLand(c);
          } else if (effect.target === 'own_nonland') {
            // Sunpearl Kirin: bounce own non-land (optional, not source card itself)
            autoTargetPlayer = controller;
            filterFn = (c: any) => !Cards.isLand(c) && c._uid !== card._uid;
          } else if (effect.target === 'any_creature' || effect.target === 'nontoken_creature' || effect.target === 'any_nontoken_creature') {
            // Soothing of Sméagol: "target nontoken creature" = any player's creature
            autoTargetPlayer = -1; // both players
            if (effect.target === 'nontoken_creature' || effect.target === 'any_nontoken_creature') {
              filterFn = (c: any) => Cards.isCreature(c) && !c._isToken && !c._token;
            } else {
              filterFn = (c: any) => Cards.isCreature(c);
            }
          } else {
            autoTargetPlayer = opponentId;
            filterFn = (c: any) => !Cards.isLand(c);
          }
          // Collect candidates from target player(s)
          let candidates: any[];
          if (autoTargetPlayer === -1) {
            // Both players' permanents (nonland_permanent)
            candidates = [
              ...gameState.players[0].zones.battlefield.cards.filter(filterFn)
                .filter((c: any) => Cards.canBeTargeted(c, controller) && c._uid !== card._uid)
                .map((c: any) => ({ ...c, _ownerPid: 0 })),
              ...gameState.players[1].zones.battlefield.cards.filter(filterFn)
                .filter((c: any) => Cards.canBeTargeted(c, controller))
                .map((c: any) => ({ ...c, _ownerPid: 1 })),
            ];
          } else {
            candidates = gameState.players[autoTargetPlayer].zones.battlefield.cards
              .filter(filterFn)
              .filter((c: any) => Cards.canBeTargeted(c, controller))
              .map((c: any) => ({ ...c, _ownerPid: autoTargetPlayer }));
          }

          if (candidates.length === 0) break; // nothing to bounce

          // Human player with no pre-selected target: pause and let them choose
          if (gameState.players[controller].isHuman && effect.up_to !== 0) {
            const maxBounce = effect.up_to || 1;
            gameState._pendingETBBounce = {
              effect, controller, cardUid: card?._uid,
              autoTargetPlayer, filterFn: null, maxBounce,
              // Store valid targets by uid so resolve can find them
              validUids: candidates.map((c: any) => c._uid),
            };
            gameState.waitingForInput = {
              type: 'etb_bounce_target',
              playerId: controller,
              choices: candidates,
              maxBounce,
            };
            break; // Resume via resolveETBBounceTarget
          }

          candidates.sort((a: any, b: any) =>
            (Cards.getPower(b) + Cards.getToughness(b)) - (Cards.getPower(a) + Cards.getToughness(a))
          );
          // Respect up_to: N for multi-bounce effects (e.g. Marang River Regent ETB up_to: 2)
          const maxBounce = effect.up_to || 1;
          resolvedBounceTargets = candidates.slice(0, maxBounce).map((c: any) =>
            ({ type: 'creature', uid: c._uid, player: c._ownerPid ?? autoTargetPlayer })
          );
        }
        // Process all bounce targets (handles up_to: N)
        const bouncedUids = new Set<string>();
        for (const target of (resolvedBounceTargets || [])) {
          if (bouncedUids.has(target.uid)) continue; // skip duplicates
          const bf = gameState.players[target.player].zones.battlefield;
          const permanent = bf.get(target.uid);
          if (permanent) {
            if (!Cards.canBeTargeted(permanent, controller)) {
              log.push(`${permanent.name} can't be targeted (hexproof/shroud).`);
              continue;
            }
            vfxPlay('bounce', permanent._uid);
            bouncedUids.add(permanent._uid);

            // Clean up aura/equipment effects before removing
            GameState.cleanupLeavingPermanent(gameState, permanent, target.player);

            bf.remove(permanent._uid);
            GameState._unregisterCardTriggers(gameState, permanent._uid);
            // Fire leaves_battlefield for creatures
            if (Cards.isCreature(permanent)) {
              GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, card: permanent, ownerId: target.player });
            }
            // Tokens disappear, non-tokens return to hand
            if (permanent._isToken) {
              log.push(`${permanent.name} token vanishes.`);
              // Conditional draw if bounced token (Sunpearl Kirin)
              if (effect.draw_if_token) {
                const drawn = gameState.players[controller].zones.library.drawFromTop();
                if (drawn) {
                  gameState.players[controller].zones.hand.add(drawn);
                  log.push(`Drew a card (bounced token).`);
                }
              }
            } else {
              gameState.players[target.player].zones.hand.add(permanent);
              // Track MV for free_cast effects (Press the Enemy)
              gameState._lastBouncedMV = permanent.cmc || 0;
              log.push(`${permanent.name} returns to hand.`);
            }
          }
        }
        break;
      }

      case 'bounce_to_library': {
        // Riverwalk Technique: "The owner of target nonland permanent puts it on their choice of the top or bottom of their library"
        if (targets && targets.length > 0) {
          const target = targets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const permanent = bf.get(target.uid);
          if (permanent) {
            if (!Cards.canBeTargeted(permanent, controller)) {
              log.push(`${permanent.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            vfxPlay('bounce', permanent._uid);

            // Clean up aura/equipment effects before removing
            GameState.cleanupLeavingPermanent(gameState, permanent, target.player);
            // Remove from battlefield
            bf.remove(permanent._uid);
            GameState._unregisterCardTriggers(gameState, permanent._uid);
            if (Cards.isCreature(permanent)) {
              GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, card: permanent, ownerId: target.player });
            }

            // Owner chooses top or bottom
            const position = effect.position || 'top'; // default to top
            if (permanent._isToken) {
              log.push(`${permanent.name} token vanishes.`);
            } else if (gameState.players[target.player].isHuman && effect.position === 'top_or_bottom') {
              // Owner is human and gets to choose top or bottom
              gameState._pendingBounceToLibrary = {
                card: permanent,
                ownerId: target.player,
              };
              gameState.waitingForInput = { type: 'bounce_to_library_choice', playerId: target.player };
            } else {
              // AI always chooses bottom (to avoid redrawing it immediately)
              gameState.players[target.player].zones.library.addToBottom(permanent);
              log.push(`${permanent.name} is put on the bottom of library.`);
            }
          }
        }
        break;
      }

      case 'damage_each_opponent': {
        // Cori Mountain Stalwart, Devoted Duelist: "deals 2 damage to each opponent"
        const dmgAmt = resolveAmount(effect.amount);
        const opponents = gameState.players.map((_, i) => i).filter(i => i !== controller);
        for (const oppId of opponents) {
          gameState.players[oppId].life -= dmgAmt;
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[oppId] = (gameState._damageDealtThisTurn[oppId] || 0) + dmgAmt;
          vfxPlay('playerDamage', 'p' + oppId);
        }
        log.push(`${dmgAmt} damage to each opponent.`);
        // Lifelink check (if source creature has lifelink)
        if (card && Cards.isCreature(card) && Cards.hasLifelink(card)) {
          const totalDamage = dmgAmt * opponents.length;
          gameState.players[controller].life += totalDamage;
          log.push(`Lifelink: +${totalDamage} life.`);
          vfxPlay('heal', 'p' + controller);
        }
        break;
      }

      case 'optional_discard_draw': {
        // Rescue Leopard: "you may discard a card. If you do, draw a card"
        // For AI: auto-discard worst card if hand size > 4
        // For Human: show UI to choose
        if (gameState.players[controller].isHuman && controller === 0) {
          // Human player - reuse optional_discard_choice overlay
          gameState._pendingOptionalDiscard = {
            controller: controller,
            amount: 1,
            drawOnDiscard: true
          };
          gameState.waitingForInput = { type: 'optional_discard_choice', playerId: controller };
          log.push(`${card.name}: You may discard a card to draw.`);
        } else {
          // AI player - auto-decide
          const hand = gameState.players[controller].zones.hand.getAll();
          if (hand.length > 4) {
            // Discard worst card (highest CMC land or lowest value spell)
            const lands = hand.filter(c => Cards.isLand(c));
            const spells = hand.filter(c => !Cards.isLand(c));
            let worstCard = null;
            if (lands.length > 3) {
              worstCard = lands.sort((a, b) => (b.cmc || 0) - (a.cmc || 0))[0];
            } else if (spells.length > 0) {
              worstCard = spells.sort((a, b) => (a.cmc || 0) - (b.cmc || 0))[0];
            }
            if (worstCard) {
              gameState.players[controller].zones.hand.remove(worstCard._uid);
              gameState.players[controller].zones.graveyard.add(worstCard);
              log.push(`AI discards ${worstCard.name}.`);
              // Draw card
              const drawn = gameState.players[controller].zones.library.drawFromTop();
              if (drawn) {
                gameState.players[controller].zones.hand.add(drawn);
                log.push(`AI draws 1 card.`);
              }
            }
          } else {
            log.push(`AI chooses not to discard.`);
          }
        }
        break;
      }

      case 'draw': {
        const drawAmt = resolveAmount(effect.amount);
        for (let i = 0; i < drawAmt; i++) {
          const drawn = gameState.players[controller].zones.library.drawFromTop();
          if (drawn) {
            gameState.players[controller].zones.hand.add(drawn);
            if (gameState.players[controller].isHuman) {
              log.push(`You draw ${drawn.name}.`);
            } else {
              log.push(`Opponent draws a card.`);
            }
          }
        }
        // Track cards drawn for Prince Imrahil, Gwaihir, etc.
        if (!gameState._cardsDrawnThisTurn) gameState._cardsDrawnThisTurn = {};
        const prevSpellDraw = gameState._cardsDrawnThisTurn[controller] || 0;
        gameState._cardsDrawnThisTurn[controller] = prevSpellDraw + drawAmt;
        // Fire second_draw when crossing 2-draw threshold
        if (prevSpellDraw < 2 && prevSpellDraw + drawAmt >= 2) {
          log.push(...GameState.fireTrigger(gameState, 'second_draw', { playerId: controller }));
        }
        // Watcher in the Water: fire draw_on_opponent_turn for each card drawn
        for (let di = 0; di < drawAmt; di++) {
          log.push(...GameState.fireTrigger(gameState, 'draw_on_opponent_turn', { playerId: controller }));
        }
        break;
      }

      case 'gain_life': // alias legacy
      case 'gainLife': {
        const gainAmt = resolveAmount(effect.amount);
        gameState.players[controller].life += gainAmt;
        log.push(`+${gainAmt} life. (Life: ${gameState.players[controller].life})`);
        vfxPlay('heal', 'p' + controller);
        // Fire gain_life triggers
        const gainLogs = GameState.fireTrigger(gameState, 'gain_life', { playerId: controller });
        log.push(...gainLogs);
        break;
      }

      case 'lose_life': // alias legacy
      case 'loseLife': {
        // Determine target: opponent, self, or controller of a previously targeted creature
        let loseLifeTarget = controller; // default: self-harm
        if (effect.target === 'opponent' || effect.target === 'each_opponent') {
          loseLifeTarget = opponent;
        } else if (effect.target === 'target_controller' && targets && targets.length > 0) {
          // Apply life loss to the controller of the targeted creature (e.g. Bitter Downfall)
          loseLifeTarget = targets[0].player ?? opponent;
        }
        const loseAmt = resolveAmount(effect.amount);
        gameState.players[loseLifeTarget].life -= loseAmt;
        log.push(`${loseLifeTarget === controller ? 'You lose' : 'Opponent loses'} ${loseAmt} life. (Life: ${gameState.players[loseLifeTarget].life})`);
        break;
      }

      case 'opponent_loses_half_life': {
        // Betor, Kin to All: "each opponent loses half their life, rounded up"
        const opponents = gameState.players.map((_, i) => i).filter(i => i !== controller);
        for (const oppId of opponents) {
          const currentLife = gameState.players[oppId].life;
          const halfLife = Math.ceil(currentLife / 2); // Rounded up
          gameState.players[oppId].life -= halfLife;
          log.push(`Opponent loses half their life (${halfLife}). (Life: ${gameState.players[oppId].life})`);
          vfxPlay('playerDamage', 'p' + oppId);
        }
        GameState._checkWinner(gameState);
        break;
      }

      case 'buff':
      case 'multi_buff_up_to': {
        // Buffs from non-permanent spells are temporary (until end of turn)
        // Also treat as temp if effect explicitly has duration: "end_of_turn" (e.g. Reigning Victor ETB)
        const isTemp = !Cards.isPermanent(card) || effect.duration === 'end_of_turn';
        // Resolve dynamic power/toughness (e.g. "creature_count", "double")
        let buffPow = effect.power;
        let buffTou = effect.toughness;
        if (typeof buffPow === 'string') {
          if (buffPow === 'double') {
            // Double power of target - resolved per-creature below
            buffPow = 'double';
          } else {
            // Use resolveAmount for dynamic values like "creature_count"
            buffPow = resolveAmount(buffPow);
          }
        }
        if (typeof buffTou === 'string') {
          if (buffTou === 'double') buffTou = 'double';
          else {
            // Use resolveAmount for dynamic values like "creature_count"
            buffTou = resolveAmount(buffTou);
          }
        }
        const applyBuff = (creature) => {
          const p = buffPow === 'double' ? Cards.getPower(creature) : (buffPow || 0);
          const t = buffTou === 'double' ? Cards.getToughness(creature) : (buffTou || 0);
          creature._powerMod += p;
          creature._toughnessMod += t;
          if (isTemp) {
            creature._tempPowerMod = (creature._tempPowerMod || 0) + p;
            creature._tempToughnessMod = (creature._tempToughnessMod || 0) + t;
          }
          return { p, t };
        };
        // Self-buff (Eastfarthing Farmer, etc.): apply directly to the source card
        if (effect.target === 'self') {
          const selfCard = gameState.players[controller].zones.battlefield.get(card?._uid);
          if (selfCard) {
            const r = applyBuff(selfCard);
            log.push(`${selfCard.name} gets ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t}${isTemp ? ' until end of turn' : ''}.`);
          }
        } else if (effect.target === 'all_own_creatures') {
          let bp = 0, bt = 0;
          gameState.players[controller].zones.battlefield.cards.forEach(c => {
            if (Cards.isCreature(c)) {
              const r = applyBuff(c);
              bp = r.p; bt = r.t;
            }
          });
          log.push(`All creatures get ${bp >= 0 ? '+' : ''}${bp}/${bt >= 0 ? '+' : ''}${bt}.`);
        } else if (effect.type === 'multi_buff_up_to') {
          // Rally the Monastery: buff up to N creatures
          const maxTargets = effect.max_targets || 1;
          const myBf = gameState.players[controller].zones.battlefield;
          const candidates = myBf.cards.filter((c: any) => Cards.isCreature(c));
          if (candidates.length > 0 && gameState.players[controller].isHuman) {
            // Human: show multi-select overlay
            gameState._pendingMultiBuffChoice = {
              playerId: controller,
              effect: effect,
              candidates: candidates.map((c: any) => c._uid),
              selected: [],
              maxTargets: maxTargets,
              sourceUid: card?._uid
            };
            gameState.waitingForInput = { type: 'multi_buff_choice', playerId: controller };
            log.push(`Choose up to ${maxTargets} creature(s) to get +${effect.power || 0}/+${effect.toughness || 0}.`);
          } else if (candidates.length > 0) {
            // AI: pick best creatures
            candidates.sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a));
            const chosen = candidates.slice(0, Math.min(maxTargets, candidates.length));
            for (const creature of chosen) {
              const r = applyBuff(creature);
              log.push(`${creature.name} gets ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t}.`);
            }
          }
        } else if (effect.target === 'other_own_creature') {
          // Buff another own creature (exclude source card itself, e.g. Riling Dawnbreaker)
          const bf2 = gameState.players[controller].zones.battlefield;
          const best = bf2.cards.filter((c: any) =>
            Cards.isCreature(c) && Cards.canBeTargeted(c, controller) && c._uid !== card._uid
          ).sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a))[0];
          if (best) {
            const r = applyBuff(best);
            log.push(`${best.name} gets ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t} until end of turn.`);
          }
        } else if (targets && targets.length > 0 || (!targets?.length && (effect.target === 'creature' || effect.target === 'own_creature' || effect.target === 'opponent_creature'))) {
          // Auto-pick target if no pre-selected target (e.g. modal spell)
          let buffTarget = targets?.[0];
          // If effect expects own_creature but user selected an opponent creature (e.g. Dragonclaw Strike),
          // or expects opponent_creature but user selected own creature, auto-pick from correct side
          if (buffTarget && effect.target === 'own_creature' && buffTarget.player !== controller) {
            buffTarget = null; // force auto-pick from own side
          }
          if (buffTarget && effect.target === 'opponent_creature' && buffTarget.player === controller) {
            buffTarget = null; // force auto-pick from opponent side
          }
          // Try to pick an own creature that matches fight target if available (multi-target coordination)
          if (!buffTarget) {
            const targetPid = effect.target === 'opponent_creature' ? opponent : controller;
            const bf2 = gameState.players[targetPid].zones.battlefield;
            // For own_creature buff: prefer the own creature that is also a fight candidate
            const ownFightTarget = targets?.find((t: any) => t.player === controller);
            if (ownFightTarget && effect.target === 'own_creature') {
              const candidate = bf2.get(ownFightTarget.uid);
              if (candidate && Cards.isCreature(candidate)) {
                buffTarget = ownFightTarget;
              }
            }
            if (!buffTarget) {
              const allCandidates = bf2.cards.filter((c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller))
                .sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a));
              // Human interactive: show overlay if >1 candidate and effect targets own/opponent creature
              if (allCandidates.length > 1 && controller === 0 && gameState.players[0]?.isHuman &&
                  (effect.target === 'own_creature' || effect.target === 'opponent_creature' || effect.target === 'creature')) {
                const rp = resolveAmount(effect.power);
                const rt = resolveAmount(effect.toughness);
                gameState._pendingBuffChoice = {
                  playerId: controller,
                  effect,
                  resolvedPower: rp,
                  resolvedToughness: rt,
                  candidates: allCandidates.map((c: any) => c._uid),
                  sourceUid: card?._uid,
                  targetPlayerId: targetPid
                };
                gameState.waitingForInput = { type: 'buff_choice', playerId: controller };
                log.push(`Choose a creature to get +${rp}/+${rt}.`);
                if (ei < effects.length - 1) {
                  gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
                }
                return log;
              }
              // AI or single creature: auto-pick
              const nonSelf = allCandidates.filter((c: any) => c._uid !== card?._uid);
              const best = (nonSelf.length > 0 ? nonSelf : allCandidates)[0];
              if (best) buffTarget = { type: 'creature', uid: best._uid, player: targetPid };
            }
          }
          const target = buffTarget;
          const bf = target ? gameState.players[target.player].zones.battlefield : null;
          const creature = bf?.get(target?.uid);
          if (creature) {
            if (!Cards.canBeTargeted(creature, controller)) {
              log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            const r = applyBuff(creature);
            log.push(`${creature.name} gets ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t}.`);
            // Apply keywords from buff effect (e.g. Alesha's Legacy grants deathtouch+indestructible)
            if (effect.keywords && effect.keywords.length > 0) {
              if (!creature.keywords) creature.keywords = [];
              effect.keywords.forEach(kw => {
                const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
                if (!creature.keywords.includes(kwCap)) creature.keywords.push(kwCap);
                if (!creature._tempKeywords) creature._tempKeywords = [];
                creature._tempKeywords.push(kwCap);
              });
              log.push(`${creature.name} gains ${effect.keywords.join(', ')} until end of turn.`);
            }
            // Conditional haste for Orcs or Goblins (Rush the Room)
            if (effect.haste_if_orc) {
              const tl = (creature.type_line || '').toLowerCase();
              if (tl.includes('orc') || tl.includes('goblin')) {
                if (!creature.keywords) creature.keywords = [];
                if (!creature._tempKeywords) creature._tempKeywords = [];
                if (!creature.keywords.includes('Haste')) creature.keywords.push('Haste');
                creature._tempKeywords.push('Haste');
                log.push(`${creature.name} gains Haste until end of turn (Orc/Goblin).`);
              }
            }
            if (Cards.getToughness(creature) <= 0) {
              GameState.creatureDies(gameState, creature, target.player);
              log.push(`${creature.name} dies.`);
            }
          }
        }
        break;
      }

      case 'scry': {
        const lib = gameState.players[controller].zones.library;
        const top = [];
        for (let i = 0; i < effect.amount && lib.count() > 0; i++) {
          top.push(lib.drawFromTop());
        }
        if (top.length === 0) break;

        vfxPlay('spellCast');

        if (gameState.players[controller].isHuman) {
          gameState._pendingScry = {
            type: 'scry',
            cards: top,
            playerId: controller,
            choices: top.map(() => 'top')
          };
          gameState.waitingForInput = { type: 'scry', playerId: controller };
          log.push(`Scry ${effect.amount} - choose which to keep on top.`);
        } else {
          const keep = [];
          const bottom = [];
          for (const c of top) {
            const bf = gameState.players[controller].zones.battlefield;
            const landCount = bf.cards.filter(x => Cards.isLand(x)).length;
            if (Cards.isLand(c) && landCount < 4) {
              keep.push(c);
            } else if (Cards.isLand(c) && landCount >= 5) {
              bottom.push(c);
            } else if (Cards.isCreature(c) || c.cmc <= landCount + 1) {
              keep.push(c);
            } else {
              bottom.push(c);
            }
          }
          for (const c of keep.reverse()) lib.addToTop(c);
          for (const c of bottom) lib.addToBottom(c);
          log.push(`Opponent scries ${effect.amount}.`);
        }
        break;
      }

      case 'surveil': {
        const lib = gameState.players[controller].zones.library;
        const top = [];
        for (let i = 0; i < effect.amount && lib.count() > 0; i++) {
          top.push(lib.drawFromTop());
        }
        if (top.length === 0) break;

        vfxPlay('spellCast');

        if (gameState.players[controller].isHuman) {
          gameState._pendingScry = {
            type: 'surveil',
            cards: top,
            playerId: controller,
            choices: top.map(() => 'top')
          };
          gameState.waitingForInput = { type: 'surveil', playerId: controller };
          log.push(`Surveil ${effect.amount} - choose which to put in the graveyard.`);
        } else {
          const gy = gameState.players[controller].zones.graveyard;
          const keep = [];
          const toGY = [];

          for (const c of top) {
            const bf = gameState.players[controller].zones.battlefield;
            const landCount = bf.cards.filter(x => Cards.isLand(x)).length;
            if (Cards.isLand(c) && landCount >= 5) {
              toGY.push(c);
            } else if (c.cmc > landCount + 2) {
              toGY.push(c);
            } else {
              keep.push(c);
            }
          }

          for (const c of keep.reverse()) lib.addToTop(c);
          for (const c of toGY) gy.add(c);
          log.push(`Opponent surveils ${effect.amount}.`);
        }
        break;
      }

      case 'mill': {
        const millAmt = resolveAmount(effect.amount);
        // Optional mill: ask human, AI skips if library is small
        if (effect.optional) {
          if (gameState.players[controller].isHuman && controller === 0) {
            gameState._pendingOptionalMill = {
              amount: millAmt,
              target: effect.target || 'self',
              controller,
              card,
              remainingEffects: effects.slice(ei + 1),
              targets
            };
            gameState.waitingForInput = { type: 'optional_mill', playerId: controller };
            log.push(`You may mill ${millAmt} cards.`);
            return log;
          } else {
            // AI: mill if library has enough cards and graveyard synergy is useful
            const aiLib = gameState.players[controller].zones.library;
            if (aiLib.count() <= millAmt + 5) {
              log.push('AI chooses not to mill.');
              break;
            }
            // Otherwise fall through to mill normally
          }
        }
        let targetPlayer;
        if (effect.target === 'any_player') {
          if (gameState.players[controller].isHuman) {
            // Human: show choice overlay
            gameState._pendingPlayerChoice = {
              effectType: 'mill',
              amount: millAmt,
              controller,
              card: card,
              remainingEffects: effects.slice(ei + 1),
              targets: targets
            };
            gameState.waitingForInput = { type: 'player_choice', playerId: controller };
            log.push(`Choose who to mill (${millAmt} cards).`);
            return log;
          } else {
            // AI: mill opponent by default
            targetPlayer = opponent;
          }
        } else {
          targetPlayer = effect.target === 'opponent' ? opponent : controller;
        }
        const lib = gameState.players[targetPlayer].zones.library;
        const gy = gameState.players[targetPlayer].zones.graveyard;
        const milled = [];
        for (let i = 0; i < millAmt && lib.count() > 0; i++) {
          const c = lib.drawFromTop();
          gy.add(c);
          milled.push(c.name);
        }
        if (milled.length > 0) {
          const who = targetPlayer === 0 ? 'You' : 'Opponent';
          log.push(`${who} mill${targetPlayer === 0 ? '' : 's'} ${milled.length} card(s): ${milled.slice(0, 3).join(', ')}${milled.length > 3 ? '...' : ''}`);
          vfxPlay('mill', 'p' + targetPlayer);
        }
        break;
      }

      case 'mill_land_choice': {
        // Mill land choice: put a land from recently milled cards into hand, or +1/+1 counter
        const gy = gameState.players[controller].zones.graveyard;
        const recentMilled = gy.getAll().slice(-3); // Last 3 cards added (from mill)
        const milledLands = recentMilled.filter(c => Cards.isLand(c));

        if (milledLands.length === 0) {
          // No lands milled, auto-counter
          const targetCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (targetCard) {
            if (!targetCard._counters) targetCard._counters = { '+1/+1': 0, '-1/-1': 0 };
            targetCard._counters['+1/+1']++;
            log.push(`${targetCard.name} gets +1/+1 (no land milled).`);
          }
        } else if (gameState.players[controller].isHuman) {
          // Human: choice between land to hand or +1/+1 counter
          gameState._pendingMillLandChoice = {
            cardUid: card._uid,
            milledLands: milledLands,
            milledAll: recentMilled,
            controller: controller
          };
          gameState.waitingForInput = { type: 'mill_land_choice', playerId: controller };
          log.push(`Choose: put a land into hand or +1/+1 counter.`);
          return log;
        } else {
          // AI: always take land if available
          const landToTake = milledLands[0];
          gy.remove(landToTake._uid);
          gameState.players[controller].zones.hand.add(landToTake);
          log.push(`${landToTake.name} returns to hand.`);
        }
        break;
      }

      case 'ramp': {
        const lib = gameState.players[controller].zones.library;
        const bf = gameState.players[controller].zones.battlefield;
        // Compute dynamic amount (The Ring Goes South: X = number of legendary creatures you control)
        let rampDynAmount = (effect as any).amount;
        if (rampDynAmount === 'legendary_count') {
          rampDynAmount = bf.cards.filter((c: any) =>
            Cards.isCreature(c) && (c.type_line || '').toLowerCase().includes('legendary')
          ).length;
          if (rampDynAmount === 0) { log.push('No legendary creatures — Ring Goes South has no effect.'); break; }
          (effect as any).amount = rampDynAmount;
        }
        const isBasicOnly = effect.landType === 'basic' || !effect.landType;
        // Color filter: some cards can only search for specific basic land types (e.g. Temur Monument: Forest/Island/Mountain)
        const COLOR_TO_LAND: Record<string, string> = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };
        const allowedLandTypes: string[] | null = effect.colors && effect.colors.length > 0
          ? (effect.colors as string[]).map((c: string) => COLOR_TO_LAND[c]).filter(Boolean)
          : null;
        // Also support explicit landTypes array (e.g. Abzan Monument: ["Plains", "Swamp", "Forest"])
        const specificTypes: string[] | null = (effect as any).landTypes || null;
        const availableLands = lib.cards.filter(c => {
          if (isBasicOnly ? !Cards.isBasicLand(c) : !Cards.isLand(c)) return false;
          if (specificTypes) {
            return specificTypes.some((lt: string) => (c.type_line || '').includes(lt));
          }
          if (allowedLandTypes) {
            const name = (c.name || '').toLowerCase();
            return allowedLandTypes.some(t => name.includes(t));
          }
          return true;
        });

        if (availableLands.length === 0) {
          lib.shuffle();
          log.push(`No land found in library.`);
          break;
        }

        // Determine final destination (to_top can be overridden by condition)
        let toTop = effect.to_top || false;
        let toBattlefield = false;
        if (toTop && effect.condition === 'control_dragon' && effect.condition_dest === 'battlefield_tapped') {
          const hasDragon = bf.cards.some(c => Cards.hasCreatureType(c, 'Dragon'));
          if (hasDragon) {
            toBattlefield = true;
            toTop = false;
          }
        }

        if (gameState.players[controller].isHuman) {
          // Interactive: show land selection overlay
          const landOptions = [];
          const seenNames = new Set();
          for (const land of availableLands) {
            if (!seenNames.has(land.name)) {
              seenNames.add(land.name);
              landOptions.push(land);
            }
          }
          gameState._pendingRamp = {
            lands: landOptions,
            tapped: toBattlefield ? true : (effect.tapped || false),
            toHand: effect.to_hand || false,
            toTop: toTop,
            toBattlefield: toBattlefield,
            optional: effect.optional || false,
            playerId: controller,
            amountLeft: (effect as any).amount || 1,
            isBasicOnly: isBasicOnly
          };
          gameState.waitingForInput = { type: 'ramp_choice', playerId: controller };
          log.push(`Choose a land from your library.`);
        } else {
          // AI: always search if available (optional or not), supports amount > 1
          const totalRamps = effect.amount || 1;
          for (let rampI = 0; rampI < totalRamps; rampI++) {
            const currentLands = lib.cards.filter(c => {
              if (isBasicOnly ? !Cards.isBasicLand(c) : !Cards.isLand(c)) return false;
              if (specificTypes) {
                return specificTypes.some((lt: string) => (c.type_line || '').includes(lt));
              }
              if (allowedLandTypes) {
                const name = (c.name || '').toLowerCase();
                return allowedLandTypes.some(t => name.includes(t));
              }
              return true;
            });
            if (currentLands.length === 0) break;
            const hand = gameState.players[controller].zones.hand.cards;
            const colorNeeds = {};
            hand.forEach(c => {
              const pips = (c.mana_cost || '').match(/\{([WUBRG])\}/gi) || [];
              pips.forEach(p => {
                const color = p.replace(/[{}]/g, '').toUpperCase();
                colorNeeds[color] = (colorNeeds[color] || 0) + 1;
              });
            });
            let bestLand = currentLands[0];
            let bestScore = -1;
            for (const l of currentLands) {
              const colors = Cards.getLandManaColors ? Cards.getLandManaColors(l) : [];
              let score = 0;
              for (const c of colors) {
                score += (colorNeeds[c] || 0);
              }
              if (score > bestScore) {
                bestScore = score;
                bestLand = l;
              }
            }
            const land = bestLand;
            const idx = lib.cards.indexOf(land);
            if (idx !== -1) lib.cards.splice(idx, 1);
            if (effect.to_hand) {
              gameState.players[controller].zones.hand.add(land);
              lib.shuffle();
              log.push(`Opponent searches for ${land.name} and puts it into hand.`);
            } else if (toTop) {
              lib.cards.unshift(land);
              log.push(`Opponent searches for ${land.name} and puts it on top of library.`);
            } else if (toBattlefield) {
              const bfLand = Cards.prepareForBattlefield(land);
              bfLand._tapped = true;
              bfLand._summoningSick = false;
              bf.add(bfLand);
              lib.shuffle();
              log.push(`Opponent searches for ${land.name} and puts it onto the battlefield tapped.`);
              const lf1 = GameState.fireTrigger(gameState, 'landfall', { playerId: controller, cardUid: bfLand._uid });
              log.push(...lf1);
            } else {
              const bfLand = Cards.prepareForBattlefield(land);
              bfLand._tapped = effect.tapped ? true : false;
              bfLand._summoningSick = false;
              bf.add(bfLand);
              lib.shuffle();
              log.push(`Opponent searches for ${land.name} and puts it onto the battlefield${effect.tapped ? ' tapped' : ''}.`);
              const lf2 = GameState.fireTrigger(gameState, 'landfall', { playerId: controller, cardUid: bfLand._uid });
              log.push(...lf2);
            }
          }
        }
        break;
      }

      case 'strategic_betrayal': {
        // Target opponent exiles a creature and their graveyard
        // Auto-determine opponent (no targeting needed — always affects the opponent)
        const targetPlayer = controller === 0 ? 1 : 0;
        const bf = gameState.players[targetPlayer].zones.battlefield;
        const gy = gameState.players[targetPlayer].zones.graveyard;
        const exile = gameState.players[targetPlayer].zones.exile;

        // Get opponent's creatures
        const creatures = bf.cards.filter(c => Cards.isCreature(c));
        if (creatures.length === 0) {
          log.push(`${gameState.players[targetPlayer].isHuman ? 'You have' : 'Opponent has'} no creatures to exile.`);
        } else {
          // The targeted player chooses which of their creatures to exile.
          // Since no interactive overlay exists for "exile your own creature", auto-pick:
          //   - Weakest (player would choose their least valuable creature)
          const creature = creatures.reduce((a, b) =>
            (Cards.getPower(a) + Cards.getToughness(a)) <= (Cards.getPower(b) + Cards.getToughness(b)) ? a : b
          );
          bf.remove(creature._uid);
          exile.add(creature);
          GameState._unregisterCardTriggers(gameState, creature._uid);
          log.push(`${creature.name} is exiled.`);
        }

        // Exile opponent's graveyard
        const gyCards = gy.getAll();
        gyCards.forEach(c => {
          gy.remove(c._uid);
          exile.add(c);
        });
        if (gyCards.length > 0) {
          log.push(`${gyCards.length} card(s) from opponent's graveyard exiled.`);
        }
        break;
      }

      case 'severance_priest_token': {
        // Create Spirit token for the OPPONENT equal to CMC of exiled card
        if (!card._exiledByPriest || card._exiledByPriest.length === 0) {
          log.push('No card was exiled by Severance Priest.');
          break;
        }

        const exiledData = card._exiledByPriest[card._exiledByPriest.length - 1];
        const cmc = exiledData.cmc || 0;

        // Token goes to the OPPONENT (the player whose card was exiled)
        const opponentForToken = controller === 0 ? 1 : 0;
        const token = Cards.createToken(opponentForToken, cmc, cmc, 'Spirit');
        token.type_line = 'Creature — Spirit';
        token.colors = ['W'];
        token.color_identity = ['W'];

        const bf = gameState.players[opponentForToken].zones.battlefield;
        bf.add(token);
        GameState._registerCardTriggers(gameState, token, opponentForToken);

        // Exiled card stays in exile (oracle doesn't say it returns)
        log.push(`${opponentForToken === 0 ? 'You get' : 'Opponent gets'} a ${cmc}/${cmc} white Spirit token.`);
        break;
      }

      case 'create_token': {
        let tokenOwner = controller;
        if (effect.controller === 'opponent' || effect.for_opponent) {
          tokenOwner = controller === 0 ? 1 : 0;
        } else if (effect.controller === 'target_controller' && targets && targets.length > 0) {
          tokenOwner = targets[0].player;
        }
        const bf = gameState.players[tokenOwner].zones.battlefield;
        const count = resolveAmount(effect.count || 1);
        for (let i = 0; i < count; i++) {
          const token = Cards.createToken(tokenOwner, effect.power, effect.toughness, effect.name);
          // Set colors if specified (e.g., "1/1 red Goblin")
          if (effect.colors) {
            token.colors = [...effect.colors];
            token.color_identity = [...effect.colors];
          }
          // Set type_line if specified
          if (effect.type_line) {
            token.type_line = effect.type_line;
          }
          if (effect.keywords) {
            effect.keywords.forEach((kw: string) => {
              if (!token.keywords) token.keywords = [];
              const cap = kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
              token.keywords.push(cap);
              token.oracle_text = (token.oracle_text || '') + (token.oracle_text ? ', ' : '') + kw;
            });
            // Clear summoning sickness if token has haste (keywords applied after createToken)
            if (effect.keywords.some((kw: string) => kw.toLowerCase() === 'haste')) {
              token._summoningSick = false;
            }
          }
          // etb_damage is processed after adding to battlefield (below)
          if (effect.sacrificeAtEndStep || effect.sacrifice_eot) token._sacrificeAtEndStep = true;
          // Enter tapped (e.g. Anduril Spirit tokens)
          if (effect.tapped) token._tapped = true;
          // Attacking tokens (e.g. Mobilize)
          if (effect.attacking && gameState.combat && gameState.combat.phase !== 'none') {
            token._attacking = true;
            token._tapped = true;
            token._summoningSick = false;
            gameState.combat.attackers.push({ uid: token._uid, card: token });
          }
          // Attacking if equipped creature is legendary (Anduril)
          if (effect.attacking_if_legendary && gameState.combat && gameState.combat.phase !== 'none') {
            // Find the equipment card, check if the creature it's attached to is legendary
            const equipCard = card || (targets?.[0] && gameState.players[controller].zones.battlefield.get(targets[0].uid));
            const equippedCreature = equipCard?._attachedTo ? gameState.players[controller].zones.battlefield.get(equipCard._attachedTo) : null;
            const isLegendary = equippedCreature && (equippedCreature.type_line || '').includes('Legendary');
            if (isLegendary) {
              token._attacking = true;
              token._tapped = true;
              token._summoningSick = false;
              gameState.combat.attackers.push({ uid: token._uid, card: token });
            }
          }
          bf.add(token);
          gameState._lastCreatedToken = token._uid;
          GameState._registerCardTriggers(gameState, token, tokenOwner);
          // Register prowess trigger for tokens with Prowess keyword (tokens aren't in CardEffectsDB)
          if (token.keywords?.some((kw: string) => kw.toLowerCase() === 'prowess')) {
            if (!gameState._triggers) gameState._triggers = [];
            gameState._triggers.push({
              event: 'cast_noncreature',
              self: false,
              cardUid: token._uid,
              cardName: token.name,
              controllerId: tokenOwner,
              _registeredAtSpellCount: gameState._spellsThisTurn?.[tokenOwner] || 0,
              _registeredAtTurn: gameState.turn,
              effects: [{ type: 'buff', power: 1, toughness: 1, target: 'self', duration: 'end_of_turn' }]
            });
          }
          // Fire other_creature_enters / creature_etb for tokens (Shocking Sharpshooter etc.)
          if (Cards.isCreature(token)) {
            const enterLogs = GameState.fireTrigger(gameState, 'other_creature_enters', { cardUid: token._uid, playerId: tokenOwner, entering: true });
            log.push(...enterLogs);
            const etbLogs = GameState.fireTrigger(gameState, 'creature_etb', { cardUid: token._uid, playerId: tokenOwner });
            log.push(...etbLogs);
          }
        }
        // Register death triggers for named tokens (e.g. Smaug: create 14 Treasures on death; Sauron Necromancer Zombie: return creature from GY)
        if (effect.death_trigger && Array.isArray(effect.death_trigger)) {
          const lastTokens = bf.cards.filter((c: any) => c._isToken && c.name === (effect.name || 'Token')).slice(-count);
          for (const tk of lastTokens) {
            if (!gameState._triggers) gameState._triggers = [];
            gameState._triggers.push({
              event: 'dies', self: true,
              cardUid: tk._uid, cardName: tk.name,
              controllerId: tokenOwner, ownerId: tokenOwner,
              effects: [...effect.death_trigger]
            });
          }
        }
        // Fire token_created trigger (Rosie Cotton, etc.)
        const tokenCreatedLogs = GameState.fireTrigger(gameState, 'token_created', { playerId: tokenOwner, tokenCount: count });
        log.push(...tokenCreatedLogs);

        const who = gameState.players[tokenOwner].isHuman ? 'You' : 'Opponent';
        log.push(`${who} create${gameState.players[tokenOwner].isHuman ? '' : 's'} ${count} ${effect.power}/${effect.toughness} ${effect.name} token(s).`);

        // Process ETB damage inline (e.g., Reliquary Dragon: "When this token enters, deal 3 damage to any target")
        if (effect.etb_damage) {
          const lastToken = gameState.players[tokenOwner].zones.battlefield.get(gameState._lastCreatedToken);
          resolveEffects(gameState, [{ type: 'damage', amount: effect.etb_damage, target: 'any_target' }], lastToken || card, tokenOwner, null, log);
          // If human needs to pick target, save remaining effects and pause
          if (gameState.waitingForInput?.type === 'etb_any_damage_target') {
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          }
        }
        break;
      }

      case 'counters': // alias gerado pelo parser de cards.ts
      case 'counter': {
        // Check if this is countering a spell (anulação) vs adding counters to creature
        if (effect.target === 'spell' || effect.target === 'creature_spell' || effect.target === 'noncreature_spell') {
          // Counter a spell on the stack
          if (!targets || targets.length === 0) {
            log.push('Counter spell requires a target on the stack.');
            break;
          }

          const targetSpell = targets[0];
          if (!targetSpell || !targetSpell.name) {
            log.push('Invalid target for counter.');
            break;
          }

          // Check spell type if restricted
          if (effect.target === 'creature_spell' && !Cards.isCreature(targetSpell)) {
            log.push(`${targetSpell.name} is not a creature spell.`);
            break;
          }
          if (effect.target === 'noncreature_spell' && Cards.isCreature(targetSpell)) {
            log.push(`${targetSpell.name} is a creature spell.`);
            break;
          }

          // Check if the target spell can't be countered
          const targetEffects = Cards.getPreprocessedEffects(targetSpell);
          if (targetEffects?.cantBeCountered) {
            log.push(`${targetSpell.name} can't be countered!`);
            break;
          }

          // Remove from stack and send to owner's graveyard
          const stackIdx = gameState.stack.items.findIndex((s: any) => s.card._uid === targetSpell._uid);
          if (stackIdx !== -1) {
            const removed = gameState.stack.items.splice(stackIdx, 1)[0];
            const spellOwner = removed.controller;
            if (spellOwner !== undefined && gameState.players[spellOwner]) {
              gameState.players[spellOwner].zones.graveyard.add(removed.card);
            }
          }
          log.push(`${targetSpell.name} is countered!`);
          break;
        }

        // Fallback: target: "self" with no explicit targets → place counter on the card itself (ETB self-buff)
        if ((!targets || targets.length === 0) && effect.target === 'self') {
          const bf = gameState.players[controller].zones.battlefield;
          const self = bf.get(card._uid);
          if (self) {
            if (!self._counters) self._counters = { '+1/+1': 0, '-1/-1': 0 };
            const amt = resolveAmount(effect.amount) || 1;
            self._counters[effect.counter] = (self._counters[effect.counter] || 0) + amt;
            log.push(`${self.name} gets ${amt} ${effect.counter} counter(s).`);
            GameState.fireTrigger(gameState, 'counter_placed', { cardUid: self._uid, playerId: controller });
          }
          break;
        }
        // Nazgûl: put counter on ALL own Wraiths
        if (effect.target === 'all_own_wraith') {
          const counterType = effect.counter || '+1/+1';
          const counterAmt = resolveAmount(effect.amount) || 1;
          const wraiths = gameState.players[controller].zones.battlefield.cards.filter(
            (c: any) => Cards.isCreature(c) && Cards.hasCreatureType?.(c, 'Wraith')
          );
          for (const w of wraiths) {
            if (!w._counters) w._counters = {};
            w._counters[counterType] = (w._counters[counterType] || 0) + counterAmt;
            GameState.fireTrigger(gameState, 'counter_placed', { cardUid: w._uid, playerId: controller });
          }
          if (wraiths.length > 0) log.push(`${wraiths.length} Wraith(s) each get ${counterAmt} ${counterType} counter.`);
          break;
        }

        // Handle returned_creatures target: apply counters to creatures just returned from GY (Smile at Death)
        if (effect.target === 'returned_creatures' && gameState._lastReturnedUIDs && gameState._lastReturnedUIDs.length > 0) {
          const counterType = effect.counter || '+1/+1';
          const counterAmt = resolveAmount(effect.amount) || 1;
          for (const ref of gameState._lastReturnedUIDs) {
            const retCreature = gameState.players[ref.player].zones.battlefield.get(ref.uid);
            if (retCreature) {
              if (!retCreature._counters) retCreature._counters = { '+1/+1': 0, '-1/-1': 0 };
              retCreature._counters[counterType] = (retCreature._counters[counterType] || 0) + counterAmt;
              log.push(`${retCreature.name} gets ${counterAmt} ${counterType} counter(s).`);
              GameState.fireTrigger(gameState, 'counter_placed', { cardUid: retCreature._uid, playerId: ref.player });
            }
          }
          break;
        }

        // Distribute counters among creatures (Armament Dragon ETB)
        if (effect.target === 'distribute_creatures' && (!targets || targets.length === 0)) {
          const creatures = gameState.players[controller].zones.battlefield.cards.filter((c: any) => Cards.isCreature(c));
          if (creatures.length === 0) { log.push('No creatures to distribute counters.'); break; }
          if (controller === 0 && gameState.players[0].isHuman) {
            gameState._pendingDistribute = {
              counter: effect.counter,
              total: effect.amount || 1,
              assigned: {},
              controller
            };
            gameState.waitingForInput = { type: 'distribute_counters', playerId: controller };
            log.push(`Distribute ${effect.amount || 1} ${effect.counter} counters among your creatures.`);
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          } else {
            // AI: stack all on best creature
            const best = creatures.slice().sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a))[0];
            if (!best._counters) best._counters = { '+1/+1': 0, '-1/-1': 0 };
            best._counters[effect.counter] = (best._counters[effect.counter] || 0) + (effect.amount || 1);
            log.push(`${best.name} gets ${effect.amount || 1} ${effect.counter} counters.`);
          }
          break;
        }

        // Auto-target for ETB counter effects when no explicit targets (e.g. Reputable Merchant)
        let resolvedCounterTargets = targets;
        if ((!resolvedCounterTargets || resolvedCounterTargets.length === 0) &&
            (effect.target === 'own_creature' || effect.target === 'creature' || effect.target === 'opponent_creature' || effect.target === 'other_own_creature')) {
          const targetPid = effect.target === 'opponent_creature' ? opponent : controller;
          const bf2 = gameState.players[targetPid].zones.battlefield;
          const excludeSelf = effect.target === 'other_own_creature';
          let candidates = bf2.cards.filter((c: any) =>
            Cards.isCreature(c) && Cards.canBeTargeted(c, controller) && (!excludeSelf || c._uid !== card._uid)
          );
          // target_condition: "power_equals_x" — Ent-Draught Basin: only creatures with power === X
          if (effect.target_condition === 'power_equals_x') {
            const xVal = gameState._currentXValue || 0;
            candidates = candidates.filter((c: any) => Cards.getPower(c) === xVal);
          }

          // Human interactive: pause and let player choose target
          if (candidates.length > 0 && controller === 0 && gameState.players[0].isHuman) {
            gameState._pendingETBCounter = {
              effect,
              controller,
              targetPid,
              cardUid: card?._uid,
              candidates: candidates.map((c: any) => c._uid),
            };
            gameState.waitingForInput = { type: 'etb_counter_target', playerId: 0, choices: candidates };
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          }

          // AI: auto-pick best target
          const best = candidates.sort((a: any, b: any) =>
            (Cards.getPower(b) + Cards.getToughness(b)) - (Cards.getPower(a) + Cards.getToughness(a))
          )[0];
          if (best) resolvedCounterTargets = [{ type: 'creature', uid: best._uid, player: targetPid }];
        }

        // Otherwise: add counters to a creature
        if (resolvedCounterTargets && resolvedCounterTargets.length > 0) {
          const targets = resolvedCounterTargets;
          // Check for distribute_creatures (Armament Dragon)
          if (effect.target === 'distribute_creatures') {
            // Distribute counters among multiple targets
            for (const target of targets) {
              const bf = gameState.players[target.player].zones.battlefield;
              const creature = bf.get(target.uid);
              if (creature) {
                if (!Cards.canBeTargeted(creature, controller)) {
                  log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
                  continue;
                }
                const counterAmount = target.amount || 1; // Amount for this specific target
                if (!creature._counters) creature._counters = { '+1/+1': 0, '-1/-1': 0 };
                creature._counters[effect.counter] = (creature._counters[effect.counter] || 0) + counterAmount;
                log.push(`${creature.name} gets ${counterAmount} ${effect.counter} counter(s).`);

                if (creature._counters['+1/+1'] > 0 && creature._counters['-1/-1'] > 0) {
                  const cancel = Math.min(creature._counters['+1/+1'], creature._counters['-1/-1']);
                  creature._counters['+1/+1'] -= cancel;
                  creature._counters['-1/-1'] -= cancel;
                }

                if (Cards.getToughness(creature) <= 0) {
                  GameState.creatureDies(gameState, creature, target.player);
                  log.push(`${creature.name} dies.`);
                }
              }
            }
          } else {
            // Single target counter
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!Cards.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
                break;
              }
              if (!creature._counters) creature._counters = { '+1/+1': 0, '-1/-1': 0 };
              creature._counters[effect.counter] = (creature._counters[effect.counter] || 0) + effect.amount;
              log.push(`${creature.name} gets ${effect.amount} ${effect.counter} counter(s).`);

              if (creature._counters['+1/+1'] > 0 && creature._counters['-1/-1'] > 0) {
                const cancel = Math.min(creature._counters['+1/+1'], creature._counters['-1/-1']);
                creature._counters['+1/+1'] -= cancel;
                creature._counters['-1/-1'] -= cancel;
              }

              if (Cards.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, target.player);
                log.push(`${creature.name} dies.`);
              }
            }
          }
        }
        break;
      }

      case 'counter_self': {
        const bf = gameState.players[controller].zones.battlefield;
        let self = bf.get(card._uid);
        // For sorceries/instants with target: 'own_creature', use the targeted creature if available
        if (!self && effect.target === 'own_creature') {
          const ownTarget = targets?.find((t: any) => t.player === controller);
          if (ownTarget) {
            self = bf.get(ownTarget.uid);
          }
          // Fallback: pick strongest own creature
          if (!self) {
            const ownCreatures = bf.cards.filter(c => CardUtils.isCreature(c));
            if (ownCreatures.length > 0) {
              ownCreatures.sort((a, b) => CardUtils.getPower(b) - CardUtils.getPower(a));
              self = ownCreatures[0];
            }
          }
        }
        if (self) {
          if (!self._counters) self._counters = { '+1/+1': 0, '-1/-1': 0 };
          const selfCounterAmt = resolveAmount(effect.amount);
          self._counters[effect.counter] = (self._counters[effect.counter] || 0) + selfCounterAmt;
          // Finality counter: also set flag so creatureDies can exile instead of going to GY
          if (effect.counter === 'finality') self._finalityCounter = true;
          log.push(`${self.name} gets ${selfCounterAmt} ${effect.counter} counter(s).`);
          // Fire counter_placed trigger (for Aragorn Company Leader's copy effect)
          const cpLogs = GameState.fireTrigger(gameState, 'counter_placed', { playerId: controller, cardUid: self._uid, counter: effect.counter });
          log.push(...cpLogs);
        }
        break;
      }

      case 'set_base_pt': {
        // Set creature's base P/T (Dreadful as the Storm)
        let sbTarget: any = null;
        if (targets && targets.length > 0) {
          const t = targets[0];
          sbTarget = gameState.players[t.player].zones.battlefield.get(t.uid);
        }
        if (!sbTarget) {
          const own = gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          if (own.length > 0) {
            own.sort((a, b) => Cards.getPower(a) - Cards.getPower(b));
            sbTarget = own[0];
          }
        }
        if (sbTarget && Cards.isCreature(sbTarget)) {
          const basePower = parseInt(sbTarget.power) || 0;
          const baseToughness = parseInt(sbTarget.toughness) || 0;
          const powerDiff = effect.power - basePower;
          const toughDiff = effect.toughness - baseToughness;
          sbTarget._powerMod = (sbTarget._powerMod || 0) + powerDiff - (sbTarget._tempPowerMod || 0);
          sbTarget._toughnessMod = (sbTarget._toughnessMod || 0) + toughDiff - (sbTarget._tempToughnessMod || 0);
          sbTarget._tempPowerMod = powerDiff;
          sbTarget._tempToughnessMod = toughDiff;
          sbTarget._basePtUntilEOT = true;
          log.push(`${sbTarget.name}'s base P/T becomes ${effect.power}/${effect.toughness}.`);
        }
        break;
      }

      case 'bite': {
        // One opponent creature deals damage to another opponent creature (Breaking of the Fellowship)
        const oppId = controller === 0 ? 1 : 0;
        if (targets && targets.length >= 2) {
          const src = gameState.players[targets[0].player].zones.battlefield.get(targets[0].uid);
          const vic = gameState.players[targets[1].player].zones.battlefield.get(targets[1].uid);
          if (src && vic) {
            const dmg = Cards.getPower(src);
            if (Cards.hasKeyword(src, 'Deathtouch') && dmg > 0) {
              vic._damage = Cards.getToughness(vic);
            } else {
              vic._damage = (vic._damage || 0) + dmg;
            }
            log.push(`${src.name} deals ${dmg} damage to ${vic.name}.`);
            if (vic._damage >= Cards.getToughness(vic)) {
              GameState.creatureDies(gameState, vic, targets[1].player);
              log.push(`${vic.name} dies.`);
            }
          }
        } else {
          // Auto-target: strongest opponent creature bites second-strongest
          const oppBf = gameState.players[oppId].zones.battlefield;
          const oppCreats = oppBf.cards.filter(c => Cards.isCreature(c));
          if (oppCreats.length >= 2) {
            oppCreats.sort((a, b) => Cards.getPower(b) - Cards.getPower(a));
            const src = oppCreats[0], vic = oppCreats[1];
            const dmg = Cards.getPower(src);
            vic._damage = (vic._damage || 0) + dmg;
            log.push(`${src.name} deals ${dmg} damage to ${vic.name}.`);
            if (vic._damage >= Cards.getToughness(vic)) {
              GameState.creatureDies(gameState, vic, oppId);
              log.push(`${vic.name} dies.`);
            }
          }
        }
        break;
      }

      case 'exile_self': {
        // Exile this card from graveyard (Council's Deliberation)
        const esUid = card._uid;
        const gy = gameState.players[controller].zones.graveyard;
        const esCard = gy.get ? gy.get(esUid) : null;
        if (esCard) {
          gy.remove(esUid);
          gameState.players[controller].zones.exile.add(esCard);
          log.push(`${esCard.name} exiles itself from the graveyard.`);
        }
        break;
      }

      case 'remove_counter_draw': {
        // Dawn of a New Age: remove a counter, draw. If 0 counters, sacrifice + gain 4.
        const rcdCard = gameState.players[controller].zones.battlefield.get(card._uid);
        if (rcdCard) {
          const ct = effect.counter || 'hope';
          const cnt = rcdCard._counters?.[ct] || 0;
          if (cnt > 0) {
            rcdCard._counters[ct] = cnt - 1;
            const lib = gameState.players[controller].zones.library;
            if (lib.count() > 0) {
              const drawn = lib.drawFromTop();
              gameState.players[controller].zones.hand.add(drawn);
              log.push(`${rcdCard.name}: removed ${ct} counter, drew a card. (${cnt - 1} remaining)`);
            }
            if (cnt - 1 <= 0) {
              gameState.players[controller].zones.battlefield.remove(rcdCard._uid);
              gameState.players[controller].zones.graveyard.add(rcdCard);
              gameState.players[controller].life += 4;
              log.push(`${rcdCard.name} sacrificed (no counters). Gained 4 life.`);
            }
          }
        }
        break;
      }

      case 'cant_prevent_damage': {
        gameState._cantPreventDamageThisTurn = true;
        log.push('Damage cannot be prevented this turn.');
        break;
      }

      case 'damage_same_controller': {
        // Deal damage to each other creature same controller as target
        const oppId = controller === 0 ? 1 : 0;
        if (targets && targets.length > 0) {
          const tgt = targets[0];
          const tgtPid = tgt.player ?? oppId;
          const sameCtrl = gameState.players[tgtPid].zones.battlefield.cards.filter(
            c => Cards.isCreature(c) && c._uid !== tgt.uid
          );
          const splashAmt = effect.amount || 1;
          for (const c of sameCtrl) {
            c._damage = (c._damage || 0) + splashAmt;
            log.push(`${c.name} takes ${splashAmt} damage.`);
            if (c._damage >= Cards.getToughness(c)) {
              GameState.creatureDies(gameState, c, tgtPid);
              log.push(`${c.name} dies.`);
            }
          }
        }
        break;
      }

      case 'add_mana': {
        // Add mana to caster's pool (e.g., Narset's Rebuke generates {U}{R}{W})
        if (effect.colors && Array.isArray(effect.colors)) {
          for (const c of effect.colors) {
            gameState.manaPool[controller][c] = (gameState.manaPool[controller][c] || 0) + 1;
            // Track restricted mana by type
            if (effect.restriction) {
              if (!gameState._restrictedMana) gameState._restrictedMana = [{}, {}];
              if (!gameState._restrictedMana[controller]) gameState._restrictedMana[controller] = {};
              const rType = effect.restriction as string;
              if (!gameState._restrictedMana[controller][rType]) gameState._restrictedMana[controller][rType] = {};
              gameState._restrictedMana[controller][rType][c] = (gameState._restrictedMana[controller][rType][c] || 0) + 1;
            }
          }
          log.push(`+{${effect.colors.join('}{')}} mana.`);
        } else if (effect.color) {
          const c = effect.color;
          const amt = effect.amount || 1;
          gameState.manaPool[controller][c] = (gameState.manaPool[controller][c] || 0) + amt;
          // Track restricted mana by type
          if (effect.restriction) {
            if (!gameState._restrictedMana) gameState._restrictedMana = [{}, {}];
            if (!gameState._restrictedMana[controller]) gameState._restrictedMana[controller] = {};
            const rType = effect.restriction as string;
            if (!gameState._restrictedMana[controller][rType]) gameState._restrictedMana[controller][rType] = {};
            gameState._restrictedMana[controller][rType][c] = (gameState._restrictedMana[controller][rType][c] || 0) + amt;
          }
          log.push(`+{${c}} mana.`);
        }
        break;
      }

      case 'mark_exile_on_death': {
        // Replacement effect: if target creature would die this turn, exile it instead
        const target = (targets || [])[0];
        if (target && target.type === 'creature') {
          const bf = gameState.players[target.player].zones.battlefield;
          const targetCard = bf.get(target.uid);
          if (targetCard) {
            targetCard._exileOnDeath = true;
            log.push(`${targetCard.name}: if it dies this turn, it will be exiled.`);
          }
        }
        break;
      }

      case 'counter_all': {
        const bf = gameState.players[controller].zones.battlefield;
        const creatures = bf.cards.filter(c => Cards.isCreature(c));
        for (const creature of creatures) {
          if (!creature._counters) creature._counters = { '+1/+1': 0, '-1/-1': 0 };
          creature._counters[effect.counter] = (creature._counters[effect.counter] || 0) + effect.amount;
        }
        log.push(`All creatures get ${effect.amount} ${effect.counter} counter(s).`);
        break;
      }

      case 'discard': {
        // For 'damaged_player': only fire if a player was actually damaged (null = creature targeted)
        if (effect.target === 'damaged_player' && gameState._lastDamagedPlayer == null) {
          log.push('No player was damaged — discard skipped.');
          break;
        }
        const targetPlayer = effect.target === 'opponent' ? opponent
          : effect.target === 'damaged_player' ? (gameState._lastDamagedPlayer as number)
          : controller;
        const hand = gameState.players[targetPlayer].zones.hand;
        const gy = gameState.players[targetPlayer].zones.graveyard;

        // If human player needs to discard, pause for interactive choice
        if (gameState.players[targetPlayer].isHuman && hand.count() > 0) {
          const isOptional = effect.up_to || effect.optional;
          gameState._pendingDiscard = {
            targetPlayer,
            amount: effect.amount || 1,
            up_to: !!effect.up_to,
            optional: !!effect.optional,
            controller,
            effectIndex: gameState._effectStack ? gameState._effectStack.length : 0,
            unless_creature: !!effect.unless_creature,
          };
          gameState.waitingForInput = { type: 'mandatory_discard', playerId: targetPlayer };
          if (effect.unless_creature) {
            log.push(`Discard ${effect.amount || 2} cards unless you discard a creature card.`);
          } else {
            log.push(isOptional
              ? `You may discard up to ${effect.amount || 1} card(s).`
              : `You must discard ${effect.amount || 1} card(s).`);
          }
          // Save remaining effects so they resume after human chooses (e.g., draw 2 after discard)
          if (ei < effects.length - 1) {
            gameState._pendingStackEffects = {
              card, controller, targets,
              effects: effects.slice(ei + 1),
              log
            };
          }
          return log; // Pause resolution until human chooses
        }

        // AI or opponent: auto-discard
        // unless_creature: discard 1 creature instead of N non-creatures if possible
        if (effect.unless_creature) {
          const handCards = hand.getAll();
          const creatures = handCards.filter(c => Cards.isCreature(c));
          if (creatures.length > 0) {
            // Discard weakest creature (only 1)
            creatures.sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
            const c = creatures[0];
            hand.remove(c._uid);
            gy.add(c);
            log.push(`${gameState.players[targetPlayer].isHuman ? 'You' : 'Opponent'} discards ${c.name} (creature).`);
            break;
          }
          // No creature: fall through to discard N cards normally
        }
        const sorted = hand.getAll().sort((a, b) => {
          if (Cards.isLand(a) && !Cards.isLand(b)) return -1;
          if (!Cards.isLand(a) && Cards.isLand(b)) return 1;
          return (a.cmc || 0) - (b.cmc || 0);
        });

        const discarded = [];
        for (let i = 0; i < effect.amount && sorted.length > 0; i++) {
          const c = sorted.shift();
          hand.remove(c._uid);
          gy.add(c);
          discarded.push(c.name);
          // Track nonland discard for conditions
          if (!Cards.isLand(c)) {
            if (!gameState._lastDiscardedNonland) gameState._lastDiscardedNonland = {};
            gameState._lastDiscardedNonland[controller] = true;
          }
          // Fire opponent_discards trigger
          if (targetPlayer !== controller) {
            const trigLogs = GameState.fireTrigger(gameState, 'opponent_discards', { playerId: controller, cardUid: c._uid });
            log.push(...trigLogs);
          }
        }

        if (discarded.length > 0) {
          const who = targetPlayer === 0 ? 'You' : 'Opponent';
          log.push(`${who} discard${targetPlayer === 0 ? '' : 's'}: ${discarded.join(', ')}.`);
        }
        break;
      }

      case 'discard_to_hand_size': {
        // Discard cards until hand size <= hand_size (e.g. Isildur's Fateful Strike: discard to 4)
        const dthsTarget = effect.target === 'opponent' ? opponent : controller;
        const dthsHand = gameState.players[dthsTarget].zones.hand;
        const dthsGy = gameState.players[dthsTarget].zones.graveyard;
        const maxSize = effect.hand_size ?? 7;
        const excess = dthsHand.count() - maxSize;
        if (excess > 0) {
          if (gameState.players[dthsTarget].isHuman) {
            // Human discards interactively
            gameState._pendingDiscard = { targetPlayer: dthsTarget, amount: excess, up_to: false, optional: false, controller };
            gameState.waitingForInput = { type: 'mandatory_discard', playerId: dthsTarget };
            log.push(`Discard ${excess} card(s) to reduce hand to ${maxSize}.`);
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          }
          // AI: discard cheapest cards
          const aiSorted = dthsHand.getAll().sort((a: any, b: any) => (a.cmc || 0) - (b.cmc || 0));
          const discardedNames: string[] = [];
          for (let i = 0; i < excess && aiSorted.length > 0; i++) {
            const c = aiSorted.shift();
            dthsHand.remove(c._uid);
            dthsGy.add(c);
            discardedNames.push(c.name);
          }
          log.push(`${dthsTarget === 0 ? 'You' : 'Opponent'} discard${dthsTarget === 0 ? '' : 's'} to ${maxSize}: ${discardedNames.join(', ')}.`);
        }
        break;
      }

      case 'optional_discard': {
        // Optional discard (used by Glacial Dragonhunt, etc.)
        const optHand = gameState.players[controller].zones.hand;
        const optHandSize = optHand.count();

        if (optHandSize === 0) {
          log.push('No cards in hand to discard.');
          break;
        }

        if (gameState.players[controller].isHuman) {
          // Human: optional choice overlay
          gameState._pendingOptionalDiscard = {
            controller,
            amount: effect.amount || 1,
            onNonlandDiscard: effect.onNonlandDiscard || null
          };
          gameState.waitingForInput = { type: 'optional_discard_choice', playerId: controller };
          log.push('You may discard a card.');
          return log;
        } else {
          // AI: decide whether to discard
          const hasBonus = effect.onNonlandDiscard && effect.onNonlandDiscard.length > 0;
          const oppBf = gameState.players[1 - controller].zones.battlefield;
          const oppCreatures = oppBf.cards.filter(c => Cards.isCreature(c));

          // If has bonus damage effect and opponent has creatures, strongly prefer discarding nonland
          let shouldDiscard = false;
          let preferNonland = false;
          if (hasBonus && oppCreatures.length > 0) {
            shouldDiscard = true;
            preferNonland = true;
          } else {
            shouldDiscard = optHandSize > 4 ? Math.random() < 0.7 : Math.random() < 0.3;
          }

          if (shouldDiscard) {
            const optGy = gameState.players[controller].zones.graveyard;
            let sorted;
            if (preferNonland) {
              // Prefer discarding cheapest nonland card for the bonus effect
              const nonlands = optHand.getAll().filter(c => !Cards.isLand(c));
              const lands = optHand.getAll().filter(c => Cards.isLand(c));
              if (nonlands.length > 0) {
                sorted = nonlands.sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
              } else {
                sorted = lands; // No nonlands, discard land (no bonus)
              }
            } else {
              sorted = optHand.getAll().sort((a, b) => {
                if (Cards.isLand(a) && !Cards.isLand(b)) return -1;
                if (!Cards.isLand(a) && Cards.isLand(b)) return 1;
                return (a.cmc || 0) - (b.cmc || 0);
              });
            }

            const toDiscard = sorted[0];
            optHand.remove(toDiscard._uid);
            optGy.add(toDiscard);

            // Track nonland discard for conditions
            const discardedNonland = !Cards.isLand(toDiscard);
            if (discardedNonland) {
              if (!gameState._lastDiscardedNonland) gameState._lastDiscardedNonland = {};
              gameState._lastDiscardedNonland[controller] = true;
            }

            log.push(`AI discards ${toDiscard.name}.`);

            // Process onNonlandDiscard bonus effects (AI auto-targets)
            if (discardedNonland && hasBonus) {
              for (const bonusEffect of effect.onNonlandDiscard) {
                if (bonusEffect.type === 'damage' && bonusEffect.target === 'creature') {
                  // AI: pick best target creature (opponent's, highest threat)
                  if (oppCreatures.length > 0) {
                    const bestTarget = oppCreatures.sort((a, b) =>
                      (GameState._threatScore ? GameState._threatScore(b) : (b.cmc || 0)) -
                      (GameState._threatScore ? GameState._threatScore(a) : (a.cmc || 0))
                    )[0];
                    if (bestTarget && Cards.canBeTargeted(bestTarget, controller)) {
                      bestTarget._damage = (bestTarget._damage || 0) + bonusEffect.amount;
                      vfxPlay('damage', bestTarget._uid);
                      if (bestTarget._damage >= Cards.getToughness(bestTarget)) {
                        GameState.creatureDies(gameState, bestTarget, 1 - controller);
                        log.push(`Glacial Dragonhunt deals ${bonusEffect.amount} damage to ${bestTarget.name} - dies!`);
                      } else {
                        log.push(`Glacial Dragonhunt deals ${bonusEffect.amount} damage to ${bestTarget.name}.`);
                      }
                    }
                  }
                }
              }
            }
          } else {
            log.push('AI chooses not to discard.');
          }
        }
        break;
      }

      case 'fight': {
        // Friendly Rivalry: human picks own creature + own legendary + opponent creature (3 steps)
        if (effect.target === 'two_own_vs_opponent') {
          const ownCreatures = gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          const enemies = gameState.players[opponent].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          if (ownCreatures.length === 0 || enemies.length === 0) break;

          if (gameState.players[controller].isHuman) {
            // 3-step interactive targeting
            gameState._pendingFriendlyRivalry = { step: 1, fighter1Uid: null, fighter2Uid: null };
            gameState.waitingForInput = { type: 'friendly_rivalry_choose', step: 1, playerId: controller, choices: ownCreatures };
            // Store remaining effects after fight to resume later
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          }

          // AI auto-pick: two strongest own creatures, one-sided damage to weakest killable foe
          ownCreatures.sort((a, b) => Cards.getPower(b) - Cards.getPower(a));
          const f1 = ownCreatures[0];
          const f2 = ownCreatures.length > 1 ? ownCreatures[1] : null;
          const totalPow = Cards.getPower(f1) + (f2 ? Cards.getPower(f2) : 0);
          const killable = enemies.filter(e => Cards.getToughness(e) - (e._damage || 0) <= totalPow);
          const foe = (killable.length > 0 ? killable : enemies).sort((a, b) => Cards.getPower(a) - Cards.getPower(b))[0];
          // Friendly Rivalry: one-sided damage (creatures deal to foe, foe doesn't deal back)
          foe._damage = (foe._damage || 0) + Cards.getPower(f1);
          log.push(`${f1.name} deals ${Cards.getPower(f1)} damage to ${foe.name}!`);
          if (f2) { foe._damage = (foe._damage || 0) + Cards.getPower(f2); log.push(`${f2.name} deals ${Cards.getPower(f2)} damage to ${foe.name}!`); }
          if (foe._damage >= Cards.getToughness(foe)) { GameState.creatureDies(gameState, foe, opponent); log.push(`${foe.name} dies.`); }
          break;
        }

        if (targets && targets.length > 0) {
          // For multi-effect spells (e.g. Knockout Maneuver: counter own + fight opp),
          // targets may contain both own creature (targets[0]) and opp creature (targets[1]).
          // Find the opponent's creature target (first target belonging to opponent).
          const ownTarget = targets.find((t: any) => t.player === controller);
          const oppTarget = targets.find((t: any) => t.player !== undefined && t.player !== controller);

          const myBf = gameState.players[controller].zones.battlefield;
          // Use own-side target if available
          let ourCreature = ownTarget ? myBf.get(ownTarget.uid) : null;
          if (!ourCreature || !Cards.isCreature(ourCreature)) {
            // Fall back to the spell's own card (creature with fight ability) or strongest own creature
            ourCreature = myBf.get(card._uid);
          }
          if (!ourCreature || !Cards.isCreature(ourCreature)) {
            const owned = myBf.cards.filter(c => Cards.isCreature(c))
              .sort((a, b) => Cards.getPower(b) - Cards.getPower(a));
            ourCreature = owned[0] || null;
          }

          // If no opponent target was explicitly provided, auto-pick best opponent creature
          const opponent = controller === 0 ? 1 : 0;
          let theirCreature: any = null;
          if (oppTarget) {
            theirCreature = gameState.players[oppTarget.player].zones.battlefield.get(oppTarget.uid);
          }
          if (!theirCreature) {
            // Auto-pick: prefer killable targets
            const opponentCreatures = gameState.players[opponent].zones.battlefield.cards
              .filter((c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller))
              .sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a));
            theirCreature = opponentCreatures[0] || null;
          }
          const target = oppTarget ?? { player: opponent };

          if (ourCreature && theirCreature) {
            const ourPower = Cards.getPower(ourCreature);
            const theirPower = Cards.getPower(theirCreature);

            theirCreature._damage += ourPower;
            if (!effect.one_sided) {
              ourCreature._damage += theirPower;
            }

            if (Cards.hasKeyword(ourCreature, 'Deathtouch') && ourPower > 0) {
              theirCreature._damage = Cards.getToughness(theirCreature);
            }
            if (!effect.one_sided && Cards.hasKeyword(theirCreature, 'Deathtouch') && theirPower > 0) {
              ourCreature._damage = Cards.getToughness(ourCreature);
            }

            log.push(`${ourCreature.name} ${effect.one_sided ? 'deals damage to' : 'fights'} ${theirCreature.name}.`);

            const theirPid = oppTarget ? oppTarget.player : opponent;
            if (theirCreature._damage >= Cards.getToughness(theirCreature)) {
              GameState.creatureDies(gameState, theirCreature, theirPid);
              log.push(`${theirCreature.name} dies.`);
            }
            if (ourCreature._damage >= Cards.getToughness(ourCreature)) {
              GameState.creatureDies(gameState, ourCreature, controller);
              log.push(`${ourCreature.name} dies.`);
            }
          }
        }
        break;
      }

      case 'power_damage': {
        // One-sided fight: own creature deals damage equal to its power to target. No retaliation.
        // "Target creature you control deals damage equal to its power to target creature or planeswalker."
        if (targets && targets.length > 0) {
          const oppTarget = targets.find((t: any) => t.player !== controller) ?? targets[targets.length - 1];
          const ownTarget = targets.find((t: any) => t.player === controller);
          const myBf = gameState.players[controller].zones.battlefield;
          let ourCreature = ownTarget ? myBf.get(ownTarget.uid) : null;
          if (!ourCreature || !Cards.isCreature(ourCreature)) {
            const owned = myBf.cards.filter(c => Cards.isCreature(c)).sort((a, b) => Cards.getPower(b) - Cards.getPower(a));
            ourCreature = owned[0] || null;
          }
          const theirBf = gameState.players[oppTarget.player].zones.battlefield;
          const theirCreature = theirBf.get(oppTarget.uid);

          if (ourCreature && theirCreature) {
            const dmg = Cards.getPower(ourCreature);
            if (Cards.hasKeyword(ourCreature, 'Deathtouch') && dmg > 0) {
              theirCreature._damage = Cards.getToughness(theirCreature); // lethal
            } else {
              theirCreature._damage += dmg;
            }
            log.push(`${ourCreature.name} deals ${dmg} damage to ${theirCreature.name}.`);
            if (theirCreature._damage >= Cards.getToughness(theirCreature)) {
              GameState.creatureDies(gameState, theirCreature, oppTarget.player);
              log.push(`${theirCreature.name} dies.`);
            }
          }
        }
        break;
      }

      case 'remove_counters_all': {
        // ETB: remove all counters from target creature (Purging Stormbrood)
        if (targets && targets.length > 0) {
          // Already has targets (pre-selected) — delegate to handler
          break; // falls through to stack-part2
        }
        // No targets — gather all creatures from both sides for human/AI choice
        const rcaCandidates: any[] = [];
        for (let pid = 0; pid < gameState.players.length; pid++) {
          for (const c of gameState.players[pid].zones.battlefield.cards) {
            if (!Cards.isCreature(c)) continue;
            rcaCandidates.push({ card: c, pid });
          }
        }
        if (rcaCandidates.length === 0) break;
        if (gameState.players[controller].isHuman) {
          gameState._pendingRemoveCountersAll = { controllerId: controller, candidates: rcaCandidates, optional: !!effect.optional };
          gameState.waitingForInput = { type: 'etb_remove_counters_target', playerId: controller, choices: rcaCandidates.map(x => x.card) };
          break;
        }
        // AI: pick opponent's creature with the most counters
        const rcaOpp = rcaCandidates.filter(x => x.pid !== controller && x.card._counters);
        const rcaBest = rcaOpp.sort((a, b) => {
          const sumA = Object.values(a.card._counters as Record<string,number>).reduce((s, v) => s + v, 0);
          const sumB = Object.values(b.card._counters as Record<string,number>).reduce((s, v) => s + v, 0);
          return sumB - sumA;
        })[0];
        if (rcaBest && rcaBest.card._counters) {
          let tot = 0;
          for (const ct in rcaBest.card._counters) { tot += rcaBest.card._counters[ct]; rcaBest.card._counters[ct] = 0; }
          log.push(`Remove all ${tot} counter(s) from ${rcaBest.card.name}.`);
          if (Cards.getToughness(rcaBest.card) <= 0) {
            GameState.creatureDies(gameState, rcaBest.card, rcaBest.pid);
          }
        }
        break;
      }

      case 'tap': {
        if (effect.target === 'enchanted') {
          // Aura ETB: tap the enchanted creature
          const auraCard = card;
          if (auraCard && auraCard._attachedTo) {
            const ownerPid = auraCard._attachedToOwner ?? opponent;
            const enchanted = gameState.players[ownerPid].zones.battlefield.get(auraCard._attachedTo);
            if (enchanted && !enchanted._tapped) {
              enchanted._tapped = true;
              enchanted._tapTriggerFired = true;
              log.push(`${enchanted.name} is tapped by ${auraCard.name}.`);
              // Fire becomes_tapped triggers immediately (Rescue Leopard rummage, etc.)
              const tapLogs = GameState.fireTrigger(gameState, 'becomes_tapped', {
                cardUid: enchanted._uid, card: enchanted, controllerId: ownerPid
              });
              if (tapLogs.length > 0) log.push(...tapLogs);
            }
          }
          break;
        }
        if (effect.target === 'all_opponent_creatures') {
          const tapCreatures = gameState.players[opponent].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          tapCreatures.forEach(c => {
            const wasTapped = c._tapped;
            c._tapped = true;
            c._tapTriggerFired = true;
            if (!wasTapped) {
              const tapLogs = GameState.fireTrigger(gameState, 'becomes_tapped', { cardUid: c._uid, card: c, controllerId: opponent });
              log.push(...tapLogs);
            }
          });
          log.push(`All opponent's creatures are tapped.`);
        } else if (targets && targets.length > 0) {
          const target = targets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const creature = bf.get(target.uid);
          if (creature) {
            if (!Cards.canBeTargeted(creature, controller)) {
              log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            const wasTapped = creature._tapped;
            creature._tapped = true;
            creature._tapTriggerFired = true;
            log.push(`${creature.name} is tapped.`);
            // Fire becomes_tapped trigger
            if (!wasTapped) {
              const tapLogs = GameState.fireTrigger(gameState, 'becomes_tapped', {
                cardUid: creature._uid,
                card: creature,
                controllerId: target.player
              });
              log.push(...tapLogs);
            }
          }
        } else if (effect.target && effect.target !== 'all_opponent_creatures') {
          // ETB tap with no pre-selected targets — auto-target for AI, pause for human
          const tapOpponent = effect.target === 'own_creature' ? controller : opponent;
          const tapCandidates = gameState.players[tapOpponent].zones.battlefield.cards
            .filter((c: any) => Cards.isCreature(c) && !c._tapped && Cards.canBeTargeted(c, controller));
          if (tapCandidates.length === 0) break;
          const maxTap = effect.up_to || 1;
          if (gameState.players[controller].isHuman) {
            gameState._pendingETBTap = { effect, controller, cardUid: card?._uid, targetPid: tapOpponent, maxTap };
            gameState.waitingForInput = { type: 'etb_tap_target', playerId: controller, choices: tapCandidates, maxTap };
            break;
          }
          // AI: tap highest-threat untapped creatures
          tapCandidates.sort((a: any, b: any) =>
            (Cards.getPower(b) + Cards.getToughness(b)) - (Cards.getPower(a) + Cards.getToughness(a))
          );
          for (const c of tapCandidates.slice(0, maxTap)) {
            c._tapped = true;
            c._tapTriggerFired = true;
            log.push(`${c.name} is tapped.`);
            GameState.fireTrigger(gameState, 'becomes_tapped', { cardUid: c._uid, card: c, controllerId: tapOpponent });
          }
        }
        break;
      }

      case 'cant_block_without_flying': {
        // Fire of Orthanc: all creatures without flying can't block this turn
        let cbAffected = 0;
        for (const player of gameState.players) {
          for (const c of player.zones.battlefield.cards) {
            if (Cards.isCreature(c) && !Cards.hasKeyword(c, 'Flying')) {
              (c as any)._cantBlockThisTurn = true;
              cbAffected++;
            }
          }
        }
        if (cbAffected > 0) log.push(`Creatures without flying can't block this turn.`);
        break;
      }

      case 'cant_block': {
        // ETB: target opponent creature can't block this turn (or while_saga) — prompt human to choose
        const cbOpponent = effect.target === 'self' ? controller : opponent;
        const cbIsSagaDuration = (effect as any).duration === 'while_saga';
        const cbSagaUid = cbIsSagaDuration ? (card?._uid || null) : null;
        const cbCandidates = gameState.players[cbOpponent].zones.battlefield.cards
          .filter((c: any) => Cards.isCreature(c) && !c._cantBlockThisTurn && !c._cantBlockSagaUid && Cards.canBeTargeted(c, controller));
        if (cbCandidates.length === 0) break;
        if (gameState.players[controller].isHuman) {
          gameState._pendingETBCantBlock = { effect, controller, targetPid: cbOpponent, cbIsSagaDuration, cbSagaUid };
          gameState.waitingForInput = { type: 'etb_cant_block_target', playerId: controller, choices: cbCandidates };
          break;
        }
        // AI: disable highest-toughness creature (most impactful blocker)
        cbCandidates.sort((a: any, b: any) => Cards.getToughness(b) - Cards.getToughness(a));
        if (cbIsSagaDuration && cbSagaUid) {
          cbCandidates[0]._cantBlockSagaUid = cbSagaUid;
          log.push(`${cbCandidates[0].name} can't block while the saga is in play.`);
        } else {
          cbCandidates[0]._cantBlockThisTurn = true;
          log.push(`${cbCandidates[0].name} can't block this turn.`);
        }
        break;
      }

      case 'untap': {
        if (targets && targets.length > 0) {
          const target = targets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const creature = bf.get(target.uid);
          if (creature) {
            if (!Cards.canBeTargeted(creature, controller)) {
              log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            creature._tapped = false;
            log.push(`${creature.name} is untapped.`);
          }
        }
        break;
      }

      case 'optional_pay_counters': {
        // "If you control a Dragon, you may pay {N}. If you do, put N +1/+1 counters on target."
        // Check condition (e.g. control_dragon)
        if (effect.condition && typeof GameState._checkEffectCondition === 'function' &&
            !GameState._checkEffectCondition(gameState, controller, effect)) {
          log.push('Condition not met — skipping optional payment.');
          break;
        }
        // Check if player has enough untapped lands to pay
        const payAmount = effect.pay || 5;
        const availPool = Mana.getAvailableMana(gameState, controller);
        const totalAvail = Object.values(availPool).reduce((s: number, v: number) => s + v, 0);
        if (totalAvail < payAmount) {
          log.push(`Not enough mana to pay {${payAmount}} — skipping.`);
          break;
        }

        // Determine the target creature (same = reuse first target from spell)
        const counterTarget = (effect.target === 'same' && targets && targets.length > 0)
          ? targets[0] : null;

        if (controller === 0 && gameState.players[0].isHuman) {
          // Human: prompt via confirm_optional overlay
          gameState._pendingOptionalPayCounters = {
            pay: payAmount,
            counter: effect.counter || '+1/+1',
            amount: effect.amount || payAmount,
            target: counterTarget,
            controller
          };
          // Store remaining effects for after resolution
          if (ei < effects.length - 1) {
            gameState._pendingStackEffects = {
              card, controller, targets,
              effects: effects.slice(ei + 1),
              log
            };
          }
          gameState.waitingForInput = {
            type: 'confirm_optional',
            playerId: controller,
            message: `Pay {${payAmount}} to put ${effect.amount || payAmount} ${effect.counter || '+1/+1'} counters on ${counterTarget ? gameState.players[counterTarget.player].zones.battlefield.get(counterTarget.uid)?.name || 'creature' : 'creature'}?`
          };
          return log;
        } else {
          // AI: pay if target exists and has enough mana
          if (counterTarget) {
            const bf = gameState.players[counterTarget.player].zones.battlefield;
            const creature = bf.get(counterTarget.uid);
            if (creature) {
              // Tap lands to pay
              const genericCost = '{' + payAmount + '}';
              GameState.autoTapForSpell(gameState, controller, genericCost, payAmount);
              gameState.manaPool[controller] = Mana.payMana(gameState.manaPool[controller], genericCost, payAmount);
              // Add counters
              const counterType = effect.counter || '+1/+1';
              const counterAmt = effect.amount || payAmount;
              if (!creature._counters) creature._counters = {};
              creature._counters[counterType] = (creature._counters[counterType] || 0) + counterAmt;
              log.push(`Paid {${payAmount}}: ${creature.name} gets ${counterAmt} ${counterType} counters!`);
            }
          }
        }
        break;
      }

      case 'prevent_damage': {
        // Store prevention shield on controller
        if (!gameState._damageShield) gameState._damageShield = {};
        gameState._damageShield[controller] = (gameState._damageShield[controller] || 0) + effect.amount;
        log.push(`Prevent the next ${effect.amount} damage.`);
        break;
      }

      case 'prevent_damage_shield': {
        // New Way Forward: prevent next damage from a chosen source this turn, redirect + draw
        // The target is the chosen source (creature/permanent)
        let sourceUid: string | null = null;
        let sourceName = 'chosen source';
        if (targets && targets.length > 0) {
          const t = targets[0];
          if (t.uid) {
            sourceUid = t.uid;
            // Find the source name for logging
            for (let pid = 0; pid < gameState.players.length; pid++) {
              const src = gameState.players[pid].zones.battlefield.get(t.uid);
              if (src) { sourceName = src.name; break; }
            }
          }
        }
        gameState._preventDamageShield = { playerId: controller, turn: gameState.turn, sourceUid };
        log.push(`New Way Forward: next damage from ${sourceName} to you this turn will be prevented, redirected, and you draw that many cards.`);
        break;
      }

      case 'return_from_graveyard': {
        const gy = gameState.players[controller].zones.graveyard;
        const toBattlefield = effect.to_battlefield === true;
        const toHand = !toBattlefield && effect.to_hand !== false;
        const toTopLibrary = !toBattlefield && effect.to_top_library === true;
        const optional = effect.optional === true;

        // Pick best creature from graveyard (or target type)
        let candidates = gy.getAll();
        if (effect.target === 'creature') {
          candidates = candidates.filter(c => Cards.isCreature(c));
        } else if (effect.target === 'noncreature_nonland') {
          candidates = candidates.filter(c => !Cards.isCreature(c) && !Cards.isLand(c));
        } else if (effect.target === 'creature_mv3') {
          // Yathan Roadwatcher: creature with mana value 3 or less
          candidates = candidates.filter(c => Cards.isCreature(c) && (c.cmc || 0) <= 3);
        } else if (effect.target === 'permanent') {
          candidates = candidates.filter(c => Cards.isPermanent(c));
        } else if (effect.target === 'nonland_permanent_mv2') {
          // Wayspeaker Bodyguard: nonland permanent with mana value 2 or less
          candidates = candidates.filter(c => Cards.isPermanent(c) && !Cards.isLand(c) && (c.cmc || 0) <= 2);
        } else if (effect.target === 'instant_or_sorcery') {
          // Kishla Trawlers: instant or sorcery card.
          // For DFC cards (Dragon // Sorcery — Omen), only check primary face type.
          // A "Creature — Dragon // Sorcery — Omen" is a creature, NOT an instant/sorcery.
          candidates = candidates.filter(c => {
            const primaryType = ((c.type_line || '').split('//')[0]).toLowerCase();
            return primaryType.includes('instant') || primaryType.includes('sorcery');
          });
        } else if (effect.target === 'creature_power2_or_less') {
          // Smile at Death: creature with power 2 or less
          candidates = candidates.filter(c => Cards.isCreature(c) && Cards.getPower(c) <= 2);
        } else if (effect.target === 'creature_mv_plus1') {
          // Sidisi, Regent of the Mire: creature with MV ≤ sacrificed_creature_mv + 1
          // Without tracking the sacrificed creature's CMC, allow any creature as candidate
          candidates = candidates.filter(c => Cards.isCreature(c));
        } else if (effect.target === 'permanent') {
          candidates = candidates.filter(c => Cards.isPermanent(c));
        } else if (effect.target === 'equipment') {
          // Forge Anew: return equipment from graveyard
          candidates = candidates.filter(c => (c.type_line || '').toLowerCase().includes('equipment'));
        }

        const amount = effect.amount || 1;

        // If human player, always show modal to choose (even if mandatory)
        if (controller === 0 && candidates.length > 0) {
          gameState._pendingGYReturn = {
            effect, candidates, amount, toHand, toTopLibrary, toBattlefield, controller
          };
          gameState.waitingForInput = { type: 'choose_gy_return', playerId: 0, optional: true };
          // Save remaining effects to resume after choice
          if (ei < effects.length - 1) {
            gameState._pendingStackEffects = {
              card, controller, targets,
              effects: effects.slice(ei + 1),
              log
            };
          }
          return log; // Pause resolution for player choice
        }

        // Auto-pick best candidates
        candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        gameState._lastReturnedUIDs = []; // Track UIDs for "returned_creatures" counter target
        for (let i = 0; i < amount && i < candidates.length; i++) {
          const card = candidates[i];
          gy.remove(card._uid);

          // Store returned creature's power for next effect with amount: "returned_creature_power"
          if (Cards.isCreature(card)) {
            gameState._lastReturnedPower = Cards.getPower(card);
          }

          // Fire trigger when card leaves graveyard
          GameState.fireTrigger(gameState, 'card_leaves_graveyard', { playerId: controller, card: card });
          if (toTopLibrary) {
            gameState.players[controller].zones.library.cards.unshift(card);
            log.push(`${card.name} returns from graveyard to the top of library.`);
          } else if (toHand) {
            gameState.players[controller].zones.hand.add(card);
            log.push(`${card.name} returns from graveyard to hand.`);
          } else {
            const bfCard = Cards.prepareForBattlefield(card);
            bfCard._ownerId = controller;

            // Apply with_counters (keyword counters like hexproof, indestructible)
            if (effect.with_counters && Array.isArray(effect.with_counters)) {
              if (!bfCard._counters) bfCard._counters = {};
              for (const keyword of effect.with_counters) {
                bfCard._counters[keyword] = (bfCard._counters[keyword] || 0) + 1;
                log.push(`${bfCard.name} enters with ${keyword} counter.`);
              }
            }

            gameState.players[controller].zones.battlefield.add(bfCard);
            gameState._lastReturnedUIDs.push({ uid: bfCard._uid, player: controller });
            log.push(`${card.name} returns from graveyard to the battlefield!`);
          }
        }
        if (candidates.length === 0) {
          log.push('No valid card in graveyard.');
        }
        break;
      }

      case 'graveyard_to_bottom_library': {
        // Jade-Cast Sentinel: put target card from a graveyard on the bottom of its owner's library
        // Searches both graveyards when any_graveyard is set
        const allGYCards: { card: any; pid: number }[] = [];
        for (let pid = 0; pid < gameState.players.length; pid++) {
          for (const c of gameState.players[pid].zones.graveyard.getAll()) {
            allGYCards.push({ card: c, pid });
          }
        }
        if (allGYCards.length === 0) {
          log.push('No cards in any graveyard.');
          break;
        }
        // Human: show graveyard choice overlay
        if (controller === 0 && gameState.players[0]?.isHuman) {
          gameState._pendingGYBottomLibrary = {
            candidates: allGYCards,
            controller,
          };
          gameState.waitingForInput = { type: 'choose_gy_bottom_library', playerId: 0 };
          if (ei < effects.length - 1) {
            gameState._pendingStackEffects = {
              card, controller, targets,
              effects: effects.slice(ei + 1),
              log
            };
          }
          return log;
        }
        // AI: pick highest CMC card from opponent's GY first, then own
        const oppId = controller === 0 ? 1 : 0;
        const oppCards = allGYCards.filter(c => c.pid === oppId);
        const pick = (oppCards.length > 0 ? oppCards : allGYCards)
          .sort((a, b) => (b.card.cmc || 0) - (a.card.cmc || 0))[0];
        if (pick) {
          gameState.players[pick.pid].zones.graveyard.remove(pick.card._uid);
          gameState.players[pick.pid].zones.library.cards.push(pick.card); // bottom
          log.push(`${pick.card.name} is put on the bottom of its owner's library.`);
        }
        break;
      }

      case 'debuff':
      case 'debuff_all': {
        if (effect.type === 'debuff_all') {
          // Resolve X values if present
          let powerMod = effect.power;
          let toughnessMod = effect.toughness;
          if (powerMod === "X" || toughnessMod === "X") {
            const xValue = gameState._currentXValue !== undefined ? gameState._currentXValue : 0;
            if (powerMod === "X") powerMod = -xValue;
            if (toughnessMod === "X") toughnessMod = -xValue;
          }

          let allCreatures = [];
          if (effect.target === 'opponent_creatures') {
            const targetId = controller === 0 ? 1 : 0;
            allCreatures = gameState.players[targetId].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          } else if (effect.target === 'non_dragon_creatures') {
            // All non-Dragon creatures on both battlefields
            for (let pid = 0; pid < gameState.players.length; pid++) {
              const creatures = gameState.players[pid].zones.battlefield.cards.filter(c =>
                Cards.isCreature(c) && !Cards.hasCreatureType(c, 'Dragon')
              );
              creatures.forEach(c => allCreatures.push({ creature: c, playerId: pid }));
            }
          } else {
            const targetId = controller;
            allCreatures = gameState.players[targetId].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          }

          // Apply debuff
          if (effect.target === 'non_dragon_creatures') {
            for (const { creature, playerId } of allCreatures) {
              creature._powerMod = (creature._powerMod || 0) + (powerMod || 0);
              creature._toughnessMod = (creature._toughnessMod || 0) + (toughnessMod || 0);
              creature._tempPowerMod = (creature._tempPowerMod || 0) + (powerMod || 0);
              creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (toughnessMod || 0);
            }
            log.push(`All non-Dragon creatures get ${powerMod}/${toughnessMod}.`);
            // Kill creatures with 0 or less toughness
            for (const { creature, playerId } of allCreatures) {
              if (Cards.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, playerId);
              }
            }
          } else {
            for (const c of allCreatures) {
              c._powerMod = (c._powerMod || 0) + (powerMod || 0);
              c._toughnessMod = (c._toughnessMod || 0) + (toughnessMod || 0);
              c._tempPowerMod = (c._tempPowerMod || 0) + (powerMod || 0);
              c._tempToughnessMod = (c._tempToughnessMod || 0) + (toughnessMod || 0);
            }
            const targetId = effect.target === 'opponent_creatures' ? (controller === 0 ? 1 : 0) : controller;
            log.push(`All ${targetId === 0 ? 'your' : "opponent's"} creatures get ${powerMod}/${toughnessMod}.`);
            // Kill creatures with 0 or less toughness
            const dying = allCreatures.filter(c => Cards.getToughness(c) <= 0);
            dying.forEach(c => GameState.creatureDies(gameState, c, targetId));
          }
        } else if (targets && targets.length > 0) {
          const target = targets[0];
          const creature = gameState.players[target.player].zones.battlefield.get(target.uid);
          if (creature) {
            // Check Ward before applying debuff (opponent's creature targeted)
            if (target.player !== controller && !_payWardCost(creature, controller, gameState, log, !!(card && (Cards.getPreprocessedEffects(card) as any)?.cantBeCountered))) {
              log.push(`${creature.name}'s ward countered the debuff!`);
            } else {
              creature._powerMod = (creature._powerMod || 0) + (effect.power || 0);
              creature._toughnessMod = (creature._toughnessMod || 0) + (effect.toughness || 0);
              creature._tempPowerMod = (creature._tempPowerMod || 0) + (effect.power || 0);
              creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (effect.toughness || 0);
              log.push(`${creature.name} gets ${effect.power}/${effect.toughness} until end of turn.`);
              if (Cards.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, target.player);
                log.push(`${creature.name} dies.`);
              }
            }
          }
        } else if (effect.target === 'opponent_creature' || effect.target === 'creature') {
          // ETB debuff without pre-selected targets (e.g. Gurmag Rakshasa)
          const targetPid = effect.target === 'opponent_creature' ? opponent : controller;
          const candidates = gameState.players[targetPid].zones.battlefield.cards.filter(
            (c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller)
          );
          if (candidates.length > 1 && controller === 0 && gameState.players[0]?.isHuman) {
            // Human: show interactive target choice overlay
            const rp = effect.power || 0;
            const rt = effect.toughness || 0;
            gameState._pendingBuffChoice = {
              playerId: controller,
              effect,
              resolvedPower: rp,
              resolvedToughness: rt,
              candidates: candidates.map((c: any) => c._uid),
              sourceUid: card?._uid,
              targetPlayerId: targetPid
            };
            gameState.waitingForInput = { type: 'buff_choice', playerId: controller };
            log.push(`Choose a creature to get ${rp}/${rt}.`);
            // Save remaining effects for later
            if (ei < effects.length - 1) {
              gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
            }
            return log;
          } else if (candidates.length > 0) {
            // AI or single creature: auto-pick strongest
            candidates.sort((a: any, b: any) => Cards.getPower(b) - Cards.getPower(a));
            const creature = candidates[0];
            // Check Ward before applying debuff (ward works on abilities too)
            if (!_payWardCost(creature, controller, gameState, log, false)) {
              log.push(`${creature.name}'s ward countered the debuff!`);
            } else {
              creature._powerMod = (creature._powerMod || 0) + (effect.power || 0);
              creature._toughnessMod = (creature._toughnessMod || 0) + (effect.toughness || 0);
              creature._tempPowerMod = (creature._tempPowerMod || 0) + (effect.power || 0);
              creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (effect.toughness || 0);
              log.push(`${creature.name} gets ${effect.power}/${effect.toughness} until end of turn.`);
              if (Cards.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, targetPid);
                log.push(`${creature.name} dies.`);
              }
            }
          }
        }
        break;
      }

      // Route all remaining effect types to stack-part2 handlers
      case 'conditional_discard_return': {
        // "You may discard a card. When you do, return target creature or land card from your graveyard to your hand."
        const cdrResult = GameState._resolveSimpleEffect(gameState, controller, effect, { cardUid: card._uid, card, cardName: card.name });
        if (cdrResult) log.push(cdrResult);
        if (gameState.waitingForInput) {
          if (ei < effects.length - 1) {
            gameState._pendingStackEffects = { card, controller, targets, effects: effects.slice(ei + 1), log };
          }
          return log;
        }
        break;
      }

      default: {
        const part2Result = StackPart2.dispatch(
          effect, state, card, controller, targets, effects, ei, log, resolveAmount
        );
        if (part2Result) return part2Result;
        break;
      }

    } // end switch
  } // end for effects loop

  // Register target_dies triggered abilities for spell cards (e.g. Desperate Measures)
  // These can't use normal _registerCardTriggers since spells don't enter the battlefield.
  // Register as one-shot temp triggers tied to the specific targeted card's UID.
  const spellDb = Cards.getPreprocessedEffects ? Cards.getPreprocessedEffects(card) : null;
  if (spellDb?.triggered && targets && targets.length > 0) {
    for (const dbTrigger of spellDb.triggered) {
      if (dbTrigger.event === 'target_dies') {
        if (!gameState._tempTriggers) gameState._tempTriggers = [];
        gameState._tempTriggers.push({
          cardUid: card._uid,
          cardName: card.name,
          controller: controller,
          event: 'dies',
          targetCardUid: targets[0].uid, // Only fires when this specific creature dies
          effects: dbTrigger.effects,
          expiresAt: 'end_of_turn',
          once: true,
          _tempId: Date.now() + Math.random()
        });
      }
    }
  }

  return log;
}

// ---------------------------------------------------------------------------
// Helper: pay ward cost
// ---------------------------------------------------------------------------

export function _payWardCost(creature, controller, state, log, castingCantBeCountered = false) {
  const gameState = state;
  if (!Cards.hasKeyword(creature, 'Ward')) return true;

  // Ward only triggers when an OPPONENT targets — skip if controller owns the creature
  const creatureOwnerPid = state.players.findIndex((p: any) => p.zones.battlefield.get(creature._uid));
  if (creatureOwnerPid === controller) return true;

  // If the originating spell can't be countered, ward's countering effect doesn't apply
  if (castingCantBeCountered) {
    log.push(`Ward: spell can't be countered — ward ignored.`);
    return true;
  }

  // Check for "Ward—Pay N life" first
  const wardLifeMatch = (creature.oracle_text || '').match(/ward[\s—]+pay\s+(\d+)\s+life/i);
  if (wardLifeMatch) {
    const lifeCost = parseInt(wardLifeMatch[1]) || 0;
    if (lifeCost === 0) return true;
    // Human: show ward choice modal
    if (gameState.players[controller]?.isHuman) {
      // Find which player owns this creature
      const wardCreaturePid = gameState.players.findIndex((p: any) =>
        p.zones.battlefield.get(creature._uid)
      );
      gameState._pendingWardChoice = {
        creatureUid: creature._uid,
        creatureName: creature.name,
        wardCost: lifeCost,
        wardType: 'life',
        searchPid: wardCreaturePid >= 0 ? wardCreaturePid : (controller === 0 ? 1 : 0),
        damageMode: false,
        stackPath: true,
      };
      gameState.waitingForInput = { type: 'ward_choice', playerId: controller };
      log.push(`${creature.name} has Ward—Pay ${lifeCost} life.`);
      return false; // pause — spell not yet resolved
    }
    // AI: auto-pay
    const casterLife = gameState.players[controller].life;
    if (casterLife > lifeCost) {
      gameState.players[controller].life -= lifeCost;
      log.push(`Ward: paid ${lifeCost} life.`);
      return true;
    }
    log.push(`Ward—pay ${lifeCost} life: can't pay — spell is countered.`);
    return false;
  }

  const wardCostMatch = (creature.oracle_text || '').match(/ward[\s—]+\{?(\d+)\}?/i);
  if (!wardCostMatch) return true; // Ward without a cost — assume free

  const wardCost = parseInt(wardCostMatch[1]) || 0;
  if (wardCost === 0) return true;

  // Calculate total available mana (pool + untapped lands)
  const pool = (gameState.manaPool && gameState.manaPool[controller]) ? gameState.manaPool[controller] : {};
  const poolTotal = (Object.values(pool) as number[]).reduce((sum: number, v) => sum + (v as number), 0);

  // Count untapped lands for additional mana
  const untappedLands = gameState.players[controller].zones.battlefield.cards.filter(
    (c: any) => Cards.isLand(c) && !c._tapped
  );
  const availableMana = poolTotal + untappedLands.length;

  if (availableMana >= wardCost) {
    // First pay from existing pool
    let remaining = wardCost;
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
      const paid = Math.min((pool as any)[color] || 0, remaining);
      (pool as any)[color] = ((pool as any)[color] || 0) - paid;
      remaining -= paid;
      if (remaining === 0) break;
    }
    // If pool wasn't enough, auto-tap lands for the remainder
    if (remaining > 0) {
      for (const land of untappedLands) {
        if (remaining <= 0) break;
        (land as any)._tapped = true;
        (pool as any)['C'] = ((pool as any)['C'] || 0) + 1;
        // Pay immediately from this tapped land
        const paid = Math.min((pool as any)['C'] || 0, remaining);
        (pool as any)['C'] = ((pool as any)['C'] || 0) - paid;
        remaining -= paid;
      }
    }
    log.push(`Ward ${wardCost} paid.`);
    return true;
  }

  // Cannot pay ward — spell is countered
  log.push(`Ward ${wardCost}: can't pay — spell is countered.`);
  return false;
}

// ---------------------------------------------------------------------------
// Helper: AI mode selection for modal spells
// ---------------------------------------------------------------------------

export function _aiChooseModes(modes, chooseCount, state, controller, opponent, targets) {
  const _safeN = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // Board context for smarter mode selection
  const myLife = state.players[controller]?.life ?? 20;
  const oppLife = state.players[opponent]?.life ?? 20;
  const myHandSize = state.players[controller]?.zones.hand.count() ?? 3;
  const myCreatures = state.players[controller]?.zones.battlefield.cards.filter((c: any) => c.type_line?.toLowerCase().includes('creature')) ?? [];
  const oppCreatures = state.players[opponent]?.zones.battlefield.cards.filter((c: any) => c.type_line?.toLowerCase().includes('creature')) ?? [];
  const lowLife = myLife <= 8;
  const lowHand = myHandSize <= 2;
  const behindOnBoard = oppCreatures.length > myCreatures.length + 1;
  const oppLowLife = oppLife <= 8;

  const scored = modes.map((mode, idx) => {
    let score = 0;
    // Support ModalMode { label, effects[] } and flat effect arrays
    const effects = Array.isArray(mode) ? mode
      : (mode && mode.effects && Array.isArray(mode.effects)) ? mode.effects
      : [mode];
    for (const eff of effects) {
      switch (eff.type) {
        case 'damage': {
          const amt = _safeN(eff.amount);
          score += amt * 2;
          // Damage worth more at critical life totals
          if (oppLowLife && oppLife <= amt) score += 10; // Potentially lethal to face!
          else if (oppLowLife) score += 4; // Opponent hurting — chip is good
          if (lowLife) score -= 2; // Our low life — stabilizing > damage
          break;
        }
        case 'draw': {
          const amt = _safeN(eff.amount);
          score += amt * 3;
          if (lowHand) score += amt * 2; // Extra value when hellbent
          break;
        }
        case 'gainLife': {
          const amt = _safeN(eff.amount);
          score += amt;
          if (lowLife) score += amt * 1.5; // Lifegain crucial when dying
          break;
        }
        case 'destroy':
          score += 8;
          if (behindOnBoard) score += 3; // Removal more valuable when behind
          if (oppCreatures.length === 0) score -= 4; // No targets = waste
          break;
        case 'exile':
          score += 9;
          if (behindOnBoard) score += 3;
          if (oppCreatures.length === 0) score -= 4;
          break;
        case 'counter': score += 7; break;
        case 'bounce':
          score += 5;
          if (behindOnBoard) score += 2;
          if (oppCreatures.length === 0) score -= 2;
          break;
        case 'buff': score += (eff.power || 0) + (eff.toughness || 0); break;
        case 'create_token': score += (eff.count || 1) * 3; break;
        case 'ramp': score += 6; break;
        default: score += 2;
      }
    }
    return { mode: effects, score, idx };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, chooseCount).map(s => s.mode);
}

// --- CONTINUES IN stack-part2.ts ---
