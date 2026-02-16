const GameState = {
  PHASES: ['untap', 'upkeep', 'draw', 'main1', 'combat_begin', 'combat_attackers', 'combat_blockers', 'combat_damage', 'combat_end', 'main2', 'end', 'cleanup'],
  STARTING_LIFE: 20,
  MAX_HAND_SIZE: 7,

  create(deck1, deck2) {
    const state = {
      players: [
        this._createPlayer(0, deck1),
        this._createPlayer(1, deck2)
      ],
      activePlayer: 0,
      phase: 'mulligan',
      phaseIndex: -1,
      turn: 1,
      combat: CombatSystem.createCombatState(),
      stack: GameStack.create(),
      manaPool: [ManaSystem.createPool(), ManaSystem.createPool()],
      landPlayedThisTurn: false,
      winner: null,
      log: [],
      waitingForInput: null,
      turnHistory: [],
      mulliganCount: [0, 0],       // how many times each player mulliganed
      mulliganDone: [false, false], // whether each player has kept
      _triggers: [],                // registered triggered abilities
      _spellsThisTurn: [0, 0],      // count spells cast this turn (for Flurry)
      _beholding: [null, null]      // Dragon being beheld this turn
    };

    // Shuffle and draw opening hands
    state.players.forEach((p, playerId) => {
      p.zones.library.shuffle();

      // Draw opening hand (7 cards)
      for (let i = 0; i < 7; i++) {
        const card = p.zones.library.drawFromTop();
        if (card) p.zones.hand.add(card);
      }
    });

    // AI decides mulligan immediately
    this._aiMulliganDecision(state, 1);

    state.log.push('Jogo iniciado! Escolha manter ou mulligan.');
    state.waitingForInput = { type: 'mulligan', playerId: 0 };
    return state;
  },

  _aiMulliganDecision(state, playerId) {
    const hand = state.players[playerId].zones.hand.getAll();
    const lands = hand.filter(c => CardEngine.isLand(c));
    const mulls = state.mulliganCount[playerId];

    // Keep if 2-5 lands, or already mulliganed twice
    if ((lands.length >= 2 && lands.length <= 5) || mulls >= 2) {
      state.mulliganDone[playerId] = true;
      // Put mulliganCount cards on bottom
      if (mulls > 0) {
        // AI puts worst cards on bottom
        const sorted = hand.sort((a, b) => {
          if (CardEngine.isLand(a) && !CardEngine.isLand(b)) return -1;
          if (!CardEngine.isLand(a) && CardEngine.isLand(b)) return 1;
          return (a.cmc || 0) - (b.cmc || 0);
        });
        for (let i = 0; i < mulls && sorted.length > 0; i++) {
          const card = sorted.shift();
          state.players[playerId].zones.hand.remove(card._uid);
          state.players[playerId].zones.library.addToBottom(card);
        }
      }
      if (mulls > 0) state.log.push(`Oponente fez mulligan para ${7 - mulls} cartas.`);
      else state.log.push('Oponente manteve a mao.');
    } else {
      // Mulligan: return hand, draw 7 again
      state.mulliganCount[playerId]++;
      const handCards = state.players[playerId].zones.hand.getAll();
      handCards.forEach(c => {
        state.players[playerId].zones.hand.remove(c._uid);
        state.players[playerId].zones.library.add(c);
      });
      state.players[playerId].zones.library.shuffle();
      for (let i = 0; i < 7; i++) {
        const card = state.players[playerId].zones.library.drawFromTop();
        if (card) state.players[playerId].zones.hand.add(card);
      }
      // Recurse to decide again
      this._aiMulliganDecision(state, playerId);
    }
  },

  _aiChooseTargetsForEffects(state, playerId, effects) {
    // Helper function to let AI choose targets for effects
    const targets = [];
    const opponentId = playerId === 0 ? 1 : 0;

    for (const effect of effects) {
      if (!this._effectRequiresTargets(effect)) continue;

      let target = null;

      switch (effect.target) {
        case 'creature':
        case 'opponent_creature': {
          const creatures = effect.target === 'opponent_creature'
            ? state.players[opponentId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c))
            : [...state.players[0].zones.battlefield.cards, ...state.players[1].zones.battlefield.cards]
                .filter(c => CardEngine.isCreature(c));

          if (creatures.length > 0) {
            // AI picks the best target based on effect type
            if (effect.type === 'destroy' || effect.type === 'damage' || effect.type === 'exile') {
              // Pick strongest opponent creature or weakest own creature
              target = creatures
                .filter(c => effect.target === 'opponent_creature' ? true : c._owner !== playerId)
                .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a))[0] ||
                creatures[0];
            } else {
              // For buffs, pick strongest own creature
              target = creatures
                .filter(c => c._owner === playerId)
                .sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a))[0] ||
                creatures[0];
            }
          }
          break;
        }

        case 'creature or planeswalker': {
          const targets_available = [
            ...state.players[0].zones.battlefield.cards,
            ...state.players[1].zones.battlefield.cards
          ].filter(c => CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c));

          if (targets_available.length > 0) {
            // Prefer opponent's most valuable permanent
            target = targets_available
              .filter(c => c._owner !== playerId)
              .sort((a, b) => (CardEngine.getPower(b) || 0) - (CardEngine.getPower(a) || 0))[0] ||
              targets_available[0];
          }
          break;
        }

        case 'artifact':
        case 'enchantment': {
          const permanents = [
            ...state.players[0].zones.battlefield.cards,
            ...state.players[1].zones.battlefield.cards
          ].filter(c => effect.target === 'artifact' ? CardEngine.isArtifact(c) : CardEngine.isEnchantment(c));

          if (permanents.length > 0) {
            // Prefer opponent permanents
            target = permanents.filter(c => c._owner !== playerId)[0] || permanents[0];
          }
          break;
        }
      }

      if (target) {
        targets.push({
          type: CardEngine.isCreature(target) ? 'creature' : 'permanent',
          player: target._owner,
          uid: target._uid
        });
      }
    }

    return targets;
  },

  mulligan(state, playerId) {
    state.mulliganCount[playerId]++;
    const handCards = state.players[playerId].zones.hand.getAll();
    handCards.forEach(c => {
      state.players[playerId].zones.hand.remove(c._uid);
      state.players[playerId].zones.library.add(c);
    });
    state.players[playerId].zones.library.shuffle();
    for (let i = 0; i < 7; i++) {
      const card = state.players[playerId].zones.library.drawFromTop();
      if (card) state.players[playerId].zones.hand.add(card);
    }
    const mulls = state.mulliganCount[playerId];
    state.log.push(`Mulligan #${mulls}! Comprou 7 cartas, vai colocar ${mulls} no fundo.`);
    // Player still needs to keep or mulligan again
    state.waitingForInput = { type: 'mulligan', playerId };
  },

  keepHand(state, playerId, bottomCardUids) {
    const mulls = state.mulliganCount[playerId];
    // Put selected cards on bottom (or auto-pick if not enough provided)
    let toBottom = mulls;
    let removed = 0;
    if (bottomCardUids && bottomCardUids.length > 0) {
      bottomCardUids.slice(0, toBottom).forEach(uid => {
        const card = state.players[playerId].zones.hand.remove(uid);
        if (card) {
          state.players[playerId].zones.library.addToBottom(card);
          removed++;
        }
      });
      toBottom -= removed;
    }
    // If still need to put cards on bottom, auto-pick worst
    if (toBottom > 0) {
      const remaining = state.players[playerId].zones.hand.getAll()
        .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
      for (let i = 0; i < toBottom && remaining.length > 0; i++) {
        const card = remaining.shift();
        state.players[playerId].zones.hand.remove(card._uid);
        state.players[playerId].zones.library.addToBottom(card);
      }
    }
    state.mulliganDone[playerId] = true;
    const finalCount = state.players[playerId].zones.hand.count();
    state.log.push(`${playerId === 0 ? 'Voce manteve' : 'Oponente manteve'} ${finalCount} cartas.`);
  },

  startGame(state) {
    // Transition from mulligan to actual game
    state.phase = 'untap';
    state.phaseIndex = 0;
    state.waitingForInput = null;

    // Register triggered abilities for all cards on battlefield (none at start usually)
    this._registerTriggersForBattlefield(state);

    // Initialize dynamic static abilities
    this._updateDynamicStaticAbilities(state);

    this.advancePhase(state);
  },

  // === Triggered abilities system ===

  _registerTriggersForBattlefield(state) {
    state._triggers = [];
    state.players.forEach(p => {
      p.zones.battlefield.cards.forEach(card => {
        this._registerCardTriggers(state, card, p.id);
      });
    });
  },

  _registerCardTriggers(state, card, playerId) {
    const triggers = CardEngine.getTriggeredAbilities(card);
    triggers.forEach(trigger => {
      state._triggers.push({
        ...trigger,
        cardUid: card._uid,
        cardName: card.name,
        controllerId: playerId
      });
    });
  },

  _unregisterCardTriggers(state, cardUid) {
    state._triggers = (state._triggers || []).filter(t => t.cardUid !== cardUid);
  },

  fireTrigger(state, eventType, data) {
    // Recursion depth guard - prevent infinite trigger loops
    state._triggerDepth = (state._triggerDepth || 0) + 1;
    if (state._triggerDepth > 15) {
      state._triggerDepth--;
      return [`(trigger loop limitado - profundidade ${state._triggerDepth})`];
    }
    const triggers = (state._triggers || []).filter(t => t.event === eventType);

    // Also check temporary triggers
    const tempTriggers = (state._tempTriggers || []).filter(t => t.event === eventType);

    const logs = [];

    for (const trigger of triggers) {
      let shouldFire = false;

      // Self triggers (this card does something)
      if (trigger.self && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }
      // Dies trigger (self): "when THIS creature dies"
      if (trigger.event === 'dies' && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }
      // Creature death triggers
      if (trigger.event === 'any_creature_dies') {
        shouldFire = true; // Condition filtering happens in _checkTriggerCondition
      }
      if (trigger.event === 'other_creature_dies' && data.ownerId === trigger.controllerId && data.cardUid !== trigger.cardUid) {
        shouldFire = true;
      }
      // Upkeep triggers
      if (trigger.event === 'upkeep' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Life gain triggers
      if (trigger.event === 'gain_life' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Flurry - second spell triggers
      if (trigger.event === 'second_spell') {
        if (trigger.self && data.cardUid === trigger.cardUid) {
          // Self trigger: only this card triggers when it's cast as second spell
          shouldFire = true;
        } else if (!trigger.self && data.playerId === trigger.controllerId) {
          // Non-self: artifact/enchantment triggers on any second spell cast
          shouldFire = true;
        }
      }
      // Attack triggers
      if (trigger.event === 'attacks') {
        if (trigger.self && data.cardUid === trigger.cardUid) {
          shouldFire = true;
        } else if (!trigger.self && data.controllerId === trigger.controllerId) {
          // Non-self: enchantment/artifact triggers on any creature attacking (e.g. War Effort)
          shouldFire = true;
        }
      }
      // Combat damage to player
      if (trigger.event === 'combat_damage_player') {
        if (data.cardUid === trigger.cardUid) {
          shouldFire = true;
        } else if (!trigger.self) {
          // Non-self: artifact/enchantment global triggers (e.g. Herd Heirloom)
          if (data.controllerId === trigger.controllerId || data.playerId === trigger.controllerId) {
            shouldFire = true;
          }
        }
      }
      // End step triggers
      if (trigger.event === 'end_step' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Dragon enters triggers
      if (trigger.event === 'dragon_enters' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Enters or attacks
      if (trigger.event === 'enters_or_attacks' && (data.entering || data.attacking) && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }
      // Becomes tapped
      if (trigger.event === 'becomes_tapped' && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }
      // Combat begin triggers (beginning of combat on your turn)
      if (trigger.event === 'combat_begin' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Other creature enters (not self)
      if (trigger.event === 'other_creature_enters' && data.cardUid !== trigger.cardUid && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Creature ETB (any creature, including self)
      if (trigger.event === 'creature_etb' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Landfall (land enters under your control)
      if (trigger.event === 'landfall' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Leaves battlefield (self)
      if (trigger.event === 'leaves_battlefield' && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }
      // Cards leave graveyard (any card exiled/returned from GY)
      if ((trigger.event === 'cards_leave_graveyard' || trigger.event === 'card_leaves_graveyard') && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Creature dies with counters
      if (trigger.event === 'creature_dies_with_counters' && data.ownerId === trigger.controllerId && data.hadCounters) {
        shouldFire = true;
      }
      // Equipped creature attacks
      if (trigger.event === 'equipped_attacks' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Cast-related triggers (controller-based)
      // CRITICAL: cast_spell must check self flag (e.g. Sage of the Skies)
      if (trigger.event === 'cast_spell') {
        if (trigger.self && data.cardUid === trigger.cardUid) {
          shouldFire = true;
        } else if (!trigger.self && data.playerId === trigger.controllerId) {
          shouldFire = true;
        }
      } else if ((trigger.event === 'cast_noncreature' ||
           trigger.event === 'cast_colorless' || trigger.event === 'cast_noncreature_or_dragon' ||
           trigger.event === 'creature_enters_cast') && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Cast with another spell (self trigger)
      if (trigger.event === 'cast_with_another_spell' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Counter placed on a creature
      if (trigger.event === 'counter_placed' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Creature targeted by opponent
      if (trigger.event === 'creature_targeted_by_opponent' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Target dies (creature that was targeted by this spell dies under your control)
      if (trigger.event === 'target_dies' && data.ownerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Prevent damage trigger
      if (trigger.event === 'prevent_damage' && data.playerId === trigger.controllerId) {
        shouldFire = true;
      }
      // Enters or dies trigger
      if (trigger.event === 'enters_or_dies' && data.cardUid === trigger.cardUid) {
        shouldFire = true;
      }

      // Check condition before firing
      if (shouldFire && trigger.condition) {
        shouldFire = this._checkTriggerCondition(state, trigger, data);
      }

      // Check once_per_turn limit
      if (shouldFire && trigger.once_per_turn) {
        if (!state._triggeredOnceThisTurn) state._triggeredOnceThisTurn = {};
        const key = trigger.cardUid + '_' + trigger.event;
        if (state._triggeredOnceThisTurn[key]) shouldFire = false;
      }

      if (shouldFire && trigger.effects) {
        // Mark once_per_turn as used
        if (trigger.once_per_turn) {
          if (!state._triggeredOnceThisTurn) state._triggeredOnceThisTurn = {};
          state._triggeredOnceThisTurn[trigger.cardUid + '_' + trigger.event] = true;
        }
        logs.push(`Habilidade de ${trigger.cardName} dispara!`);
        // VFX: trigger pulse
        if (typeof VFX !== 'undefined') VFX.triggerFire(trigger.cardUid);

        // Check if any effect has a cost and we need to ask the player
        const effectsWithCosts = trigger.effects.filter(e => e.cost);
        const isHumanPlayer = state.players[trigger.controllerId] && state.players[trigger.controllerId].isHuman;

        if (effectsWithCosts.length > 0 && isHumanPlayer) {
          // Pause for player to decide on paying cost
          state.waitingForInput = {
            type: 'trigger_cost',
            playerId: trigger.controllerId,
            trigger: trigger,
            data: { ...data, cardUid: trigger.cardUid }
          };
          return logs;
        }

        // Resolve trigger effects
        for (const effect of trigger.effects) {
          const result = this._resolveSimpleEffect(state, trigger.controllerId, effect, { ...data, cardUid: trigger.cardUid });
          if (result) logs.push(result);
        }
      }
    }

    // Process temporary triggers
    for (const tempTrigger of tempTriggers) {
      // Check if this temp trigger should fire for this controller
      if (tempTrigger.controllerId === data.playerId ||
          (eventType === 'combat_begin' && tempTrigger.controllerId === data.playerId)) {

        // Fire temp trigger effects
        for (const effect of tempTrigger.effects) {
          const result = this._resolveSimpleEffect(state, tempTrigger.controllerId, effect, { cardUid: tempTrigger.cardUid });
          if (result) logs.push(result);
        }

        // Remove temp trigger after firing (one-time use)
        state._tempTriggers = state._tempTriggers.filter(t => t._tempId !== tempTrigger._tempId);
      }
    }

    // Handle temporary exile returns when a card leaves the battlefield
    if (eventType === 'leaves_battlefield' && data.cardUid) {
      const returnedCards = this.returnTemporaryExiles(state, data.cardUid);
      if (returnedCards.length > 0) {
        logs.push(`${returnedCards.join(', ')} retorna(m) do exílio.`);
      }
    }

    state._triggerDepth--;
    return logs;
  },

  _checkTriggerCondition(state, trigger, data) {
    const pid = trigger.controllerId;
    const cond = trigger.condition;
    if (!cond) return true;
    const bf = state.players[pid].zones.battlefield.cards;
    const oppId = pid === 0 ? 1 : 0;
    switch (cond) {
      case 'seven_cards_in_gy':
        return state.players[pid].zones.graveyard.count() >= 7;
      case 'control_creature_with_counter':
        return bf.some(c => CardEngine.isCreature(c) && c._counters &&
          Object.values(c._counters).some(count => count > 0));
      case 'creature_with_counter':
        return bf.some(c => CardEngine.isCreature(c) && c._counters && (c._counters['+1/+1'] || 0) > 0);
      case 'creature_died':
        return !!(state._creatureDiedThisTurn && state._creatureDiedThisTurn[pid]);
      case 'toughness_10+': {
        const card = bf.find(c => c._uid === trigger.cardUid);
        return !!(card && CardEngine.getToughness(card) >= 10);
      }
      case 'cast_creature_and_noncreature':
        return !!((state._castCreatureThisTurn && state._castCreatureThisTurn[pid]) &&
               (state._castNoncreatureThisTurn && state._castNoncreatureThisTurn[pid]));
      case 'two_spells_this_turn':
        return (state._spellsThisTurn[pid] || 0) >= 2;
      case 'cast_with_another_spell':
        // True if at least 2 spells have been cast this turn
        return (state._spellsThisTurn[pid] || 0) >= 2;
      case '3+_attacking':
        return !!(state.combat && state.combat.attackers && state.combat.attackers.length >= 3);
      case 'has_combat_draw': {
        // Check the creature from event data (not the trigger's own card)
        if (data && data.card) return !!data.card._combatDraw;
        if (data && data.cardUid) {
          const evtCard = bf.find(c => c._uid === data.cardUid);
          return !!(evtCard && evtCard._combatDraw);
        }
        return false;
      }
      case 'elemental':
        // Triggered when an elemental enters - check the entering creature
        return true; // condition is checked by event filter, not here
      case 'opponent_lost_life':
        return !!(state._lifeLostThisTurn && state._lifeLostThisTurn[oppId] > 0);
      case 'have_dragon':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Dragon'));
      case 'no_creatures_opponent':
        return state.players[oppId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c)).length === 0;
      case 'attacked_this_turn':
        return !!(state._attackedThisTurn && state._attackedThisTurn[pid]);
      case 'own_creature':
        // Check if the creature that died was controlled by this trigger's controller
        if (data && data.card) {
          return data.card._controller === pid;
        }
        return false;
      case 'glacierwood_temur_mode': {
        // Check if Glacierwood Siege has Temur mode chosen
        const card = bf.find(c => c.name && c.name.toLowerCase() === 'glacierwood siege');
        return !!(card && card._temurMode === true);
      }
      case 'frostcliff_jeskai_mode': {
        // Check if Frostcliff Siege has Jeskai mode chosen
        const card = bf.find(c => c.name && c.name.toLowerCase() === 'frostcliff siege');
        return !!(card && card._jeskaiMode === true);
      }
      case 'frostcliff_temur_mode': {
        // Check if Frostcliff Siege has Temur mode chosen
        const card = bf.find(c => c.name && c.name.toLowerCase() === 'frostcliff siege');
        return !!(card && card._temurMode === true);
      }
      case 'cast_turtle_spell':
        // Check if the casted spell is a Turtle (for Ambling Stormshell trigger)
        return !!(data && data.card && CardEngine.hasCreatureType(data.card, 'Turtle'));
      default:
        // Unknown condition - log and allow (fail open)
        state.log.push(`(condição desconhecida: ${cond})`);
        return true;
    }
  },

  // Check condition on individual effects (cast/etb/triggered effects with condition field)
  _checkEffectCondition(state, controllerId, effect) {
    const cond = effect.condition;
    if (!cond) return true;
    // land_to_hand is handled inside look_top, not here
    if (cond === 'land_to_hand') return true;
    // nonland is a filter, not a condition
    if (cond === 'nonland' || cond === 'noncreature_nonland_mv3') return true;
    const pid = controllerId;
    const oppId = pid === 0 ? 1 : 0;
    const bf = state.players[pid].zones.battlefield.cards;
    switch (cond) {
      case 'if_beheld_dragon':
        return !!(state._beholding && state._beholding[pid]);
      case 'if_discarded_nonland':
        return !!(state._lastDiscardedNonland && state._lastDiscardedNonland[pid]);
      case 'if_exiled':
        return !!state._exiledThisResolution;
      case 'control_creature_with_counter':
        return bf.some(c => CardEngine.isCreature(c) && c._counters &&
          Object.values(c._counters).some(count => count > 0));
      case 'control_faerie':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Faerie'));
      case 'control_kithkin':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Kithkin'));
      case 'control_treefolk':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Treefolk'));
      case 'control_dragon':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Dragon'));
      case 'if_cast':
        // Check if the card was cast (not reanimated/cheated into play)
        // This needs to be checked at the card level, not here
        return true; // Will be checked in stack.js with card context
      case 'main_phase':
        return state.phase === 'main1' || state.phase === 'main2';
      case 'your_turn':
        return state.activePlayer === pid;
      case 'dealt_damage_this_turn':
        return !!(state._damageDealtThisTurn && state._damageDealtThisTurn[pid]);
      case 'unless_creature': {
        // Discard unless a creature was among drawn cards
        const hand = state.players[pid].zones.hand.getAll();
        return !hand.some(c => CardEngine.isCreature(c) && c._drawnThisTurn);
      }
      case 'cast_noncreature':
        return !!(state._castNoncreatureThisTurn && state._castNoncreatureThisTurn[pid]);
      case 'card_left_graveyard':
        return !!(state._cardLeftGraveyardThisTurn && state._cardLeftGraveyardThisTurn[pid]);
      case 'mv_X_or_less':
        return true; // X filtering handled by search_library itself
      case 'faeries_you_control':
        return bf.some(c => CardEngine.hasCreatureType(c, 'Faerie'));
      case 'toughness_10+':
        return bf.reduce((sum, c) => sum + (CardEngine.isCreature(c) ? CardEngine.getToughness(c) : 0), 0) >= 10;
      case 'toughness_20+':
        return bf.reduce((sum, c) => sum + (CardEngine.isCreature(c) ? CardEngine.getToughness(c) : 0), 0) >= 20;
      case 'toughness_40+':
        return bf.reduce((sum, c) => sum + (CardEngine.isCreature(c) ? CardEngine.getToughness(c) : 0), 0) >= 40;
      default:
        return true; // Unknown condition - allow (fail open)
    }
  },

  _resolveSimpleEffect(state, controllerId, effect, data) {
    // Check effect-level condition before resolving
    if (effect.condition && !this._checkEffectCondition(state, controllerId, effect)) {
      return null; // Condition not met, skip this effect
    }
    const opponentId = controllerId === 0 ? 1 : 0;
    // Helper: resolve dynamic amounts to numbers
    const resolveAmt = (amt) => {
      if (typeof amt === 'number') return amt;
      if (!amt) return 0;
      if (amt === 'vivid') return CardEngine.countVividColors(state, controllerId);
      if (amt === 'creature_count') return state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length;
      if (amt === 'lands_count') return state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isLand(c)).length;
      if (amt === 'lands_in_gy_count') return state.players[controllerId].zones.graveyard.getAll().filter(c => CardEngine.isLand(c)).length;
      if (amt === 'creatures_in_gy') return state.players[controllerId].zones.graveyard.getAll().filter(c => CardEngine.isCreature(c)).length;
      if (amt === 'mana_value') return (data && data.card && data.card.cmc) || 0;
      if (amt === 'prevented') return state._lastPreventedDamage || 0;
      if (amt === 'greatest_toughness') {
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        return creatures.length > 0 ? Math.max(...creatures.map(c => CardEngine.getToughness(c))) : 0;
      }
      const parsed = parseInt(amt);
      return isNaN(parsed) ? 0 : parsed;
    };

    switch (effect.type) {
      case 'draw': {
        const drawN = resolveAmt(effect.amount) || 1;
        for (let i = 0; i < drawN; i++) {
          const card = state.players[controllerId].zones.library.drawFromTop();
          if (card) state.players[controllerId].zones.hand.add(card);
        }
        return `${controllerId === 0 ? 'Voce compra' : 'Oponente compra'} ${drawN} carta(s).`;
      }
      case 'gainLife': {
        const gainN = resolveAmt(effect.amount);
        state.players[controllerId].life += gainN;
        this.fireTrigger(state, 'gain_life', { playerId: controllerId });
        return `${controllerId === 0 ? 'Voce ganha' : 'Oponente ganha'} ${gainN} vida.`;
      }
      case 'loseLife': {
        // loseLife is typically a drawback/cost (e.g., "draw 2, lose 2 life").
        // Default target is controller (self). Only explicit opponent/each_opponent targets hit opponent.
        const loseTarget = (effect.target === 'opponent' || effect.target === 'each_opponent') ? opponentId : controllerId;
        state.players[loseTarget].life -= resolveAmt(effect.amount);
        this._checkWinner(state);
        return `${loseTarget === 0 ? 'Voce perde' : 'Oponente perde'} ${effect.amount} vida.`;
      }
      case 'damage': {
        const dmgN = resolveAmt(effect.amount);
        state.players[opponentId].life -= dmgN;
        this._checkWinner(state);
        return `${dmgN} dano ao ${opponentId === 0 ? 'jogador' : 'oponente'}.`;
      }
      case 'counter_self': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
          card._counters[effect.counter] = (card._counters[effect.counter] || 0) + (effect.amount || 1);
          // Fire counter_placed trigger
          const cpLogs = this.fireTrigger(state, 'counter_placed', { playerId: controllerId, cardUid: card._uid, counter: effect.counter });
          state.log.push(...cpLogs);
        }
        return `+${effect.amount || 1} contador(es) ${effect.counter}.`;
      }
      case 'buff_self': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          let bp = effect.power, bt = effect.toughness;
          if (typeof bp === 'string') bp = bp === 'double' ? CardEngine.getPower(card) : (parseInt(bp) || 0);
          if (typeof bt === 'string') bt = bt === 'double' ? CardEngine.getToughness(card) : (parseInt(bt) || 0);
          bp = bp || 0; bt = bt || 0;
          card._powerMod = (card._powerMod || 0) + bp;
          card._toughnessMod = (card._toughnessMod || 0) + bt;
        }
        return `Buff aplicado.`;
      }
      case 'create_token': {
        let count = resolveAmt(effect.count) || 1;
        // Token doubling from static abilities
        const hasDoubler = state.players[controllerId].zones.battlefield.cards.some(c => c._tokenDoubling);
        if (hasDoubler) count *= 2;
        const keywords = effect.keywords || [];
        // Resolve dynamic power/toughness values (e.g., "X", "greatest_toughness")
        const tokenPower = resolveAmt(effect.power) || 0;
        const tokenToughness = resolveAmt(effect.toughness) || 0;
        for (let i = 0; i < count; i++) {
          const token = CardEngine.createToken(controllerId, tokenPower, tokenToughness, effect.name || 'Token', keywords);
          // Mark token as "entered this turn" for double damage tracking
          if (CardEngine.isCreature(token)) {
            token._enteredThisTurn = true;
          }
          state.players[controllerId].zones.battlefield.add(token);
          // Mobilize: tokens enter attacking (during any combat phase)
          if (effect.attacking && state.combat && state.combat.phase !== 'none') {
            token._attacking = true;
            token._tapped = true;
            state.combat.attackers.push({ uid: token._uid, card: token });
          }
          // Mobilize: sacrifice at end step
          if (effect.sacrificeAtEndStep) {
            token._sacrificeAtEndStep = true;
          }
        }
        const extraInfo = effect.attacking ? ' atacando' : '';
        return `Cria ${count} token(s) ${tokenPower}/${tokenToughness} ${effect.name || 'Token'}${extraInfo}.`;
      }
      case 'scry': {
        // Auto-resolve for triggers (simplified)
        const lib = state.players[controllerId].zones.library;
        const cards = [];
        for (let i = 0; i < (effect.amount || 1); i++) {
          const c = lib.drawFromTop();
          if (c) cards.push(c);
        }
        // Put back on top (simplified - no choice for triggers)
        cards.reverse().forEach(c => lib.addToTop(c));
        return `Scry ${effect.amount || 1}.`;
      }
      case 'mill': {
        let millTarget;
        if (effect.target === 'any_player') {
          millTarget = opponentId;
        } else {
          millTarget = effect.target === 'opponent' ? opponentId : controllerId;
        }
        for (let i = 0; i < (effect.amount || 1); i++) {
          const c = state.players[millTarget].zones.library.drawFromTop();
          if (c) state.players[millTarget].zones.graveyard.add(c);
        }
        return `Mill ${effect.amount || 1}.`;
      }
      case 'add_mana': {
        console.log(`[MANA ENGINE] add_mana called:`, effect, `controllerId:`, controllerId, `isHuman:`, state.players[controllerId].isHuman);

        // Handle colors array with choose (pick one from multiple options)
        if (effect.colors && Array.isArray(effect.colors) && effect.choose) {
          console.log(`[MANA ENGINE] Processing color array with choose=${effect.choose}`);
          const colors = effect.colors;
          if (state.players[controllerId].isHuman && controllerId === 0) {
            // Pause for human choice
            state._pendingManaChoice = { colors, controllerId, cardUid: data.cardUid };
            state.waitingForInput = { type: 'mana_color_choice', playerId: controllerId };
            return null;
          } else if (controllerId === 0) {
            // AI (player 0): pick color most needed based on hand
            const hand = state.players[controllerId].zones.hand.getAll();
            const needs = {};
            for (const c of colors) needs[c] = 0;
            for (const hCard of hand) {
              const mc = hCard.mana_cost || '';
              for (const c of colors) {
                const regex = new RegExp(`\\{${c}\\}`, 'g');
                const matches = mc.match(regex);
                if (matches) needs[c] += matches.length;
              }
            }
            const bestColor = colors.reduce((best, c) => needs[c] > needs[best] ? c : best, colors[0]);
            const amount = effect.amount || 1;
            state.manaPool[controllerId][bestColor] = (state.manaPool[controllerId][bestColor] || 0) + amount;
            return `+{${bestColor}} mana.`;
          } else {
            // Opponent AI: block Devotee-like abilities that convert mana without net gain
            // These should only be used by the human player strategically
            return null;
          }
        }

        // Handle colors array without choose (add multiple colors at once)
        if (effect.colors && Array.isArray(effect.colors)) {
          for (const c of effect.colors) {
            state.manaPool[controllerId][c] = (state.manaPool[controllerId][c] || 0) + 1;
          }
          return `+{${effect.colors.join('}{')}} mana.`;
        }
        const color = effect.color || 'C';

        // Handle color: "any" - player picks any color (WUBRG)
        if (color === 'any') {
          console.log(`[MANA ENGINE] Processing "any" color choice`);
          const anyColors = ['W', 'U', 'B', 'R', 'G'];
          if (state.players[controllerId].isHuman && controllerId === 0) {
            console.log(`[MANA ENGINE] Setting up human choice UI`);
            // Pause for human choice
            state._pendingManaChoice = { colors: anyColors, controllerId, cardUid: data.cardUid };
            state.waitingForInput = { type: 'mana_color_choice', playerId: controllerId };
            return null;
          } else {
            // AI: pick color most needed based on hand
            const hand = state.players[controllerId].zones.hand.getAll();
            const needs = {};
            for (const c of anyColors) needs[c] = 0;
            for (const hCard of hand) {
              const mc = hCard.mana_cost || '';
              for (const c of anyColors) {
                if (mc.includes(c)) needs[c]++;
              }
            }
            const bestColor = anyColors.reduce((best, c) => needs[c] > needs[best] ? c : best, anyColors[0]);
            const amount = effect.amount || 1;
            state.manaPool[controllerId][bestColor] = (state.manaPool[controllerId][bestColor] || 0) + amount;
            return `+{${bestColor}} mana.`;
          }
        }

        // Handle choose: player picks one color from multi-color string
        if (effect.choose && color.length > 1) {
          const colors = color.split('');
          if (state.players[controllerId].isHuman && controllerId === 0) {
            // Pause for human choice
            state._pendingManaChoice = { colors, controllerId, cardUid: data.cardUid };
            state.waitingForInput = { type: 'mana_color_choice', playerId: controllerId };
            return null;
          } else {
            // AI: pick color most needed based on hand
            const hand = state.players[controllerId].zones.hand.getAll();
            const needs = {};
            for (const c of colors) needs[c] = 0;
            for (const hCard of hand) {
              const mc = hCard.mana_cost || '';
              for (const c of colors) {
                const regex = new RegExp(`\\{${c}\\}`, 'g');
                const matches = mc.match(regex);
                if (matches) needs[c] += matches.length;
              }
            }
            const best = colors.reduce((a, b) => (needs[a] || 0) >= (needs[b] || 0) ? a : b);
            state.manaPool[controllerId][best] = (state.manaPool[controllerId][best] || 0) + 1;
            return `+{${best}} mana.`;
          }
        }
        const addAmt = effect.amount || 1;
        state.manaPool[controllerId][color] = (state.manaPool[controllerId][color] || 0) + addAmt;
        return `+${addAmt}{${color}} mana.`;
      }
      case 'damage_each_opponent': {
        const deAmt = resolveAmt(effect.amount);
        state.players[opponentId].life -= deAmt;
        this._checkWinner(state);
        return `${deAmt} dano a cada oponente.`;
      }
      case 'opponent_loses_half_life': {
        const halfLife = Math.ceil(state.players[opponentId].life / 2);
        state.players[opponentId].life -= halfLife;
        this._checkWinner(state);
        return `${opponentId === 0 ? 'Voce perde' : 'Oponente perde'} ${halfLife} vida (metade arredondada para cima).`;
      }
      case 'untap_self': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          card._tapped = false;
        }
        return `Desvirou.`;
      }
      case 'peek_top_land': {
        const lib = state.players[controllerId].zones.library;
        const topCard = lib.drawFromTop();
        if (!topCard) return 'Biblioteca vazia.';
        if (CardEngine.isLand(topCard)) {
          state.players[controllerId].zones.hand.add(topCard);
          return `${controllerId === 0 ? 'Voce olha' : 'Oponente olha'} o topo: ${topCard.name} (terreno) — vai para a mao!`;
        } else {
          // Not a land - put back on top
          lib.addToTop(topCard);
          return `${controllerId === 0 ? 'Voce olha' : 'Oponente olha'} o topo: nao e terreno.`;
        }
      }
      case 'gain_life': {
        const amount = effect.amount || 1;
        state.players[controllerId].life += amount;
        this.fireTrigger(state, 'gain_life', { playerId: controllerId });
        return `${controllerId === 0 ? 'Voce ganha' : 'Oponente ganha'} ${amount} vida.`;
      }
      case 'lose_life': {
        // Default target is opponent (harmful effect). Only 'self' targets controller.
        const target = effect.target === 'self' ? controllerId : opponentId;
        state.players[target].life -= (effect.amount || 0);
        this._checkWinner(state);
        return `${target === 0 ? 'Voce perde' : 'Oponente perde'} ${effect.amount || 0} vida.`;
      }
      case 'endure': {
        // Endure X: put X +1/+1 counters OR create X 1/1 Spirit(s)
        const endureAmount = effect.amount || 1;
        const endureCard = state.players[controllerId].zones.battlefield.get(data.cardUid);
        const isHuman = state.players[controllerId].isHuman;

        // If creature is not on battlefield, always create tokens
        if (!endureCard || !CardEngine.isCreature(endureCard)) {
          for (let i = 0; i < endureAmount; i++) {
            const token = CardEngine.createToken(controllerId, 1, 1, 'Spirit', []);
            state.players[controllerId].zones.battlefield.add(token);
          }
          return `Endure ${endureAmount}: cria ${endureAmount} Spirit(s) 1/1.`;
        }

        // Human: interactive choice
        if (isHuman) {
          state._pendingEndure = { cardUid: data.cardUid, amount: endureAmount, controllerId };
          state.waitingForInput = { type: 'endure_choice', playerId: controllerId };
          return null;
        }

        // AI: always chooses counters if creature is alive
        if (!endureCard._counters) endureCard._counters = { '+1/+1': 0, '-1/-1': 0 };
        endureCard._counters['+1/+1'] += endureAmount;
        return `${endureCard.name} endure ${endureAmount}: +${endureAmount} counters +1/+1.`;
      }
      case 'stun_counter': {
        // Add stun counters to a target creature
        const targetCard = effect.target === 'self'
          ? state.players[controllerId].zones.battlefield.get(data.cardUid)
          : null; // TODO: handle targeted stun
        if (targetCard) {
          targetCard._stunCounters = (targetCard._stunCounters || 0) + (effect.amount || 1);
          return `${targetCard.name} recebe ${effect.amount || 1} stun counter(s).`;
        }
        return null;
      }
      case 'stun_counter_self': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          card._stunCounters = (card._stunCounters || 0) + (effect.amount || 1);
          return `${card.name} recebe ${effect.amount || 1} stun counter(s).`;
        }
        return null;
      }
      case 'buff': {
        // Buff self or target
        let buffTarget = null;
        if (effect.target === 'self') {
          buffTarget = state.players[controllerId].zones.battlefield.get(data.cardUid);
        } else if (effect.target === 'other_own_creature') {
          const candidates = state.players[controllerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && c._uid !== data.cardUid
          );
          if (candidates.length > 1 && state.players[controllerId].isHuman) {
            // Human chooses target
            state._pendingBuffChoice = {
              playerId: controllerId,
              effect: effect,
              candidates: candidates.map(c => c._uid),
              sourceUid: data.cardUid
            };
            state.waitingForInput = { type: 'buff_choice', playerId: controllerId };
            return `Escolha uma criatura para receber +${effect.power || 0}/+${effect.toughness || 0}.`;
          } else if (candidates.length > 0) {
            candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            buffTarget = candidates[0];
          }
        } else if (effect.target === 'own_creature' || effect.target === 'creature') {
          const candidates = state.players[controllerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c)
          );
          if (candidates.length > 1 && state.players[controllerId].isHuman) {
            // Human chooses target
            state._pendingBuffChoice = {
              playerId: controllerId,
              effect: effect,
              candidates: candidates.map(c => c._uid),
              sourceUid: data.cardUid
            };
            state.waitingForInput = { type: 'buff_choice', playerId: controllerId };
            return `Escolha uma criatura para receber +${effect.power || 0}/+${effect.toughness || 0}.`;
          } else if (candidates.length > 0) {
            candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            buffTarget = candidates[0];
          }
        }
        if (buffTarget) {
          // Resolve dynamic power/toughness values (e.g., "X" = attacking creatures)
          let powerBonus = effect.power || 0;
          let toughnessBonus = effect.toughness || 0;

          if (effect.power === "X" && data && data.attackingCreatureCount !== undefined) {
            powerBonus = data.attackingCreatureCount;
          } else if (typeof effect.power === 'number') {
            powerBonus = effect.power;
          } else if (effect.power) {
            powerBonus = resolveAmt(effect.power) || 0;
          }

          if (effect.toughness === "X" && data && data.attackingCreatureCount !== undefined) {
            toughnessBonus = data.attackingCreatureCount;
          } else if (typeof effect.toughness === 'number') {
            toughnessBonus = effect.toughness;
          } else if (effect.toughness) {
            toughnessBonus = resolveAmt(effect.toughness) || 0;
          }

          buffTarget._powerMod = (buffTarget._powerMod || 0) + powerBonus;
          buffTarget._toughnessMod = (buffTarget._toughnessMod || 0) + toughnessBonus;
          if (effect.duration === 'end_of_turn') {
            buffTarget._tempPowerMod = (buffTarget._tempPowerMod || 0) + powerBonus;
            buffTarget._tempToughnessMod = (buffTarget._tempToughnessMod || 0) + toughnessBonus;
          }
          return `${buffTarget.name} ganha +${powerBonus}/+${toughnessBonus} ate o fim do turno.`;
        }
        return null;
      }
      case 'debuff': {
        // Debuff is same as buff but with negative values and better messaging
        const debuffEffect = {
          ...effect,
          type: 'buff' // Reuse buff logic
        };

        // Use buff logic but with better messaging for negative values
        const result = this._resolveSimpleEffect(state, controllerId, data, debuffEffect);
        if (result && (effect.power < 0 || effect.toughness < 0)) {
          const powerMod = effect.power || 0;
          const toughnessMod = effect.toughness || 0;
          return result.replace(/ganha \+.*/, `recebe ${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod}.`);
        }
        return result;
      }
      case 'debuff_all': {
        // Debuff_all is same as buff_all but with negative values
        const debuffAllEffect = {
          ...effect,
          type: 'buff_all' // Reuse buff_all logic
        };
        const result = this._resolveSimpleEffect(state, controllerId, data, debuffAllEffect);
        if (result && (effect.power < 0 || effect.toughness < 0)) {
          return result.replace(/Anthem.*/, `Todas as criaturas inimigas recebem ${effect.power || 0}/${effect.toughness || 0}.`);
        }
        return result;
      }
      case 'surveil': {
        const lib = state.players[controllerId].zones.library;
        const gy = state.players[controllerId].zones.graveyard;
        const cards = [];
        for (let i = 0; i < (effect.amount || 1); i++) {
          const c = lib.drawFromTop();
          if (c) cards.push(c);
        }
        if (cards.length === 0) return 'Grimorio vazio.';
        // Human: interactive surveil overlay
        if (state.players[controllerId].isHuman) {
          state._pendingScry = {
            type: 'surveil',
            cards: cards,
            playerId: controllerId,
            choices: cards.map(() => 'top')
          };
          state.waitingForInput = { type: 'surveil', playerId: controllerId };
          return `Surveil ${effect.amount} - escolha quais vao pro cemiterio.`;
        }
        // AI: puts creatures in graveyard, keeps spells on top
        for (const c of cards) {
          if (CardEngine.isCreature(c)) {
            gy.add(c);
          } else {
            lib.addToTop(c);
          }
        }
        return `Surveil ${effect.amount || 1}.`;
      }
      case 'counter': {
        // Put counters on a target creature (from triggers/simple effects)
        const counterTarget = effect.target;
        let targetCreature = null;

        // Special case: dragon_each_color (Call the Spirit Dragons)
        if (counterTarget === 'dragon_each_color') {
          const dragons = state.players[controllerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && CardEngine.hasCreatureType(c, 'Dragon')
          );

          if (dragons.length === 0) return 'Nenhum dragao no campo de batalha.';

          // Group dragons by color
          const dragonsByColor = {};
          const colors = ['W', 'U', 'B', 'R', 'G'];

          dragons.forEach(dragon => {
            const dragonColors = CardEngine.getCardColors(dragon);
            dragonColors.forEach(color => {
              if (colors.includes(color) && !dragonsByColor[color]) {
                dragonsByColor[color] = dragon; // First dragon of this color
              }
            });
          });

          // Put counter on one dragon of each color
          let results = [];
          Object.entries(dragonsByColor).forEach(([color, dragon]) => {
            if (!dragon._counters) dragon._counters = { '+1/+1': 0, '-1/-1': 0 };
            dragon._counters[effect.counter] = (dragon._counters[effect.counter] || 0) + (effect.amount || 1);
            results.push(`${dragon.name} (${color}) recebe ${effect.amount || 1} ${effect.counter} counter(s)`);

            // Fire counter_placed trigger
            const cpLogs = this.fireTrigger(state, 'counter_placed', { playerId: controllerId, cardUid: dragon._uid, counter: effect.counter });
            state.log.push(...cpLogs);
          });

          return results.length > 0 ? results.join('. ') : 'Nenhum dragao de cores distintas encontrado.';
        }

        // Attacking creature targeting (for triggered abilities during attacks)
        if (counterTarget === 'attacking_creature' && data.cardUid) {
          // Find the attacking creature that triggered this (from attacks event)
          const attackingCard = state.players[controllerId].zones.battlefield.get(data.cardUid);
          if (attackingCard && attackingCard._attacking) {
            if (!attackingCard._counters) attackingCard._counters = { '+1/+1': 0, '-1/-1': 0 };
            attackingCard._counters[effect.counter] = (attackingCard._counters[effect.counter] || 0) + (effect.amount || 1);

            // Fire counter_placed trigger
            const cpLogs = this.fireTrigger(state, 'counter_placed', { playerId: controllerId, cardUid: attackingCard._uid, counter: effect.counter });
            state.log.push(...cpLogs);

            return `${attackingCard.name} recebe ${effect.amount || 1} ${effect.counter} counter(s).`;
          }
        }

        // Standard counter targeting
        if (counterTarget === 'own_creature' || counterTarget === 'creature' || counterTarget === 'other_own_creature') {
          const candidates = state.players[controllerId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && c._uid !== data.cardUid
          );
          if (candidates.length > 0) {
            candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            targetCreature = candidates[0];
          }
          // Fallback: if no OTHER creature, try self
          if (!targetCreature) {
            targetCreature = state.players[controllerId].zones.battlefield.get(data.cardUid);
          }
        }
        if (targetCreature) {
          if (!targetCreature._counters) targetCreature._counters = { '+1/+1': 0, '-1/-1': 0 };
          targetCreature._counters[effect.counter] = (targetCreature._counters[effect.counter] || 0) + (effect.amount || 1);
          // Fire counter_placed trigger
          const cpLogs = this.fireTrigger(state, 'counter_placed', { playerId: controllerId, cardUid: targetCreature._uid, counter: effect.counter });
          state.log.push(...cpLogs);
          if (effect.counter === '-1/-1' && CardEngine.getToughness(targetCreature) <= 0) {
            this.creatureDies(state, targetCreature, controllerId);
          }
          return `${targetCreature.name} recebe ${effect.amount || 1} ${effect.counter} counter(s).`;
        }
        return null;
      }
      case 'counter_all': {
        // Put counters on all creatures you control
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        for (const c of creatures) {
          if (!c._counters) c._counters = { '+1/+1': 0, '-1/-1': 0 };
          c._counters[effect.counter] = (c._counters[effect.counter] || 0) + (effect.amount || 1);
        }
        return `+${effect.amount || 1} ${effect.counter} em todas as criaturas.`;
      }
      case 'destroy': {
        // Destroy creature with specific targeting
        let targetId = opponentId;
        let creatures = [];

        if (effect.target === 'self') {
          targetId = controllerId;
        }

        // Filter creatures by target type
        const allCreatures = state.players[targetId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c) && !CardEngine.hasIndestructible(c)
        );

        if (effect.target === 'opponent_creature_mv3+') {
          // Elspeth ultimate: destroy creature with mana value 3+
          creatures = allCreatures.filter(c => (c.cmc || 0) >= 3);
        } else {
          // Standard destroy targeting
          creatures = allCreatures;
        }

        if (creatures.length > 0) {
          // Pick highest power creature
          creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = creatures[0];
          const died = this.creatureDies(state, target, targetId);
          if (died) return `${target.name} e destruido.`;
        }
        return creatures.length === 0 && effect.target === 'opponent_creature_mv3+'
          ? 'Nenhuma criatura oponente com custo 3+ encontrada.'
          : null;
      }
      case 'bounce': {
        // Default to opponent unless explicitly targeting self/own
        const isOwnTarget = effect.target === 'self' || effect.target === 'own_nonland' || effect.target === 'bounce_self';
        const targetId = isOwnTarget ? controllerId : opponentId;

        // Filter by target type
        let candidates = [];
        if (effect.target === 'spell_or_permanent') {
          // Can target spells on stack OR permanents on battlefield
          const stackSpells = state.gameStack ? state.gameStack.filter(item => item.type === 'spell') : [];
          const allPermanents = [];
          // Add all permanents from both players
          allPermanents.push(...state.players[0].zones.battlefield.cards);
          allPermanents.push(...state.players[1].zones.battlefield.cards);
          candidates = [...stackSpells.map(s => s.card), ...allPermanents];
        } else {
          candidates = state.players[targetId].zones.battlefield.cards;
          if (effect.target === 'own_nonland') {
            candidates = candidates.filter(c => !CardEngine.isLand(c) && c._uid !== data.cardUid);
          } else if (effect.target === 'nonland_permanent') {
            candidates = candidates.filter(c => !CardEngine.isLand(c));
          } else {
            candidates = candidates.filter(c => CardEngine.isCreature(c));
          }
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));

          // Support for bouncing multiple cards via amount parameter
          const bounceAmount = Math.min(effect.amount || 1, candidates.length);
          const targets = candidates.slice(0, bounceAmount);

          let results = [];
          let anyTokenBounced = false;

          targets.forEach(target => {
            // Check if target is a spell on stack or permanent on battlefield
            const isSpellOnStack = state.gameStack && state.gameStack.some(item => item.card === target);

            if (isSpellOnStack) {
              // Remove spell from stack and return to hand
              const stackIndex = state.gameStack.findIndex(item => item.card === target);
              if (stackIndex !== -1) {
                const spellItem = state.gameStack[stackIndex];
                state.gameStack.splice(stackIndex, 1);
                state.players[spellItem.controllerId].zones.hand.add(target);
                results.push(`${target.name} e devolvido da pilha para a mao`);
              }
            } else {
              // Handle permanent on battlefield (existing logic)
              const wasToken = target._isToken;
              const targetOwnerId = target._ownerId || targetId;

              // If aura, remove effects from enchanted creature
              if (CardEngine.isAura(target) && target._attachedTo) {
                for (const p of state.players) {
                  const enchanted = p.zones.battlefield.get(target._attachedTo);
                  if (enchanted) {
                    this._removeAuraEffects(target, enchanted);
                    enchanted._attachments = enchanted._attachments.filter(uid => uid !== target._uid);
                    break;
                  }
                }
              }

              // Fire leaves_battlefield before removing
              state.log.push(...this.fireTrigger(state, 'leaves_battlefield', { cardUid: target._uid, ownerId: targetOwnerId, card: target }));
              state.players[targetOwnerId].zones.battlefield.remove(target._uid);
              this._unregisterCardTriggers(state, target._uid);

              // Tokens disappear when bounced, non-tokens go to hand
              if (target._isToken) {
                // Don't add tokens to hand, they disappear
                anyTokenBounced = true;
              } else {
                state.players[targetOwnerId].zones.hand.add(target);
              }
              results.push(`${target.name} e devolvido${target._isToken ? ' (token desaparece)' : ' a mao'}`);
            }
          });

          // Conditional draw if bounced permanent was a token
          if (effect.draw_if_token && anyTokenBounced) {
            state.players[controllerId].zones.hand.add(
              state.players[controllerId].zones.library.drawFromTop()
            );
            results.push('Compre uma carta');
          }

          return results.join('. ') + '.';
        }
        return null;
      }
      case 'exile': {
        const targetId = effect.target === 'self' ? controllerId : opponentId;

        let candidates = [];

        if (effect.target === 'colored_permanent') {
          // Target any permanent (creature, artifact, enchantment, planeswalker) that has color
          candidates = state.players[targetId].zones.battlefield.cards.filter(c => {
            const colors = CardEngine.getCardColors(c);
            const isColored = colors && colors.length > 0;
            const isPermanent = CardEngine.isCreature(c) ||
                               CardEngine.isArtifact(c) ||
                               CardEngine.isEnchantment(c) ||
                               CardEngine.isPlaneswalker(c);
            return isColored && isPermanent;
          });
          // Sort colored permanents by CMC (highest first) for consistent targeting
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        } else if (effect.target === 'permanent_mv3+') {
          // Target any permanent with CMC 3 or higher
          candidates = state.players[targetId].zones.battlefield.cards.filter(c => {
            const isPermanent = CardEngine.isCreature(c) ||
                               CardEngine.isArtifact(c) ||
                               CardEngine.isEnchantment(c) ||
                               CardEngine.isPlaneswalker(c);
            return isPermanent && (c.cmc || 0) >= 3;
          });
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        } else if (effect.target === 'nonland_permanent') {
          // Target any nonland permanent
          candidates = state.players[targetId].zones.battlefield.cards.filter(c => {
            const isPermanent = CardEngine.isCreature(c) ||
                               CardEngine.isArtifact(c) ||
                               CardEngine.isEnchantment(c) ||
                               CardEngine.isPlaneswalker(c);
            return isPermanent;
          });
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        } else {
          // Legacy behavior: target creatures (for backwards compatibility)
          candidates = state.players[targetId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c)
          );
          candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        }

        if (candidates.length > 0) {
          const target = candidates[0];

          // Fire leaves_battlefield before removing
          state.log.push(...this.fireTrigger(state, 'leaves_battlefield', { cardUid: target._uid, ownerId: targetId, card: target }));

          state.players[targetId].zones.battlefield.remove(target._uid);
          this._unregisterCardTriggers(state, target._uid);

          // Track which card exiled this one (for both temporary and permanent)
          if (data.cardUid) {
            // Temporary exile tracking (existing system)
            if (effect.until_source_leaves) {
              if (!state._temporaryExiles) state._temporaryExiles = {};
              state._temporaryExiles[target._uid] = {
                exilerUid: data.cardUid,
                originalOwner: targetId,
                originalZone: 'battlefield'
              };
            }

            // Permanent exile tracking (new system for cards like Mardu Siegebreaker)
            if (!state._permanentExiles) state._permanentExiles = {};
            if (!state._permanentExiles[data.cardUid]) state._permanentExiles[data.cardUid] = [];
            state._permanentExiles[data.cardUid].push({
              exiledCard: target,
              exiledCardUid: target._uid,
              originalOwner: targetId
            });

            // Store exiled card on the source card for UI display (under the enchantment)
            const sourceCard = state.players[controllerId].zones.battlefield.get(data.cardUid);
            if (sourceCard) {
              if (!sourceCard._exiledCards) sourceCard._exiledCards = [];
              sourceCard._exiledCards.push(target);
            }
          }

          state.players[targetId].zones.exile.add(target);
          return `${target.name} e exilado${effect.until_source_leaves ? ' temporariamente' : ''}.`;
        }
        return null;
      }
      case 'ramp': {
        const lib = state.players[controllerId].zones.library;
        const bf = state.players[controllerId].zones.battlefield;
        const isBasicOnly = effect.landType === 'basic' || !effect.landType;
        const availLands = lib.cards.filter(c => isBasicOnly ? CardEngine.isBasicLand(c) : CardEngine.isLand(c));
        if (availLands.length === 0) return 'Nenhum terreno basico encontrado.';

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

        if (controllerId === 0 && state.players[0].isHuman) {
          // Interactive for human: show land choice overlay
          const landOptions = [];
          const seenNames = new Set();
          for (const land of availLands) {
            if (!seenNames.has(land.name)) {
              seenNames.add(land.name);
              landOptions.push(land);
            }
          }
          state._pendingRamp = {
            lands: landOptions,
            tapped: toBattlefield ? true : (effect.tapped || false),
            toHand: effect.to_hand || false,
            toTop: toTop,
            toBattlefield: toBattlefield,
            optional: effect.optional || false,
            playerId: controllerId
          };
          state.waitingForInput = { type: 'ramp_choice', playerId: controllerId };
          return `Escolha um terreno da sua biblioteca.`;
        }

        // AI: auto-pick best land based on hand color needs
        const hand = state.players[controllerId].zones.hand.cards;
        const colorNeeds = {};
        hand.forEach(c => {
          const pips = (c.mana_cost || '').match(/\{([WUBRG])\}/gi) || [];
          pips.forEach(p => {
            const color = p.replace(/[{}]/g, '').toUpperCase();
            colorNeeds[color] = (colorNeeds[color] || 0) + 1;
          });
        });
        let bestLand = availLands[0];
        let bestScore = -1;
        for (const l of availLands) {
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
        const landIdx = lib.cards.indexOf(bestLand);
        if (landIdx !== -1) {
          const land = lib.cards.splice(landIdx, 1)[0];
          if (effect.to_hand) {
            state.players[controllerId].zones.hand.add(land);
            lib.shuffle();
            return `Busca ${land.name} da biblioteca para a mao.`;
          } else if (toTop) {
            lib.cards.unshift(land);
            return `Busca ${land.name} e coloca no topo do grimorio.`;
          } else if (toBattlefield) {
            const bfLand = CardEngine.prepareForBattlefield(land);
            bfLand._ownerId = controllerId;
            bfLand._tapped = true;
            bf.add(bfLand);
            lib.shuffle();
            return `Busca ${land.name} e coloca no campo virado.`;
          } else {
            const bfLand = CardEngine.prepareForBattlefield(land);
            bfLand._ownerId = controllerId;
            if (effect.tapped) bfLand._tapped = true;
            bf.add(bfLand);
            lib.shuffle();
            return `Busca ${land.name} da biblioteca.`;
          }
        }
        return 'Nenhum terreno basico encontrado.';
      }
      case 'fight': {
        // Self fights opponent creature - pick weakest that can be killed
        const self = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (!self) return null;
        const enemies = state.players[opponentId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c)
        );
        if (enemies.length === 0) return null;
        // Pick enemy that self can kill
        const selfPower = CardEngine.getPower(self);
        const killable = enemies.filter(e => CardEngine.getToughness(e) - (e._damage || 0) <= selfPower);
        const target = killable.length > 0
          ? killable.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a))[0]
          : enemies.sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b))[0];
        // Deal damage to each other
        target._damage = (target._damage || 0) + selfPower;
        self._damage = (self._damage || 0) + CardEngine.getPower(target);
        const logs = [`${self.name} luta contra ${target.name}!`];
        if (target._damage >= CardEngine.getToughness(target)) {
          this.creatureDies(state, target, opponentId);
          logs.push(`${target.name} morre.`);
        }
        if (self._damage >= CardEngine.getToughness(self)) {
          this.creatureDies(state, self, controllerId);
          logs.push(`${self.name} morre.`);
        }
        return logs.join(' ');
      }
      case 'tap_target': {
        const enemies = state.players[opponentId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c) && !c._tapped
        );
        if (enemies.length > 0) {
          enemies.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = enemies[0];
          target._tapped = true;
          const tapLogs = this.fireTrigger(state, 'becomes_tapped', { cardUid: target._uid, card: target, controllerId: opponentId });
          state.log.push(...tapLogs);
          return `${target.name} e virado.`;
        }
        return null;
      }
      case 'tap': {
        // Generic tap effect with targeting
        let targets = [];
        const opponentId = controllerId === 0 ? 1 : 0;

        if (effect.target === 'opponent_creature') {
          targets = state.players[opponentId].zones.battlefield.cards.filter(c =>
            CardEngine.isCreature(c) && !c._tapped
          );
        } else if (effect.target === 'creature' || effect.target === 'any_creature') {
          // Any creature (could be own or opponent)
          for (const pid of [0, 1]) {
            targets.push(...state.players[pid].zones.battlefield.cards.filter(c =>
              CardEngine.isCreature(c) && !c._tapped
            ));
          }
        }

        if (targets.length === 0) return null;

        // If human player needs to choose, pause for input
        if (targets.length > 1 && state.players[controllerId].isHuman) {
          state._pendingTargetChoice = {
            targets: targets,
            effect: effect,
            controllerId: controllerId,
            cardUid: data?.cardUid,
            effectType: 'tap'
          };
          state.waitingForInput = {
            type: 'target_choice_single',
            playerId: controllerId,
            prompt: `Escolha qual criatura virar`
          };
          return null; // Resume after player chooses
        }

        // AI or single target: choose automatically
        targets.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
        const target = targets[0];
        target._tapped = true;

        // Find the owner of the target
        const targetOwner = state.players[0].zones.battlefield.get(target._uid) ? 0 : 1;
        const tapLogs = this.fireTrigger(state, 'becomes_tapped', { cardUid: target._uid, card: target, controllerId: targetOwner });
        state.log.push(...tapLogs);
        return `${target.name} e virado.`;
      }
      case 'discard_trigger': {
        // Opponent discards
        const hand = state.players[opponentId].zones.hand;
        const amount = effect.amount || 1;
        const discarded = [];
        for (let i = 0; i < amount && hand.count() > 0; i++) {
          // AI discards worst card (highest cost non-land)
          const cards = hand.getAll();
          cards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const worst = cards[cards.length - 1]; // lowest cost
          hand.remove(worst._uid);
          state.players[opponentId].zones.graveyard.add(worst);
          discarded.push(worst.name);
        }
        return discarded.length > 0 ? `${opponentId === 0 ? 'Voce descarta' : 'Oponente descarta'}: ${discarded.join(', ')}.` : null;
      }
      case 'optional_discard_draw': {
        // Rescue Leopard effect: "you may discard a card. If you do, draw a card"
        const hand = state.players[controllerId].zones.hand;

        if (hand.count() === 0) {
          return null; // Can't discard if no cards in hand
        }

        if (state.players[controllerId].isHuman && controllerId === 0) {
          // Human: set up optional discard choice
          state._pendingOptionalDiscard = {
            controller: controllerId,
            amount: 1,
            drawOnDiscard: true // Flag to draw after discarding
          };
          state.waitingForInput = { type: 'optional_discard_choice', playerId: controllerId };
          return null; // Pause for human choice
        } else {
          // AI: auto-discard worst card in hand if beneficial
          const cards = hand.getAll();
          if (cards.length > 0) {
            // AI discards least valuable card
            const worst = cards.reduce((prev, curr) => {
              const prevCmc = prev.cmc || 0;
              const currCmc = curr.cmc || 0;
              // Prefer higher CMC for discarding (less valuable in hand typically)
              return currCmc > prevCmc ? curr : prev;
            });

            hand.remove(worst._uid);
            state.players[controllerId].zones.graveyard.add(worst);

            // Draw a card
            const drawn = state.players[controllerId].zones.library.drawFromTop();
            if (drawn) state.players[controllerId].zones.hand.add(drawn);

            return `Descarta ${worst.name} e compra uma carta.`;
          }
        }
        return null;
      }
      case 'traveling_botanist_ability': {
        // Traveling Botanist: "look at the top card. If it's a land, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard"
        const lib = state.players[controllerId].zones.library;

        if (lib.count() === 0) {
          return "Biblioteca vazia.";
        }

        const topCard = lib.drawFromTop();
        const isLand = CardEngine.isLand(topCard);

        if (!isLand) {
          // Not a land: put back on top automatically
          lib.addToTop(topCard);
          return `Olha o topo da biblioteca (${topCard.name} - nao e terreno).`;
        }

        // Is a land: player can choose hand or graveyard
        if (state.players[controllerId].isHuman && controllerId === 0) {
          // Human: show interactive choice for land
          state._pendingTravelingBotanist = {
            card: topCard,
            isLand: true,
            controller: controllerId
          };
          state.waitingForInput = { type: 'traveling_botanist_choice', playerId: controllerId };
          return null; // Pause for human choice
        } else {
          // AI: always takes lands to hand
          state.players[controllerId].zones.hand.add(topCard);
          return `Revela ${topCard.name} (terreno) e bota na mao.`;
        }
      }
      case 'return_from_graveyard': {
        const gy = state.players[controllerId].zones.graveyard;
        const targetZone = effect.to_hand ? 'hand' : 'battlefield';

        // Filter graveyard cards based on target type
        let gyCards = [];
        if (effect.target === 'card' || effect.target === 'any') {
          // Any card from graveyard (e.g., Auroral Procession)
          gyCards = gy.getAll();
        } else if (effect.target === 'creature_or_land') {
          gyCards = gy.getAll().filter(c => CardEngine.isCreature(c) || CardEngine.isLand(c));
        } else if (effect.target === 'land') {
          gyCards = gy.getAll().filter(c => CardEngine.isLand(c));
        } else if (effect.target === 'creature_mv3') {
          // Yathan Roadwatcher: creature with mana value 3 or less
          gyCards = gy.getAll().filter(c => CardEngine.isCreature(c) && (c.cmc || 0) <= 3);
        } else if (effect.target === 'nonland_permanent_mv2') {
          // Wayspeaker Bodyguard: nonland permanent with mana value 2 or less
          gyCards = gy.getAll().filter(c => CardEngine.isPermanent(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 2);
        } else {
          // Default: creatures only
          gyCards = gy.getAll().filter(c => CardEngine.isCreature(c));
        }

        if (gyCards.length > 0) {
          gyCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const card = gyCards[0];
          gy.remove(card._uid);
          // Fire trigger when card leaves graveyard
          this.fireTrigger(state, 'card_leaves_graveyard', { playerId: controllerId, card: card });
          if (targetZone === 'hand') {
            state.players[controllerId].zones.hand.add(card);
            return `${card.name} volta do cemiterio para a mao.`;
          } else {
            const bfCard = CardEngine.prepareForBattlefield(card);
            bfCard._ownerId = controllerId;
            // Mark creature as "entered this turn" for double damage tracking
            if (CardEngine.isCreature(bfCard)) {
              bfCard._enteredThisTurn = true;
            }
            state.players[controllerId].zones.battlefield.add(bfCard);
            this._registerCardTriggers(state, bfCard, controllerId);
            return `${card.name} volta do cemiterio para o campo!`;
          }
        }
        return 'Nenhuma criatura no cemiterio.';
      }
      case 'sacrifice': {
        let targetPlayerId = controllerId;
        let targetCreatures = [];

        // Determine target player based on effect target
        if (effect.target === 'opponent_creature') {
          targetPlayerId = opponentId;
        }

        // Get target creatures
        targetCreatures = state.players[targetPlayerId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c)
        );

        if (targetCreatures.length > 0) {
          // Sort by power (weakest first for auto-choice)
          targetCreatures.sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
          const target = targetCreatures[0]; // For AI/auto-choice, pick weakest

          this.creatureDies(state, target, targetPlayerId);

          if (effect.target === 'opponent_creature') {
            return `Oponente sacrifica ${target.name}.`;
          } else {
            return `${target.name} e sacrificado.`;
          }
        }
        return null;
      }
      case 'return_to_hand': {
        // If activated from graveyard zone only, restrict to graveyard
        if (data.fromZone === 'graveyard') {
          const rthCard = state.players[controllerId].zones.graveyard.get(data.cardUid);
          if (rthCard) {
            state.players[controllerId].zones.graveyard.remove(rthCard._uid);
            state.players[controllerId].zones.hand.add(rthCard);
            // Track card leaving graveyard
            if (!state._cardLeftGraveyardThisTurn) state._cardLeftGraveyardThisTurn = {};
            state._cardLeftGraveyardThisTurn[controllerId] = true;
            return `${rthCard.name} volta para a mao do cemiterio.`;
          }
          return null;
        }

        // Default behavior: check battlefield first, then graveyard
        let rthCard = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (rthCard) {
          state.players[controllerId].zones.battlefield.remove(rthCard._uid);
          this._unregisterCardTriggers(state, rthCard._uid);
          state.players[controllerId].zones.hand.add(rthCard);
          return `${rthCard.name} volta para a mao.`;
        }
        rthCard = state.players[controllerId].zones.graveyard.get(data.cardUid);
        if (rthCard) {
          state.players[controllerId].zones.graveyard.remove(rthCard._uid);
          state.players[controllerId].zones.hand.add(rthCard);
          // Track card leaving graveyard
          if (!state._cardLeftGraveyardThisTurn) state._cardLeftGraveyardThisTurn = {};
          state._cardLeftGraveyardThisTurn[controllerId] = true;
          return `${rthCard.name} volta para a mao do cemiterio.`;
        }
        return null;
      }
      case 'blight': {
        // Blight X = put X -1/-1 counters on a creature you control
        const amount = effect.amount || 1;
        const result = this._performBlight(state, controllerId, amount);
        return result;
      }
      case 'cant_block': {
        // Target creature can't block this turn
        const targetId = effect.target === 'self' ? controllerId : opponentId;
        const creatures = state.players[targetId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c) && !c._cantBlockThisTurn
        );
        if (creatures.length > 0) {
          // Pick biggest blocker (most impactful to disable)
          creatures.sort((a, b) => CardEngine.getToughness(b) - CardEngine.getToughness(a));
          const target = creatures[0];
          target._cantBlockThisTurn = true;
          return `${target.name} nao pode bloquear neste turno.`;
        }
        return null;
      }
      case 'buff_all': {
        // Buff all own creatures until end of turn
        const targetPid = (effect.target === 'own_creatures' || effect.target === 'all_own_creatures') ? controllerId : opponentId;
        const creatures = state.players[targetPid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        for (const c of creatures) {
          let bp = effect.power, bt = effect.toughness;
          if (typeof bp === 'string') bp = bp === 'double' ? CardEngine.getPower(c) : (parseInt(bp) || 0);
          if (typeof bt === 'string') bt = bt === 'double' ? CardEngine.getToughness(c) : (parseInt(bt) || 0);
          bp = bp || 0; bt = bt || 0;
          c._powerMod = (c._powerMod || 0) + bp;
          c._toughnessMod = (c._toughnessMod || 0) + bt;
          c._tempPowerMod = (c._tempPowerMod || 0) + bp;
          c._tempToughnessMod = (c._tempToughnessMod || 0) + bt;
        }
        return `Todas as criaturas recebem buff ate o fim do turno.`;
      }
      case 'remove_counter': {
        // Remove counter from self (as part of an effect, not a cost)
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card && card._counters) {
          const cType = effect.counter || '-1/-1';
          if ((card._counters[cType] || 0) > 0) {
            card._counters[cType]--;
            return `Remove 1 contador ${cType} de ${card.name}.`;
          }
        }
        return null;
      }
      case 'grant_haste': {
        // Grant haste to a creature you control (removes summoning sickness)
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c) && c._summoningSick
        );
        if (creatures.length > 0) {
          // Pick biggest creature that has summoning sickness (most impactful)
          creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = creatures[0];
          target._summoningSick = false;
          return `${target.name} ganha Haste!`;
        }
        return null;
      }
      case 'grant_harmonize': {
        // Grant harmonize to an instant or sorcery in the graveyard (Songcrafter Mage)
        const gyCards = state.players[controllerId].zones.graveyard.getAll();
        const eligibleSpells = gyCards.filter(c =>
          CardEngine.isInstant(c) || CardEngine.isSorcery(c)
        );
        if (eligibleSpells.length > 0) {
          // Pick highest CMC spell (most impactful)
          eligibleSpells.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const spell = eligibleSpells[0];
          spell._harmonizeGranted = true;
          return `${spell.name} ganha harmonize (custo: ${spell.mana_cost}).`;
        }
        return 'Nenhum instant/sorcery no cemiterio para ganhar harmonize.';
      }
      case 'multi_buff_up_to': {
        // Buff up to N target own creatures
        const candidates = state.players[controllerId].zones.battlefield.cards.filter(c =>
          CardEngine.isCreature(c)
        );
        const maxTargets = effect.max_targets || 1;

        if (candidates.length === 0) {
          return 'Nenhuma criatura para buffar.';
        }

        if (state.players[controllerId].isHuman) {
          // Human chooses up to max_targets creatures
          state._pendingMultiBuffChoice = {
            playerId: controllerId,
            effect: effect,
            candidates: candidates.map(c => c._uid),
            selected: [],
            maxTargets: maxTargets,
            sourceUid: data.cardUid
          };
          state.waitingForInput = { type: 'multi_buff_choice', playerId: controllerId };
          return `Escolha até ${maxTargets} criatura(s) para receber +${effect.power || 0}/+${effect.toughness || 0}.`;
        } else {
          // AI chooses best creatures up to max targets
          candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const targets = candidates.slice(0, Math.min(maxTargets, candidates.length));

          for (const target of targets) {
            target._powerMod = (target._powerMod || 0) + (effect.power || 0);
            target._toughnessMod = (target._toughnessMod || 0) + (effect.toughness || 0);
            if (effect.duration === 'end_of_turn') {
              target._tempPowerMod = (target._tempPowerMod || 0) + (effect.power || 0);
              target._tempToughnessMod = (target._tempToughnessMod || 0) + (effect.toughness || 0);
            }
          }

          return `${targets.length} criatura(s) recebe(m) +${effect.power || 0}/+${effect.toughness || 0}.`;
        }
      }
      case 'drain': {
        const amt = resolveAmt(effect.amount);
        state.players[opponentId].life -= amt;
        state.players[controllerId].life += amt;
        this._checkWinner(state);
        return `Drain ${amt}: oponente perde ${amt} vida, +${amt} vida.`;
      }
      case 'loot': {
        const lootN = effect.draw || effect.amount || 1;
        const discardN = effect.discard || effect.amount || 1;
        for (let i = 0; i < lootN; i++) {
          const c = state.players[controllerId].zones.library.drawFromTop();
          if (c) state.players[controllerId].zones.hand.add(c);
        }
        if (typeof VFX !== 'undefined') VFX.cardDraw(controllerId);

        // Human: interactive discard choice
        if (state.players[controllerId].isHuman) {
          state._pendingLoot = { amount: discardN, controller: controllerId };
          state.waitingForInput = { type: 'discard_for_loot', playerId: controllerId };
          return `Compra ${lootN} carta(s). Escolha ${discardN} para descartar.`;
        }

        // AI auto-discard worst
        const handAll = state.players[controllerId].zones.hand.getAll()
          .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
        for (let i = 0; i < discardN && handAll.length > 0; i++) {
          const worst = handAll.shift();
          state.players[controllerId].zones.hand.remove(worst._uid);
          state.players[controllerId].zones.graveyard.add(worst);
        }
        return `Loot ${lootN}.`;
      }
      case 'rummage': {
        const rAmt = effect.amount || 1;
        const rOptional = effect.optional !== false;
        const hand = state.players[controllerId].zones.hand;

        if (hand.count() === 0) return 'Sem cartas na mao para descartar.';

        // Human: interactive rummage (discard first, then draw)
        if (state.players[controllerId].isHuman && controllerId === 0) {
          state._pendingRummage = { amount: rAmt, optional: rOptional, upTo: false, controller: controllerId, selected: [] };
          state.waitingForInput = { type: 'rummage_discard', playerId: controllerId };
          return rOptional
            ? `Rummage: escolha ate ${rAmt} carta(s) para descartar (ou passe).`
            : `Rummage: escolha ${rAmt} carta(s) para descartar.`;
        }

        // AI path
        const rHandCards = hand.getAll().sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
        let rDiscard = Math.min(rAmt, rHandCards.length);
        if (rOptional && rHandCards.length <= 2) rDiscard = 0;
        for (let i = 0; i < rDiscard; i++) {
          const worst = rHandCards.shift();
          if (worst) {
            hand.remove(worst._uid);
            state.players[controllerId].zones.graveyard.add(worst);
          }
        }
        if (rDiscard > 0) {
          for (let i = 0; i < rDiscard; i++) {
            const c = state.players[controllerId].zones.library.drawFromTop();
            if (c) hand.add(c);
          }
          return `Rummage ${rDiscard}.`;
        }
        return rOptional ? 'Opta por nao descartar.' : null;
      }
      case 'bounce_self': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          state.players[controllerId].zones.battlefield.remove(card._uid);
          this._unregisterCardTriggers(state, card._uid);
          state.players[controllerId].zones.hand.add(card);
          return `${card.name} volta para a mao.`;
        }
        return null;
      }
      case 'look_top': {
        const lib = state.players[controllerId].zones.library;
        const lookN = effect.amount || 1;
        const looked = [];
        for (let i = 0; i < lookN && lib.count() > 0; i++) looked.push(lib.drawFromTop());
        if (looked.length === 0) return null;

        // Legacy land_to_hand behavior
        if (effect.condition === 'land_to_hand') {
          const land = looked.find(c => CardEngine.isLand(c));
          if (land) {
            state.players[controllerId].zones.hand.add(land);
            looked.filter(c => c !== land).forEach(c => lib.addToBottom(c));
            return `${land.name} vai para a mao.`;
          }
          looked.forEach(c => lib.addToBottom(c));
          return 'Nenhum terreno encontrado.';
        }

        // Advanced put_onto_battlefield behavior
        if (effect.put_onto_battlefield) {
          let filter = () => true;

          // Apply condition filters
          if (effect.condition === 'noncreature_nonland_mv3') {
            filter = c => !CardEngine.isCreature(c) && !CardEngine.isLand(c) && (c.cmc || 0) <= 3;
          }

          const candidates = looked.filter(filter);
          const maxToPut = effect.put_onto_battlefield;
          const toPut = candidates.slice(0, maxToPut);

          // Put selected cards onto battlefield
          toPut.forEach(card => {
            state.players[controllerId].zones.battlefield.add(card);
            this.fireTrigger(state, 'enters_or_attacks', { cardUid: card._uid, playerId: controllerId });
          });

          // Put rest on bottom of library in random order
          const remaining = looked.filter(c => !toPut.includes(c));
          remaining.sort(() => Math.random() - 0.5); // Random order
          remaining.forEach(c => lib.addToBottom(c));

          if (toPut.length > 0) {
            return `${toPut.map(c => c.name).join(', ')} entra(m) no campo.`;
          } else {
            return `Nenhum permanent válido encontrado.`;
          }
        }

        // Pick N cards, rest goes to specified zone
        if (effect.pick && effect.rest_to) {
          const pickCount = effect.pick;

          if (state.players[controllerId].isHuman && pickCount > 0 && looked.length >= pickCount && effect.rest_to === 'graveyard') {
            // Human: interactive choice overlay
            state._pendingLookTop = {
              type: 'look_top_choice',
              cards: looked,
              pickCount: pickCount,
              choices: new Array(looked.length).fill('graveyard'), // Default all to graveyard
              playerId: controllerId
            };
            state.waitingForInput = { type: 'look_top_choice', playerId: controllerId };
            return `Escolha ${pickCount} carta(s) para a mao.`;
          } else {
            // AI or other cases: auto-pick first N cards
            const picked = looked.slice(0, pickCount);
            const rest = looked.slice(pickCount);

            // Add picked cards to hand
            picked.forEach(c => state.players[controllerId].zones.hand.add(c));

            // Put rest to specified zone
            if (effect.rest_to === 'graveyard') {
              rest.forEach(c => state.players[controllerId].zones.graveyard.add(c));
            } else if (effect.rest_to === 'bottom') {
              rest.forEach(c => lib.addToBottom(c));
            } else {
              // Default: put back on top
              rest.reverse().forEach(c => lib.addToTop(c));
            }

            return `Pega ${pickCount} carta(s), resto para ${effect.rest_to === 'graveyard' ? 'cemitério' : 'biblioteca'}.`;
          }
        }

        // Default behavior: put back on top
        looked.reverse().forEach(c => lib.addToTop(c));
        return `Olhou ${looked.length} carta(s) do topo.`;
      }
      case 'damage_all': {
        const amt = resolveAmt(effect.amount);
        const dying = [];

        for (const pid of [0, 1]) {
          const bf = state.players[pid].zones.battlefield;

          // Filter targets based on effect.target
          let playerTargets = [];
          if (effect.target === 'creatures_and_planeswalkers') {
            playerTargets = bf.cards.filter(c =>
              CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c)
            );
          } else {
            // Default: creatures only (backwards compatibility)
            playerTargets = bf.cards.filter(c => CardEngine.isCreature(c));
          }

          playerTargets.forEach(target => {
            if (CardEngine.isPlaneswalker(target)) {
              // Damage planeswalker (reduce loyalty)
              this.damagePlaneswalker(state, target, amt, controllerId);
            } else {
              // Damage creature
              target._damage += amt;
              // Mark creature as damaged this turn
              target._damagedThisTurn = true;
              if (target._damage >= CardEngine.getToughness(target)) {
                dying.push({ creature: target, owner: pid });
              }
            }
          });
        }

        // Process creature deaths
        dying.forEach(d => this.creatureDies(state, d.creature, d.owner));

        // Determine message based on targets
        const targetDesc = effect.target === 'creatures_and_planeswalkers'
          ? 'todas as criaturas e planeswalkers'
          : 'todas as criaturas';

        return `${amt} dano a ${targetDesc}.`;
      }

      case 'damage_divided': {
        // Divided damage to creatures and/or planeswalkers
        const amount = resolveAmt(effect.amount);
        if (amount <= 0) return null;

        const targets = [];

        // Get all valid targets (creatures and planeswalkers opponents control)
        for (const pid of [0, 1]) {
          if (pid === controllerId) continue; // Skip own creatures
          const bf = state.players[pid].zones.battlefield;
          const validTargets = bf.cards.filter(c =>
            CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c)
          );
          validTargets.forEach(t => targets.push({ card: t, playerId: pid }));
        }

        if (targets.length === 0) {
          return `Nenhum alvo válido para ${amount} de dano.`;
        }

        // AI logic: prioritize destroying high-value targets
        targets.sort((a, b) => {
          const aValue = CardEngine.isCreature(a.card) ? CardEngine.getPower(a.card) : (a.card.loyalty || 0);
          const bValue = CardEngine.isCreature(b.card) ? CardEngine.getPower(b.card) : (b.card.loyalty || 0);
          return bValue - aValue;
        });

        // Distribute damage (prioritize lethal damage)
        let remainingDamage = amount;
        const results = [];

        for (const target of targets) {
          if (remainingDamage <= 0) break;

          let damageDealt = 0;
          if (CardEngine.isCreature(target.card)) {
            const toughness = CardEngine.getToughness(target.card);
            const currentDamage = target.card._damage || 0;
            const lethalDamage = Math.max(1, toughness - currentDamage);
            damageDealt = Math.min(remainingDamage, lethalDamage);

            target.card._damage = (target.card._damage || 0) + damageDealt;
            target.card._damagedThisTurn = true;

            if (target.card._damage >= toughness) {
              const dying = this.creatureDies(state, target.card, target.playerId);
              if (dying) results.push(`${target.card.name} morre`);
            }
          } else if (CardEngine.isPlaneswalker(target.card)) {
            damageDealt = Math.min(remainingDamage, target.card.loyalty || 0);
            this.damagePlaneswalker(state, target.card, damageDealt, controllerId);
          }

          if (damageDealt > 0) {
            results.push(`${damageDealt} para ${target.card.name}`);
            remainingDamage -= damageDealt;
          }
        }

        return results.length > 0 ?
          `Distribui ${amount} de dano: ${results.join(', ')}.` :
          `${amount} de dano não pode ser distribuído.`;
      }

      case 'untap_all': {
        const bf = state.players[controllerId].zones.battlefield;
        let targets = bf.cards;

        // Apply target filter
        if (effect.target === 'own_creatures') {
          targets = bf.cards.filter(c => CardEngine.isCreature(c));
        } else if (effect.target === 'lands') {
          targets = bf.cards.filter(c => CardEngine.isLand(c));
        }

        targets.forEach(c => { c._tapped = false; });

        if (effect.target === 'own_creatures') {
          return 'Desvirou todas as suas criaturas.';
        } else if (effect.target === 'lands') {
          return 'Desvirou todos os terrenos.';
        }
        return 'Desvirou todos os permanentes.';
      }
      case 'conditional_discard_return': {
        // "You may discard a card. When you do, return target creature or land card from your graveyard to your hand."
        const hand = state.players[controllerId].zones.hand;
        const gy = state.players[controllerId].zones.graveyard;

        if (hand.count() === 0) {
          return "Nao ha cartas na mao para descartar.";
        }

        // For human player: interactive choice
        if (state.players[controllerId].isHuman && controllerId === 0) {
          const returnCards = gy.getAll().filter(c => CardEngine.isCreature(c) || CardEngine.isLand(c));

          // Set up interactive choice
          state._pendingOptionalDiscard = {
            controller: controllerId,
            amount: 1,
            returnFromGY: true,
            returnCards: returnCards,
            returnTarget: effect.target || 'creature_or_land'
          };
          state.waitingForInput = { type: 'optional_discard_choice', playerId: controllerId };
          return null; // Pause for human choice
        } else {
          // AI logic: discard if worth it
          const returnCards = gy.getAll().filter(c => CardEngine.isCreature(c) || CardEngine.isLand(c));
          if (returnCards.length > 0 && hand.count() > 3) {
            returnCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
            const wouldReturn = returnCards[0];

            // Discard worst card from hand
            const handCards = hand.getAll();
            handCards.sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
            const discarded = handCards[0];

            // Only discard if what we return is better than what we discard
            if ((wouldReturn.cmc || 0) > (discarded.cmc || 0)) {
              hand.remove(discarded._uid);
              gy.add(discarded);
              gy.remove(wouldReturn._uid);
              hand.add(wouldReturn);
              return `Descarta ${discarded.name}, retorna ${wouldReturn.name} do cemiterio.`;
            }
          }
          return "IA opta por nao descartar.";
        }
      }
      case 'register_temp_trigger': {
        // Register a temporary trigger that lasts only this turn
        if (!state._tempTriggers) state._tempTriggers = [];
        const tempTrigger = {
          cardUid: data.cardUid,
          controllerId: controllerId,
          event: effect.event,
          effects: effect.effects,
          duration: effect.duration || 'this_turn',
          _tempId: Date.now() + Math.random()
        };
        state._tempTriggers.push(tempTrigger);
        return `Trigger temporario registrado para ${effect.event}.`;
      }
      case 'discard_hand': {
        const targetPid = effect.target === 'self' ? controllerId : opponentId;
        const hand = state.players[targetPid].zones.hand;
        const cards = hand.getAll();
        cards.forEach(c => {
          hand.remove(c._uid);
          state.players[targetPid].zones.graveyard.add(c);
        });
        return `Descartou toda a mao (${cards.length} cartas).`;
      }
      case 'reveal_hand': {
        const tPid = effect.target === 'opponent' ? opponentId : controllerId;
        const cards = state.players[tPid].zones.hand.getAll();
        return cards.length > 0 ? `Mao revelada: ${cards.map(c => c.name).join(', ')}.` : 'Mao vazia.';
      }
      case 'exile_graveyard': {
        const egAmt = effect.amount || 999;
        const egPid = effect.target === 'opponent' ? opponentId : controllerId;
        const egGy = state.players[egPid].zones.graveyard;
        const egExile = state.players[egPid].zones.exile;
        const egCards = egGy.getAll().slice(0, egAmt);
        egCards.forEach(c => {
          egGy.remove(c._uid); egExile.add(c);
          // Fire trigger when card leaves graveyard
          this.fireTrigger(state, 'card_leaves_graveyard', { playerId: egPid, card: c });
          if (!state._cardLeftGraveyardThisTurn) state._cardLeftGraveyardThisTurn = {};
          state._cardLeftGraveyardThisTurn[controllerId] = true;
        });
        if (egCards.length > 0) state._exiledThisResolution = true;
        return egCards.length > 0 ? `${egCards.length} carta(s) exilada(s) do cemiterio.` : null;
      }
      case 'exile_from_graveyard': {
        const efgPid = effect.target === 'opponent' ? opponentId : controllerId;
        const efgGy = state.players[efgPid].zones.graveyard;
        const efgAmt = resolveAmt(effect.amount) || 1;
        const efgCards = efgGy.getAll();
        if (efgCards.length > 0) {
          efgCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const exiled = [];
          for (let efgI = 0; efgI < efgAmt && efgI < efgCards.length; efgI++) {
            const picked = efgCards[efgI];
            efgGy.remove(picked._uid);
            // Fire trigger when card leaves graveyard
            this.fireTrigger(state, 'card_leaves_graveyard', { playerId: efgPid, card: picked });
            state.players[efgPid].zones.exile.add(picked);
            exiled.push(picked.name);
          }
          return `${exiled.join(', ')} exilado(s) do cemiterio.`;
        }
        return null;
      }
      case 'exile_top': {
        const etLib = state.players[controllerId].zones.library;
        const topC = etLib.drawFromTop();
        if (topC) {
          state.players[controllerId].zones.exile.add(topC);
          return `${topC.name} exilado do topo.`;
        }
        return null;
      }
      case 'double_counters': {
        // Use targets if available (for "same" target effects), otherwise fallback to cardUid
        const targetUid = (data.targets && data.targets.length > 0)
          ? data.targets[0].uid
          : data.cardUid;
        const targetPid = (data.targets && data.targets.length > 0)
          ? data.targets[0].player
          : controllerId;

        const dcCard = state.players[targetPid].zones.battlefield.get(targetUid);
        if (dcCard && dcCard._counters && dcCard._counters['+1/+1'] > 0) {
          const old = dcCard._counters['+1/+1'];
          dcCard._counters['+1/+1'] = old * 2;
          return `${dcCard.name}: Contadores +1/+1 dobrados (${old} → ${old * 2}).`;
        }
        return null;
      }
      case 'bounce_to_library_top': {
        const enemies = state.players[opponentId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        if (enemies.length > 0) {
          enemies.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = enemies[0];
          state.players[opponentId].zones.battlefield.remove(target._uid);
          this._unregisterCardTriggers(state, target._uid);
          state.players[opponentId].zones.library.addToTop(target);
          return `${target.name} colocado no topo da biblioteca.`;
        }
        return null;
      }
      case 'return_land_from_mill': {
        const gy = state.players[controllerId].zones.graveyard;
        const lands = gy.getAll().filter(c => CardEngine.isLand(c));
        if (lands.length > 0) {
          const land = lands[lands.length - 1];
          gy.remove(land._uid);
          state.players[controllerId].zones.hand.add(land);
          return `${land.name} volta do cemiterio para a mao.`;
        }
        return null;
      }
      case 'regenerate': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) { card._regenerateShield = true; return `${card.name} ganha regeneracao.`; }
        return null;
      }
      case 'counter_self_if_no_draw': {
        if (!state._drewExtraThisTurn || !state._drewExtraThisTurn[controllerId]) {
          const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
          if (card) {
            if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
            card._counters[effect.counter || '+1/+1'] += 1;
            return `+1 contador ${effect.counter || '+1/+1'} (nenhuma carta comprada extra).`;
          }
        }
        return null;
      }
      case 'trade_route_envoy_ability': {
        // Trade Route Envoy: "draw a card if you control a creature with a counter on it. If you don't draw a card this way, put a +1/+1 counter on this creature"
        const bf = state.players[controllerId].zones.battlefield;
        const hasCounterCreature = bf.cards.some(c =>
          CardEngine.isCreature(c) && c._counters &&
          Object.values(c._counters).some(count => count > 0)
        );

        if (hasCounterCreature) {
          // Draw a card
          const drawn = state.players[controllerId].zones.library.drawFromTop();
          if (drawn) {
            state.players[controllerId].zones.hand.add(drawn);
            return `Compra ${drawn.name} (controla criatura com marcador).`;
          } else {
            return `Biblioteca vazia.`;
          }
        } else {
          // Put +1/+1 counter on this creature
          const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
          if (card) {
            if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
            card._counters['+1/+1'] += 1;
            return `${card.name} recebe +1/+1 counter (nenhuma criatura com marcador).`;
          }
        }
        return null;
      }
      case 'remove_counters': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card && card._counters) {
          const cType = effect.counter || '+1/+1';
          const amt = effect.amount || (card._counters[cType] || 0);
          card._counters[cType] = Math.max(0, (card._counters[cType] || 0) - amt);
          return `Remove ${amt} contador(es) ${cType}.`;
        }
        return null;
      }
      case 'grant': {
        const kw = effect.keyword;
        if (!kw) return null;
        const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
        let grantTarget = null;

        // Handle "same" target - use targets from calling context (graveyard abilities)
        if (effect.target === 'same' && data && data.targets && data.targets.length > 0) {
          const target = data.targets[0];
          grantTarget = state.players[target.player].zones.battlefield.get(target.uid);
        }
        // Handle specific target types for activated abilities
        else if (effect.target && effect.target !== 'self') {
          const myBf = state.players[controllerId].zones.battlefield.cards;
          let candidates = [];
          if (effect.target === 'own_creature_power2') {
            candidates = myBf.filter(c => CardEngine.isCreature(c) && CardEngine.getPower(c) <= 2 && c._uid !== data.cardUid);
          } else if (effect.target === 'own_creature_power4') {
            candidates = myBf.filter(c => CardEngine.isCreature(c) && CardEngine.getPower(c) >= 4 && c._uid !== data.cardUid);
          } else if (effect.target === 'own_creature' || effect.target === 'creature') {
            candidates = myBf.filter(c => CardEngine.isCreature(c) && c._uid !== data.cardUid);
          } else if (effect.target === 'other_own_creature') {
            candidates = myBf.filter(c => CardEngine.isCreature(c) && c._uid !== data.cardUid);
          } else if (effect.target === 'attacking_creature' && data.cardUid) {
            // Target the attacking creature that triggered this
            const attackingCard = myBf.find(c => c._uid === data.cardUid && c._attacking);
            if (attackingCard) candidates = [attackingCard];
          }
          if (candidates.length > 0) {
            // AI: pick strongest creature
            if (!state.players[controllerId].isHuman) {
              candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
              grantTarget = candidates[0];
            } else {
              // Human: pick strongest for now (auto-target best candidate)
              // If only one candidate, auto-select
              if (candidates.length === 1) {
                grantTarget = candidates[0];
              } else {
                // Pick the one with highest power among valid targets
                candidates.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
                grantTarget = candidates[0];
              }
            }
          }
          if (!grantTarget) return `Nenhuma criatura valida como alvo.`;
        } else {
          // Default: grant to self
          grantTarget = state.players[controllerId].zones.battlefield.get(data.cardUid);
        }

        if (grantTarget) {
          if (!grantTarget.keywords) grantTarget.keywords = [];
          if (!grantTarget.keywords.includes(kwCap)) grantTarget.keywords.push(kwCap);
          if (!grantTarget._tempKeywords) grantTarget._tempKeywords = [];

          // Support for different durations (end_of_turn, next_turn)
          const duration = effect.duration || 'end_of_turn';
          grantTarget._tempKeywords.push({
            keyword: kwCap,
            appliedTurn: state.turn,
            duration: duration
          });

          if (kwCap === 'Haste') grantTarget._summoningSick = false;
          return `${grantTarget.name} ganha ${kwCap}.`;
        }
        return null;
      }
      case 'grant_all': {
        const kw = effect.keyword;
        if (!kw) return null;
        const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        creatures.forEach(c => {
          if (!c.keywords) c.keywords = [];
          if (!c.keywords.includes(kwCap)) c.keywords.push(kwCap);
          if (!c._tempKeywords) c._tempKeywords = [];

          // Support for different durations (end_of_turn, next_turn)
          const duration = effect.duration || 'end_of_turn';
          c._tempKeywords.push({
            keyword: kwCap,
            appliedTurn: state.turn,
            duration: duration
          });

          if (kwCap === 'Haste') c._summoningSick = false;
        });
        return `Todas as criaturas ganham ${kwCap}.`;
      }
      case 'grant_counter':
      case 'grant_counters': {
        // Get target from data parameter (for targeted abilities)
        let target = null;
        if (data && data.targets && data.targets.length > 0) {
          // Use provided target
          const targetInfo = data.targets[0];
          if (targetInfo.player !== undefined && targetInfo.uid) {
            target = state.players[targetInfo.player].zones.battlefield.get(targetInfo.uid);
          }
        } else {
          // Fallback: use strongest own creature (for non-targeted context)
          const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          if (creatures.length > 0) {
            creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            target = creatures[0];
          }
        }

        if (target && CardEngine.isCreature(target)) {
          if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
          const amt = effect.amount || 1;
          const cType = effect.counter || '+1/+1';
          target._counters[cType] = (target._counters[cType] || 0) + amt;

          // Fire counter_placed trigger
          this.fireTrigger(state, 'counter_placed', { cardUid: target._uid, counter: cType, amount: amt });

          return `${target.name} recebe ${amt} contador(es) ${cType}.`;
        }
        return null;
      }
      case 'exile_top_choose': {
        // New system: exile multiple cards and let player choose which to play
        const lib = state.players[controllerId].zones.library;
        const amount = effect.amount || 2;
        const choose = effect.choose || 1;
        const duration = effect.duration || 'end_of_turn';

        if (lib.count() < amount) return 'Biblioteca insuficiente.';

        const exiledCards = [];
        for (let i = 0; i < amount; i++) {
          const card = lib.drawFromTop();
          if (card) {
            exiledCards.push(card);
            state.players[controllerId].zones.exile.add(card);
          }
        }

        if (exiledCards.length === 0) return 'Nenhuma carta exilada.';

        // For human players: interactive choice
        if (state.players[controllerId].isHuman && choose < amount) {
          state._pendingExileChoice = {
            cards: exiledCards,
            choose: choose,
            duration: duration,
            controllerId: controllerId
          };
          state.waitingForInput = { type: 'exile_choose', playerId: controllerId };
          return `Exile ${amount} cartas do topo. Escolha ${choose} para jogar.`;
        }

        // For AI or when choose == amount: pick automatically
        const chosenCards = choose >= amount ? exiledCards :
          exiledCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0)).slice(0, choose);

        if (!state._exiledPlayable) state._exiledPlayable = {};

        chosenCards.forEach(card => {
          state._exiledPlayable[card._uid] = {
            card: card,
            controller: controllerId,
            turn: state.turn,
            duration: duration,
            freeCast: effect.free_cast || false
          };
        });

        return `Exile ${amount} cartas. ${choose} disponível(is) para jogar${duration === 'next_turn' ? ' até end of next turn' : ''}.`;
      }

      case 'exile_top_play': {
        const lib = state.players[controllerId].zones.library;
        const amount = effect.amount || 1;
        const results = [];

        for (let i = 0; i < amount; i++) {
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
            const candidates = lib.cards.filter(filter);
            if (candidates.length > 0) {
              // Pick first matching card (or random if from graveyard)
              cardFound = effect.random ? candidates[Math.floor(Math.random() * candidates.length)] : candidates[0];
              const idx = lib.cards.indexOf(cardFound);
              if (idx !== -1) lib.cards.splice(idx, 1);
            }
          } else {
            // No condition, just take from top
            cardFound = lib.drawFromTop();

            // Apply max_mv filter if specified for top card
            if (cardFound && effect.max_mv && (cardFound.cmc || 0) > effect.max_mv) {
              // Put card back and don't exile it
              lib.cards.unshift(cardFound);
              cardFound = null;
            }
          }

          if (cardFound) {
            state.players[controllerId].zones.exile.add(cardFound);
            if (!state._exiledPlayable) state._exiledPlayable = {};

            // Store exile info with free_cast flag
            state._exiledPlayable[cardFound._uid] = {
              card: cardFound,
              controller: controllerId,
              turn: state.turn,
              freeCast: effect.free_cast || false
            };

            // Track exiled card under source permanent for visual display
            if (data && data.cardUid) {
              const srcCard = state.players[controllerId].zones.battlefield.get(data.cardUid);
              if (srcCard) {
                if (!srcCard._exiledCards) srcCard._exiledCards = [];
                srcCard._exiledCards.push({ name: cardFound.name, image_uris: cardFound.image_uris, image_small: cardFound.image_small, _uid: cardFound._uid });
              }
            }

            const playableText = effect.free_cast ? " (pode jogar de graça neste turno)" : " (pode jogar neste turno)";
            results.push(`${cardFound.name} exilado${playableText}.`);
          } else if (effect.condition) {
            results.push("Nenhuma carta válida encontrada na biblioteca.");
          }
        }

        return results.length > 0 ? results.join(' ') : null;
      }
      case 'search_library': {
        // Determine who searches their library (default: controller, but can be opponent)
        const opponentId = 1 - controllerId;
        const searchPlayerId = effect.controller === 'opponent' ? opponentId : controllerId;
        const lib = state.players[searchPlayerId].zones.library;
        let filter = () => true;
        if (effect.target === 'named_card') {
          if (effect.name) {
            filter = c => c.name === effect.name;
          } else if (effect.names && effect.names.length > 0) {
            filter = c => effect.names.includes(c.name);
          }
        }
        else if (effect.target === 'creature') filter = c => CardEngine.isCreature(c);
        else if (effect.target === 'land' || effect.target === 'basic_land') filter = c => CardEngine.isLand(c);
        const candidates = lib.cards.filter(filter);
        if (candidates.length > 0) {
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));

          // Allow player choice if requested
          let picked = candidates[0];
          if (effect.allow_choice && candidates.length > 1 && state.players[searchPlayerId].isHuman) {
            state._pendingSearchChoice = { candidates, controllerId: searchPlayerId, cardUid: data.cardUid, effect };
            state.waitingForInput = { type: 'search_library_choice', playerId: searchPlayerId };
            return null;
          } else if (effect.allow_choice && candidates.length > 1) {
            // AI picks the best card for their strategy (highest CMC)
            picked = candidates[0];
          }

          const idx = lib.cards.indexOf(picked);
          if (idx !== -1) lib.cards.splice(idx, 1);

          // Check if should put onto battlefield instead of hand
          if (effect.to_battlefield) {
            const bf = state.players[searchPlayerId].zones.battlefield;
            const bfCard = CardEngine.prepareForBattlefield(picked);
            bfCard._ownerId = searchPlayerId;
            if (effect.tapped) bfCard._tapped = true;

            // Add stun counter if specified
            if (effect.stun_counter) {
              if (!bfCard._stunCounters) bfCard._stunCounters = 0;
              bfCard._stunCounters += (effect.stun_counter || 1);
            }

            bf.add(bfCard);
            lib.shuffle();
            return `Busca ${picked.name} e coloca no campo${effect.tapped ? ' virado' : ''}${effect.stun_counter ? ' com stun counter' : ''}.`;
          } else {
            state.players[searchPlayerId].zones.hand.add(picked);
            lib.shuffle();
            return `Busca ${picked.name} da biblioteca.`;
          }
        }
        lib.shuffle();
        return 'Nenhuma carta encontrada.';
      }
      case 'search_library_to_graveyard': {
        const lib = state.players[controllerId].zones.library;
        const candidates = lib.cards.filter(c => !CardEngine.isLand(c));
        if (candidates.length > 0) {
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const picked = candidates[0];
          const idx = lib.cards.indexOf(picked);
          if (idx !== -1) lib.cards.splice(idx, 1);
          state.players[controllerId].zones.graveyard.add(picked);
          lib.shuffle();
          return `Busca ${picked.name} para o cemiterio.`;
        }
        lib.shuffle();
        return null;
      }
      case 'create_token_copy':
      case 'clone':
      case 'copy_self': {
        let source = null;
        if (effect.type === 'copy_self') {
          source = state.players[controllerId].zones.battlefield.get(data.cardUid);
        } else if (effect.target === 'exiled_creature' && data.cardUid) {
          // Find creatures exiled by this card
          const exiledByThisCard = state._permanentExiles && state._permanentExiles[data.cardUid] ?
            state._permanentExiles[data.cardUid] : [];
          const exiledCreatures = exiledByThisCard.filter(e => CardEngine.isCreature(e.exiledCard));
          if (exiledCreatures.length > 0) {
            // Use the most recently exiled creature
            source = exiledCreatures[exiledCreatures.length - 1].exiledCard;
          }
        } else {
          const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          if (creatures.length > 0) {
            creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            source = creatures[0];
          }
        }
        if (source) {
          // Support for "for each opponent" - create multiple tokens
          const createCount = effect.for_each_opponent ?
            state.players.filter((p, pid) => pid !== controllerId).length : 1;
          const results = [];

          for (let i = 0; i < createCount; i++) {
            const token = CardEngine.createToken(controllerId, source.power || 1, source.toughness || 1, source.name);
            if (source.keywords) token.keywords = [...source.keywords];
            token.type_line = source.type_line;

            // Support for tapped and attacking tokens
            if (effect.tapped) token._tapped = true;
            if (effect.attacking) {
              token._attacking = true;
              // Add to attacking creatures list if in combat
              if (state.phase === 'combat_damage' || state.phase === 'combat_end' || state.combatData) {
                if (!state.combatData) state.combatData = { attackers: [], blockers: {} };
                if (!state.combatData.attackers) state.combatData.attackers = [];
                state.combatData.attackers.push({ cardUid: token._uid, playerId: controllerId });
              }
            }

            // Support for sacrifice at end step
            if (effect.sacrificeAtEndStep) {
              token._sacrificeAtEndStep = true;
            }

            state.players[controllerId].zones.battlefield.add(token);
            results.push(token.name);
          }

          const tokenDesc = createCount > 1 ?
            `Cria ${createCount} copias de ${source.name}` :
            `Cria copia de ${source.name}`;

          return `${tokenDesc}${effect.tapped ? ' viradas' : ''}${effect.attacking ? ' atacando' : ''}${effect.sacrificeAtEndStep ? ' (sacrificadas no end step)' : ''}.`;
        }
        return null;
      }
      case 'gain_control': {
        // For triggers: steal opponent's best creature
        const enemies = state.players[opponentId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        if (enemies.length > 0) {
          enemies.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = enemies[0];
          state.players[opponentId].zones.battlefield.remove(target._uid);
          this._unregisterCardTriggers(state, target._uid);
          target._originalOwner = opponentId;
          state.players[controllerId].zones.battlefield.add(target);
          this._registerCardTriggers(state, target, controllerId);
          return `Ganha controle de ${target.name}!`;
        }
        return null;
      }
      case 'anthem': {
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        creatures.forEach(c => {
          c._powerMod = (c._powerMod || 0) + (effect.power || 0);
          c._toughnessMod = (c._toughnessMod || 0) + (effect.toughness || 0);
          // Grant keywords from anthem
          if (effect.keywords && effect.keywords.length > 0) {
            if (!c.keywords) c.keywords = [];
            effect.keywords.forEach(kw => {
              if (!c.keywords.includes(kw)) c.keywords.push(kw);
            });
          }
        });
        const keywordText = effect.keywords && effect.keywords.length > 0 ? ` + ${effect.keywords.join(', ')}` : '';
        return `Anthem: +${effect.power || 0}/+${effect.toughness || 0}${keywordText} para todas as criaturas.`;
      }
      case 'move_counters': {
        const source = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (source && source._counters && source._counters['+1/+1'] > 0) {
          const creatures = state.players[controllerId].zones.battlefield.cards
            .filter(c => CardEngine.isCreature(c) && c._uid !== data.cardUid);
          if (creatures.length > 0) {
            creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
            const dest = creatures[0];
            const amt = source._counters['+1/+1'];
            source._counters['+1/+1'] = 0;
            if (!dest._counters) dest._counters = { '+1/+1': 0, '-1/-1': 0 };
            dest._counters['+1/+1'] += amt;
            return `Move ${amt} contador(es) +1/+1 para ${dest.name}.`;
          }
        }
        return null;
      }
      case 'distribute_counters': {
        // AI: stack on strongest creature
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        if (creatures.length > 0) {
          creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = creatures[0];
          if (!target._counters) target._counters = { '+1/+1': 0, '-1/-1': 0 };
          const amt = effect.amount || 1;
          target._counters[effect.counter || '+1/+1'] = (target._counters[effect.counter || '+1/+1'] || 0) + amt;
          return `${target.name} recebe ${amt} contador(es).`;
        }
        return null;
      }
      case 'become_creature':
      case 'become_dragon': {
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        if (card) {
          card._becomeCreature = true;
          card._becomePower = effect.power || 3;
          card._becomeToughness = effect.toughness || 3;
          if (!card.power) card.power = effect.power || 3;
          if (!card.toughness) card.toughness = effect.toughness || 3;

          // Grant keyword if specified (e.g., "flying" for dragon transformation)
          if (effect.keyword) {
            if (!card._tempKeywords) card._tempKeywords = [];
            // Check if keyword is already granted to avoid duplicates
            const hasKeyword = card._tempKeywords.some(k =>
              typeof k === 'string' ? k === effect.keyword : k.keyword === effect.keyword
            );
            if (!hasKeyword) {
              card._tempKeywords.push({
                keyword: effect.keyword,
                appliedTurn: state.turn,
                duration: 'permanent' // Dragon transformation is permanent
              });
            }
          }

          return `${card.name} se torna criatura Dragon${effect.keyword ? ` com ${effect.keyword}` : ''}.`;
        }
        return null;
      }
      case 'attach': {
        // Auto-attach to strongest creature
        const card = state.players[controllerId].zones.battlefield.get(data.cardUid);
        const creatures = state.players[controllerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
        if (card && creatures.length > 0) {
          creatures.sort((a, b) => CardEngine.getPower(b) - CardEngine.getPower(a));
          const target = creatures[0];
          card._attachedTo = target._uid;
          if (!target._attachments) target._attachments = [];
          target._attachments.push(card._uid);
          return `${card.name} anexado a ${target.name}.`;
        }
        return null;
      }
      case 'exile_top_opponent': {
        const lib = state.players[opponentId].zones.library;
        let amount = 1;

        // Resolve dynamic amount (e.g., "X" = damage dealt from combat_damage_player trigger)
        if (effect.amount === "X" && data && data.amount) {
          amount = data.amount;
        } else if (typeof effect.amount === 'number') {
          amount = effect.amount;
        } else if (effect.amount) {
          amount = resolveAmt(effect.amount) || 1;
        }

        const exiled = [];
        for (let i = 0; i < amount; i++) {
          const topC = lib.drawFromTop();
          if (topC) {
            state.players[opponentId].zones.exile.add(topC);
            exiled.push(topC.name);
          }
        }

        if (exiled.length > 0) {
          return `${exiled.join(', ')} exilado(s) do topo do oponente (${exiled.length} cartas).`;
        }
        return null;
      }
      case 'copy_spell':
      case 'copy_next_spell': {
        if (!state._pendingSpellCopy) state._pendingSpellCopy = {};
        state._pendingSpellCopy[controllerId] = true;
        return 'Proxima magia sera copiada!';
      }
      case 'extra_combat': {
        state._extraCombat = true;
        return 'Fase de combate adicional!';
      }
      case 'exile_graveyard_cast_copy': {
        const gy = state.players[controllerId].zones.graveyard;
        let candidates = gy.getAll().filter(c => !CardEngine.isLand(c));
        if (effect.target === 'nonland_mv3_or_less') {
          candidates = candidates.filter(c => (c.cmc || 0) <= 3);
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
          const picked = candidates[0];
          gy.remove(picked._uid);
          state.players[controllerId].zones.exile.add(picked);
          // Resolve copy effects
          const copyEffects = CardEngine.getSpellEffects(picked);
          if (copyEffects.length > 0) {
            for (const e of copyEffects) {
              const elog = this._resolveSimpleEffect(state, controllerId, e, data);
              if (elog) state.log.push(elog);
            }
          }
          return `Exila ${picked.name} do cemiterio e joga copia de graca!`;
        }
        return null;
      }
      case 'behold_dragon': {
        // Behold a Dragon from hand (reveal and set as beheld)
        const hand = state.players[controllerId].zones.hand;
        const dragonCards = hand.getAll().filter(c => CardEngine.hasCreatureType(c, 'Dragon'));

        if (dragonCards.length === 0) {
          // Optional behold: no dragons, just skip
          return `Nenhum Dragon na mao para behold.`;
        }

        // For human player: show UI choice modal with optional decline
        if (state.players[controllerId].isHuman) {
          if (dragonCards.length > 1) {
            // Set up pending behold choice with multiple options
            if (!state._pendingBeholdChoice) state._pendingBeholdChoice = {};
            state._pendingBeholdChoice.cards = dragonCards;
            state._pendingBeholdChoice.isOptional = effect.optional === true;
            state._pendingBeholdChoice.source = 'etb';
            state.waitingForInput = { type: 'behold_choice_multiple', playerId: controllerId };
            return null; // Will continue after UI resolves
          } else {
            // Single dragon - show choice modal if optional
            if (effect.optional === true) {
              if (!state._pendingBeholdChoice) state._pendingBeholdChoice = {};
              state._pendingBeholdChoice.cards = dragonCards;
              state._pendingBeholdChoice.isOptional = true;
              state._pendingBeholdChoice.source = 'etb';
              state.waitingForInput = { type: 'behold_choice_multiple', playerId: controllerId };
              return null; // Will continue after UI resolves
            } else {
              // Mandatory single - auto-pick
              state._beholding[controllerId] = dragonCards[0];
              return `${dragonCards[0].name} revelado (behold Dragon).`;
            }
          }
        }

        // For AI: pick strongest Dragon (highest CMC) or decline if optional
        dragonCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        const pickedDragon = dragonCards[0];
        // AI only beholds if valuable enough or mandatory
        if (effect.optional === true && pickedDragon.cmc <= 3) {
          // Skip behold for low-value dragons
          return `Declinou behold (dragao insuficiente).`;
        }
        state._beholding[controllerId] = pickedDragon;
        return `${pickedDragon.name} revelado (behold Dragon).`;
      }
      case 'exile_with_suspend': {
        // Suspend mechanic: exile with time counters, reduce each upkeep, cast for free when 0
        const suspendCounters = effect.counters || 3;

        // For triggered abilities, exile the spell that triggered this
        if (data && data.lastSpell) {
          const spellCard = data.lastSpell;
          const exile = state.players[controllerId].zones.exile;

          // Add the spell to exile with suspend counters
          spellCard._timeCounters = suspendCounters;
          spellCard._suspended = true;
          spellCard._suspendController = controllerId;
          exile.add(spellCard);

          // Track suspended spells for upkeep processing
          if (!state._suspendedSpells) state._suspendedSpells = {};
          if (!state._suspendedSpells[controllerId]) state._suspendedSpells[controllerId] = [];
          state._suspendedSpells[controllerId].push({
            uid: spellCard._uid,
            timeCounters: suspendCounters,
            originalCard: spellCard
          });

          return `${spellCard.name} exilada com suspend ${suspendCounters}.`;
        }

        return `Efeito suspend (sem carta target).`;
      }
      default:
        return null;
    }
  },

  // Process suspended spells during upkeep (reduce time counters, cast when 0)
  _processSuspendedSpells(state, playerId) {
    const logs = [];

    if (!state._suspendedSpells || !state._suspendedSpells[playerId]) {
      return logs;
    }

    const suspendedList = state._suspendedSpells[playerId];
    const exile = state.players[playerId].zones.exile;

    for (let i = suspendedList.length - 1; i >= 0; i--) {
      const suspended = suspendedList[i];
      const exiledCard = exile.get(suspended.uid);

      if (!exiledCard || !exiledCard._suspended) {
        // Card no longer in exile or no longer suspended, remove from tracking
        suspendedList.splice(i, 1);
        continue;
      }

      // Reduce time counter
      exiledCard._timeCounters = Math.max(0, (exiledCard._timeCounters || 0) - 1);
      suspended.timeCounters = exiledCard._timeCounters;

      logs.push(`${exiledCard.name}: ${exiledCard._timeCounters} contadores restantes.`);

      // If time counters reach 0, cast the spell for free
      if (exiledCard._timeCounters <= 0) {
        exile.remove(suspended.uid);
        suspendedList.splice(i, 1);

        // Clean up suspend data
        delete exiledCard._suspended;
        delete exiledCard._timeCounters;
        delete exiledCard._suspendController;

        // Cast the spell for free (without paying mana cost)
        logs.push(`${exiledCard.name} suspension termina - jogando de graca!`);

        // Cast the spell immediately
        try {
          this.castSpell(state, playerId, exiledCard, [], [], [], false);
        } catch (error) {
          logs.push(`Erro ao jogar ${exiledCard.name} de suspend: ${error.message}`);
        }
      }
    }

    return logs;
  },

  // Blight X: put X -1/-1 counters on a creature you control
  // For AI: auto-pick weakest creature. For human: if called from trigger, auto-pick weakest too.
  _performBlight(state, playerId, amount) {
    const creatures = state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
    if (creatures.length === 0) return null;

    // Pick weakest creature (lowest toughness remaining)
    const target = creatures.sort((a, b) => {
      const aTough = CardEngine.getToughness(a) - a._damage;
      const bTough = CardEngine.getToughness(b) - b._damage;
      return aTough - bTough;
    })[0];

    if (!target._counters) target._counters = {};
    target._counters['-1/-1'] = (target._counters['-1/-1'] || 0) + amount;
    const label = playerId === 0 ? 'Voce coloca' : 'Oponente coloca';
    const log = `${label} ${amount} contador(es) -1/-1 em ${target.name}. (Blight)`;

    // Check if creature dies from -1/-1 counters
    if (CardEngine.getToughness(target) <= 0) {
      this.creatureDies(state, target, playerId);
      return log + ` ${target.name} morre.`;
    }
    return log;
  },

  // Blight for human with interactive selection (returns pending state)
  _setupBlightChoice(state, playerId, amount, callback) {
    const creatures = state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
    if (creatures.length === 0) {
      if (callback) callback();
      return false;
    }
    if (creatures.length === 1 || !state.players[playerId].isHuman) {
      // Only one creature or AI: auto-pick
      this._performBlight(state, playerId, amount);
      if (callback) callback();
      return true;
    }
    // Human with multiple creatures: need choice overlay
    state._pendingBlight = { playerId, amount, callback };
    state.waitingForInput = { type: 'blight_choice', playerId, amount };
    return true;
  },

  // Setup choice overlay for exiling from revealed hand (Aggressive Negotiations)
  _setupHandExileChoice(state, controllerId, targetPlayerId, nonlandCards, callback) {
    // Safety check: ensure nonlandCards is array and not empty
    if (!Array.isArray(nonlandCards) || nonlandCards.length === 0) {
      state.log.push('Nenhuma carta nao-terreno disponivel para exilar.');
      if (callback) callback();
      return false;
    }

    if (nonlandCards.length === 1) {
      // Only one card: auto-exile it
      const cardToExile = nonlandCards[0];
      const hand = state.players[targetPlayerId].zones.hand;

      // Double-check card still exists in hand (safety)
      if (!hand.get(cardToExile._uid)) {
        state.log.push('Carta ja nao esta na mao.');
        if (callback) callback();
        return false;
      }

      hand.remove(cardToExile._uid);
      state.players[targetPlayerId].zones.exile.add(cardToExile);
      state.log.push(`${cardToExile.name} e exilado da mao.`);
      if (callback) callback();
      return true;
    }

    // Multiple cards: need human choice
    state._pendingHandExile = { controllerId, targetPlayerId, cards: nonlandCards, callback };
    state.waitingForInput = { type: 'hand_exile_choice', controllerId, cards: nonlandCards };
    return true;
  },

  // Called when human picks a card to exile from revealed hand
  resolveHandExileChoice(state, cardUid) {
    if (!state._pendingHandExile) {
      console.warn('resolveHandExileChoice called but no pending hand exile');
      return;
    }

    const { controllerId, targetPlayerId, cards, callback } = state._pendingHandExile;
    const chosenCard = cards.find(c => c._uid === cardUid);

    if (!chosenCard) {
      console.warn('resolveHandExileChoice: invalid card choice', cardUid);
      return; // Invalid choice
    }

    const hand = state.players[targetPlayerId].zones.hand;

    // Safety check: ensure card still exists in hand
    if (!hand.get(cardUid)) {
      state.log.push(`Carta ${chosenCard.name} ja nao esta na mao.`);
      // Cleanup and continue anyway
      state._pendingHandExile = null;
      state.waitingForInput = null;
      if (callback) callback();
      return;
    }

    hand.remove(cardUid);
    state.players[targetPlayerId].zones.exile.add(chosenCard);
    state.log.push(`${chosenCard.name} e exilado da mao.`);

    // Cleanup
    state._pendingHandExile = null;
    state.waitingForInput = null;

    if (callback) callback();
  },

  // Called when human picks a mana color from choose options
  resolveManaChoice(state, chosenColor) {
    if (!state._pendingManaChoice) return;
    const { colors, controllerId } = state._pendingManaChoice;
    if (!colors.includes(chosenColor)) return;
    state._pendingManaChoice = null;
    state.waitingForInput = null;
    state.manaPool[controllerId][chosenColor] = (state.manaPool[controllerId][chosenColor] || 0) + 1;
    state.log.push(`+{${chosenColor}} mana.`);

    // Restore main phase priority for human
    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';
    if (isMainPhase && state.activePlayer === controllerId && state.players[controllerId].isHuman) {
      state.waitingForInput = { type: 'main_phase', playerId: controllerId };
    }
  },

  // Called when human decides whether to pay "unless" cost for counter spell
  resolveUnlessPay(state, shouldPay) {
    if (!state._pendingUnlessPay) return;
    const { spell, cost, spellController, wasDragonBeheld } = state._pendingUnlessPay;
    const opponentId = spellController === 0 ? 1 : 0;

    state._pendingUnlessPay = null;
    state.waitingForInput = null;

    if (shouldPay) {
      // Opponent chose to pay - remove mana from pool
      const opponentPool = state.manaPool[opponentId];
      for (let i = 0; i < cost; i++) {
        for (const color of Object.keys(opponentPool)) {
          if (opponentPool[color] > 0) {
            opponentPool[color]--;
            break;
          }
        }
      }
      const costStr = wasDragonBeheld ? `{${cost}} (Dragon beheld)` : `{${cost}}`;
      state.log.push(`${spell.name} nao foi anulado (${opponentId === 0 ? 'Voce' : 'IA'} pagou ${costStr}).`);
    } else {
      // Opponent chose not to pay - spell is countered
      spell._countered = true;
      state.log.push(`${spell.name} foi anulado.`);
    }
  },

  // Called when human selects a creature for blight
  resolveEndureChoice(state, choice) {
    if (!state._pendingEndure) return;
    const { cardUid, amount, controllerId } = state._pendingEndure;
    state._pendingEndure = null;
    state.waitingForInput = null;

    if (choice === 'counters') {
      const card = state.players[controllerId].zones.battlefield.get(cardUid);
      if (card && CardEngine.isCreature(card)) {
        if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
        card._counters['+1/+1'] += amount;
        state.log.push(`${card.name} endure ${amount}: +${amount} counters +1/+1.`);
      }
    } else {
      // Create Spirit tokens
      for (let i = 0; i < amount; i++) {
        const token = CardEngine.createToken(controllerId, 1, 1, 'Spirit', []);
        state.players[controllerId].zones.battlefield.add(token);
      }
      state.log.push(`Endure ${amount}: cria ${amount} Spirit(s) 1/1.`);
    }

    // Process state-based actions after casting spell
    this._processStateBasedActions(state);

    // Restore main phase priority for human player
    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';
    if (isMainPhase && state.activePlayer === controllerId && state.players[controllerId].isHuman) {
      state.waitingForInput = { type: 'main_phase', playerId: controllerId };
    }

    if (typeof this._continueIfAI === 'function') this._continueIfAI(state);
  },

  resolveMillLandChoice(state, choice) {
    if (!state._pendingMillLandChoice) return;
    const { cardUid, milledLands, controller } = state._pendingMillLandChoice;
    state._pendingMillLandChoice = null;
    state.waitingForInput = null;

    if (choice === 'land' && milledLands.length > 0) {
      // Put first land into hand
      const landToTake = milledLands[0];
      state.players[controller].zones.graveyard.remove(landToTake._uid);
      state.players[controller].zones.hand.add(landToTake);
      state.log.push(`${landToTake.name} volta para a mao.`);
    } else {
      // Add +1/+1 counter
      const targetCard = state.players[controller].zones.battlefield.get(cardUid);
      if (targetCard) {
        if (!targetCard._counters) targetCard._counters = { '+1/+1': 0, '-1/-1': 0 };
        targetCard._counters['+1/+1']++;
        state.log.push(`${targetCard.name} recebe +1/+1 counter.`);
      }
    }

    // Restore main phase priority for human player
    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';
    if (isMainPhase && state.activePlayer === controller && state.players[controller].isHuman) {
      state.waitingForInput = { type: 'main_phase', playerId: controller };
    }

    if (typeof this._continueIfAI === 'function') this._continueIfAI(state);
  },

  resolveBlightChoice(state, creatureUid) {
    if (!state._pendingBlight) return;
    const { playerId, amount, callback } = state._pendingBlight;
    const creature = state.players[playerId].zones.battlefield.get(creatureUid);
    if (!creature || !CardEngine.isCreature(creature)) return;

    if (!creature._counters) creature._counters = {};
    creature._counters['-1/-1'] = (creature._counters['-1/-1'] || 0) + amount;
    const label = playerId === 0 ? 'Voce coloca' : 'Oponente coloca';
    state.log.push(`${label} ${amount} contador(es) -1/-1 em ${creature.name}. (Blight)`);

    if (CardEngine.getToughness(creature) <= 0) {
      this.creatureDies(state, creature, playerId);
      state.log.push(`${creature.name} morre.`);
    }

    state._pendingBlight = null;
    state.waitingForInput = null;
    if (callback) callback();
  },

  resolveBuffChoice(state, creatureUid) {
    if (!state._pendingBuffChoice) return;
    const { playerId, effect } = state._pendingBuffChoice;
    const creature = state.players[playerId].zones.battlefield.get(creatureUid);
    if (!creature || !CardEngine.isCreature(creature)) return;

    creature._powerMod = (creature._powerMod || 0) + (effect.power || 0);
    creature._toughnessMod = (creature._toughnessMod || 0) + (effect.toughness || 0);
    if (effect.duration === 'end_of_turn') {
      creature._tempPowerMod = (creature._tempPowerMod || 0) + (effect.power || 0);
      creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (effect.toughness || 0);
    }
    state.log.push(`${creature.name} ganha +${effect.power || 0}/+${effect.toughness || 0}.`);

    state._pendingBuffChoice = null;
    state.waitingForInput = null;
  },

  resolveMultiBuffChoice(state) {
    if (!state._pendingMultiBuffChoice) return;

    const { playerId, effect, selected } = state._pendingMultiBuffChoice;

    for (const creatureUid of selected) {
      const creature = state.players[playerId].zones.battlefield.get(creatureUid);
      if (!creature || !CardEngine.isCreature(creature)) continue;

      creature._powerMod = (creature._powerMod || 0) + (effect.power || 0);
      creature._toughnessMod = (creature._toughnessMod || 0) + (effect.toughness || 0);
      if (effect.duration === 'end_of_turn') {
        creature._tempPowerMod = (creature._tempPowerMod || 0) + (effect.power || 0);
        creature._tempToughnessMod = (creature._tempToughnessMod || 0) + (effect.toughness || 0);
      }
    }

    if (selected.length > 0) {
      state.log.push(`${selected.length} criatura(s) ganha(m) +${effect.power || 0}/+${effect.toughness || 0}.`);
    }

    state._pendingMultiBuffChoice = null;
    state.waitingForInput = null;
  },

  _createPlayer(id, deckCards) {
    const zones = new PlayerZones();
    deckCards.forEach(card => {
      const gameCard = {
        ...card,
        _uid: card._uid || (card.id + '_' + Math.random().toString(36).slice(2, 6)),
        _ownerId: id
      };
      zones.library.add(gameCard);
    });

    return {
      id,
      life: this.STARTING_LIFE,
      zones,
      isHuman: id === 0
    };
  },

  // Turn management
  advancePhase(state) {
    state.phaseIndex++;
    if (state.phaseIndex >= this.PHASES.length) {
      state.phaseIndex = 0;
      state.activePlayer = state.activePlayer === 0 ? 1 : 0;
      state.turn++;
      state.landPlayedThisTurn = false;

      // Update dynamic static abilities when turn changes
      this._updateDynamicStaticAbilities(state);
      state.manaPool[0] = ManaSystem.emptyPool();
      state.manaPool[1] = ManaSystem.emptyPool();
      state._spellsThisTurn = [0, 0];  // Reset spell count for Flurry
      state._beholding = [null, null]; // Reset beheld dragons
      state._creatureDiedThisTurn = {};
      state._castCreatureThisTurn = {};
      state._castNoncreatureThisTurn = {};
      state._triggeredOnceThisTurn = {};
      state._abilityUsedThisTurn = {};
    }
    state.phase = this.PHASES[state.phaseIndex];
    if (typeof VFX !== 'undefined') VFX.phaseTransition();

    // Trampoline: if already inside _processPhase, just mark for continuation
    if (state._processingPhases) {
      state._continueProcessing = true;
      return;
    }

    // Top-level call: run iterative loop instead of recursion
    state._processingPhases = true;
    state._continueProcessing = true;
    while (state._continueProcessing && !state.waitingForInput && !state.winner) {
      state._continueProcessing = false;
      this._processPhase(state);
    }
    state._processingPhases = false;
  },

  _processPhase(state) {
    const ap = state.activePlayer;

    switch (state.phase) {
      case 'untap':
        console.log(`[UNTAP] Player ${ap} untap step, turn ${state.turn}`);
        // Untap all permanents (respecting stun counters and aura_prevent_untap)
        state.players[ap].zones.battlefield.cards.forEach(c => {
          // Stun counters: remove one instead of untapping
          if (c._stunCounters && c._stunCounters > 0) {
            c._stunCounters--;
            state.log.push(`${c.name} perde 1 stun counter (${c._stunCounters} restantes).`);
            // Don't untap if still has stun counters
            if (c._stunCounters > 0) return;
          }
          // aura_prevent_untap: creature with this aura doesn't untap
          if (c._preventUntap) {
            state.log.push(`${c.name} nao desvira (aura impede).`);
            return;
          }
          c._tapped = false;
          c._summoningSick = false;
        });
        state.manaPool[ap] = ManaSystem.emptyPool();
        state.log.push(`--- Turno ${state.turn} (Jogador ${ap === 0 ? 'Voce' : 'Oponente'}) ---`);
        this.advancePhase(state); // Auto-advance through untap
        break;

      case 'upkeep': {
        // Advance sagas for active player
        const sagas = state.players[ap].zones.battlefield.cards.filter(c => c._isSaga);
        for (const saga of sagas) {
          const sagaLogs = this._advanceSagaChapter(state, saga, ap);
          state.log.push(...sagaLogs);
        }

        // Fire upkeep triggers
        const upkeepLogs = this.fireTrigger(state, 'upkeep', { playerId: ap });
        state.log.push(...upkeepLogs);

        // Process suspended spells (reduce time counters, cast when 0)
        const suspendLogs = this._processSuspendedSpells(state, ap);
        state.log.push(...suspendLogs);

        // If a trigger set waitingForInput (e.g. surveil), pause here
        if (state.waitingForInput && (state.waitingForInput.type === 'surveil' || state.waitingForInput.type === 'scry' || state.waitingForInput.type === 'rummage_discard' || state.waitingForInput.type === 'discard_for_loot')) {
          break;
        }

        // Non-active player gets instant priority during upkeep
        const nonActiveUp = ap === 0 ? 1 : 0;
        if (!state._upkeepPriorityDone) {
          state._upkeepPriorityDone = true;
          if (state.players[nonActiveUp].isHuman) {
            // Only pause for human if in full control mode
            if (typeof UIGame !== 'undefined' && UIGame._fullControlMode) {
              state.waitingForInput = { type: 'instant_priority', playerId: nonActiveUp, phase: 'upkeep' };
              break;
            }
          } else {
            // AI plays instants during opponent's upkeep (bounce before draw)
            GameAI.playInstantPhase(state, nonActiveUp, 'upkeep');
          }
        }
        state._upkeepPriorityDone = false;

        this.advancePhase(state);
        break;
      }

      case 'draw':
        // Skip draw on very first turn
        if (state.turn > 1 || ap !== 0) {
          const drawn = state.players[ap].zones.library.drawFromTop();
          if (drawn) {
            state.players[ap].zones.hand.add(drawn);
            if (typeof VFX !== 'undefined') VFX.cardDraw(ap);
            if (state.players[ap].isHuman) {
              state.log.push(`Voce compra ${drawn.name}.`);
            } else {
              state.log.push('Oponente compra uma carta.');
            }
          } else {
            // Deck out
            state.winner = ap === 0 ? 1 : 0;
            state.log.push(`Jogador ${ap === 0 ? 'Voce' : 'Oponente'} nao tem cartas para comprar. Derrota!`);
          }
        }
        this.advancePhase(state);
        break;

      case 'main1':
      case 'main2':
        // Wait for player input
        // Process state-based actions before giving player priority
        this._processStateBasedActions(state);

        if (state.players[ap].isHuman) {
          state.waitingForInput = { type: 'main_phase', playerId: ap };
        } else {
          // AI plays
          GameAI.playMainPhase(state, ap);
          this.advancePhase(state);
        }
        break;

      case 'combat_begin': {
        // Fire beginning of combat triggers for active player
        if (!state._combatBeginTriggered) {
          const combatLogs = this.fireTrigger(state, 'combat_begin', { playerId: ap });
          if (combatLogs.length > 0) state.log.push(...combatLogs);
          state._combatBeginTriggered = true;
        }
        // Give non-active player a chance to cast instants before combat
        const nonActive = ap === 0 ? 1 : 0;
        if (!state._priorityPassed) {
          if (state.players[nonActive].isHuman) {
            const hasInstants = this.getPlayableCards(state, nonActive).length > 0 || this.hasAffordableAbilities(state, nonActive);
            if (hasInstants) {
              state.waitingForInput = { type: 'instant_priority', playerId: nonActive, phase: 'combat_begin' };
              break;
            }
          } else {
            // AI plays instants at combat begin
            GameAI.playInstantPhase(state, nonActive, 'combat_begin');
          }
        }
        state._priorityPassed = false;
        state._combatBeginTriggered = false;
        this.advancePhase(state);
        break;
      }

      case 'combat_attackers':
        // Process state-based actions before attackers to clean up dead creatures
        this._processStateBasedActions(state);

        state.combat = CombatSystem.createCombatState();
        state.combat.phase = 'declare_attackers';
        if (state.players[ap].isHuman) {
          state.waitingForInput = { type: 'declare_attackers', playerId: ap };
        } else {
          GameAI.declareAttackers(state, ap);
          if (state.combat.attackers.length === 0) {
            // Skip combat
            state.phaseIndex = this.PHASES.indexOf('combat_end');
            state.phase = 'combat_end';
            this.advancePhase(state);
          } else {
            // Fire "attacks" triggers for AI attackers
            const triggerLogs = CombatSystem.fireAttackTriggers(state.combat, state, ap);
            state.log.push(...triggerLogs);
            this.advancePhase(state);
          }
        }
        break;

      case 'combat_blockers': {
        state.combat.phase = 'declare_blockers';
        const defender = ap === 0 ? 1 : 0;
        if (state.combat.attackers.length === 0) {
          this.advancePhase(state);
          break;
        }
        // Priority after attackers declared: defender can cast instants (removal, tap, combat tricks)
        if (!state._postAttackersPriority) {
          state._postAttackersPriority = true;
          if (state.players[defender].isHuman) {
            const hasInstants = this.getPlayableCards(state, defender).length > 0 || this.hasAffordableAbilities(state, defender);
            if (hasInstants) {
              state.waitingForInput = { type: 'instant_priority', playerId: defender, phase: 'post_attackers' };
              break;
            }
          } else {
            GameAI.playInstantPhase(state, defender, 'post_attackers');
          }
        }
        // Also give active player priority after attackers
        if (!state._postAttackersAPPriority) {
          state._postAttackersAPPriority = true;
          if (state.players[ap].isHuman) {
            const hasInstantsAP = this.getPlayableCards(state, ap).length > 0 || this.hasAffordableAbilities(state, ap);
            if (hasInstantsAP) {
              state.waitingForInput = { type: 'instant_priority', playerId: ap, phase: 'post_attackers' };
              break;
            }
          } else {
            GameAI.playInstantPhase(state, ap, 'post_attackers');
          }
        }
        // Clean up priority flags
        delete state._postAttackersPriority;
        delete state._postAttackersAPPriority;
        // Declare blockers
        if (state.players[defender].isHuman) {
          state.waitingForInput = { type: 'declare_blockers', playerId: defender };
        } else {
          GameAI.declareBlockers(state, defender);
          this.advancePhase(state);
        }
        break;
      }

      case 'combat_damage': {
        // Blocker ordering: attacking player orders blockers before damage
        if (!state.combat._blockerOrderDone) {
          const multiBlocked = CombatSystem.getMultiBlockedAttackers(state.combat);
          if (multiBlocked.length > 0) {
            if (state.players[ap].isHuman) {
              state.waitingForInput = { type: 'order_blockers', playerId: ap, attackerUids: multiBlocked };
              break;
            } else {
              GameAI.orderBlockers(state, ap);
            }
          }
          state.combat._blockerOrderDone = true;
        }

        // Priority after blockers: active player (attacker) gets priority for combat tricks
        const nonActiveDmg = ap === 0 ? 1 : 0;
        if (state.combat.attackers.length > 0 && !state._postBlockersAPPriority) {
          state._postBlockersAPPriority = true;
          if (state.players[ap].isHuman) {
            const hasInstantsAP = this.getPlayableCards(state, ap).length > 0 || this.hasAffordableAbilities(state, ap);
            if (hasInstantsAP) {
              state.waitingForInput = { type: 'instant_priority', playerId: ap, phase: 'post_blockers' };
              break;
            }
          } else {
            GameAI.playInstantPhase(state, ap, 'post_blockers');
          }
        }
        // Then non-active player (defender) gets priority for combat tricks
        if (state.combat.attackers.length > 0 && !state._postBlockersNAPPriority) {
          state._postBlockersNAPPriority = true;
          if (state.players[nonActiveDmg].isHuman) {
            const hasInstantsDmg = this.getPlayableCards(state, nonActiveDmg).length > 0 || this.hasAffordableAbilities(state, nonActiveDmg);
            if (hasInstantsDmg) {
              state.waitingForInput = { type: 'instant_priority', playerId: nonActiveDmg, phase: 'combat_damage' };
              break;
            }
          } else {
            GameAI.playInstantPhase(state, nonActiveDmg, 'combat_damage');
          }
        }
        state._priorityPassed = false;
        delete state._postBlockersAPPriority;
        delete state._postBlockersNAPPriority;
        if (state.combat.attackers.length > 0) {
          const defender2 = ap === 0 ? 1 : 0;
          const combatLog = CombatSystem.resolveCombatDamage(
            state.combat, state.players[ap], state.players[defender2], state
          );
          state.log.push(...combatLog);
          this._checkWinner(state);
        }
        // If a becomes_tapped trigger set waitingForInput (e.g. Rescue Leopard rummage), pause
        if (state.waitingForInput && (state.waitingForInput.type === 'rummage_discard' || state.waitingForInput.type === 'discard_for_loot' || state.waitingForInput.type === 'surveil' || state.waitingForInput.type === 'scry')) {
          break;
        }
        this.advancePhase(state);
        break;
      }

      case 'combat_end':
        // Check for extra combat phase
        if (state._extraCombat) {
          state._extraCombat = false;
          // Reset combat state and jump back to combat_begin
          state.combat = CombatSystem.createCombatState();
          state._combatBeginTriggered = false;
          state._priorityPassed = false;
          state.phaseIndex = this.PHASES.indexOf('combat_begin') - 1; // Will advance to combat_begin
          state.log.push('Fase de combate adicional!');
        }
        this.advancePhase(state);
        break;

      case 'end': {
        // Fire end step triggers
        const endStepLogs = this.fireTrigger(state, 'end_step', { playerId: ap });
        state.log.push(...endStepLogs);

        // Non-active player gets priority at end step
        const nonActiveEnd = ap === 0 ? 1 : 0;
        if (!state._priorityPassed) {
          if (state.players[nonActiveEnd].isHuman) {
            // Human gets priority at opponent's end step
            if (!state._aiActions) state._aiActions = [];
            state._aiActions.push({
              type: 'end_step_pause',
              description: 'Fim do turno do Oponente — Sua prioridade'
            });
            state.waitingForInput = { type: 'instant_priority', playerId: nonActiveEnd, phase: 'end_step' };
            break;
          } else {
            // AI plays instants at end of human's turn
            GameAI.playInstantPhase(state, nonActiveEnd, 'end_step');
          }
        }
        state._priorityPassed = false;

        this.advancePhase(state);
        break;
      }

      case 'cleanup': {
        // Discard down to max hand size
        const hand = state.players[ap].zones.hand;
        if (hand.count() > this.MAX_HAND_SIZE) {
          if (state.players[ap].isHuman) {
            state.waitingForInput = { type: 'discard', playerId: ap, amount: hand.count() - this.MAX_HAND_SIZE };
          } else {
            GameAI.discard(state, ap, hand.count() - this.MAX_HAND_SIZE);
            this._endOfTurnCleanup(state);
            this.advancePhase(state);
          }
        } else {
          this._endOfTurnCleanup(state);
          this.advancePhase(state);
        }
        break;
      }
    }
  },

  // Player actions
  playLand(state, playerId, cardUid) {
    if (state.landPlayedThisTurn) return { success: false, msg: 'Ja jogou terreno neste turno.' };
    if (state.phase !== 'main1' && state.phase !== 'main2') return { success: false, msg: 'So pode jogar terrenos na fase principal.' };

    const hand = state.players[playerId].zones.hand;
    let card = hand.get(cardUid);
    let fromExile = false;
    if (!card && state._exiledPlayable && state._exiledPlayable[cardUid]) {
      card = state._exiledPlayable[cardUid].card;
      fromExile = true;
    }
    if (!card || !CardEngine.isLand(card)) return { success: false, msg: 'Carta invalida.' };

    if (fromExile) {
      state.players[playerId].zones.exile.remove(cardUid);
      delete state._exiledPlayable[cardUid];
    } else {
      hand.remove(cardUid);
    }
    const bfCard = CardEngine.prepareForBattlefield(card);
    bfCard._summoningSick = false; // Lands don't have summoning sickness

    const oText = (card.oracle_text || '').toLowerCase();
    const playerLabel = playerId === 0 ? 'Voce' : 'Oponente';

    // Shock lands: "you may pay 2 life. If you don't, it enters tapped."
    if (oText.includes('pay 2 life') && oText.includes('enters tapped')) {
      const life = state.players[playerId].life;
      // Auto-pay 2 life if above 4 life (both human and AI)
      if (life > 4) {
        state.players[playerId].life -= 2;
        state.log.push(`${playerLabel} paga 2 vida para ${card.name} entrar desvirado.`);
      } else {
        bfCard._tapped = true;
        state.log.push(`${card.name} entra virado.`);
      }
    }
    // Check for "enters tapped unless you control X" condition
    else if (oText.includes('enters tapped unless')) {
      const condition = CardEngine.getEntersTappedUnlessCondition(card);
      if (condition && condition.length > 0) {
        // Check if player controls any of the required land types
        const hasCondition = condition.some(landType =>
          state.players[playerId].zones.battlefield.cards.some(c => CardEngine.hasLandType(c, landType))
        );
        if (hasCondition) {
          state.log.push(`${card.name} entra desvirado (você controla ${condition.join(' ou ')}).`);
        } else {
          bfCard._tapped = true;
          state.log.push(`${card.name} entra virado.`);
        }
      } else {
        // Fallback: treat as regular enters tapped
        bfCard._tapped = true;
        state.log.push(`${card.name} entra virado.`);
      }
    }
    // Regular "enters tapped" lands (gain lands, tap lands, etc.)
    else if (oText.includes('enters tapped')) {
      bfCard._tapped = true;
      state.log.push(`${card.name} entra virado.`);
    }

    // ETB gain life: "when this land enters, you gain N life"
    const gainLifeMatch = oText.match(/when this land enters,? you gain (\d+) life/);
    if (gainLifeMatch) {
      const lifeGain = parseInt(gainLifeMatch[1]);
      state.players[playerId].life += lifeGain;
      state.log.push(`${playerLabel} ganha ${lifeGain} vida.`);
    }

    // Hideaway: enters tapped, look at top 4, exile one face-down
    const dbEffects = CardEngine.getPreprocessedEffects(card);
    if (dbEffects && dbEffects.hideaway) {
      bfCard._tapped = true;
      bfCard._hideaway = true;
      bfCard._hideawayCondition = dbEffects.condition || '';
    }

    // Apply static abilities before land enters
    const staticEffects = dbEffects && dbEffects.static;
    if (staticEffects) {
      for (const s of staticEffects) {
        if (s.type === 'enters_tapped_conditional') {
          bfCard._entersTappedConditional = true;
        } else if (s.type === 'enters_tapped') {
          bfCard._entersTapped = true;
        }
      }
    }

    // Check if land should enter tapped based on static abilities
    if (bfCard._entersTapped) {
      bfCard._tapped = true;
      state.log.push(`${card.name} entra virado.`);
    } else if (bfCard._entersTappedConditional) {
      // For conditional tapped lands: check if condition is met
      let shouldBeTapped = true;
      if (card._entersTappedCondition && Array.isArray(card._entersTappedCondition)) {
        // Check if player controls any of the condition types
        const hasCondition = card._entersTappedCondition.some(type => {
          return state.players[playerId].zones.battlefield.cards.some(c => CardEngine.hasCreatureType(c, type));
        });
        if (hasCondition) shouldBeTapped = false;
      }
      if (shouldBeTapped) {
        bfCard._tapped = true;
        state.log.push(`${card.name} entra virado.`);
      } else {
        state.log.push(`${card.name} entra desvirado (você controla ${card._entersTappedCondition.join(' ou ')}).`);
      }
    }

    state.players[playerId].zones.battlefield.add(bfCard);
    state.landPlayedThisTurn = true;
    state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} joga ${card.name}.`);

    // Process hideaway after land enters
    if (dbEffects && dbEffects.hideaway) {
      this._processHideaway(state, playerId, bfCard);
    }

    // Fire landfall triggers
    const landfallLogs = this.fireTrigger(state, 'landfall', { playerId, cardUid: bfCard._uid });
    state.log.push(...landfallLogs);

    return { success: true };
  },

  _processHideaway(state, playerId, landCard) {
    const lib = state.players[playerId].zones.library;
    const lookCount = 4;
    const cards = [];
    for (let i = 0; i < lookCount; i++) {
      const c = lib.drawFromTop();
      if (c) cards.push(c);
    }
    if (cards.length === 0) return;

    if (playerId === 0 && state.players[0].isHuman) {
      // Human: show hideaway selection overlay
      state._pendingHideaway = {
        landName: landCard.name,
        landUid: landCard._uid,
        cards: cards,
        playerId: playerId
      };
      state.waitingForInput = { type: 'hideaway', playerId: playerId };
      state.log.push(`${landCard.name}: olhe as 4 cartas do topo. Escolha uma para exilar.`);
    } else {
      // AI: pick highest CMC non-land card (or best value)
      const sorted = [...cards].sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
      const pick = sorted[0]; // Best card
      const rest = cards.filter(c => c !== pick);

      // Exile picked card face-down under the land
      landCard._hideawayCard = pick;
      state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} exila uma carta com ${landCard.name}.`);

      // Put rest on bottom in random order
      rest.sort(() => Math.random() - 0.5);
      rest.forEach(c => lib.addToBottom(c));
    }
  },

  // Check if hideaway condition is met
  _checkHideawayCondition(state, playerId, landCard) {
    if (!landCard._hideaway || !landCard._hideawayCard) return false;
    const condition = landCard._hideawayCondition;
    const opponent = playerId === 0 ? 1 : 0;

    switch (condition) {
      case 'three_attackers':
        // Windbrisk Heights: attacked with 3+ creatures this turn
        return state.combat && state.combat.attackers && state.combat.attackers.length >= 3;
      case 'library_20_or_less':
        // Shelldock Isle: any library has 20 or fewer cards
        return state.players[0].zones.library.count() <= 20 || state.players[1].zones.library.count() <= 20;
      case 'empty_hand':
        // Howltooth Hollow: each player has no cards in hand
        return state.players[0].zones.hand.count() === 0 && state.players[1].zones.hand.count() === 0;
      case 'seven_damage_dealt':
        // Spinerock Knoll: opponent was dealt 7+ damage this turn
        return (state._damageDealtThisTurn && state._damageDealtThisTurn[opponent] >= 7);
      case 'power_10_or_more':
        // Mosswort Bridge: you control creatures with total power 10+
        const totalPower = state.players[playerId].zones.battlefield.cards
          .filter(c => CardEngine.isCreature(c))
          .reduce((sum, c) => sum + CardEngine.getPower(c), 0);
        return totalPower >= 10;
      default:
        return false;
    }
  },

  // Activate hideaway: play the exiled card for free
  activateHideaway(state, playerId, landUid) {
    const land = state.players[playerId].zones.battlefield.get(landUid);
    if (!land || !land._hideaway || !land._hideawayCard) return { success: false, msg: 'Sem carta escondida.' };
    if (land._tapped) return { success: false, msg: 'Terreno ja virado.' };

    if (!this._checkHideawayCondition(state, playerId, land)) {
      return { success: false, msg: 'Condicao do hideaway nao atendida.' };
    }

    // Tap the land
    land._tapped = true;

    // Play the card for free
    const card = land._hideawayCard;
    land._hideawayCard = null;

    if (CardEngine.isLand(card)) {
      const bfCard = CardEngine.prepareForBattlefield(card);
      bfCard._summoningSick = false;
      state.players[playerId].zones.battlefield.add(bfCard);
      state.log.push(`Hideaway: ${card.name} entra no campo de graca!`);
    } else if (CardEngine.isPermanent(card)) {
      const bfCard = CardEngine.prepareForBattlefield(card);
      bfCard._ownerId = playerId;
      state.players[playerId].zones.battlefield.add(bfCard);
      this._registerCardTriggers(state, bfCard, playerId);
      // Process ETB
      const etb = CardEngine.getETBEffects(card);
      if (etb && etb.length > 0) {
        GameStack.resolveEffects(state, playerId, bfCard, etb, []);
      }
      state.log.push(`Hideaway: ${card.name} entra no campo de graca!`);
    } else {
      // Instant/sorcery: resolve effects
      const effects = CardEngine.getSpellEffects(card);
      if (effects && effects.length > 0) {
        GameStack.resolveEffects(state, playerId, card, effects, []);
      }
      state.players[playerId].zones.graveyard.add(card);
      state.log.push(`Hideaway: ${card.name} jogado de graca!`);
    }

    return { success: true };
  },

  tapLandForMana(state, playerId, cardUid, preferColor) {
    const bf = state.players[playerId].zones.battlefield;
    const card = bf.get(cardUid);
    if (!card || !CardEngine.isLand(card) || card._tapped) return false;

    card._tapped = true;
    const colors = ManaSystem.getLandManaColors(card);
    // Use preferred color if the land can produce it, otherwise use first
    let manaColor;
    if (preferColor && colors.includes(preferColor)) {
      manaColor = preferColor;
    } else {
      manaColor = colors[0] || 'C';
    }
    state.manaPool[playerId][manaColor] = (state.manaPool[playerId][manaColor] || 0) + 1;
    return true;
  },

  /**
   * Calculate affinity discount for a card.
   * Returns the amount of generic mana reduction.
   */
  calculateAffinityDiscount(state, playerId, card) {
    if (!CardEngine.hasAffinity(card)) return 0;

    const affinityType = CardEngine.getAffinityType(card);
    const bf = state.players[playerId].zones.battlefield;

    if (affinityType === 'creatures') {
      return bf.cards.filter(c => CardEngine.isCreature(c)).length;
    } else if (affinityType === 'artifacts') {
      return bf.cards.filter(c => CardEngine.isArtifact(c)).length;
    }

    return 0;
  },

  /**
   * Calculate cost reduction based on attacking creatures.
   * Returns the amount of generic mana reduction.
   */
  getAttackingCreatureDiscount(state, card) {
    const db = CardEngine.getPreprocessedEffects(card);
    if (!db || !db.cost_reduction || db.cost_reduction.condition !== 'per_attacking_creature') return 0;

    // Count attacking creatures from both players
    let attackingCount = 0;
    for (const playerId of [0, 1]) {
      const bf = state.players[playerId].zones.battlefield;
      attackingCount += bf.cards.filter(c => CardEngine.isCreature(c) && c._attacking).length;
    }

    return attackingCount;
  },

  /**
   * Return temporarily exiled cards when their exiler leaves the battlefield.
   */
  returnTemporaryExiles(state, exilerUid) {
    if (!state._temporaryExiles) return [];

    const returned = [];
    const toRemove = [];

    // Find exiler on the battlefield (check all players)
    let exiler = null;
    for (const pid of [0, 1]) {
      exiler = state.players[pid].zones.battlefield.get(exilerUid);
      if (exiler) break;
    }

    for (const [exiledUid, exileInfo] of Object.entries(state._temporaryExiles)) {
      if (exileInfo.exilerUid === exilerUid) {
        // Find the exiled card
        const exiledCard = state.players[exileInfo.originalOwner].zones.exile.get(exiledUid);
        if (exiledCard) {
          // Return to original zone
          state.players[exileInfo.originalOwner].zones.exile.remove(exiledUid);
          state.players[exileInfo.originalOwner].zones.battlefield.add(exiledCard);
          returned.push(exiledCard.name);

          // Remove from exiler's _exiledCards array (for UI display)
          if (exiler && exiler._exiledCards) {
            exiler._exiledCards = exiler._exiledCards.filter(c => c._uid !== exiledUid);
          }
        }
        toRemove.push(exiledUid);
      }
    }

    // Clean up tracking
    toRemove.forEach(uid => delete state._temporaryExiles[uid]);

    return returned;
  },

  castSpell(state, playerId, cardUid, targets, castingAdventure, castingEvoke) {
    const hand = state.players[playerId].zones.hand;
    let card = hand.get(cardUid);
    let fromExile = false;
    if (!card && state._exiledPlayable && state._exiledPlayable[cardUid]) {
      card = state._exiledPlayable[cardUid].card;
      fromExile = true;
    }
    if (!card) return { success: false, msg: 'Carta nao encontrada.' };

    // Detect evoke casting from card flag or parameter
    const isEvoke = castingEvoke || card._castingEvoke;

    // Detect adventure casting from card flag or parameter
    const isAdventure = !isEvoke && (castingAdventure || card._castingAdventure);
    const advCost = isAdventure ? CardEngine.getAdventureCost(card) : null;
    const advCmc = isAdventure ? CardEngine.getAdventureCMC(card) : 0;

    // Evoke cost overrides normal cost
    let useCost, useCmc, useName;
    if (isEvoke) {
      const evokeCost = CardEngine.getEvokeCost(card);
      useCost = evokeCost;
      useCmc = ManaSystem.parseCost(evokeCost).total || 0;
      useName = card.name;
    } else if (isAdventure) {
      useCost = advCost;
      useCmc = advCmc;
      useName = card.adventure.name;
    } else {
      // Get first target to check for conditional costs (Dragon's Prey)
      const firstTarget = targets && targets.length > 0 ? targets[0] : null;
      let targetCard = null;
      if (firstTarget) {
        // Find the actual card being targeted
        const targetPlayer = state.players[firstTarget.player];
        if (targetPlayer) {
          targetCard = targetPlayer.zones.battlefield.get(firstTarget.uid);
        }
      }

      // Use effective mana cost that includes conditional costs
      const effectiveCost = CardEngine.getEffectiveManaCost(card, targetCard);
      useCost = effectiveCost;
      useCmc = ManaSystem.parseCost(effectiveCost).total || card.cmc || 0;
      useName = card.name;
    }

    // Apply affinity discount to cost
    if (!isAdventure && !isEvoke) {
      const affinityDiscount = this.calculateAffinityDiscount(state, playerId, card);
      const attackingDiscount = this.getAttackingCreatureDiscount(state, card);
      const totalDiscount = affinityDiscount + attackingDiscount;

      if (totalDiscount > 0) {
        const parsedCost = ManaSystem.parseCost(useCost);
        parsedCost.generic = Math.max(0, parsedCost.generic - totalDiscount);
        useCost = ManaSystem.costToString(parsedCost);
        useCmc = parsedCost.total;
      }
    }

    // Check if can cast (instant/flash anytime, others only main phase)
    if (isAdventure) {
      const advIsInstant = CardEngine.isAdventureInstant(card);
      if (!advIsInstant) {
        if (state.phase !== 'main1' && state.phase !== 'main2') {
          return { success: false, msg: 'So pode jogar isto na fase principal.' };
        }
      }
    } else if (!CardEngine.isInstant(card) && !(card.keywords || []).includes('Flash')) {
      if (state.phase !== 'main1' && state.phase !== 'main2') {
        return { success: false, msg: 'So pode jogar isto na fase principal.' };
      }
    }

    // Check legendary rule BEFORE casting for permanent cards (skip if already approved)
    if (CardEngine.isPermanent(card) && CardEngine.isLegendary(card) && !state._skipLegendaryCheck) {
      const existingDuplicates = CardEngine.findLegendaryDuplicates(state, playerId, card.name);
      if (existingDuplicates.length > 0) {
        if (playerId === 0) {
          // Human player - show warning modal before casting
          state.waitingForInput = { type: 'legendary_choice_pre_cast', playerId };
          state._pendingLegendaryChoice = {
            cardToCast: card,
            cardUid: cardUid,
            targets: targets,
            castingAdventure: castingAdventure,
            castingEvoke: castingEvoke,
            existingCards: existingDuplicates,
            playerId: playerId,
            useCost: useCost,
            useCmc: useCmc,
            fromExile: fromExile
          };
          return { success: true, waitForChoice: true, msg: 'Escolha qual lendária manter.' };
        } else {
          // AI player - automatically proceed with cast (will remove existing duplicates after)
          // No special handling needed here, will be handled when card enters battlefield
        }
      }
    }

    // Check if card is being cast for free from exile
    let isFreeFromExile = false;
    if (fromExile && state._exiledPlayable && state._exiledPlayable[cardUid]) {
      const exileEntry = state._exiledPlayable[cardUid];
      isFreeFromExile = exileEntry.freeCast || false;
      console.log(`[BREACHING DEBUG] Casting ${card.name} from exile: freeCast=${exileEntry.freeCast}, isFreeFromExile=${isFreeFromExile}, useCost=${useCost}, useCmc=${useCmc}`);
    }

    // Check and pay mana (skip if casting for free)
    if (!isFreeFromExile) {
      // Check mana - verify pool has enough (after auto-tap should have added mana)
      if (!ManaSystem.canPay(state.manaPool[playerId], useCost, useCmc)) {
        return { success: false, msg: 'Mana insuficiente.' };
      }

      // Double check: total mana in pool must be >= cmc (safety net)
      const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
      const requiredTotal = useCmc || ManaSystem.parseCost(useCost).total || 0;
      if (poolTotal < requiredTotal) {
        return { success: false, msg: 'Mana insuficiente.' };
      }

      // Pay mana
      state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], useCost, useCmc);
    }

    // Pay behold cost (REVEAL a card of matching type from hand — card stays in hand)
    const beholdCost = CardEngine.getBeholdCost(card);
    if (beholdCost && card._beholdPaid) {
      // Behold was pre-selected - just reveal (card stays in hand)
      const beholdCard = hand.get(card._beholdCardUid);
      if (beholdCard) {
        state._beholding[playerId] = beholdCard;
        state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} revela ${beholdCard.name} (behold).`);
      }
      delete card._beholdPaid;
      delete card._beholdCardUid;
    } else if (beholdCost) {
      // Check for behold targets in hand
      const candidates = hand.getAll().filter(c =>
        c._uid !== cardUid && CardEngine.hasCreatureType(c, beholdCost.subtype)
      );

      if (candidates.length > 0) {
        // Has behold targets to choose from
        if (playerId === 0 && candidates.length > 1) {
          // Human player with multiple options - pause for choice
          state.waitingForInput = { type: 'behold_choice_multiple' };
          state._pendingBeholdChoice = {
            cardUid,
            playerId,
            candidates,
            beholdCost,
            hand
          };
          return { success: false, msg: '', paused: true };
        } else {
          // Single option or AI - just pick first
          const picked = candidates[0];
          state._beholding[playerId] = picked;
          state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} revela ${picked.name} (behold).`);
        }
      } else if (beholdCost.optional && beholdCost.alternateCost) {
        // No behold target but optional - human player can choose to pay alternate
        if (playerId === 0) {
          // Pause for human choice: reveal or pay
          state.waitingForInput = { type: 'behold_choice_optional' };
          state._pendingBeholdChoice = {
            cardUid,
            playerId,
            beholdCost
          };
          return { success: false, msg: '', paused: true };
        } else {
          // AI pays alternate cost (no dragoes)
          const extraCost = `{${beholdCost.alternateCost}}`;
          state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], extraCost, beholdCost.alternateCost);
          state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} paga ${extraCost} (sem behold).`);
        }
      }
    }

    // Remove from hand or exile
    if (fromExile) {
      state.players[playerId].zones.exile.remove(cardUid);
      delete state._exiledPlayable[cardUid];
    } else {
      hand.remove(cardUid);
    }

    // Clean up casting flags
    delete card._castingAdventure;
    delete card._castingEvoke;

    // Mark card as evoked (will trigger sacrifice after ETB)
    if (isEvoke) card._evoked = true;

    // Track spells cast this turn (for Flurry mechanic)
    state._spellsThisTurn[playerId] = (state._spellsThisTurn[playerId] || 0) + 1;
    // Mark card as cast (for "if you cast it" conditions)
    card._wasCast = true;
    // Track creature/noncreature casts for trigger conditions
    if (CardEngine.isCreature(card)) {
      if (!state._castCreatureThisTurn) state._castCreatureThisTurn = {};
      state._castCreatureThisTurn[playerId] = true;
    } else {
      if (!state._castNoncreatureThisTurn) state._castNoncreatureThisTurn = {};
      state._castNoncreatureThisTurn[playerId] = true;
    }

    const playerLabel = playerId === 0 ? 'Voce' : 'Oponente';

    // Adventure spell: resolve as instant/sorcery, then exile (creature can be cast from exile later)
    if (isAdventure) {
      state.log.push(`${playerLabel} joga ${useName} (Adventure de ${card.name}).`);

      // Create a temporary spell card for effect resolution using adventure text
      const adventureSpell = {
        ...card,
        name: useName,
        oracle_text: card.adventure.oracle_text,
        type_line: card.adventure.type_line,
        mana_cost: advCost,
        cmc: advCmc,
        _isAdventureSpell: true,
        _originalCard: card
      };

      // Resolve adventure spell effects (check original card name in DB first)
      const db = CardEngine.getPreprocessedEffects(card);
      const effects = (db && db.cast) ? db.cast : CardEngine.getSpellEffects(adventureSpell);
      console.log(`[ADVENTURE DEBUG] Final effects passed to stack:`, effects);
      if (effects.length > 0) {
        GameStack.resolveEffects(state, playerId, adventureSpell, effects, targets || []);
      }

      // Check if adventure is Omen (shuffle into library instead of exile)
      const isOmen = (db && db.omen) ||
        (card.adventure && card.adventure.type_line && card.adventure.type_line.toLowerCase().includes('omen'));

      if (isOmen) {
        // Omen: shuffle into owner's library
        state.players[playerId].zones.library.addToBottom(card);
        state.players[playerId].zones.library.shuffle();
        state.log.push(`${card.name} e embaralhado na biblioteca (Omen).`);
      } else if (state.players[playerId].zones.exile) {
        // Normal adventure: exile (can be cast as creature from exile later)
        card._adventureExiled = true;
        state.players[playerId].zones.exile.add(card);
      } else {
        state.players[playerId].zones.graveyard.add(card);
      }

      return { success: true };
    }

    // If permanent, put on battlefield
    if (CardEngine.isPermanent(card)) {
      const bfCard = CardEngine.prepareForBattlefield(card);

      // Handle aura attachment
      if (CardEngine.isAura(card)) {
        const targetCreature = targets && targets.length > 0
          ? state.players[targets[0].player].zones.battlefield.get(targets[0].uid)
          : null;
        if (targetCreature) {
          bfCard._attachedTo = targetCreature._uid;
          bfCard._attachedToOwner = targets[0].player;
          if (!targetCreature._attachments) targetCreature._attachments = [];
          targetCreature._attachments.push(bfCard._uid);
          // Apply aura effects
          this._applyAuraEffects(bfCard, targetCreature);
        }
      }

      // Handle equipment (enters unattached)
      if (CardEngine.isEquipment(card)) {
        bfCard._attachedTo = null;
      }

      state.players[playerId].zones.battlefield.add(bfCard);
      state.log.push(`${playerLabel} joga ${card.name}.`);

      // Handle legendary rule after card enters battlefield
      if (CardEngine.isLegendary(bfCard)) {
        const existingDuplicates = CardEngine.findLegendaryDuplicates(state, playerId, bfCard.name)
          .filter(c => c._uid !== bfCard._uid);
        if (existingDuplicates.length > 0) {
          if (playerId === 0 && state._legendaryChoice === 'keep_existing') {
            // Human player chose to keep existing card - remove the new one
            state.players[playerId].zones.battlefield.remove(bfCard._uid);
            state.players[playerId].zones.graveyard.add(bfCard);
            state.log.push(`${bfCard.name} vai para o cemitério devido à regra lendária.`);
            state.log.push(`${existingDuplicates[0].name} permanece no campo de batalha.`);
          } else {
            // Default behavior: remove existing duplicates, keep new card
            // (applies to AI players and human choice of 'keep_new')
            existingDuplicates.forEach(existing => {
              state.players[playerId].zones.battlefield.remove(existing._uid);
              state.players[playerId].zones.graveyard.add(existing);
              state.log.push(`${existing.name} vai para o cemitério devido à regra lendária.`);
            });
            state.log.push(`${bfCard.name} permanece no campo de batalha.`);
          }
        }
      }

      // Mark creature as "entered this turn" for double damage tracking
      if (CardEngine.isCreature(bfCard)) {
        bfCard._enteredThisTurn = true;
      }

      // Vivid: initialize * power/toughness based on color count
      if (CardEngine.hasVividPT(bfCard)) {
        bfCard._vividPower = true;
        bfCard._vividPowerValue = CardEngine.countVividColors(state, playerId);
      }
      // Update all vivid creatures (board changed)
      this._updateVividCreatures(state, playerId);
      // Update dynamic power creatures (board changed)
      this._updateDynamicPower(state, playerId);

      // Process static abilities from DB on ETB
      this._applyStaticOnETB(state, bfCard, playerId);

      // Dragon ETB counters: check for Dragonstorm Globe effects
      if (CardEngine.isCreature(bfCard) && CardEngine.hasCreatureType(bfCard, 'Dragon')) {
        const artifacts = state.players[playerId].zones.battlefield.cards.filter(c => c._dragonETBCounter);
        if (artifacts.length > 0) {
          if (!bfCard._counters) bfCard._counters = { '+1/+1': 0, '-1/-1': 0 };
          bfCard._counters['+1/+1'] += artifacts.length;
          state.log.push(`${bfCard.name} recebe ${artifacts.length} +1/+1 counter(s) de ${artifacts.map(a => a.name).join(', ')}.`);

          // Fire counter_placed trigger for each counter
          for (let i = 0; i < artifacts.length; i++) {
            const cpLogs = this.fireTrigger(state, 'counter_placed', { playerId, cardUid: bfCard._uid, counter: '+1/+1' });
            state.log.push(...cpLogs);
          }
        }
      }

      // VFX: ETB animation
      if (typeof VFX !== 'undefined') {
        setTimeout(() => VFX.enterBattlefield(bfCard._uid), 50);
      }

      // Saga: initialize chapter tracking and resolve chapter 1
      if (CardEngine.isSaga(card)) {
        const chapters = CardEngine.getSagaChapters(card);
        if (chapters) {
          bfCard._isSaga = true;
          bfCard._sagaChapter = 0;
          bfCard._sagaMaxChapter = Math.max(...Object.keys(chapters).map(Number));
          // Advance to chapter 1 immediately
          const sagaLogs = this._advanceSagaChapter(state, bfCard, playerId);
          state.log.push(...sagaLogs);
        }
      }

      // Register triggered abilities
      this._registerCardTriggers(state, bfCard, playerId);

      // ETB effects
      const etbEffects = CardEngine.getETBEffects(card);
      if (etbEffects.length > 0) {
        state.log.push(`${card.name}: habilidade de entrada no campo!`);
        // Mark card as "cast" if it came from castSpell (for "if you cast it" conditions)
        bfCard._wasCast = card._wasCast || false;
        GameStack.push(state.stack, { card: bfCard, controller: playerId, targets, effects: etbEffects });
        const stackLog = GameStack.resolve(state.stack, state);
        state.log.push(...stackLog);
      }

      // === Evoke: sacrifice after ETB ===
      if (bfCard._evoked) {
        state.log.push(`${card.name} foi evocado — sacrificado!`);
        this.sacrifice(state, playerId, bfCard._uid);
      }

      // === Champion: exile a creature you control ===
      if (CardEngine.hasKeyword(card, 'Champion') && !bfCard._evoked) {
        const championType = CardEngine.getChampionType(card);
        const bf = state.players[playerId].zones.battlefield;
        const validTargets = bf.cards.filter(c =>
          c._uid !== bfCard._uid && CardEngine.isCreature(c) &&
          (championType === 'creature' || CardEngine.hasCreatureType(c, championType))
        );
        if (validTargets.length > 0) {
          // AI picks the weakest creature to exile
          const target = validTargets.sort((a, b) =>
            CardEngine.getPower(a) - CardEngine.getPower(b)
          )[0];
          bf.remove(target._uid);
          if (!state.players[playerId].zones.exile) {
            state.players[playerId].zones.exile = { cards: [], add(c) { this.cards.push(c); }, remove(uid) { const i = this.cards.findIndex(x => x._uid === uid); if (i >= 0) return this.cards.splice(i, 1)[0]; }, get(uid) { return this.cards.find(x => x._uid === uid); }, getAll() { return this.cards; }, count() { return this.cards.length; } };
          }
          state.players[playerId].zones.exile.add(target);
          bfCard._championedCard = target._uid;
          bfCard._championedPlayer = playerId;
          // Track exiled card under this permanent for visual display
          if (!bfCard._exiledCards) bfCard._exiledCards = [];
          bfCard._exiledCards.push({ name: target.name, image_uris: target.image_uris, image_small: target.image_small, _uid: target._uid });
          state.log.push(`${card.name} campeou ${target.name} (exilado).`);
        } else {
          // No valid target - sacrifice the champion
          state.log.push(`${card.name}: sem criatura valida para campeao — sacrificado!`);
          this.sacrifice(state, playerId, bfCard._uid);
        }
      }

      // Fire "enters_or_attacks" trigger for creatures that have it
      if (CardEngine.isCreature(bfCard)) {
        const enterLogs = this.fireTrigger(state, 'enters_or_attacks', { cardUid: bfCard._uid, entering: true, playerId });
        state.log.push(...enterLogs);

        // Fire dragon_enters if this is a dragon
        if ((bfCard.type_line || '').toLowerCase().includes('dragon')) {
          const dragonLogs = this.fireTrigger(state, 'dragon_enters', { cardUid: bfCard._uid, playerId });
          state.log.push(...dragonLogs);
        }
      }

      // Fire other_creature_enters for all OTHER creatures on battlefield
      if (CardEngine.isCreature(bfCard)) {
        const enterLogs = this.fireTrigger(state, 'other_creature_enters', { cardUid: bfCard._uid, playerId, entering: true });
        state.log.push(...enterLogs);
        // creature_etb for cards that trigger on any creature entering
        const etbLogs = this.fireTrigger(state, 'creature_etb', { cardUid: bfCard._uid, playerId });
        state.log.push(...etbLogs);
      }
    } else {
      // Spell - put on stack and resolve
      const effects = CardEngine.getSpellEffects(card);
      state.log.push(`${playerLabel} lanca ${card.name}.`);

      // VFX: spell cast
      if (typeof VFX !== 'undefined') VFX.spellCast(card.name);
      GameStack.push(state.stack, { card, controller: playerId, targets, effects });

      // CRITICAL FIX: Give opponent priority to respond before resolving
      const opponentId = playerId === 0 ? 1 : 0;
      if (state.players[opponentId].isHuman && this.getPlayableCards(state, opponentId).length > 0) {
        state.waitingForInput = { type: 'stack_priority', playerId: opponentId, spellCaster: playerId };
        state.log.push(`${card.name} no stack. Oponente pode responder.`);
      } else {
        // Opponent is AI or has no responses - resolve immediately
        const stackLog = GameStack.resolve(state.stack, state);
        state.log.push(...stackLog);
      }

      // Spell copy: if pending copy, duplicate the spell
      if (state._pendingSpellCopy && state._pendingSpellCopy[playerId]) {
        delete state._pendingSpellCopy[playerId];
        state.log.push(`Copia de ${card.name} resolvida!`);
        const copyCard = { ...card, name: card.name + ' (Copia)', _uid: card._uid + '_copy' };
        GameStack.push(state.stack, { card: copyCard, controller: playerId, targets, effects: [...effects] });
        const copyLog = GameStack.resolve(state.stack, state);
        state.log.push(...copyLog);
      }
    }

    // Fire Flurry triggers (second spell this turn)
    if (state._spellsThisTurn[playerId] === 2) {
      const flurryLogs = this.fireTrigger(state, 'second_spell', { playerId, lastSpell: card, cardUid: card._uid });
      state.log.push(...flurryLogs);
    }

    // Fire cast-related triggers
    const castData = { playerId, cardUid: card._uid || '', card };
    // Generic cast_spell
    state.log.push(...this.fireTrigger(state, 'cast_spell', castData));
    // cast_noncreature
    if (!CardEngine.isCreature(card)) {
      state.log.push(...this.fireTrigger(state, 'cast_noncreature', castData));
    }
    // cast_colorless (no colored mana in cost)
    if (card.mana_cost && !/\{[WUBRG]\}/.test(card.mana_cost)) {
      state.log.push(...this.fireTrigger(state, 'cast_colorless', castData));
    }
    // cast_noncreature_or_dragon
    if (!CardEngine.isCreature(card) || CardEngine.hasCreatureType(card, 'Dragon')) {
      state.log.push(...this.fireTrigger(state, 'cast_noncreature_or_dragon', castData));
    }
    // cast_with_another_spell (second+ spell)
    if ((state._spellsThisTurn[playerId] || 0) >= 2) {
      state.log.push(...this.fireTrigger(state, 'cast_with_another_spell', castData));
    }
    // creature_enters_cast (creature spell was cast)
    if (CardEngine.isCreature(card) && CardEngine.isPermanent(card)) {
      state.log.push(...this.fireTrigger(state, 'creature_enters_cast', castData));
    }

    this._checkWinner(state);
    return { success: true };
  },

  /**
   * Smart mana ability activation: automatically activates mana abilities from creatures
   * Taps creatures with mana abilities, prioritizes single-color before multi-color
   * Does NOT require user input - auto-resolves mana choices based on needs
   */
  _smartActivateManaAbilities(state, playerId, manaCostNeeded, cmc) {
    const bf = state.players[playerId].zones.battlefield;
    const currentPool = { ...state.manaPool[playerId] };

    // Parse what we need
    const cost = ManaSystem.parseCost(manaCostNeeded);
    let coloredNeeded = { ...cost.colored };
    let genericNeeded = cost.generic;

    // Handle hybrid mana
    if (cost.hybrids && cost.hybrids.length > 0) {
      const bestCombo = this._findBestHybridCombo(cost.hybrids, currentPool);
      for (const choice of bestCombo) {
        if (/^\d+$/.test(choice)) {
          genericNeeded += parseInt(choice);
        } else if (coloredNeeded[choice] !== undefined) {
          coloredNeeded[choice]++;
        }
      }
    }

    // Check what the pool already covers
    for (const [color, amount] of Object.entries(coloredNeeded)) {
      const fromPool = Math.min(currentPool[color] || 0, amount);
      coloredNeeded[color] = amount - fromPool;
      currentPool[color] = (currentPool[color] || 0) - fromPool;
    }

    let poolRemainingForGeneric = Object.values(currentPool).reduce((a, b) => a + b, 0);
    let genericNeeded_actual = Math.max(0, genericNeeded - poolRemainingForGeneric);

    // If nothing needed, return early
    if (Object.values(coloredNeeded).every(v => v <= 0) && genericNeeded_actual <= 0) {
      return;
    }

    // Collect creatures with mana abilities that CAN be tapped
    const creatures = bf.cards.filter(c => CardEngine.isCreature(c) && !c._tapped);
    const manaCreatures = [];

    for (const creature of creatures) {
      const manaAbilities = CardEngine.getManaAbilities(creature);
      for (let abilityIdx = 0; abilityIdx < manaAbilities.length; abilityIdx++) {
        const ability = manaAbilities[abilityIdx];

        // Check if this ability can be used
        if (!this._canUseAbility(state, playerId, creature, ability)) continue;

        // Determine what colors this ability CAN produce (possibilities)
        const producedColors = this._getAbilityManaProduction(ability);
        if (producedColors.length === 0) continue;

        // Count unique colors produced
        const uniqueColors = [...new Set(producedColors)];

        manaCreatures.push({
          creature,
          ability,
          abilityIdx,
          producedColors,
          complexity: uniqueColors.length, // 1 for single-color, 3 for {WUB}, etc
        });
      }
    }

    // Sort by complexity: single-color first (lower = simpler)
    manaCreatures.sort((a, b) => a.complexity - b.complexity);

    // Greedily activate creatures to meet mana needs
    for (const manaSource of manaCreatures) {
      // Check if we still need mana
      const stillNeedColored = Object.values(coloredNeeded).some(v => v > 0);
      const stillNeedGeneric = genericNeeded_actual > 0;
      if (!stillNeedColored && !stillNeedGeneric) break;

      const creature = manaSource.creature;
      const ability = manaSource.ability;

      // Tap the creature ONLY if ability requires it
      if (ability.cost && ability.cost.tap) {
        creature._tapped = true;
        state.log.push(`${creature.name} foi virado para gerar mana.`);
      }

      // Resolve the mana generation
      // If ability requires choice, pick color based on needs
      for (const effect of ability.effects) {
        if (effect.type === 'add_mana') {
          if (effect.colors && Array.isArray(effect.colors)) {
            // Multiple colors to choose from - pick the one most needed
            const color = this._pickMostNeededColor(effect.colors, coloredNeeded);
            state.manaPool[playerId][color] = (state.manaPool[playerId][color] || 0) + 1;
          } else if (effect.color) {
            // Handle color string like "WBG" with choose
            if (effect.choose && effect.color.length > 1) {
              const colors = effect.color.split('');
              const color = this._pickMostNeededColor(colors, coloredNeeded);
              const amount = effect.amount || 1;
              state.manaPool[playerId][color] = (state.manaPool[playerId][color] || 0) + amount;
            } else {
              // Single color or "any"
              const color = effect.color === 'any' ? this._pickMostNeededColor(['W','U','B','R','G'], coloredNeeded) : effect.color;
              const amount = effect.amount || 1;
              state.manaPool[playerId][color] = (state.manaPool[playerId][color] || 0) + amount;
            }
          }
        }
      }

      // Recalculate what we still need
      const newPool = state.manaPool[playerId];
      for (const [color, amount] of Object.entries(coloredNeeded)) {
        const fromPool = Math.min(newPool[color] || 0, amount);
        coloredNeeded[color] = amount - fromPool;
        newPool[color] = (newPool[color] || 0) - fromPool;
      }

      let poolRem = Object.values(newPool).reduce((a, b) => a + b, 0);
      genericNeeded_actual = Math.max(0, genericNeeded - poolRem);
    }
  },

  /**
   * Pick the most needed color from options
   */
  _pickMostNeededColor(colors, coloredNeeded) {
    // Find which of these colors is most needed
    let bestColor = colors[0];
    let highestNeed = coloredNeeded[bestColor] || 0;

    for (const color of colors) {
      const need = coloredNeeded[color] || 0;
      if (need > highestNeed) {
        bestColor = color;
        highestNeed = need;
      }
    }

    return bestColor;
  },

  /**
   * Check if an ability can be activated (meets cost/condition requirements)
   */
  _canUseAbility(state, playerId, creature, ability) {
    // Check if creature is tapped
    if (creature._tapped) return false;

    // Skip if requires sacrifice/discard (too complex for auto-tap)
    if (ability.cost && (ability.cost.sacrifice || ability.cost.discard)) {
      return false;
    }

    // Check conditions (like control_dragon)
    if (ability.condition) {
      if (!this._checkEffectCondition(state, playerId, ability.condition)) return false;
    }

    return true;
  },

  /**
   * Extract possible colors that an ability can produce
   */
  _getAbilityManaProduction(ability) {
    if (!ability.effects || !Array.isArray(ability.effects)) return [];

    const colors = new Set();
    for (const effect of ability.effects) {
      if (effect.type === 'add_mana') {
        if (effect.colors && Array.isArray(effect.colors)) {
          effect.colors.forEach(c => colors.add(c));
        } else if (effect.color) {
          if (effect.color === 'any') {
            ['W','U','B','R','G'].forEach(c => colors.add(c));
          } else if (effect.color.length > 1) {
            effect.color.split('').forEach(c => colors.add(c));
          } else {
            colors.add(effect.color);
          }
        }
      }
    }
    return Array.from(colors);
  },

  autoTapForSpell(state, playerId, manaCost, cmc, convokeCard) {
    // If the card has convoke, tap creatures first (adds mana to pool)
    if (convokeCard && CardEngine.hasConvoke(convokeCard)) {
      const convoked = ManaSystem.autoConvoke(state, playerId, manaCost, cmc);
      if (convoked > 0) {
        state.log.push(`Convocou ${convoked} criatura(s) para ajudar a pagar.`);
      }
    }

    // Smart activation: tap creatures with mana abilities if needed
    this._smartActivateManaAbilities(state, playerId, manaCost, cmc);

    const cost = ManaSystem.parseCost(manaCost);

    // If mana_cost is empty but cmc > 0, tap cmc lands as generic
    if (cost.total === 0 && cmc && cmc > 0) {
      cost.generic = cmc;
      cost.total = cmc;
    }
    // Safety: if parsed total < cmc, increase generic to match
    if (cmc && cmc > 0 && cost.total < cmc) {
      const diff = cmc - cost.total;
      cost.generic += diff;
      cost.total = cmc;
    }

    // For hybrid mana: find the best combination to pay with available mana
    let finalColoredNeeded = { ...cost.colored };
    let finalGenericNeeded = cost.generic;

    if (cost.hybrids && cost.hybrids.length > 0) {
      // Try to find the best hybrid combination based on available mana
      const currentPool = { ...state.manaPool[playerId] };
      const bestCombo = this._findBestHybridCombo(cost.hybrids, currentPool);

      // Process the best combination
      for (const choice of bestCombo) {
        if (/^\d+$/.test(choice)) {
          finalGenericNeeded += parseInt(choice);
        } else if (finalColoredNeeded[choice] !== undefined) {
          finalColoredNeeded[choice]++;
        }
      }
    }

    // First, check what the existing pool already covers
    const currentPool = { ...state.manaPool[playerId] };
    const coloredNeeded = {};

    for (const [color, amount] of Object.entries(finalColoredNeeded)) {
      const fromPool = Math.min(currentPool[color] || 0, amount);
      coloredNeeded[color] = amount - fromPool;
      currentPool[color] = (currentPool[color] || 0) - fromPool;
    }

    // Calculate how much generic the pool can cover
    let poolRemainingForGeneric = Object.values(currentPool).reduce((a, b) => a + b, 0);
    let genericNeeded = Math.max(0, finalGenericNeeded - poolRemainingForGeneric);

    const bf = state.players[playerId].zones.battlefield;
    const lands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const tapped = [];

    // First pass: tap for colored requirements not covered by pool
    // Prefer single-color lands first (save multi-color for generic)
    for (const [color, amount] of Object.entries(coloredNeeded)) {
      let remaining = amount;
      // First try single-color lands
      for (const land of lands) {
        if (remaining <= 0) break;
        if (land._tapped) continue;
        const produces = ManaSystem.getLandManaColors(land);
        if (produces.includes(color) && produces.length === 1) {
          this.tapLandForMana(state, playerId, land._uid, color);
          tapped.push(land._uid);
          remaining--;
        }
      }
      // Then multi-color lands
      for (const land of lands) {
        if (remaining <= 0) break;
        if (land._tapped) continue;
        const produces = ManaSystem.getLandManaColors(land);
        if (produces.includes(color) && produces.length > 1) {
          this.tapLandForMana(state, playerId, land._uid, color);
          tapped.push(land._uid);
          remaining--;
        }
      }
    }

    // Second pass: tap for remaining generic needs
    // Smart ordering: basic lands first, dual/utility lands last (preserves flexibility)
    const genericLands = lands.filter(l => !l._tapped).sort((a, b) => {
      const aColors = ManaSystem.getLandManaColors(a).length;
      const bColors = ManaSystem.getLandManaColors(b).length;
      return aColors - bColors; // Single-color first, multi-color last
    });
    for (const land of genericLands) {
      if (genericNeeded <= 0) break;
      if (land._tapped) continue;
      this.tapLandForMana(state, playerId, land._uid);
      tapped.push(land._uid);
      genericNeeded--;
    }

    return tapped;
  },

  _findBestHybridCombo(hybrids, availablePool) {
    // Generate all possible hybrid combinations
    const hybridCombinations = ManaSystem._generateHybridCombinations(hybrids);

    // Score each combination based on how much colored mana it requires
    let bestCombo = hybridCombinations[0]; // Default to first
    let lowestColorNeeded = Infinity;

    for (const combo of hybridCombinations) {
      let colorNeeded = 0;

      for (const choice of combo) {
        if (!/^\d+$/.test(choice)) {
          // This is a color choice (G, U, R, W, B)
          colorNeeded++;
        }
      }

      // Prefer combinations with fewer color requirements
      if (colorNeeded < lowestColorNeeded) {
        lowestColorNeeded = colorNeeded;
        bestCombo = combo;
      }
    }

    return bestCombo;
  },

  // Dry-run: returns UIDs of lands that WOULD be tapped, without modifying state
  previewAutoTap(state, playerId, manaCost, cmc) {
    const cost = ManaSystem.parseCost(manaCost);
    if (cost.total === 0 && cmc && cmc > 0) { cost.generic = cmc; cost.total = cmc; }
    if (cmc && cmc > 0 && cost.total < cmc) { cost.generic += (cmc - cost.total); cost.total = cmc; }

    // For hybrid mana: find the best combination to pay with available mana
    let finalColoredNeeded = { ...cost.colored };
    let finalGenericNeeded = cost.generic;

    if (cost.hybrids && cost.hybrids.length > 0) {
      const currentPool = { ...state.manaPool[playerId] };
      const bestCombo = this._findBestHybridCombo(cost.hybrids, currentPool);

      for (const choice of bestCombo) {
        if (/^\d+$/.test(choice)) {
          finalGenericNeeded += parseInt(choice);
        } else if (finalColoredNeeded[choice] !== undefined) {
          finalColoredNeeded[choice]++;
        }
      }
    }

    const currentPool = { ...state.manaPool[playerId] };
    const coloredNeeded = {};
    for (const [color, amount] of Object.entries(finalColoredNeeded)) {
      const fromPool = Math.min(currentPool[color] || 0, amount);
      coloredNeeded[color] = amount - fromPool;
      currentPool[color] = (currentPool[color] || 0) - fromPool;
    }
    let poolRemainingForGeneric = Object.values(currentPool).reduce((a, b) => a + b, 0);
    let genericNeeded = Math.max(0, finalGenericNeeded - poolRemainingForGeneric);

    const bf = state.players[playerId].zones.battlefield;
    const lands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const wouldTap = new Set();

    // Simulate colored tapping
    for (const [color, amount] of Object.entries(coloredNeeded)) {
      let remaining = amount;
      for (const land of lands) {
        if (remaining <= 0) break;
        if (wouldTap.has(land._uid)) continue;
        const produces = ManaSystem.getLandManaColors(land);
        if (produces.includes(color) && produces.length === 1) { wouldTap.add(land._uid); remaining--; }
      }
      for (const land of lands) {
        if (remaining <= 0) break;
        if (wouldTap.has(land._uid)) continue;
        const produces = ManaSystem.getLandManaColors(land);
        if (produces.includes(color) && produces.length > 1) { wouldTap.add(land._uid); remaining--; }
      }
    }
    // Simulate generic tapping
    for (const land of lands) {
      if (genericNeeded <= 0) break;
      if (wouldTap.has(land._uid)) continue;
      wouldTap.add(land._uid);
      genericNeeded--;
    }
    return [...wouldTap];
  },

  // Update _vividPowerValue for all vivid creatures of a player
  _updateVividCreatures(state, playerId) {
    const colorCount = CardEngine.countVividColors(state, playerId);
    state.players[playerId].zones.battlefield.cards.forEach(c => {
      if (c._vividPower) {
        c._vividPowerValue = colorCount;
      }
    });
  },

  // Update _dynamicPower for creatures with power_equals static (e.g. Zurgo's Vanguard)
  _updateDynamicPower(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const creatureCount = bf.cards.filter(c => CardEngine.isCreature(c)).length;
    bf.cards.forEach(c => {
      if (c._powerEqualsCreatureCount) {
        c._dynamicPower = creatureCount;
      }
    });
  },

  // Update dynamic static abilities (called when game state changes)
  _updateDynamicStaticAbilities(state) {
    for (let pid = 0; pid < 2; pid++) {
      const battlefield = state.players[pid].zones.battlefield.cards;
      for (const card of battlefield) {
        const db = CardEngine.getPreprocessedEffects(card);
        if (!db || !db.static) continue;

        for (const s of db.static) {
          if (s.type === 'grant' && s.target === 'self' && s.condition) {
            const conditionMet = this._checkEffectCondition(state, pid, s);
            const kw = s.keyword;
            if (!kw) continue;

            const kwCap = kw.charAt(0).toUpperCase() + kw.slice(1);

            // Ensure keywords array exists
            if (!card.keywords) card.keywords = [];

            if (conditionMet) {
              // Add keyword if condition is met
              if (!card.keywords.includes(kwCap)) {
                card.keywords.push(kwCap);
              }
            } else {
              // Remove keyword if condition is not met
              const index = card.keywords.indexOf(kwCap);
              if (index > -1) {
                card.keywords.splice(index, 1);
              }
            }
          }
        }
      }
    }
  },

  // Apply static abilities from DB when a permanent enters the battlefield
  _applyStaticOnETB(state, card, playerId) {
    const db = CardEngine.getPreprocessedEffects(card);
    if (!db || !db.static) return;
    for (const s of db.static) {
      switch (s.type) {
        case 'unblockable':
          card._unblockable = true;
          break;
        case 'power_equals':
          if (s.source === 'creature_count') {
            card._powerEqualsCreatureCount = true;
            const creatureCount = state.players[playerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length;
            card._dynamicPower = creatureCount;
          }
          break;
        case 'etb_counters_if_second_spell':
          if ((state._spellsThisTurn[playerId] || 0) >= 2) {
            if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
            card._counters[s.counter || '+1/+1'] += (s.amount || 2);
            state.log.push(`${card.name} recebe ${s.amount || 2} counters ${s.counter || '+1/+1'} (segunda spell do turno).`);
          }
          break;
        case 'grant_flash':
          card._grantFlash = s.target || 'all';
          break;
        case 'prevent_opponent_casting':
          card._preventOpponentCasting = s.condition || true;
          break;
        case 'warrior_tokens_protected_end_step':
          card._warriorTokensProtected = true;
          break;
        case 'has_keyword':
          if (!card.keywords) card.keywords = [];
          if (s.keyword && !card.keywords.includes(s.keyword)) {
            card.keywords.push(s.keyword);
          }
          if (s.keywords) {
            for (const kw of s.keywords) {
              if (!card.keywords.includes(kw)) card.keywords.push(kw);
            }
          }
          break;
        case 'cost_reduction':
          card._costReduction = { target: s.target, reduction: s.reduction || s.amount, condition: s.condition };
          break;
        case 'token_doubling':
          card._tokenDoubling = true;
          break;
        case 'double_damage':
          card._doubleDamage = s.target || 'creatures_entered_this_turn';
          break;
        case 'buff_all': {
          // Anthem-like static: buff all matching creatures
          // Check condition first
          if (s.condition && !this._checkEffectCondition(state, playerId, s)) {
            break;
          }
          const target = s.target || 'own_creatures';
          if (!card._anthem) card._anthem = [];
          card._anthem.push({ power: s.power || 0, toughness: s.toughness || 0, target, keywords: s.keywords });
          // Apply keywords if specified
          if (s.keywords) {
            for (const kw of s.keywords) {
              if (!card.keywords) card.keywords = [];
              if (!card.keywords.includes(kw)) card.keywords.push(kw);
            }
          }
          // Apply to existing creatures
          const pBf = state.players[playerId].zones.battlefield.cards;
          for (const c of pBf) {
            if (c._uid === card._uid) continue;
            if (!CardEngine.isCreature(c)) continue;
            const matches = target === 'own_creatures' ||
              (target === 'other_dragons' && CardEngine.hasCreatureType(c, 'Dragon'));
            if (matches) {
              c._powerMod = (c._powerMod || 0) + (s.power || 0);
              c._toughnessMod = (c._toughnessMod || 0) + (s.toughness || 0);
              // Apply keywords to creatures if specified
              if (s.keywords) {
                if (!c.keywords) c.keywords = [];
                for (const kw of s.keywords) {
                  if (!c.keywords.includes(kw)) c.keywords.push(kw);
                }
              }
            }
          }
          break;
        }
        case 'grant_all': {
          // Grant keyword to all matching creatures
          const gTarget = s.target || 'own_creatures';
          if (!card._grantAllKeyword) card._grantAllKeyword = [];
          card._grantAllKeyword.push({ keyword: s.keyword, target: gTarget });
          // Apply to existing creatures
          const pBf2 = state.players[playerId].zones.battlefield.cards;
          for (const c of pBf2) {
            if (c._uid === card._uid) continue;
            if (!CardEngine.isCreature(c)) continue;
            const matches = gTarget === 'own_creatures' ||
              (gTarget === 'other_dragons' && CardEngine.hasCreatureType(c, 'Dragon'));
            if (matches && s.keyword) {
              if (!c.keywords) c.keywords = [];
              if (!c.keywords.includes(s.keyword)) c.keywords.push(s.keyword);
            }
          }
          break;
        }
        case 'grant': {
          // Grant keyword/buff to specific target type
          if (s.target === 'equipped' || s.target === 'self') break; // handled by equipment/aura system
          if (s.target === 'attacking_tokens') {
            card._grantAttackingTokens = s.keyword;
          } else if (s.target === 'dragons') {
            card._grantDragons = s.keyword;
          }
          break;
        }
        case 'aura_debuff':
          // Debuff on enchanted creature (applied when aura attaches)
          break;
        case 'prevent_activated_abilities':
          card._preventActivatedAbilities = s.target || 'all';
          break;
        case 'enters_tapped_conditional':
          // Mark that this land should enter tapped unless condition is met
          // For tribal lands, they enter tapped unless you control the right creature type
          card._entersTappedConditional = true;
          if (s.unless && Array.isArray(s.unless)) {
            card._entersTappedCondition = s.unless;
          }
          break;
        case 'enters_tapped':
          // Mark that this land always enters tapped
          card._entersTapped = true;
          break;
        case 'conditional_buff':
          // Buff that applies when condition is met
          card._conditionalBuff = {
            power: s.power || 0,
            toughness: s.toughness || 0,
            condition: s.condition
          };
          break;
        case 'dragon_etb_counter':
          // Mark artifacts that grant counters to dragons when they enter
          card._dragonETBCounter = true;
          break;
      }
    }
  },

  _endOfTurnCleanup(state) {
    // Clear temporary triggers (they last only this turn)
    if (state._tempTriggers) {
      state._tempTriggers = state._tempTriggers.filter(t => t.duration !== 'this_turn');
    }

    // Clear damage on creatures and reset temporary buffs
    state.players.forEach(p => {
      p.zones.battlefield.cards.forEach(c => {
        if (CardEngine.isCreature(c)) {
          c._damage = 0;
          // Reset temporary power/toughness mods (from spells like +2/+2 until end of turn)
          // Only reset if not from aura/equipment (those are permanent)
          if (c._tempPowerMod) {
            c._powerMod = (c._powerMod || 0) - c._tempPowerMod;
            c._tempPowerMod = 0;
          }
          if (c._tempToughnessMod) {
            c._toughnessMod = (c._toughnessMod || 0) - c._tempToughnessMod;
            c._tempToughnessMod = 0;
          }
          // Clear cant block restriction
          if (c._cantBlockThisTurn) delete c._cantBlockThisTurn;
          // Clear regeneration shield
          if (c._regenerateShield) delete c._regenerateShield;
          // Clear damage tracking (for Unsparing Boltcaster, etc.)
          if (c._damagedThisTurn) delete c._damagedThisTurn;
          // Clear "entered this turn" tracking (for Neriv double damage, etc.)
          if (c._enteredThisTurn) delete c._enteredThisTurn;
        }
        // Clear temporary granted keywords (from grant/grant_all effects)
        if (c._tempKeywords && c._tempKeywords.length > 0) {
          const expiredKeywords = [];
          c._tempKeywords = c._tempKeywords.filter(kwObj => {
            // Handle legacy format (string) and new format (object)
            if (typeof kwObj === 'string') {
              // Legacy: remove immediately (end_of_turn)
              expiredKeywords.push(kwObj);
              return false;
            }

            // New format: check duration
            const shouldExpire = kwObj.duration === 'end_of_turn' ||
              (kwObj.duration === 'next_turn' && state.turn > kwObj.appliedTurn + 1);

            if (shouldExpire) {
              expiredKeywords.push(kwObj.keyword);
              return false;
            }
            return true;
          });

          // Remove expired keywords from the creature
          expiredKeywords.forEach(kw => {
            const idx = (c.keywords || []).indexOf(kw);
            if (idx >= 0) c.keywords.splice(idx, 1);
          });
        }
      });
    });
    // Reset planeswalker loyalty ability usage
    state.players.forEach(p => {
      p.zones.battlefield.cards.forEach(c => {
        if (CardEngine.isPlaneswalker(c)) {
          c._loyaltyUsedThisTurn = false;
        }
      });
    });
    // Clear drew-extra tracking
    state._drewExtraThisTurn = null;
    // Clear exiled playable cards based on duration
    // IMPORTANT: Cards without explicit duration (like exile_top_play) stay exiled indefinitely
    if (state._exiledPlayable) {
      const expiredExiled = [];
      for (const uid of Object.keys(state._exiledPlayable)) {
        const entry = state._exiledPlayable[uid];
        // Only expire if duration is explicitly set to end_of_turn or expired next_turn
        const shouldExpire = entry.duration === 'end_of_turn' ||
          (entry.duration === 'next_turn' && state.turn > entry.turn + 1);

        if (shouldExpire) {
          expiredExiled.push(uid);
        }
      }

      // Remove expired entries
      expiredExiled.forEach(uid => delete state._exiledPlayable[uid]);

      // Clean up empty object
      if (Object.keys(state._exiledPlayable).length === 0) {
        state._exiledPlayable = null;
      }
    }
    // Sacrifice Mobilize tokens (sacrifice at end step)
    // warrior_tokens_protected: if controller has a permanent with _warriorTokensProtected, skip Warrior tokens
    state.players.forEach((p, pid) => {
      const hasWarriorProtector = p.zones.battlefield.cards.some(c => c._warriorTokensProtected);
      const toSacrifice = p.zones.battlefield.cards.filter(c => {
        if (!c._sacrificeAtEndStep) return false;
        // Zurgo protects Warrior tokens from end-of-turn sacrifice
        if (hasWarriorProtector && c._isToken && (c.name || '').toLowerCase().includes('warrior')) {
          c._sacrificeAtEndStep = false; // Clear the flag — they're kept permanently
          return false;
        }
        return true;
      });
      toSacrifice.forEach(c => {
        p.zones.battlefield.remove(c._uid);
        this._unregisterCardTriggers(state, c._uid);
        state.log.push(`${c.name} e sacrificado (Mobilize).`);
      });
    });
    // Return stolen creatures (threaten effect)
    state.players.forEach((p, pid) => {
      const stolen = p.zones.battlefield.cards.filter(c => c._stolenFrom !== undefined);
      stolen.forEach(c => {
        p.zones.battlefield.remove(c._uid);
        const originalOwner = c._stolenFrom;
        delete c._stolenFrom;
        // Remove temporary keywords
        if (c._tempKeywords) {
          c._tempKeywords.forEach(kwObj => {
            const keyword = typeof kwObj === 'string' ? kwObj : kwObj.keyword;
            const idx = (c.keywords || []).indexOf(keyword);
            if (idx >= 0) c.keywords.splice(idx, 1);
          });
          delete c._tempKeywords;
        }
        c._tapped = true;
        state.players[originalOwner].zones.battlefield.add(c);
        state.log.push(`${c.name} volta ao controle do dono original.`);
      });
    });
    // Reset damage prevention shields
    state._damageShield = null;
    // Reset damage dealt this turn tracking (for hideaway conditions)
    state._damageDealtThisTurn = null;
    // Reset effect condition tracking
    state._lastDiscardedNonland = null;
    state._exiledThisResolution = false;
    state._cardLeftGraveyardThisTurn = null;
    // Reset priority flag
    state._priorityPassed = false;
  },

  _checkWinner(state) {
    if (state.players[0].life <= 0) {
      state.winner = 1;
      state.log.push('Voce perdeu! Sua vida chegou a 0.');
    } else if (state.players[1].life <= 0) {
      state.winner = 0;
      state.log.push('Voce venceu! Vida do oponente chegou a 0!');
    }
  },

  // === Planeswalker system ===

  activateLoyaltyAbility(state, playerId, cardUid, abilityIndex) {
    const bf = state.players[playerId].zones.battlefield;
    const card = bf.get(cardUid);
    if (!card || !CardEngine.isPlaneswalker(card)) {
      return { success: false, msg: 'Planeswalker nao encontrado.' };
    }

    // Only in main phase at sorcery speed
    if (state.phase !== 'main1' && state.phase !== 'main2') {
      return { success: false, msg: 'So pode ativar na fase principal.' };
    }

    // Once per turn per planeswalker
    if (card._loyaltyUsedThisTurn) {
      return { success: false, msg: 'Ja usou habilidade de lealdade neste turno.' };
    }

    const abilities = CardEngine.getLoyaltyAbilities(card);
    if (abilityIndex >= abilities.length) {
      return { success: false, msg: 'Habilidade invalida.' };
    }

    const ability = abilities[abilityIndex];
    const loyaltyCost = ability.cost.loyalty;

    // For negative costs, check if we have enough loyalty
    if (typeof loyaltyCost === 'number' && loyaltyCost < 0) {
      if ((card._loyalty || 0) + loyaltyCost < 0) {
        return { success: false, msg: 'Lealdade insuficiente.' };
      }
    }

    // Pay loyalty cost (positive = add, negative = remove, 0 = no change)
    if (typeof loyaltyCost === 'number') {
      card._loyalty = (card._loyalty || 0) + loyaltyCost;
    }
    card._loyaltyUsedThisTurn = true;

    const playerLabel = playerId === 0 ? 'Voce' : 'Oponente';
    const costLabel = loyaltyCost >= 0 ? `+${loyaltyCost}` : `${loyaltyCost}`;
    state.log.push(`${playerLabel} ativa ${card.name} (${costLabel}): lealdade ${card._loyalty}.`);

    // Resolve effects
    for (const effect of ability.effects) {
      const result = this._resolveSimpleEffect(state, playerId, effect, { cardUid: card._uid, card });
      if (result) state.log.push(result);
    }

    // Check if planeswalker dies (loyalty <= 0)
    this._checkPlaneswalkerDeath(state, card, playerId);

    return { success: true };
  },

  _checkPlaneswalkerDeath(state, card, playerId) {
    if (!CardEngine.isPlaneswalker(card)) return;
    if ((card._loyalty || 0) <= 0) {
      const bf = state.players[playerId].zones.battlefield;
      bf.remove(card._uid);
      state.players[playerId].zones.graveyard.add(card);
      this._unregisterCardTriggers(state, card._uid);
      state.log.push(`${card.name} foi para o cemiterio (lealdade 0).`);
      // VFX
      if (typeof VFX !== 'undefined') {
        VFX.death(card._uid);
      }
    }
  },

  // Deal damage to a planeswalker (from spells/combat)
  damagePlaneswalker(state, card, amount, playerId) {
    if (!card || !CardEngine.isPlaneswalker(card)) return;
    card._loyalty = Math.max(0, (card._loyalty || 0) - amount);
    state.log.push(`${card.name} recebe ${amount} de dano (lealdade ${card._loyalty}).`);
    this._checkPlaneswalkerDeath(state, card, playerId);
  },

  // === Aura system ===

  _applyAuraEffects(aura, creature) {
    const effects = CardEngine.parseAuraEffects(aura);
    effects.forEach(e => {
      if (e.type === 'buff') {
        creature._powerMod = (creature._powerMod || 0) + e.power;
        creature._toughnessMod = (creature._toughnessMod || 0) + e.toughness;
      }
      if (e.type === 'grant_keyword') {
        if (!creature.keywords) creature.keywords = [];
        if (!creature.keywords.includes(e.keyword)) creature.keywords.push(e.keyword);
        if (!creature._grantedKeywords) creature._grantedKeywords = [];
        creature._grantedKeywords.push(e.keyword);
      }
    });
    // Check DB for aura_prevent_untap static
    const db = CardEngine.getPreprocessedEffects(aura);
    if (db && db.static) {
      for (const s of db.static) {
        if (s.type === 'aura_prevent_untap') creature._preventUntap = true;
        if (s.type === 'loses_abilities') {
          // Store original abilities and remove all
          if (!creature._suppressedAbilities) {
            creature._suppressedAbilities = {
              keywords: creature.keywords ? [...creature.keywords] : [],
              triggers: creature._triggers ? [...creature._triggers] : [],
              activated: creature._activatedAbilities ? [...creature._activatedAbilities] : []
            };
          }
          creature.keywords = [];
          creature._triggers = [];
          creature._activatedAbilities = [];
          creature._losesAllAbilities = true;
        }
      }
    }
  },

  _removeAuraEffects(aura, creature) {
    const effects = CardEngine.parseAuraEffects(aura);
    effects.forEach(e => {
      if (e.type === 'buff') {
        creature._powerMod = (creature._powerMod || 0) - e.power;
        creature._toughnessMod = (creature._toughnessMod || 0) - e.toughness;
      }
      if (e.type === 'grant_keyword' && creature._grantedKeywords) {
        const idx = creature._grantedKeywords.indexOf(e.keyword);
        if (idx >= 0) {
          creature._grantedKeywords.splice(idx, 1);
          const kwIdx = (creature.keywords || []).indexOf(e.keyword);
          if (kwIdx >= 0) creature.keywords.splice(kwIdx, 1);
        }
      }
    });
    // Remove aura_prevent_untap and loses_abilities
    const db = CardEngine.getPreprocessedEffects(aura);
    if (db && db.static) {
      for (const s of db.static) {
        if (s.type === 'aura_prevent_untap') delete creature._preventUntap;
        if (s.type === 'loses_abilities' && creature._suppressedAbilities) {
          // Restore original abilities
          creature.keywords = creature._suppressedAbilities.keywords;
          creature._triggers = creature._suppressedAbilities.triggers;
          creature._activatedAbilities = creature._suppressedAbilities.activated;
          delete creature._suppressedAbilities;
          delete creature._losesAllAbilities;
        }
      }
    }
  },

  // Equipment system
  equipCreature(state, playerId, equipmentUid, creatureUid) {
    const bf = state.players[playerId].zones.battlefield;
    const equipment = bf.get(equipmentUid);
    const creature = bf.get(creatureUid);
    if (!equipment || !creature || !CardEngine.isEquipment(equipment) || !CardEngine.isCreature(creature)) return false;

    // Unequip from previous creature
    if (equipment._attachedTo) {
      const oldCreature = bf.get(equipment._attachedTo);
      if (oldCreature) {
        this._removeEquipmentEffects(equipment, oldCreature);
        if (oldCreature._attachments) {
          oldCreature._attachments = oldCreature._attachments.filter(uid => uid !== equipmentUid);
        }
      }
    }

    // Equip to new creature
    equipment._attachedTo = creatureUid;
    if (!creature._attachments) creature._attachments = [];
    creature._attachments.push(equipmentUid);
    this._applyEquipmentEffects(equipment, creature);
    state.log.push(`${equipment.name} equipado em ${creature.name}.`);
    return true;
  },

  _applyEquipmentEffects(equip, creature) {
    const effects = CardEngine.parseEquipmentEffects(equip);
    effects.forEach(e => {
      if (e.type === 'buff') {
        creature._powerMod = (creature._powerMod || 0) + e.power;
        creature._toughnessMod = (creature._toughnessMod || 0) + e.toughness;
      }
      if (e.type === 'grant_keyword') {
        if (!creature.keywords) creature.keywords = [];
        if (!creature.keywords.includes(e.keyword)) creature.keywords.push(e.keyword);
        if (!creature._grantedKeywords) creature._grantedKeywords = [];
        creature._grantedKeywords.push(e.keyword);
      }
    });
  },

  _removeEquipmentEffects(equip, creature) {
    const effects = CardEngine.parseEquipmentEffects(equip);
    effects.forEach(e => {
      if (e.type === 'buff') {
        creature._powerMod = (creature._powerMod || 0) - e.power;
        creature._toughnessMod = (creature._toughnessMod || 0) - e.toughness;
      }
      if (e.type === 'grant_keyword' && creature._grantedKeywords) {
        const idx = creature._grantedKeywords.indexOf(e.keyword);
        if (idx >= 0) {
          creature._grantedKeywords.splice(idx, 1);
          const kwIdx = (creature.keywords || []).indexOf(e.keyword);
          if (kwIdx >= 0) creature.keywords.splice(kwIdx, 1);
        }
      }
    });
  },

  // === Creature death with triggers and indestructible ===

  creatureDies(state, card, ownerId) {
    // Check indestructible
    if (CardEngine.hasIndestructible(card)) return false;

    // Check regeneration shield
    if (card._regenerateShield) {
      delete card._regenerateShield;
      card._damage = 0;
      card._tapped = true;
      state.log.push(`${card.name} regenera! (Virado, dano removido.)`);
      return false;
    }

    // Check endure: if creature has endure keyword and +1/+1 counters, remove a counter instead of dying
    if (CardEngine.hasKeyword(card, 'Endure') && card._counters && card._counters['+1/+1'] > 0) {
      card._counters['+1/+1']--;
      card._damage = 0;
      state.log.push(`${card.name} endure! Remove um contador +1/+1 e sobrevive.`);
      if (typeof VFX !== 'undefined') VFX.buff(card._uid);
      return false;
    }

    // VFX: death animation
    if (typeof VFX !== 'undefined') VFX.death(card._uid);

    // Track creature death this turn (for trigger conditions)
    if (!state._creatureDiedThisTurn) state._creatureDiedThisTurn = {};
    state._creatureDiedThisTurn[ownerId] = true;

    // Fire dies trigger BEFORE moving to graveyard
    const dieLogs = this.fireTrigger(state, 'dies', { cardUid: card._uid, ownerId, card });
    state.log.push(...dieLogs);
    const anyDieLogs = this.fireTrigger(state, 'any_creature_dies', { cardUid: card._uid, ownerId, card });
    state.log.push(...anyDieLogs);
    // Fire other_creature_dies (for triggers like Anafenza that only fire for OTHER creatures dying)
    const otherDieLogs = this.fireTrigger(state, 'other_creature_dies', { cardUid: card._uid, ownerId, card });
    state.log.push(...otherDieLogs);
    // Fire leaves_battlefield
    const leaveLogs = this.fireTrigger(state, 'leaves_battlefield', { cardUid: card._uid, ownerId, card });
    state.log.push(...leaveLogs);

    // Return exiled creatures if this card had exiled any until it leaves (e.g., Stormplain Detainment)
    if (card._exiledUntilLeaves && card._exiledUntilLeaves.length > 0) {
      for (const exiledCard of card._exiledUntilLeaves) {
        if (exiledCard) {
          state.players[exiledCard._owner || ownerId].zones.exile.remove(exiledCard._uid);
          state.players[exiledCard._owner || ownerId].zones.battlefield.add(exiledCard);
          state.log.push(`${exiledCard.name} retorna ao campo de batalha.`);
        }
      }
      card._exiledUntilLeaves = [];
    }

    // Fire creature_dies_with_counters if it had +1/+1 counters
    if (card._counters && ((card._counters['+1/+1'] || 0) > 0 || (card._counters['-1/-1'] || 0) > 0)) {
      const counterDieLogs = this.fireTrigger(state, 'creature_dies_with_counters', { cardUid: card._uid, ownerId, card, hadCounters: true });
      state.log.push(...counterDieLogs);
    }

    // Remove from battlefield
    state.players[ownerId].zones.battlefield.remove(card._uid);

    // Update vivid creatures (board changed)
    this._updateVividCreatures(state, ownerId);
    // Update dynamic power creatures (board changed)
    this._updateDynamicPower(state, ownerId);

    // Unregister triggers
    this._unregisterCardTriggers(state, card._uid);

    // Handle attachments: auras go to graveyard, equipment stays on battlefield
    if (card._attachments) {
      card._attachments.forEach(attUid => {
        for (const p of state.players) {
          const att = p.zones.battlefield.get(attUid);
          if (att) {
            if (CardEngine.isEquipment(att)) {
              // Equipment falls off, stays on battlefield - remove stat buffs first
              this._removeEquipmentEffects(att, card);
              att._attachedTo = null;
            } else {
              // Auras go to graveyard - remove effects first
              this._removeAuraEffects(att, card);
              p.zones.battlefield.remove(attUid);
              p.zones.graveyard.add(att);
              this._unregisterCardTriggers(state, attUid);
              state.log.push(`${att.name} vai para o cemiterio.`);
            }
          }
        }
      });
      card._attachments = [];
    }

    // Move to graveyard (tokens just disappear)
    if (!card._isToken) {
      state.players[ownerId].zones.graveyard.add(card);
    }

    // Persist: if creature had persist and no -1/-1 counters, return with a -1/-1 counter
    if (CardEngine.hasKeyword(card, 'Persist') && !card._isToken) {
      const had = card._counters && card._counters['-1/-1'] > 0;
      if (!had) {
        // Remove from graveyard, return to battlefield with -1/-1 counter
        state.players[ownerId].zones.graveyard.remove(card._uid);
        card._damage = 0;
        card._tapped = false;
        card._summoningSick = true;
        if (!card._counters) card._counters = { '+1/+1': 0, '-1/-1': 0 };
        card._counters['-1/-1'] += 1;
        card._toughnessMod = (card._toughnessMod || 0) - 1;
        card._powerMod = (card._powerMod || 0) - 1;
        state.players[ownerId].zones.battlefield.add(card);
        state.log.push(`${card.name} retorna com persist! (-1/-1 counter)`);
        this._registerCardTriggers(state, card, ownerId);
        // Fire ETB triggers
        const etbEffects = CardEngine.getETBEffects(card);
        if (etbEffects.length > 0) {
          etbEffects.forEach(e => {
            const elog = this._resolveSimpleEffect(state, ownerId, e, { cardUid: card._uid });
            if (elog) state.log.push(elog);
          });
        }
        return true; // Still counts as died (triggers fired above)
      }
    }

    // Champion: return exiled card when champion leaves
    if (card._championedCard && card._championedPlayer !== undefined) {
      const exile = state.players[card._championedPlayer].zones.exile;
      if (exile) {
        const exiled = exile.remove(card._championedCard);
        if (exiled) {
          state.players[card._championedPlayer].zones.battlefield.add(exiled);
          exiled._summoningSick = true;
          state.log.push(`${exiled.name} retorna do exilio!`);
          this._registerCardTriggers(state, exiled, card._championedPlayer);
        }
      }
    }

    return true;
  },

  // === Transform ===

  transformCreature(state, playerId, cardUid) {
    const bf = state.players[playerId].zones.battlefield;
    const card = bf.get(cardUid);
    if (!card || !CardEngine.isTransformCard(card)) return { success: false, msg: 'Nao pode transformar.' };

    // Check if in main phase
    if (state.phase !== 'main1' && state.phase !== 'main2') {
      return { success: false, msg: 'So pode transformar na fase principal.' };
    }

    // Check transform cost
    const costStr = CardEngine.getTransformCost(card);
    if (costStr) {
      const cost = ManaSystem.parseCost(costStr);
      const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
      if (poolTotal < cost.total || !ManaSystem.canPay(state.manaPool[playerId], costStr, cost.total)) {
        // Try to auto-tap lands
        this.autoTapForSpell(state, playerId, costStr, cost.total);
        if (!ManaSystem.canPay(state.manaPool[playerId], costStr, cost.total)) {
          return { success: false, msg: 'Mana insuficiente para transformar.' };
        }
      }
      state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], costStr, cost.total);
    }

    const oldName = card.name;
    const result = CardEngine.transformCard(card);
    if (!result) return { success: false, msg: 'Falha ao transformar.' };

    const label = playerId === 0 ? 'Voce' : 'Oponente';
    state.log.push(`${label} transforma ${oldName} em ${card.name}!`);

    // Re-register triggers for new face
    this._unregisterCardTriggers(state, card._uid);
    this._registerCardTriggers(state, card, playerId);

    return { success: true };
  },

  // === Sacrifice ===

  sacrifice(state, playerId, cardUid) {
    const bf = state.players[playerId].zones.battlefield;
    const card = bf.get(cardUid);
    if (!card) return false;

    state.log.push(`${playerId === 0 ? 'Voce' : 'Oponente'} sacrifica ${card.name}.`);

    // Use creatureDies for creatures (fires triggers), direct remove for others
    if (CardEngine.isCreature(card)) {
      // Sacrifice bypasses indestructible - force remove
      const dieLogs = this.fireTrigger(state, 'dies', { cardUid: card._uid, ownerId: playerId, card });
      state.log.push(...dieLogs);
      const anyDieLogs = this.fireTrigger(state, 'any_creature_dies', { cardUid: card._uid, ownerId: playerId, card });
      state.log.push(...anyDieLogs);
    }

    this._unregisterCardTriggers(state, cardUid);
    bf.remove(cardUid);

    if (!card._isToken) {
      state.players[playerId].zones.graveyard.add(card);
    }
    return true;
  },

  // === Saga system ===

  _advanceSagaChapter(state, saga, playerId) {
    const logs = [];
    const chapters = CardEngine.getSagaChapters(saga);
    if (!chapters) return logs;

    saga._sagaChapter = (saga._sagaChapter || 0) + 1;
    const ch = saga._sagaChapter;
    const maxCh = saga._sagaMaxChapter || Math.max(...Object.keys(chapters).map(Number));
    const effects = chapters[ch];

    logs.push(`${saga.name} — Capitulo ${ch}${ch <= maxCh ? '' : ' (fim)'}`);

    if (effects && effects.length > 0) {
      // Check if any effect requires targeting
      const needsTargeting = effects.some(effect =>
        this._effectRequiresTargets(effect)
      );

      if (needsTargeting && playerId === 0) {
        // Human player needs to choose targets for saga chapter
        state._pendingSagaChapter = {
          saga: saga,
          chapter: ch,
          effects: effects,
          controller: playerId
        };
        state.waitingForInput = { type: 'choose_target', playerId: 0 };
        logs.push(`Escolha um alvo para ${saga.name} — Capitulo ${ch}.`);
        return logs;
      } else {
        // No targeting needed or AI auto-targeting
        let targets = [];
        if (needsTargeting && playerId === 1) {
          // AI targeting - choose best available target
          targets = this._aiChooseTargetsForEffects(state, playerId, effects);
        }

        // Resolve chapter effects through the stack
        GameStack.push(state.stack, { card: saga, controller: playerId, targets, effects: [...effects] });
        const stackLog = GameStack.resolve(state.stack, state);
        logs.push(...stackLog);
      }
    }

    // After last chapter, sacrifice the saga
    if (ch >= maxCh) {
      logs.push(`${saga.name} completa todos os capitulos e e sacrificada.`);
      this._unregisterCardTriggers(state, saga._uid);
      const bf = state.players[playerId].zones.battlefield;
      bf.remove(saga._uid);
      if (!saga._isToken) {
        state.players[playerId].zones.graveyard.add(saga);
      }
    }

    return logs;
  },

  // === Cycling from hand ===

  activateCycling(state, playerId, cardUid) {
    const hand = state.players[playerId].zones.hand;
    const card = hand.get(cardUid);
    if (!card) return { success: false, msg: 'Carta nao encontrada.' };

    const cycling = CardEngine.parseCyclingAbility(card);
    if (!cycling) return { success: false, msg: 'Carta nao tem cycling.' };

    // Check if can afford the cost (use actual mana cost string if available)
    const costStr = cycling.manaCost || `{${cycling.cost}}`;
    const fakeCard = { mana_cost: costStr, cmc: cycling.cost };
    if (!ManaSystem.canAfford(state, playerId, fakeCard)) {
      return { success: false, msg: `Mana insuficiente para cycling (custo: ${cycling.cost}).` };
    }

    // Pay cost
    this.autoTapForSpell(state, playerId, costStr, cycling.cost);
    state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], costStr, cycling.cost);

    // Discard the card
    hand.remove(cardUid);
    state.players[playerId].zones.graveyard.add(card);

    const playerLabel = playerId === 0 ? 'Voce' : 'Oponente';

    if (cycling.type === 'cycling') {
      // Basic cycling: draw a card
      const drawn = state.players[playerId].zones.library.drawFromTop();
      if (drawn) {
        state.players[playerId].zones.hand.add(drawn);
        state.log.push(`${playerLabel} faz cycling de ${card.name}, descarta e compra ${drawn.name}.`);
      } else {
        state.log.push(`${playerLabel} faz cycling de ${card.name}, descarta mas o deck esta vazio.`);
      }
    } else if (cycling.type === 'typecycling' || cycling.type === 'basiclandcycling') {
      // Search for specific land type
      const lib = state.players[playerId].zones.library;
      let land = null;

      if (cycling.type === 'typecycling') {
        // Search for land with the specific basic land type (e.g., Plains)
        land = lib.removeMatching(c =>
          CardEngine.isLand(c) && (c.type_line || '').includes(cycling.searchType)
        );
      } else {
        // Basic landcycling - search for any basic land
        land = lib.removeMatching(c => CardEngine.isBasicLand(c));
      }

      if (land) {
        state.players[playerId].zones.hand.add(land);
        lib.shuffle();
        state.log.push(`${playerLabel} faz ${cycling.searchType || 'basic land'}cycling de ${card.name}, busca ${land.name}.`);
      } else {
        lib.shuffle();
        state.log.push(`${playerLabel} faz cycling de ${card.name}, mas nao encontrou terreno.`);
      }
    }

    return { success: true };
  },

  getPlayableCards(state, playerId) {
    const hand = state.players[playerId].zones.hand;
    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';

    // prevent_opponent_casting: opponent can't cast non-land spells during your turn
    const opponentId = playerId === 0 ? 1 : 0;
    const opponentHasLockdown = state.players[opponentId].zones.battlefield.cards.some(c =>
      c._preventOpponentCasting && (c._preventOpponentCasting === true || (c._preventOpponentCasting === 'your_turn' && state.activePlayer === opponentId))
    );

    // grant_flash: check if player has a creature that grants flash to certain spell types
    const grantFlashSources = state.players[playerId].zones.battlefield.cards.filter(c => c._grantFlash);

    // Also check hand for creatures not yet on battlefield that grant flash (e.g., Whirlwing Stormbrood)
    for (const handCard of hand.getAll()) {
      if (CardEngine.isCreature(handCard)) {
        const db = CardEngine.getPreprocessedEffects(handCard);
        if (db && db.static) {
          const hasGrantFlash = db.static.some(s => s.type === 'grant_flash');
          if (hasGrantFlash) {
            grantFlashSources.push(handCard);
          }
        }
      }
    }

    // Pre-compute available mana (untapped lands + pool) once
    const bf = state.players[playerId].zones.battlefield;
    const availableLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const availableMana = ManaSystem.createPool();
    availableLands.forEach(l => {
      const colors = ManaSystem.getLandManaColors(l);
      colors.forEach(color => {
        availableMana[color] = (availableMana[color] || 0) + 1;
      });
    });

    // Add current mana pool
    Object.keys(state.manaPool[playerId]).forEach(k => {
      availableMana[k] = (availableMana[k] || 0) + state.manaPool[playerId][k];
    });

    // Total available = actual number of untapped lands + pool total
    // (NOT sum of availableMana, which overcounts multi-color lands)
    const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
    const totalAvailable = availableLands.length + poolTotal;

    // Convoke: count untapped non-summoning-sick creatures
    const convokeCreatures = ManaSystem.getConvokeCreatures(state, playerId);
    const convokeCount = convokeCreatures.length;
    // Convoke color contribution
    const convokeColors = ManaSystem.createPool();
    convokeCreatures.forEach(c => {
      const colors = c.colors || c.color_identity || [];
      if (colors.length > 0) {
        colors.forEach(clr => { convokeColors[clr] = (convokeColors[clr] || 0) + 1; });
      }
    });

    // Pre-compute hand cards for behold checks
    const handCards = hand.getAll();

    // Include exiled playable cards (exile_top_play)
    const exiledPlayable = [];
    if (state._exiledPlayable) {
      for (const uid of Object.keys(state._exiledPlayable)) {
        const entry = state._exiledPlayable[uid];
        if (entry.controller === playerId) {
          exiledPlayable.push(entry.card);
        }
      }
    }
    const allPlayableSource = [...handCards, ...exiledPlayable];

    return allPlayableSource.filter(card => {
      if (CardEngine.isLand(card)) {
        return isMainPhase && !state.landPlayedThisTurn;
      }

      // prevent_opponent_casting: can't cast non-land spells
      if (opponentHasLockdown) return false;

      // Check behold cost: need matching type in hand (not counting self)
      const behold = CardEngine.getBeholdCost(card);
      if (behold && !behold.optional) {
        const hasBeholdTarget = handCards.some(c =>
          c._uid !== card._uid && CardEngine.hasCreatureType(c, behold.subtype)
        );
        if (!hasBeholdTarget) return false;
      }
      // Optional behold: "behold or pay {N}" — always castable if can afford alternate
      if (behold && behold.optional) {
        const hasBeholdTarget = handCards.some(c =>
          c._uid !== card._uid && CardEngine.hasCreatureType(c, behold.subtype)
        );
        // If no behold target, need extra mana for alternate cost
        if (!hasBeholdTarget) {
          // Check if total available includes the alternate extra cost
          const extraNeeded = behold.alternateCost || 0;
          const cardCmc = (card.cmc || 0) + extraNeeded;
          if (totalAvailable < cardCmc) return false;
        }
      }

      // CRITICAL FIX: Check if card requires targets and has valid targets available
      if (!this._hasValidTargetsForCard(state, playerId, card)) return false;

      // Check adventure side: if it has an instant/sorcery adventure, check that cost too
      if (CardEngine.hasAdventure(card)) {
        const advCost = CardEngine.getAdventureCost(card);
        const advCmc = CardEngine.getAdventureCMC(card);
        const advIsInstant = CardEngine.isAdventureInstant(card);
        const advIsSorcery = CardEngine.isAdventureSorcery(card);

        if (advCost && totalAvailable >= advCmc) {
          const canAffordAdv = ManaSystem.canPay(availableMana, advCost, advCmc);
          if (canAffordAdv) {
            if (advIsInstant) return true;
            if (advIsSorcery && isMainPhase) return true;
          }
        }
      }

      // Check additional costs (sacrifice, etc.)
      const addCosts = CardEngine.getAdditionalCosts(card);
      for (const ac of addCosts) {
        if (ac.type === 'sacrifice') {
          const bfCards = bf.cards;
          let hasSacTarget = false;
          if (ac.target === 'creature') hasSacTarget = bfCards.some(c => CardEngine.isCreature(c));
          else if (ac.target === 'land') hasSacTarget = bfCards.some(c => CardEngine.isLand(c));
          else if (ac.target === 'artifact') hasSacTarget = bfCards.some(c => CardEngine.isArtifact(c));
          else hasSacTarget = bfCards.length > 0;
          if (!hasSacTarget) return false;
        }
        if (ac.type === 'discard') {
          // Need enough cards in hand (excluding the spell itself)
          if (hand.count() <= (ac.amount || 1)) return false;
        }
        if (ac.type === 'tap_creature') {
          const hasUntapped = bf.cards.some(c => CardEngine.isCreature(c) && !c._tapped);
          if (!hasUntapped) return false;
        }
      }

      // Check if card is exiled with free_cast: true
      let isFreeFromExile = false;
      if (state._exiledPlayable && state._exiledPlayable[card._uid]) {
        const exileEntry = state._exiledPlayable[card._uid];
        if (exileEntry.freeCast && exileEntry.controller === playerId) {
          isFreeFromExile = true;
        }
        console.log(`[BREACHING DEBUG] Checking playability for ${card.name}: freeCast=${exileEntry.freeCast}, controller=${exileEntry.controller}, isFreeFromExile=${isFreeFromExile}`);
      }

      // Cost reduction from static abilities on battlefield
      let effectiveCmc = card.cmc || ManaSystem.parseCost(card.mana_cost).total || 0;
      let costReduced = isFreeFromExile; // Free cast from exile counts as cost reduction
      for (const bfCard of bf.cards) {
        if (!bfCard._costReduction) continue;
        const cr = bfCard._costReduction;
        if (cr.target === 'dragon_spells' && CardEngine.hasCreatureType(card, 'Dragon')) {
          if (cr.reduction === 'free') { costReduced = true; effectiveCmc = 0; }
          else { effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0)); costReduced = true; }
        }
        if (cr.target === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
          effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0));
          costReduced = true;
        }
        if (cr.target === 'creature_spells' && CardEngine.isCreature(card)) {
          effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0));
          costReduced = true;
        }
        if (cr.target === 'spells' && cr.condition === 'per_power4_creature') {
          const p4count = bf.cards.filter(c => CardEngine.isCreature(c) && CardEngine.getPower(c) >= 4).length;
          if (p4count > 0) {
            effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0) * p4count);
            costReduced = true;
          }
        }
      }

      // Self cost reduction (Focus the Mind, etc.) - card reduces its own cost
      const dbEntry = typeof CardEffectsDB !== 'undefined' && CardEffectsDB[card.name?.toLowerCase()];
      if (dbEntry && dbEntry.self_cost_reduction) {
        const scr = dbEntry.self_cost_reduction;
        if (scr.condition === 'second_spell' && (state._spellsThisTurn[playerId] || 0) >= 1) {
          effectiveCmc = Math.max(0, effectiveCmc - (scr.amount || 0));
          costReduced = true;
        }
      }

      // Affinity reduction
      const affinityDiscount = this.calculateAffinityDiscount(state, playerId, card);
      const attackingDiscount = this.getAttackingCreatureDiscount(state, card);
      const totalDiscount = affinityDiscount + attackingDiscount;

      if (totalDiscount > 0) {
        effectiveCmc = Math.max(0, effectiveCmc - totalDiscount);
        costReduced = true;
      }

      // Store the effective CMC on the card for UI display
      card._effectiveCmc = effectiveCmc;
      card._costReduced = costReduced;

      // Normal card check - use worst-case cost for conditional cards
      const maxManaCost = CardEngine.getConditionalCost(card)
        ? CardEngine.getEffectiveManaCost(card, { type_line: "Creature — Dragon" }) // Assume worst case for targeting conditional
        : card.mana_cost;
      const maxCmc = CardEngine.getConditionalCost(card)
        ? ManaSystem.parseCost(maxManaCost).total
        : effectiveCmc;

      const requiredTotal = (costReduced || isFreeFromExile) ? 0 : maxCmc;
      let canAfford = isFreeFromExile || (totalAvailable >= requiredTotal && (costReduced ? totalAvailable >= maxCmc : ManaSystem.canPay(availableMana, maxManaCost, maxCmc)));

      // Convoke: if can't afford normally but card has convoke, add creature mana
      if (!canAfford && CardEngine.hasConvoke(card) && convokeCount > 0) {
        const totalWithConvoke = totalAvailable + convokeCount;
        if (totalWithConvoke >= requiredTotal) {
          // Build augmented pool with convoke contributions
          const augmented = { ...availableMana };
          // Add convoke as generic (each creature = 1 generic or 1 colored)
          // For canPay check, add convoke count to the most useful colors + generic
          Object.keys(convokeColors).forEach(clr => {
            augmented[clr] = (augmented[clr] || 0) + convokeColors[clr];
          });
          // Also add colorless convoke contribution for creatures without matching colors
          const totalConvokeColors = Object.values(convokeColors).reduce((a, b) => a + b, 0);
          if (convokeCount > totalConvokeColors) {
            augmented.C = (augmented.C || 0) + (convokeCount - totalConvokeColors);
          }
          canAfford = ManaSystem.canPay(augmented, maxManaCost, maxCmc);
        }
      }

      // If can't afford normally, check evoke as alternate cost
      if (!canAfford) {
        const evokeCost = CardEngine.getEvokeCost(card);
        if (evokeCost) {
          const evokeCmc = ManaSystem.parseCost(evokeCost).total || 0;
          if (totalAvailable >= evokeCmc && ManaSystem.canPay(availableMana, evokeCost, evokeCmc)) {
            return isMainPhase; // Evoke still requires main phase (it's a creature)
          }
        }
        return false;
      }

      if (CardEngine.isInstant(card) || CardEngine.hasFlash(card)) return true;
      // conditional_flash: behold Dragon, etc.
      const hasConditionalFlash = CardEngine.canCastWithConditionalFlash(card, state, playerId);
      if (hasConditionalFlash) return true;
      // grant_flash: sorceries/dragon spells can be cast at instant speed
      if (grantFlashSources.length > 0) {
        for (const src of grantFlashSources) {
          if (src._grantFlash === 'sorcery_and_dragon_spells') {
            const isSorcery = CardEngine.isSorcery(card);
            const isDragon = (card.type_line || '').toLowerCase().includes('dragon');
            if (isSorcery || isDragon) return true;
          }
        }
      }
      return isMainPhase;
    });
  },

  // Check if player has any affordable activated abilities on battlefield
  hasAffordableAbilities(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const availableMana = ManaSystem.getAvailableMana(state, playerId);
    for (const card of bf.cards) {
      const abilities = CardEngine.getActivatedAbilities(card);
      for (const ab of abilities) {
        if (ab.cost.tap && card._tapped) continue;
        if (ab.cost.once_per_turn) {
          if (!state._abilityUsedThisTurn) state._abilityUsedThisTurn = {};
          const key = card._uid + '_' + JSON.stringify(ab.effects.map(e => e.type));
          if (state._abilityUsedThisTurn[key]) continue;
        }
        // Check mana affordability
        const cost = ab.cost;
        if (!cost || cost.mana === undefined || cost.mana === null || cost.mana === 0) return true;
        const str = String(cost.mana);
        let cmc = 0;
        for (const ch of str) { if (ch >= '0' && ch <= '9') cmc += parseInt(ch); else if ('WUBRGC'.includes(ch)) cmc += 1; }
        const fakeCard = { mana_cost: `{${str}}`, cmc };
        if (ManaSystem.canAfford(state, playerId, fakeCard)) return true;
      }
    }
    return false;
  },

  // === Harmonize: cast from graveyard ===

  getHarmonizableCards(state, playerId) {
    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';

    const gy = state.players[playerId].zones.graveyard;
    const cards = gy.getAll();

    // Pre-compute available mana
    const bf = state.players[playerId].zones.battlefield;
    const availableLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const availableMana = ManaSystem.createPool();
    availableLands.forEach(l => {
      const colors = ManaSystem.getLandManaColors(l);
      colors.forEach(color => { availableMana[color] = (availableMana[color] || 0) + 1; });
    });
    Object.keys(state.manaPool[playerId]).forEach(k => {
      availableMana[k] = (availableMana[k] || 0) + state.manaPool[playerId][k];
    });
    const poolTotal = ManaSystem.poolTotal(state.manaPool[playerId]);
    const totalAvailable = availableLands.length + poolTotal;

    // Creature discount: best untapped creature power (summoning sick doesn't prevent harmonize tap)
    const convokeCreatures = bf.cards.filter(c =>
      CardEngine.isCreature(c) && !c._tapped
    );
    const bestCreaturePower = convokeCreatures.length > 0
      ? Math.max(...convokeCreatures.map(c => CardEngine.getPower(c)))
      : 0;

    // Get all cards with harmonize cost and mark which ones can be cast
    return cards.filter(card => {
      const harmonizeCost = CardEngine.getHarmonizeCost(card);
      if (!harmonizeCost) return false;
      // Skip X costs for now (nature's rhythm)
      if (harmonizeCost.includes('X')) return false;

      // Determine if this card can actually be cast
      const cmc = CardEngine.getHarmonizeCMC(card);
      const effectiveCmc = Math.max(0, cmc - bestCreaturePower);
      const canCastThisCard = isMainPhase &&
        totalAvailable >= effectiveCmc &&
        ManaSystem.canPay(availableMana, harmonizeCost, effectiveCmc);

      // Mark it for UI rendering
      card._harmonizeCanCast = canCastThisCard;
      return true; // Always return card so it appears in bar
    });
  },

  castHarmonize(state, playerId, cardUid, targets, tappedCreatureUid) {
    const gy = state.players[playerId].zones.graveyard;
    const card = gy.get(cardUid);
    if (!card) return { success: false, msg: 'Carta nao encontrada no cemiterio.' };

    const harmonizeCost = CardEngine.getHarmonizeCost(card);
    if (!harmonizeCost) return { success: false, msg: 'Carta nao tem harmonize.' };

    const isMainPhase = state.phase === 'main1' || state.phase === 'main2';
    if (!isMainPhase) return { success: false, msg: 'So pode harmonizar na fase principal.' };

    let cmc = CardEngine.getHarmonizeCMC(card);
    let discount = 0;
    let tappedCreature = null;

    // Calculate discount first (WITHOUT tapping creature yet)
    if (tappedCreatureUid) {
      const bf = state.players[playerId].zones.battlefield;
      const creature = bf.get(tappedCreatureUid);
      if (creature && CardEngine.isCreature(creature) && !creature._tapped) {
        discount = CardEngine.getPower(creature);
        tappedCreature = creature; // Store for later
      }
    }

    const effectiveCmc = Math.max(0, cmc - discount);

    // VALIDATE MANA BEFORE TAPPING CREATURE
    // Auto-tap and check if can pay mana
    this.autoTapForSpell(state, playerId, harmonizeCost, effectiveCmc);
    if (!ManaSystem.canPay(state.manaPool[playerId], harmonizeCost, effectiveCmc)) {
      return { success: false, msg: 'Mana insuficiente para harmonizar.' };
    }

    // NOW tap the creature (only if we can actually pay the cost)
    if (tappedCreature) {
      tappedCreature._tapped = true;
      state.log.push(`${tappedCreature.name} ajuda a harmonizar (desconto de ${discount}).`);
    }
    state.manaPool[playerId] = ManaSystem.payMana(state.manaPool[playerId], harmonizeCost, effectiveCmc);

    // Remove from graveyard
    gy.remove(cardUid);

    // Track spells cast this turn
    state._spellsThisTurn[playerId] = (state._spellsThisTurn[playerId] || 0) + 1;

    const playerLabel = playerId === 0 ? 'Voce' : 'Oponente';
    state.log.push(`${playerLabel} harmoniza ${card.name} do cemiterio!`);

    // VFX
    if (typeof VFX !== 'undefined') VFX.spellCast(card.name);

    // Flag so stack doesn't move card back to graveyard after resolution
    card._harmonizeCast = true;

    // Resolve spell effects (same as casting)
    const effects = CardEngine.getSpellEffects(card);
    if (effects.length > 0) {
      GameStack.push(state.stack, { card, controller: playerId, targets: targets || [], effects });
      const stackLog = GameStack.resolve(state.stack, state);
      state.log.push(...stackLog);
    }

    // Exile after resolution (harmonize always exiles)
    if (!state.players[playerId].zones.exile) {
      state.players[playerId].zones.exile = {
        cards: [], add(c) { this.cards.push(c); }, remove(uid) { const i = this.cards.findIndex(x => x._uid === uid); if (i >= 0) return this.cards.splice(i, 1)[0]; },
        get(uid) { return this.cards.find(x => x._uid === uid); }, getAll() { return this.cards; }, count() { return this.cards.length; }
      };
    }
    state.players[playerId].zones.exile.add(card);

    // Fire Flurry triggers (second spell this turn)
    if (state._spellsThisTurn[playerId] === 2) {
      const flurryLogs = this.fireTrigger(state, 'second_spell', { playerId, lastSpell: card, cardUid: card._uid });
      state.log.push(...flurryLogs);
    }

    this._checkWinner(state);
    return { success: true };
  },

  submitExileChoice(state, playerId, chosenCardUids) {
    if (!state.waitingForInput || state.waitingForInput.type !== 'exile_choose') {
      return { success: false, msg: 'Nenhuma escolha de exile pendente.' };
    }

    const pending = state._pendingExileChoice;
    if (!pending || pending.controllerId !== playerId) {
      return { success: false, msg: 'Escolha de exile inválida.' };
    }

    const chosenCards = pending.cards.filter(c => chosenCardUids.includes(c._uid));
    if (chosenCards.length !== pending.choose) {
      return { success: false, msg: `Deve escolher exatamente ${pending.choose} carta(s).` };
    }

    // Make chosen cards playable
    if (!state._exiledPlayable) state._exiledPlayable = {};

    chosenCards.forEach(card => {
      state._exiledPlayable[card._uid] = {
        card: card,
        controller: pending.controllerId,
        turn: state.turn,
        duration: pending.duration,
        freeCast: false
      };
    });

    // Clear pending choice
    delete state._pendingExileChoice;
    state.waitingForInput = null;

    const cardNames = chosenCards.map(c => c.name).join(', ');
    state.log.push(`Escolheu: ${cardNames}. Disponível(is) para jogar${pending.duration === 'next_turn' ? ' até end of next turn' : ''}.`);

    return { success: true };
  },

  // CRITICAL FIX: Check if card requiring targets has valid targets available
  _hasValidTargetsForCard(state, playerId, card) {
    // Parse oracle text to detect target requirements
    const oracleText = (card.oracle_text || '').toLowerCase();

    // Skip lands and cards that don't require targets
    if (CardEngine.isLand(card) || !oracleText.includes('target')) {
      return true;
    }

    // Get spell effects to determine target requirements
    const effects = CardEngine.getSpellEffects(card);
    const etbEffects = CardEngine.parseETBEffects(card);
    const allEffects = [...effects, ...etbEffects];

    // Check if any effect requires mandatory targets
    for (const effect of allEffects) {
      const needsTargets = this._effectRequiresTargets(effect);
      if (needsTargets && !this._hasValidTargetsForEffect(state, playerId, effect)) {
        return false; // Required target not available
      }
    }

    // Also check for direct oracle text patterns that require targets
    if (this._oracleTextRequiresTargets(oracleText)) {
      return this._hasValidTargetsFromOracle(state, playerId, oracleText);
    }

    return true;
  },

  _effectRequiresTargets(effect) {
    // Effects that require targets (not optional)
    const targetingEffects = [
      'damage', 'destroy', 'exile', 'bounce', 'debuff', 'buff',
      'counter', 'fight', 'tap', 'untap', 'gain_control', 'stun',
      'remove_counters', 'grant', 'create_token_copy'
    ];

    return targetingEffects.includes(effect.type) &&
           effect.target &&
           !effect.target.includes('all') &&
           !effect.target.includes('each') &&
           !effect.optional;  // Optional effects don't require valid targets
  },

  _hasValidTargetsForEffect(state, playerId, effect) {
    const opponentId = playerId === 0 ? 1 : 0;

    switch (effect.target) {
      case 'creature':
      case 'opponent_creature':
        const creatures = effect.target === 'opponent_creature'
          ? state.players[opponentId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c))
          : [...state.players[0].zones.battlefield.cards, ...state.players[1].zones.battlefield.cards]
              .filter(c => CardEngine.isCreature(c));
        return creatures.length > 0;

      case 'creature or planeswalker':
        const creaturesOrWalkers = [
          ...state.players[0].zones.battlefield.cards,
          ...state.players[1].zones.battlefield.cards
        ].filter(c => CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c));
        return creaturesOrWalkers.length > 0;

      case 'artifact':
        const artifacts = [
          ...state.players[0].zones.battlefield.cards,
          ...state.players[1].zones.battlefield.cards
        ].filter(c => CardEngine.isArtifact(c));
        return artifacts.length > 0;

      case 'enchantment':
        const enchantments = [
          ...state.players[0].zones.battlefield.cards,
          ...state.players[1].zones.battlefield.cards
        ].filter(c => CardEngine.isEnchantment(c));
        return enchantments.length > 0;

      default:
        return true; // Assume valid for other target types
    }
  },

  _oracleTextRequiresTargets(oracleText) {
    // Detect mandatory target patterns in oracle text
    const mandatoryPatterns = [
      /target creature gets/,
      /target creature or planeswalker/,
      /destroy target/,
      /exile target/,
      /return target/,
      /target creature gains/,
      /deal \d+ damage to target/
    ];

    // Skip only if it says "up to" without specific targeting
    if (oracleText.includes('up to') && !oracleText.includes('target')) {
      return false;
    }

    return mandatoryPatterns.some(pattern => pattern.test(oracleText));
  },

  _hasValidTargetsFromOracle(state, playerId, oracleText) {
    // Check specific oracle text patterns for available targets
    if (oracleText.includes('target creature')) {
      const allCreatures = [
        ...state.players[0].zones.battlefield.cards,
        ...state.players[1].zones.battlefield.cards
      ].filter(c => CardEngine.isCreature(c));
      return allCreatures.length > 0;
    }

    if (oracleText.includes('target creature or planeswalker')) {
      const targets = [
        ...state.players[0].zones.battlefield.cards,
        ...state.players[1].zones.battlefield.cards
      ].filter(c => CardEngine.isCreature(c) || CardEngine.isPlaneswalker(c));
      return targets.length > 0;
    }

    return true; // Default to allowing cast for other patterns
  },

  // CRITICAL FIX: State-based actions (creatures with 0 toughness die immediately)
  _processStateBasedActions(state) {
    let actionsPerformed = false;

    // Check all creatures for 0 toughness
    for (const playerId of [0, 1]) {
      const bf = state.players[playerId].zones.battlefield;
      const deadCreatures = bf.cards.filter(c =>
        CardEngine.isCreature(c) && CardEngine.getToughness(c) <= 0
      );

      deadCreatures.forEach(creature => {
        const died = this.creatureDies(state, creature, playerId);
        if (died) {
          state.log.push(`${creature.name} morre (0 resistencia).`);
          actionsPerformed = true;
        }
      });
    }

    // Check planeswalkers with 0 loyalty
    for (const playerId of [0, 1]) {
      const bf = state.players[playerId].zones.battlefield;
      const deadWalkers = bf.cards.filter(c =>
        CardEngine.isPlaneswalker(c) && (c._loyalty || 0) <= 0
      );

      deadWalkers.forEach(walker => {
        bf.remove(walker._uid);
        if (!state.players[playerId].zones.graveyard) {
          state.players[playerId].zones.graveyard = {
            cards: [], add(c) { this.cards.push(c); }, remove(uid) { const i = this.cards.findIndex(x => x._uid === uid); if (i >= 0) return this.cards.splice(i, 1)[0]; },
            get(uid) { return this.cards.find(x => x._uid === uid); }, getAll() { return this.cards; }, count() { return this.cards.length; }
          };
        }
        state.players[playerId].zones.graveyard.add(walker);
        state.log.push(`${walker.name} vai para o cemiterio (lealdade 0).`);
        actionsPerformed = true;
      });
    }

    // If any actions were performed, check again (recursive SBAs)
    if (actionsPerformed) {
      return this._processStateBasedActions(state);
    }

    return actionsPerformed;
  },

  // Handle paying for optional triggered ability costs
  resolveTriggerCost(state, paymentChoice) {
    if (!state || !state.waitingForInput || state.waitingForInput.type !== 'trigger_cost') {
      return;
    }

    const wi = state.waitingForInput;
    const trigger = wi.trigger;

    if (paymentChoice === 'pay') {
      // Player chose to pay
      const effect = trigger.effects.find(e => e.cost);
      if (!effect || !effect.cost) {
        state.waitingForInput = null;
        return;
      }

      // Try to pay the cost
      const cost = ManaSystem.parseCost(effect.cost);
      const cmc = ManaSystem.getCMCFromCost(effect.cost);

      if (!ManaSystem.canAfford(state, trigger.controllerId, { mana_cost: effect.cost, cmc })) {
        // Can't afford - just skip without resolving
        state.log.push(`Mana insuficiente para pagar ${effect.cost}.`);
        state.waitingForInput = null;
        return;
      }

      // Pay the mana
      ManaSystem.payMana(state, trigger.controllerId, cost, cmc);

      // Resolve the trigger effects
      state.log.push(`Voce paga ${effect.cost}. Habilidade de ${trigger.cardName} se resolve!`);
      for (const eff of trigger.effects) {
        const result = this._resolveSimpleEffect(state, trigger.controllerId, eff, wi.data);
        if (result) state.log.push(result);
      }
    } else {
      // Player chose not to pay
      const effect = trigger.effects.find(e => e.cost);
      state.log.push(`Voce opta por nao pagar ${effect?.cost || '?'} para habilidade de ${trigger.cardName}.`);
    }

    // Cleanup
    state.waitingForInput = null;
  }
};
