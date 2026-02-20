// @ts-nocheck
// game-ai-part2.ts — Second half of AI module (lines 1501-2988 of legacy game-ai.js)

import * as Cards from './cards';
import * as Mana from './mana';
import * as Combat from './combat';
import * as CombatSim from './combat-sim';
import * as CardUtils from './card-utils';
import { CardEffectsDB } from './card-effects';
import * as GameState from './game-state';
import {
  _creatureValue,
  _evaluateBoard,
  _threatScore,
  _getAbilityManaCost,
} from './game-ai-part1';

// Legacy name aliases
const CardEngine = { ...Cards, ...CardUtils };
const ManaSystem = Mana;
const CombatSystem = Combat;

// =================== DECLARE ATTACKERS (continuation) ===================
// NOTE: This file contains the second half of the GameAI object methods.
// The first half (including _evaluateBoard, _creatureValue, _threatScore,
// _tryActivatedAbilities, _tryGraveyardAbilities, _tryHarmonize,
// _tryLoyaltyAbilities, _tryHideaway, _tryTransform, playMainPhase,
// declareAttackers up to line 1500) lives in game-ai-part1.ts.

// This file continues from the middle of declareAttackers logic at line 1501.
// The declareAttackers loop body (per-creature attack value calculation) ends here.

// =================== CONTINUE: declareAttackers finale ===================
// (Extracted from within the per-creature loop, lines 1501-1576)
// These helpers are used by declareAttackers and are exported for that reason.

// Continuation block inside declareAttackers — lines 1501-1576 are inlined there.
// The following are standalone exported/private functions from GameAI:

// =================== ORDER BLOCKERS ===================
// AI orders blockers for damage assignment (attacking player orders)
// Strategy: prioritize killing the most dangerous blocker first
export function orderBlockers(state, playerId) {
  const multiBlocked = CombatSystem.getMultiBlockedAttackers(state.combat);
  for (const attackerUid of multiBlocked) {
    const blockers = state.combat.blockers[attackerUid] || [];
    // Order: weakest toughness first (easier to kill), then highest power (most threatening)
    const ordered = [...blockers].sort((a, b) => {
      const aTough = CardEngine.getToughness(a.card) - a.card._damage;
      const bTough = CardEngine.getToughness(b.card) - b.card._damage;
      // Kill the one with less remaining toughness first
      if (aTough !== bTough) return aTough - bTough;
      // If same toughness, kill higher power first
      return CardEngine.getPower(b.card) - CardEngine.getPower(a.card);
    });
    CombatSystem.setBlockerOrder(state.combat, attackerUid, ordered.map(b => b.uid));
  }
}

// =================== DECLARE BLOCKERS ===================
export function declareBlockers(state, playerId) {
  const bf = state.players[playerId].zones.battlefield;
  const blockerCandidates = bf.cards.filter(c => CardEngine.isCreature(c) && !c._tapped);
  const attackers = state.combat.attackers;

  if (blockerCandidates.length === 0 || attackers.length === 0) return;

  const myLife = state.players[playerId].life;

  // Use CombatSim for optimal blocking if available
  if (typeof CombatSim !== 'undefined') {
    const attackerSnaps = attackers.map(a => CombatSim._snapshot(a.card, state));
    const blockerSnaps = blockerCandidates.map(b => CombatSim._snapshot(b, state));

    const best = CombatSim.findBestBlocking(attackerSnaps, blockerSnaps, myLife);

    // Apply the assignment
    for (const [aiStr, biArr] of Object.entries(best.assignment)) {
      const ai = parseInt(aiStr);
      const atk = attackers[ai];
      if (!atk) continue;
      for (const bi of biArr) {
        const blocker = blockerCandidates[bi];
        if (blocker) {
          CombatSystem.declareBlocker(state.combat, blocker, atk.uid, state);
        }
      }
    }
  } else {
    // Fallback: simple heuristic blocking (legacy)
    _legacyDeclareBlockers(state, playerId, blockerCandidates, attackers, myLife);
  }

  const blockCount = Object.values(state.combat.blockers).reduce((sum, b) => sum + b.length, 0);
  if (blockCount > 0) {
    state.log.push(`Voce bloqueia com ${blockCount} criatura(s).`);
  }
}

// =================== LEGACY DECLARE BLOCKERS ===================
// Legacy blocking logic (fallback if CombatSim not loaded)
function _legacyDeclareBlockers(state, playerId, blockerCandidates, attackers, myLife) {
  const totalIncomingDamage = attackers.reduce((sum, a) => sum + CardEngine.getPower(a.card), 0);
  const mustBlockLethal = totalIncomingDamage >= myLife;

  const sortedAttackers = [...attackers].sort((a, b) => {
    const aEvasion = CardEngine.hasKeyword(a.card, 'Flying') || CardEngine.hasKeyword(a.card, 'Trample') ? 1 : 0;
    const bEvasion = CardEngine.hasKeyword(b.card, 'Flying') || CardEngine.hasKeyword(b.card, 'Trample') ? 1 : 0;
    if (aEvasion !== bEvasion) return bEvasion - aEvasion;
    return CardEngine.getPower(b.card) - CardEngine.getPower(a.card);
  });

  const usedBlockers = new Set();
  const assignedAttackers = new Set();

  // PASS 1: Perfect blocks
  for (const atk of sortedAttackers) {
    const attacker = atk.card;
    let bestBlocker = null;
    let bestScore = -Infinity;

    for (const blocker of blockerCandidates) {
      if (usedBlockers.has(blocker._uid)) continue;
      if (!CardEngine.canBlock(blocker, attacker, state)) continue;
      const bPower = CardEngine.getPower(blocker);
      const bToughness = CardEngine.getToughness(blocker);
      const atkPower = CardEngine.getPower(attacker);
      const atkToughness = CardEngine.getToughness(attacker);
      const killsAttacker = bPower >= atkToughness || CardEngine.hasKeyword(blocker, 'Deathtouch');
      const blockerSurvives = bToughness > atkPower && !CardEngine.hasKeyword(attacker, 'Deathtouch');
      if ((killsAttacker && blockerSurvives) || (killsAttacker && CardEngine.hasIndestructible(blocker))) {
        const score = 100 + _creatureValue(attacker);
        if (score > bestScore) { bestScore = score; bestBlocker = blocker; }
      }
    }
    if (bestBlocker) {
      CombatSystem.declareBlocker(state.combat, bestBlocker, atk.uid, state);
      usedBlockers.add(bestBlocker._uid);
      assignedAttackers.add(atk.uid);
    }
  }

  // PASS 2: Favorable trades
  for (const atk of sortedAttackers) {
    if (assignedAttackers.has(atk.uid)) continue;
    const attacker = atk.card;
    let bestBlocker = null;
    let bestScore = -Infinity;

    for (const blocker of blockerCandidates) {
      if (usedBlockers.has(blocker._uid)) continue;
      if (!CardEngine.canBlock(blocker, attacker, state)) continue;
      const bPower = CardEngine.getPower(blocker);
      const atkToughness = CardEngine.getToughness(attacker);
      const killsAttacker = bPower >= atkToughness || CardEngine.hasKeyword(blocker, 'Deathtouch');
      if (killsAttacker) {
        const score = _creatureValue(attacker) - _creatureValue(blocker);
        if ((score >= 0 || mustBlockLethal) && score > bestScore) { bestScore = score; bestBlocker = blocker; }
      }
    }
    if (bestBlocker) {
      CombatSystem.declareBlocker(state.combat, bestBlocker, atk.uid, state);
      usedBlockers.add(bestBlocker._uid);
      assignedAttackers.add(atk.uid);
    }
  }

  // PASS 3: Chump blocks when lethal
  if (mustBlockLethal) {
    let unblockedDamage = 0;
    for (const atk of sortedAttackers) {
      if (assignedAttackers.has(atk.uid)) continue;
      unblockedDamage += CardEngine.getPower(atk.card);
    }
    if (unblockedDamage >= myLife) {
      const unblockedSorted = sortedAttackers
        .filter(a => !assignedAttackers.has(a.uid))
        .sort((a, b) => CardEngine.getPower(b.card) - CardEngine.getPower(a.card));
      const cheapest = blockerCandidates
        .filter(b => !usedBlockers.has(b._uid))
        .sort((a, b) => _creatureValue(a) - _creatureValue(b));
      for (const atk of unblockedSorted) {
        if (unblockedDamage < myLife) break;
        if (cheapest.length === 0) break;
        const blocker = cheapest.find(b => CardEngine.canBlock(b, atk.card, state));
        if (blocker) {
          CombatSystem.declareBlocker(state.combat, blocker, atk.uid, state);
          usedBlockers.add(blocker._uid);
          assignedAttackers.add(atk.uid);
          cheapest.splice(cheapest.indexOf(blocker), 1);
          unblockedDamage -= CardEngine.getPower(atk.card);
        }
      }
    }
  }
}

