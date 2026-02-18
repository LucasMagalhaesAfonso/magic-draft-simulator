// combat.ts — Combat system for resolving MTG combat phases
// Ported from legacy combat.js (CombatSystem object → named exports)

import type { GameCard, EngineGameState, EnginePlayer } from './engine-types';
import {
  isCreature,
  hasKeyword,
  getPower,
  getToughness,
  canAttack,
  canBlock,
} from './card-utils';
import { vfxPlay } from './vfx-bridge';

// ============================================
// Combat State Interface
// ============================================

export interface CombatAttackerEntry {
  uid: string;
  card: GameCard;
}

export interface CombatBlockerEntry {
  uid: string;
  card: GameCard;
}

export type CombatPhase = 'none' | 'declare_attackers' | 'declare_blockers' | 'damage';

export interface CombatState {
  attackers: CombatAttackerEntry[];
  blockers: Record<string, CombatBlockerEntry[]>;       // keyed by attacker uid
  blockerOrder: Record<string, string[]>;                // keyed by attacker uid → ordered blocker uids
  _blockerOrderDone: boolean;
  phase: CombatPhase;
}

// ============================================
// Extended GameCard properties used at runtime
// ============================================
// The legacy code sets several ad-hoc properties on cards during combat.
// We use a type extension so we can access them without casting everywhere.

interface CombatGameCard extends GameCard {
  _damagedThisTurn?: boolean;
  _tappedByAttack?: boolean;
  _enteredThisTurn?: boolean;
  _doubleDamage?: string;
}

// ============================================
// Extended EngineGameState for combat
// ============================================
// The legacy code accesses several properties on gameState that aren't
// declared in EngineGameState (they come from the full GameState).
// We define a local interface to type them for combat usage.

interface CombatGameState extends EngineGameState {
  _damageShield?: Record<number, number>;
  _damageDealtThisTurn?: number[];
  _lastPreventedDamage?: number;
  log: string[];
  fireTrigger: (
    event: string,
    data: Record<string, unknown>
  ) => string[];
  creatureDies: (card: GameCard, playerId: number) => boolean;
}

// ============================================
// Helper: deal damage from source to creature, respecting wither
// ============================================

export function dealDamageToCreature(
  source: GameCard,
  target: CombatGameCard,
  amount: number
): void {
  if (amount <= 0) return;

  if (hasKeyword(source, 'Wither')) {
    // Wither: damage as -1/-1 counters (getPower/getToughness already read counters)
    if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
    target._counters['-1/-1'] += amount;
  } else {
    target._damage += amount;
  }

  // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
  target._damagedThisTurn = true;
}

// ============================================
// Helper: calculate modified damage considering double damage effects
// ============================================

export function applyDamageModifiers(
  gameState: CombatGameState,
  attackerId: string,
  baseDamage: number
): number {
  if (baseDamage <= 0) return baseDamage;

  // Find the attacker card on either player's battlefield
  let attacker: CombatGameCard | null = null;
  for (const player of gameState.players) {
    const found = player.zones.battlefield.cards.find(
      (c: GameCard) => c._uid === attackerId
    ) as CombatGameCard | undefined;
    if (found) {
      attacker = found;
      break;
    }
  }
  if (!attacker) return baseDamage;

  let finalDamage = baseDamage;

  // Check for double damage effects (like Neriv, Heart of the Storm)
  for (const player of gameState.players) {
    for (const permanent of player.zones.battlefield.cards) {
      const combatPerm = permanent as CombatGameCard;
      if (combatPerm._doubleDamage) {
        const target = combatPerm._doubleDamage;
        if (target === 'creatures_entered_this_turn' && attacker._enteredThisTurn) {
          finalDamage *= 2;
        }
      }
    }
  }

  return finalDamage;
}

// ============================================
// Create a fresh combat state
// ============================================

export function createCombatState(): CombatState {
  return {
    attackers: [],
    blockers: {},
    blockerOrder: {},
    _blockerOrderDone: false,
    phase: 'none',
  };
}

// ============================================
// Returns attacker UIDs that have 2+ blockers (need ordering)
// ============================================

export function getMultiBlockedAttackers(combatState: CombatState): string[] {
  const result: string[] = [];
  for (const [attackerUid, blockers] of Object.entries(combatState.blockers)) {
    if (blockers.length >= 2) {
      result.push(attackerUid);
    }
  }
  return result;
}

// ============================================
// Set the damage assignment order for blockers on a specific attacker
// ============================================

export function setBlockerOrder(
  combatState: CombatState,
  attackerUid: string,
  orderedBlockerUids: string[]
): void {
  combatState.blockerOrder[attackerUid] = orderedBlockerUids;
}

