// combat-sim.ts — Pure combat simulation engine for AI decision-making
// No side effects — operates on simplified creature data, returns outcomes
// Ported from legacy combat-sim.js

import type { GameCard, EngineGameState, CreatureSnapshot, CombatResult, BlockingResult, AttackResult, ActivatedAbility } from './engine-types';
import { getPower, getToughness, hasKeyword, hasIndestructible, isCreature, isLand } from './card-utils';
import { poolTotal } from './mana';

// ============================================
// Import card-utils functions used by snapshot
// ============================================
// Note: getActivatedAbilities, getTriggeredAbilities, getETBEffects need
// the effects DB system. For now we import stubs that will be filled
// when the full card engine is ported.

// Re-export the functions from card-utils that combat-sim needs
// These will be replaced with full implementations when cards.ts is ported
function _getActivatedAbilities(card: GameCard): ActivatedAbility[] {
  // Stub: will be replaced by full cards.ts implementation
  // For combat-sim, we just need to know if the creature has abilities
  return [];
}

function _getTriggeredAbilities(card: GameCard): unknown[] {
  return [];
}

function _getETBEffects(card: GameCard): unknown[] {
  return [];
}

// ============================================
// Snapshot Creation
// ============================================

export function createSnapshot(card: GameCard, gameState: EngineGameState | null = null): CreatureSnapshot {
  return {
    uid: card._uid,
    power: getPower(card),
    toughness: getToughness(card),
    damage: card._damage || 0,
    flying: hasKeyword(card, 'Flying', gameState),
    reach: hasKeyword(card, 'Reach', gameState),
    firstStrike: hasKeyword(card, 'First Strike', gameState),
    doubleStrike: hasKeyword(card, 'Double Strike', gameState),
    deathtouch: hasKeyword(card, 'Deathtouch', gameState),
    trample: hasKeyword(card, 'Trample', gameState),
    lifelink: hasKeyword(card, 'Lifelink', gameState),
    indestructible: hasIndestructible(card),
    menace: hasKeyword(card, 'Menace', gameState),
    vigilance: hasKeyword(card, 'Vigilance', gameState),
    wither: hasKeyword(card, 'Wither', gameState),
    defender: hasKeyword(card, 'Defender', gameState),
    isToken: !!card._isToken,
    cmc: card.cmc || 0,
    card,
  };
}

// ============================================
// Core Combat Simulation
// ============================================