// =================== HAND EXILE PICK (used by stack) ===================
export function _pickBestCardToExileFromHand(state, playerId, cards) {
  // Pick the worst card (lowest keep score) to exile from hand
  if (!cards || cards.length === 0) return null;
  return cards.slice().sort((a, b) => _keepScore(a) - _keepScore(b))[0];
}

// =================== DISCARD ===================
export function discard(state, playerId, amount) {
  const hand = state.players[playerId].zones.hand;
  const cards = hand.getAll().sort((a, b) => {
    const scoreA = _keepScore(a);
    const scoreB = _keepScore(b);
    return scoreA - scoreB;
  });

  for (let i = 0; i < amount && cards.length > 0; i++) {
    const card = cards.shift();
    hand.remove(card._uid);
    state.players[playerId].zones.graveyard.add(card);
    state.log.push(`Oponente descarta ${card.name}.`);
  }
}

// =================== KEEP SCORE ===================
function _keepScore(card) {
  if (CardEngine.isLand(card)) return 0;
  let score = 5;
  if (CardEngine.isCreature(card)) score += 3;
  const effects = CardEngine.getSpellEffects(card);
  if (effects.some(e => e.type === 'destroy' || e.type === 'exile')) score += 5;
  if (effects.some(e => e.type === 'draw')) score += 2;
  if (effects.some(e => e.type === 'ramp')) score += 2;
  if (effects.some(e => e.type === 'destroy_all' || e.type === 'exile_all')) score += 6;
  if (effects.some(e => e.type === 'create_token')) score += 3;
  if (CardEngine.isAura(card)) score += 2;
  if (CardEngine.isEquipment(card)) score += 2;
  return score;
}

