// @ts-nocheck
// stack-part1.ts — First half of stack module (legacy stack.js lines 1-1700)

import * as Cards from './cards';
import * as Mana from './mana';
import * as CardUtils from './card-utils';
import * as GameState from './game-state';
import * as GameAI from './game-ai';
import * as StackPart2 from './stack-part2';
import { vfxPlay } from './vfx-bridge';

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

  while (stack.items.length > 0) {
    const item = stack.items.pop();
    const results = _resolveItem(item, state);
    // Ensure results is always an array
    if (Array.isArray(results)) {
      log.push(...results);
    } else {
      console.warn('[STACK] _resolveItem returned non-array:', results);
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
    if (amt === 'lands_count') return gameState.players[controller].zones.battlefield.cards.filter(c => Cards.isLand(c)).length;
    if (amt === 'lands_in_gy_count') return gameState.players[controller].zones.graveyard.getAll().filter(c => Cards.isLand(c)).length;
    if (amt === 'spells_this_turn') return gameState._spellsThisTurn ? gameState._spellsThisTurn[controller] || 0 : 0;
    if (amt === 'returned_creature_power') return gameState._lastReturnedPower || 0; // For Lie in Wait
    if (amt === 'mana_value') return card.cmc || 0;
    if (amt === 'prevented') return gameState._lastPreventedDamage || 0;
    // Safety: if still a string, parse as int or default to 0
    const parsed = parseInt(amt);
    return isNaN(parsed) ? 0 : parsed;
  };

  const waitingBefore = gameState.waitingForInput;
  for (let ei = 0; ei < effects.length; ei++) {
    const effect = effects[ei];
    // Check effect-level condition
    if (effect.condition) {
      // Special case: "if_cast" needs card context
      if (effect.condition === 'if_cast' && !card._wasCast) {
        continue; // Card was not cast, skip this effect
      }
      // Special case: "dealt_damage_this_turn" for targeted effects (Unsparing Boltcaster)
      // Should check if the TARGET creature was dealt damage, not the controller
      else if (effect.condition === 'dealt_damage_this_turn' && targets && targets.length > 0) {
        const target = targets[0];
        if (target.type === 'creature') {
          const bf = gameState.players[target.player].zones.battlefield;
          const targetCard = bf.get(target.uid);
          if (!targetCard || !targetCard._damagedThisTurn) {
            continue; // Target was not dealt damage this turn, skip effect
          }
        }
      }
      // Other conditions via GameState
      else if (effect.condition !== 'dealt_damage_this_turn' && typeof GameState._checkEffectCondition === 'function' &&
          !GameState._checkEffectCondition(gameState, controller, effect)) {
        continue; // Condition not met, skip
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
        const chooseCount = effect.chooseTwo ? 2 : (effect.chooseCount || 1);

        if (controller === 0 && gameState.players[0].isHuman) {
          // Human player: show interactive modal choice overlay
          gameState._pendingModal = {
            cardName: card.name,
            modes: modes,
            chooseCount: chooseCount,
            controller: controller,
            card: card,
            targets: targets,
            remainingEffects: effects.slice(ei + 1)
          };
          gameState.waitingForInput = { type: 'modal_choice', playerId: controller };
          log.push(`${card.name}: choose ${chooseCount === 1 ? 'a mode' : chooseCount + ' modes'}.`);
          return log; // Stop resolving — will continue after human picks
        } else {
          // AI picks best mode(s)
          const chosen = _aiChooseModes(modes, chooseCount, gameState, controller, opponent, targets);
          const modeEffects = chosen.flatMap(m => Array.isArray(m) ? m : [m]);
          effects.splice(ei + 1, 0, ...modeEffects);
          log.push(`Mode(s) chosen: ${modeEffects.map(e => e.type).join(', ')}.`);
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
                if (!_payWardCost(creature, controller, gameState, log)) continue;
                vfxPlay('damage', creature._uid);
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
          const target = targets[0];
          // Validate target (hexproof/shroud)
          if (target.type === 'creature') {
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!Cards.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} can't be targeted (hexproof/shroud).`);
                break;
              }
              if (!_payWardCost(creature, controller, gameState, log)) break;
              vfxPlay('damage', creature._uid);
              creature._damage += dmgAmt;
              // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
              creature._damagedThisTurn = true;
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
          // For AI: divide evenly, for human: should use distribute UI (TODO)
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

        if (targets && targets.length > 0) {
          // Mode 1: Targeted sacrifice (e.g., Liliana forcing opponent to sac)
          const target = targets[0];
          GameState.sacrifice(gameState, target.uid, target.player);
          vfxPlay('death', target.uid);
          log.push(`Permanent sacrificed.`);
        } else {
          // Mode 2: Controller sacrifices their own permanent
          const targetPlayerId = controller;
          const bf = gameState.players[targetPlayerId].zones.battlefield;

          // Filter permanents based on target
          let sacrificeable = bf.cards.filter(c => {
            if (effect.target === 'nonland_permanent') return !Cards.isLand(c);
            if (effect.target === 'creature') return Cards.isCreature(c);
            if (effect.target === 'artifact_or_enchantment') return Cards.isArtifact(c) || Cards.isEnchantment(c);
            return true; // Default: can sacrifice anything
          });

          if (sacrificeable.length === 0) {
            if (!effect.optional) log.push('No valid permanent to sacrifice.');
            break;
          }

          if (effect.optional && controller !== 0) {
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

          if (controller === 0) {
            // Human player: interactive choice
            gameState.waitingForInput = {
              type: 'sacrifice',
              playerId: controller,
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
            GameState.sacrifice(gameState, toSacrifice._uid, targetPlayerId);
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
          else if (tgt === 'creature_with_flying') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && Cards.hasKeyword(c, 'Flying') && Cards.canBeTargeted(c, controller));
          else if (tgt === 'noncreature_artifact') validChoices = allBFCards.filter(({ c }) => c.type_line?.includes('Artifact') && !c.type_line?.includes('Creature'));
          else if (tgt === 'creature_power4+') validChoices = allBFCards.filter(({ c, pid }) => pid !== controller && Cards.isCreature(c) && Cards.getPower(c) >= 4 && Cards.canBeTargeted(c, controller));

          if (validChoices.length === 0) {
            log.push(`No valid target to destroy.`);
            break;
          }

          // Human player: pause and let them choose
          if (gameState.players[controller].isHuman) {
            gameState._pendingETBDestroy = { effect, controller, cardUid: card?._uid };
            gameState.waitingForInput = {
              type: 'etb_destroy_target',
              playerId: controller,
              choices: validChoices.map(({ c, pid }) => ({ ...c, _ownerPid: pid })),
            };
            break;
          }

          // AI: auto-pick highest-power valid target (most threatening)
          validChoices.sort((a, b) => Cards.getPower(b.c) - Cards.getPower(a.c));
          const pick = validChoices[0];
          if (pick) effectTargets = [{ type: 'permanent', uid: pick.c._uid, player: pick.pid }];
        }
        if (effectTargets && effectTargets.length > 0) {
          const target = effectTargets[0];
          const bf = gameState.players[target.player].zones.battlefield;
          const permanent = bf.get(target.uid);
          if (permanent) {
            // Check targeting
            if (!Cards.canBeTargeted(permanent, controller)) {
              log.push(`${permanent.name} can't be targeted (hexproof/shroud).`);
              break;
            }
            // Check indestructible
            if (Cards.hasIndestructible(permanent)) {
              log.push(`${permanent.name} is indestructible!`);
              break;
            }
            if (Cards.isCreature(permanent)) {
              const died = GameState.creatureDies(gameState, permanent, target.player);
              if (died) log.push(`${permanent.name} is destroyed.`);
            } else {
              // Non-creature permanent (enchantment, artifact, planeswalker)
              bf.remove(permanent._uid);
              GameState._unregisterCardTriggers(gameState, permanent._uid);
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
            return false;
          });
          const dying = toDestroy.filter(c => !Cards.hasIndestructible(c));
          const surviving = toDestroy.filter(c => Cards.hasIndestructible(c));
          surviving.forEach(c => log.push(`${c.name} is indestructible!`));
          dying.forEach(c => {
            GameState.creatureDies(gameState, c, pid);
            log.push(`${c.name} is destroyed.`);
            totalDestroyed++; // Count each destroyed permanent
          });
        }

        // Store total destroyed count for next effect with amount: "X"
        gameState._currentXValue = totalDestroyed;
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
            }

            log.push(`${permanent.name} is exiled.`);
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
            // Remove aura effects if this creature has auras
            if (c._attachments) {
              for (const attUid of c._attachments) {
                for (const p of gameState.players) {
                  const att = p.zones.battlefield.get(attUid);
                  if (att && Cards.isAura(att)) {
                    GameState._removeAuraEffects(gameState, att, c);
                  }
                }
              }
            }
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
            filterFn = (c: any) => Cards.isCreature(c) && !c._isToken;
          } else if (effect.target === 'nonland_permanent' || effect.target === 'spell_or_permanent') {
            // spell_or_permanent: ideally targets spells on stack too, but fall back to nonland permanent
            autoTargetPlayer = opponentId;
            filterFn = (c: any) => !Cards.isLand(c);
          } else if (effect.target === 'own_nonland') {
            // Sunpearl Kirin: bounce own non-land (optional, not source card itself)
            autoTargetPlayer = controller;
            filterFn = (c: any) => !Cards.isLand(c) && c._uid !== card._uid;
          } else {
            autoTargetPlayer = opponentId;
            filterFn = (c: any) => !Cards.isLand(c);
          }
          const candidates = gameState.players[autoTargetPlayer].zones.battlefield.cards
            .filter(filterFn)
            .filter((c: any) => Cards.canBeTargeted(c, controller));

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
            ({ type: 'creature', uid: c._uid, player: autoTargetPlayer })
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

            // If aura, remove effects from enchanted creature
            if (Cards.isAura(permanent) && permanent._attachedTo) {
              for (const p of gameState.players) {
                const enchanted = p.zones.battlefield.get(permanent._attachedTo);
                if (enchanted) {
                  GameState._removeAuraEffects(gameState, permanent, enchanted);
                  enchanted._attachments = enchanted._attachments.filter(uid => uid !== permanent._uid);
                  break;
                }
              }
            }

            bf.remove(permanent._uid);
            GameState._unregisterCardTriggers(gameState, permanent._uid);
            // Fire leaves_battlefield for creatures
            if (Cards.isCreature(permanent)) {
              GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, card: permanent, ownerId: target.player });
            }
            // Tokens disappear, non-tokens return to hand
            if (permanent._isToken) {
              log.push(`${permanent.name} token vanishes.`);
            } else {
              gameState.players[target.player].zones.hand.add(permanent);
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
            } else {
              // AI always chooses bottom (to avoid redrawing it immediately)
              // Human would get UI choice (not implemented yet - defaults to top)
              const chosenPosition = target.player === 0 ? 'top' : 'bottom'; // player 0 = human (top), player 1 = AI (bottom)
              if (chosenPosition === 'top') {
                gameState.players[target.player].zones.library.putOnTop(permanent);
                log.push(`${permanent.name} is put on top of library.`);
              } else {
                gameState.players[target.player].zones.library.putOnBottom(permanent);
                log.push(`${permanent.name} is put on the bottom of library.`);
              }
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
        // loseLife is a drawback/cost — defaults to controller (self-harm)
        const loseLifeTarget = (effect.target === 'opponent' || effect.target === 'each_opponent') ? opponent : controller;
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
        const isTemp = !Cards.isPermanent(card);
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
        if (effect.target === 'all_own_creatures') {
          let bp = 0, bt = 0;
          gameState.players[controller].zones.battlefield.cards.forEach(c => {
            if (Cards.isCreature(c)) {
              const r = applyBuff(c);
              bp = r.p; bt = r.t;
            }
          });
          log.push(`All creatures get ${bp >= 0 ? '+' : ''}${bp}/${bt >= 0 ? '+' : ''}${bt}.`);
        } else if (effect.type === 'multi_buff_up_to' && targets && targets.length > 0) {
          // Rally the Monastery: buff multiple targets
          for (const target of targets) {
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature && Cards.canBeTargeted(creature, controller)) {
              const r = applyBuff(creature);
              log.push(`${creature.name} gets ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t}.`);
            }
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
              const best = bf2.cards.filter(c => Cards.isCreature(c) && Cards.canBeTargeted(c, controller))
                .sort((a, b) => Cards.getPower(b) - Cards.getPower(a))[0];
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
        const isBasicOnly = effect.landType === 'basic' || !effect.landType;
        const availableLands = lib.cards.filter(c => isBasicOnly ? Cards.isBasicLand(c) : Cards.isLand(c));

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
            playerId: controller
          };
          gameState.waitingForInput = { type: 'ramp_choice', playerId: controller };
          log.push(`Choose a land from your library.`);
        } else {
          // AI: always search if available (optional or not)
          let land = null;
          const hand = gameState.players[controller].zones.hand.cards;
          const colorNeeds = {};
          hand.forEach(c => {
            const pips = (c.mana_cost || '').match(/\{([WUBRG])\}/gi) || [];
            pips.forEach(p => {
              const color = p.replace(/[{}]/g, '').toUpperCase();
              colorNeeds[color] = (colorNeeds[color] || 0) + 1;
            });
          });
          let bestLand = availableLands[0];
          let bestScore = -1;
          for (const l of availableLands) {
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
          land = bestLand;
          const idx = lib.cards.indexOf(land);
          if (idx !== -1) lib.cards.splice(idx, 1);
          if (effect.to_hand) {
            gameState.players[controller].zones.hand.add(land);
            lib.shuffle();
            log.push(`Opponent searches for ${land.name} and puts it into hand.`);
          } else if (toTop) {
            lib.cards.unshift(land);
            // Don't shuffle - card goes on top
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
        break;
      }

      case 'strategic_betrayal': {
        // Target opponent exiles a creature and their graveyard
        if (!targets || targets.length === 0) break;
        const targetPlayer = targets[0].player;
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
        // Create Spirit token equal to CMC of exiled card (from Severance Priest)
        if (!card._exiledByPriest || card._exiledByPriest.length === 0) {
          log.push('No card was exiled by Severance Priest.');
          break;
        }

        const exiledData = card._exiledByPriest[card._exiledByPriest.length - 1];
        const cmc = exiledData.cmc || 0;

        // Create the Spirit token
        const token = Cards.createToken(controller, cmc, cmc, 'Spirit');
        token.type_line = 'Spirit';
        token.colors = ['W'];
        token.color_identity = ['W'];

        const bf = gameState.players[controller].zones.battlefield;
        bf.add(token);
        GameState._registerCardTriggers(gameState, token, controller);

        log.push(`${controller === 0 ? 'You create' : 'Opponent creates'} a ${cmc}/${cmc} white Spirit token.`);
        break;
      }

      case 'create_token': {
        let tokenOwner = controller;
        if (effect.controller === 'opponent') {
          tokenOwner = controller === 0 ? 1 : 0;
        } else if (effect.controller === 'target_controller' && targets && targets.length > 0) {
          tokenOwner = targets[0].player;
        }
        const bf = gameState.players[tokenOwner].zones.battlefield;
        const count = effect.count || 1;
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
            effect.keywords.forEach(kw => {
              if (!token.keywords) token.keywords = [];
              token.keywords.push(kw);
              token.oracle_text = (token.oracle_text || '') + (token.oracle_text ? ', ' : '') + kw;
            });
          }
          // Add ETB damage trigger if specified
          if (effect.etb_damage) {
            if (!token._triggers) token._triggers = [];
            token._triggers.push({
              event: 'enters_battlefield',
              effects: [{ type: 'damage', amount: effect.etb_damage, target: 'any_target' }]
            });
          }
          if (effect.sacrificeAtEndStep || effect.sacrifice_eot) token._sacrificeAtEndStep = true;
          if (effect.attacking && gameState.combat && gameState.combat.phase !== 'none') {
            token._attacking = true;
            token._tapped = true;
            token._summoningSick = false;
            gameState.combat.attackers.push({ uid: token._uid, card: token });
          }
          bf.add(token);
          GameState._registerCardTriggers(gameState, token, tokenOwner);
        }
        const who = gameState.players[tokenOwner].isHuman ? 'You' : 'Opponent';
        log.push(`${who} create${gameState.players[tokenOwner].isHuman ? '' : 's'} ${count} ${effect.power}/${effect.toughness} ${effect.name} token(s).`);
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

          // Remove from stack (mark as countered — _resolveItem checks _countered flag)
          const stackIdx = gameState.stack.items.findIndex((s: any) => s.card._uid === targetSpell._uid);
          if (stackIdx !== -1) gameState.stack.items.splice(stackIdx, 1);
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

        // Auto-target for ETB counter effects when no explicit targets (e.g. Reputable Merchant)
        let resolvedCounterTargets = targets;
        if ((!resolvedCounterTargets || resolvedCounterTargets.length === 0) &&
            (effect.target === 'own_creature' || effect.target === 'creature' || effect.target === 'opponent_creature')) {
          const targetPid = effect.target === 'opponent_creature' ? opponent : controller;
          const bf2 = gameState.players[targetPid].zones.battlefield;
          const best = bf2.cards.filter((c: any) => Cards.isCreature(c) && Cards.canBeTargeted(c, controller))
            .sort((a: any, b: any) => (Cards.getPower(b) + Cards.getToughness(b)) - (Cards.getPower(a) + Cards.getToughness(a)))[0];
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
        const self = bf.get(card._uid);
        if (self) {
          if (!self._counters) self._counters = { '+1/+1': 0, '-1/-1': 0 };
          self._counters[effect.counter] = (self._counters[effect.counter] || 0) + effect.amount;
          // Finality counter: also set flag so creatureDies can exile instead of going to GY
          if (effect.counter === 'finality') self._finalityCounter = true;
          log.push(`${self.name} enters with ${effect.amount} ${effect.counter} counter(s).`);
        }
        break;
      }

      case 'add_mana': {
        // Add mana to caster's pool (e.g., Narset's Rebuke generates {U}{R}{W})
        if (effect.colors && Array.isArray(effect.colors)) {
          for (const c of effect.colors) {
            gameState.manaPool[controller][c] = (gameState.manaPool[controller][c] || 0) + 1;
          }
          log.push(`+{${effect.colors.join('}{')}} mana.`);
        } else if (effect.color) {
          const c = effect.color;
          gameState.manaPool[controller][c] = (gameState.manaPool[controller][c] || 0) + (effect.amount || 1);
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
        const targetPlayer = effect.target === 'opponent' ? opponent
          : effect.target === 'damaged_player' ? (gameState._lastDamagedPlayer ?? opponent)
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
            effectIndex: gameState._effectStack ? gameState._effectStack.length : 0
          };
          gameState.waitingForInput = { type: 'mandatory_discard', playerId: targetPlayer };
          log.push(isOptional
            ? `You may discard up to ${effect.amount || 1} card(s).`
            : `You must discard ${effect.amount || 1} card(s).`);
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
        if (targets && targets.length > 0) {
          // For multi-effect spells (e.g. Knockout Maneuver: counter own + fight opp),
          // targets may contain both own creature (targets[0]) and opp creature (targets[1]).
          // Find the opponent's creature target (first target belonging to opponent).
          const oppTarget = targets.find((t: any) => t.player !== undefined && t.player !== controller)
            ?? targets[targets.length - 1];
          const target = oppTarget;

          const myBf = gameState.players[controller].zones.battlefield;
          // Use own-side target if available (e.g. Knockout Maneuver: the buffed creature fights)
          const ownTarget = targets.find((t: any) => t.player === controller);
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
          const theirBf = gameState.players[target.player].zones.battlefield;
          const theirCreature = theirBf.get(target.uid);

          if (ourCreature && theirCreature) {
            const ourPower = Cards.getPower(ourCreature);
            const theirPower = Cards.getPower(theirCreature);

            theirCreature._damage += ourPower;
            ourCreature._damage += theirPower;

            if (Cards.hasKeyword(ourCreature, 'Deathtouch') && ourPower > 0) {
              theirCreature._damage = Cards.getToughness(theirCreature);
            }
            if (Cards.hasKeyword(theirCreature, 'Deathtouch') && theirPower > 0) {
              ourCreature._damage = Cards.getToughness(ourCreature);
            }

            log.push(`${ourCreature.name} fights ${theirCreature.name}.`);

            if (theirCreature._damage >= Cards.getToughness(theirCreature)) {
              GameState.creatureDies(gameState, theirCreature, target.player);
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

      case 'tap': {
        if (effect.target === 'all_opponent_creatures') {
          const tapCreatures = gameState.players[opponent].zones.battlefield.cards.filter(c => Cards.isCreature(c));
          tapCreatures.forEach(c => { c._tapped = true; });
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
            log.push(`${c.name} is tapped.`);
            GameState.fireTrigger(gameState, 'becomes_tapped', { cardUid: c._uid, card: c, controllerId: tapOpponent });
          }
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

      case 'prevent_damage': {
        // Store prevention shield on controller
        if (!gameState._damageShield) gameState._damageShield = {};
        gameState._damageShield[controller] = (gameState._damageShield[controller] || 0) + effect.amount;
        log.push(`Prevent the next ${effect.amount} damage.`);
        break;
      }

      case 'return_from_graveyard': {
        const gy = gameState.players[controller].zones.graveyard;
        const toHand = effect.to_hand !== false;
        const toTopLibrary = effect.to_top_library === true;
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
          // Kishla Trawlers: instant or sorcery card
          candidates = candidates.filter(c => {
            const types = (c.type_line || '').toLowerCase();
            return types.includes('instant') || types.includes('sorcery');
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
        }

        const amount = effect.amount || 1;

        // If optional and human player, show modal to choose
        if (optional && controller === 0 && candidates.length > 0) {
          gameState._pendingGYReturn = {
            effect, candidates, amount, toHand, toTopLibrary, controller
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
            GameState._registerCardTriggers(gameState, bfCard, controller);
            gameState._lastReturnedUIDs.push({ uid: bfCard._uid, player: controller });
            log.push(`${card.name} returns from graveyard to the battlefield!`);
          }
        }
        if (candidates.length === 0) {
          log.push('No valid card in graveyard.');
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
        break;
      }

      // Route all remaining effect types to stack-part2 handlers
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

export function _payWardCost(creature, controller, state, log) {
  const gameState = state;
  if (!Cards.hasKeyword(creature, 'Ward')) return true;

  const wardCostMatch = (creature.oracle_text || '').match(/ward[\s—]+\{?(\d+)\}?/i);
  if (!wardCostMatch) return true; // Ward without a cost — assume free

  const wardCost = parseInt(wardCostMatch[1]) || 0;
  if (wardCost === 0) return true;

  if (gameState.manaPool && gameState.manaPool[controller]) {
    const pool = gameState.manaPool[controller];
    const totalMana = Object.values(pool).reduce((sum, v) => sum + v, 0);
    if (totalMana >= wardCost) {
      // Pay from pool
      let remaining = wardCost;
      for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
        const paid = Math.min(pool[color] || 0, remaining);
        pool[color] = (pool[color] || 0) - paid;
        remaining -= paid;
        if (remaining === 0) break;
      }
      log.push(`Ward ${wardCost} paid.`);
      return true;
    }
  }

  // Cannot pay ward — spell is countered
  log.push(`Ward ${wardCost}: can't pay — spell is countered.`);
  return false;
}

// ---------------------------------------------------------------------------
// Helper: AI mode selection for modal spells
// ---------------------------------------------------------------------------

export function _aiChooseModes(modes, chooseCount, state, controller, opponent, targets) {
  const gameState = state;
  // Score each mode and pick the best N
  const _safeN = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const scored = modes.map((mode, idx) => {
    let score = 0;
    const effects = Array.isArray(mode) ? mode : [mode];
    for (const eff of effects) {
      switch (eff.type) {
        case 'damage': score += _safeN(eff.amount) * 2; break;
        case 'draw': score += _safeN(eff.amount) * 3; break;
        case 'gainLife': score += _safeN(eff.amount); break;
        case 'destroy': score += 8; break;
        case 'exile': score += 9; break;
        case 'counter': score += 7; break;
        case 'bounce': score += 5; break;
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
