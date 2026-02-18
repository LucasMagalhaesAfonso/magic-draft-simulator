const CombatSystem = {
  // Helper: deal damage from source to creature, respecting wither
  _dealDamageToCreature(source, target, amount) {
    if (amount <= 0) return;
    if (CardEngine.hasKeyword(source, 'Wither')) {
      // Wither: damage as -1/-1 counters (getPower/getToughness already read counters)
      if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
      target._counters['-1/-1'] += amount;
    } else {
      target._damage += amount;
    }
    // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
    target._damagedThisTurn = true;
  },

  // Helper: calculate modified damage considering double damage effects (Neriv, etc.)
  _applyDamageModifiers(gameState, attackerId, baseDamage) {
    if (baseDamage <= 0) return baseDamage;

    // Find the attacker card
    const attacker = gameState.players[0].zones.battlefield.get(attackerId) ||
                    gameState.players[1].zones.battlefield.get(attackerId);
    if (!attacker) return baseDamage;

    let finalDamage = baseDamage;

    // Check for double damage effects (like Neriv, Heart of the Storm)
    gameState.players.forEach(player => {
      player.zones.battlefield.cards.forEach(permanent => {
        if (permanent._doubleDamage) {
          const target = permanent._doubleDamage;
          if (target === 'creatures_entered_this_turn' && attacker._enteredThisTurn) {
            finalDamage *= 2;
          }
        }
      });
    });

    return finalDamage;
  },

  createCombatState() {
    return {
      attackers: [],      // [{uid, card}]
      blockers: {},       // {attackerUid: [{uid, card}]}
      blockerOrder: {},   // {attackerUid: [blockerUid1, blockerUid2, ...]} - damage assignment order
      _blockerOrderDone: false,
      phase: 'none'       // none, declare_attackers, declare_blockers, damage
    };
  },

  // Returns attacker UIDs that have 2+ blockers (need ordering)
  getMultiBlockedAttackers(combatState) {
    const result = [];
    for (const [attackerUid, blockers] of Object.entries(combatState.blockers)) {
      if (blockers.length >= 2) {
        result.push(attackerUid);
      }
    }
    return result;
  },

  // Set the damage assignment order for blockers on a specific attacker
  setBlockerOrder(combatState, attackerUid, orderedBlockerUids) {
    combatState.blockerOrder[attackerUid] = orderedBlockerUids;
  },

  declareAttacker(combatState, card) {
    if (!CardEngine.canAttack(card)) return false;
    combatState.attackers.push({ uid: card._uid, card });
    card._attacking = true;
    return true;
  },

  removeAttacker(combatState, uid) {
    const idx = combatState.attackers.findIndex(a => a.uid === uid);
    if (idx === -1) return;
    combatState.attackers[idx].card._attacking = false;
    combatState.attackers.splice(idx, 1);
    delete combatState.blockers[uid];
  },

  declareBlocker(combatState, blocker, attackerUid, gameState = null) {
    const attacker = combatState.attackers.find(a => a.uid === attackerUid);
    if (!attacker) return false;
    if (!CardEngine.canBlock(blocker, attacker.card, gameState)) return false;

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
  },

  removeBlocker(combatState, uid) {
    for (const [attackerUid, blockers] of Object.entries(combatState.blockers)) {
      const idx = blockers.findIndex(b => b.uid === uid);
      if (idx !== -1) {
        blockers[idx].card._blocking = null;
        blockers.splice(idx, 1);
        if (blockers.length === 0) delete combatState.blockers[attackerUid];
        return;
      }
    }
  },

  // Call this when attackers are confirmed (before blockers)
  fireAttackTriggers(combatState, gameState, attackingPlayerId) {
    const log = [];
    for (const { uid, card: attacker } of combatState.attackers) {
      // Fire "attacks" trigger
      const atkLogs = GameState.fireTrigger(gameState, 'attacks', {
        cardUid: uid,
        card: attacker,
        controllerId: attackingPlayerId,
        attackingCreatureCount: combatState.attackers.length
      });
      log.push(...atkLogs);

      // Fire "enters_or_attacks" trigger (for cards like Inspirited Vanguard)
      const enterOrAtkLogs = GameState.fireTrigger(gameState, 'enters_or_attacks', {
        cardUid: uid,
        attacking: true,
        playerId: attackingPlayerId
      });
      log.push(...enterOrAtkLogs);

      // Fire equipped_attacks if creature has equipment attached
      if (attacker._attachments && attacker._attachments.length > 0) {
        const hasEquip = attacker._attachments.some(aUid => {
          const att = gameState.players[attackingPlayerId].zones.battlefield.get(aUid);
          return att && CardEngine.isEquipment(att);
        });
        if (hasEquip) {
          const eqAtkLogs = GameState.fireTrigger(gameState, 'equipped_attacks', {
            cardUid: uid, card: attacker, playerId: attackingPlayerId
          });
          log.push(...eqAtkLogs);
        }
      }
    }
    return log;
  },

  resolveCombatDamage(combatState, attackingPlayer, defendingPlayer, gameState) {
    const log = [];
    const attackingId = attackingPlayer.id;
    const defendingId = defendingPlayer.id;

    // First strike damage phase
    const firstStrikers = combatState.attackers.filter(a =>
      CardEngine.hasKeyword(a.card, 'First Strike', gameState) || CardEngine.hasKeyword(a.card, 'Double Strike', gameState)
    );

    if (firstStrikers.length > 0) {
      const firstStrikeLog = this._resolveDamagePhase(firstStrikers, combatState, attackingPlayer, defendingPlayer, gameState, true);
      log.push(...firstStrikeLog);
      this._cleanupDead(gameState);
    }

    // Regular damage phase
    const regularAttackers = combatState.attackers.filter(a => {
      const card = a.card;
      if (card._damage >= CardEngine.getToughness(card)) return false;
      if (CardEngine.hasKeyword(card, 'First Strike', gameState) && !CardEngine.hasKeyword(card, 'Double Strike', gameState)) return false;
      return true;
    });

    const regularLog = this._resolveDamagePhase(regularAttackers, combatState, attackingPlayer, defendingPlayer, gameState, false);
    log.push(...regularLog);

    // Cleanup
    this._cleanupDead(gameState);
    this._resetCombatState(combatState, gameState);

    return log;
  },

  _resolveDamagePhase(attackers, combatState, attackingPlayer, defendingPlayer, gameState, isFirstStrike) {
    const log = [];
    let vfxDelay = 0;
    const VFX_STEP = 500; // ms between each combat pair animation

    for (const { uid, card: attacker } of attackers) {
      const blockers = combatState.blockers[uid] || [];
      const attackPower = CardEngine.getPower(attacker);

      if (blockers.length === 0) {
        // Unblocked - damage to defending player
        let dmg = this._applyDamageModifiers(gameState, uid, attackPower);
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
              if (typeof fireTrigger === 'function') {
                fireTrigger(gameState, 'prevent_damage', defendingPlayer.id, { prevented, source: attacker });
              }
            }
          }

          if (dmg > 0) {
            defendingPlayer.life -= dmg;
            // Track damage dealt this turn (for Spinerock Knoll hideaway)
            if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
            gameState._damageDealtThisTurn[defendingPlayer.id] = (gameState._damageDealtThisTurn[defendingPlayer.id] || 0) + dmg;
            log.push(`${attacker.name} ataca e causa ${dmg} de dano. (Vida: ${defendingPlayer.life})`);
            // Staggered VFX per attacker — element-aware
            if (typeof VFX !== 'undefined') {
              const d = vfxDelay;
              const atkCard = attacker;
              setTimeout(() => {
                VFX.elementAttackPlayer(atkCard._uid, atkCard, defendingPlayer.id);
              }, d);
            }
            vfxDelay += VFX_STEP;

            // Lifelink
            if (CardEngine.hasKeyword(attacker, 'Lifelink')) {
              attackingPlayer.life += dmg;
              log.push(`${attacker.name} tem lifelink. +${dmg} vida. (Vida: ${attackingPlayer.life})`);
              if (typeof VFX !== 'undefined') {
                const d = vfxDelay - 200;
                setTimeout(() => VFX.heal(attackingPlayer.id), d);
              }
            }

            // Fire combat_damage_player trigger
            const cbtLogs = GameState.fireTrigger(gameState, 'combat_damage_player', { cardUid: uid, card: attacker, amount: dmg });
            log.push(...cbtLogs);
          }
        }
      } else {
        // Blocked - use blocker order if set, otherwise default order
        let remainingAttackPower = this._applyDamageModifiers(gameState, uid, attackPower);
        const order = combatState.blockerOrder[uid];
        const orderedBlockers = order
          ? order.map(bUid => blockers.find(b => b.uid === bUid)).filter(Boolean)
          : blockers;

        for (const { card: blocker } of orderedBlockers) {
          if (remainingAttackPower <= 0) break;

          const blockerToughness = CardEngine.getToughness(blocker) - blocker._damage;
          const blockerPower = CardEngine.getPower(blocker);

          let dmgToBlocker = Math.min(remainingAttackPower, blockerToughness);

          if (CardEngine.hasKeyword(attacker, 'Deathtouch', gameState) && remainingAttackPower > 0) {
            dmgToBlocker = Math.min(remainingAttackPower, 1);
          }

          this._dealDamageToCreature(attacker, blocker, dmgToBlocker);
          remainingAttackPower -= dmgToBlocker;

          if (CardEngine.hasKeyword(attacker, 'Deathtouch', gameState) && dmgToBlocker > 0) {
            if (CardEngine.hasKeyword(attacker, 'Wither', gameState)) {
              // Wither+deathtouch: 1 -1/-1 counter kills via counters
            } else {
              blocker._damage = CardEngine.getToughness(blocker);
            }
          }

          // Blocker deals damage to attacker
          if (!isFirstStrike || CardEngine.hasKeyword(blocker, 'First Strike', gameState) || CardEngine.hasKeyword(blocker, 'Double Strike', gameState)) {
            this._dealDamageToCreature(blocker, attacker, blockerPower);
            if (CardEngine.hasKeyword(blocker, 'Deathtouch', gameState) && blockerPower > 0) {
              if (!CardEngine.hasKeyword(blocker, 'Wither', gameState)) {
                attacker._damage = CardEngine.getToughness(attacker);
              }
            }

            // Blocker lifelink
            if (CardEngine.hasKeyword(blocker, 'Lifelink') && blockerPower > 0) {
              defendingPlayer.life += blockerPower;
            }
          }

          // Staggered VFX: attacker hits blocker, then blocker hits attacker — element-aware
          if (typeof VFX !== 'undefined') {
            const d = vfxDelay;
            const atkCard = attacker;
            const blkCard = blocker;
            const dToB = dmgToBlocker;
            const bPow = blockerPower;
            const canHitBack = !isFirstStrike || CardEngine.hasKeyword(blocker, 'First Strike', gameState) || CardEngine.hasKeyword(blocker, 'Double Strike', gameState);
            setTimeout(() => {
              VFX.elementAttack(atkCard._uid, atkCard, blkCard._uid);
              if (dToB > 0) setTimeout(() => VFX.animateCard(blkCard._uid, 'shake', 400), 200);
              if (canHitBack && bPow > 0) setTimeout(() => VFX.elementAttack(blkCard._uid, blkCard, atkCard._uid), 350);
            }, d);
          }
          vfxDelay += VFX_STEP;

          log.push(`${attacker.name} (${attackPower}/${CardEngine.getToughness(attacker)}) combate com ${blocker.name} (${blockerPower}/${CardEngine.getToughness(blocker)})`);
        }

        // Trample - remaining damage goes to player
        if (remainingAttackPower > 0 && CardEngine.hasKeyword(attacker, 'Trample')) {
          defendingPlayer.life -= remainingAttackPower;
          // Track trample damage for Spinerock Knoll hideaway
          if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
          gameState._damageDealtThisTurn[defendingPlayer.id] = (gameState._damageDealtThisTurn[defendingPlayer.id] || 0) + remainingAttackPower;
          log.push(`${attacker.name} tem trample. ${remainingAttackPower} dano ao jogador. (Vida: ${defendingPlayer.life})`);

          if (typeof VFX !== 'undefined') {
            const d = vfxDelay;
            setTimeout(() => VFX.playerDamage(defendingPlayer.id), d);
          }

          // Trample combat damage trigger
          const trampleLogs = GameState.fireTrigger(gameState, 'combat_damage_player', { cardUid: uid, card: attacker, amount: remainingAttackPower });
          log.push(...trampleLogs);
        }

        // Attacker lifelink on damage dealt (uses POWER, not actual damage dealt)
        // Magic rules: lifelink gains life equal to power when creature deals combat damage
        if (CardEngine.hasKeyword(attacker, 'Lifelink') && attackPower > 0) {
          attackingPlayer.life += attackPower;
        }
      }
    }

    return log;
  },

  _cleanupDead(gameState) {
    for (const playerId of [0, 1]) {
      const bf = gameState.players[playerId].zones.battlefield;
      const dead = bf.cards.filter(c =>
        CardEngine.isCreature(c) && (c._damage >= CardEngine.getToughness(c) || CardEngine.getToughness(c) <= 0)
      );
      dead.forEach(c => {
        const died = GameState.creatureDies(gameState, c, playerId);
        if (died) {
          gameState.log.push(`${c.name} morre.`);
        } else {
          // Indestructible - reset damage
          gameState.log.push(`${c.name} e indestruivel! Sobrevive.`);
        }
      });
    }
  },

  _resetCombatState(combatState, gameState) {
    // Tap attackers (unless vigilance) and fire becomes_tapped triggers
    // Note: human attackers are already tapped at declaration (confirmAttackers)
    combatState.attackers.forEach(({ card }) => {
      if (!CardEngine.hasKeyword(card, 'Vigilance')) {
        if (!card._tappedByAttack) {
          // AI attackers: tap now and fire triggers
          const wasTapped = card._tapped;
          card._tapped = true;
          if (!wasTapped && gameState) {
            const tapLogs = GameState.fireTrigger(gameState, 'becomes_tapped', {
              cardUid: card._uid,
              card: card,
              controllerId: gameState.activePlayer
            });
            if (tapLogs.length > 0) gameState.log.push(...tapLogs);
          }
        }
      }
      delete card._tappedByAttack;
      card._attacking = false;
    });

    // Reset blockers
    for (const blockers of Object.values(combatState.blockers)) {
      blockers.forEach(({ card }) => {
        card._blocking = null;
      });
    }

    // NOTE: Damage is NOT reset here - it persists until cleanup step
    // This is handled in GameState._endOfTurnCleanup()

    combatState.attackers = [];
    combatState.blockers = {};
    combatState.blockerOrder = {};
    combatState._blockerOrderDone = false;
    combatState.phase = 'none';
  },

  // Validate blockers - check menace requirements
  validateBlockers(combatState) {
    const invalidBlocks = [];
    for (const { uid, card: attacker } of combatState.attackers) {
      const blockers = combatState.blockers[uid] || [];
      // Menace: must be blocked by 2+ creatures, or not at all
      if (CardEngine.hasKeyword(attacker, 'Menace') && blockers.length === 1) {
        invalidBlocks.push({
          attacker,
          reason: `${attacker.name} tem Menace - precisa de 2+ bloqueadores ou nenhum`
        });
      }
    }
    return invalidBlocks;
  }
};