// =================== CHOOSE TARGETS ===================
export function _chooseTargets(state, playerId, card) {
  const effects = CardEngine.getSpellEffects(card);
  // Also consider ETB effects for permanent cards (so AI picks targets for ETB abilities)
  if (CardEngine.isPermanent(card)) {
    const etbEffects = CardEngine.getETBEffects(card);
    for (const etb of etbEffects) {
      if (!effects.some(e => e.type === etb.type && e.target === etb.target)) {
        effects.push(etb);
      }
    }
  }
  const targets = [];
  const opponentId = playerId === 0 ? 1 : 0;

  // Aura: target own best creature, preferring hexproof/evasive
  if (CardEngine.isAura(card)) {
    const myCreatures = state.players[playerId].zones.battlefield.cards
      .filter(c => CardEngine.isCreature(c))
      .sort((a, b) => {
        // Hexproof creatures are safest aura targets (can't be removed in response)
        const aHex = CardEngine.hasKeyword(a, 'Hexproof') ? 10 : 0;
        const bHex = CardEngine.hasKeyword(b, 'Hexproof') ? 10 : 0;
        if (aHex !== bHex) return bHex - aHex;
        // Indestructible also good
        const aInd = CardEngine.hasIndestructible(a) ? 5 : 0;
        const bInd = CardEngine.hasIndestructible(b) ? 5 : 0;
        if (aInd !== bInd) return bInd - aInd;
        // Evasion creatures get more value from buffs
        const aEva = (CardEngine.hasKeyword(a, 'Flying') ? 3 : 0) + (CardEngine.hasKeyword(a, 'Menace') ? 2 : 0) + (CardEngine.hasKeyword(a, 'Trample') ? 1 : 0);
        const bEva = (CardEngine.hasKeyword(b, 'Flying') ? 3 : 0) + (CardEngine.hasKeyword(b, 'Menace') ? 2 : 0) + (CardEngine.hasKeyword(b, 'Trample') ? 1 : 0);
        if (aEva !== bEva) return bEva - aEva;
        return CardEngine.getPower(b) - CardEngine.getPower(a);
      });
    if (myCreatures.length > 0) {
      targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
    }
    return targets;
  }

  for (const effect of effects) {
    switch (effect.type) {
      case 'counter_spell': {
        // Target the most threatening opponent spell on the stack
        const oppItems = state.stack.items.filter((item: any) => item.controller === opponentId);
        if (oppItems.length > 0) {
          const targetItem = oppItems[oppItems.length - 1];
          targets.push(targetItem.card); // handleCounterSpell expects the card object directly
        } else if (state._pendingCastOnStack && state._pendingCastOnStack.playerId === opponentId) {
          targets.push(state._pendingCastOnStack.card);
        }
        break;
      }

      case 'become_copy': {
        // Pick the best creature on the battlefield to copy (prefer opponent's threats)
        const allCreatures = [
          ...state.players[opponentId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId)),
          ...state.players[playerId].zones.battlefield.cards
            .filter((c: any) => CardEngine.isCreature(c) && c._uid !== card._uid),
        ];
        if (allCreatures.length > 0) {
          allCreatures.sort((a: any, b: any) => _threatScore(b) - _threatScore(a));
          const best = allCreatures[0];
          const owner = state.players[opponentId].zones.battlefield.cards.includes(best) ? opponentId : playerId;
          targets.push({ type: 'creature', player: owner, uid: best._uid });
        }
        break;
      }

      case 'mass_clone': {
        // Pick the best creature to use as the clone template
        const allBf = [
          ...state.players[opponentId].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c)),
          ...state.players[playerId].zones.battlefield.cards.filter((c: any) => CardEngine.isCreature(c) && c._uid !== card._uid),
        ];
        if (allBf.length > 0) {
          allBf.sort((a: any, b: any) => _threatScore(b) - _threatScore(a));
          const best = allBf[0];
          const owner = state.players[opponentId].zones.battlefield.cards.includes(best) ? opponentId : playerId;
          targets.push({ type: 'creature', player: owner, uid: best._uid });
        }
        break;
      }

      case 'threaten': {
        // Target best opponent creature to steal (prefer biggest power, not hexproof)
        const oppCreatures = state.players[opponentId].zones.battlefield.cards
          .filter((c: any) => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId));
        if (oppCreatures.length > 0) {
          oppCreatures.sort((a: any, b: any) => _threatScore(b) - _threatScore(a));
          targets.push({ type: 'creature', player: opponentId, uid: oppCreatures[0]._uid });
        }
        break;
      }

      case 'damage': {
        if (effect.target === 'attacking_or_blocking_creature') {
          // Only target creatures currently in combat
          const allBf = [...state.players[0].zones.battlefield.cards, ...state.players[1].zones.battlefield.cards];
          const combatCreatures = allBf
            .filter(c => CardEngine.isCreature(c) && (c._attacking || c._blocking) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          // Prefer opponent's creatures
          const opCombat = combatCreatures.filter(c => {
            const owner = state.players[opponentId].zones.battlefield.cards.includes(c) ? opponentId : playerId;
            return owner === opponentId;
          });
          const target = opCombat.length > 0 ? opCombat[0] : (combatCreatures.length > 0 ? combatCreatures[0] : null);
          if (target) {
            const pid = state.players[opponentId].zones.battlefield.cards.includes(target) ? opponentId : playerId;
            targets.push({ type: 'creature', player: pid, uid: target._uid });
          }
        } else if (effect.target === 'opponent_creature') {
          // Unsparing Boltcaster: damage to opponent creature with specific conditions
          let opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId));

          // Apply condition filter if specified
          if (effect.condition === 'dealt_damage_this_turn') {
            opCreatures = opCreatures.filter(c => c._damagedThisTurn);
          }

          if (opCreatures.length > 0) {
            // Sort by threat score, prefer non-ward
            opCreatures.sort((a, b) => {
              const aWard = CardEngine.hasWard(a) ? 1 : 0;
              const bWard = CardEngine.hasWard(b) ? 1 : 0;
              if (aWard !== bWard) return aWard - bWard;
              return _threatScore(b) - _threatScore(a);
            });
            targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
          }
        } else if (effect.target === 'creature' || effect.target === 'any target' || effect.target === 'creature or player' || effect.target === 'creature or planeswalker' || effect.target === 'creature_or_planeswalker') {
          const isCreatureOrPW = effect.target === 'creature or planeswalker' || effect.target === 'creature_or_planeswalker';
          // Filter for targetable (hexproof/shroud check), sort by threat score, prefer non-ward
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => {
              const aWard = CardEngine.hasWard(a) ? 1 : 0;
              const bWard = CardEngine.hasWard(b) ? 1 : 0;
              if (aWard !== bWard) return aWard - bWard;
              return _threatScore(b) - _threatScore(a);
            });

          const dmgAmount = effect.amount || 0;
          if (opCreatures.length > 0) {
            // Prefer killable targets: toughness - existing damage <= our damage
            const killable = opCreatures.filter(c =>
              CardEngine.getToughness(c) - (c._damage || 0) <= dmgAmount
            ).sort((a, b) => _threatScore(b) - _threatScore(a));

            if (killable.length > 0) {
              targets.push({ type: 'creature', player: opponentId, uid: killable[0]._uid });
            } else if (isCreatureOrPW) {
              // Check if we can kill a planeswalker instead
              const killablePWs = state.players[opponentId].zones.battlefield.cards
                .filter(c => CardEngine.isPlaneswalker(c) && CardEngine.canBeTargeted(c, playerId) && ((c as any)._loyalty || 0) <= dmgAmount)
                .sort((a, b) => ((a as any)._loyalty || 0) - ((b as any)._loyalty || 0));
              if (killablePWs.length > 0) {
                targets.push({ type: 'permanent', player: opponentId, uid: killablePWs[0]._uid });
              } else {
                // Chip damage on highest-threat creature
                targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
              }
            } else if (effect.target !== 'creature') {
              // Can't kill anything — go face if allowed and opponent is low enough for it to matter
              const oppLife = state.players[opponentId].life;
              if (oppLife <= dmgAmount * 4) {
                targets.push({ type: 'player', player: opponentId });
              } else {
                // Chip damage on highest-threat creature that we might kill later
                targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
              }
            } else {
              // creature-only target, pick highest threat even if we can't kill it
              targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
            }
          } else if (isCreatureOrPW) {
            // No creatures — target a planeswalker
            const oppPWs = state.players[opponentId].zones.battlefield.cards
              .filter(c => CardEngine.isPlaneswalker(c) && CardEngine.canBeTargeted(c, playerId))
              .sort((a, b) => _threatScore(b) - _threatScore(a));
            if (oppPWs.length > 0) {
              targets.push({ type: 'permanent', player: opponentId, uid: oppPWs[0]._uid });
            }
          } else if (effect.target !== 'creature') {
            targets.push({ type: 'player', player: opponentId });
          }
        } else if (effect.target === 'divided') {
          // Twin Bolt: "2 damage divided as you choose among one or two targets"
          const dmgAmount = effect.amount || 2;
          const maxTargets = effect.max_targets || 2;
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => _threatScore(b) - _threatScore(a));

          // AI strategy: Try to kill 1-2 creatures with the damage
          const killable = opCreatures.filter(c => CardEngine.getToughness(c) - (c._damage || 0) <= dmgAmount);
          if (killable.length >= 2) {
            // Can kill 2 - split damage
            targets.push({ type: 'creature', player: opponentId, uid: killable[0]._uid, dividedAmount: Math.min(dmgAmount, CardEngine.getToughness(killable[0]) - (killable[0]._damage || 0)) });
            targets.push({ type: 'creature', player: opponentId, uid: killable[1]._uid, dividedAmount: dmgAmount - targets[0].dividedAmount });
          } else if (killable.length === 1) {
            // Kill 1 creature with all damage
            targets.push({ type: 'creature', player: opponentId, uid: killable[0]._uid, dividedAmount: dmgAmount });
          } else if (opCreatures.length > 0) {
            // Can't kill anything - chip biggest threat
            targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid, dividedAmount: dmgAmount });
          } else {
            // No creatures - go face
            targets.push({ type: 'player', player: opponentId });
          }
        } else {
          targets.push({ type: 'player', player: opponentId });
        }
        break;
      }

      case 'destroy':
      case 'exile':
      case 'bounce': {
        // Check if targeting attacking/blocking creatures only
        const tgt = effect.target || '';
        if (tgt === 'attacking_or_blocking_creature') {
          const allBf = [...state.players[0].zones.battlefield.cards, ...state.players[1].zones.battlefield.cards];
          const combatCreatures = allBf
            .filter(c => CardEngine.isCreature(c) && (c._attacking || c._blocking) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          const opCombat = combatCreatures.filter(c => state.players[opponentId].zones.battlefield.cards.includes(c));
          const target = opCombat.length > 0 ? opCombat[0] : (combatCreatures.length > 0 ? combatCreatures[0] : null);
          if (target) {
            const pid = state.players[opponentId].zones.battlefield.cards.includes(target) ? opponentId : playerId;
            if (effect.type !== 'destroy' || !CardEngine.hasIndestructible(target)) {
              targets.push({ type: 'creature', player: pid, uid: target._uid });
            }
          }
          break;
        }
        if (tgt === 'enchantment' || tgt === 'artifact' || tgt === 'artifact_or_enchantment') {
          const opNonCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => {
              if (!CardEngine.canBeTargeted(c, playerId)) return false;
              if (tgt === 'enchantment') return CardEngine.isEnchantment(c);
              if (tgt === 'artifact') return CardEngine.isArtifact(c);
              return CardEngine.isEnchantment(c) || CardEngine.isArtifact(c);
            })
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          if (opNonCreatures.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: opNonCreatures[0]._uid });
          }
          break;
        }
        if (tgt === 'noncreature_permanent' || tgt === 'nonland_permanent') {
          const opPermanents = state.players[opponentId].zones.battlefield.cards
            .filter(c => {
              if (!CardEngine.canBeTargeted(c, playerId)) return false;
              if (tgt === 'noncreature_permanent') return !CardEngine.isCreature(c) && !CardEngine.isLand(c);
              if (tgt === 'nonland_permanent') return !CardEngine.isLand(c);
              return false;
            })
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          if (opPermanents.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: opPermanents[0]._uid });
          }
          break;
        }
        if (tgt === 'colored_permanent') {
          // Ugin, Eye of the Storms: "permanent that's one or more colors"
          const oppColoredPerms = state.players[opponentId].zones.battlefield.cards
            .filter(c => {
              if (!CardEngine.canBeTargeted(c, playerId)) return false;
              const colors = c.colors || c.color_identity || [];
              return colors.length > 0; // Has at least one color
            })
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          if (oppColoredPerms.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: oppColoredPerms[0]._uid });
          }
          break;
        }
        if (tgt === 'spell_or_permanent') {
          // Jeskai Revelation: "Return target spell or permanent to its owner's hand"
          // Prioritize spells on stack, then opponent permanents
          if (state.stack.items.length > 0) {
            // Target most recent opponent spell on stack
            const oppSpells = state.stack.items.filter(item => item.controller === opponentId);
            if (oppSpells.length > 0) {
              const targetSpell = oppSpells[oppSpells.length - 1];
              targets.push({ type: 'spell', stackIndex: state.stack.items.indexOf(targetSpell) });
              break;
            }
          }
          // No spells - target opponent permanent
          const oppPerms = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => _threatScore(b) - _threatScore(a));
          if (oppPerms.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: oppPerms[0]._uid });
          }
          break;
        }
        if (tgt === 'creatures_and_planeswalkers') {
          // Dragonback Assault: "deals 3 damage to each creature and each planeswalker"
          // This is a mass effect - no targeting needed, handled by stack.js
          break;
        }
        if (tgt === 'creature_or_planeswalker' || tgt === 'creature or planeswalker') {
          const opTargets = state.players[opponentId].zones.battlefield.cards
            .filter(c => (CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c)) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => {
              const aWard = CardEngine.hasWard(a) ? 1 : 0;
              const bWard = CardEngine.hasWard(b) ? 1 : 0;
              if (aWard !== bWard) return aWard - bWard;
              return _threatScore(b) - _threatScore(a);
            });
          if (effect.type === 'destroy') {
            const killable = opTargets.filter(c => !CardEngine.hasIndestructible(c));
            if (killable.length > 0) {
              const t = killable[0];
              targets.push({ type: CardEngine.isCreature(t) ? 'creature' : 'permanent', player: opponentId, uid: t._uid });
            }
          } else if (opTargets.length > 0) {
            const t = opTargets[0];
            targets.push({ type: CardEngine.isCreature(t) ? 'creature' : 'permanent', player: opponentId, uid: t._uid });
          }
          break;
        }
        // Filter opponent creatures
        let opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId));

        // Apply keyword filter if specified (e.g., creature_with_flying)
        if (tgt === 'creature_with_flying') {
          opCreatures = opCreatures.filter(c => CardEngine.hasKeyword(c, 'Flying'));
        } else if (tgt === 'creature_without_flying') {
          opCreatures = opCreatures.filter(c => !CardEngine.hasKeyword(c, 'Flying'));
        } else if (tgt === 'dragons') {
          opCreatures = opCreatures.filter(c => CardEngine.hasCreatureType(c, 'Dragon'));
        } else if (tgt === 'creature_power2_or_less') {
          // Smile at Death: "creature cards with power 2 or less"
          opCreatures = opCreatures.filter(c => CardEngine.getPower(c) <= 2);
        } else if (tgt === 'creature_power_3_or_less') {
          // Petty Revenge (Disruptive Stormbrood): "creature with power 3 or less"
          opCreatures = opCreatures.filter(c => CardEngine.getPower(c) <= 3);
        }

        // Sort by threat score
        opCreatures.sort((a, b) => {
          const aWard = CardEngine.hasWard(a) ? 1 : 0;
          const bWard = CardEngine.hasWard(b) ? 1 : 0;
          if (aWard !== bWard) return aWard - bWard;
          return _threatScore(b) - _threatScore(a);
        });

        // For destroy, also skip indestructible
        if (effect.type === 'destroy') {
          const killable = opCreatures.filter(c => !CardEngine.hasIndestructible(c));
          if (killable.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: killable[0]._uid });
          }
        } else if (opCreatures.length > 0) {
          targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
        }
        break;
      }

      case 'buff':
      case 'multi_buff_up_to': {
        if (effect.target === 'other_own_creature') {
          // "another target creature you control"
          const myOtherCreatures = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && c._uid !== card._uid)
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (myOtherCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: myOtherCreatures[0]._uid });
          }
        } else if (effect.target === 'creature' || effect.target === 'own_creature') {
          const myCreatures = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));

          if (effect.type === 'multi_buff_up_to') {
            // Rally the Monastery: "Up to two target creatures you control each get +2/+2"
            const maxTargets = effect.max_targets || 2;
            for (let i = 0; i < Math.min(maxTargets, myCreatures.length); i++) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[i]._uid });
            }
          } else {
            // Single target buff
            if (myCreatures.length > 0) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
            }
          }
        }
        break;
      }

      case 'counter': {
        if (effect.counter === '+1/+1') {
          if (effect.target === 'other_own_creature') {
            // Loxodon Battle Priest: "another target creature you control"
            const myOtherCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && c._uid !== card._uid)
              .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            if (myOtherCreatures.length > 0) {
              targets.push({ type: 'creature', player: playerId, uid: myOtherCreatures[0]._uid });
            }
          } else if (effect.target === 'distribute_creatures') {
            // Armament Dragon: "distribute three +1/+1 counters among one, two, or three target creatures you control"
            const myCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c))
              .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            // AI: Put all counters on best creature (simplest strategy)
            if (myCreatures.length > 0) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid, amount: effect.amount || 3 });
            }
          } else if (effect.target === 'own_creature' || effect.target === 'own_nonlegendary_creature' || !effect.target || effect.target === 'creature') {
            const nonLegOnly = effect.target === 'own_nonlegendary_creature';
            const myCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && (!nonLegOnly || !CardEngine.isLegendary(c)))
              .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            // For optional targeting, AI can choose not to target if no good options
            if (myCreatures.length > 0 && (!effect.optional || myCreatures.length > 0)) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
            }
          } else if (effect.target === 'creature' && !effect.target.includes('own')) {
            const allCreatures = [
              ...state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)),
              ...state.players[opponentId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            ].sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            if (allCreatures.length > 0) {
              targets.push({ type: 'creature', player: allCreatures[0]._controller, uid: allCreatures[0]._uid });
            }
          }
        } else if (effect.counter === '-1/-1') {
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (opCreatures.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
          }
        }
        break;
      }

      case 'fight': {
        const myCreatures = state.players[playerId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        const opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));

        if (opCreatures.length > 0 && myCreatures.length > 0) {
          const bestPower = CardEngine.getPower(myCreatures[0]);
          const killable = opCreatures.find(c =>
            CardEngine.getToughness(c) <= bestPower
          );
          const target = killable || opCreatures[opCreatures.length - 1];
          targets.push({ type: 'creature', player: opponentId, uid: target._uid });
        }
        break;
      }

      case 'debuff': {
        if (effect.target === 'creature' || effect.target === 'opponent_creature') {
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => {
              const aWard = CardEngine.hasWard(a) ? 1 : 0;
              const bWard = CardEngine.hasWard(b) ? 1 : 0;
              if (aWard !== bWard) return aWard - bWard;
              return CardEngine.getPower(b) - CardEngine.getPower(a);
            });
          if (opCreatures.length > 0) {
            // Prefer creatures that would die from the debuff
            const killable = opCreatures.find(c =>
              CardEngine.getToughness(c) + (effect.toughness || 0) <= 0
            );
            const target = killable || opCreatures[0];
            targets.push({ type: 'creature', player: opponentId, uid: target._uid });
          }
        }
        break;
      }

      case 'tap': {
        // Dirgur Island Dragon: "Tap up to one target creature" (any creature)
        if (effect.target === 'creature' || effect.target === 'opponent_creature') {
          const targetOpp = effect.target === 'opponent_creature';

          // Prioritize opponent's untapped creatures (especially blockers and big attackers)
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && !c._tapped && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => {
              // Prioritize creatures that could block (high toughness) or attack (high power)
              const aScore = _threatScore(a);
              const bScore = _threatScore(b);
              return bScore - aScore;
            });

          if (opCreatures.length > 0) {
            // Check if it's worth tapping (only tap threats, not weak creatures)
            const bestTarget = opCreatures[0];
            const shouldTap = !effect.optional || CardEngine.getPower(bestTarget) >= 2;

            if (shouldTap) {
              targets.push({ type: 'creature', player: opponentId, uid: bestTarget._uid });
            }
          } else if (!targetOpp && !effect.optional) {
            // If no opponent creatures and targeting is mandatory, can target own creature
            const myCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && !c._tapped)
              .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b)); // Weakest first
            if (myCreatures.length > 0) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
            }
          }
        }
        break;
      }

      case 'untap': {
        const myCreatures = state.players[playerId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && c._tapped)
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (myCreatures.length > 0) {
          targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
        }
        break;
      }

      case 'grant':
      case 'grant_counter':
      case 'grant_counters':
      case 'regenerate': {
        // Target own best creature (or another creature if specified)
        if (effect.target === 'other_own_creature') {
          const myOtherCreatures = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && c._uid !== card._uid)
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (myOtherCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: myOtherCreatures[0]._uid });
          }
        } else {
          const myCreatures = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (myCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
          }
        }
        break;
      }

      case 'bounce_to_library_top': {
        const opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (opCreatures.length > 0) {
          targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
        }
        break;
      }

      case 'gain_control': {
        const opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (opCreatures.length > 0) {
          targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
        }
        break;
      }

      case 'create_token_copy':
      case 'clone': {
        // Copy best own creature (or opponent if target says "any")
        const myCreatures = state.players[playerId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (myCreatures.length > 0) {
          targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
        } else {
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (opCreatures.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
          }
        }
        break;
      }

      case 'return_from_graveyard':
      case 'grant_harmonize': {
        // Kishla Trawlers, Songcrafter Mage: target instant or sorcery in graveyard
        if (effect.target === 'instant_or_sorcery') {
          const gy = state.players[playerId].zones.graveyard.getAll();
          const instSorc = gy.filter(c => {
            const tl = (c.type_line || '').toLowerCase();
            return tl.includes('instant') || tl.includes('sorcery');
          }).sort((a, b) => (b.cmc || 0) - (a.cmc || 0)); // Prefer higher CMC

          if (instSorc.length > 0) {
            targets.push({ type: 'graveyard_card', player: playerId, uid: instSorc[0]._uid });
          }
        }
        break;
      }

      case 'damage_divided': {
        // Ureni: "X damage divided among any number of target creatures and/or planeswalkers"
        // Get total damage amount (X = lands count for Ureni)
        const totalDamage = typeof effect.amount === 'string'
          ? (effect.amount === 'lands_count'
              ? state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isLand(c)).length
              : 0)
          : (effect.amount || 0);

        if (totalDamage === 0) break;

        // Get all opponent creatures and planeswalkers
        const oppTargets = state.players[opponentId].zones.battlefield.cards
          .filter(c => {
            if (!CardEngine.canBeTargeted(c, playerId)) return false;
            return CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c);
          })
          .sort((a, b) => _threatScore(b) - _threatScore(a));

        if (oppTargets.length === 0) break;

        // AI strategy: Try to kill as many targets as possible
        let remainingDamage = totalDamage;
        for (const target of oppTargets) {
          if (remainingDamage <= 0) break;
          const toughness = CardEngine.isCreature(target)
            ? CardEngine.getToughness(target) - (target._damage || 0)
            : (target._loyalty || 0);
          const damageNeeded = Math.min(toughness, remainingDamage);
          if (damageNeeded > 0) {
            const pid = state.players[opponentId].zones.battlefield.cards.includes(target) ? opponentId : playerId;
            targets.push({ type: 'creature', player: pid, uid: target._uid });
            remainingDamage -= damageNeeded;
          }
        }
        break;
      }

      case 'move_counters': {
        // Target own creature to move counters to
        const myCreatures = state.players[playerId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (myCreatures.length > 0) {
          targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
        }
        break;
      }

      case 'remove_counters': {
        const opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && c._counters && (c._counters['+1/+1'] > 0))
          .sort((a, b) => (b._counters['+1/+1'] || 0) - (a._counters['+1/+1'] || 0));
        if (opCreatures.length > 0) {
          targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
        }
        break;
      }

      case 'stun': {
        const opCreatures = state.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
          .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        if (opCreatures.length > 0) {
          targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
        }
        break;
      }

      default:
        break;
    }
  }

  return targets;
}

