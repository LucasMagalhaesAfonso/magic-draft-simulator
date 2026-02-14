const GameAI = {
  playMainPhase(state, playerId) {
    const player = state.players[playerId];
    const hand = player.zones.hand;
    const bf = player.zones.battlefield;
    const opponentId = playerId === 0 ? 1 : 0;

    // 1. Play a land if possible (from hand or exiled playable)
    const handLands = hand.getAll().filter(c => CardEngine.isLand(c));
    const exiledLands = (state._exiledPlayable ? Object.values(state._exiledPlayable).filter(e => e.controller === playerId && CardEngine.isLand(e.card)).map(e => e.card) : []);
    const lands = [...handLands, ...exiledLands];
    if (lands.length > 0 && !state.landPlayedThisTurn) {
      const colorNeeds = this._getColorNeeds(hand.getAll());
      let bestLand = lands[0];
      let bestScore = -1;
      for (const land of lands) {
        const color = ManaSystem.getLandManaColor(land);
        const score = colorNeeds[color] || 0;
        if (score > bestScore) {
          bestScore = score;
          bestLand = land;
        }
      }
      GameState.playLand(state, playerId, bestLand._uid);
    }

    // 2. Cast spells strategically
    // Priority: ramp early > removal on threats > creatures on curve > other spells
    let playedSomething = true;
    while (playedSomething) {
      playedSomething = false;
      const playable = GameState.getPlayableCards(state, playerId)
        .filter(c => !CardEngine.isLand(c));

      if (playable.length === 0) break;

      const landCount = bf.cards.filter(c => CardEngine.isLand(c)).length;
      const opponentCreatures = state.players[opponentId].zones.battlefield.cards
        .filter(c => CardEngine.isCreature(c));
      const myCreatures = bf.cards.filter(c => CardEngine.isCreature(c));
      const opponentLife = state.players[opponentId].life;
      const myLife = state.players[playerId].life;
      const myHandSize = hand.getAll().length;

      // Check for instants worth holding mana for
      const instantsInHand = hand.getAll().filter(c => {
        const tl = (c.type_line || '').toLowerCase();
        return tl.includes('instant') || CardEngine.hasKeyword(c, 'Flash');
      });
      const cheapestInstantCost = instantsInHand.length > 0
        ? Math.min(...instantsInHand.map(c => c.cmc || 1))
        : 99;
      const hasValuableInstant = instantsInHand.some(c => {
        const effs = CardEngine.getSpellEffects(c);
        return effs.some(e => e.type === 'buff' || e.type === 'destroy' || e.type === 'exile' || e.type === 'damage' || e.type === 'draw');
      });

      const scored = playable.map(card => {
        let score = 0;
        const effects = CardEngine.getSpellEffects(card);
        const cmc = card.cmc || 0;

        // Base: prefer playing bigger spells when we can (on curve)
        score += Math.min(cmc, 5);

        // === RAMP: Huge priority early game (unless under threat) ===
        if (effects.some(e => e.type === 'ramp')) {
          const oppBoardPower = opponentCreatures.reduce((sum, c) => sum + CardEngine.getPower(c), 0);
          if (oppBoardPower >= myLife * 0.7) {
            score += 1; // Under threat - don't waste time ramping
          } else if (landCount <= 3) score += 15;
          else if (landCount <= 5) score += 8;
          else score += 2;
        }

        // === REMOVAL: Context-aware priority with hold logic ===
        if (effects.some(e => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage' || e.type === 'debuff')) {
          const targetable = opponentCreatures.filter(c => CardEngine.canBeTargeted(c, playerId));
          if (targetable.length > 0) {
            const biggestThreatScore = Math.max(...targetable.map(c => this._threatScore(c)), 0);
            const boardScore = this._evaluateBoard(state, playerId);
            score += 6 + biggestThreatScore * 0.8;
            // More urgent when we have no blockers
            if (myCreatures.length === 0 && opponentCreatures.length > 0) score += 5;
            // Extra bonus if we'd die to attacks next turn
            const totalOppPower = targetable.reduce((sum, c) => sum + CardEngine.getPower(c), 0);
            if (totalOppPower >= myLife) score += 8;
            // Hold premium removal (destroy/exile) for bigger threats when not under pressure
            const isPremiumRemoval = effects.some(e => e.type === 'destroy' || e.type === 'exile');
            if (isPremiumRemoval && biggestThreatScore < 4 && boardScore > 0 && totalOppPower < myLife * 0.6) {
              score -= 6; // Small threat, we're safe — hold removal for later
            }
            // If opponent likely has bigger creatures coming (early game), prefer holding
            if (isPremiumRemoval && landCount <= 4 && biggestThreatScore < 5 && boardScore >= 0) {
              score -= 3; // Early game, bigger threats are coming
            }
            // Less urgent when already ahead
            if (boardScore > 20) score -= 4;
          } else if (opponentCreatures.length > 0) {
            score -= 5; // All hexproof, skip
          } else {
            score -= 50; // No opponent creatures at all — don't waste removal
          }
        }

        // === BOARD WIPES: Only when behind on board ===
        if (effects.some(e => e.type === 'destroy_all' || e.type === 'damage_all_creatures' || e.type === 'exile_all')) {
          const oppBoardPower = opponentCreatures.reduce((sum, c) => sum + CardEngine.getPower(c), 0);
          const myBoardPower = myCreatures.reduce((sum, c) => sum + CardEngine.getPower(c), 0);
          if (opponentCreatures.length >= myCreatures.length + 2) score += 20;
          else if (oppBoardPower > myBoardPower * 1.5) score += 15;
          else if (opponentCreatures.length > myCreatures.length) score += 8;
          else score -= 8; // Don't wipe when ahead
        }

        // === CREATURES: Backbone of limited ===
        if (CardEngine.isCreature(card)) {
          const boardScore = this._evaluateBoard(state, playerId);
          // Base creature value adapts to board state
          if (myCreatures.length === 0) score += 10; // Need board presence!
          else if (boardScore < -5) score += 8; // Behind - need bodies
          else if (boardScore > 15) score += 5; // Ahead - less urgent
          else score += 7; // Even - solid play

          // Play on curve: bonus for filling the curve
          if (cmc <= landCount && cmc >= landCount - 1) score += 3;
          if (cmc === 2 && landCount === 2) score += 4; // T2 creature = great tempo

          // P/T quality bonus
          const cardPow = CardEngine.getPower(card);
          const cardTough = CardEngine.getToughness(card);
          if (cardPow >= 3) score += 1;
          if (cardPow >= 5) score += 2; // Bomb-level power
          if (cardTough >= 4) score += 1; // Survives most combats

          // Keywords matter
          if (CardEngine.hasKeyword(card, 'Flying')) score += 2;
          if (CardEngine.hasKeyword(card, 'Haste')) score += 2;
          if (CardEngine.hasKeyword(card, 'Deathtouch')) score += 1;
          if (CardEngine.hasKeyword(card, 'Lifelink') && myLife < 10) score += 3;
          if (CardEngine.hasKeyword(card, 'Vigilance')) score += 1;
          if (CardEngine.hasKeyword(card, 'Trample') && cardPow >= 4) score += 1;

          // ETB effects
          const etbEffects = CardEngine.getETBEffects(card);
          for (const etb of etbEffects) {
            if (etb.type === 'destroy' || etb.type === 'exile') {
              if (opponentCreatures.length > 0) score += 8;
              else score += 1; // No targets, but creature body still has value
            }
            else if (etb.type === 'debuff') {
              if (opponentCreatures.length > 0) score += 6;
              else score += 0;
            }
            else if (etb.type === 'draw') score += 3 * (etb.amount || 1);
            else if (etb.type === 'create_token') score += 3 * (etb.count || 1);
            else if (etb.type === 'bounce') {
              if (opponentCreatures.length > 0) score += 5;
              else score += 1;
            }
            else if (etb.type === 'gainLife') score += 1;
            else if (etb.type === 'fight') {
              if (myCreatures.length > 0 && opponentCreatures.length > 0) score += 5;
              else score += 1;
            }
            else if (etb.type === 'damage') {
              if (opponentCreatures.length > 0) score += 3;
              else score += 0;
            }
            else if (etb.type === 'ramp') score += 4;
          }

          // Tribal synergy: check board triggers that benefit from this creature's type
          if (state._triggers) {
            for (const trig of state._triggers) {
              if (trig.playerId !== playerId) continue;
              // Dragon enters triggers
              if (trig.event === 'dragon_enters' && CardEngine.hasCreatureType(card, 'Dragon')) {
                score += 4;
              }
              // creature_etb triggers from our permanents
              if (trig.event === 'creature_etb' || trig.event === 'other_creature_enters') {
                score += 2;
              }
            }
          }
          // Anthem synergy: if we have anthems, each new creature is worth more
          const myBfCards = bf.cards;
          for (const bfCard of myBfCards) {
            if (bfCard._anthem) score += 2; // Each anthem boosts new creatures
          }
        }

        // === AURAS: Risky but strong when ahead ===
        if (CardEngine.isAura(card)) {
          if (myCreatures.length > 0) {
            score += 5;
            // Better when we have evasion creatures
            if (myCreatures.some(c => CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace'))) {
              score += 3;
            }
            // Risky when opponent has removal — card disadvantage risk
            if (opponentCreatures.length > 0) {
              const oppHasRemoval = state.players[opponentId].zones.hand.count() >= 2;
              if (oppHasRemoval) score -= 2; // Opponent might have answers
            }
            // Better on hexproof/indestructible creatures (less risk)
            if (myCreatures.some(c => CardEngine.hasKeyword(c, 'Hexproof') || CardEngine.hasKeyword(c, 'Indestructible'))) {
              score += 4;
            }
          } else {
            score -= 15; // No target, don't cast
          }
        }

        // === PLANESWALKERS: High value permanents ===
        if (CardEngine.isPlaneswalker(card)) {
          score += 8; // Bombs in limited
          if (opponentCreatures.length >= 3) score -= 3; // Vulnerable to attacks
        }

        // === EQUIPMENT ===
        if (CardEngine.isEquipment(card)) {
          if (myCreatures.length > 0) score += 4;
          else score += 1;
        }

        // === CARD DRAW: Better when running low on cards ===
        if (effects.some(e => e.type === 'draw')) {
          const drawAmt = effects.find(e => e.type === 'draw')?.amount || 1;
          score += 2 + drawAmt * 2; // Each card drawn is worth +2
          if (myHandSize <= 2) score += 4; // Need gas!
          // Cantrips on creatures = card advantage (2-for-1)
          if (CardEngine.isCreature(card)) score += 3;
        }

        // === TOKEN CREATION ===
        if (effects.some(e => e.type === 'create_token')) {
          score += 4;
          if (myCreatures.length === 0) score += 3; // Need board presence
        }

        // === COUNTERS ===
        if (effects.some(e => e.type === 'counter' || e.type === 'counter_all')) {
          if (myCreatures.length > 0) score += 4;
          if (myCreatures.length >= 3) score += 2; // Counter_all better with more creatures
        }

        // === INSTANTS: Strongly prefer holding for opponent's turn ===
        if ((card.type_line || '').toLowerCase().includes('instant')) {
          const isRemoval = effects.some(e => e.type === 'destroy' || e.type === 'exile');
          const isBuff = effects.some(e => e.type === 'buff');
          if (isBuff) {
            score -= 15; // Never cast combat tricks in main phase
          } else if (isRemoval && state.phase === 'main1') {
            score -= 0; // Pre-combat removal is OK (clears blockers)
          } else {
            score -= 10; // Hold draw/bounce/tap for opponent's end step
          }
        }

        // === DISCARD ===
        if (effects.some(e => e.type === 'discard' && e.target === 'opponent')) score += 3;

        // === SCRY/SURVEIL ===
        if (effects.some(e => e.type === 'scry' || e.type === 'surveil')) score += 2;

        // === DRAIN ===
        if (effects.some(e => e.type === 'drain')) score += 5;

        // === LOOT ===
        if (effects.some(e => e.type === 'loot')) {
          score += 3;
          if (myHandSize <= 2) score += 3;
        }

        // === LOOK_TOP ===
        if (effects.some(e => e.type === 'look_top')) score += 3;

        // === GRANT / GRANT_ALL ===
        if (effects.some(e => e.type === 'grant' || e.type === 'grant_all')) {
          if (myCreatures.length > 0) score += 3;
        }

        // === EXILE_TOP_PLAY: Virtual card advantage ===
        if (effects.some(e => e.type === 'exile_top_play')) score += 5;

        // === SEARCH_LIBRARY: Tutoring ===
        if (effects.some(e => e.type === 'search_library')) score += 6;

        // === GAIN_CONTROL: Very strong ===
        if (effects.some(e => e.type === 'gain_control')) {
          if (opponentCreatures.length > 0) score += 12;
          else score -= 5;
        }

        // === DISTRIBUTE/GRANT COUNTERS ===
        if (effects.some(e => e.type === 'distribute_counters' || e.type === 'grant_counter' || e.type === 'grant_counters')) {
          if (myCreatures.length > 0) score += 4;
        }

        // === EXTRA COMBAT ===
        if (effects.some(e => e.type === 'extra_combat')) {
          if (myCreatures.length >= 2) score += 8;
          else score += 1;
        }

        // === COPY SPELL ===
        if (effects.some(e => e.type === 'copy_spell' || e.type === 'copy_next_spell')) score += 4;

        // === ANTHEM: Better with more creatures ===
        if (effects.some(e => e.type === 'anthem')) {
          score += 3 + myCreatures.length * 2;
        }

        // === BOUNCE_TO_LIBRARY_TOP: Better than bounce ===
        if (effects.some(e => e.type === 'bounce_to_library_top')) {
          if (opponentCreatures.length > 0) score += 7;
        }

        // === UNTAP_ALL ===
        if (effects.some(e => e.type === 'untap_all')) score += 3;

        // === FIGHT: Only good when we have bigger creature ===
        if (effects.some(e => e.type === 'fight')) {
          const targetableOpp = opponentCreatures.filter(c => CardEngine.canBeTargeted(c, playerId));
          if (myCreatures.length > 0 && targetableOpp.length > 0) {
            const bestMyPower = Math.max(...myCreatures.map(c => CardEngine.getPower(c)));
            const weakestOppTough = Math.min(...targetableOpp.map(c => CardEngine.getToughness(c)));
            if (bestMyPower >= weakestOppTough) score += 8;
            else score -= 3; // Would lose the fight
          } else {
            score -= 5; // No good fight target
          }
        }

        // === BOUNCE ===
        if (effects.some(e => e.type === 'bounce')) {
          const targetable = opponentCreatures.filter(c => CardEngine.canBeTargeted(c, playerId));
          if (targetable.length > 0) {
            // Better on expensive creatures (tempo advantage)
            const biggestCmc = Math.max(...targetable.map(c => c.cmc || 0), 0);
            score += 4 + biggestCmc;
          }
        }

        // === TAP ===
        if (effects.some(e => e.type === 'tap')) {
          const targetable = opponentCreatures.filter(c => CardEngine.canBeTargeted(c, playerId) && !c._tapped);
          if (targetable.length > 0) score += 3;
        }

        // === EFFICIENCY: Prefer spending all mana each turn ===
        const availableMana = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped).length
          + ManaSystem.poolTotal(state.manaPool[playerId]);
        if (cmc === availableMana) score += 2; // Perfect curve-out
        if (cmc <= availableMana && cmc >= availableMana - 1) score += 1;

        // === MANA HOLD: Keep mana open for instants ===
        if (hasValuableInstant && cmc > 0) {
          const manaAfterCast = availableMana - cmc;
          if (manaAfterCast < cheapestInstantCost && score < 15) {
            // Stronger penalty for combat tricks during main1 (need them for combat)
            const hasCombatTrick = instantsInHand.some(c => {
              const effs = CardEngine.getSpellEffects(c);
              return effs.some(e => e.type === 'buff');
            });
            const hasInstantRemoval = instantsInHand.some(c => {
              const effs = CardEngine.getSpellEffects(c);
              return effs.some(e => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage');
            });
            if (state.phase === 'main1' && hasCombatTrick && myCreatures.length > 0) {
              score -= 8; // Strong hold — need combat trick mana for upcoming combat
            } else if (state.phase === 'main1' && hasInstantRemoval) {
              score -= 5; // Hold for combat removal
            } else {
              score -= 4; // Generic hold
            }
          }
        }

        // === PRE-COMBAT REMOVAL: Clear blockers before attacking ===
        if (state.phase === 'main1' && effects.some(e => e.type === 'destroy' || e.type === 'exile' || e.type === 'damage')) {
          const myAttackers = myCreatures.filter(c => CardEngine.canAttack(c));
          if (myAttackers.length > 0 && opponentCreatures.length > 0) {
            score += 4; // Clearing path for our attackers
          }
        }

        return { card, score };
      }).sort((a, b) => b.score - a.score);

      if (scored.length > 0) {
        // Spell sequencing: check if simulation suggests a different first play
        let card = scored[0].card;
        if (typeof CombatSim !== 'undefined' && scored.length >= 2) {
          const simBest = this._findBestSpellOrder(state, playerId);
          if (simBest && simBest._uid !== card._uid) {
            // Check if simBest is in our playable list
            const inPlayable = scored.find(s => s.card._uid === simBest._uid);
            if (inPlayable) {
              card = simBest;
            }
          }
        }

        // Don't cast aura if no valid target
        if (CardEngine.isAura(card)) {
          const myCreatures = bf.cards.filter(c => CardEngine.isCreature(c));
          if (myCreatures.length === 0) break;
        }

        // Check if we can afford the card normally, with convoke, or try evoke as fallback
        let useEvoke = false;
        if (!ManaSystem.canAfford(state, playerId, card)) {
          // Can't afford normal cost — try convoke first
          let affordWithConvoke = false;
          if (CardEngine.hasConvoke(card)) {
            const convokeContrib = ManaSystem.getConvokeContribution(state, playerId);
            if (convokeContrib.count > 0) {
              const landCount = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped).length;
              const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
              const totalWithConvoke = landCount + poolTotal + convokeContrib.count;
              const requiredTotal = card.cmc || ManaSystem.parseCost(card.mana_cost).total || 0;
              if (totalWithConvoke >= requiredTotal) {
                // Build augmented pool for canPay check
                const augmented = ManaSystem.getAvailableMana(state, playerId);
                Object.keys(convokeContrib.colors).forEach(clr => {
                  augmented[clr] = (augmented[clr] || 0) + convokeContrib.colors[clr];
                });
                affordWithConvoke = ManaSystem.canPay(augmented, card.mana_cost, card.cmc);
              }
            }
          }
          if (!affordWithConvoke) {
            // Try evoke if available
            const evokeCost = CardEngine.getEvokeCost(card);
            if (evokeCost) {
              const evokeCmc = ManaSystem.parseCost(evokeCost).total || 0;
              const tempCard = { mana_cost: evokeCost, cmc: evokeCmc };
              if (ManaSystem.canAfford(state, playerId, tempCard)) {
                useEvoke = true;
              } else {
                break;
              }
            } else {
              break;
            }
          }
        }

        // Handle additional costs (sacrifice, etc.)
        const addCosts = CardEngine.getAdditionalCosts(card);
        let skipCard = false;
        for (const ac of addCosts) {
          if (ac.type === 'sacrifice') {
            const bf = state.players[playerId].zones.battlefield;
            let candidates = [];
            if (ac.target === 'creature') candidates = bf.cards.filter(c => CardEngine.isCreature(c));
            else if (ac.target === 'land') candidates = bf.cards.filter(c => CardEngine.isLand(c));
            else if (ac.target === 'artifact') candidates = bf.cards.filter(c => CardEngine.isArtifact(c));
            else candidates = [...bf.cards];
            if (candidates.length === 0) { skipCard = true; break; }
            candidates.sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
            GameState.sacrifice(state, playerId, candidates[0]._uid);
            state.log.push(`Oponente sacrifica ${candidates[0].name} como custo.`);
          }
          if (ac.type === 'discard') {
            const hand = state.players[playerId].zones.hand;
            if (hand.count() <= (ac.amount || 1)) { skipCard = true; break; }
            // Discard cheapest non-land cards
            const discardable = hand.getAll().filter(c => c._uid !== card._uid)
              .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
            for (let di = 0; di < (ac.amount || 1) && di < discardable.length; di++) {
              const d = hand.remove(discardable[di]._uid);
              if (d) {
                state.players[playerId].zones.graveyard.add(d);
                state.log.push(`Oponente descarta ${d.name} como custo.`);
              }
            }
          }
          if (ac.type === 'tap_creature') {
            const untapped = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && !c._tapped)
              .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
            if (untapped.length === 0) { skipCard = true; break; }
            untapped[0]._tapped = true;
            state.log.push(`Oponente vira ${untapped[0].name} como custo.`);
          }
        }
        if (skipCard) break;

        let castCost = useEvoke ? CardEngine.getEvokeCost(card) : card.mana_cost;
        let castCmc = useEvoke ? (ManaSystem.parseCost(castCost).total || 0) : card.cmc;
        // Apply cost reduction from static abilities
        if (!useEvoke) {
          const aiBf = state.players[playerId].zones.battlefield;
          for (const bfCard of aiBf.cards) {
            if (!bfCard._costReduction) continue;
            const cr = bfCard._costReduction;
            if (cr.target === 'dragon_spells' && CardEngine.hasCreatureType(card, 'Dragon')) {
              if (cr.reduction === 'free') { castCmc = 0; castCost = ''; }
              else { castCmc = Math.max(0, castCmc - (cr.reduction || 0)); }
            }
            if (cr.target === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
              castCmc = Math.max(0, castCmc - (cr.reduction || 0));
            }
            if (cr.target === 'creature_spells' && CardEngine.isCreature(card)) {
              castCmc = Math.max(0, castCmc - (cr.reduction || 0));
            }
            if (cr.target === 'spells' && cr.condition === 'per_power4_creature') {
              const p4count = aiBf.cards.filter(c => CardEngine.isCreature(c) && CardEngine.getPower(c) >= 4).length;
              if (p4count > 0) castCmc = Math.max(0, castCmc - (cr.reduction || 0) * p4count);
            }
          }
          // Self cost reduction (Focus the Mind, etc.)
          const aiDbEntry = typeof CardEffectsDB !== 'undefined' && CardEffectsDB[card.name?.toLowerCase()];
          if (aiDbEntry && aiDbEntry.self_cost_reduction) {
            const scr = aiDbEntry.self_cost_reduction;
            if (scr.condition === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
              castCmc = Math.max(0, castCmc - (scr.amount || 0));
            }
          }
        }
        GameState.autoTapForSpell(state, playerId, castCost, castCmc, card);
        const targets = this._chooseTargets(state, playerId, card);

        // Fire creature_targeted_by_opponent trigger for each target
        if (targets && targets.length > 0) {
          for (const target of targets) {
            if (target.player === 0) { // Targeting opponent's creatures
              GameState.fireTrigger(state, 'creature_targeted_by_opponent', { playerId: 0 });
            }
          }
        }

        const result = GameState.castSpell(state, playerId, card._uid, targets, false, useEvoke);
        if (result.success) {
          // Record action for UI notification
          if (!state._aiActions) state._aiActions = [];
          let targetDesc = '';
          if (targets && targets.length > 0) {
            const tgt = targets[0];
            const tgtCard = state.players[tgt.player].zones.battlefield.get(tgt.uid);
            if (tgtCard) targetDesc = ` em ${tgtCard.name}`;
          }
          const evokeLabel = useEvoke ? ' (Evocado)' : '';
          state._aiActions.push({
            type: 'cast',
            card: { name: card.name, image_normal: card.image_normal, image_small: card.image_small, type_line: card.type_line, mana_cost: card.mana_cost },
            description: `Oponente joga ${card.name}${targetDesc}${evokeLabel}`,
            targetDesc
          });
          playedSomething = true;
        } else {
          break;
        }
      }
    }

    // 3. Try to equip unattached equipment
    this._tryEquipment(state, playerId);

    // 4. Try to activate abilities
    this._tryActivatedAbilities(state, playerId);

    // 4b. Try to activate planeswalker loyalty abilities
    this._tryLoyaltyAbilities(state, playerId);

    // 5. Try to activate graveyard abilities (Renew)
    this._tryGraveyardAbilities(state, playerId);

    // 6. Try harmonize (cast from graveyard)
    this._tryHarmonize(state, playerId);

    // 7. Try to activate hideaway lands
    this._tryHideaway(state, playerId);

    // 8. Try to transform DFC creatures
    this._tryTransform(state, playerId);
  },

  // AI equips unattached equipment to best creature
  _tryEquipment(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const equipment = bf.cards.filter(c => CardEngine.isEquipment(c) && !c._attachedTo);
    const creatures = bf.cards.filter(c => CardEngine.isCreature(c));

    if (equipment.length === 0 || creatures.length === 0) return;

    for (const equip of equipment) {
      const effects = CardEngine.parseEquipmentEffects(equip);
      const costEffect = effects.find(e => e.type === 'equip_cost');
      const manaCost = costEffect ? costEffect.cost : '{3}';
      const parsedCost = ManaSystem.parseCost(manaCost);
      const cmc = parsedCost.total;

      const fakeCard = { mana_cost: manaCost, cmc };
      if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;

      // Pick best creature (biggest power, not already equipped heavily)
      const sorted = creatures
        .filter(c => !(c._attachments || []).includes(equip._uid))
        .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));

      if (sorted.length > 0) {
        GameState.autoTapForSpell(state, playerId, manaCost, cmc);
        state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
        GameState.equipCreature(state, playerId, equip._uid, sorted[0]._uid);
      }
    }
  },

  // Helper: parse ability mana cost (handles both numeric and string DB formats)
  _getAbilityManaCost(ability) {
    const cost = ability.cost;
    if (!cost || cost.mana === undefined || cost.mana === null || cost.mana === 0) return { manaCost: '', cmc: 0 };
    if (typeof cost.mana === 'number') return { manaCost: `{${cost.mana}}`, cmc: cost.mana };
    const str = String(cost.mana);
    let manaCost = '';
    let cmc = 0;
    let i = 0;
    while (i < str.length) {
      if (/\d/.test(str[i])) {
        let num = '';
        while (i < str.length && /\d/.test(str[i])) { num += str[i]; i++; }
        manaCost += `{${num}}`;
        cmc += parseInt(num);
      } else if (/[WUBRGCXS]/i.test(str[i])) {
        manaCost += `{${str[i].toUpperCase()}}`;
        if (str[i].toUpperCase() !== 'X') cmc += 1;
        i++;
      } else { i++; }
    }
    return { manaCost, cmc };
  },

  // AI tries to use activated abilities on its creatures
  _tryActivatedAbilities(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const creatures = bf.cards.filter(c => CardEngine.isCreature(c));

    for (const creature of creatures) {
      const abilities = CardEngine.getActivatedAbilities(creature);
      if (abilities.length === 0) continue;

      for (const ability of abilities) {
        // Check tap requirement
        if (ability.cost.tap && creature._tapped) continue;

        // Check mana cost (handles both numeric and string formats)
        const { manaCost, cmc } = this._getAbilityManaCost(ability);
        if (cmc > 0) {
          const fakeCard = { mana_cost: manaCost, cmc };
          if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;
        }

        // Check remove counter cost
        if (ability.cost.removeCounter) {
          if (!creature._counters || (creature._counters[ability.cost.removeCounter] || 0) <= 0) continue;
        }
        // Check blight cost - need creatures to put -1/-1 counters on
        if (ability.cost.blight) {
          const hasCreature = state.players[playerId].zones.battlefield.cards.some(c => CardEngine.isCreature(c));
          if (!hasCreature) continue;
        }

        // Check once_per_turn
        if (ability.cost.once_per_turn) {
          if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
          const key = creature._uid + '_' + JSON.stringify(ability.effects.map(e => e.type));
          if (state._abilityUsedThisTurn[key]) continue;
        }

        // Check sacrifice_creature cost (need another creature)
        if (ability.cost.sacrifice_creature) {
          const otherCreatures = state.players[playerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && c._uid !== creature._uid
          );
          if (otherCreatures.length === 0) continue;
        }

        // Check sacrifice_token cost
        if (ability.cost.sacrifice_token) {
          const tokens = state.players[playerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && c._isToken && c._uid !== creature._uid
          );
          if (tokens.length === 0) continue;
        }

        // Check exile_gy_creature cost
        if (ability.cost.exile_gy_creature) {
          const gyCreatures = state.players[playerId].zones.graveyard.getAll().filter(c => CardEngine.isCreature(c));
          if (gyCreatures.length === 0) continue;
        }

        // Check discard_hand cost (need at least 1 card in hand)
        if (ability.cost.discard_hand) {
          if (state.players[playerId].zones.hand.count() === 0) continue;
        }

        // Check tap_creature cost (need another untapped creature)
        if (ability.cost.tap_creature) {
          const untappedCreatures = state.players[playerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && !c._tapped && c._uid !== creature._uid
          );
          if (untappedCreatures.length === 0) continue;
        }

        // Check life cost
        if (ability.cost.life) {
          const lifeCost = typeof ability.cost.life === 'number' ? ability.cost.life : 1;
          if (state.players[playerId].life <= lifeCost) continue;
        }

        // Check condition on activated ability
        if (ability.condition) {
          if (!GameState._checkEffectCondition(state, playerId, { condition: ability.condition })) continue;
        }

        // Only activate if effects are useful
        let useful = false;
        for (const eff of ability.effects) {
          if (eff.type === 'draw') useful = true;
          if (eff.type === 'gainLife') useful = true;
          if (eff.type === 'damage') useful = true;
          if (eff.type === 'counter_self') useful = true;
          if (eff.type === 'create_token') useful = true;
          if (eff.type === 'buff_self') useful = true;
          if (eff.type === 'cant_block') useful = true;
          if (eff.type === 'buff_all') useful = true;
          if (eff.type === 'damage_each_opponent') useful = true;
          if (eff.type === 'drain') useful = true;
          if (eff.type === 'loot') useful = true;
          if (eff.type === 'look_top') useful = true;
          if (eff.type === 'grant') useful = true;
          if (eff.type === 'grant_all') useful = true;
          if (eff.type === 'exile_top_play') useful = true;
          if (eff.type === 'regenerate') useful = true;
          if (eff.type === 'bounce') useful = true;
          if (eff.type === 'untap_self') useful = true;
          if (eff.type === 'tap_target') useful = true;
          if (eff.type === 'mill') useful = true;
          if (eff.type === 'grant_counter') useful = true;
          if (eff.type === 'grant_counters') useful = true;
          if (eff.type === 'double_counters') useful = true;
        }
        if (!useful) continue;

        // Pay costs
        if (cmc > 0) {
          GameState.autoTapForSpell(state, playerId, manaCost, cmc);
          state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], manaCost, cmc);
        }
        if (ability.cost.tap) creature._tapped = true;
        if (ability.cost.removeCounter && creature._counters) {
          creature._counters[ability.cost.removeCounter] = (creature._counters[ability.cost.removeCounter] || 0) - 1;
        }

        // Pay once_per_turn
        if (ability.cost.once_per_turn) {
          if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
          const key = creature._uid + '_' + JSON.stringify(ability.effects.map(e => e.type));
          state._abilityUsedThisTurn[key] = true;
        }

        // Pay sacrifice_creature cost (sacrifice weakest other creature)
        if (ability.cost.sacrifice_creature) {
          const others = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && c._uid !== creature._uid)
            .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
          if (others.length > 0) {
            const victim = others[0];
            GameState.creatureDies(state, victim, playerId);
            state.log.push(`Sacrifica ${victim.name} como custo.`);
          }
        }

        // Pay sacrifice_token cost
        if (ability.cost.sacrifice_token) {
          const tokens = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && c._isToken && c._uid !== creature._uid)
            .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
          if (tokens.length > 0) {
            GameState.creatureDies(state, tokens[0], playerId);
            state.log.push(`Sacrifica ${tokens[0].name} token como custo.`);
          }
        }

        // Pay exile_gy_creature cost
        if (ability.cost.exile_gy_creature) {
          const gyCreatures = state.players[playerId].zones.graveyard.getAll().filter(c => CardEngine.isCreature(c));
          if (gyCreatures.length > 0) {
            // Exile weakest from gy
            const victim = gyCreatures.sort((a, b) => (a.cmc || 0) - (b.cmc || 0))[0];
            state.players[playerId].zones.graveyard.remove(victim._uid);
            state.players[playerId].zones.exile.add(victim);
            state.log.push(`Exila ${victim.name} do cemiterio como custo.`);
          }
        }

        // Pay discard_hand cost
        if (ability.cost.discard_hand) {
          const hand = state.players[playerId].zones.hand;
          const cards = hand.getAll();
          for (const c of cards) {
            hand.remove(c._uid);
            state.players[playerId].zones.graveyard.add(c);
          }
          if (cards.length > 0) state.log.push(`Descarta mao (${cards.length} cartas) como custo.`);
        }

        // Pay tap_creature cost (tap weakest untapped creature)
        if (ability.cost.tap_creature) {
          const untapped = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && !c._tapped && c._uid !== creature._uid)
            .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
          if (untapped.length > 0) {
            untapped[0]._tapped = true;
            state.log.push(`Vira ${untapped[0].name} como custo.`);
          }
        }

        // Pay life cost
        if (ability.cost.life) {
          const lifeCost = typeof ability.cost.life === 'number' ? ability.cost.life : 1;
          state.players[playerId].life -= lifeCost;
          state.log.push(`Paga ${lifeCost} vida como custo.`);
        }

        // Resolve effects
        state.log.push(`${creature.name}: habilidade ativada!`);
        for (const effect of ability.effects) {
          const data = { cardUid: creature._uid, card: creature };
          // Pass zone restriction if ability has zone cost
          if (ability.cost.zone) {
            data.fromZone = ability.cost.zone;
          }
          const result = GameState._resolveSimpleEffect(state, playerId, effect, data);
          if (result) state.log.push(result);
        }
      }
    }
  },

  // AI tries to activate planeswalker loyalty abilities
  _tryLoyaltyAbilities(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const planeswalkers = bf.cards.filter(c => CardEngine.isPlaneswalker(c) && !c._loyaltyUsedThisTurn);

    for (const pw of planeswalkers) {
      const abilities = CardEngine.getLoyaltyAbilities(pw);
      if (abilities.length === 0) continue;

      // Score each ability and pick the best usable one
      let bestIdx = -1;
      let bestScore = -Infinity;

      for (let i = 0; i < abilities.length; i++) {
        const ab = abilities[i];
        const loyaltyCost = ab.cost.loyalty;

        // Check if we can pay the cost
        if (typeof loyaltyCost === 'number' && loyaltyCost < 0) {
          if ((pw._loyalty || 0) + loyaltyCost < 0) continue; // can't afford
        }

        // Score the ability
        let score = 0;
        for (const eff of ab.effects) {
          if (eff.type === 'draw') score += 4 * (eff.amount || 1);
          if (eff.type === 'create_token') score += 3;
          if (eff.type === 'damage') score += 2 * (eff.amount || 1);
          if (eff.type === 'destroy') score += 5;
          if (eff.type === 'counter_all') score += 3;
          if (eff.type === 'gain_life' || eff.type === 'gainLife') score += 1;
          if (eff.type === 'discard') score += 3;
          if (eff.type === 'grant_all') score += 2;
          if (eff.type === 'untap') score += 2;
          if (eff.type === 'add_mana') score += 1;
          if (eff.type === 'exile') score += 4;
        }

        // Prefer abilities that ADD loyalty (positive costs mean loyalty goes up)
        if (typeof loyaltyCost === 'number' && loyaltyCost > 0) score += 2;
        // Penalize abilities that would kill the planeswalker
        if (typeof loyaltyCost === 'number' && (pw._loyalty || 0) + loyaltyCost <= 0) score -= 10;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        GameState.activateLoyaltyAbility(state, playerId, pw._uid, bestIdx);
      }
    }
  },

  // AI tries to activate graveyard abilities (Renew mechanic)
  _tryGraveyardAbilities(state, playerId) {
    const gy = state.players[playerId].zones.graveyard;
    const cards = gy.getAll();

    for (const card of cards) {
      const abilities = CardEngine.getGraveyardAbilities(card);
      if (abilities.length === 0) continue;

      for (const ability of abilities) {
        // Check sorcery speed restriction (Sage of the Fang, etc.)
        if (ability.sorcerySpeed && state.phase !== 'main1' && state.phase !== 'main2') {
          continue; // Can only activate during main phases
        }

        // Check mana cost
        if (ability.cost.mana) {
          const parsed = ManaSystem.parseCost(`{${ability.cost.mana}}`);
          const fakeCard = { mana_cost: `{${ability.cost.mana}}`, cmc: parsed.total || 0 };
          if (!ManaSystem.canAfford(state, playerId, fakeCard)) continue;

          // Pay mana
          GameState.autoTapForSpell(state, playerId, `{${ability.cost.mana}}`, fakeCard.cmc);
          state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], `{${ability.cost.mana}}`, fakeCard.cmc);
        }

        state.log.push(`${card.name}: habilidade do cemiterio ativada!`);

        // Remove from graveyard
        gy.remove(card._uid);
        if (ability.cost.exile) {
          if (state.players[playerId].zones.exile) {
            state.players[playerId].zones.exile.add(card);
          }
        }

        // Resolve effects with shared targets (for "same" target references)
        let sharedTargets = null; // First effect's targets, reused by "same" target effects

        for (const effect of ability.effects) {
          let targets = [];

          // Handle "same" target - reuse previous effect's targets
          if (effect.target === 'same' && sharedTargets) {
            targets = [...sharedTargets]; // Reuse previous targets
          }
          // Choose targets for regular effects
          else if (effect.type === 'grant_counter' && effect.target === 'creature') {
            const allCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId));

            if (allCreatures.length > 0) {
              // Choose best target for lifelink counter (prefer creatures without lifelink)
              let bestTarget = allCreatures.find(c => !CardEngine.hasKeyword(c, 'Lifelink'));
              if (!bestTarget) bestTarget = allCreatures[0]; // Fallback to first creature

              targets.push({ type: 'creature', player: playerId, uid: bestTarget._uid });
              // Save targets for potential "same" target reuse
              if (!sharedTargets) sharedTargets = [...targets];
            }
          }
          // Counter effects (Sage of the Fang first effect)
          else if (effect.type === 'counter' && effect.target === 'creature') {
            const allCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c));
            if (allCreatures.length > 0) {
              // Choose creature with highest power for +1/+1 counters
              const bestTarget = allCreatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a))[0];
              targets.push({ type: 'creature', player: playerId, uid: bestTarget._uid });
              // Save targets for potential "same" target reuse
              if (!sharedTargets) sharedTargets = [...targets];
            }
          }

          const result = GameState._resolveSimpleEffect(state, playerId, effect, { cardUid: card._uid, card, fromZone: 'graveyard', targets });
          if (result) state.log.push(result);
        }

        break; // One graveyard ability per card per turn
      }
    }
  },

  // AI tries to cast harmonize spells from graveyard
  _tryHarmonize(state, playerId) {
    const harmonizable = GameState.getHarmonizableCards(state, playerId);
    if (harmonizable.length === 0) return;

    // Sort by CMC descending (cast the most impactful spell first)
    harmonizable.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));

    for (const card of harmonizable) {
      // Find best creature to tap for discount (weakest first to preserve board)
      const bf = state.players[playerId].zones.battlefield;
      const tapCandidates = bf.cards.filter(c =>
        CardEngine.isCreature(c) && !c._tapped && !c._summoningSick && CardEngine.getPower(c) > 0
      ).sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));

      let tappedUid = null;
      if (tapCandidates.length > 0) {
        // Tap the weakest creature with power > 0
        tappedUid = tapCandidates[0]._uid;
      }

      // Choose targets for the harmonize spell
      const effects = CardEngine.getSpellEffects(card);
      const targets = this._chooseTargets(state, playerId, card, effects);

      const result = GameState.castHarmonize(state, playerId, card._uid, targets, tappedUid);
      if (result.success) {
        // Track AI action for display
        if (!state._aiActions) state._aiActions = [];
        state._aiActions.push({
          type: 'harmonize',
          card: { name: card.name, image_normal: card.image_normal, image_small: card.image_small, type_line: card.type_line, mana_cost: card.mana_cost },
          description: `Oponente harmoniza ${card.name} do cemiterio`
        });
        break; // One harmonize per main phase is enough
      }
    }
  },

  // AI tries to activate hideaway lands
  _tryTransform(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const transformable = bf.cards.filter(c =>
      CardEngine.isTransformCard(c) && CardEngine.isCreature(c)
    );

    for (const card of transformable) {
      const costStr = CardEngine.getTransformCost(card);
      if (!costStr) continue;
      const cost = ManaSystem.parseCost(costStr);
      if (!ManaSystem.canAfford(state, playerId, { mana_cost: costStr, cmc: cost.total })) continue;

      // Evaluate: is transforming beneficial?
      const back = card._transformed ? card._frontFaceData : (card._backFace || card.backFace);
      if (!back) continue;

      const currentPower = CardEngine.getPower(card);
      const currentToughness = CardEngine.getToughness(card);
      const backPower = parseInt(back.power) || 0;
      const backToughness = parseInt(back.toughness) || 0;

      // Transform if back face has better stats or has useful keywords
      const statDiff = (backPower + backToughness) - (currentPower + currentToughness);
      if (statDiff > 0) {
        const result = GameState.transformCreature(state, playerId, card._uid);
        if (result.success) {
          state.log.push(`IA transforma ${card.name}!`);
          break; // One transform per main phase
        }
      }
    }
  },

  _tryHideaway(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const hideawayLands = bf.cards.filter(c => c._hideaway && c._hideawayCard && !c._tapped);

    for (const land of hideawayLands) {
      if (GameState._checkHideawayCondition(state, playerId, land)) {
        const result = GameState.activateHideaway(state, playerId, land._uid);
        if (result.success) {
          state.log.push(`IA ativa hideaway de ${land.name}!`);
          break; // One hideaway per turn is enough
        }
      }
    }
  },

  // =================== BOARD EVALUATION ===================
  // Returns -100 to +100 (positive = playerId winning)
  _evaluateBoard(state, playerId) {
    const oppId = playerId === 0 ? 1 : 0;
    const myLife = state.players[playerId].life;
    const oppLife = state.players[oppId].life;
    const myBf = state.players[playerId].zones.battlefield;
    const oppBf = state.players[oppId].zones.battlefield;
    const myCreatures = myBf.cards.filter(c => CardEngine.isCreature(c));
    const oppCreatures = oppBf.cards.filter(c => CardEngine.isCreature(c));

    let score = 0;

    // Life advantage (max ~10 points)
    score += (myLife - oppLife) * 0.5;

    // Board power advantage
    const myPower = myCreatures.reduce((s, c) => s + CardEngine.getPower(c), 0);
    const oppPower = oppCreatures.reduce((s, c) => s + CardEngine.getPower(c), 0);
    score += (myPower - oppPower) * 2;

    // Board toughness (resilience)
    const myTough = myCreatures.reduce((s, c) => s + CardEngine.getToughness(c), 0);
    const oppTough = oppCreatures.reduce((s, c) => s + CardEngine.getToughness(c), 0);
    score += (myTough - oppTough) * 0.5;

    // Creature count
    score += (myCreatures.length - oppCreatures.length) * 3;

    // Evasion advantage (hard to block = more threatening)
    const countEvasion = (creatures) => creatures.filter(c =>
      CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace')
    ).length;
    score += (countEvasion(myCreatures) - countEvasion(oppCreatures)) * 4;

    // Card advantage
    const myHand = state.players[playerId].zones.hand.count();
    const oppHand = state.players[oppId].zones.hand.count();
    score += (myHand - oppHand) * 1.5;

    // Keyword quality — context-sensitive scoring
    const lowLife = myLife <= 8;
    const oppLowLife = oppLife <= 8;
    const _keywordScore = (c, sign) => {
      let s = 0;
      if (CardEngine.hasKeyword(c, 'Deathtouch')) s += 2;
      if (CardEngine.hasKeyword(c, 'First Strike') || CardEngine.hasKeyword(c, 'Double Strike')) s += 2;
      if (CardEngine.hasKeyword(c, 'Lifelink')) s += lowLife ? 3 : 1; // Lifelink more valuable when low
      if (CardEngine.hasKeyword(c, 'Trample')) s += oppLowLife ? 2 : 1; // Trample better when closing
      if (CardEngine.hasIndestructible(c)) s += 4;
      if (CardEngine.hasKeyword(c, 'Vigilance')) s += 1; // Free attack + block
      if (CardEngine.hasKeyword(c, 'Reach')) s += 1; // Blocks flyers
      if (c._anthem) s += 3; // Anthems multiply board value
      // Triggered abilities add recurring value
      if (c._triggers && c._triggers.length > 0) s += 1;
      // Activated abilities add flexibility
      const abilities = CardEngine.getActivatedAbilities(c);
      if (abilities.length > 0) s += 1;
      return s * sign;
    };
    for (const c of myCreatures) score += _keywordScore(c, 1);
    for (const c of oppCreatures) score += _keywordScore(c, -1);

    // Mana advantage: more untapped lands = more options
    const myLands = state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isLand(c));
    const oppLands = state.players[oppId].zones.battlefield.cards.filter(c => CardEngine.isLand(c));
    const myUntappedLands = myLands.filter(c => !c._tapped).length;
    const oppUntappedLands = oppLands.filter(c => !c._tapped).length;
    score += (myUntappedLands - oppUntappedLands) * 0.5;

    return Math.max(-100, Math.min(100, score));
  },

  // Evaluate a single creature's combat worth (for trade decisions)
  _creatureValue(card) {
    let val = CardEngine.getPower(card) + CardEngine.getToughness(card);
    if (CardEngine.hasKeyword(card, 'Flying')) val += 3;
    if (CardEngine.hasKeyword(card, 'Deathtouch')) val += 3;
    if (CardEngine.hasKeyword(card, 'First Strike') || CardEngine.hasKeyword(card, 'Double Strike')) val += 2;
    if (CardEngine.hasKeyword(card, 'Lifelink')) val += 2;
    if (CardEngine.hasKeyword(card, 'Trample')) val += 1;
    if (CardEngine.hasKeyword(card, 'Menace')) val += 1;
    if (CardEngine.hasIndestructible(card)) val += 6;
    if (CardEngine.hasKeyword(card, 'Vigilance')) val += 1;
    if (CardEngine.hasKeyword(card, 'Haste')) val += 1;
    if (CardEngine.hasKeyword(card, 'Hexproof')) val += 2; // Hard to remove
    if (card._isToken) val -= 2; // Tokens are expendable
    // Mana value: expensive creatures are harder to replace
    const cmc = card.cmc || 0;
    val += Math.min(cmc, 6) * 0.5;
    // Activated abilities: score by impact
    const abilities = CardEngine.getActivatedAbilities(card);
    for (const ab of abilities) {
      const effs = ab.effects || [];
      if (effs.some(e => e.type === 'draw')) val += 4; // Card draw is premium
      else if (effs.some(e => e.type === 'damage' || e.type === 'destroy')) val += 3; // Removal
      else if (effs.some(e => e.type === 'create_token')) val += 3; // Token generation
      else if (effs.some(e => e.type === 'counter_self' || e.type === 'buff')) val += 2; // Growth
      else val += 1; // Other utilities
    }
    // Triggered abilities: recurring value
    if (card._triggers) {
      for (const trig of card._triggers) {
        if (!trig) continue;
        const effs = trig.effects || [];
        if (effs.some(e => e.type === 'draw')) val += 3;
        else if (effs.some(e => e.type === 'damage' || e.type === 'destroy')) val += 2;
        else if (effs.some(e => e.type === 'create_token')) val += 2;
        else val += 1;
      }
    }
    // Anthem effect: multiplies with board
    if (card._anthem) val += 4;
    // Attachments: consider actual buff
    if (card._attachments && card._attachments.length > 0) {
      val += card._attachments.length * 2;
    }
    return val;
  },

  // Evaluate how threatening a creature is for removal targeting purposes
  // Higher score = should be removed first (more impactful on the game)
  _threatScore(card) {
    let score = 0;
    const power = CardEngine.getPower(card);
    const toughness = CardEngine.getToughness(card);

    // Base: power matters (damage output)
    score += power * 1.5;
    // Toughness matters less for threat but affects survivability
    score += toughness * 0.5;

    // Evasion: much harder to deal with in combat
    if (CardEngine.hasKeyword(card, 'Flying')) score += 4;
    if (CardEngine.hasKeyword(card, 'Menace')) score += 2;
    if (CardEngine.hasKeyword(card, 'Trample')) score += 2;

    // Keywords that make it a must-remove
    if (CardEngine.hasKeyword(card, 'Deathtouch')) score += 3;
    if (CardEngine.hasKeyword(card, 'Lifelink')) score += 3;
    if (CardEngine.hasKeyword(card, 'Double Strike')) score += 5;
    if (CardEngine.hasKeyword(card, 'First Strike')) score += 1;
    if (CardEngine.hasIndestructible(card)) score += 4;
    if (CardEngine.hasKeyword(card, 'Haste')) score += 1;

    // Recurring value: activated abilities (draw, damage, tokens, counters)
    const abilities = CardEngine.getActivatedAbilities(card);
    for (const ab of abilities) {
      const effects = ab.effects || [];
      for (const eff of effects) {
        if (eff.type === 'draw') score += 5;
        if (eff.type === 'damage') score += 3;
        if (eff.type === 'create_token') score += 4;
        if (eff.type === 'counter' && eff.counter === '+1/+1') score += 3;
        if (eff.type === 'buff') score += 2;
        if (eff.type === 'destroy' || eff.type === 'exile') score += 4;
      }
    }

    // Triggered abilities: generates value over time
    if (card._triggers && card._triggers.length > 0) {
      score += card._triggers.length * 2;
    }

    // Rarity: rare/mythic cards tend to be high-impact
    if (card.rarity === 'mythic') score += 4;
    else if (card.rarity === 'rare') score += 2;

    // CMC: expensive creatures represent bigger investments and are usually stronger
    const cmc = card.cmc || 0;
    score += Math.min(cmc, 6) * 0.5;

    // Anthem/static buffs affect the whole board
    if (card._anthem) score += 5;

    // Equipment/aura attachments make the creature more valuable
    if (card._attachments && card._attachments.length > 0) score += 3;

    // Planeswalker: always high priority
    if (CardEngine.isPlaneswalker && CardEngine.isPlaneswalker(card)) score += 8;

    // Tokens are less threatening (expendable, no card cost)
    if (card._isToken) score -= 3;

    return score;
  },

  // Removed problematic commented function that was causing syntax error

  declareAttackers(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const creatures = bf.cards.filter(c => CardEngine.canAttack(c));
    const oppId = playerId === 0 ? 1 : 0;
    const opponentLife = state.players[oppId].life;
    const myLife = state.players[playerId].life;
    const opponentCreatures = state.players[oppId].zones.battlefield.cards
      .filter(c => CardEngine.isCreature(c) && !c._tapped);

    if (creatures.length === 0) return;

    const totalPower = creatures.reduce((sum, c) => sum + CardEngine.getPower(c), 0);

    // Phase 1: Lethal check - attack with everything only if damage gets through
    if (totalPower >= opponentLife) {
      // Calculate how much damage actually gets through blockers
      let guaranteedDamage = 0;
      for (const c of creatures) {
        const power = CardEngine.getPower(c);
        const isFlying = CardEngine.hasKeyword(c, 'Flying');
        const isMenace = CardEngine.hasKeyword(c, 'Menace');
        const hasTrample = CardEngine.hasKeyword(c, 'Trample');

        // Find valid blockers for this creature
        const validBlockers = opponentCreatures.filter(b => CardEngine.canBlock(b, c, state));

        if (validBlockers.length === 0) {
          guaranteedDamage += power; // unblockable
        } else if (isMenace && validBlockers.length < 2) {
          guaranteedDamage += power; // menace unblockable
        } else if (hasTrample) {
          // Trample: excess over best blocker toughness
          const bestTough = Math.max(...validBlockers.map(b => CardEngine.getToughness(b)), 0);
          guaranteedDamage += Math.max(0, power - bestTough);
        }
        // Indestructible attackers always safe, but damage still absorbed by blockers
        // so don't add extra here unless unblockable
      }
      if (guaranteedDamage >= opponentLife) {
        creatures.forEach(c => CombatSystem.declareAttacker(state.combat, c));
        // Tap attackers at declaration
        state.combat.attackers.forEach(({ card }) => {
          if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
            card._tapped = true;
            card._tappedByAttack = true;
          }
        });
        state.log.push(`Oponente ataca com tudo! (${creatures.length} criaturas)`);
        return;
      }
    }

    // Board evaluation for context-aware decisions
    const boardScore = this._evaluateBoard(state, playerId);

    // Check if AI has combat tricks in hand
    const hand = state.players[playerId].zones.hand;
    const hasCombatTrick = hand.getAll().some(c => {
      const tl = (c.type_line || '').toLowerCase();
      if (!tl.includes('instant')) return false;
      const effs = CardEngine.getSpellEffects(c);
      return effs.some(e => e.type === 'buff');
    });

    // Phase 2: Calculate race (who kills first)
    // Include creatures that can get through: evasion, unblockable ground, vigilance, indestructible
    let myEvasionPower = 0;
    for (const c of creatures) {
      const power = CardEngine.getPower(c);
      if (CardEngine.hasKeyword(c, 'Vigilance') || CardEngine.hasIndestructible(c)) {
        myEvasionPower += power; // free to attack
      } else if (CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Menace')) {
        myEvasionPower += power; // evasion
      } else {
        // Ground creature: check if opponent has any untapped creature that can block it
        const canBeBlocked = opponentCreatures.some(b => CardEngine.canBlock(b, c, state));
        if (!canBeBlocked) myEvasionPower += power; // unblockable ground
      }
    }
    const oppAttackPower = state.players[oppId].zones.battlefield.cards
      .filter(c => CardEngine.isCreature(c) && CardEngine.canAttack(c))
      .reduce((s, c) => s + CardEngine.getPower(c), 0);
    const myClockTurns = myEvasionPower > 0 ? Math.ceil(opponentLife / myEvasionPower) : 99;
    const oppClockTurns = oppAttackPower > 0 ? Math.ceil(myLife / oppAttackPower) : 99;
    const winningRace = myClockTurns <= oppClockTurns;

    // Find opponent's blockers that can block flyers (Flying or Reach)
    const oppFlyerBlockers = opponentCreatures.filter(c =>
      CardEngine.hasKeyword(c, 'Flying') || CardEngine.hasKeyword(c, 'Reach')
    );

    // === CombatSim-based attack decision ===
    if (typeof CombatSim !== 'undefined') {
      const mySnaps = creatures.map(c => CombatSim._snapshot(c, state));
      const oppSnaps = opponentCreatures.map(c => CombatSim._snapshot(c, state));

      const simResult = CombatSim.findBestAttackers(mySnaps, oppSnaps, opponentLife, myLife, boardScore);

      if (simResult.attackerIndices.length > 0) {
        for (const idx of simResult.attackerIndices) {
          CombatSystem.declareAttacker(state.combat, creatures[idx]);
        }
        if (state.combat.attackers.length > 0) {
          state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s).`);
          // Tap attackers at declaration
          state.combat.attackers.forEach(({ card }) => {
            if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
              card._tapped = true;
              card._tappedByAttack = true;
              const tapLogs = GameState.fireTrigger(state, 'becomes_tapped', {
                cardUid: card._uid, card: card, controllerId: playerId
              });
              if (tapLogs.length > 0) state.log.push(...tapLogs);
            }
          });
          if (!state._aiActions) state._aiActions = [];
          const attackerNames = state.combat.attackers.map(c => `${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})`).join(', ');
          state._aiActions.push({
            type: 'attack',
            attackers: state.combat.attackers.filter(c => c).map(c => ({ name: c.name || 'Criatura', image_normal: c.image_normal || '', image_small: c.image_small || '', power: CardEngine.getPower(c), toughness: CardEngine.getToughness(c) })),
            description: `Oponente ataca com ${state.combat.attackers.length} criatura(s): ${attackerNames}`
          });
        }
        return; // CombatSim handled it
      }
      // If CombatSim chose zero attackers, that's also a valid decision (don't attack)
      if (simResult.score <= 0 && !simResult.lethal) {
        return; // CombatSim decided not to attack
      }
    }

    // === Fallback: Heuristic scoring (used when CombatSim not available) ===
    // Phase 3: Score each creature for attack
    for (const creature of creatures) {
      const power = CardEngine.getPower(creature);
      const toughness = CardEngine.getToughness(creature);
      let attackValue = power; // Base: damage dealt

      // === No-cost attacks (always worth it) ===
      if (CardEngine.hasKeyword(creature, 'Vigilance')) {
        attackValue += 5; // No tap cost
      }
      if (CardEngine.hasIndestructible(creature)) {
        attackValue += 5; // Can't die
      }

      // === Evasion: likely unblockable ===
      const isFlying = CardEngine.hasKeyword(creature, 'Flying');
      const isMenace = CardEngine.hasKeyword(creature, 'Menace');
      if (isFlying) {
        const canBeBlockedByFlyer = oppFlyerBlockers.some(b =>
          CardEngine.canBlock(b, creature, state)
        );
        if (!canBeBlockedByFlyer) {
          attackValue += power; // Guaranteed damage
        } else {
          // Flying but opponent has flying/reach blockers - evaluate trade
          const bestFlyerBlocker = oppFlyerBlockers
            .filter(b => CardEngine.canBlock(b, creature, state))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a))[0];
          if (bestFlyerBlocker) {
            const bPow = CardEngine.getPower(bestFlyerBlocker);
            const bTough = CardEngine.getToughness(bestFlyerBlocker);
            if (toughness > bPow && power >= bTough) attackValue += 4; // We win the trade
            else if (toughness <= bPow && power < bTough) attackValue -= 4; // We lose the trade
          }
        }
      }
      if (isMenace && opponentCreatures.length < 2) {
        attackValue += power; // Can't be blocked (need 2)
      }

      // === Trample: damage goes through ===
      if (CardEngine.hasKeyword(creature, 'Trample')) {
        const bestBlockerTough = opponentCreatures
          .filter(b => CardEngine.canBlock(b, creature, state))
          .reduce((max, b) => Math.max(max, CardEngine.getToughness(b)), 0);
        const trampleThrough = Math.max(0, power - bestBlockerTough);
        attackValue += trampleThrough * 0.5;
      }

      // === Deathtouch: trades up favorably ===
      if (CardEngine.hasKeyword(creature, 'Deathtouch')) {
        attackValue += 3;
      }

      // === Lifelink: life swing ===
      if (CardEngine.hasKeyword(creature, 'Lifelink')) {
        attackValue += power * 0.5;
      }

      // === First Strike: wins many combats ===
      if (CardEngine.hasKeyword(creature, 'First Strike') || CardEngine.hasKeyword(creature, 'Double Strike')) {
        const killsBeforeDamage = opponentCreatures.filter(b =>
          CardEngine.canBlock(b, creature, state) && power >= CardEngine.getToughness(b)
        ).length > 0;
        if (killsBeforeDamage) attackValue += 3;
      }

      // === Token: expendable ===
      if (creature._isToken) {
        attackValue += 1; // Low cost to lose
      }

      // === RISK: evaluate worst-case block ===
      if (!CardEngine.hasIndestructible(creature) && !CardEngine.hasKeyword(creature, 'Vigilance')) {
        // Find the best blocker opponent could assign
        const validBlockers = opponentCreatures.filter(b => CardEngine.canBlock(b, creature, state));
        if (validBlockers.length > 0) {
          const bestBlocker = validBlockers.sort((a, b) => {
            // Prefer blockers that kill our creature
            const aKills = CardEngine.getPower(a) >= toughness || CardEngine.hasKeyword(a, 'Deathtouch');
            const bKills = CardEngine.getPower(b) >= toughness || CardEngine.hasKeyword(b, 'Deathtouch');
            if (aKills !== bKills) return bKills - aKills;
            return CardEngine.getPower(b) - CardEngine.getPower(a);
          })[0];

          const blockerPower = CardEngine.getPower(bestBlocker);
          const blockerTough = CardEngine.getToughness(bestBlocker);
          const creatureDies = blockerPower >= toughness || CardEngine.hasKeyword(bestBlocker, 'Deathtouch');
          const blockerDies = power >= blockerTough || CardEngine.hasKeyword(creature, 'Deathtouch');

          if (creatureDies) {
            if (blockerDies) {
              // Mutual kill - evaluate trade quality
              const myVal = this._creatureValue(creature);
              const theirVal = this._creatureValue(bestBlocker);
              if (myVal > theirVal + 3) {
                attackValue -= 6; // Bad trade - our creature is worth more
              } else if (myVal > theirVal + 1) {
                attackValue -= 3; // Slightly unfavorable
              }
              // Even or favorable trade: no penalty
            } else {
              // We die, they don't - bad!
              const myVal = this._creatureValue(creature);
              attackValue -= 4 + myVal * 0.4;
            }
          }
        } else {
          // No valid blockers - free damage! Always worth attacking
          attackValue += 3;
        }
      }

      // === Opponent combat tricks/abilities: reduce confidence in close trades ===
      if (typeof CombatSim !== 'undefined') {
        const oppPotential = CombatSim.getOpponentCombatPotential(state, oppId);
        if (oppPotential.buffPotential > 0 && attackValue > 0 && attackValue < 8) {
          // Close trades become risky when opponent has buff abilities + mana
          attackValue -= Math.min(oppPotential.buffPotential, 4);
        }
      }

      // === Board context adjustments ===
      if (boardScore > 20) attackValue -= 2; // Conservative when winning big
      if (boardScore < -15) attackValue += 3; // Aggressive when losing
      if (opponentLife <= 8) attackValue += 2; // Close to lethal
      if (winningRace && !CardEngine.hasKeyword(creature, 'Vigilance')) {
        attackValue -= 1; // Don't need to risk when winning race
      }
      if (!winningRace && oppClockTurns <= 3) {
        attackValue += 2; // Must be aggressive - opponent kills soon
      }

      // === Combat trick bonus ===
      if (hasCombatTrick && attackValue >= 0) {
        attackValue += 2; // Trick makes marginal attacks profitable
      }

      // Phase 4: Threshold - attack or hold back
      if (attackValue >= 3) {
        CombatSystem.declareAttacker(state.combat, creature);
      } else if (attackValue >= 1 && hasCombatTrick) {
        CombatSystem.declareAttacker(state.combat, creature);
      }
      // else: hold back as blocker
    }

    if (state.combat.attackers.length > 0) {
      state.log.push(`Oponente ataca com ${state.combat.attackers.length} criatura(s).`);
      // Tap attackers at declaration (unless vigilance) - MTG: tap when attacking
      state.combat.attackers.forEach(({ card }) => {
        if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
          card._tapped = true;
          card._tappedByAttack = true;
          const tapLogs = GameState.fireTrigger(state, 'becomes_tapped', {
            cardUid: card._uid, card: card, controllerId: playerId
          });
          if (tapLogs.length > 0) state.log.push(...tapLogs);
        }
      });
      // Record attack action for UI
      if (!state._aiActions) state._aiActions = [];
      const attackerNames = state.combat.attackers.map(c => `${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})`).join(', ');
      state._aiActions.push({
        type: 'attack',
        attackers: state.combat.attackers.filter(c => c).map(c => ({ name: c.name || 'Criatura', image_normal: c.image_normal || '', image_small: c.image_small || '', power: CardEngine.getPower(c), toughness: CardEngine.getToughness(c) })),
        description: `Oponente ataca com ${state.combat.attackers.length} criatura(s): ${attackerNames}`
      });
    }
  },

  // AI orders blockers for damage assignment (attacking player orders)
  // Strategy: prioritize killing the most dangerous blocker first
  orderBlockers(state, playerId) {
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
  },

  declareBlockers(state, playerId) {
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
      this._legacyDeclareBlockers(state, playerId, blockerCandidates, attackers, myLife);
    }

    const blockCount = Object.values(state.combat.blockers).reduce((sum, b) => sum + b.length, 0);
    if (blockCount > 0) {
      state.log.push(`Voce bloqueia com ${blockCount} criatura(s).`);
    }
  },

  // Legacy blocking logic (fallback if CombatSim not loaded)
  _legacyDeclareBlockers(state, playerId, blockerCandidates, attackers, myLife) {
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
          const score = 100 + this._creatureValue(attacker);
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
          const score = this._creatureValue(attacker) - this._creatureValue(blocker);
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
          .sort((a, b) => this._creatureValue(a) - this._creatureValue(b));
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
  },

  discard(state, playerId, amount) {
    const hand = state.players[playerId].zones.hand;
    const cards = hand.getAll().sort((a, b) => {
      const scoreA = this._keepScore(a);
      const scoreB = this._keepScore(b);
      return scoreA - scoreB;
    });

    for (let i = 0; i < amount && cards.length > 0; i++) {
      const card = cards.shift();
      hand.remove(card._uid);
      state.players[playerId].zones.graveyard.add(card);
      state.log.push(`Oponente descarta ${card.name}.`);
    }
  },

  _keepScore(card) {
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
  },

  _chooseTargets(state, playerId, card) {
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
        case 'damage': {
          if (effect.target === 'attacking_or_blocking_creature') {
            // Only target creatures currently in combat
            const allBf = [...state.players[0].zones.battlefield.cards, ...state.players[1].zones.battlefield.cards];
            const combatCreatures = allBf
              .filter(c => CardEngine.isCreature(c) && (c._attacking || c._blocking) && CardEngine.canBeTargeted(c, playerId))
              .sort((a, b) => this._threatScore(b) - this._threatScore(a));
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
                return this._threatScore(b) - this._threatScore(a);
              });
              targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
            }
          } else if (effect.target === 'creature' || effect.target === 'any target' || effect.target === 'creature or player' || effect.target === 'creature or planeswalker') {
            // Filter for targetable (hexproof/shroud check), sort by threat score, prefer non-ward
            const opCreatures = state.players[opponentId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
              .sort((a, b) => {
                const aWard = CardEngine.hasWard(a) ? 1 : 0;
                const bWard = CardEngine.hasWard(b) ? 1 : 0;
                if (aWard !== bWard) return aWard - bWard;
                return this._threatScore(b) - this._threatScore(a);
              });

            if (opCreatures.length > 0) {
              const dmgAmount = effect.amount || 0;
              // Prefer killable targets: toughness - existing damage <= our damage
              const killable = opCreatures.filter(c =>
                CardEngine.getToughness(c) - (c._damage || 0) <= dmgAmount
              ).sort((a, b) => this._threatScore(b) - this._threatScore(a));

              if (killable.length > 0) {
                targets.push({ type: 'creature', player: opponentId, uid: killable[0]._uid });
              } else if (effect.target !== 'creature' && effect.target !== 'creature or planeswalker') {
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
            } else if (effect.target !== 'creature') {
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
              .sort((a, b) => this._threatScore(b) - this._threatScore(a));
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
              .sort((a, b) => this._threatScore(b) - this._threatScore(a));
            if (opNonCreatures.length > 0) {
              targets.push({ type: 'creature', player: opponentId, uid: opNonCreatures[0]._uid });
            }
            break;
          }
          if (tgt === 'noncreature_permanent') {
            const opPermanents = state.players[opponentId].zones.battlefield.cards
              .filter(c => !CardEngine.isCreature(c) && !CardEngine.isLand(c) && CardEngine.canBeTargeted(c, playerId))
              .sort((a, b) => this._threatScore(b) - this._threatScore(a));
            if (opPermanents.length > 0) {
              targets.push({ type: 'creature', player: opponentId, uid: opPermanents[0]._uid });
            }
            break;
          }
          // Sort by threat score instead of raw power
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => {
              const aWard = CardEngine.hasWard(a) ? 1 : 0;
              const bWard = CardEngine.hasWard(b) ? 1 : 0;
              if (aWard !== bWard) return aWard - bWard;
              return this._threatScore(b) - this._threatScore(a);
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

        case 'buff': {
          if (effect.target === 'creature' || effect.target === 'own_creature') {
            const myCreatures = state.players[playerId].zones.battlefield.cards
              .filter(c => CardEngine.isCreature(c))
              .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            if (myCreatures.length > 0) {
              targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
            }
          }
          break;
        }

        case 'counter': {
          if (effect.counter === '+1/+1') {
            if (effect.target === 'own_creature' || !effect.target || effect.target === 'creature') {
              const myCreatures = state.players[playerId].zones.battlefield.cards
                .filter(c => CardEngine.isCreature(c))
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
          const opCreatures = state.players[opponentId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && !c._tapped && CardEngine.canBeTargeted(c, playerId))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (opCreatures.length > 0) {
            targets.push({ type: 'creature', player: opponentId, uid: opCreatures[0]._uid });
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
          // Target own best creature
          const myCreatures = state.players[playerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c))
            .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          if (myCreatures.length > 0) {
            targets.push({ type: 'creature', player: playerId, uid: myCreatures[0]._uid });
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
  },

  // =================== AI INSTANT PRIORITY ===================
  // Called during combat_begin, combat_damage, end_step when AI is non-active player
  playInstantPhase(state, playerId, phase) {
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
      const score = this._scoreInstant(card, state, playerId, phase, myCreatures, oppCreatures);
      return { card, score };
    }).sort((a, b) => b.score - a.score);

    for (const { card, score } of scored) {
      if (score <= 5) break; // Threshold: not worth casting

      if (!ManaSystem.canAfford(state, playerId, card)) continue;

      GameState.autoTapForSpell(state, playerId, card.mana_cost, card.cmc, card);
      const targets = this._chooseTargets(state, playerId, card);

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
    this._tryActivatedAbilitiesInCombat(state, playerId, phase);
  },

  // Try activated abilities during combat priority windows
  _tryActivatedAbilitiesInCombat(state, playerId, phase) {
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

        const { manaCost, cmc } = this._getAbilityManaCost(ability);
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
  },

  _scoreInstant(card, state, playerId, phase, myCreatures, oppCreatures) {
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
          const biggestThreat = Math.max(...untappedThreats.map(c => this._threatScore(c)), 0);
          score += 4 + biggestThreat * 0.5;
        }
      }
      if (hasRemoval && oppCreatures.length > 0) {
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
        score += 4 + biggestThreat * 0.5;
      }
      if (hasBounce && oppCreatures.length > 0) {
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
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
          const biggestAtk = Math.max(...combat.attackers.map(a => this._threatScore(a.card)), 0);
          score += 8 + biggestAtk;
        }
        if (hasBounce && combat && combat.attackers.length > 0) {
          const biggestAtk = Math.max(...combat.attackers.map(a => this._threatScore(a.card)), 0);
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
        if (this._shouldUseCombatTrick(state, playerId, card, combat)) {
          const myBf = state.players[playerId].zones.battlefield;
          let bestCreatureVal = 0;
          for (const atk of (combat.attackers || [])) {
            if (atk.card && myBf.get(atk.card._uid)) {
              const blockers = combat.blockers[atk.uid] || [];
              if (blockers.length > 0) {
                bestCreatureVal = Math.max(bestCreatureVal, this._creatureValue(atk.card));
              }
            }
          }
          for (const [, blockerArr] of Object.entries(combat.blockers || {})) {
            for (const b of blockerArr) {
              if (b.card && myBf.get(b.card._uid)) {
                bestCreatureVal = Math.max(bestCreatureVal, this._creatureValue(b.card));
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
              maxBlockerThreat = Math.max(maxBlockerThreat, this._threatScore(b.card));
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
        if (this._shouldUseCombatTrick(state, playerId, card, combat)) {
          // Find the creature the trick would save/upgrade
          const myBf = state.players[playerId].zones.battlefield;
          let bestCreatureVal = 0;
          for (const atk of (combat.attackers || [])) {
            if (atk.card && myBf.get(atk.card._uid)) {
              const blockers = combat.blockers[atk.uid] || [];
              if (blockers.length > 0) {
                bestCreatureVal = Math.max(bestCreatureVal, this._creatureValue(atk.card));
              }
            }
          }
          for (const [, blockerArr] of Object.entries(combat.blockers || {})) {
            for (const b of blockerArr) {
              if (b.card && myBf.get(b.card._uid)) {
                bestCreatureVal = Math.max(bestCreatureVal, this._creatureValue(b.card));
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
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
        score += 5 + biggestThreat * 0.5;
      }
      if (hasTap && oppCreatures.length > 0) {
        const untappedThreats = oppCreatures.filter(c => !c._tapped);
        if (untappedThreats.length > 0) {
          const biggestThreat = Math.max(...untappedThreats.map(c => this._threatScore(c)), 0);
          score += 4 + biggestThreat * 0.4;
        }
      }
      if (hasRemoval && oppCreatures.length > 0) {
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
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
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
        score += 3 + biggestThreat * 0.4;
      }
      if (hasBounce && oppCreatures.length > 0) {
        const biggestThreat = Math.max(...oppCreatures.map(c => this._threatScore(c)), 0);
        score += 3 + biggestThreat * 0.3;
      }
      if (hasTap) score += 3;
    }

    return score;
  },

  _getColorNeeds(handCards) {
    const needs = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    handCards.forEach(card => {
      if (CardEngine.isLand(card)) return;
      const cost = ManaSystem.parseCost(card.mana_cost);
      Object.entries(cost.colored).forEach(([c, n]) => {
        if (needs[c] !== undefined) needs[c] += n;
      });
    });
    return needs;
  },

  // =================== STATE CLONING FOR SIMULATION ===================
  // Lightweight clone: only copies data needed for evaluation, not triggers/VFX/UI
  _cloneStateForSim(state) {
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
          hand: this._cloneZone(p.zones.hand),
          battlefield: this._cloneZone(p.zones.battlefield),
          // Minimal zones — not deeply cloned
          graveyard: { count: () => p.zones.graveyard.count(), getAll: () => [] },
          library: { count: () => p.zones.library.count() },
          exile: { count: () => p.zones.exile ? p.zones.exile.count() : 0 }
        }
      };
    }

    return clone;
  },

  // Clone a zone's cards as lightweight snapshots
  _cloneZone(zone) {
    const cards = zone.getAll ? zone.getAll().map(c => this._cloneCard(c)) : [];
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
  },

  // Shallow clone a card with key properties
  _cloneCard(card) {
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
  },

  // Evaluate a simulated board state score (simplified for speed)
  _quickEvalBoard(simState, playerId) {
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
  },

  // =================== SPELL SEQUENCING OPTIMIZATION ===================
  // Try top N playable cards, simulate each, pick best sequence
  _findBestSpellOrder(state, playerId) {
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

    const baseEval = this._evaluateBoard(state, playerId);

    for (const card of candidates) {
      // Check affordability
      if (!ManaSystem.canAfford(state, playerId, card)) continue;

      // Simulate casting this card
      const simState = this._cloneStateForSim(state);
      const simBf = simState.players[playerId].zones.battlefield;

      // Add creature/permanent to battlefield or resolve spell effects
      if (CardEngine.isCreature(card) || CardEngine.isPermanent(card)) {
        // Simulate: remove from hand, add to battlefield
        simState.players[playerId].zones.hand.remove(card._uid);
        const clonedCard = this._cloneCard(card);
        simBf.add(clonedCard);
      } else {
        // Spell: simulate effect impact on board
        simState.players[playerId].zones.hand.remove(card._uid);
        const effects = CardEngine.getSpellEffects(card);
        for (const eff of effects) {
          if (eff.type === 'draw') {
            // Increase hand count
            for (let i = 0; i < (eff.amount || 1); i++) {
              simState.players[playerId].zones.hand.add(this._cloneCard({ _uid: 'drawn_' + i, name: 'Drawn', type_line: 'Card', cmc: 0 }));
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
            simBf.add(this._cloneCard({ _uid: 'ramp_land', name: 'Land', type_line: 'Land', cmc: 0, _tapped: true }));
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
      const simEval = this._quickEvalBoard(simState, playerId);

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
            // Extra bonus relative to base eval
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
  },

  // =================== INSTANT TIMING OPTIMIZATION ===================
  // Check if using a combat trick changes the combat outcome
  _shouldUseCombatTrick(state, playerId, trickCard, combatState) {
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
};