export function simulateCombat(
  attackerSnaps: CreatureSnapshot[],
  blockerAssignment: Record<number, number[]>,
  allBlockerSnaps: CreatureSnapshot[]
): CombatResult {
  // Clone state to avoid mutation
  const atkState = attackerSnaps.map(a => ({
    ...a,
    curDamage: a.damage,
    curToughness: a.toughness,
    curPower: a.power,
    dead: false,
  }));
  const blkState = allBlockerSnaps.map(b => ({
    ...b,
    curDamage: b.damage,
    curToughness: b.toughness,
    curPower: b.power,
    dead: false,
  }));

  let playerDamage = 0;
  let lifelinkGain = 0;

  const hasFirstStrike = atkState.some(a => a.firstStrike || a.doubleStrike) ||
    blkState.some(b => b.firstStrike || b.doubleStrike);

  const phases = hasFirstStrike ? ['first', 'regular'] : ['regular'];

  for (const phase of phases) {
    for (let ai = 0; ai < atkState.length; ai++) {
      const atk = atkState[ai];
      if (atk.dead) continue;

      const atkDealsFS = atk.firstStrike || atk.doubleStrike;
      const atkDealsRegular = !atk.firstStrike || atk.doubleStrike;
      const atkDealsDamage = (phase === 'first' && atkDealsFS) || (phase === 'regular' && atkDealsRegular);

      let blockerIndices = blockerAssignment[ai] || [];

      // Menace: 1 blocker is illegal
      if (atk.menace && blockerIndices.length === 1) {
        blockerIndices = [];
      }

      if (blockerIndices.length === 0) {
        // Unblocked — damage to player
        if (atkDealsDamage && atk.curPower > 0) {
          playerDamage += atk.curPower;
          if (atk.lifelink) lifelinkGain += atk.curPower;
        }
      } else {
        // Blocked — resolve damage
        let remainingPower = atkDealsDamage ? atk.curPower : 0;

        for (const bi of blockerIndices) {
          const blk = blkState[bi];
          if (blk.dead) continue;
          if (remainingPower <= 0 && atkDealsDamage) break;

          // Attacker deals damage to blocker
          if (atkDealsDamage && remainingPower > 0) {
            const remainingTough = blk.curToughness - blk.curDamage;
            let dmg: number;
            if (atk.deathtouch) {
              dmg = Math.min(remainingPower, 1);
            } else {
              dmg = Math.min(remainingPower, remainingTough);
            }

            if (atk.wither) {
              blk.curToughness -= dmg;
              blk.curPower -= dmg;
            } else {
              blk.curDamage += dmg;
            }
            remainingPower -= dmg;

            if (atk.deathtouch && dmg > 0) {
              blk.curDamage = blk.curToughness;
            }

            if (atk.lifelink && dmg > 0) lifelinkGain += dmg;

            if (!blk.indestructible && (blk.curDamage >= blk.curToughness || blk.curToughness <= 0)) {
              blk.dead = true;
            }
          }

          // Blocker deals damage to attacker
          const blkDealsFS = blk.firstStrike || blk.doubleStrike;
          const blkDealsRegular = !blk.firstStrike || blk.doubleStrike;
          const blkDealsDamage = (phase === 'first' && blkDealsFS) || (phase === 'regular' && blkDealsRegular);

          if (blkDealsDamage && blk.curPower > 0 && !blk.dead) {
            if (blk.wither) {
              atk.curToughness -= blk.curPower;
              atk.curPower -= blk.curPower;
            } else {
              atk.curDamage += blk.curPower;
            }
            if (blk.deathtouch && blk.curPower > 0) {
              atk.curDamage = atk.curToughness;
            }

            if (!atk.indestructible && (atk.curDamage >= atk.curToughness || atk.curToughness <= 0)) {
              atk.dead = true;
            }
          }
        }

        // Trample
        if (atkDealsDamage && remainingPower > 0 && atk.trample && !atk.dead) {
          playerDamage += remainingPower;
          if (atk.lifelink) lifelinkGain += remainingPower;
        }
      }
    }
  }

  const deadAttackers = new Set<number>();
  const deadBlockers = new Set<number>();
  for (let i = 0; i < atkState.length; i++) {
    if (atkState[i].dead) deadAttackers.add(i);
  }
  for (let i = 0; i < blkState.length; i++) {
    if (blkState[i].dead) deadBlockers.add(i);
  }

  return { deadAttackers, deadBlockers, playerDamage, lifelinkGain };
}

// ============================================
// Creature Value Scoring
// ============================================

export function creatureValue(snap: CreatureSnapshot): number {
  let val = snap.power + snap.toughness;
  if (snap.flying) val += 3;
  if (snap.deathtouch) val += 3;
  if (snap.firstStrike || snap.doubleStrike) val += 2;
  if (snap.lifelink) val += 2;
  if (snap.trample) val += 1;
  if (snap.menace) val += 1;
  if (snap.indestructible) val += 6;
  if (snap.vigilance) val += 1;
  if (snap.isToken) val -= 2;
  val += Math.min(snap.cmc, 5) * 0.5;

  if (snap.card) {
    const abilities = _getActivatedAbilities(snap.card);
    if (abilities.length > 0) val += 2;
    const triggers = _getTriggeredAbilities(snap.card);
    if (triggers.length > 0) val += 1;
    const etb = _getETBEffects(snap.card);
    if (etb.length > 0) val += 1;
    if (snap.card._attachments && snap.card._attachments.length > 0) val += 2;
  }

  return val;
}

// ============================================
// Optimal Blocker Assignment
// ============================================