// =================== AI INSTANT PRIORITY ===================
// Called during combat_begin, combat_damage, end_step when AI is non-active player
export function playInstantPhase(state, playerId, phase) {
  const playable = GameState.getPlayableCards(state, playerId)
    .filter(c => {
      const tl = (c.type_line || '').toLowerCase();
      return tl.includes('instant') || CardEngine.hasKeyword(c, 'Flash');
    });

  if (playable.length === 0) return;

  const opponentId = playerId === 0 ? 1 : 0;
  const myBf = state.players[playerId].zones.battlefield;
  const oppBf = state.players[opponentId].zones.battlefield;
  const myCreatures = myBf.cards.filter(c => CardEngine.isCreature(c));
  const oppCreatures = oppBf.cards.filter(c => CardEngine.isCreature(c));

  // Score and try to cast the best instant
  const scored = playable.map(card => {
    const score = _scoreInstant(card, state, playerId, phase, myCreatures, oppCreatures);
    return { card, score };
  }).sort((a, b) => b.score - a.score);

  for (const { card, score } of scored) {
    if (score <= 5) break; // Threshold: not worth casting

    // Calcular CMC reduzido para instants
    const { cmc: instantReducedCmc } = GameState.getEffectiveCmcWithReduction(state, playerId, card);
    if (!ManaSystem.canAfford(state, playerId, card, null, instantReducedCmc)) continue;

    GameState.autoTapForSpell(state, playerId, card.mana_cost, instantReducedCmc, card);
    const targets = _chooseTargets(state, playerId, card);

    // Fire creature_targeted_by_opponent trigger for each target
    if (targets && targets.length > 0) {
      for (const target of targets) {
        if (target.player === 0) { // Targeting opponent's creatures
          GameState.fireTrigger(state, 'creature_targeted_by_opponent', { playerId: 0 });
        }
      }
    }

    const result = GameState.castSpell(state, playerId, card._uid, targets);
    if (result.success) {
      if (!state._aiActions) state._aiActions = [];
      let targetDesc = '';
      if (targets && targets.length > 0) {
        const tgt = targets[0];
        const tgtCard = state.players[tgt.player].zones.battlefield.get(tgt.uid);
        if (tgtCard) targetDesc = ` em ${tgtCard.name}`;
      }
      state._aiActions.push({
        type: 'cast',
        card: { name: card.name, image_normal: card.image_normal, image_small: card.image_small, type_line: card.type_line, mana_cost: card.mana_cost },
        description: `Oponente joga ${card.name}${targetDesc} (instant)`,
        targetDesc
      });
      break; // One instant per priority window
    }
  }

  // Also try activated abilities during combat priority
  _tryActivatedAbilitiesInCombat(state, playerId, phase);
}

