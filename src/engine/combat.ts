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
import { checkPreventDamageShield } from './game-state';

// ============================================
// Combat State Interface
// ============================================

export interface CombatAttackerEntry {
  uid: string;
  card: GameCard;
  attackTarget?: string; // undefined = attack defending player; string = planeswalker UID
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
  flushBatchedTriggers: (batched: Array<{ trigger: any; fireData: any }>) => string[];
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

  // Snapshot attackers BEFORE firing triggers — tokens created attacking during resolution
  // (e.g. War Effort mobilize) would be added to combatState.attackers mid-loop and
  // re-trigger the same "attacks" event, causing an infinite loop.
  const attackersSnapshot = [...combatState.attackers];
  const initialCount = attackersSnapshot.length;

  // Batch mode: collect all attack triggers across all attackers,
  // then resolve them together (allows trigger ordering overlay to show ALL triggers)
  (gameState as any)._batchAttackTriggers = true;
  (gameState as any)._batchedTriggers = [];

  for (const { uid, card: attacker } of attackersSnapshot) {
    gameState.fireTrigger('attacks', {
      cardUid: uid,
      card: attacker,
      controllerId: attackingPlayerId,
      attackingCreatureCount: initialCount,
    });

    gameState.fireTrigger('enters_or_attacks', {
      cardUid: uid,
      attacking: true,
      playerId: attackingPlayerId,
    });

    if (attacker._attachments && attacker._attachments.length > 0) {
      const hasEquip = attacker._attachments.some(aUid => {
        const att = gameState.players[attackingPlayerId].zones.battlefield.cards.find(
          (c: GameCard) => c._uid === aUid
        );
        return att && isEquipment(att);
      });
      if (hasEquip) {
        gameState.fireTrigger('equipped_attacks', {
          cardUid: uid,
          card: attacker,
          playerId: attackingPlayerId,
        });
      }
    }
  }

  // Flush: resolve all batched triggers at once
  (gameState as any)._batchAttackTriggers = false;
  const batched = (gameState as any)._batchedTriggers as Array<{ trigger: any; fireData: any }> || [];
  (gameState as any)._batchedTriggers = null;