export function findBestBlocking(
  attackerSnaps: CreatureSnapshot[],
  blockerSnaps: CreatureSnapshot[],
  myLife: number,
  boardScore: number = 0
): BlockingResult {
  if (attackerSnaps.length === 0) {
    return {
      assignment: {},
      score: 0,
      result: { deadAttackers: new Set(), deadBlockers: new Set(), playerDamage: 0, lifelinkGain: 0 },
    };
  }
  if (blockerSnaps.length === 0) {
    const noBlockResult = simulateCombat(attackerSnaps, {}, []);
    return { assignment: {}, score: 0, result: noBlockResult };
  }

  // Legal blockers per attacker
  const legalBlockers: number[][] = [];
  for (let ai = 0; ai < attackerSnaps.length; ai++) {
    const atk = attackerSnaps[ai];
    const legal: number[] = [];
    for (let bi = 0; bi < blockerSnaps.length; bi++) {
      const blk = blockerSnaps[bi];
      if (atk.flying && !blk.flying && !blk.reach) continue;
      legal.push(bi);
    }
    legalBlockers.push(legal);
  }

  // Score function
  const scoreAssignment = (assignment: Record<number, number[]>) => {
    const result = simulateCombat(attackerSnaps, assignment, blockerSnaps);
    let score = 0;

    const totalPower = attackerSnaps.reduce((s, a) => s + a.power, 0);
    const damagePrevented = totalPower - result.playerDamage;
    score += damagePrevented * 2;

    for (const ai of result.deadAttackers) {
      score += creatureValue(attackerSnaps[ai]) * 1.5;
    }
    for (const bi of result.deadBlockers) {
      // Context-aware: when behind, losing blockers in trades is more acceptable
      const blockerLossMult = boardScore < -10 ? 0.8 : boardScore > 10 ? 1.4 : 1.2;
      score -= creatureValue(blockerSnaps[bi]) * blockerLossMult;
    }

    if (result.playerDamage >= myLife) score -= 200;
    score -= result.lifelinkGain * 0.5;

    return { score, result };
  };

  let bestAssignment: Record<number, number[]> = {};
  let bestScore = -Infinity;

  const maxAtk = Math.min(attackerSnaps.length, 6);
  const maxBlk = Math.min(blockerSnaps.length, 6);
  const usedBlockers = new Set<number>();
  const currentAssignment: Record<number, number[]> = {};

  // Greedy pass: assign best single blocker per attacker
  for (let ai = 0; ai < maxAtk; ai++) {
    const atk = attackerSnaps[ai];
    if (atk.menace) continue;

    let bestBlockerIdx = -1;
    let bestBlockScore = -Infinity;

    for (const bi of legalBlockers[ai]) {
      if (bi >= maxBlk || usedBlockers.has(bi)) continue;
      const blk = blockerSnaps[bi];

      const killsAtk = blk.power >= atk.toughness || blk.deathtouch;
      const blkSurvives = blk.toughness > atk.power && !atk.deathtouch;
      const blkIndest = blk.indestructible;

      let s = 0;
      if (killsAtk && (blkSurvives || blkIndest)) {
        s = 100 + creatureValue(atk);
      } else if (blkIndest) {
        s = 80;
      } else if (killsAtk) {
        s = 40 + (creatureValue(atk) - creatureValue(blk));
      } else if (blkSurvives) {
        s = 20 + atk.power;
      } else {
        s = -10;
      }

      if ((atk.firstStrike || atk.doubleStrike) && !(blk.firstStrike || blk.doubleStrike)) {
        if (atk.power >= blk.toughness) s -= 30;
      }
      if ((blk.firstStrike || blk.doubleStrike) && !(atk.firstStrike || atk.doubleStrike)) {
        if (blk.power >= atk.toughness) s += 15;
      }

      if (blk.deathtouch) s += 15;
      if (blk.isToken) s += 5;
      if (atk.trample) s += Math.min(blk.toughness, atk.power);

      if (s > bestBlockScore) {
        bestBlockScore = s;
        bestBlockerIdx = bi;
      }
    }

    if (bestBlockerIdx >= 0 && bestBlockScore >= 0) {
      currentAssignment[ai] = [bestBlockerIdx];
      usedBlockers.add(bestBlockerIdx);
    }
  }

  const greedyEval = scoreAssignment(currentAssignment);
  bestScore = greedyEval.score;
  bestAssignment = { ...currentAssignment };

  // Gang block pass: try pairs on unblocked attackers
  for (let ai = 0; ai < maxAtk; ai++) {
    if (currentAssignment[ai]) continue;
    const atk = attackerSnaps[ai];
    if (!atk.menace && atk.power < 3) continue;

    const availableBlockers = legalBlockers[ai].filter(bi => bi < maxBlk && !usedBlockers.has(bi));
    if (availableBlockers.length < 2) continue;

    let bestPairScore = -Infinity;
    let bestPair: [number, number] | null = null;

    for (let i = 0; i < availableBlockers.length && i < 4; i++) {
      for (let j = i + 1; j < availableBlockers.length && j < 4; j++) {
        const bi1 = availableBlockers[i];
        const bi2 = availableBlockers[j];
        const b1 = blockerSnaps[bi1];
        const b2 = blockerSnaps[bi2];

        const combinedPower = b1.power + b2.power;
        const killsAtk = combinedPower >= atk.toughness || b1.deathtouch || b2.deathtouch;
        if (!killsAtk) continue;

        const testAssignment = { ...currentAssignment, [ai]: [bi1, bi2] };
        const testEval = scoreAssignment(testAssignment);

        if (testEval.score > bestPairScore) {
          bestPairScore = testEval.score;
          bestPair = [bi1, bi2];
        }
      }
    }

    if (bestPair && bestPairScore > bestScore) {
      currentAssignment[ai] = bestPair;
      usedBlockers.add(bestPair[0]);
      usedBlockers.add(bestPair[1]);
      bestScore = bestPairScore;
      bestAssignment = { ...currentAssignment };
    }
  }

  // Lethal check: chump block to survive
  const unblockedDmg = _calcUnblockedDamage(attackerSnaps, bestAssignment);
  if (unblockedDmg >= myLife) {
    const chumpAssignment = { ...bestAssignment };
    const chumpUsed = new Set(usedBlockers);

    const unblockedAtks: { idx: number; power: number }[] = [];
    for (let ai = 0; ai < maxAtk; ai++) {
      if (!chumpAssignment[ai]) {
        unblockedAtks.push({ idx: ai, power: attackerSnaps[ai].power });
      }
    }
    unblockedAtks.sort((a, b) => b.power - a.power);

    const availSorted = blockerSnaps
      .map((b, i) => ({ idx: i, val: creatureValue(b) }))
      .filter(b => b.idx < maxBlk && !chumpUsed.has(b.idx))
      .sort((a, b) => a.val - b.val);

    let remainingDmg = unblockedDmg;
    for (const ua of unblockedAtks) {
      if (remainingDmg < myLife) break;
      const atkSnap = attackerSnaps[ua.idx];

      if (atkSnap.menace) {
        const legalAvail = availSorted.filter(b => legalBlockers[ua.idx].includes(b.idx));
        if (legalAvail.length >= 2) {
          const b1 = legalAvail[0], b2 = legalAvail[1];
          chumpAssignment[ua.idx] = [b1.idx, b2.idx];
          chumpUsed.add(b1.idx);
          chumpUsed.add(b2.idx);
          availSorted.splice(availSorted.indexOf(b1), 1);
          availSorted.splice(availSorted.indexOf(b2), 1);
          remainingDmg -= atkSnap.power;
        }
        continue;
      }

      const blocker = availSorted.find(b => legalBlockers[ua.idx].includes(b.idx));
      if (blocker) {
        chumpAssignment[ua.idx] = [blocker.idx];
        chumpUsed.add(blocker.idx);
        availSorted.splice(availSorted.indexOf(blocker), 1);
        const blkTough = blockerSnaps[blocker.idx].toughness;
        if (atkSnap.trample) {
          remainingDmg -= Math.min(blkTough, atkSnap.power);
        } else {
          remainingDmg -= atkSnap.power;
        }
      }
    }

    const chumpEval = scoreAssignment(chumpAssignment);
    if (chumpEval.score > bestScore || chumpEval.result.playerDamage < myLife) {
      bestScore = chumpEval.score;
      bestAssignment = chumpAssignment;
    }
  }

  // Try no blocks
  const noBlockEval = scoreAssignment({});
  if (noBlockEval.score > bestScore && noBlockEval.result.playerDamage < myLife) {
    bestScore = noBlockEval.score;
    bestAssignment = {};
  }

  // === PRESERVE DEFENDERS: Don't sacrifice a large % of blockers if not at lethal risk ===
  // If best assignment kills >= half our valuable blockers and doesn't prevent lethal, try
  // a conservative pass that only uses tokens/weakest blockers to chump lethal threats.
  const bestResult = simulateCombat(attackerSnaps, bestAssignment, blockerSnaps);
  const killedHighVal = [...bestResult.deadBlockers].filter(bi =>
    creatureValue(blockerSnaps[bi]) >= 5 && !blockerSnaps[bi].isToken
  ).length;
  const totalHighValBlockers = blockerSnaps.filter(b => creatureValue(b) >= 5 && !b.isToken).length;
  const wouldLoseHalfArmy = totalHighValBlockers >= 2 && killedHighVal >= Math.ceil(totalHighValBlockers / 2);
  const atLethalRisk = bestResult.playerDamage >= myLife || noBlockEval.result.playerDamage >= myLife;

  if (wouldLoseHalfArmy && !atLethalRisk) {
    // Try conservative: use tokens AND weak non-token creatures (value ≤ 2) to reduce damage
    // This avoids sacrificing the whole army when cheap blockers can absorb some hits
    const conservativeAssignment: Record<number, number[]> = {};
    const cheapBlockers = blockerSnaps
      .map((b, i) => ({ i, val: creatureValue(b) }))
      .sort((a, b) => a.val - b.val); // cheapest first
    const usedCons = new Set<number>();
    for (let ai = 0; ai < Math.min(attackerSnaps.length, 6); ai++) {
      const legalCheap = cheapBlockers.filter(b =>
        legalBlockers[ai].includes(b.i) &&
        !usedCons.has(b.i) &&
        (blockerSnaps[b.i].isToken || b.val <= 2) // Include tokens AND weak non-tokens
      );
      if (legalCheap.length > 0) {
        conservativeAssignment[ai] = [legalCheap[0].i];
        usedCons.add(legalCheap[0].i);
      }
    }
    const consEval = scoreAssignment(conservativeAssignment);
    // Accept conservative plan if it doesn't let through more than 50% extra damage
    if (consEval.result.playerDamage < myLife &&
        consEval.result.playerDamage <= bestResult.playerDamage * 1.5) {
      bestAssignment = conservativeAssignment;
      bestScore = consEval.score;
    }
  }

  return {
    assignment: bestAssignment,
    score: bestScore,
    result: simulateCombat(attackerSnaps, bestAssignment, blockerSnaps),
  };
}