// =================== ACTIVATED ABILITIES IN COMBAT ===================
// Try activated abilities during combat priority windows
function _tryActivatedAbilitiesInCombat(state, playerId, phase) {
  // Clarion Conqueror: if activated abilities of creatures/artifacts/planeswalkers are globally locked, skip
  const globallyLocked = state.players.some((p: any) =>
    p.zones.battlefield.cards.some((c: any) => c._preventActivatedAbilities)
  );
  if (globallyLocked) return;

  const bf = state.players[playerId].zones.battlefield;
  const opponentId = playerId === 0 ? 1 : 0;
  const oppCreatures = state.players[opponentId].zones.battlefield.cards
    .filter(c => CardEngine.isCreature(c));

  for (const card of bf.cards) {
    const abilities = CardEngine.getActivatedAbilities(card);
    if (abilities.length === 0) continue;

    for (const ability of abilities) {
      if (ability.cost.tap && card._tapped) continue;
      if (ability.cost.once_per_turn) {
        if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
        const key = card._uid + '_' + JSON.stringify(ability.effects.map(e => e.type));
        if (state._abilityUsedThisTurn[key]) continue;
      }

      const { manaCost, cmc } = _getAbilityManaCost(ability);
      if (cmc > 0) {
        const fakeCard = { mana_cost: manaCost, cmc };
        if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;
      }

      // Only use combat-relevant abilities
      let useful = false;
      for (const eff of ability.effects) {
        if (eff.type === 'damage' && oppCreatures.length > 0) useful = true;
        if (eff.type === 'tap_target' && (phase === 'combat_begin' || phase === 'post_attackers')) useful = true;
        if (eff.type === 'buff_self' && (phase === 'post_blockers' || phase === 'combat_damage')) useful = true;
        if (eff.type === 'regenerate' && (phase === 'post_blockers' || phase === 'combat_damage')) useful = true;
        if (eff.type === 'grant' && (phase === 'post_blockers' || phase === 'combat_damage')) useful = true;
      }
      if (!useful) continue;

      // Pay costs and activate
      if (cmc > 0) {
        GameState.autoTapForSpell(state, playerId, manaCost, cmc);
        state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
      }
      if (ability.cost.tap) card._tapped = true;

      // Track once_per_turn
      if (ability.cost.once_per_turn) {
        if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
        const key = card._uid + '_' + JSON.stringify(ability.effects.map(e => e.type));
        state._abilityUsedThisTurn[key] = true;
      }

      // Resolve effects
      for (const eff of ability.effects) {
        const logs = GameState._resolveSimpleEffect(state, playerId, eff, { cardUid: card._uid, card });
        if (logs) state.log.push(logs);
      }
      state.log.push(`Oponente ativa habilidade de ${card.name}.`);
      return; // One ability per priority window
    }
  }
}