// ============================================
// Declare an attacker
// ============================================

export function declareAttacker(combatState: CombatState, card: GameCard): boolean {
  if (!canAttack(card)) return false;
  combatState.attackers.push({ uid: card._uid, card });
  card._attacking = true;
  return true;
}

// ============================================
// Remove an attacker
// ============================================

export function removeAttacker(combatState: CombatState, uid: string): void {
  const idx = combatState.attackers.findIndex(a => a.uid === uid);
  if (idx === -1) return;
  combatState.attackers[idx].card._attacking = false;
  combatState.attackers.splice(idx, 1);
  delete combatState.blockers[uid];
}

// ============================================
// Declare a blocker
// ============================================

export function declareBlocker(
  combatState: CombatState,
  blocker: GameCard,
  attackerUid: string,
  gameState: EngineGameState | null = null
): boolean {
  const attacker = combatState.attackers.find(a => a.uid === attackerUid);
  if (!attacker) return false;
  if (!canBlock(blocker, attacker.card, gameState)) return false;

  // CRITICAL: Each creature can only block ONE attacker per combat
  if (blocker._blocking) {
    return false; // Already blocking another attacker
  }

  // Menace check: need at least 2 blockers
  // (We allow assigning, the check happens at confirm)

  if (!combatState.blockers[attackerUid]) {
    combatState.blockers[attackerUid] = [];
  }
  combatState.blockers[attackerUid].push({ uid: blocker._uid, card: blocker });
  blocker._blocking = attackerUid;
  return true;
}

// ============================================
// Remove a blocker
// ============================================

export function removeBlocker(combatState: CombatState, uid: string): void {
  for (const [attackerUid, blockers] of Object.entries(combatState.blockers)) {
    const idx = blockers.findIndex(b => b.uid === uid);
    if (idx !== -1) {
      blockers[idx].card._blocking = null;
      blockers.splice(idx, 1);
      if (blockers.length === 0) delete combatState.blockers[attackerUid];
      return;
    }
  }
}

// ============================================
// Fire attack triggers when attackers are confirmed
// ============================================

export function fireAttackTriggers(
  combatState: CombatState,
  gameState: CombatGameState,
  attackingPlayerId: number
): string[] {
  const log: string[] = [];

  for (const { uid, card: attacker } of combatState.attackers) {
    // Fire "attacks" trigger
    const atkLogs = gameState.fireTrigger('attacks', {
      cardUid: uid,
      card: attacker,
      controllerId: attackingPlayerId,
      attackingCreatureCount: combatState.attackers.length,
    });
    log.push(...atkLogs);

    // Fire "enters_or_attacks" trigger (for cards like Inspirited Vanguard)
    const enterOrAtkLogs = gameState.fireTrigger('enters_or_attacks', {
      cardUid: uid,
      attacking: true,
      playerId: attackingPlayerId,
    });
    log.push(...enterOrAtkLogs);

    // Fire equipped_attacks if creature has equipment attached
    if (attacker._attachments && attacker._attachments.length > 0) {
      const hasEquip = attacker._attachments.some(aUid => {
        const att = gameState.players[attackingPlayerId].zones.battlefield.cards.find(
          (c: GameCard) => c._uid === aUid
        );
        return att && isEquipment(att);
      });
      if (hasEquip) {
        const eqAtkLogs = gameState.fireTrigger('equipped_attacks', {
          cardUid: uid,
          card: attacker,
          playerId: attackingPlayerId,
        });
        log.push(...eqAtkLogs);
      }
    }
  }

  return log;
}

// ============================================
// Resolve all combat damage
// ============================================

export function resolveCombatDamage(
  combatState: CombatState,
  attackingPlayer: EnginePlayer,
  defendingPlayer: EnginePlayer,
  gameState: CombatGameState
): string[] {
  const log: string[] = [];

  // First strike damage phase
  const firstStrikers = combatState.attackers.filter(a =>
    hasKeyword(a.card, 'First Strike', gameState) ||
    hasKeyword(a.card, 'Double Strike', gameState)
  );

  if (firstStrikers.length > 0) {
    const firstStrikeLog = resolveDamagePhase(
      firstStrikers, combatState, attackingPlayer, defendingPlayer, gameState, true
    );
    log.push(...firstStrikeLog);
    cleanupDead(gameState);
  }

  // Regular damage phase
  const regularAttackers = combatState.attackers.filter(a => {
    const card = a.card;
    if (card._damage >= getToughness(card)) return false;
    if (
      hasKeyword(card, 'First Strike', gameState) &&
      !hasKeyword(card, 'Double Strike', gameState)
    ) {
      return false;
    }
    return true;
  });

  const regularLog = resolveDamagePhase(
    regularAttackers, combatState, attackingPlayer, defendingPlayer, gameState, false
  );
  log.push(...regularLog);

  // Cleanup
  cleanupDead(gameState);
  resetCombatState(combatState, gameState);

  return log;
}