  if (batched.length > 0) {
    const flushLogs = (gameState as any).flushBatchedTriggers(batched);
    log.push(...flushLogs);
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

  // First strike damage phase (attackers AND blockers with First/Double Strike)
  const firstStrikers = combatState.attackers.filter(a =>
    hasKeyword(a.card, 'First Strike', gameState) ||
    hasKeyword(a.card, 'Double Strike', gameState)
  );
  // Check if any blocker has First/Double Strike (affects non-FS attackers too)
  const anyFSBlocker = combatState.attackers.some(a => {
    const blockers = combatState.blockers[a.uid] || [];
    return blockers.some(b =>
      hasKeyword(b.card, 'First Strike', gameState) || hasKeyword(b.card, 'Double Strike', gameState)
    );
  });

  if (firstStrikers.length > 0 || anyFSBlocker) {
    // FS attackers deal damage (and their FS blockers deal back)
    if (firstStrikers.length > 0) {
      const firstStrikeLog = resolveDamagePhase(
        firstStrikers, combatState, attackingPlayer, defendingPlayer, gameState, true
      );
      log.push(...firstStrikeLog);
    }

    // FS blockers deal damage to non-FS attackers (attacker doesn't retaliate yet)
    for (const attackEntry of combatState.attackers) {
      if (hasKeyword(attackEntry.card, 'First Strike', gameState) ||
          hasKeyword(attackEntry.card, 'Double Strike', gameState)) continue; // already handled above
      if (attackEntry.card._damage >= getToughness(attackEntry.card)) continue; // attacker already dead
      const blockers = combatState.blockers[attackEntry.uid] || [];
      for (const { card: blocker } of blockers) {
        if (!hasKeyword(blocker, 'First Strike', gameState) && !hasKeyword(blocker, 'Double Strike', gameState)) continue;
        if (blocker._damage >= getToughness(blocker)) continue;
        const bPower = getPower(blocker);
        if (bPower <= 0) continue;
        dealDamageToCreature(blocker, attackEntry.card, bPower);
        if (hasKeyword(blocker, 'Deathtouch', gameState) && bPower > 0 && !hasKeyword(blocker, 'Wither', gameState)) {
          attackEntry.card._damage = getToughness(attackEntry.card);
        }
        if (hasKeyword(blocker, 'Lifelink') && bPower > 0) {
          defendingPlayer.life += bPower;
        }
        log.push(`${blocker.name} (first strike) causa ${bPower} de dano a ${attackEntry.card.name}.`);
      }
    }

    cleanupDead(gameState);
  }

  // Regular damage phase (non-FS attackers + DS attackers; FS-only blockers don't deal again)
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

  // First-strike attackers that survived are still hit by their non-first-strike blockers
  // in the regular damage phase. They don't deal damage again (they already did in first-strike
  // phase), but their blockers that lack first strike still get to retaliate.
  const survivingFirstStrikers = firstStrikers.filter(a =>
    a.card._damage < getToughness(a.card)
  );
  for (const attackEntry of survivingFirstStrikers) {
    const blockers = combatState.blockers[attackEntry.uid] || [];
    for (const { card: blocker } of blockers) {
      if (
        blocker._damage >= getToughness(blocker) ||
        hasKeyword(blocker, 'First Strike', gameState) ||
        hasKeyword(blocker, 'Double Strike', gameState)
      ) {
        continue; // Dead blockers or first-strike blockers already dealt in phase 1
      }
      const blockerPower = getPower(blocker);
      if (blockerPower <= 0) continue;

      dealDamageToCreature(blocker, attackEntry.card, blockerPower);
      if (hasKeyword(blocker, 'Deathtouch', gameState)) {
        if (!hasKeyword(blocker, 'Wither', gameState)) {
          attackEntry.card._damage = getToughness(attackEntry.card);
        }
      }
      if (hasKeyword(blocker, 'Lifelink') && blockerPower > 0) {
        defendingPlayer.life += blockerPower;
      }
      log.push(`${blocker.name} causa ${blockerPower} de dano a ${attackEntry.card.name} (golpe normal).`);
    }
  }

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

  for (const attackEntry of attackers) {
    const { uid, card: attacker, attackTarget } = attackEntry;
    const blockers = combatState.blockers[uid] || [];

    // Skip attackers removed from battlefield before damage (killed by combat tricks)
    const attackerOnBf = gameState.players[0].zones.battlefield.cards.some((c: any) => c._uid === uid) ||
                         gameState.players[1].zones.battlefield.cards.some((c: any) => c._uid === uid);
    if (!attackerOnBf) continue;

    const attackPower = getPower(attacker);

    if (blockers.length === 0) {
      // Unblocked — check if attacking a planeswalker
      if (attackTarget) {
        // ── Attacking a planeswalker ──────────────────────────────────────────
        const pwCard = gameState.players[defendingPlayer.id].zones.battlefield.cards
          .find(c => c._uid === attackTarget) as any;
        if (pwCard) {
          const pwDmg = applyDamageModifiers(gameState, uid, attackPower);
          if (pwDmg > 0) {
            attacker._hasDealtDamage = true;
            pwCard._loyalty = Math.max(0, (pwCard._loyalty || 0) - pwDmg);
            log.push(`${attacker.name} ataca ${pwCard.name} e causa ${pwDmg} de dano (lealdade: ${pwCard._loyalty}).`);
            vfxPlay('playerDamage', 'p' + defendingPlayer.id);

            // Lifelink
            if (hasKeyword(attacker, 'Lifelink')) {
              attackingPlayer.life += pwDmg;
              log.push(`${attacker.name} tem lifelink. +${pwDmg} vida. (Vida: ${attackingPlayer.life})`);
              vfxPlay('heal', 'p' + attackingPlayer.id);
            }

            // Check planeswalker death (loyalty reaches 0)
            if ((pwCard._loyalty || 0) <= 0) {
              const defBf = gameState.players[defendingPlayer.id].zones.battlefield.cards;
              const pwIdx = defBf.indexOf(pwCard);
              if (pwIdx !== -1) {
                defBf.splice(pwIdx, 1);
                gameState.players[defendingPlayer.id].zones.graveyard.cards.push(pwCard);
                log.push(`${pwCard.name} foi destruído (lealdade chegou a 0).`);
              }
            }
          }
        }
      } else {
        // ── Attacking the defending player ────────────────────────────────────
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
          // Check New Way Forward shield
          if (checkPreventDamageShield(gameState, defendingPlayer.id, dmg, attackingPlayer.id, attacker._uid)) {
            log.push(`${attacker.name} combat damage prevented by New Way Forward!`);
          } else {
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

          attacker._hasDealtDamage = true;
          // Fire combat_damage_player trigger
          const cbtLogs = gameState.fireTrigger('combat_damage_player', {
            cardUid: uid,
            card: attacker,
            amount: dmg,
            controllerId: attackingPlayer.id,
          });
          log.push(...cbtLogs);
          } // end else (no shield)
        }
      }
      } // end attacking player
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

        // Skip blockers removed from battlefield before damage (bounced, exiled, or killed by spells)
        const blockerOnBf = gameState.players[0].zones.battlefield.cards.some((c: any) => c._uid === blocker._uid) ||
                            gameState.players[1].zones.battlefield.cards.some((c: any) => c._uid === blocker._uid);
        if (!blockerOnBf) continue; // Attacker stays "blocked" but no damage exchanged

        const blockerToughness = Math.max(0, getToughness(blocker) - blocker._damage);
        const blockerPower = getPower(blocker);

        let dmgToBlocker = Math.min(remainingAttackPower, blockerToughness);

        if (hasKeyword(attacker, 'Deathtouch', gameState) && remainingAttackPower > 0) {
          dmgToBlocker = Math.min(remainingAttackPower, 1);
        }

        dealDamageToCreature(attacker, blocker, dmgToBlocker);
        if (dmgToBlocker > 0) attacker._hasDealtDamage = true;
        remainingAttackPower -= dmgToBlocker;

        if (hasKeyword(attacker, 'Deathtouch', gameState) && dmgToBlocker > 0) {
          if (hasKeyword(attacker, 'Wither', gameState)) {
            // Wither+deathtouch: 1 -1/-1 counter kills via counters
          } else {
            blocker._damage = getToughness(blocker);
          }
        }

        // Blocker deals damage to attacker.
        // In FS phase: only FS/DS blockers deal damage.
        // In regular phase: FS-only blockers already dealt in the FS-blocker sub-phase; only non-FS or DS blockers deal here.
        const blockerDeals = isFirstStrike
          ? (hasKeyword(blocker, 'First Strike', gameState) || hasKeyword(blocker, 'Double Strike', gameState))
          : (!hasKeyword(blocker, 'First Strike', gameState) || hasKeyword(blocker, 'Double Strike', gameState));
        if (blockerDeals) {
          dealDamageToCreature(blocker, attacker, blockerPower);
          if (blockerPower > 0) blocker._hasDealtDamage = true;
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

      // Trample - remaining damage goes to attacked target (player or planeswalker)
      if (remainingAttackPower > 0 && hasKeyword(attacker, 'Trample')) {
        if (attackTarget) {
          // Trample overflow → planeswalker
          const pwCard = gameState.players[defendingPlayer.id].zones.battlefield.cards
            .find(c => c._uid === attackTarget) as any;
          if (pwCard) {
            pwCard._loyalty = Math.max(0, (pwCard._loyalty || 0) - remainingAttackPower);
            log.push(`${attacker.name} tem trample. ${remainingAttackPower} dano a ${pwCard.name} (lealdade: ${pwCard._loyalty}).`);
            vfxPlay('playerDamage', 'p' + defendingPlayer.id);
            if ((pwCard._loyalty || 0) <= 0) {
              const defBf = gameState.players[defendingPlayer.id].zones.battlefield.cards;
              const pwIdx = defBf.indexOf(pwCard);
              if (pwIdx !== -1) {
                defBf.splice(pwIdx, 1);
                gameState.players[defendingPlayer.id].zones.graveyard.cards.push(pwCard);
                log.push(`${pwCard.name} foi destruído (lealdade chegou a 0).`);
              }
            }
          }
        } else {
          // Trample overflow → defending player
          if (checkPreventDamageShield(gameState, defendingPlayer.id, remainingAttackPower, attackingPlayer.id, attacker._uid)) {
            log.push(`${attacker.name} trample damage prevented by New Way Forward!`);
          } else {
          defendingPlayer.life -= remainingAttackPower;

          // Track trample damage for Spinerock Knoll hideaway
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[defendingPlayer.id] =
            (gameState._damageDealtThisTurn[defendingPlayer.id] || 0) + remainingAttackPower;

          log.push(
            `${attacker.name} tem trample. ${remainingAttackPower} dano ao jogador. (Vida: ${defendingPlayer.life})`
          );

          vfxPlay('playerDamage', 'p' + defendingPlayer.id);

          attacker._hasDealtDamage = true;
          // Trample combat damage trigger
          const trampleLogs = gameState.fireTrigger('combat_damage_player', {
            cardUid: uid,
            card: attacker,
            amount: remainingAttackPower,
            controllerId: attackingPlayer.id,
          });
          log.push(...trampleLogs);
          } // end else (no shield)
        }
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