// =================== SCORE INSTANT ===================
function _scoreInstant(card, state, playerId, phase, myCreatures, oppCreatures) {
  const effects = CardEngine.getSpellEffects(card);
  const opponentId = playerId === 0 ? 1 : 0;
  let score = 0;

  const hasRemoval = effects.some(e => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage');
  const hasBuff = effects.some(e => e.type === 'buff');
  const hasDraw = effects.some(e => e.type === 'draw');
  const hasTap = effects.some(e => e.type === 'tap');
  const hasBounce = effects.some(e => e.type === 'bounce');
  const hasScry = effects.some(e => e.type === 'scry' || e.type === 'surveil');
  const hasToken = effects.some(e => e.type === 'create_token');
  const myHandSize = state.players[playerId].zones.hand.count();

  if (phase === 'combat_begin') {
    // Before attackers declared — tap threats or remove them
    if (hasTap) {
      const untappedThreats = oppCreatures.filter(c => !c._tapped);
      if (untappedThreats.length > 0) {
        const biggestThreat = Math.max(...untappedThreats.map(c => _threatScore(c)), 0);
        score += 4 + biggestThreat * 0.5;
      }
    }
    if (hasRemoval && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 4 + biggestThreat * 0.5;
    }
    if (hasBounce && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 3 + biggestThreat * 0.4;
    }
  }

  if (phase === 'post_attackers') {
    // After attackers declared, before blockers
    const combat = state.combat;
    const amDefender = combat && state.activePlayer !== playerId;

    if (amDefender) {
      // Defender: tap/remove/bounce attackers to reduce incoming damage
      if (hasTap && combat && combat.attackers.length > 0) {
        // Tap biggest attacker to prevent it from dealing damage
        const biggestAtk = Math.max(...combat.attackers.map(a => CardEngine.getPower(a.card)), 0);
        score += 8 + biggestAtk;
      }
      if (hasRemoval && combat && combat.attackers.length > 0) {
        const biggestAtk = Math.max(...combat.attackers.map(a => _threatScore(a.card)), 0);
        score += 8 + biggestAtk;
      }
      if (hasBounce && combat && combat.attackers.length > 0) {
        const biggestAtk = Math.max(...combat.attackers.map(a => _threatScore(a.card)), 0);
        score += 7 + biggestAtk * 0.8;
      }
    } else {
      // Attacker: buff before blockers declared (less common, keep low score)
      if (hasBuff) score += 3;
    }
  }

  if (phase === 'post_blockers') {
    // After blockers declared, before damage — combat tricks are most impactful here
    const combat = state.combat;
    if (hasBuff && combat) {
      if (_shouldUseCombatTrick(state, playerId, card, combat)) {
        const myBf = state.players[playerId].zones.battlefield;
        let bestCreatureVal = 0;
        for (const atk of (combat.attackers || [])) {
          if (atk.card && myBf.get(atk.card._uid)) {
            const blockers = combat.blockers[atk.uid] || [];
            if (blockers.length > 0) {
              bestCreatureVal = Math.max(bestCreatureVal, _creatureValue(atk.card));
            }
          }
        }
        for (const [, blockerArr] of Object.entries(combat.blockers || {})) {
          for (const b of blockerArr) {
            if (b.card && myBf.get(b.card._uid)) {
              bestCreatureVal = Math.max(bestCreatureVal, _creatureValue(b.card));
            }
          }
        }
        score += 12 + bestCreatureVal; // Combat tricks are best here
      }
    }
    if (hasRemoval && combat && combat.attackers.length > 0) {
      // Remove an attacker after blockers to save your blocker
      const amDefending = state.activePlayer !== playerId;
      if (amDefending) {
        const biggestAtk = Math.max(...combat.attackers.map(a => CardEngine.getPower(a.card)), 0);
        score += 7 + biggestAtk;
      } else {
        // Attacker: remove a blocker to push damage through
        let maxBlockerThreat = 0;
        for (const [, blockerArr] of Object.entries(combat.blockers || {})) {
          for (const b of blockerArr) {
            maxBlockerThreat = Math.max(maxBlockerThreat, _threatScore(b.card));
          }
        }
        if (maxBlockerThreat > 0) score += 6 + maxBlockerThreat;
      }
    }
  }

  if (phase === 'combat_damage') {
    const combat = state.combat;
    if (hasBuff && combat) {
      // Use simulation to verify trick actually changes outcome
      if (_shouldUseCombatTrick(state, playerId, card, combat)) {
        // Find the creature the trick would save/upgrade
        const myBf = state.players[playerId].zones.battlefield;
        let bestCreatureVal = 0;
        for (const atk of (combat.attackers || [])) {
          if (atk.card && myBf.get(atk.card._uid)) {
            const blockers = combat.blockers[atk.uid] || [];
            if (blockers.length > 0) {
              bestCreatureVal = Math.max(bestCreatureVal, _creatureValue(atk.card));
            }
          }
        }
        for (const [, blockerArr] of Object.entries(combat.blockers || {})) {
          for (const b of blockerArr) {
            if (b.card && myBf.get(b.card._uid)) {
              bestCreatureVal = Math.max(bestCreatureVal, _creatureValue(b.card));
            }
          }
        }
        score += 10 + bestCreatureVal; // Only buff when it matters
      }
      // else: trick doesn't change outcome, don't waste it
    }
    if (hasRemoval && combat && combat.attackers.length > 0) {
      const unblocked = combat.attackers.filter(a => {
        const blockers = combat.blockers[a.uid] || [];
        return blockers.length === 0;
      });
      if (unblocked.length > 0) {
        const biggestUnblocked = Math.max(...unblocked.map(a => CardEngine.getPower(a.card)), 0);
        score += 6 + (biggestUnblocked * 2); // Unblocked removal is critical
      } else {
        score += 3; // All blocked, less urgent
      }
    }
  }

  if (phase === 'upkeep') {
    // Opponent's upkeep — bounce before they draw, tap before they can use mana
    if (hasBounce && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 5 + biggestThreat * 0.5;
    }
    if (hasTap && oppCreatures.length > 0) {
      const untappedThreats = oppCreatures.filter(c => !c._tapped);
      if (untappedThreats.length > 0) {
        const biggestThreat = Math.max(...untappedThreats.map(c => _threatScore(c)), 0);
        score += 4 + biggestThreat * 0.4;
      }
    }
    if (hasRemoval && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 4 + biggestThreat * 0.5;
    }
  }

  if (phase === 'end_step') {
    // End of opponent's turn — use remaining mana efficiently
    if (hasDraw) {
      if (myHandSize <= 1) score += 12; // Desperate for cards
      else if (myHandSize <= 3) score += 9;
      else score += 6;
    }
    if (hasScry) {
      if (myHandSize <= 2) score += 7;
      else score += 5;
    }
    if (hasToken) score += 7;
    if (hasRemoval && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 3 + biggestThreat * 0.4;
    }
    if (hasBounce && oppCreatures.length > 0) {
      const biggestThreat = Math.max(...oppCreatures.map(c => _threatScore(c)), 0);
      score += 3 + biggestThreat * 0.3;
    }
    if (hasTap) score += 3;
  }

  return score;
}

// =================== COLOR NEEDS ===================
function _getColorNeeds(handCards) {
  const needs = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  handCards.forEach(card => {
    if (CardEngine.isLand(card)) return;
    const cost = ManaSystem.parseCost(card.mana_cost);
    Object.entries(cost.colored).forEach(([c, n]) => {
      if (needs[c] !== undefined) needs[c] += n;
    });
  });
  return needs;
}

// =================== STATE CLONING FOR SIMULATION ===================
// Lightweight clone: only copies data needed for evaluation, not triggers/VFX/UI
export function _cloneStateForSim(state) {
  const clone = {
    players: [{}, {}],
    phase: state.phase,
    activePlayer: state.activePlayer,
    turn: state.turn,
    landPlayedThisTurn: state.landPlayedThisTurn,
    manaPool: [{ ...state.manaPool[0] }, { ...state.manaPool[1] }],
    _spellsThisTurn: state._spellsThisTurn ? [...state._spellsThisTurn] : [0, 0],
    log: []
  };

  for (let pid = 0; pid < 2; pid++) {
    const p = state.players[pid];
    clone.players[pid] = {
      id: pid,
      life: p.life,
      zones: {
        hand: _cloneZone(p.zones.hand),
        battlefield: _cloneZone(p.zones.battlefield),
        // Minimal zones — not deeply cloned
        graveyard: { count: () => p.zones.graveyard.count(), getAll: () => [] },
        library: { count: () => p.zones.library.count() },
        exile: { count: () => p.zones.exile ? p.zones.exile.count() : 0 }
      }
    };
  }

  return clone;
}

// Clone a zone's cards as lightweight snapshots
function _cloneZone(zone) {
  const cards = zone.getAll ? zone.getAll().map(c => _cloneCard(c)) : [];
  return {
    cards: cards,
    count() { return this.cards.length; },
    getAll() { return this.cards; },
    get(uid) { return this.cards.find(c => c._uid === uid) || null; },
    add(card) { this.cards.push(card); },
    remove(uid) {
      const idx = this.cards.findIndex(c => c._uid === uid);
      if (idx >= 0) return this.cards.splice(idx, 1)[0];
      return null;
    }
  };
}

// Shallow clone a card with key properties
function _cloneCard(card) {
  return {
    _uid: card._uid,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    power: card.power,
    toughness: card.toughness,
    _powerMod: card._powerMod || 0,
    _toughnessMod: card._toughnessMod || 0,
    _tempPowerMod: card._tempPowerMod || 0,
    _tempToughnessMod: card._tempToughnessMod || 0,
    _damage: card._damage || 0,
    _tapped: card._tapped || false,
    _summoningSick: card._summoningSick || false,
    _isToken: card._isToken || false,
    _counters: card._counters ? { ...card._counters } : undefined,
    _keywords: card._keywords ? [...card._keywords] : undefined,
    _tempKeywords: card._tempKeywords ? [...card._tempKeywords] : undefined,
    _attachments: card._attachments ? [...card._attachments] : undefined,
    _attachedTo: card._attachedTo,
    _triggers: card._triggers,
    image_normal: card.image_normal,
    image_small: card.image_small,
    colors: card.colors,
    color_identity: card.color_identity
  };
}

// Evaluate a simulated board state score (simplified for speed)
function _quickEvalBoard(simState, playerId) {
  const oppId = playerId === 0 ? 1 : 0;
  const myLife = simState.players[playerId].life;
  const oppLife = simState.players[oppId].life;
  const myBf = simState.players[playerId].zones.battlefield;
  const oppBf = simState.players[oppId].zones.battlefield;
  const myCreatures = myBf.cards.filter(c => CardEngine.isCreature(c));
  const oppCreatures = oppBf.cards.filter(c => CardEngine.isCreature(c));

  let score = 0;
  score += (myLife - oppLife) * 0.5;
  const myPower = myCreatures.reduce((s, c) => s + CardEngine.getPower(c), 0);
  const oppPower = oppCreatures.reduce((s, c) => s + CardEngine.getPower(c), 0);
  score += (myPower - oppPower) * 2;
  score += (myCreatures.length - oppCreatures.length) * 3;
  const myHand = simState.players[playerId].zones.hand.count();
  score += myHand * 1.5;

  return score;
}

// =================== SPELL SEQUENCING OPTIMIZATION ===================
// Try top N playable cards, simulate each, pick best sequence
export function _findBestSpellOrder(state, playerId) {
  const playable = GameState.getPlayableCards(state, playerId)
    .filter(c => !CardEngine.isLand(c));

  if (playable.length <= 1) return null; // No sequencing needed

  // Only evaluate top 4 candidates (sorted by current heuristic score)
  const opponentId = playerId === 0 ? 1 : 0;
  const bf = state.players[playerId].zones.battlefield;
  const landCount = bf.cards.filter(c => CardEngine.isLand(c)).length;
  const opponentCreatures = state.players[opponentId].zones.battlefield.cards
    .filter(c => CardEngine.isCreature(c));
  const myCreatures = bf.cards.filter(c => CardEngine.isCreature(c));

  // Quick score for ordering
  const quickScored = playable.map(card => {
    let s = card.cmc || 0;
    const effects = CardEngine.getSpellEffects(card);
    if (effects.some(e => e.type === 'ramp')) s += 10;
    if (effects.some(e => e.type === 'destroy' || e.type === 'exile')) s += 8;
    if (CardEngine.isCreature(card)) s += 6;
    if (effects.some(e => e.type === 'draw')) s += 4;
    const tl = (card.type_line || '').toLowerCase();
    if (tl.includes('instant') && effects.some(e => e.type === 'buff')) s -= 15;
    return { card, score: s };
  }).sort((a, b) => b.score - a.score);

  const candidates = quickScored.slice(0, 4).map(s => s.card);

  // Evaluate: "what if I cast card X first?"
  let bestCard = null;
  let bestEval = -Infinity;

  const baseEval = _evaluateBoard(state, playerId);

  for (const card of candidates) {
    // Check affordability
    if (!ManaSystem.canAfford(state, playerId, card)) continue;

    // Simulate casting this card
    const simState = _cloneStateForSim(state);
    const simBf = simState.players[playerId].zones.battlefield;

    // Add creature/permanent to battlefield or resolve spell effects
    if (CardEngine.isCreature(card) || CardEngine.isPermanent(card)) {
      // Simulate: remove from hand, add to battlefield
      simState.players[playerId].zones.hand.remove(card._uid);
      const clonedCard = _cloneCard(card);
      simBf.add(clonedCard);
    } else {
      // Spell: simulate effect impact on board
      simState.players[playerId].zones.hand.remove(card._uid);
      const effects = CardEngine.getSpellEffects(card);
      for (const eff of effects) {
        if (eff.type === 'draw') {
          // Increase hand count
          for (let i = 0; i < (eff.amount || 1); i++) {
            simState.players[playerId].zones.hand.add(_cloneCard({ _uid: 'drawn_' + i, name: 'Drawn', type_line: 'Card', cmc: 0 }));
          }
        }
        if (eff.type === 'destroy' || eff.type === 'exile') {
          // Remove best opponent creature
          const oppCreats = simState.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c));
          if (oppCreats.length > 0) {
            oppCreats.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            simState.players[opponentId].zones.battlefield.remove(oppCreats[0]._uid);
          }
        }
        if (eff.type === 'damage' && (eff.target === 'creature' || eff.target === 'any target')) {
          const oppCreats = simState.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c));
          const killable = oppCreats.find(c => CardEngine.getToughness(c) <= (eff.amount || 0));
          if (killable) {
            simState.players[opponentId].zones.battlefield.remove(killable._uid);
          }
        }
        if (eff.type === 'ramp') {
          // Simulate extra land
          simBf.add(_cloneCard({ _uid: 'ramp_land', name: 'Land', type_line: 'Land', cmc: 0, _tapped: true }));
        }
      }
    }

    // Subtract mana cost from simulation
    const costParsed = ManaSystem.parseCost(card.mana_cost);
    // Reduce available untapped lands count
    let manaCostTotal = card.cmc || costParsed.total || 0;
    const untappedLands = simBf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    for (let i = 0; i < manaCostTotal && i < untappedLands.length; i++) {
      untappedLands[i]._tapped = true;
    }

    // Evaluate resulting board
    const simEval = _quickEvalBoard(simState, playerId);

    // Bonus for pre-combat removal (clears blockers)
    if (state.phase === 'main1') {
      const effects = CardEngine.getSpellEffects(card);
      if (effects.some(e => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage')) {
        // Check if removing creatures improves attack potential
        const remainingOpp = simState.players[opponentId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c));
        if (remainingOpp.length < opponentCreatures.length) {
          // Fewer blockers = better attacks
          const removedBlockers = opponentCreatures.length - remainingOpp.length;
          // Extra bonus relative to base eval (comment preserved from original)
        }
      }
    }

    if (simEval > bestEval) {
      bestEval = simEval;
      bestCard = card;
    }
  }

  // Only override if simulation found a clearly better option
  if (bestCard && bestEval > baseEval + 2) {
    return bestCard;
  }

  return null;
}