// ============================================
// Resolve a single damage phase (first strike or regular)
// ============================================

export function resolveDamagePhase(
  attackers: CombatAttackerEntry[],
  combatState: CombatState,
  attackingPlayer: EnginePlayer,
  defendingPlayer: EnginePlayer,
  gameState: CombatGameState,
  isFirstStrike: boolean
): string[] {
  const log: string[] = [];

  for (const { uid, card: attacker } of attackers) {
    const blockers = combatState.blockers[uid] || [];
    const attackPower = getPower(attacker);

    if (blockers.length === 0) {
      // Unblocked - damage to defending player
      let dmg = applyDamageModifiers(gameState, uid, attackPower);
      if (dmg > 0) {
        // Apply damage prevention shield
        if (gameState._damageShield && gameState._damageShield[defendingPlayer.id] > 0) {
          const prevented = Math.min(dmg, gameState._damageShield[defendingPlayer.id]);
          dmg -= prevented;
          gameState._damageShield[defendingPlayer.id] -= prevented;
          if (prevented > 0) {
            log.push(`${prevented} dano prevenido.`);
            // Store prevented damage and fire prevent_damage trigger
            gameState._lastPreventedDamage = prevented;
            gameState.fireTrigger('prevent_damage', {
              playerId: defendingPlayer.id,
              prevented,
              source: attacker,
            });
          }
        }

        if (dmg > 0) {
          defendingPlayer.life -= dmg;

          // Track damage dealt this turn (for Spinerock Knoll hideaway)
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[defendingPlayer.id] =
            (gameState._damageDealtThisTurn[defendingPlayer.id] || 0) + dmg;

          log.push(
            `${attacker.name} ataca e causa ${dmg} de dano. (Vida: ${defendingPlayer.life})`
          );

          vfxPlay('playerDamage', 'p' + defendingPlayer.id);

          // Lifelink
          if (hasKeyword(attacker, 'Lifelink')) {
            attackingPlayer.life += dmg;
            log.push(
              `${attacker.name} tem lifelink. +${dmg} vida. (Vida: ${attackingPlayer.life})`
            );
            vfxPlay('heal', 'p' + attackingPlayer.id);
          }

          // Fire combat_damage_player trigger
          const cbtLogs = gameState.fireTrigger('combat_damage_player', {
            cardUid: uid,
            card: attacker,
            amount: dmg,
          });
          log.push(...cbtLogs);
        }
      }
    } else {
      // Blocked - use blocker order if set, otherwise default order
      let remainingAttackPower = applyDamageModifiers(gameState, uid, attackPower);
      const order = combatState.blockerOrder[uid];
      const orderedBlockers: CombatBlockerEntry[] = order
        ? order
            .map(bUid => blockers.find(b => b.uid === bUid))
            .filter((b): b is CombatBlockerEntry => b !== undefined)
        : blockers;

      for (const { card: blocker } of orderedBlockers) {
        if (remainingAttackPower <= 0) break;

        const blockerToughness = getToughness(blocker) - blocker._damage;
        const blockerPower = getPower(blocker);

        let dmgToBlocker = Math.min(remainingAttackPower, blockerToughness);

        if (hasKeyword(attacker, 'Deathtouch', gameState) && remainingAttackPower > 0) {
          dmgToBlocker = Math.min(remainingAttackPower, 1);
        }

        dealDamageToCreature(attacker, blocker, dmgToBlocker);
        remainingAttackPower -= dmgToBlocker;

        if (hasKeyword(attacker, 'Deathtouch', gameState) && dmgToBlocker > 0) {
          if (hasKeyword(attacker, 'Wither', gameState)) {
            // Wither+deathtouch: 1 -1/-1 counter kills via counters
          } else {
            blocker._damage = getToughness(blocker);
          }
        }

        // Blocker deals damage to attacker
        if (
          !isFirstStrike ||
          hasKeyword(blocker, 'First Strike', gameState) ||
          hasKeyword(blocker, 'Double Strike', gameState)
        ) {
          dealDamageToCreature(blocker, attacker, blockerPower);
          if (hasKeyword(blocker, 'Deathtouch', gameState) && blockerPower > 0) {
            if (!hasKeyword(blocker, 'Wither', gameState)) {
              attacker._damage = getToughness(attacker);
            }
          }

          // Blocker lifelink
          if (hasKeyword(blocker, 'Lifelink') && blockerPower > 0) {
            defendingPlayer.life += blockerPower;
          }
        }

        // VFX: show damage on both creatures
        vfxPlay('damage', blocker._uid);
        if (blockerPower > 0) vfxPlay('damage', uid);

        log.push(
          `${attacker.name} (${attackPower}/${getToughness(attacker)}) combate com ${blocker.name} (${blockerPower}/${getToughness(blocker)})`
        );
      }

      // Trample - remaining damage goes to player
      if (remainingAttackPower > 0 && hasKeyword(attacker, 'Trample')) {
        defendingPlayer.life -= remainingAttackPower;

        // Track trample damage for Spinerock Knoll hideaway
        if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
        gameState._damageDealtThisTurn[defendingPlayer.id] =
          (gameState._damageDealtThisTurn[defendingPlayer.id] || 0) + remainingAttackPower;

        log.push(
          `${attacker.name} tem trample. ${remainingAttackPower} dano ao jogador. (Vida: ${defendingPlayer.life})`
        );

        vfxPlay('playerDamage', 'p' + defendingPlayer.id);

        // Trample combat damage trigger
        const trampleLogs = gameState.fireTrigger('combat_damage_player', {
          cardUid: uid,
          card: attacker,
          amount: remainingAttackPower,
        });
        log.push(...trampleLogs);
      }

      // Attacker lifelink on damage dealt (uses POWER, not actual damage dealt)
      // Magic rules: lifelink gains life equal to power when creature deals combat damage
      if (hasKeyword(attacker, 'Lifelink') && attackPower > 0) {
        attackingPlayer.life += attackPower;
      }
    }
  }

  return log;
}