// ============================================
// Optimal Attacker Selection
// ============================================

export function findBestAttackers(
  myCreatures: CreatureSnapshot[],
  oppBlockers: CreatureSnapshot[],
  oppLife: number,
  myLife: number,
  boardScore: number,
  hasCombatTrick: boolean = false
): AttackResult {
  if (myCreatures.length === 0) return { attackerIndices: [], score: 0 };

  const candidates = myCreatures.filter(c => !c.defender);
  if (candidates.length === 0) return { attackerIndices: [], score: 0 };

  // Lethal check: unblockable power
  const unblockablePower = candidates.reduce((sum, c) => {
    if (c.indestructible || c.vigilance) return sum + c.power;
    const canBeBlocked = oppBlockers.some(b => {
      if (c.flying && !b.flying && !b.reach) return false;
      return true;
    });
    if (!canBeBlocked) return sum + c.power;
    return sum;
  }, 0);

  let trampleExcess = 0;
  for (const c of candidates) {
    if (!c.trample) continue;
    const bestBlockerTough = oppBlockers
      .filter(b => !(c.flying && !b.flying && !b.reach))
      .reduce((max, b) => Math.max(max, b.toughness), 0);
    if (bestBlockerTough > 0) {
      trampleExcess += Math.max(0, c.power - bestBlockerTough);
    }
  }

  if (unblockablePower + trampleExcess >= oppLife) {
    return {
      attackerIndices: candidates.map((_, i) => i),
      score: 999,
      lethal: true,
    };
  }

  // Score each creature for attacking
  const scores = candidates.map((c, idx) => {
    let score = 0;
    score += c.power;

    if (c.vigilance) score += 4;
    if (c.indestructible) score += 5;

    const canBeBlockedBy = oppBlockers.filter(b => {
      if (c.flying && !b.flying && !b.reach) return false;
      return true;
    });

    if (canBeBlockedBy.length === 0) {
      score += c.power;
    } else if (c.flying && canBeBlockedBy.length <= 1) {
      const blocker = canBeBlockedBy[0];
      if (c.power >= blocker.toughness && c.toughness > blocker.power) {
        score += 4;
      } else if (c.toughness <= blocker.power && c.power < blocker.toughness) {
        score -= 3;
      }
    }

    if (c.menace && canBeBlockedBy.length < 2) score += c.power;
    if (c.trample && canBeBlockedBy.length > 0) {
      const bestTough = canBeBlockedBy.reduce((max, b) => Math.max(max, b.toughness), 0);
      score += Math.max(0, c.power - bestTough) * 0.5;
    }

    if (c.deathtouch) score += 2;
    if (c.lifelink) score += c.power * 0.5;

    if (c.firstStrike || c.doubleStrike) {
      const killsBeforeDmg = canBeBlockedBy.some(b => c.power >= b.toughness);
      if (killsBeforeDmg) score += 3;
    }

    if (c.isToken) score += 1;

    // Tempo attack bonus: tokens/cheap creatures that trade favorably with bigger blockers
    if (canBeBlockedBy.length > 0) {
      for (const blk of canBeBlockedBy) {
        const weKillBlocker = c.power >= blk.toughness || c.deathtouch;
        if (weKillBlocker) {
          const myVal = creatureValue(c);
          const theirVal = creatureValue(blk);
          if (theirVal > myVal + 1) {
            // Favorable trade: we kill something more valuable than us
            // Extra bonus for tokens (expendable) trading up
            const tradeBonus = (theirVal - myVal) + (c.isToken ? 2 : 0);
            score += Math.min(tradeBonus, 8); // Cap to avoid over-committing
            break; // Only count the best favorable trade
          }
        }
      }
    }

    // Risk assessment
    if (!c.indestructible && !c.vigilance && canBeBlockedBy.length > 0) {
      const bestBlocker = [...canBeBlockedBy].sort((a, b) => {
        const aKills = (a.power >= c.toughness || a.deathtouch) ? 1 : 0;
        const bKills = (b.power >= c.toughness || b.deathtouch) ? 1 : 0;
        if (aKills !== bKills) return bKills - aKills;
        return b.power - a.power;
      })[0];

      const creatureDies = bestBlocker.power >= c.toughness || bestBlocker.deathtouch;
      const blockerDies = c.power >= bestBlocker.toughness || c.deathtouch;

      if (creatureDies) {
        if (blockerDies) {
          const myVal = creatureValue(c);
          const theirVal = creatureValue(bestBlocker);
          // Context-aware trade: when losing badly, any trade that removes their threat is good
          if (boardScore < -15) {
            // Desperate: accept any trade — removing their threat > keeping our creature
            if (myVal > theirVal + 6) score -= 4;
          } else if (boardScore < -5) {
            // Behind: be more willing to trade
            if (myVal > theirVal + 5) score -= 6;
            else if (myVal > theirVal + 2) score -= 2;
          } else if (hasCombatTrick) {
            // We have a trick — maybe we won't die at all; reduce mutual kill penalty
            if (myVal > theirVal + 5) score -= 5; // Still avoid very bad trades
            else if (myVal > theirVal + 2) score -= 2;
            // else: roughly even trade is fine with a trick in hand
          } else {
            // Neutral/winning: standard evaluation
            if (myVal > theirVal + 3) score -= 8;
            else if (myVal > theirVal + 1) score -= 4;
          }
          // Bonus: removing a creature with triggered abilities is extra good
          if (bestBlocker.card) {
            const oppTriggers = (bestBlocker.card as any)._triggers;
            if (oppTriggers && oppTriggers.length >= 2) score += 3; // Remove draw engine / token machine
          }
        } else {
          // Our creature dies without killing theirs — bad
          // But if we have a combat trick, it might save this creature — reduce penalty
          const trickMult = hasCombatTrick ? 0.4 : 1.0;
          const severityMult = boardScore > 10 ? 1.2 : boardScore < -10 ? 0.6 : 1.0;
          score -= (8 + creatureValue(c) * 0.6) * severityMult * trickMult;
        }
      }
    }

    if (boardScore > 20) score -= 2;
    if (boardScore < -15) score += 3;
    if (oppLife <= 8) score += 2;

    return { idx, score, snap: c };
  });

  const threshold = 3;
  const attackerIndices = scores.filter(s => s.score >= threshold).map(s => s.idx);

  if (attackerIndices.length > 0) {
    const selectedSnaps = attackerIndices.map(i => candidates[i]);
    const simResult = findBestBlocking(selectedSnaps, oppBlockers, oppLife, boardScore);

    let totalScore = simResult.result.playerDamage * 2;
    for (const ai of simResult.result.deadAttackers) {
      totalScore -= creatureValue(selectedSnaps[ai]) * 1.5;
    }
    for (const bi of simResult.result.deadBlockers) {
      totalScore += creatureValue(oppBlockers[bi]) * 1.0;
    }
    totalScore += simResult.result.lifelinkGain * 0.5;

    if (totalScore < 0) {
      const topN = scores.filter(s => s.score >= threshold + 2).map(s => s.idx);
      if (topN.length > 0 && topN.length < attackerIndices.length) {
        const topSnaps = topN.map(i => candidates[i]);
        const topResult = findBestBlocking(topSnaps, oppBlockers, oppLife, boardScore);
        let topScore = topResult.result.playerDamage * 2;
        for (const ai of topResult.result.deadAttackers) {
          topScore -= creatureValue(topSnaps[ai]) * 1.5;
        }
        for (const bi of topResult.result.deadBlockers) {
          topScore += creatureValue(oppBlockers[bi]) * 1.0;
        }
        if (topScore > totalScore) {
          return { attackerIndices: topN, score: topScore };
        }
      }

      const freeAttackers = scores.filter(s => {
        const c = candidates[s.idx];
        if (c.vigilance || c.indestructible) return true;
        const canBeBlockedBy = oppBlockers.filter(b => {
          if (c.flying && !b.flying && !b.reach) return false;
          return true;
        });
        return canBeBlockedBy.length === 0;
      }).map(s => s.idx);

      if (freeAttackers.length > 0) {
        return { attackerIndices: freeAttackers, score: 0 };
      }

      return { attackerIndices: [], score: totalScore };
    }

    // Counter-attack lethal check: if we attack (tapping non-vigilant creatures),
    // will the opponent be able to deal lethal to us on the counter-attack?
    const finalAttackers = attackerIndices.map(i => candidates[i]);
    // Remaining defenders after attack: vigilant attackers + creatures not in candidates
    const remainingDefenders = myCreatures.filter(c =>
      c.vigilance || !finalAttackers.includes(c)
    );
    // Calculate opponent's unblocked power against remaining defenders
    let oppCounterPower = 0;
    for (const opp of oppBlockers) {
      const canBeBlocked = remainingDefenders.some(def => {
        if (opp.flying && !def.flying && !def.reach) return false;
        if (def.power <= 0) return false; // 0-power defenders are ineffective
        return true;
      });
      if (!canBeBlocked) oppCounterPower += opp.power;
    }
    // If opponent can deal lethal on counter-attack, only send safe/free attackers
    if (oppCounterPower >= myLife) {
      const safeAttackers = scores.filter(s => {
        const c = candidates[s.idx];
        if (c.vigilance || c.indestructible) return true; // safe to attack
        const canBeBlockedBy = oppBlockers.some(b => {
          if (c.flying && !b.flying && !b.reach) return false;
          return true;
        });
        return !canBeBlockedBy; // unblockable — no risk of retaliation
      }).map(s => s.idx);
      if (safeAttackers.length > 0) {
        return { attackerIndices: safeAttackers, score: totalScore };
      }
      return { attackerIndices: [], score: 0 };
    }

    return { attackerIndices, score: totalScore };
  }

  return { attackerIndices: [], score: 0 };
}