// =================== INSTANT TIMING OPTIMIZATION ===================
// Check if using a combat trick changes the combat outcome
export function _shouldUseCombatTrick(state, playerId, trickCard, combatState) {
  if (!combatState || !combatState.attackers) return false;

  const effects = CardEngine.getSpellEffects(trickCard);
  const buffEffect = effects.find(e => e.type === 'buff');
  if (!buffEffect) return false;

  const buffPower = buffEffect.power || 0;
  const buffToughness = buffEffect.toughness || 0;
  const opponentId = playerId === 0 ? 1 : 0;

  // Check our creatures in combat
  const myBf = state.players[playerId].zones.battlefield;

  // Check attackers we control
  for (const atk of combatState.attackers) {
    if (!myBf.get(atk.uid)) continue; // not our creature
    const blockers = combatState.blockers[atk.uid] || [];
    if (blockers.length === 0) continue; // unblocked, trick not needed

    const atkCard = atk.card;
    const power = CardEngine.getPower(atkCard);
    const toughness = CardEngine.getToughness(atkCard);

    // Total blocker damage
    let totalBlockerPower = 0;
    for (const { card: blk } of blockers) {
      totalBlockerPower += CardEngine.getPower(blk);
    }

    // Check if trick saves our creature
    const diesWithout = totalBlockerPower >= toughness;
    const survivesWithTrick = totalBlockerPower < (toughness + buffToughness);

    // Check if trick lets us kill a blocker we couldn't before
    let killsExtraBlocker = false;
    for (const { card: blk } of blockers) {
      const blkTough = CardEngine.getToughness(blk);
      if (power < blkTough && (power + buffPower) >= blkTough) {
        killsExtraBlocker = true;
        break;
      }
    }

    if (diesWithout && survivesWithTrick) return true; // Saves our creature
    if (killsExtraBlocker) return true; // Upgrades the trade
  }

  // Check blockers we control
  for (const [atkUid, blockerArr] of Object.entries(combatState.blockers)) {
    for (const { card: blocker, uid: blkUid } of blockerArr) {
      if (!myBf.get(blkUid)) continue; // not our creature
      const atk = combatState.attackers.find(a => a.uid === atkUid);
      if (!atk) continue;

      const atkPower = CardEngine.getPower(atk.card);
      const atkToughness = CardEngine.getToughness(atk.card);
      const blkPower = CardEngine.getPower(blocker);
      const blkToughness = CardEngine.getToughness(blocker);

      const diesWithout = atkPower >= blkToughness;
      const survivesWithTrick = atkPower < (blkToughness + buffToughness);
      const killsAttackerWithTrick = (blkPower + buffPower) >= atkToughness && blkPower < atkToughness;

      if (diesWithout && survivesWithTrick) return true;
      if (killsAttackerWithTrick) return true;
    }
  }

  return false; // Trick doesn't change outcome
}

// =================== NOTE ON FORWARD REFERENCES ===================
// The following functions are referenced in this file but defined in game-ai-part1.ts:
//   _creatureValue(card) — scores a creature's board value
//   _threatScore(card)   — scores a threat level of an opponent's card
//   _evaluateBoard(state, playerId) — evaluates overall board state score
//   _getAbilityManaCost(ability) — extracts mana cost from activated ability
// These are expected to be available in the same module scope at runtime.
// When combining part1 and part2 into a single module, these will resolve correctly.
