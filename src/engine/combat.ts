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
import { vfxPlay, vfxPlayText, vfxPlayCombat } from './vfx-bridge';

/** Pick attack VFX type based on oracle text / name first, then color identity */
function _attackVfx(card: any): string {
  const text  = ((card.oracle_text || '') + ' ' + (card.name || '')).toLowerCase();
  const colors: string[] = card.colors || card.color_identity || [];
  const r = colors.includes('R');
  const u = colors.includes('U');
  const g = colors.includes('G');
  const b = colors.includes('B');
  const w = colors.includes('W');

  // Oracle/name keywords override color
  if (/lightning|thunder|bolt|shock|static|spark|zap/.test(text))       return 'attackLightning';
  if (/frost|ice|freeze|frozen|snow|blizzard|glacial|cold/.test(text))  return 'attackIce';
  if (/fire|flame|burn|scorch|blaze|inferno|lava|ember|ignite|dragon/.test(text)) return 'attackFire';
  if (/blood|wound|gore|slash|claw|savage|feral|bite/.test(text))       return 'attackBlood';
  if (/shadow|death|grave|decay|rot|poison|corrupt|dark|void|necro/.test(text))   return 'attackDark';
  if (/water|wave|flood|tide|aqua|river|sea|ocean|torrent|rain/.test(text))       return 'attackWater';
  if (/nature|vine|root|growth|forest|leaf|earth|seed|herb|grove/.test(text))     return 'attackGreen';

  // Fall back to card color
  if (r && b) return 'attackBlood';
  if (u && r) return 'attackLightning';
  if (r)      return 'attackFire';
  if (u)      return 'attackWater';
  if (g)      return 'attackGreen';
  if (b)      return 'attackDark';
  if (w)      return 'attackGold';
  return 'attackBlood'; // colorless / artifact
}

// Apply life gain with Phial of Galadriel replacement: doubles gain when at 5 or less life
function applyLifelinkGain(player: any, amount: number): void {
  let gain = amount;
  if (player.zones?.battlefield?.cards && player.life <= 5) {
    for (const perm of player.zones.battlefield.cards) {
      if ((perm.name || '').toLowerCase() === 'phial of galadriel') {
        gain *= 2;
        break;
      }
    }
  }
  player.life += gain;
}