// ============================================
// Opponent Combat Potential
// ============================================

export function getOpponentCombatPotential(
  state: EngineGameState,
  opponentId: number
): { buffPotential: number; manaAvailable: number } {
  const bf = state.players[opponentId].zones.battlefield;
  const creatures = bf.cards.filter(c => isCreature(c));
  const untappedLands = bf.cards.filter(c => isLand(c) && !c._tapped).length;
  const pool = poolTotal(state.manaPool[opponentId]);
  const availMana = untappedLands + pool;

  let buffPotential = 0;

  for (const creature of creatures) {
    const abilities = _getActivatedAbilities(creature);
    for (const ability of abilities) {
      const isBuffAbility = ability.effects.some(e =>
        e.type === 'buff_self' || e.type === 'buff' || e.type === 'buff_all' ||
        e.type === 'counter_self' || e.type === 'grant'
      );
      if (!isBuffAbility) continue;

      // Extract mana cost from ability
      const cmc = _getAbilityManaCost(ability);
      const needsTap = ability.cost && typeof ability.cost === 'object' && (ability.cost as Record<string, unknown>).tap;

      if (needsTap && creature._tapped) continue;
      if (cmc > availMana) continue;

      for (const eff of ability.effects) {
        if (eff.type === 'buff_self' || eff.type === 'buff') {
          buffPotential += Math.abs(eff.power || 0) + Math.abs(eff.toughness || 0);
        }
        if (eff.type === 'counter_self') {
          buffPotential += 2;
        }
      }

      if (cmc > 0 && !(ability.once_per_turn)) {
        const activations = Math.floor(availMana / cmc);
        buffPotential += (activations - 1) * 2;
      }
    }
  }

  return { buffPotential, manaAvailable: availMana };
}

// ============================================
// Helpers
// ============================================

function _calcUnblockedDamage(attackerSnaps: CreatureSnapshot[], assignment: Record<number, number[]>): number {
  let dmg = 0;
  for (let ai = 0; ai < attackerSnaps.length; ai++) {
    if (!assignment[ai] || assignment[ai].length === 0) {
      dmg += attackerSnaps[ai].power;
    }
  }
  return dmg;
}

function _getAbilityManaCost(ability: ActivatedAbility): number {
  // Extract mana cost from ability cost string
  if (!ability.cost) return 0;
  if (typeof ability.cost === 'string') {
    const parsed = { total: 0 }; // simplified
    const symbols = (ability.cost as string).match(/\{([^}]+)\}/g) || [];
    for (const sym of symbols) {
      const val = sym.replace(/[{}]/g, '');
      if (/^\d+$/.test(val)) {
        parsed.total += parseInt(val);
      } else if ('WUBRG'.includes(val)) {
        parsed.total += 1;
      }
    }
    return parsed.total;
  }
  return 0;
}

// Legacy name aliases for ported code
export const _snapshot = createSnapshot;
