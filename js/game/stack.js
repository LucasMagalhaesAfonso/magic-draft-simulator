const GameStack = {
  create() {
    return {
      items: [] // [{card, controller, targets, effects}]
    };
  },

  push(stack, item) {
    stack.items.push(item);
  },

  resolve(stack, gameState) {
    const log = [];

    while (stack.items.length > 0) {
      const item = stack.items.pop();
      const results = this._resolveItem(item, gameState);
      // Ensure results is always an array
      if (Array.isArray(results)) {
        log.push(...results);
      } else {
        console.warn('[STACK] _resolveItem returned non-array:', results);
      }
    }

    return log;
  },

  // Convenience: push + resolve in one call (used by adventure spells)
  resolveEffects(state, controller, card, effects, targets) {
    this.push(state.stack, { card, controller, targets: targets || [], effects });
    const log = this.resolve(state.stack, state);
    state.log.push(...log);
  },

  _resolveItem(item, gameState) {
    const { card, controller, targets, effects } = item;
    const log = [];
    const opponent = controller === 0 ? 1 : 0;

    // Check if spell was countered
    if (card._countered) {
      log.push(`${card.name} foi anulado e nao resolve.`);
      return log;
    }

    log.push(`${card.name} resolve.`);

    // Helper: resolve dynamic amounts to numbers
    const resolveAmount = (amt) => {
      if (typeof amt === 'number') return amt;
      if (!amt) return 0;
      if (amt === 'vivid') return CardEngine.countVividColors(gameState, controller);
      if (amt === 'X') return gameState._currentXValue || 0; // Use context X value
      if (amt === 'creature_count') return gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length;
      if (amt === 'lands_count') return gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isLand(c)).length;
      if (amt === 'lands_in_gy_count') return gameState.players[controller].zones.graveyard.getAll().filter(c => CardEngine.isLand(c)).length;
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
            log.push(`${card.name}: escolha ${chooseCount === 1 ? 'um modo' : chooseCount + ' modos'}.`);
            return log; // Stop resolving — will continue after human picks
          } else {
            // AI picks best mode(s)
            const chosen = this._aiChooseModes(modes, chooseCount, gameState, controller, opponent, targets);
            const modeEffects = chosen.flatMap(m => Array.isArray(m) ? m : [m]);
            effects.splice(ei + 1, 0, ...modeEffects);
            log.push(`Modo(s) escolhido(s): ${modeEffects.map(e => e.type).join(', ')}.`);
          }
          break;
        }

        case 'damage': {
          const dmgAmt = resolveAmount(effect.amount);
          if (effect.target === 'opponent' || effect.target === 'player') {
            gameState.players[opponent].life -= dmgAmt;
            // Track damage dealt this turn (for Spinerock Knoll hideaway)
            if (!gameState._damageDealtThisTurn) gameState._damageDealtThisTurn = [0, 0];
            gameState._damageDealtThisTurn[opponent] = (gameState._damageDealtThisTurn[opponent] || 0) + dmgAmt;
            log.push(`${dmgAmt} dano ao oponente. (Vida: ${gameState.players[opponent].life})`);
            if (typeof VFX !== 'undefined') VFX.playerDamage(opponent);
            // Lifelink on spell damage from source creature
            if (card && CardEngine.isCreature(card) && CardEngine.hasLifelink(card)) {
              gameState.players[controller].life += dmgAmt;
              log.push(`Lifelink: +${dmgAmt} vida.`);
              if (typeof VFX !== 'undefined') VFX.heal(controller);
            }
          } else if (targets && targets.length > 0) {
            const target = targets[0];
            // Validate target (hexproof/shroud)
            if (target.type === 'creature') {
              const bf = gameState.players[target.player].zones.battlefield;
              const creature = bf.get(target.uid);
              if (creature) {
                if (!CardEngine.canBeTargeted(creature, controller)) {
                  log.push(`${creature.name} nao pode ser alvo (hexproof/shroud).`);
                  break;
                }
                if (!this._payWardCost(creature, controller, gameState, log)) break;
                if (typeof VFX !== 'undefined') VFX.damage(creature._uid);
                creature._damage += dmgAmt;
                // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
                creature._damagedThisTurn = true;
                if (creature._damage >= CardEngine.getToughness(creature)) {
                  GameState.creatureDies(gameState, creature, target.player);
                  log.push(`${creature.name} recebe ${dmgAmt} dano e morre.`);
                } else {
                  log.push(`${creature.name} recebe ${dmgAmt} dano.`);
                }
              }
            } else if (target.type === 'player') {
              gameState.players[target.player].life -= dmgAmt;
              log.push(`${dmgAmt} dano ao jogador. (Vida: ${gameState.players[target.player].life})`);
            }
          }
          break;
        }

        case 'damage_all_creatures': {
          for (const pid of [0, 1]) {
            const bf = gameState.players[pid].zones.battlefield;
            const creatures = bf.cards.filter(c => CardEngine.isCreature(c));
            const dying = [];
            for (const creature of creatures) {
              creature._damage += effect.amount;
              if (creature._damage >= CardEngine.getToughness(creature)) {
                dying.push(creature);
                log.push(`${creature.name} recebe ${effect.amount} dano e morre.`);
              } else {
                log.push(`${creature.name} recebe ${effect.amount} dano.`);
              }
            }
            dying.forEach(c => GameState.creatureDies(gameState, c, pid));
          }
          break;
        }

        case 'destroy': {
          if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const permanent = bf.get(target.uid);
            if (permanent) {
              // Check targeting
              if (!CardEngine.canBeTargeted(permanent, controller)) {
                log.push(`${permanent.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              // Check indestructible
              if (CardEngine.hasIndestructible(permanent)) {
                log.push(`${permanent.name} e indestruivel!`);
                break;
              }
              if (CardEngine.isCreature(permanent)) {
                const died = GameState.creatureDies(gameState, permanent, target.player);
                if (died) log.push(`${permanent.name} e destruido.`);
              } else {
                // Non-creature permanent (enchantment, artifact, planeswalker)
                bf.remove(permanent._uid);
                GameState._unregisterCardTriggers(gameState, permanent._uid);
                gameState.players[target.player].zones.graveyard.add(permanent);
                log.push(`${permanent.name} e destruido.`);
                if (typeof VFX !== 'undefined') VFX.destroy(permanent._uid);
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
              if (effect.target === 'creatures' || effect.target === 'opponent_creatures') return CardEngine.isCreature(c);
              if (effect.target === 'creatures_and_enchantments') return CardEngine.isCreature(c) || (c.type_line && c.type_line.toLowerCase().includes('enchantment'));
              if (effect.target === 'nonland') return !CardEngine.isLand(c);
              return false;
            });
            const dying = toDestroy.filter(c => !CardEngine.hasIndestructible(c));
            const surviving = toDestroy.filter(c => CardEngine.hasIndestructible(c));
            surviving.forEach(c => log.push(`${c.name} e indestruivel!`));
            dying.forEach(c => {
              GameState.creatureDies(gameState, c, pid);
              log.push(`${c.name} e destruido.`);
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
            const nonlandCards = hand.getAll().filter(c => !CardEngine.isLand(c));

            if (nonlandCards.length === 0) {
              log.push('Oponente nao tem cartas nao-terreno na mao.');
              break;
            }

            if (gameState.players[controller].isHuman) {
              // Human player: show hand and let them choose which card to exile
              gameState._pendingHandExile = {
                targetPlayerId: opponentId,
                cardToExile: card, // The card doing the exiling (for storing exiled card)
                choices: nonlandCards,
                selected: null,
                controller
              };
              gameState.waitingForInput = { type: 'opponent_hand_exile', playerId: controller };
              log.push(`Escolha uma carta nao-terreno da mao do oponente para exilar.`);
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
              log.push(`${exiledCard.name} e exilado da mao do oponente.`);
            }
          } else if (effect.target === 'nonland_from_hand') {
            // Special case: exile from your own hand (Aggressive Negotiations)
            const targetPlayerId = controller; // FIX: exile from controller's hand, not opponent's
            const hand = gameState.players[targetPlayerId].zones.hand;
            const nonlandCards = hand.getAll().filter(c => !CardEngine.isLand(c));

            if (nonlandCards.length === 0) {
              log.push('Nenhuma carta nao-terreno na sua mao para exilar.');
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
                log.push(`${cardToExile.name} e exilado da sua mao.`);
              } else {
                log.push('Erro: nenhuma carta valida encontrada para exilar.');
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
              if (!CardEngine.canBeTargeted(permanent, controller)) {
                log.push(`${permanent.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              // Exile bypasses indestructible
              if (typeof VFX !== 'undefined') VFX.exile(permanent._uid);
              bf.remove(permanent._uid);
              GameState._unregisterCardTriggers(gameState, permanent._uid);
              // Fire leaves_battlefield for creatures
              if (CardEngine.isCreature(permanent)) {
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

              log.push(`${permanent.name} e exilado.`);
            }
          }
          break;
        }

        case 'exile_all': {
          for (const pid of [0, 1]) {
            const bf = gameState.players[pid].zones.battlefield;
            const exile = gameState.players[pid].zones.exile;
            const toExile = bf.cards.filter(c => CardEngine.isCreature(c));
            for (const c of toExile) {
              // Remove aura effects if this creature has auras
              if (c._attachments) {
                for (const attUid of c._attachments) {
                  for (const p of gameState.players) {
                    const att = p.zones.battlefield.get(attUid);
                    if (att && CardEngine.isAura(att)) {
                      GameState._removeAuraEffects(gameState, att, c);
                    }
                  }
                }
              }
              bf.remove(c._uid);
              GameState._unregisterCardTriggers(gameState, c._uid);
              exile.add(c);
              log.push(`${c.name} e exilado.`);
            }
          }
          break;
        }

        case 'bounce': {
          if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const permanent = bf.get(target.uid);
            if (permanent) {
              if (!CardEngine.canBeTargeted(permanent, controller)) {
                log.push(`${permanent.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              if (typeof VFX !== 'undefined') VFX.bounce(permanent._uid);

              // If aura, remove effects from enchanted creature
              if (CardEngine.isAura(permanent) && permanent._attachedTo) {
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
              if (CardEngine.isCreature(permanent)) {
                GameState.fireTrigger(gameState, 'leaves_battlefield', { cardUid: permanent._uid, card: permanent, ownerId: target.player });
              }
              // Tokens disappear, non-tokens return to hand
              if (permanent._isToken) {
                log.push(`${permanent.name} token desaparece.`);
              } else {
                gameState.players[target.player].zones.hand.add(permanent);
                log.push(`${permanent.name} volta para a mao.`);
              }
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
                log.push(`Voce compra ${drawn.name}.`);
              } else {
                log.push(`Oponente compra uma carta.`);
              }
            }
          }
          if (drawAmt > 0 && typeof VFX !== 'undefined') VFX.cardDraw(controller);
          break;
        }

        case 'gainLife': {
          const gainAmt = resolveAmount(effect.amount);
          gameState.players[controller].life += gainAmt;
          log.push(`+${gainAmt} vida. (Vida: ${gameState.players[controller].life})`);
          if (typeof VFX !== 'undefined') VFX.heal(controller);
          // Fire gain_life triggers
          const gainLogs = GameState.fireTrigger(gameState, 'gain_life', { playerId: controller });
          log.push(...gainLogs);
          break;
        }

        case 'loseLife': {
          // loseLife is a drawback/cost — defaults to controller (self-harm)
          const loseLifeTarget = (effect.target === 'opponent' || effect.target === 'each_opponent') ? opponent : controller;
          const loseAmt = resolveAmount(effect.amount);
          gameState.players[loseLifeTarget].life -= loseAmt;
          log.push(`${loseLifeTarget === controller ? 'Voce perde' : 'Oponente perde'} ${loseAmt} vida. (Vida: ${gameState.players[loseLifeTarget].life})`);
          break;
        }

        case 'buff': {
          // Buffs from non-permanent spells are temporary (until end of turn)
          const isTemp = !CardEngine.isPermanent(card);
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
            const p = buffPow === 'double' ? CardEngine.getPower(creature) : (buffPow || 0);
            const t = buffTou === 'double' ? CardEngine.getToughness(creature) : (buffTou || 0);
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
              if (CardEngine.isCreature(c)) {
                const r = applyBuff(c);
                bp = r.p; bt = r.t;
              }
            });
            log.push(`Todas as criaturas recebem ${bp >= 0 ? '+' : ''}${bp}/${bt >= 0 ? '+' : ''}${bt}.`);
          } else if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!CardEngine.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              const r = applyBuff(creature);
              log.push(`${creature.name} recebe ${r.p >= 0 ? '+' : ''}${r.p}/${r.t >= 0 ? '+' : ''}${r.t}.`);
              // Apply keywords from buff effect (e.g. Alesha's Legacy grants deathtouch+indestructible)
              if (effect.keywords && effect.keywords.length > 0) {
                if (!creature.keywords) creature.keywords = [];
                effect.keywords.forEach(kw => {
                  const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
                  if (!creature.keywords.includes(kwCap)) creature.keywords.push(kwCap);
                  if (!creature._tempKeywords) creature._tempKeywords = [];
                  creature._tempKeywords.push(kwCap);
                });
                log.push(`${creature.name} ganha ${effect.keywords.join(', ')} ate o fim do turno.`);
              }
              if (CardEngine.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, target.player);
                log.push(`${creature.name} morre.`);
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

          if (typeof VFX !== 'undefined') {
            const libEl = document.querySelector('.game-library');
            if (libEl) libEl.classList.add('library-glow-scry');
            setTimeout(() => { if (libEl) libEl.classList.remove('library-glow-scry'); }, 1500);
          }

          if (gameState.players[controller].isHuman) {
            gameState._pendingScry = {
              type: 'scry',
              cards: top,
              playerId: controller,
              choices: top.map(() => 'top')
            };
            gameState.waitingForInput = { type: 'scry', playerId: controller };
            log.push(`Scry ${effect.amount} - escolha quais ficam no topo.`);
          } else {
            const keep = [];
            const bottom = [];
            for (const c of top) {
              const bf = gameState.players[controller].zones.battlefield;
              const landCount = bf.cards.filter(x => CardEngine.isLand(x)).length;
              if (CardEngine.isLand(c) && landCount < 4) {
                keep.push(c);
              } else if (CardEngine.isLand(c) && landCount >= 5) {
                bottom.push(c);
              } else if (CardEngine.isCreature(c) || c.cmc <= landCount + 1) {
                keep.push(c);
              } else {
                bottom.push(c);
              }
            }
            for (const c of keep.reverse()) lib.addToTop(c);
            for (const c of bottom) lib.addToBottom(c);
            log.push(`Oponente faz scry ${effect.amount}.`);
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

          if (typeof VFX !== 'undefined') {
            const libEl = document.querySelector('.game-library');
            if (libEl) libEl.classList.add('library-glow-surveil');
            setTimeout(() => { if (libEl) libEl.classList.remove('library-glow-surveil'); }, 1500);
          }

          if (gameState.players[controller].isHuman) {
            gameState._pendingScry = {
              type: 'surveil',
              cards: top,
              playerId: controller,
              choices: top.map(() => 'top')
            };
            gameState.waitingForInput = { type: 'surveil', playerId: controller };
            log.push(`Surveil ${effect.amount} - escolha quais vao pro cemiterio.`);
          } else {
            const gy = gameState.players[controller].zones.graveyard;
            const keep = [];
            const toGY = [];

            for (const c of top) {
              const bf = gameState.players[controller].zones.battlefield;
              const landCount = bf.cards.filter(x => CardEngine.isLand(x)).length;
              if (CardEngine.isLand(c) && landCount >= 5) {
                toGY.push(c);
              } else if (c.cmc > landCount + 2) {
                toGY.push(c);
              } else {
                keep.push(c);
              }
            }

            for (const c of keep.reverse()) lib.addToTop(c);
            for (const c of toGY) gy.add(c);
            log.push(`Oponente faz surveil ${effect.amount}.`);
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
              log.push(`Escolha quem sera millado (${millAmt} cartas).`);
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
            const who = targetPlayer === 0 ? 'Voce' : 'Oponente';
            log.push(`${who} coloca ${milled.length} carta(s) no cemiterio: ${milled.slice(0, 3).join(', ')}${milled.length > 3 ? '...' : ''}`);
            if (typeof VFX !== 'undefined') VFX.mill(targetPlayer);
          }
          break;
        }

        case 'mill_land_choice': {
          // Mill land choice: put a land from recently milled cards into hand, or +1/+1 counter
          const gy = gameState.players[controller].zones.graveyard;
          const recentMilled = gy.getAll().slice(-3); // Last 3 cards added (from mill)
          const milledLands = recentMilled.filter(c => CardEngine.isLand(c));

          if (milledLands.length === 0) {
            // No lands milled, auto-counter
            const targetCard = gameState.players[controller].zones.battlefield.get(card._uid);
            if (targetCard) {
              if (!targetCard._counters) targetCard._counters = { '+1/+1': 0, '-1/-1': 0 };
              targetCard._counters['+1/+1']++;
              log.push(`${targetCard.name} recebe +1/+1 (nenhum terreno millado).`);
            }
          } else if (gameState.players[controller].isHuman) {
            // Human: choice between land to hand or +1/+1 counter
            gameState._pendingMillLandChoice = {
              cardUid: card._uid,
              milledLands: milledLands,
              controller: controller
            };
            gameState.waitingForInput = { type: 'mill_land_choice', playerId: controller };
            log.push(`Escolha: colocar terreno na mao ou +1/+1 counter.`);
            return log;
          } else {
            // AI: always take land if available
            const landToTake = milledLands[0];
            gy.remove(landToTake._uid);
            gameState.players[controller].zones.hand.add(landToTake);
            log.push(`${landToTake.name} volta para a mao.`);
          }
          break;
        }

        case 'ramp': {
          console.log('[RAMP DEBUG] Stack.js ramp effect called:', effect);
          const lib = gameState.players[controller].zones.library;
          const bf = gameState.players[controller].zones.battlefield;
          const isBasicOnly = effect.landType === 'basic' || !effect.landType;
          const availableLands = lib.cards.filter(c => isBasicOnly ? CardEngine.isBasicLand(c) : CardEngine.isLand(c));

          if (availableLands.length === 0) {
            lib.shuffle();
            log.push(`Nenhum terreno encontrado no grimorio.`);
            break;
          }

          // Determine final destination (to_top can be overridden by condition)
          let toTop = effect.to_top || false;
          let toBattlefield = false;
          if (toTop && effect.condition === 'control_dragon' && effect.condition_dest === 'battlefield_tapped') {
            const hasDragon = bf.cards.some(c => CardEngine.hasCreatureType(c, 'Dragon'));
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
            log.push(`Escolha um terreno da sua biblioteca.`);
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
              const colors = CardEngine.getLandManaColors ? CardEngine.getLandManaColors(l) : [];
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
            console.log(`[RAMP DEBUG] to_hand: ${effect.to_hand}, toTop: ${toTop}, toBattlefield: ${toBattlefield}`);
            if (effect.to_hand) {
              console.log('[RAMP DEBUG] Adding to HAND');
              gameState.players[controller].zones.hand.add(land);
              lib.shuffle();
              log.push(`Oponente busca ${land.name} no grimorio e coloca na mao.`);
            } else if (toTop) {
              lib.cards.unshift(land);
              // Don't shuffle - card goes on top
              log.push(`Oponente busca ${land.name} e coloca no topo do grimorio.`);
            } else if (toBattlefield) {
              const bfLand = CardEngine.prepareForBattlefield(land);
              bfLand._tapped = true;
              bfLand._summoningSick = false;
              bf.add(bfLand);
              lib.shuffle();
              log.push(`Oponente busca ${land.name} e coloca no campo virado.`);
            } else {
              console.log('[RAMP DEBUG] Adding to BATTLEFIELD (default case)');
              const bfLand = CardEngine.prepareForBattlefield(land);
              bfLand._tapped = effect.tapped ? true : false;
              bfLand._summoningSick = false;
              bf.add(bfLand);
              lib.shuffle();
              log.push(`Oponente busca ${land.name} no grimorio e coloca no campo${effect.tapped ? ' virado' : ''}.`);
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
          const creatures = bf.cards.filter(c => CardEngine.isCreature(c));
          if (creatures.length === 0) {
            log.push(`${gameState.players[targetPlayer].isHuman ? 'Voce' : 'Oponente'} nao tem criaturas para exilar.`);
          } else if (creatures.length === 1 || !gameState.players[targetPlayer].isHuman) {
            // Auto-pick strongest creature or only option
            const creature = creatures.length === 1 ? creatures[0] : creatures.reduce((a, b) => (CardEngine.getPower(b) + CardEngine.getToughness(b)) - (CardEngine.getPower(a) + CardEngine.getToughness(a)) > 0 ? b : a);
            bf.remove(creature._uid);
            exile.add(creature);
            log.push(`${creature.name} e exilado da criatura do oponente.`);
          }

          // Exile opponent's graveyard
          const gyCards = gy.getAll();
          gyCards.forEach(c => {
            gy.remove(c._uid);
            exile.add(c);
          });
          if (gyCards.length > 0) {
            log.push(`${gyCards.length} carta(s) do cemiterio do oponente foram exiladas.`);
          }
          break;
        }

        case 'severance_priest_token': {
          // Create Spirit token equal to CMC of exiled card (from Severance Priest)
          if (!card._exiledByPriest || card._exiledByPriest.length === 0) {
            log.push('Nenhuma carta foi exilada por Severance Priest.');
            break;
          }

          const exiledData = card._exiledByPriest[card._exiledByPriest.length - 1];
          const cmc = exiledData.cmc || 0;

          // Create the Spirit token
          const token = CardEngine.createToken(controller, cmc, cmc, 'Spirit');
          token.type_line = 'Spirit';
          token.colors = ['W'];
          token.color_identity = ['W'];

          const bf = gameState.players[controller].zones.battlefield;
          bf.add(token);
          GameState._registerCardTriggers(gameState, token, controller);

          log.push(`${controller === 0 ? 'Voce' : 'Oponente'} cria um token ${cmc}/${cmc} branco Spirit.`);
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
            const token = CardEngine.createToken(tokenOwner, effect.power, effect.toughness, effect.name);
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
              token._summoningSickness = false;
              gameState.combat.attackers.push({ uid: token._uid, card: token });
            }
            bf.add(token);
            GameState._registerCardTriggers(gameState, token, tokenOwner);
          }
          const who = gameState.players[tokenOwner].isHuman ? 'Voce' : 'Oponente';
          log.push(`${who} cria ${count} token(s) ${effect.power}/${effect.toughness} ${effect.name}.`);
          break;
        }

        case 'counter': {
          // Check if this is countering a spell (anulação) vs adding counters to creature
          if (effect.target === 'spell' || effect.target === 'creature_spell' || effect.target === 'noncreature_spell') {
            // Counter a spell on the stack
            if (!targets || targets.length === 0) {
              log.push('Counter spell requer um alvo na stack.');
              break;
            }

            const targetSpell = targets[0];
            if (!targetSpell || !targetSpell.name) {
              log.push('Alvo invalido para counter.');
              break;
            }

            // Check spell type if restricted
            if (effect.target === 'creature_spell' && !CardEngine.isCreature(targetSpell)) {
              log.push(`${targetSpell.name} nao e uma magia de criatura.`);
              break;
            }
            if (effect.target === 'noncreature_spell' && CardEngine.isCreature(targetSpell)) {
              log.push(`${targetSpell.name} e uma magia de criatura.`);
              break;
            }

            // Remove from stack
            gameState.stack = gameState.stack.filter(s => s.card._uid !== targetSpell._uid);
            log.push(`${targetSpell.name} foi anulado!`);
            break;
          }

          // Otherwise: add counters to a creature
          if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!CardEngine.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              if (!creature._counters) creature._counters = { '+1/+1': 0, '-1/-1': 0 };
              creature._counters[effect.counter] = (creature._counters[effect.counter] || 0) + effect.amount;
              log.push(`${creature.name} recebe ${effect.amount} ${effect.counter} counter(s).`);

              if (creature._counters['+1/+1'] > 0 && creature._counters['-1/-1'] > 0) {
                const cancel = Math.min(creature._counters['+1/+1'], creature._counters['-1/-1']);
                creature._counters['+1/+1'] -= cancel;
                creature._counters['-1/-1'] -= cancel;
              }

              if (CardEngine.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, target.player);
                log.push(`${creature.name} morre.`);
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
            log.push(`${self.name} entra com ${effect.amount} ${effect.counter} counter(s).`);
          }
          break;
        }

        case 'counter_all': {
          const bf = gameState.players[controller].zones.battlefield;
          const creatures = bf.cards.filter(c => CardEngine.isCreature(c));
          for (const creature of creatures) {
            if (!creature._counters) creature._counters = { '+1/+1': 0, '-1/-1': 0 };
            creature._counters[effect.counter] = (creature._counters[effect.counter] || 0) + effect.amount;
          }
          log.push(`Todas as criaturas recebem ${effect.amount} ${effect.counter} counter(s).`);
          break;
        }

        case 'discard': {
          const targetPlayer = effect.target === 'opponent' ? opponent : controller;
          const hand = gameState.players[targetPlayer].zones.hand;
          const gy = gameState.players[targetPlayer].zones.graveyard;

          const sorted = hand.getAll().sort((a, b) => {
            if (CardEngine.isLand(a) && !CardEngine.isLand(b)) return -1;
            if (!CardEngine.isLand(a) && CardEngine.isLand(b)) return 1;
            return (a.cmc || 0) - (b.cmc || 0);
          });

          const discarded = [];
          for (let i = 0; i < effect.amount && sorted.length > 0; i++) {
            const c = sorted.shift();
            hand.remove(c._uid);
            gy.add(c);
            discarded.push(c.name);
            // Track nonland discard for conditions
            if (!CardEngine.isLand(c)) {
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
            const who = targetPlayer === 0 ? 'Voce' : 'Oponente';
            log.push(`${who} descarta: ${discarded.join(', ')}.`);
          }
          break;
        }

        case 'optional_discard': {
          // Optional discard (used by Glacial Dragonhunt)
          const hand = gameState.players[controller].zones.hand;
          const handSize = hand.count();

          if (handSize === 0) {
            log.push('Nenhuma carta na mao para descartar.');
            break;
          }

          if (gameState.players[controller].isHuman) {
            // Human: optional choice overlay
            gameState._pendingOptionalDiscard = { controller, amount: effect.amount || 1 };
            gameState.waitingForInput = { type: 'optional_discard_choice', playerId: controller };
            log.push('Voce pode descartar uma carta.');
            return log;
          } else {
            // AI: decide whether to discard (70% chance if hand > 4 cards)
            const shouldDiscard = handSize > 4 ? Math.random() < 0.7 : Math.random() < 0.3;

            if (shouldDiscard) {
              const gy = gameState.players[controller].zones.graveyard;
              const sorted = hand.getAll().sort((a, b) => {
                if (CardEngine.isLand(a) && !CardEngine.isLand(b)) return -1;
                if (!CardEngine.isLand(a) && CardEngine.isLand(b)) return 1;
                return (a.cmc || 0) - (b.cmc || 0);
              });

              const toDiscard = sorted[0]; // Discard cheapest
              hand.remove(toDiscard._uid);
              gy.add(toDiscard);

              // Track nonland discard for conditions
              if (!CardEngine.isLand(toDiscard)) {
                if (!gameState._lastDiscardedNonland) gameState._lastDiscardedNonland = {};
                gameState._lastDiscardedNonland[controller] = true;
              }

              log.push(`IA descarta ${toDiscard.name}.`);
            } else {
              log.push('IA escolhe nao descartar carta.');
            }
          }
          break;
        }

        case 'fight': {
          if (targets && targets.length > 0) {
            const target = targets[0];
            const myBf = gameState.players[controller].zones.battlefield;
            const ourCreature = myBf.get(card._uid);
            const theirBf = gameState.players[target.player].zones.battlefield;
            const theirCreature = theirBf.get(target.uid);

            if (ourCreature && theirCreature) {
              const ourPower = CardEngine.getPower(ourCreature);
              const theirPower = CardEngine.getPower(theirCreature);

              theirCreature._damage += ourPower;
              ourCreature._damage += theirPower;

              if (CardEngine.hasKeyword(ourCreature, 'Deathtouch') && ourPower > 0) {
                theirCreature._damage = CardEngine.getToughness(theirCreature);
              }
              if (CardEngine.hasKeyword(theirCreature, 'Deathtouch') && theirPower > 0) {
                ourCreature._damage = CardEngine.getToughness(ourCreature);
              }

              log.push(`${ourCreature.name} luta com ${theirCreature.name}.`);

              if (theirCreature._damage >= CardEngine.getToughness(theirCreature)) {
                GameState.creatureDies(gameState, theirCreature, target.player);
                log.push(`${theirCreature.name} morre.`);
              }
              if (ourCreature._damage >= CardEngine.getToughness(ourCreature)) {
                GameState.creatureDies(gameState, ourCreature, controller);
                log.push(`${ourCreature.name} morre.`);
              }
            }
          }
          break;
        }

        case 'tap': {
          if (effect.target === 'all_opponent_creatures') {
            const tapCreatures = gameState.players[opponent].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            tapCreatures.forEach(c => { c._tapped = true; });
            log.push(`Todas as criaturas do oponente sao viradas.`);
          } else if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!CardEngine.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              const wasTapped = creature._tapped;
              creature._tapped = true;
              log.push(`${creature.name} e virado.`);
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
          }
          break;
        }

        case 'untap': {
          if (targets && targets.length > 0) {
            const target = targets[0];
            const bf = gameState.players[target.player].zones.battlefield;
            const creature = bf.get(target.uid);
            if (creature) {
              if (!CardEngine.canBeTargeted(creature, controller)) {
                log.push(`${creature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              creature._tapped = false;
              log.push(`${creature.name} e desvirado.`);
            }
          }
          break;
        }

        case 'prevent_damage': {
          // Store prevention shield on controller
          if (!gameState._damageShield) gameState._damageShield = {};
          gameState._damageShield[controller] = (gameState._damageShield[controller] || 0) + effect.amount;
          log.push(`Previne os proximos ${effect.amount} de dano.`);
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
            candidates = candidates.filter(c => CardEngine.isCreature(c));
          } else if (effect.target === 'noncreature_nonland') {
            candidates = candidates.filter(c => !CardEngine.isCreature(c) && !CardEngine.isLand(c));
          } else if (effect.target === 'creature_mv3') {
            // Yathan Roadwatcher: creature with mana value 3 or less
            candidates = candidates.filter(c => CardEngine.isCreature(c) && (c.cmc || 0) <= 3);
          } else if (effect.target === 'permanent') {
            candidates = candidates.filter(c => CardEngine.isPermanent(c));
          } else if (effect.target === 'nonland_permanent_mv2') {
            // Wayspeaker Bodyguard: nonland permanent with mana value 2 or less
            candidates = candidates.filter(c => CardEngine.isPermanent(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 2);
          }

          const amount = effect.amount || 1;

          // If optional and human player, show modal to choose
          if (optional && controller === 0 && candidates.length > 0) {
            gameState._pendingGYReturn = {
              effect, candidates, amount, toHand, toTopLibrary, controller
            };
            gameState.waitingForInput = { type: 'choose_gy_return', playerId: 0, optional: true };
            return; // Pause resolution for player choice
          }

          // Auto-pick best candidates
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          for (let i = 0; i < amount && i < candidates.length; i++) {
            const card = candidates[i];
            gy.remove(card._uid);

            // Store returned creature's power for next effect with amount: "returned_creature_power"
            if (CardEngine.isCreature(card)) {
              gameState._lastReturnedPower = CardEngine.getPower(card);
            }

            // Fire trigger when card leaves graveyard
            GameState.fireTrigger(gameState, 'card_leaves_graveyard', { playerId: controller, card: card });
            if (toTopLibrary) {
              gameState.players[controller].zones.library.cards.unshift(card);
              log.push(`${card.name} volta do cemiterio para o topo da biblioteca.`);
            } else if (toHand) {
              gameState.players[controller].zones.hand.add(card);
              log.push(`${card.name} volta do cemiterio para a mao.`);
            } else {
              const bfCard = CardEngine.prepareForBattlefield(card);
              bfCard._ownerId = controller;

              // Apply with_counters (keyword counters like hexproof, indestructible)
              if (effect.with_counters && Array.isArray(effect.with_counters)) {
                if (!bfCard._counters) bfCard._counters = {};
                for (const keyword of effect.with_counters) {
                  bfCard._counters[keyword] = (bfCard._counters[keyword] || 0) + 1;
                  log.push(`${bfCard.name} entra com contador ${keyword}.`);
                }
              }

              gameState.players[controller].zones.battlefield.add(bfCard);
              GameState._registerCardTriggers(gameState, bfCard, controller);
              log.push(`${card.name} volta do cemiterio para o campo!`);
            }
          }
          if (candidates.length === 0) {
            log.push('Nenhuma carta valida no cemiterio.');
          }
          break;
        }

        case 'debuff':
        case 'debuff_all': {
          if (effect.type === 'debuff_all') {
            const targetId = effect.target === 'opponent_creatures' ? (controller === 0 ? 1 : 0) : controller;
            const creatures = gameState.players[targetId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            for (const c of creatures) {
              c._powerMod = (c._powerMod || 0) + (effect.power || 0);
              c._toughnessMod = (c._toughnessMod || 0) + (effect.toughness || 0);
              c._tempPowerMod = (c._tempPowerMod || 0) + (effect.power || 0);
              c._tempToughnessMod = (c._tempToughnessMod || 0) + (effect.toughness || 0);
            }
            log.push(`Todas as criaturas do ${targetId === 0 ? 'jogador' : 'oponente'} recebem ${effect.power}/${effect.toughness}.`);
            // Kill creatures with 0 or less toughness
            const dying = creatures.filter(c => CardEngine.getToughness(c) <= 0);
            dying.forEach(c => GameState.creatureDies(gameState, c, targetId));
          } else if (targets && targets.length > 0) {
            const target = targets[0];
            const creature = gameState.players[target.player].zones.battlefield.get(target.uid);
            if (creature) {
              creature._powerMod = (creature._powerMod || 0) + (effect.power || 0);
              creature._toughnessMod = (creature._toughnessMod || 0) + (effect.toughness || 0);
              creature._tempPowerMod = (creature._tempPowerMod || 0) + (effect.power || 0);
              creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (effect.toughness || 0);
              log.push(`${creature.name} recebe ${effect.power}/${effect.toughness} ate o fim do turno.`);
              if (CardEngine.getToughness(creature) <= 0) {
                GameState.creatureDies(gameState, creature, target.player);
                log.push(`${creature.name} morre.`);
              }
            }
          }
          break;
        }

        case 'buff_all': {
          const targetId = effect.target === 'own_creatures' ? controller : (controller === 0 ? 1 : 0);
          const creatures = gameState.players[targetId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          for (const c of creatures) {
            const p = effect.power === 'double' ? CardEngine.getPower(c) : (effect.power || 0);
            const t = effect.toughness === 'double' ? CardEngine.getToughness(c) : (effect.toughness || 0);
            c._powerMod = (c._powerMod || 0) + p;
            c._toughnessMod = (c._toughnessMod || 0) + t;
            c._tempPowerMod = (c._tempPowerMod || 0) + p;
            c._tempToughnessMod = (c._tempToughnessMod || 0) + t;
          }
          // Grant keywords if specified
          if (effect.keywords) {
            for (const c of creatures) {
              if (!c._tempKeywords) c._tempKeywords = [];
              effect.keywords.forEach(kw => { if (!c._tempKeywords.includes(kw)) c._tempKeywords.push(kw); });
            }
          }
          log.push(`Todas as suas criaturas recebem buff ate o fim do turno.`);
          break;
        }

        case 'blight': {
          // Blight X = put X -1/-1 counters on a creature you control
          const blightAmt = effect.amount || 1;
          const blightOptional = effect.optional !== false;
          if (controller === 0 && gameState.players[0].isHuman) {
            // Human: set up interactive blight choice
            const hasCreatures = gameState.players[controller].zones.battlefield.cards.some(c => CardEngine.isCreature(c));
            if (hasCreatures) {
              GameState._setupBlightChoice(gameState, controller, blightAmt, () => {
                // After blight resolves, continue with remaining effects (bonus effects)
                if (effect.bonus && effect.bonus.length > 0) {
                  effects.splice(ei + 1, 0, ...effect.bonus);
                }
              });
              log.push(`Blight ${blightAmt}: escolha uma criatura.`);
            }
          } else {
            // AI: auto-blight
            const blightResult = GameState._performBlight(gameState, controller, blightAmt);
            if (blightResult) {
              log.push(blightResult);
              // If blight has bonus effects (e.g. "blight 1, if you do, create tokens")
              if (effect.bonus && effect.bonus.length > 0) {
                effects.splice(ei + 1, 0, ...effect.bonus);
              }
            }
          }
          break;
        }

        case 'blight_opponent': {
          // Force opponent to blight (e.g., "target opponent blights 2")
          const blightOppAmt = effect.amount || 1;
          const blightOppResult = GameState._performBlight(gameState, opponent, blightOppAmt);
          if (blightOppResult) log.push(blightOppResult);
          break;
        }

        case 'grant_haste': {
          // Grant haste to a creature you control (removes summoning sickness)
          const hasteCreatures = gameState.players[controller].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && c._summoningSick
          );
          if (hasteCreatures.length > 0) {
            hasteCreatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            const hasteTarget = hasteCreatures[0];
            hasteTarget._summoningSick = false;
            log.push(`${hasteTarget.name} ganha Haste!`);
          }
          break;
        }

        case 'grant_harmonize': {
          // Grant harmonize to an instant or sorcery in the graveyard (Songcrafter Mage ETB)
          const gySpells = gameState.players[controller].zones.graveyard.getAll().filter(c =>
            CardEngine.isInstant(c) || CardEngine.isSorcery(c)
          );
          if (gySpells.length > 0) {
            gySpells.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const grantedSpell = gySpells[0];
            grantedSpell._harmonizeGranted = true;
            log.push(`${grantedSpell.name} ganha harmonize (custo: ${grantedSpell.mana_cost}).`);
          } else {
            log.push('Nenhum instant/sorcery no cemiterio para ganhar harmonize.');
          }
          break;
        }

        case 'stun':
        case 'stun_counter': {
          // Put stun counters on target creature
          const stunAmt = effect.amount || 1;
          if (targets && targets.length > 0) {
            const stunTarget = targets[0];
            const stunCreature = gameState.players[stunTarget.player].zones.battlefield.get(stunTarget.uid);
            if (stunCreature) {
              stunCreature._stunCounters = (stunCreature._stunCounters || 0) + stunAmt;
              log.push(`${stunCreature.name} recebe ${stunAmt} stun counter(s).`);
            }
          }
          break;
        }

        case 'threaten': {
          // Gain control of target creature until end of turn, untap it, give haste
          if (targets && targets.length > 0) {
            const stolenTargetInfo = targets[0];
            const stolenCard = gameState.players[stolenTargetInfo.player].zones.battlefield.get(stolenTargetInfo.uid);
            if (stolenCard && stolenTargetInfo.player !== controller) {
              const originalOwner = stolenTargetInfo.player;
              // Remove from opponent's battlefield
              gameState.players[originalOwner].zones.battlefield.remove(stolenCard._uid);
              // Add to controller's battlefield
              stolenCard._tapped = false;
              stolenCard._summoningSick = false;
              stolenCard._stolenFrom = originalOwner;
              stolenCard._tempKeywords = stolenCard._tempKeywords || [];
              if (!stolenCard._tempKeywords.includes('Haste')) stolenCard._tempKeywords.push('Haste');
              gameState.players[controller].zones.battlefield.add(stolenCard);
              const ctrlLabel = controller === 0 ? 'Voce' : 'Oponente';
              log.push(`${ctrlLabel} rouba ${stolenCard.name} ate o fim do turno!`);
            }
          }
          break;
        }

        case 'clash': {
          // Clash: each player reveals top card, higher mana value wins
          // Winner gets bonus effects; both players choose top or bottom
          const myLib = gameState.players[controller].zones.library;
          const oppLib = gameState.players[opponent].zones.library;
          const myCard = myLib.drawFromTop();
          const oppCard = oppLib.drawFromTop();

          if (!myCard && !oppCard) {
            log.push('Clash: ambas bibliotecas vazias.');
            break;
          }

          const myCmc = myCard ? (myCard.cmc || 0) : -1;
          const oppCmc = oppCard ? (oppCard.cmc || 0) : -1;
          const won = myCmc > oppCmc;

          if (controller === 0 && gameState.players[0].isHuman) {
            // Human: show clash overlay for top/bottom choice
            gameState._pendingClash = {
              cardName: card.name,
              myCard: myCard,
              oppCard: oppCard,
              myCmc, oppCmc, won,
              controller: controller,
              card: card,
              bonusEffects: effect.bonus || [],
              remainingEffects: effects.slice(ei + 1),
              targets: targets
            };
            gameState.waitingForInput = { type: 'clash', playerId: controller };
            const myName = myCard ? myCard.name : '(vazio)';
            const oppName = oppCard ? oppCard.name : '(vazio)';
            log.push(`Clash! Voce revela ${myName} (${myCmc}), oponente revela ${oppName} (${oppCmc}).`);
            log.push(won ? 'Voce vence o clash!' : 'Oponente vence o clash.');
            return log; // Stop — wait for human to choose top/bottom
          } else {
            // AI: auto-resolve. Winner puts on top, loser on bottom
            const myName = myCard ? myCard.name : '(vazio)';
            const oppName = oppCard ? oppCard.name : '(vazio)';
            log.push(`Clash! ${controller === 0 ? 'Voce revela' : 'IA revela'} ${myName} (${myCmc}) vs ${oppName} (${oppCmc}).`);

            // AI: put good cards on top, bad on bottom
            if (myCard) {
              const keepOnTop = myCmc >= 3 || CardEngine.isCreature(myCard);
              if (keepOnTop) myLib.addToTop(myCard);
              else myLib.addToBottom(myCard);
            }
            if (oppCard) {
              // Opponent AI also chooses
              const keepOnTop = oppCmc >= 3 || CardEngine.isCreature(oppCard);
              if (keepOnTop) oppLib.addToTop(oppCard);
              else oppLib.addToBottom(oppCard);
            }

            const aiWon = controller === 1 ? (oppCmc > myCmc) : won;
            if (aiWon) {
              log.push(`${controller === 0 ? 'Voce vence' : 'IA vence'} o clash!`);
              if (effect.bonus && effect.bonus.length > 0) {
                effects.splice(ei + 1, 0, ...effect.bonus);
              }
            } else {
              log.push(`${controller === 0 ? 'Voce perde' : 'IA perde'} o clash.`);
            }
          }
          break;
        }

        case 'counter_spell': {
          // Counter target spell with optional mana value restriction and unless_pay
          if (!targets || targets.length === 0) {
            log.push('Counter spell requer um alvo (spell na stack).');
            break;
          }

          const targetSpell = targets[0];
          if (!targetSpell || !targetSpell.name) {
            log.push('Alvo invalido para counter.');
            break;
          }

          // Check mana value restriction if specified
          if (effect.max_mana_value !== undefined) {
            const spellCMC = targetSpell.cmc || 0;
            if (spellCMC > effect.max_mana_value) {
              log.push(`${targetSpell.name} tem mana value ${spellCMC}, nao pode ser anulado (max ${effect.max_mana_value}).`);
              break;
            }
          }

          // Handle "unless_pay" - opponent can pay to prevent counter
          if (effect.unless_pay !== undefined) {
            const opponentId = controller === 0 ? 1 : 0;

            // Check if Dragon was beheld - increases cost to pay
            const wasDragonBeheld = !!(state._beholding && state._beholding[controller]);
            const baseCost = effect.unless_pay;
            const costWithBehold = effect.unless_pay_with_behold || baseCost;
            const finalCost = wasDragonBeheld ? costWithBehold : baseCost;

            const costToPay = ManaSystem.parseCost(`{${finalCost}}`);

            // Check if opponent can afford to pay
            const opponentPool = state.manaPool[opponentId];
            const totalManaAvailable = Object.values(opponentPool || {}).reduce((a, b) => a + b, 0) || 0;
            const canPay = costToPay.generic <= totalManaAvailable;

            if (canPay) {
              // Opponent can choose to pay
              if (state.players[opponentId].isHuman && opponentId === 0) {
                // Human player: ask for decision
                state._pendingUnlessPay = {
                  spell: targetSpell,
                  cost: finalCost,
                  spellController: controller,
                  effect: effect,
                  wasDragonBeheld: wasDragonBeheld
                };
                state.waitingForInput = { type: 'unless_pay_decision', playerId: opponentId };
                return null; // Pause for human decision
              } else {
                // AI: decide whether to pay (usually pays to save spell unless low on resources)
                const shouldPay = true; // AI simple strategy: always pay if can
                if (shouldPay) {
                  // Pay mana
                  for (let i = 0; i < finalCost; i++) {
                    // Remove generic mana
                    for (const color of Object.keys(opponentPool)) {
                      if (opponentPool[color] > 0) {
                        opponentPool[color]--;
                        break;
                      }
                    }
                  }
                  const costStr = wasDragonBeheld ? `{${finalCost}} (Dragon beheld)` : `{${finalCost}}`;
                  log.push(`${targetSpell.name} nao foi anulado (${targetSpell.controller === 0 ? 'Voce' : 'IA'} pagou ${costStr}).`);
                  break; // Don't counter
                }
              }
            }
          }

          // Mark spell as countered - it won't resolve
          targetSpell._countered = true;
          log.push(`${targetSpell.name} foi anulado.`);
          break;
        }

        case 'endure': {
          // Endure X: put X +1/+1 counters on self, OR create X 1/1 Spirit tokens with flying
          const endureAmt = resolveAmount(effect.amount) || 1;
          const endureCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (!endureCard || !CardEngine.isCreature(endureCard)) {
            // No creature on bf -> always create tokens
            for (let i = 0; i < endureAmt; i++) {
              const token = CardEngine.createToken(controller, 1, 1, 'Spirit', []);
              gameState.players[controller].zones.battlefield.add(token);
            }
            log.push(`Endure ${endureAmt}: cria ${endureAmt} Spirit(s) 1/1.`);
          } else if (gameState.players[controller].isHuman) {
            // Human: interactive choice
            gameState._pendingEndure = { cardUid: card._uid, amount: endureAmt, controllerId: controller };
            gameState.waitingForInput = { type: 'endure_choice', playerId: controller };
            log.push(`Endure ${endureAmt} - escolha entre contadores ou tokens.`);
            return log;
          } else {
            // AI: always choose counters
            if (!endureCard._counters) endureCard._counters = { '+1/+1': 0, '-1/-1': 0 };
            endureCard._counters['+1/+1'] += endureAmt;
            log.push(`${endureCard.name} endure ${endureAmt}: +${endureAmt} contadores +1/+1.`);
          }
          break;
        }

        case 'lose_life': {
          const loseTarget = effect.target === 'self' ? controller : opponent;
          gameState.players[loseTarget].life -= (effect.amount || 0);
          GameState._checkWinner(gameState);
          log.push(`${loseTarget === controller ? 'Voce perde' : 'Oponente perde'} ${effect.amount} vida.`);
          break;
        }

        case 'gain_life': {
          const gainTarget = effect.target === 'opponent' ? opponent : controller;
          gameState.players[gainTarget].life += (effect.amount || 0);
          log.push(`${gainTarget === controller ? 'Voce ganha' : 'Oponente ganha'} ${effect.amount} vida.`);
          break;
        }

        // Note: debuff and debuff_all are handled above (lines 710-730)

        case 'drain': {
          const drainAmt = resolveAmount(effect.amount);
          gameState.players[opponent].life -= drainAmt;
          gameState.players[controller].life += drainAmt;
          GameState._checkWinner(gameState);
          log.push(`Drain ${drainAmt}: oponente perde ${drainAmt} vida, voce ganha ${drainAmt} vida.`);
          if (typeof VFX !== 'undefined') { VFX.playerDamage(opponent); VFX.heal(controller); }
          const drainGainLogs = GameState.fireTrigger(gameState, 'gain_life', { playerId: controller });
          log.push(...drainGainLogs);
          break;
        }

        case 'loot': {
          // Support both old format (amount) and new format (draw, discard)
          const drawAmt = effect.draw || effect.amount || 1;
          const discardAmt = effect.discard || effect.amount || 1;

          // Draw cards first
          const drawnCards = [];
          for (let i = 0; i < drawAmt; i++) {
            const drawn = gameState.players[controller].zones.library.drawFromTop();
            if (drawn) {
              gameState.players[controller].zones.hand.add(drawn);
              drawnCards.push(drawn);
            }
          }
          if (drawnCards.length === 0) break;
          log.push(`Compra ${drawnCards.length} carta(s) (loot).`);
          if (typeof VFX !== 'undefined') VFX.cardDraw(controller);

          if (gameState.players[controller].isHuman) {
            // Human: need to choose cards to discard
            gameState._pendingLoot = { amount: discardAmt, controller };
            gameState.waitingForInput = { type: 'discard_for_loot', playerId: controller };
            log.push(`Escolha ${discardAmt} carta(s) para descartar.`);
            return log;
          } else {
            // AI: discard cheapest non-land
            const handCards = gameState.players[controller].zones.hand.getAll()
              .sort((a, b) => {
                if (CardEngine.isLand(a) && !CardEngine.isLand(b)) return -1;
                if (!CardEngine.isLand(a) && CardEngine.isLand(b)) return 1;
                return (a.cmc || 0) - (b.cmc || 0);
              });
            for (let i = 0; i < discardAmt && handCards.length > 0; i++) {
              const worst = handCards.shift();
              gameState.players[controller].zones.hand.remove(worst._uid);
              gameState.players[controller].zones.graveyard.add(worst);
              log.push(`Descarta ${worst.name} (loot).`);
            }
          }
          break;
        }

        case 'rummage': {
          // Rummage: discard first (optional), then draw that many
          const rummageAmt = effect.amount || 1;
          const isOptional = effect.optional !== false;
          const upTo = effect.upTo || false;
          const handSize = gameState.players[controller].zones.hand.count();

          if (handSize === 0) {
            log.push('Sem cartas na mao para descartar.');
            break;
          }

          if (gameState.players[controller].isHuman && controller === 0) {
            gameState._pendingRummage = { amount: rummageAmt, optional: isOptional, upTo: upTo, controller, selected: [] };
            gameState.waitingForInput = { type: 'rummage_discard', playerId: controller };
            return log;
          } else {
            // AI: discard worst cards (skip if hand is small and optional)
            const hand = gameState.players[controller].zones.hand;
            const handCards = hand.getAll().sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
            let toDiscard = Math.min(rummageAmt, handCards.length);
            if (isOptional && handCards.length <= 2) toDiscard = 0;
            if (upTo && handCards.length <= 3) toDiscard = Math.min(1, toDiscard);

            for (let i = 0; i < toDiscard; i++) {
              const worst = handCards.shift();
              if (worst) {
                hand.remove(worst._uid);
                gameState.players[controller].zones.graveyard.add(worst);
                log.push(`Descarta ${worst.name} (rummage).`);
              }
            }
            if (toDiscard > 0) {
              for (let i = 0; i < toDiscard; i++) {
                const drawn = gameState.players[controller].zones.library.drawFromTop();
                if (drawn) hand.add(drawn);
              }
              log.push(`Compra ${toDiscard} carta(s) (rummage).`);
            } else if (isOptional) {
              log.push('Oponente opta por nao descartar.');
            }
          }
          break;
        }

        case 'bounce_self': {
          const bsCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (bsCard) {
            gameState.players[controller].zones.battlefield.remove(bsCard._uid);
            GameState._unregisterCardTriggers(gameState, bsCard._uid);
            gameState.players[controller].zones.hand.add(bsCard);
            if (typeof VFX !== 'undefined') VFX.bounce(bsCard._uid);
            log.push(`${bsCard.name} volta para a mao do dono.`);
          }
          break;
        }

        case 'look_top': {
          const lookAmt = effect.amount || 1;
          const lib = gameState.players[controller].zones.library;
          const looked = [];
          for (let i = 0; i < lookAmt && lib.count() > 0; i++) {
            looked.push(lib.drawFromTop());
          }
          if (looked.length === 0) break;

          if (effect.condition === 'land_to_hand') {
            // Find lands and optionally put to hand, rest to bottom
            const lands = looked.filter(c => CardEngine.isLand(c));
            const nonLands = looked.filter(c => !CardEngine.isLand(c));
            const pickCount = effect.pick || 1;
            const isOptional = effect.optional !== false;

            if (gameState.players[controller].isHuman && lands.length > 0 && isOptional) {
              // Human: interactive choice modal to choose which lands to keep
              gameState._pendingLookTop = {
                type: 'look_top_land_choice',
                cards: looked,
                lands: lands,
                nonLands: nonLands,
                pickCount: pickCount,
                playerId: controller,
                selected: [] // Which lands to put in hand
              };
              gameState.waitingForInput = { type: 'look_top_land_choice', playerId: controller };
              log.push(`Escolha qual(is) terreno(s) colocar na mao (até ${pickCount}).`);
              return log; // Pause for human input
            } else {
              // AI or automatic: AI picks best lands
              const toHand = lands.slice(0, pickCount);
              const toBottom = [...lands.slice(pickCount), ...nonLands];
              toHand.forEach(c => {
                gameState.players[controller].zones.hand.add(c);
                log.push(`${c.name} (terreno) vai para a mao.`);
              });
              toBottom.forEach(c => lib.addToBottom(c));
              if (lands.length === 0) log.push(`Nenhum terreno encontrado entre as ${looked.length} cartas do topo.`);
            }
          } else if (effect.rest_to === 'graveyard') {
            // Look top and pick for hand, rest to graveyard
            const pickCount = effect.pick || 1;

            if (gameState.players[controller].isHuman && pickCount > 0 && looked.length >= pickCount) {
              // Human: interactive choice overlay
              gameState._pendingLookTop = {
                type: 'look_top_choice',
                cards: looked,
                pickCount: pickCount,
                choices: new Array(looked.length).fill('graveyard'), // Default all to graveyard
                playerId: controller
              };
              gameState.waitingForInput = { type: 'look_top_choice', playerId: controller };
              log.push(`Escolha ${pickCount} carta(s) para a mao.`);
              return log; // Pause here for human input, return current log
            } else {
              // AI or only one choice: auto-pick highest CMC
              looked.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
              const picked = looked.slice(0, pickCount);
              const rest = looked.slice(pickCount);
              picked.forEach(c => {
                gameState.players[controller].zones.hand.add(c);
                log.push(`${c.name} vai para a mao.`);
              });
              rest.forEach(c => gameState.players[controller].zones.graveyard.add(c));
              if (rest.length > 0) log.push(`${rest.length} carta(s) vao para o cemiterio.`);
            }
          } else if (effect.put_onto_battlefield && effect.condition === 'noncreature_nonland_mv3') {
            // Look top and put noncreature nonland permanents with CMC <= 3 onto battlefield (United Battlefront)
            const putCount = effect.put_onto_battlefield || 0;
            const candidates = looked.filter(c =>
              !CardEngine.isCreature(c) &&
              !CardEngine.isLand(c) &&
              (c.cmc || 0) <= 3
            );
            const rest = looked.filter(c => !candidates.includes(c));

            if (gameState.players[controller].isHuman && candidates.length > 0) {
              // Human: choose which permanents to put on battlefield (up to putCount)
              gameState._pendingLookTop = {
                type: 'look_top_permanent_choice',
                cards: looked,
                candidates: candidates,
                rest: rest,
                putCount: putCount,
                selected: [],
                playerId: controller
              };
              gameState.waitingForInput = { type: 'look_top_permanent_choice', playerId: controller };
              log.push(`Escolha até ${putCount} permanentes nao-criatura nao-terreno (CMC ≤ 3) para colocar no campo.`);
              return log; // Pause for human input
            } else {
              // AI: put best permanents (highest CMC first)
              candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
              const toBf = candidates.slice(0, putCount);
              const toBottom = [...candidates.slice(putCount), ...rest];
              toBf.forEach(c => {
                gameState.players[controller].zones.battlefield.add(c);
                log.push(`${c.name} entra no campo.`);
              });
              // Put rest on bottom in random order
              const shuffled = toBottom.sort(() => Math.random() - 0.5);
              shuffled.forEach(c => lib.addToBottom(c));
              if (toBf.length === 0) log.push(`Nenhum permanente elegivel encontrado.`);
            }
          } else if (effect.rest_to === 'bottom') {
            // Look top and pick for hand, rest to bottom (Rediscover the Way, etc.)
            const pickCount = effect.pick || 1;

            if (gameState.players[controller].isHuman && pickCount > 0 && looked.length > 0) {
              // Human: interactive choice overlay
              gameState._pendingLookTop = {
                type: 'look_top_choice',
                cards: looked,
                pickCount: pickCount,
                destination: 'hand', // Cards go to hand
                restDestination: 'bottom', // Rest go to bottom
                choices: looked.map((c, i) => i < pickCount ? 'hand' : 'bottom'), // Default: pick first N for hand
                playerId: controller
              };
              gameState.waitingForInput = { type: 'look_top_choice', playerId: controller };
              log.push(`Escolha ${pickCount} carta(s) para a mao (as outras vao para o fundo do deck).`);
              return log; // Pause here for human input
            } else {
              // AI or only one choice: auto-pick highest CMC
              looked.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
              const picked = looked.slice(0, pickCount);
              const rest = looked.slice(pickCount);
              picked.forEach(c => {
                gameState.players[controller].zones.hand.add(c);
                log.push(`${c.name} vai para a mao.`);
              });
              rest.forEach(c => lib.addToBottom(c));
              if (rest.length > 0) log.push(`${rest.length} carta(s) vao para o fundo do deck.`);
            }
          } else {
            // Default: look and put back (simplified for AI - put back on top)
            looked.reverse().forEach(c => lib.addToTop(c));
            log.push(`Olhou ${looked.length} carta(s) do topo.`);
          }
          break;
        }

        case 'damage_all': {
          const dmgAllAmt = resolveAmount(effect.amount);
          for (const pid of [0, 1]) {
            const bf = gameState.players[pid].zones.battlefield;
            const creatures = bf.cards.filter(c => CardEngine.isCreature(c));
            const dying = [];
            for (const creature of creatures) {
              creature._damage += dmgAllAmt;
              // Mark creature as damaged this turn (for Unsparing Boltcaster, etc.)
              creature._damagedThisTurn = true;
              if (creature._damage >= CardEngine.getToughness(creature)) {
                dying.push(creature);
                log.push(`${creature.name} recebe ${dmgAllAmt} dano e morre.`);
              } else {
                log.push(`${creature.name} recebe ${dmgAllAmt} dano.`);
              }
            }
            dying.forEach(c => GameState.creatureDies(gameState, c, pid));
          }
          break;
        }

        case 'untap_all': {
          const bf = gameState.players[controller].zones.battlefield;
          bf.cards.forEach(c => {
            if (effect.target === 'merfolk' || effect.target === 'forests' || effect.target === 'elves') {
              const matchType = effect.target === 'forests' ? 'Forest' : effect.target.charAt(0).toUpperCase() + effect.target.slice(1);
              if (CardEngine.hasCreatureType && CardEngine.hasCreatureType(c, matchType) ||
                  (c.type_line || '').toLowerCase().includes(effect.target.toLowerCase()) ||
                  (c.subtypes && c.subtypes.some(s => s.toLowerCase() === effect.target.toLowerCase()))) {
                c._tapped = false;
              }
            } else {
              c._tapped = false;
            }
          });
          log.push(`Desvirou todos os permanentes${effect.target ? ' (' + effect.target + ')' : ''}.`);
          break;
        }

        case 'discard_hand': {
          const dhTarget = effect.target === 'self' ? controller : opponent;
          const dhHand = gameState.players[dhTarget].zones.hand;
          const dhGy = gameState.players[dhTarget].zones.graveyard;
          const dhCards = dhHand.getAll();
          const count = dhCards.length;
          dhCards.forEach(c => {
            dhHand.remove(c._uid);
            dhGy.add(c);
          });
          const who = dhTarget === 0 ? 'Voce descarta' : 'Oponente descarta';
          log.push(`${who} toda a mao (${count} carta(s)).`);
          break;
        }

        case 'reveal_hand': {
          const rhTarget = effect.target === 'opponent' ? opponent : controller;
          const rhCards = gameState.players[rhTarget].zones.hand.getAll();
          if (rhCards.length > 0) {
            log.push(`Mao revelada: ${rhCards.map(c => c.name).join(', ')}.`);
          } else {
            log.push('Mao vazia.');
          }
          break;
        }

        case 'exile_graveyard': {
          const egAmt = effect.amount || 999;
          const egPid = effect.target === 'opponent' ? opponent : controller;
          const egGy = gameState.players[egPid].zones.graveyard;
          const egExile = gameState.players[egPid].zones.exile;
          const egCards = egGy.getAll().slice(0, egAmt);

          // If optional and human player, ask for confirmation
          if (effect.optional && gameState.players[controller].isHuman && egPid === controller) {
            gameState.waitingForInput = { type: 'confirm_optional', playerId: controller, message: `Exile ${egAmt} cards from your graveyard?` };
            gameState._pendingExileGraveyard = { cards: egCards, egGy, egExile };
            return; // Pause for human choice
          }

          // For AI or non-optional: always exile
          egCards.forEach(c => {
            egGy.remove(c._uid);
            egExile.add(c);
          });
          if (egCards.length > 0) log.push(`${egCards.length} carta(s) exilada(s) do cemiterio.`);
          break;
        }

        case 'exile_from_graveyard': {
          let efgPid;
          if (effect.target === 'any_graveyard') {
            // Check if graveyard choice is needed
            const myGy = gameState.players[controller].zones.graveyard.getAll();
            const oppGy = gameState.players[opponent].zones.graveyard.getAll();

            if (myGy.length > 0 && oppGy.length > 0) {
              // Both graveyards have cards - need choice
              if (controller === 0) { // Human player
                gameState.waitingForInput = { type: 'graveyard_choice', playerId: controller };
                gameState._pendingGraveyardChoice = { effect, controller, opponent };
                return; // Pause for human choice
              } else {
                // AI chooses opponent graveyard (more aggressive)
                efgPid = opponent;
              }
            } else if (myGy.length > 0) {
              efgPid = controller;
            } else {
              efgPid = opponent;
            }
          } else {
            efgPid = effect.target === 'opponent' ? opponent : controller;
          }
          const efgGy = gameState.players[efgPid].zones.graveyard;
          const efgExile = gameState.players[efgPid].zones.exile;
          const efgAmt = resolveAmount(effect.amount) || 1;
          const efgCards = efgGy.getAll();

          if (efgCards.length > 0) {
            // Check if human player needs to choose specific cards
            if (effect.choose_cards && controller === 0) {
              // For "up to X" effects, allow choosing 0 to X cards
              const maxAmount = effect.up_to_max ? efgAmt : efgAmt;
              const minAmount = effect.up_to_max ? 0 : efgAmt;

              gameState.waitingForInput = { type: 'graveyard_card_choice', playerId: controller };
              gameState._pendingGraveyardCardChoice = {
                playerId: efgPid,
                amount: maxAmount,
                minAmount: minAmount,
                cards: efgCards,
                effect,
                controller,
                remainingEffects: effects ? effects.slice(ei + 1) : [],
                targets: targets
              };
              return; // Pause for human choice
            } else {
              // Auto-pick highest CMC cards (AI or forced)
              efgCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
              const pickedCount = Math.min(efgAmt, efgCards.length);
              for (let efgI = 0; efgI < pickedCount; efgI++) {
                const picked = efgCards[efgI];
                efgGy.remove(picked._uid);
                efgExile.add(picked);
                log.push(`${picked.name} exilado do cemiterio.`);
              }
            }
          }
          break;
        }

        case 'exile_top': {
          const etLib = gameState.players[controller].zones.library;
          const etExile = gameState.players[controller].zones.exile;
          const etAmt = effect.amount || 1;
          for (let i = 0; i < etAmt; i++) {
            const topCard = etLib.drawFromTop();
            if (topCard) {
              etExile.add(topCard);
              log.push(`${topCard.name} exilado do topo da biblioteca.`);
            }
          }
          break;
        }

        case 'double_counters': {
          // Use targets if available (for "same" target effects), otherwise fallback to card
          const targetUid = (targets && targets.length > 0) ? targets[0].uid : card._uid;
          const targetPid = (targets && targets.length > 0) ? targets[0].player : controller;

          const dcCard = gameState.players[targetPid].zones.battlefield.get(targetUid);
          if (dcCard && dcCard._counters) {
            const plus = dcCard._counters['+1/+1'] || 0;
            if (plus > 0) {
              dcCard._counters['+1/+1'] = plus * 2;
              log.push(`${dcCard.name}: contadores +1/+1 dobrados (${plus} → ${plus * 2}).`);
            }
          }
          break;
        }

        case 'bounce_to_library_top': {
          if (targets && targets.length > 0) {
            const btlTarget = targets[0];
            const btlBf = gameState.players[btlTarget.player].zones.battlefield;
            const btlCreature = btlBf.get(btlTarget.uid);
            if (btlCreature) {
              if (!CardEngine.canBeTargeted(btlCreature, controller)) {
                log.push(`${btlCreature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              btlBf.remove(btlCreature._uid);
              GameState._unregisterCardTriggers(gameState, btlCreature._uid);
              gameState.players[btlTarget.player].zones.library.addToTop(btlCreature);
              log.push(`${btlCreature.name} colocado no topo da biblioteca.`);
            }
          }
          break;
        }

        case 'return_land_from_mill': {
          // Check graveyard for lands that were just milled
          const rlmGy = gameState.players[controller].zones.graveyard;
          const rlmLands = rlmGy.getAll().filter(c => CardEngine.isLand(c));
          if (rlmLands.length > 0) {
            const land = rlmLands[rlmLands.length - 1]; // most recent
            rlmGy.remove(land._uid);
            if (effect.to_hand) {
              gameState.players[controller].zones.hand.add(land);
              log.push(`${land.name} volta do cemiterio para a mao.`);
            } else {
              const bfLand = CardEngine.prepareForBattlefield(land);
              bfLand._tapped = true;
              gameState.players[controller].zones.battlefield.add(bfLand);
              log.push(`${land.name} volta do cemiterio para o campo virado.`);
            }
          }
          break;
        }

        case 'regenerate': {
          // Set regeneration shield on target creature
          if (targets && targets.length > 0) {
            const regTarget = targets[0];
            const regCreature = gameState.players[regTarget.player].zones.battlefield.get(regTarget.uid);
            if (regCreature) {
              regCreature._regenerateShield = true;
              log.push(`${regCreature.name} ganha escudo de regeneracao.`);
            }
          } else {
            // Self or type-based regeneration
            const regBf = gameState.players[controller].zones.battlefield;
            if (effect.target === 'goblin') {
              const goblins = regBf.cards.filter(c => CardEngine.isCreature(c) && CardEngine.hasCreatureType && CardEngine.hasCreatureType(c, 'Goblin'));
              if (goblins.length > 0) {
                goblins.forEach(g => { g._regenerateShield = true; });
                log.push(`Goblins ganham escudo de regeneracao.`);
              }
            } else {
              const selfCard = regBf.get(card._uid);
              if (selfCard) {
                selfCard._regenerateShield = true;
                log.push(`${selfCard.name} ganha escudo de regeneracao.`);
              }
            }
          }
          break;
        }

        case 'counter_self_if_no_draw': {
          // Only add counter if no card was drawn this turn (by opponent drawing extra)
          if (!gameState._drewExtraThisTurn || !gameState._drewExtraThisTurn[controller]) {
            const csifCard = gameState.players[controller].zones.battlefield.get(card._uid);
            if (csifCard) {
              if (!csifCard._counters) csifCard._counters = { '+1/+1': 0, '-1/-1': 0 };
              csifCard._counters[effect.counter || '+1/+1'] += 1;
              log.push(`${csifCard.name} recebe +1/+1 counter (nenhuma carta comprada extra).`);
            }
          }
          break;
        }

        case 'remove_counters': {
          if (targets && targets.length > 0) {
            const rcTarget = targets[0];
            const rcCreature = gameState.players[rcTarget.player].zones.battlefield.get(rcTarget.uid);
            if (rcCreature && rcCreature._counters) {
              const counterType = effect.counter || '+1/+1';
              const removeAmt = effect.amount || rcCreature._counters[counterType] || 0;
              rcCreature._counters[counterType] = Math.max(0, (rcCreature._counters[counterType] || 0) - removeAmt);
              log.push(`Remove ${removeAmt} contador(es) ${counterType} de ${rcCreature.name}.`);
              if (CardEngine.getToughness(rcCreature) <= 0) {
                GameState.creatureDies(gameState, rcCreature, rcTarget.player);
                log.push(`${rcCreature.name} morre.`);
              }
            }
          }
          break;
        }

        case 'remove_counters_all': {
          // Remove ALL counters from target creature
          if (targets && targets.length > 0) {
            const rcaTarget = targets[0];
            const rcaCreature = gameState.players[rcaTarget.player].zones.battlefield.get(rcaTarget.uid);
            if (rcaCreature && rcaCreature._counters) {
              let totalRemoved = 0;
              for (const counterType in rcaCreature._counters) {
                totalRemoved += rcaCreature._counters[counterType];
                rcaCreature._counters[counterType] = 0;
              }
              log.push(`Remove todos os ${totalRemoved} contador(es) de ${rcaCreature.name}.`);
              if (CardEngine.getToughness(rcaCreature) <= 0) {
                GameState.creatureDies(gameState, rcaCreature, rcaTarget.player);
                log.push(`${rcaCreature.name} morre.`);
              }
            }
          }
          break;
        }

        case 'grant': {
          // Grant keyword to target creature (temporary until end of turn)
          const grantKw = effect.keyword;
          if (!grantKw) break;
          const grantDuration = effect.duration || 'end_of_turn';

          if (targets && targets.length > 0) {
            const gTarget = targets[0];
            const gCreature = gameState.players[gTarget.player].zones.battlefield.get(gTarget.uid);
            if (gCreature) {
              if (!CardEngine.canBeTargeted(gCreature, controller)) {
                log.push(`${gCreature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              if (!gCreature.keywords) gCreature.keywords = [];
              const kwCap = grantKw.charAt(0).toUpperCase() + grantKw.slice(1);
              if (!gCreature.keywords.includes(kwCap)) gCreature.keywords.push(kwCap);
              if (grantDuration === 'end_of_turn') {
                if (!gCreature._tempKeywords) gCreature._tempKeywords = [];
                gCreature._tempKeywords.push(kwCap);
              }
              if (kwCap === 'Haste') gCreature._summoningSick = false;
              log.push(`${gCreature.name} ganha ${kwCap} ate o fim do turno.`);
            }
          } else {
            // Grant to self
            const gSelf = gameState.players[controller].zones.battlefield.get(card._uid);
            if (gSelf) {
              if (!gSelf.keywords) gSelf.keywords = [];
              const kwCap = grantKw.charAt(0).toUpperCase() + grantKw.slice(1);
              if (!gSelf.keywords.includes(kwCap)) gSelf.keywords.push(kwCap);
              if (grantDuration === 'end_of_turn') {
                if (!gSelf._tempKeywords) gSelf._tempKeywords = [];
                gSelf._tempKeywords.push(kwCap);
              }
              if (kwCap === 'Haste') gSelf._summoningSick = false;
              log.push(`${gSelf.name} ganha ${kwCap}.`);
            }
          }
          break;
        }

        case 'grant_all': {
          // Grant keyword to all own creatures
          const gaKw = effect.keyword;
          if (!gaKw) break;
          const gaKwCap = gaKw.charAt(0).toUpperCase() + gaKw.slice(1);
          const gaPid = effect.target === 'opponent_creatures' ? opponent : controller;
          const gaCreatures = gameState.players[gaPid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          gaCreatures.forEach(c => {
            if (!c.keywords) c.keywords = [];
            if (!c.keywords.includes(gaKwCap)) c.keywords.push(gaKwCap);
            if (!c._tempKeywords) c._tempKeywords = [];
            c._tempKeywords.push(gaKwCap);
            if (gaKwCap === 'Haste') c._summoningSick = false;
          });
          log.push(`Todas as criaturas ganham ${gaKwCap} ate o fim do turno.`);
          break;
        }

        case 'grant_counter':
        case 'grant_counters': {
          // Put +1/+1 counters on target creature (not self)
          if (targets && targets.length > 0) {
            const gcTarget = targets[0];
            const gcCreature = gameState.players[gcTarget.player].zones.battlefield.get(gcTarget.uid);
            if (gcCreature) {
              if (!CardEngine.canBeTargeted(gcCreature, controller)) {
                log.push(`${gcCreature.name} nao pode ser alvo (hexproof/shroud).`);
                break;
              }
              if (!gcCreature._counters) gcCreature._counters = { '+1/+1': 0, '-1/-1': 0 };
              const gcAmt = effect.amount || 1;
              const gcType = effect.counter || '+1/+1';
              gcCreature._counters[gcType] = (gcCreature._counters[gcType] || 0) + gcAmt;
              log.push(`${gcCreature.name} recebe ${gcAmt} contador(es) ${gcType}.`);
            }
          }
          break;
        }

        case 'exile_top_play': {
          const etpLib = gameState.players[controller].zones.library;
          const etpAmt = effect.amount || 1;

          for (let i = 0; i < etpAmt; i++) {
            let cardFound = null;

            // If condition is specified, search for a card that meets the condition
            if (effect.condition) {
              let filter = () => true;

              if (effect.condition === 'nonland') {
                filter = c => !CardEngine.isLand(c);
              } else if (effect.condition === 'noncreature_nonland_mv3') {
                filter = c => !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3;
              }

              // Apply max_mv filter if specified
              if (effect.max_mv) {
                const originalFilter = filter;
                filter = c => originalFilter(c) && (c.cmc || 0) <= effect.max_mv;
              }

              // Search through library for matching card
              const candidates = etpLib.cards.filter(filter);
              if (candidates.length > 0) {
                // Pick first matching card (or random if specified)
                cardFound = effect.random ? candidates[Math.floor(Math.random() * candidates.length)] : candidates[0];
                const idx = etpLib.cards.indexOf(cardFound);
                if (idx !== -1) etpLib.cards.splice(idx, 1);
              }
            } else {
              // No condition, just take from top
              cardFound = etpLib.drawFromTop();

              // Apply max_mv filter if specified for top card
              if (cardFound && effect.max_mv && (cardFound.cmc || 0) > effect.max_mv) {
                // Put card back and don't exile it
                etpLib.cards.unshift(cardFound);
                cardFound = null;
              }
            }

            if (cardFound) {
              gameState.players[controller].zones.exile.add(cardFound);
              if (!gameState._exiledPlayable) gameState._exiledPlayable = {};

              // Store exile info with free_cast flag and duration
              gameState._exiledPlayable[cardFound._uid] = {
                card: cardFound,
                controller,
                turn: gameState.turn,
                freeCast: effect.free || false,
                duration: effect.duration || 'permanent' // 'end_of_turn', 'next_turn', or 'permanent'
              };
              console.log(`[BREACHING DEBUG] Exiled ${cardFound.name}, freeCast: ${effect.free || false}, cmc: ${cardFound.cmc}, duration: ${effect.duration || 'permanent'}`);

              const who = gameState.players[controller].isHuman ? 'Voce exila' : 'Oponente exila';
              const playableText = effect.free ? " (pode jogar de graça neste turno)" : " (pode jogar neste turno)";
              log.push(`${who} ${cardFound.name}${playableText}.`);
            } else if (effect.condition) {
              const who = gameState.players[controller].isHuman ? 'Voce' : 'Oponente';
              log.push(`${who} não encontra carta válida na biblioteca.`);
            }
          }
          break;
        }

        case 'search_library': {
          const slLib = gameState.players[controller].zones.library;
          const bf = gameState.players[controller].zones.battlefield;
          let slFilter = null;
          if (effect.target === 'creature') slFilter = c => CardEngine.isCreature(c);
          else if (effect.target === 'land' || effect.target === 'basic_land') slFilter = c => CardEngine.isLand(c);
          else if (effect.target === 'named_card' && (effect.name || effect.names)) {
            if (effect.name) {
              slFilter = c => c.name === effect.name;
            } else if (effect.names) {
              slFilter = c => effect.names.includes(c.name);
            }
          }
          else slFilter = () => true;

          const slCandidates = slLib.cards.filter(slFilter);
          if (slCandidates.length === 0) {
            slLib.shuffle();
            log.push('Nenhuma carta encontrada na biblioteca.');
            break;
          }

          // Determine final destination (condition-based: control_dragon)
          let toTop = effect.to_top || false;
          let toBattlefield = false;
          let tappedDest = effect.tapped || false;

          if (effect.condition === 'control_dragon') {
            const hasDragon = bf.cards.some(c => CardEngine.hasCreatureType(c, 'Dragon'));
            if (hasDragon) {
              // If true: use if_true settings
              if (effect.if_true) {
                toBattlefield = !effect.if_true.to_top;
                toTop = effect.if_true.to_top || false;
                tappedDest = effect.if_true.tapped || false;
              }
            } else {
              // If false: use if_false settings
              if (effect.if_false) {
                toBattlefield = !effect.if_false.to_top;
                toTop = effect.if_false.to_top || false;
                tappedDest = effect.if_false.tapped || false;
              }
            }
          }

          // Check if optional and can decline
          if (effect.optional && gameState.players[controller].isHuman) {
            // Will be handled in UI overlay - add "Declinar" button
          }

          if (gameState.players[controller].isHuman && slCandidates.length > 0) {
            // Show unique cards only
            const landOptions = [];
            const seenNames = new Set();
            for (const card of slCandidates) {
              if (!seenNames.has(card.name)) {
                seenNames.add(card.name);
                landOptions.push(card);
              }
            }
            gameState._pendingSearch = {
              candidates: landOptions,
              controller,
              toHand: effect.to_hand !== false,
              toBattlefield: toBattlefield,
              toTop: toTop,
              tapped: tappedDest,
              optional: effect.optional || false,
            };
            gameState.waitingForInput = { type: 'search_library', playerId: controller };
            log.push(effect.optional ? 'Escolha uma carta da sua biblioteca (ou declinar).' : 'Escolha uma carta da sua biblioteca.');
            return log;
          } else {
            // AI: pick best by CMC
            slCandidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const picked = slCandidates[0];
            const idx = slLib.cards.indexOf(picked);
            if (idx !== -1) slLib.cards.splice(idx, 1);

            if (effect.to_hand) {
              gameState.players[controller].zones.hand.add(picked);
              slLib.shuffle();
              log.push(`Busca ${picked.name} da biblioteca para a mão.`);
            } else if (toTop) {
              slLib.cards.unshift(picked);
              // Don't shuffle - goes on top
              log.push(`Busca ${picked.name} e coloca no topo do grimorio.`);
            } else if (toBattlefield) {
              const bfCard = CardEngine.prepareForBattlefield(picked);
              bfCard._tapped = tappedDest;
              bfCard._summoningSick = false;
              bfCard._ownerId = controller;
              bf.add(bfCard);
              GameState._registerCardTriggers(gameState, bfCard, controller);
              slLib.shuffle();
              log.push(`Busca ${picked.name} e coloca no campo${tappedDest ? ' virado' : ''}.`);
            } else {
              const bfCard = CardEngine.prepareForBattlefield(picked);
              bfCard._tapped = tappedDest;
              bfCard._ownerId = controller;
              bf.add(bfCard);
              GameState._registerCardTriggers(gameState, bfCard, controller);
              slLib.shuffle();
              log.push(`Busca ${picked.name} da biblioteca para o campo.`);
            }
          }
          break;
        }

        case 'search_library_to_graveyard': {
          const sltgLib = gameState.players[controller].zones.library;
          const sltgGy = gameState.players[controller].zones.graveyard;
          const sltgCards = sltgLib.cards.filter(c => !CardEngine.isLand(c));
          if (sltgCards.length > 0) {
            sltgCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const picked = sltgCards[0];
            const idx = sltgLib.cards.indexOf(picked);
            if (idx !== -1) sltgLib.cards.splice(idx, 1);
            sltgGy.add(picked);
            sltgLib.shuffle();
            log.push(`Busca ${picked.name} e coloca no cemiterio.`);
          } else {
            sltgLib.shuffle();
            log.push('Nenhuma carta encontrada.');
          }
          break;
        }

        case 'create_token_copy':
        case 'clone':
        case 'copy_self': {
          // Find source creature to copy
          let sourceCreature = null;
          if (effect.type === 'copy_self') {
            sourceCreature = gameState.players[controller].zones.battlefield.get(card._uid);
          } else if (effect.target === 'exiled_creature') {
            // Retrieve creature that was exiled by this card (e.g., Mardu Siegebreaker)
            if (card._exiledUntilLeaves && card._exiledUntilLeaves.length > 0) {
              sourceCreature = card._exiledUntilLeaves[card._exiledUntilLeaves.length - 1];
            }
          } else if (targets && targets.length > 0) {
            const ctcTarget = targets[0];
            sourceCreature = gameState.players[ctcTarget.player].zones.battlefield.get(ctcTarget.uid);
          } else {
            // Auto-pick best own creature
            const myCreatures = gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            if (myCreatures.length > 0) {
              myCreatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
              sourceCreature = myCreatures[0];
            }
          }
          if (sourceCreature) {
            const token = CardEngine.createToken(
              controller,
              sourceCreature.power || CardEngine.getPower(sourceCreature),
              sourceCreature.toughness || CardEngine.getToughness(sourceCreature),
              sourceCreature.name
            );
            // Copy keywords
            if (sourceCreature.keywords) token.keywords = [...sourceCreature.keywords];
            token.type_line = sourceCreature.type_line;
            token.oracle_text = sourceCreature.oracle_text;
            token.mana_cost = sourceCreature.mana_cost;
            token.cmc = sourceCreature.cmc;
            if (effect.tapped) token._tapped = true;
            if (effect.attacking && gameState.combat && gameState.combat.phase !== 'none') {
              token._attacking = true;
              token._tapped = true;
              token._summoningSickness = false;
              gameState.combat.attackers.push({ uid: token._uid, card: token });
            }
            gameState.players[controller].zones.battlefield.add(token);
            GameState._registerCardTriggers(gameState, token, controller);
            log.push(`Cria copia de ${sourceCreature.name}.`);
          } else {
            log.push('Nenhuma criatura para copiar.');
          }
          break;
        }

        case 'gain_control': {
          if (targets && targets.length > 0) {
            const gcTarget = targets[0];
            const gcCreature = gameState.players[gcTarget.player].zones.battlefield.get(gcTarget.uid);
            if (gcCreature && gcTarget.player !== controller) {
              gameState.players[gcTarget.player].zones.battlefield.remove(gcCreature._uid);
              GameState._unregisterCardTriggers(gameState, gcCreature._uid);
              gcCreature._originalOwner = gcTarget.player;
              gameState.players[controller].zones.battlefield.add(gcCreature);
              GameState._registerCardTriggers(gameState, gcCreature, controller);
              log.push(`Ganha controle de ${gcCreature.name}!`);
            }
          }
          break;
        }

        case 'anthem': {
          // Static +X/+X to all own creatures (permanent, applied once when enters)
          const anthemPower = effect.power || 0;
          const anthemTough = effect.toughness || 0;
          const anthemCreatures = gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          anthemCreatures.forEach(c => {
            c._powerMod = (c._powerMod || 0) + anthemPower;
            c._toughnessMod = (c._toughnessMod || 0) + anthemTough;
          });
          // Store anthem data on the enchantment for when it leaves / new creatures enter
          const anthemCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (anthemCard) {
            anthemCard._anthem = { power: anthemPower, toughness: anthemTough, keywords: effect.keywords || [] };
          }
          // Grant keywords if any
          if (effect.keywords) {
            anthemCreatures.forEach(c => {
              effect.keywords.forEach(kw => {
                const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
                if (!c.keywords) c.keywords = [];
                if (!c.keywords.includes(kwCap)) c.keywords.push(kwCap);
                if (!c._grantedKeywords) c._grantedKeywords = [];
                c._grantedKeywords.push(kwCap);
              });
            });
          }
          log.push(`Anthem: todas as criaturas ganham +${anthemPower}/+${anthemTough}${effect.keywords ? ' ' + effect.keywords.join(', ') : ''}.`);
          break;
        }

        case 'triggered': {
          // Register a triggered ability on the card (from Siege modal ETB)
          const trigCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (trigCard) {
            const trigger = {
              event: effect.event,
              effects: effect.effects || [],
              self: effect.self || false,
              once_per_turn: effect.once_per_turn || false,
              condition: effect.condition || null,
              cardUid: trigCard._uid,
              cardName: trigCard.name,
              controllerId: controller
            };
            if (!gameState._triggers) gameState._triggers = [];
            gameState._triggers.push(trigger);
            log.push(`${card.name}: habilidade ativada registrada (${effect.event}).`);
          }
          break;
        }

        case 'static': {
          // Apply a static ability to the card (from Siege modal ETB)
          const staticCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (staticCard) {
            if (!staticCard._staticAbilities) staticCard._staticAbilities = [];
            staticCard._staticAbilities.push(effect);
            log.push(`${card.name}: habilidade estatica aplicada (${effect.ability || 'passive'}).`);
          }
          break;
        }

        case 'move_counters': {
          if (targets && targets.length > 0) {
            const mcSource = gameState.players[controller].zones.battlefield.get(card._uid);
            const mcTarget = targets[0];
            const mcDest = gameState.players[mcTarget.player].zones.battlefield.get(mcTarget.uid);
            if (mcSource && mcDest && mcSource._counters) {
              const plus = mcSource._counters['+1/+1'] || 0;
              if (plus > 0) {
                mcSource._counters['+1/+1'] = 0;
                if (!mcDest._counters) mcDest._counters = { '+1/+1': 0, '-1/-1': 0 };
                mcDest._counters['+1/+1'] += plus;
                log.push(`Move ${plus} contador(es) +1/+1 de ${mcSource.name} para ${mcDest.name}.`);
                if (CardEngine.getToughness(mcSource) <= 0) {
                  GameState.creatureDies(gameState, mcSource, controller);
                  log.push(`${mcSource.name} morre.`);
                }
              }
            }
          }
          break;
        }

        case 'distribute_counters': {
          const dcAmt = effect.amount || 1;
          const dcType = effect.counter || '+1/+1';
          const dcCreatures = gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

          if (dcCreatures.length === 0) break;

          if (gameState.players[controller].isHuman) {
            gameState._pendingDistribute = {
              amount: dcAmt,
              counter: dcType,
              controller,
              card: card
            };
            gameState.waitingForInput = { type: 'distribute_counters', playerId: controller };
            log.push(`Distribua ${dcAmt} contador(es) ${dcType} entre suas criaturas.`);
            return log;
          } else {
            // AI: stack on strongest creature
            dcCreatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            const target = dcCreatures[0];
            if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
            target._counters[dcType] = (target._counters[dcType] || 0) + dcAmt;
            log.push(`${target.name} recebe ${dcAmt} contador(es) ${dcType}.`);
          }
          break;
        }

        case 'become_creature':
        case 'become_dragon': {
          const bcCard = gameState.players[controller].zones.battlefield.get(card._uid);
          if (bcCard) {
            bcCard._becomeCreature = true;
            bcCard._becomePower = effect.power || 3;
            bcCard._becomeToughness = effect.toughness || 3;
            if (!bcCard.power) bcCard.power = effect.power || 3;
            if (!bcCard.toughness) bcCard.toughness = effect.toughness || 3;
            if (!bcCard.keywords) bcCard.keywords = [];
            if (effect.keywords) {
              effect.keywords.forEach(kw => {
                const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
                if (!bcCard.keywords.includes(kwCap)) bcCard.keywords.push(kwCap);
              });
            }
            if (effect.type === 'become_dragon') {
              if (effect.keyword) {
                const kwCap = effect.keyword.charAt(0).toUpperCase() + effect.keyword.slice(1);
                if (!bcCard.keywords.includes(kwCap)) bcCard.keywords.push(kwCap);
              }
              bcCard.type_line = (bcCard.type_line || '') + ' Dragon';
            }
            log.push(`${bcCard.name} se torna criatura ${effect.power || 3}/${effect.toughness || 3}.`);
          }
          break;
        }

        case 'attach': {
          // Attach equipment/aura to a creature
          if (targets && targets.length > 0) {
            const attTarget = targets[0];
            const attCreature = gameState.players[attTarget.player].zones.battlefield.get(attTarget.uid);
            const attCard = gameState.players[controller].zones.battlefield.get(card._uid);
            if (attCreature && attCard) {
              attCard._attachedTo = attCreature._uid;
              if (!attCreature._attachments) attCreature._attachments = [];
              attCreature._attachments.push(attCard._uid);
              GameState._applyEquipmentEffects(attCard, attCreature);
              log.push(`${attCard.name} equipado em ${attCreature.name}.`);
            }
          }
          break;
        }

        case 'exile_top_opponent': {
          const etoLib = gameState.players[opponent].zones.library;
          const etoExile = gameState.players[opponent].zones.exile;

          // Resolve dynamic amount (supports "X", numbers, and other dynamic values)
          let etoAmt = 1;
          if (typeof effect.amount === 'number') {
            etoAmt = effect.amount;
          } else if (effect.amount === "X") {
            // For spell effects, "X" might come from different contexts
            etoAmt = 1; // Default fallback for spell context
          } else if (effect.amount) {
            // Try to resolve other dynamic amounts
            etoAmt = parseInt(effect.amount) || 1;
          }

          const exiled = [];
          for (let i = 0; i < etoAmt; i++) {
            const topCard = etoLib.drawFromTop();
            if (topCard) {
              etoExile.add(topCard);
              exiled.push(topCard.name);
            }
          }
          if (exiled.length > 0) {
            log.push(`${exiled.join(', ')} exilado(s) do topo da biblioteca do oponente (${exiled.length}).`);
          }
          break;
        }

        case 'copy_spell':
        case 'copy_next_spell': {
          // Set a flag: next spell cast will be copied
          gameState._pendingSpellCopy = gameState._pendingSpellCopy || {};
          gameState._pendingSpellCopy[controller] = true;
          log.push('Proxima magia sera copiada!');
          break;
        }

        case 'extra_combat': {
          // Flag to insert extra combat after current main phase
          gameState._extraCombat = true;
          log.push('Fase de combate adicional!');
          break;
        }

        case 'exile_graveyard_cast_copy': {
          // Exile a card from graveyard and cast a copy for free
          const egccGy = gameState.players[controller].zones.graveyard;
          const egccExile = gameState.players[controller].zones.exile;
          let egccCandidates = egccGy.getAll().filter(c => !CardEngine.isLand(c));
          if (effect.target === 'nonland_mv3_or_less') {
            egccCandidates = egccCandidates.filter(c => (c.cmc || 0) <= 3);
          }
          if (egccCandidates.length > 0) {
            egccCandidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const picked = egccCandidates[0];
            egccGy.remove(picked._uid);
            egccExile.add(picked);
            // Cast a copy (resolve effects immediately)
            const copyEffects = CardEngine.getSpellEffects(picked);
            if (copyEffects.length > 0) {
              effects.splice(ei + 1, 0, ...copyEffects);
              log.push(`Exila ${picked.name} do cemiterio e joga copia de graca!`);
            } else {
              log.push(`Exila ${picked.name} do cemiterio.`);
            }
          } else {
            log.push('Nenhuma carta valida no cemiterio.');
          }
          break;
        }

        default:
          // Fallback: try _resolveSimpleEffect for unhandled types
          const simpleLog = GameState._resolveSimpleEffect(gameState, controller, effect, { cardUid: card._uid });
          if (simpleLog) log.push(simpleLog);
          break;
      }
    }

    // Move spell to graveyard (if not permanent and not harmonize-cast and not adventure spell)
    if (!CardEngine.isPermanent(card) && !card._harmonizeCast && !card._isAdventureSpell) {
      gameState.players[controller].zones.graveyard.add(card);
    }

    return log;
  },

  isEmpty(stack) {
    return stack.items.length === 0;
  },

  // Continue processing pending stack effects after user input
  _processNextEffect(gameState) {
    if (gameState._pendingStackEffects) {
      const { card, controller, targets, effects, log } = gameState._pendingStackEffects;
      gameState._pendingStackEffects = null;

      // Continue resolving remaining effects by simulating a stack item
      const tempItem = { card, controller, targets, effects };
      const remainingResults = this._resolveItem(tempItem, gameState);

      // Merge with existing log if we have results
      if (Array.isArray(remainingResults)) {
        log.push(...remainingResults);
      }

      return log;
    }
    return [];
  },

  // Ward enforcement: returns true if ward is paid, false if countered
  _payWardCost(creature, controller, gameState, log) {
    if (!CardEngine.hasWard(creature)) return true;
    const creatureOwner = creature._ownerId !== undefined ? creature._ownerId : (controller === 0 ? 1 : 0);
    if (creatureOwner === controller) return true; // Ward only triggers for opponent's spells

    const wardCost = CardEngine.getWardCost(creature);
    if (wardCost <= 0) return true;

    // Check if controller can pay ward cost
    const pool = gameState.manaPool[controller];
    const poolTotal = ManaSystem.poolTotal(pool);
    if (poolTotal >= wardCost) {
      // Auto-pay ward cost
      const fakeCost = `{${wardCost}}`;
      gameState.manaPool[controller] = ManaSystem.payMana(pool, fakeCost, wardCost);
      log.push(`Ward ${wardCost} de ${creature.name} pago.`);
      return true;
    } else {
      // Can't pay ward - spell is countered for this target
      log.push(`Ward ${wardCost} de ${creature.name} nao pago — efeito anulado!`);
      return false;
    }
  },

  _aiScoreMode(mode, gameState, controller, opponent) {
    let score = 0;
    const type = mode.type;
    const oppCreatures = gameState.players[opponent].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
    const myCreatures = gameState.players[controller].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));

    if (type === 'destroy' || type === 'exile') {
      score += oppCreatures.length > 0 ? 10 : -5;
    } else if (type === 'bounce' || type === 'bounce_to_library') {
      score += oppCreatures.length > 0 ? 8 : -3;
    } else if (type === 'damage') {
      score += oppCreatures.length > 0 ? 7 : 3;
    } else if (type === 'draw') {
      score += 6 + (mode.amount || 1);
    } else if (type === 'create_token') {
      score += 7;
    } else if (type === 'buff' || type === 'buff_all') {
      score += myCreatures.length > 0 ? 6 + myCreatures.length : -2;
    } else if (type === 'gain_life' || type === 'gainLife') {
      score += 4;
    } else if (type === 'counter' || type === 'counter_spell') {
      score += 8;
    } else if (type === 'tap') {
      score += oppCreatures.length > 0 ? 7 : -2;
    } else if (type === 'surveil') {
      score += 5;
    } else if (type === 'destroy_all') {
      score += oppCreatures.length > myCreatures.length ? 15 : -10;
    } else if (type === 'return_from_graveyard') {
      const gy = gameState.players[controller].zones.graveyard;
      score += gy && gy.cards && gy.cards.length > 0 ? 8 : -3;
    } else if (type === 'drain') {
      score += 7;
    } else if (type === 'loot') {
      score += 5;
    } else if (type === 'gain_control') {
      score += oppCreatures.length > 0 ? 12 : -5;
    } else if (type === 'bounce_to_library_top') {
      score += oppCreatures.length > 0 ? 9 : -3;
    } else if (type === 'grant' || type === 'grant_all') {
      score += myCreatures.length > 0 ? 5 : -2;
    } else if (type === 'search_library') {
      score += 7;
    } else if (type === 'extra_combat') {
      score += myCreatures.length >= 2 ? 9 : 2;
    } else if (type === 'untap_all') {
      score += 5;
    } else if (type === 'anthem') {
      score += 4 + myCreatures.length * 2;
    } else if (type === 'distribute_counters' || type === 'grant_counter') {
      score += myCreatures.length > 0 ? 6 : -2;
    } else if (type === 'exile_top_play') {
      score += 6;
    } else if (type === 'mill') {
      score += 4;
    } else if (type === 'discard_hand') {
      score += 8;
    } else {
      score += 3;
    }
    return score;
  },

  // Choose N best modes from the list
  _aiChooseModes(modes, count, gameState, controller, opponent, targets) {
    const scored = modes.map((mode, i) => ({
      mode, index: i,
      score: this._aiScoreMode(mode, gameState, controller, opponent)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.min(count, modes.length)).map(s => s.mode);
  },

  // Backwards compatible single-mode pick
  _aiChooseMode(modes, gameState, controller, opponent, targets) {
    return this._aiChooseModes(modes, 1, gameState, controller, opponent, targets)[0];
  }
};