// ============================================
// Cleanup dead creatures after combat damage
// ============================================

export function cleanupDead(gameState: CombatGameState): void {
  for (const playerId of [0, 1]) {
    const bf = gameState.players[playerId].zones.battlefield;
    const dead = bf.cards.filter(
      (c: GameCard) =>
        isCreature(c) &&
        (c._damage >= getToughness(c) || getToughness(c) <= 0)
    );
    for (const c of dead) {
      const died = gameState.creatureDies(c, playerId);
      if (died) {
        gameState.log.push(`${c.name} morre.`);
      } else {
        // Indestructible - reset damage
        gameState.log.push(`${c.name} e indestruivel! Sobrevive.`);
      }
    }
  }
}

// ============================================
// Reset combat state after damage resolution
// ============================================

export function resetCombatState(
  combatState: CombatState,
  gameState: CombatGameState
): void {
  // Tap attackers (unless vigilance) and fire becomes_tapped triggers
  // Note: human attackers are already tapped at declaration (confirmAttackers)
  for (const { card } of combatState.attackers) {
    const combatCard = card as CombatGameCard;
    if (!hasKeyword(card, 'Vigilance')) {
      if (!combatCard._tappedByAttack) {
        // AI attackers: tap now and fire triggers
        const wasTapped = card._tapped;
        card._tapped = true;
        if (!wasTapped) {
          const tapLogs = gameState.fireTrigger('becomes_tapped', {
            cardUid: card._uid,
            card: card,
            controllerId: gameState.activePlayer,
          });
          if (tapLogs.length > 0) gameState.log.push(...tapLogs);
        }
      }
    }
    delete combatCard._tappedByAttack;
    card._attacking = false;
  }

  // Reset blockers
  for (const blockers of Object.values(combatState.blockers)) {
    for (const { card } of blockers) {
      card._blocking = null;
    }
  }

  // NOTE: Damage is NOT reset here - it persists until cleanup step
  // This is handled in GameState._endOfTurnCleanup()

  combatState.attackers = [];
  combatState.blockers = {};
  combatState.blockerOrder = {};
  combatState._blockerOrderDone = false;
  combatState.phase = 'none';
}

// ============================================
// Validate blockers - check menace requirements
// ============================================

export interface InvalidBlock {
  attacker: GameCard;
  reason: string;
}

export function validateBlockers(combatState: CombatState): InvalidBlock[] {
  const invalidBlocks: InvalidBlock[] = [];
  for (const { uid, card: attacker } of combatState.attackers) {
    const blockers = combatState.blockers[uid] || [];
    // Menace: must be blocked by 2+ creatures, or not at all
    if (hasKeyword(attacker, 'Menace') && blockers.length === 1) {
      invalidBlocks.push({
        attacker,
        reason: `${attacker.name} tem Menace - precisa de 2+ bloqueadores ou nenhum`,
      });
    }
  }
  return invalidBlocks;
}

// ============================================
// Internal helper: check if a card is an equipment
// ============================================

function isEquipment(card: GameCard): boolean {
  return (card.type_line || '').toLowerCase().includes('equipment');
}
