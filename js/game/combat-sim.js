// combat-sim.js — Pure combat simulation engine for AI decision-making
// No side effects — operates on simplified creature data, returns outcomes

const CombatSim = {

  // Build a lightweight creature snapshot for simulation
  // Avoids mutating actual game state
  _snapshot(card, gameState = null) {
    return {
      uid: card._uid,
      power: CardEngine.getPower(card),
      toughness: CardEngine.getToughness(card),
      damage: card._damage || 0,
      flying: CardEngine.hasKeyword(card, 'Flying', gameState),
      reach: CardEngine.hasKeyword(card, 'Reach', gameState),
      firstStrike: CardEngine.hasKeyword(card, 'First Strike', gameState),
      doubleStrike: CardEngine.hasKeyword(card, 'Double Strike', gameState),
      deathtouch: CardEngine.hasKeyword(card, 'Deathtouch', gameState),
      trample: CardEngine.hasKeyword(card, 'Trample', gameState),
      lifelink: CardEngine.hasKeyword(card, 'Lifelink', gameState),
      indestructible: CardEngine.hasIndestructible(card),
      menace: CardEngine.hasKeyword(card, 'Menace', gameState),
      vigilance: CardEngine.hasKeyword(card, 'Vigilance', gameState),
      wither: CardEngine.hasKeyword(card, 'Wither', gameState),
      defender: CardEngine.hasKeyword(card, 'Defender', gameState),
      isToken: !!card._isToken,
      cmc: card.cmc || 0,
      card: card  // reference for value scoring
    };
  },

  // Core: simulate a single combat with given assignments
  // attackerSnaps: [{power, toughness, ...}]
  // blockerAssignment: Map/Object: attackerIdx -> [blockerIdx, ...]
  // allBlockerSnaps: [{power, toughness, ...}] (pool of all blockers)
  // Returns: { deadAttackers: Set, deadBlockers: Set, playerDamage, lifelinkGain }
  simulateCombat(attackerSnaps, blockerAssignment, allBlockerSnaps) {
    // Clone damage/toughness so we don't mutate snapshots
    const atkState = attackerSnaps.map(a => ({
      ...a,
      curDamage: a.damage,
      curToughness: a.toughness,
      curPower: a.power,
      dead: false
    }));
    const blkState = allBlockerSnaps.map(b => ({
      ...b,
      curDamage: b.damage,
      curToughness: b.toughness,
      curPower: b.power,
      dead: false
    }));

    let playerDamage = 0;
    let lifelinkGain = 0;

    // Determine if there's a first strike phase needed
    const hasFirstStrike = atkState.some(a => a.firstStrike || a.doubleStrike) ||
      blkState.some(b => b.firstStrike || b.doubleStrike);

    const phases = hasFirstStrike ? ['first', 'regular'] : ['regular'];

    for (const phase of phases) {
      // Process each attacker
      for (let ai = 0; ai < atkState.length; ai++) {
        const atk = atkState[ai];
        if (atk.dead) continue;

        // Determine if attacker deals damage this phase
        const atkDealsFS = atk.firstStrike || atk.doubleStrike;
        const atkDealsRegular = !atk.firstStrike || atk.doubleStrike;
        const atkDealsDamage = (phase === 'first' && atkDealsFS) || (phase === 'regular' && atkDealsRegular);

        let blockerIndices = blockerAssignment[ai] || [];

        // Menace: illegal to block with only 1 creature — treat as unblocked
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
              let dmg;
              if (atk.deathtouch) {
                dmg = Math.min(remainingPower, 1); // 1 is lethal with deathtouch
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

              // Deathtouch: any damage is lethal
              if (atk.deathtouch && dmg > 0) {
                blk.curDamage = blk.curToughness; // mark lethal
              }

              if (atk.lifelink && dmg > 0) lifelinkGain += dmg;

              // Check blocker death
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
                atk.curDamage = atk.curToughness; // mark lethal
              }

              // Check attacker death
              if (!atk.indestructible && (atk.curDamage >= atk.curToughness || atk.curToughness <= 0)) {
                atk.dead = true;
              }
            }
          }

          // Trample: remaining damage after all blockers goes to player
          if (atkDealsDamage && remainingPower > 0 && atk.trample && !atk.dead) {
            playerDamage += remainingPower;
            if (atk.lifelink) lifelinkGain += remainingPower;
          }
        }
      }
    }

    const deadAttackers = new Set();
    const deadBlockers = new Set();
    for (let i = 0; i < atkState.length; i++) {
      if (atkState[i].dead) deadAttackers.add(i);
    }
    for (let i = 0; i < blkState.length; i++) {
      if (blkState[i].dead) deadBlockers.add(i);
    }

    return { deadAttackers, deadBlockers, playerDamage, lifelinkGain };
  },

  // Evaluate creature value (for trade scoring)
  _creatureValueSim(snap) {
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
    // CMC: expensive creatures harder to replace
    val += Math.min(snap.cmc, 5) * 0.5;
    // Activated abilities / triggers (from the card reference)
    if (snap.card) {
      const abilities = CardEngine.getActivatedAbilities(snap.card);
      if (abilities.length > 0) val += 2;
      const triggers = CardEngine.getTriggeredAbilities ? CardEngine.getTriggeredAbilities(snap.card) : [];
      if (triggers.length > 0) val += 1;
      const etb = CardEngine.getETBEffects(snap.card);
      if (etb.length > 0) val += 1;
      // Aura/equipment attachments
      if (snap.card._attachments && snap.card._attachments.length > 0) val += 2;
    }
    return val;
  },

  // Find optimal blocker assignment for the AI (defending)
  // attackerSnaps: snapshot of attacking creatures
  // blockerSnaps: snapshot of available blockers
  // Returns: { assignment: {attackerIdx: [blockerIdx,...]}, score, result }
  findBestBlocking(attackerSnaps, blockerSnaps, myLife) {
    if (attackerSnaps.length === 0) {
      return { assignment: {}, score: 0, result: { deadAttackers: new Set(), deadBlockers: new Set(), playerDamage: 0, lifelinkGain: 0 } };
    }
    if (blockerSnaps.length === 0) {
      // No blockers: all damage goes through
      const noBlockResult = this.simulateCombat(attackerSnaps, {}, []);
      return { assignment: {}, score: 0, result: noBlockResult };
    }

    // For each attacker, find which blockers can legally block it
    const legalBlockers = [];
    for (let ai = 0; ai < attackerSnaps.length; ai++) {
      const atk = attackerSnaps[ai];
      const legal = [];
      for (let bi = 0; bi < blockerSnaps.length; bi++) {
        const blk = blockerSnaps[bi];
        // Flying check
        if (atk.flying && !blk.flying && !blk.reach) continue;
        // Defender can block
        legal.push(bi);
      }
      legalBlockers.push(legal);
    }

    // Enumerate assignments using DFS with pruning
    // Each blocker can be assigned to at most one attacker
    let bestAssignment = {};
    let bestScore = -Infinity;

    // Score an assignment
    const scoreAssignment = (assignment) => {
      const result = this.simulateCombat(attackerSnaps, assignment, blockerSnaps);

      // Score = minimize damage taken + value of opponent creatures killed - value of our blockers lost
      let score = 0;

      // Damage prevented (relative to all going through)
      const totalPower = attackerSnaps.reduce((s, a) => s + a.power, 0);
      const damagePrevented = totalPower - result.playerDamage;
      score += damagePrevented * 2;

      // Value of opponent creatures we killed
      for (const ai of result.deadAttackers) {
        score += this._creatureValueSim(attackerSnaps[ai]) * 1.5;
      }

      // Cost of our blockers that died
      for (const bi of result.deadBlockers) {
        score -= this._creatureValueSim(blockerSnaps[bi]) * 1.2;
      }

      // Lethal prevention bonus
      if (result.playerDamage >= myLife) {
        score -= 200; // Dying is terrible
      }

      // Lifelink penalty (opponent gains life)
      score -= result.lifelinkGain * 0.5;

      return { score, result };
    };

    // DFS: try assigning each blocker to each legal attacker, or leaving unassigned
    // To limit combinatorics, cap at 6 attackers and 6 blockers
    const maxAtk = Math.min(attackerSnaps.length, 6);
    const maxBlk = Math.min(blockerSnaps.length, 6);

    // For manageable combinations, use iterative approach
    // Generate candidate assignments
    const usedBlockers = new Set();
    const currentAssignment = {};

    // Greedy first pass: assign perfect blocks (skip menace - needs 2+ blockers)
    for (let ai = 0; ai < maxAtk; ai++) {
      const atk = attackerSnaps[ai];
      // Menace: can't be blocked by a single creature, handle in gang-block pass
      if (atk.menace) continue;

      let bestBlockerIdx = -1;
      let bestBlockScore = -Infinity;

      for (const bi of legalBlockers[ai]) {
        if (bi >= maxBlk || usedBlockers.has(bi)) continue;
        const blk = blockerSnaps[bi];

        // Score this single block
        const killsAtk = blk.power >= atk.toughness || blk.deathtouch;
        const blkSurvives = blk.toughness > atk.power && !atk.deathtouch;
        const blkIndestructible = blk.indestructible;

        let s = 0;
        if (killsAtk && (blkSurvives || blkIndestructible)) {
          s = 100 + this._creatureValueSim(atk); // Perfect block
        } else if (blkIndestructible) {
          s = 80; // Damage absorbed, blocker lives
        } else if (killsAtk) {
          // Trade
          s = 40 + (this._creatureValueSim(atk) - this._creatureValueSim(blk));
        } else if (blkSurvives) {
          s = 20 + atk.power; // Fog effect
        } else {
          s = -10; // Bad block
        }

        // First strike modifiers
        if ((atk.firstStrike || atk.doubleStrike) && !(blk.firstStrike || blk.doubleStrike)) {
          if (atk.power >= blk.toughness) s -= 30; // blocker dies before dealing damage
        }
        if ((blk.firstStrike || blk.doubleStrike) && !(atk.firstStrike || atk.doubleStrike)) {
          if (blk.power >= atk.toughness) s += 15; // we kill before taking damage
        }

        if (blk.deathtouch) s += 15;
        if (blk.isToken) s += 5;

        // Trample: prefer high-toughness blockers
        if (atk.trample) {
          s += Math.min(blk.toughness, atk.power);
        }

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

    // Score greedy assignment
    const greedyEval = scoreAssignment(currentAssignment);
    bestScore = greedyEval.score;
    bestAssignment = { ...currentAssignment };

    // Try gang blocks on unblocked attackers (menace REQUIRES 2+, big ones worth gang-blocking)
    for (let ai = 0; ai < maxAtk; ai++) {
      if (currentAssignment[ai]) continue; // already blocked
      const atk = attackerSnaps[ai];
      if (!atk.menace && atk.power < 3) continue; // not worth gang blocking small non-menace

      const availableBlockers = legalBlockers[ai].filter(bi => bi < maxBlk && !usedBlockers.has(bi));
      if (availableBlockers.length < 2) continue;

      // Try pairs
      let bestPairScore = -Infinity;
      let bestPair = null;

      for (let i = 0; i < availableBlockers.length && i < 4; i++) {
        for (let j = i + 1; j < availableBlockers.length && j < 4; j++) {
          const bi1 = availableBlockers[i];
          const bi2 = availableBlockers[j];
          const b1 = blockerSnaps[bi1];
          const b2 = blockerSnaps[bi2];

          const combinedPower = b1.power + b2.power;
          const killsAtk = combinedPower >= atk.toughness || b1.deathtouch || b2.deathtouch;
          if (!killsAtk) continue;

          // Simulate this gang block
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

    // Lethal check: if unblocked damage >= life, must chump block
    const unblockedDmg = this._calcUnblockedDamage(attackerSnaps, bestAssignment);
    if (unblockedDmg >= myLife) {
      // Try adding chump blocks to survive
      const chumpAssignment = { ...bestAssignment };
      const chumpUsed = new Set(usedBlockers);

      // Sort unblocked attackers by power descending
      const unblockedAtks = [];
      for (let ai = 0; ai < maxAtk; ai++) {
        if (!chumpAssignment[ai]) {
          unblockedAtks.push({ idx: ai, power: attackerSnaps[ai].power });
        }
      }
      unblockedAtks.sort((a, b) => b.power - a.power);

      // Assign cheapest available blockers
      const availSorted = blockerSnaps
        .map((b, i) => ({ idx: i, val: this._creatureValueSim(b) }))
        .filter(b => b.idx < maxBlk && !chumpUsed.has(b.idx))
        .sort((a, b) => a.val - b.val);

      let remainingDmg = unblockedDmg;
      for (const ua of unblockedAtks) {
        if (remainingDmg < myLife) break;
        const atkSnap = attackerSnaps[ua.idx];
        // Menace: need 2 blockers for chump block
        if (atkSnap.menace) {
          const legalAvail = availSorted.filter(b => legalBlockers[ua.idx].includes(b.idx));
          if (legalAvail.length >= 2) {
            const b1 = legalAvail[0], b2 = legalAvail[1];
            chumpAssignment[ua.idx] = [b1.idx, b2.idx];
            chumpUsed.add(b1.idx); chumpUsed.add(b2.idx);
            availSorted.splice(availSorted.indexOf(b1), 1);
            availSorted.splice(availSorted.indexOf(b2), 1);
            remainingDmg -= atkSnap.power;
          }
          continue;
        }
        const blocker = availSorted.find(b => {
          return legalBlockers[ua.idx].includes(b.idx);
        });
        if (blocker) {
          chumpAssignment[ua.idx] = [blocker.idx];
          chumpUsed.add(blocker.idx);
          availSorted.splice(availSorted.indexOf(blocker), 1);
          // Trample: only prevents toughness worth of damage
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

    // Try "no blocks" option (sometimes better to take damage)
    const noBlockEval = scoreAssignment({});
    if (noBlockEval.score > bestScore && noBlockEval.result.playerDamage < myLife) {
      bestScore = noBlockEval.score;
      bestAssignment = {};
    }

    return {
      assignment: bestAssignment,
      score: bestScore,
      result: this.simulateCombat(attackerSnaps, bestAssignment, blockerSnaps)
    };
  },

  // Calculate unblocked damage from current assignment
  _calcUnblockedDamage(attackerSnaps, assignment) {
    let dmg = 0;
    for (let ai = 0; ai < attackerSnaps.length; ai++) {
      if (!assignment[ai] || assignment[ai].length === 0) {
        dmg += attackerSnaps[ai].power;
      }
    }
    return dmg;
  },

  // Evaluate the best set of attackers
  // myCreatures: all creatures that could attack (snapshot)
  // oppBlockers: opponent's untapped creatures (snapshot)
  // oppLife: opponent's current life
  // myLife: AI's life (for deciding aggression level)
  // Returns: { attackerIndices: [idx, ...], score, result }
  findBestAttackers(myCreatures, oppBlockers, oppLife, myLife, boardScore) {
    if (myCreatures.length === 0) return { attackerIndices: [], score: 0 };

    // Filter creatures that can actually attack
    const candidates = myCreatures.filter(c => !c.defender);
    if (candidates.length === 0) return { attackerIndices: [], score: 0 };

    // Lethal check: if total power of unblockable >= oppLife, attack with everything
    const unblockablePower = candidates.reduce((sum, c) => {
      if (c.indestructible || c.vigilance) return sum + c.power; // free to attack
      // Check if opponent can block
      const canBeBlocked = oppBlockers.some(b => {
        if (c.flying && !b.flying && !b.reach) return false;
        return true;
      });
      if (!canBeBlocked) return sum + c.power; // unblockable
      return sum;
    }, 0);

    // Also count trample excess
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
      // Attack with everything — it's lethal
      return {
        attackerIndices: candidates.map((_, i) => i),
        score: 999,
        lethal: true
      };
    }

    // Score each creature for attacking individually
    const scores = candidates.map((c, idx) => {
      let score = 0;

      // Base: damage dealt
      score += c.power;

      // No-cost attacks
      if (c.vigilance) score += 4; // doesn't tap
      if (c.indestructible) score += 5; // can't die

      // Evasion
      const canBeBlockedBy = oppBlockers.filter(b => {
        if (c.flying && !b.flying && !b.reach) return false;
        return true;
      });

      if (canBeBlockedBy.length === 0) {
        score += c.power; // unblockable = guaranteed damage
      } else if (c.flying && canBeBlockedBy.length <= 1) {
        // Only 1 flyer/reach can block
        const blocker = canBeBlockedBy[0];
        if (c.power >= blocker.toughness && c.toughness > blocker.power) {
          score += 4; // we win the trade
        } else if (c.toughness <= blocker.power && c.power < blocker.toughness) {
          score -= 3; // we lose
        }
      }

      if (c.menace && canBeBlockedBy.length < 2) {
        score += c.power; // unblockable
      }

      // Trample
      if (c.trample && canBeBlockedBy.length > 0) {
        const bestTough = canBeBlockedBy.reduce((max, b) => Math.max(max, b.toughness), 0);
        score += Math.max(0, c.power - bestTough) * 0.5;
      }

      // Deathtouch
      if (c.deathtouch) score += 2;

      // Lifelink
      if (c.lifelink) score += c.power * 0.5;

      // First Strike advantage
      if (c.firstStrike || c.doubleStrike) {
        const killsBeforeDmg = canBeBlockedBy.some(b => c.power >= b.toughness);
        if (killsBeforeDmg) score += 3;
      }

      // Token: expendable
      if (c.isToken) score += 1;

      // Risk: simulate worst-case block
      if (!c.indestructible && !c.vigilance && canBeBlockedBy.length > 0) {
        // Find best blocker opponent can assign
        const bestBlocker = canBeBlockedBy.sort((a, b) => {
          const aKills = a.power >= c.toughness || a.deathtouch;
          const bKills = b.power >= c.toughness || b.deathtouch;
          if (aKills !== bKills) return bKills - aKills;
          return b.power - a.power;
        })[0];

        const creatureDies = bestBlocker.power >= c.toughness || bestBlocker.deathtouch;
        const blockerDies = c.power >= bestBlocker.toughness || c.deathtouch;

        if (creatureDies) {
          if (blockerDies) {
            // Trade — check value
            const myVal = this._creatureValueSim(c);
            const theirVal = this._creatureValueSim(bestBlocker);
            if (myVal > theirVal + 3) score -= 8;
            else if (myVal > theirVal + 1) score -= 4;
          } else {
            // We die, they don't — very bad, never worth it
            score -= 8 + this._creatureValueSim(c) * 0.6;
          }
        }
      }

      // Board context
      if (boardScore > 20) score -= 2;
      if (boardScore < -15) score += 3;
      if (oppLife <= 8) score += 2;

      return { idx, score, snap: c };
    });

    // Select attackers with score >= threshold
    const threshold = 3;
    const attackerIndices = scores
      .filter(s => s.score >= threshold)
      .map(s => s.idx);

    // If we selected attackers, simulate opponent's best response
    if (attackerIndices.length > 0) {
      const selectedSnaps = attackerIndices.map(i => candidates[i]);
      const simResult = this.findBestBlocking(selectedSnaps, oppBlockers, oppLife);

      // Score: damage dealt - value of creatures lost + value of opponent creatures killed
      let totalScore = simResult.result.playerDamage * 2;
      for (const ai of simResult.result.deadAttackers) {
        totalScore -= this._creatureValueSim(selectedSnaps[ai]) * 1.5;
      }
      for (const bi of simResult.result.deadBlockers) {
        totalScore += this._creatureValueSim(oppBlockers[bi]) * 1.0;
      }
      totalScore += simResult.result.lifelinkGain * 0.5;

      // If total score is negative, try smaller attacker sets
      if (totalScore < 0) {
        // Try just the top-scored attackers
        const topN = scores
          .filter(s => s.score >= threshold + 2)
          .map(s => s.idx);

        if (topN.length > 0 && topN.length < attackerIndices.length) {
          const topSnaps = topN.map(i => candidates[i]);
          const topResult = this.findBestBlocking(topSnaps, oppBlockers, oppLife);
          let topScore = topResult.result.playerDamage * 2;
          for (const ai of topResult.result.deadAttackers) {
            topScore -= this._creatureValueSim(topSnaps[ai]) * 1.5;
          }
          for (const bi of topResult.result.deadBlockers) {
            topScore += this._creatureValueSim(oppBlockers[bi]) * 1.0;
          }
          if (topScore > totalScore) {
            return { attackerIndices: topN, score: topScore };
          }
        }

        // Still negative? Only attack with free attackers (vigilance, indestructible, unblockable)
        const freeAttackers = scores.filter(s => {
          const c = candidates[s.idx];
          if (c.vigilance || c.indestructible) return true;
          // Unblockable
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

      return { attackerIndices, score: totalScore };
    }

    return { attackerIndices: [], score: 0 };
  },

  // Check if opponent has combat-relevant activated abilities (buffs)
  // Returns: { buffPotential: number, manaAvailable: number }
  getOpponentCombatPotential(state, opponentId) {
    const bf = state.players[opponentId].zones.battlefield;
    const creatures = bf.cards.filter(c => CardEngine.isCreature(c));
    const untappedLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped).length;
    const pool = ManaSystem.poolTotal(state.manaPool[opponentId]);
    const availMana = untappedLands + pool;

    let buffPotential = 0;

    for (const creature of creatures) {
      const abilities = CardEngine.getActivatedAbilities(creature);
      for (const ability of abilities) {
        const isBuffAbility = ability.effects.some(e =>
          e.type === 'buff_self' || e.type === 'buff' || e.type === 'buff_all' ||
          e.type === 'counter_self' || e.type === 'grant'
        );
        if (!isBuffAbility) continue;

        // Check if they can afford it
        const { cmc } = GameAI._getAbilityManaCost(ability);
        const needsTap = ability.cost.tap;

        if (needsTap && creature._tapped) continue;
        if (cmc > availMana) continue;

        // Estimate buff amount
        for (const eff of ability.effects) {
          if (eff.type === 'buff_self' || eff.type === 'buff') {
            buffPotential += Math.abs(eff.power || 0) + Math.abs(eff.toughness || 0);
          }
          if (eff.type === 'counter_self') {
            buffPotential += 2; // +1/+1 counter
          }
        }

        // Count how many times they can activate (based on mana)
        if (cmc > 0 && !ability.cost.once_per_turn) {
          const activations = Math.floor(availMana / cmc);
          buffPotential += (activations - 1) * 2; // Extra activations
        }
      }
    }

    return { buffPotential, manaAvailable: availMana };
  }
};