// Get combat damage value — uses toughness if creature has assign_damage_by_toughness
function getCombatDamage(card: any): number {
  if (hasKeyword(card, 'assign_damage_by_toughness')) {
    return getToughness(card);
  }
  return getPower(card);
}
import { checkPreventDamageShield, detectAndFireTapTriggers } from './game-state';

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
  amount: number,
  gameState?: any
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
  // Track who dealt damage (for Shelob: "if damage was dealt to it by a source you controlled")
  let srcController = (source as any)._controller ?? (source as any)._owner ?? (source as any)._ownerId;
  // Fallback: look up source controller from battlefield (prepareForBattlefield doesn't set _controller)
  if (srcController === undefined && gameState) {
    for (let pid = 0; pid < gameState.players.length; pid++) {
      if (gameState.players[pid].zones.battlefield.get?.((source as any)._uid)) {
        srcController = pid;
        break;
      }
    }
  }
  if (srcController !== undefined) {
    (target as any)._damagedByPlayer = srcController;
    // Track Spider damage specifically (for Shelob's triggered ability)
    if ((source as any).type_line?.toLowerCase().includes('spider') || ((source as any).keywords || []).some((k: any) => (typeof k === 'string' ? k : k?.keyword || '').toLowerCase() === 'spider')) {
      (target as any)._damagedBySpider = srcController;
    }
  }

  // Fire deals_damage_to_creature trigger (East-Mark Cavalier, etc.)
  if (gameState?.fireTrigger) {
    gameState.fireTrigger('deals_damage_to_creature', {
      cardUid: (source as any)._uid,
      card: source,
      playerId: srcController,
      damagedCreature: target,
      amount,
    });
  }
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

  // Track attacker count for "attacked with N+ creatures" conditions (e.g. Minas Tirith)
  if (!gameState._attackerCountThisTurn) (gameState as any)._attackerCountThisTurn = {};
  (gameState as any)._attackerCountThisTurn[attackingPlayerId] = initialCount;

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

    if (attacker && attacker._attachments && attacker._attachments.length > 0) {
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

  // Ring-bearer Level 2+: when ring-bearer attacks, loot (draw 1, discard 1)
  // Guard: only fire once per combat (prevents double-loot if triggers cause re-entry)
  const gs = gameState as any;
  if (gs._ringLevel && gs._ringBearer && gs._ringLevel[attackingPlayerId] >= 2 && !gs._ringBearerLootFiredThisCombat) {
    const bearerUid = gs._ringBearer[attackingPlayerId];
    if (bearerUid) {
      const isAttacking = attackersSnapshot.some(a => a.uid === bearerUid);
      if (isAttacking) {
        gs._ringBearerLootFiredThisCombat = true;
        // Loot: draw 1, discard 1
        const lib = gs.players[attackingPlayerId].zones.library;
        const hand = gs.players[attackingPlayerId].zones.hand;
        const drawn = lib.drawFromTop?.();
        if (drawn) {
          hand.add?.(drawn);
          log.push(`Ring-bearer attacks: draw 1, discard 1 (loot).`);
          // Track draw count for second_draw triggers (Knights of Dol Amroth etc.)
          if (!gs._cardsDrawnThisTurn) gs._cardsDrawnThisTurn = {};
          const prevDrawn = gs._cardsDrawnThisTurn[attackingPlayerId] || 0;
          gs._cardsDrawnThisTurn[attackingPlayerId] = prevDrawn + 1;
          if (prevDrawn < 2 && prevDrawn + 1 >= 2) {
            const sdLogs = gs.fireTrigger?.('second_draw', { playerId: attackingPlayerId }) || [];
            log.push(...sdLogs);
          }
          // AI auto-discards worst card; human gets discard overlay via existing loot flow
          if (!gs.players[attackingPlayerId].isHuman) {
            const worst = hand.cards.reduce((w: any, c: any) => {
              return (!w || (c.cmc || 0) < (w.cmc || 0)) ? c : w;
            }, null);
            if (worst) {
              hand.remove?.(worst._uid);
              gs.players[attackingPlayerId].zones.graveyard.add?.(worst);
              log.push(`AI discards ${worst.name}.`);
            }
          } else {
            // Set up loot for human
            gs._pendingLoot = { playerId: attackingPlayerId, drawCount: 0, discardCount: 1, drawn: [] };
            gs.waitingForInput = { type: 'discard', playerId: attackingPlayerId, amount: 1, prompt: 'Ring-bearer loot: discard 1 card' };
          }
        }
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

  // Guard: filter out any invalid attacker entries (e.g. from UID-only pushes)
  combatState.attackers = combatState.attackers.filter((a: any) => a && typeof a === 'object' && a.card);

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
        const bPower = getCombatDamage(blocker);
        if (bPower <= 0) continue;
        dealDamageToCreature(blocker, attackEntry.card, bPower, gameState);
        if (hasKeyword(blocker, 'Deathtouch', gameState) && bPower > 0 && !hasKeyword(blocker, 'Wither', gameState)) {
          attackEntry.card._damage = getToughness(attackEntry.card);
        }
        if (hasKeyword(blocker, 'Lifelink') && bPower > 0) {
          applyLifelinkGain(defendingPlayer, bPower);
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
      const blockerPower = getCombatDamage(blocker);
      if (blockerPower <= 0) continue;

      dealDamageToCreature(blocker, attackEntry.card, blockerPower, gameState);
      if (hasKeyword(blocker, 'Deathtouch', gameState)) {
        if (!hasKeyword(blocker, 'Wither', gameState)) {
          attackEntry.card._damage = getToughness(attackEntry.card);
        }
      }
      if (hasKeyword(blocker, 'Lifelink') && blockerPower > 0) {
        applyLifelinkGain(defendingPlayer, blockerPower);
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

    const attackPower = getCombatDamage(attacker);

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
              applyLifelinkGain(attackingPlayer, pwDmg);
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
          // Protection from everything (The One Ring): block all damage this turn
          if (gameState.players[defendingPlayer.id]._protectionFromEverything) {
            log.push(`${attacker.name}'s damage prevented (protection from everything).`);
          } else
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
          vfxPlay(_attackVfx(attacker), 'p' + defendingPlayer.id);
          vfxPlayText(`-${dmg}`, 'p' + defendingPlayer.id, '#ff4a4a');

          // Lifelink
          if (hasKeyword(attacker, 'Lifelink')) {
            applyLifelinkGain(attackingPlayer, dmg);
            log.push(
              `${attacker.name} tem lifelink. +${dmg} vida. (Vida: ${attackingPlayer.life})`
            );
            vfxPlay('heal', 'p' + attackingPlayer.id);
            vfxPlayText(`+${dmg} ❤`, 'p' + attackingPlayer.id, '#4aff7a');
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

          // Ring-bearer Level 4: when ring-bearer deals combat damage to player, opponent loses 3 life
          if ((gameState as any)._ringLevel && (gameState as any)._ringBearer &&
              (gameState as any)._ringLevel[attackingPlayer.id] >= 4 &&
              (gameState as any)._ringBearer[attackingPlayer.id] === uid) {
            defendingPlayer.life -= 3;
            log.push(`Ring-bearer deals combat damage: opponent loses 3 additional life. (Life: ${defendingPlayer.life})`);
          }
          } // end else (no shield)
        }
      }
      } // end attacking player
    } else {
      // Ring-bearer Level 3+: when ring-bearer becomes blocked, destroy blocking creature
      const gs3 = gameState as any;
      if (gs3._ringLevel && gs3._ringBearer) {
        const attackerPid = attacker._controller ?? attacker._owner ?? attackingPlayer.id;
        if (gs3._ringLevel[attackerPid] >= 3 && gs3._ringBearer[attackerPid] === uid) {
          for (const { card: bl } of blockers) {
            const blPid = bl._controller ?? bl._owner ?? defendingPlayer.id;
            log.push(`Ring-bearer is blocked: ${bl.name} is destroyed.`);
            gs3.creatureDies?.(bl, blPid);
          }
        }
      }

      // Blocked - use blocker order if set, otherwise default order
      let remainingAttackPower = applyDamageModifiers(gameState, uid, attackPower);
      const order = combatState.blockerOrder[uid];
      const orderedBlockers: CombatBlockerEntry[] = order
        ? order
            .map(bUid => blockers.find(b => b.uid === bUid))
            .filter((b): b is CombatBlockerEntry => b !== undefined)
        : blockers;

      for (const { card: blocker } of orderedBlockers) {
        // Skip blockers removed from battlefield before damage (bounced, exiled, or killed by spells)
        const blockerOnBf = gameState.players[0].zones.battlefield.cards.some((c: any) => c._uid === blocker._uid) ||
                            gameState.players[1].zones.battlefield.cards.some((c: any) => c._uid === blocker._uid);
        if (!blockerOnBf) continue; // Attacker stays "blocked" but no damage exchanged

        const blockerToughness = Math.max(0, getToughness(blocker) - blocker._damage);
        const blockerPower = getCombatDamage(blocker);

        // Attacker assigns damage to this blocker (only if it still has power left)
        let dmgToBlocker = 0;
        if (remainingAttackPower > 0) {
          dmgToBlocker = Math.min(remainingAttackPower, blockerToughness);

          if (hasKeyword(attacker, 'Deathtouch', gameState) && remainingAttackPower > 0) {
            dmgToBlocker = Math.min(remainingAttackPower, 1);
          }

          dealDamageToCreature(attacker, blocker, dmgToBlocker, gameState);
          if (dmgToBlocker > 0) attacker._hasDealtDamage = true;
          remainingAttackPower -= dmgToBlocker;

          if (hasKeyword(attacker, 'Deathtouch', gameState) && dmgToBlocker > 0) {
            if (hasKeyword(attacker, 'Wither', gameState)) {
              // Wither+deathtouch: 1 -1/-1 counter kills via counters
            } else {
              blocker._damage = getToughness(blocker);
            }
          }
        }

        // Blocker ALWAYS deals damage back to attacker (regardless of attacker's remaining power).
        // In FS phase: only FS/DS blockers deal damage.
        // In regular phase: FS-only blockers already dealt in the FS-blocker sub-phase; only non-FS or DS blockers deal here.
        const blockerDeals = isFirstStrike
          ? (hasKeyword(blocker, 'First Strike', gameState) || hasKeyword(blocker, 'Double Strike', gameState))
          : (!hasKeyword(blocker, 'First Strike', gameState) || hasKeyword(blocker, 'Double Strike', gameState));
        if (blockerDeals) {
          dealDamageToCreature(blocker, attacker, blockerPower, gameState);
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

        // VFX: both strikes simultaneously; groupKey=uid so all blockers of same attacker share slot
        vfxPlayCombat(
          uid,          blocker._uid,
          blockerPower > 0 ? blocker._uid : undefined,
          blockerPower > 0 ? uid          : undefined,
          uid, // groupKey = attacker UID
        );
        if (attackPower > 0)  vfxPlayText(`-${attackPower}`,  blocker._uid, '#ff4a4a');
        if (blockerPower > 0) vfxPlayText(`-${blockerPower}`, uid,          '#ff4a4a');

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
        applyLifelinkGain(attackingPlayer, attackPower);
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
        // AI attackers: tap now (becomes_tapped triggers fire via centralized detection)
        card._tapped = true;
      }
    }
    delete combatCard._tappedByAttack;
    card._attacking = false;
  }

  // Centralized becomes_tapped detection (fires for Rescue Leopard, etc.)
  detectAndFireTapTriggers(gameState as any);

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
