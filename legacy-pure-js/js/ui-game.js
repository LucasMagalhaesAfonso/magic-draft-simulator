const UIGame = {
  gameState: null,
  selectedCard: null,
  selectedAttackers: new Set(),
  selectedBlockers: {},  // {blockerUid: attackerUid}
  targetingMode: null,   // {card, effects, callback}
  _pendingBlockerUid: null,
  _orderingAttackerIndex: 0,
  _blockerOrderSelection: [],
  _logCollapsed: false,
  _aiThinking: false,
  _keyListener: null,
  _mulliganBottomCards: [], // cards selected to put on bottom during mulligan
  _prevLife: [20, 20], // track previous life for animation
  _prevTurn: 0, // track previous turn for banner
  _prevActivePlayer: -1, // track active player changes
  _gyOverlay: null, // graveyard peek state: {playerId}
  _actionModal: null, // {card, abilities} for ability selection modal
  _triggerQueue: [], // queue of trigger notifications to show
  _prevManaPool: null, // track mana changes for animation
  _fullControlMode: false, // Ctrl - pause at every phase
  _showStack: false, // Show stack overlay
  _manaUndoStack: [], // Stack of mana actions that can be undone
  _aiActionQueue: [], // Queue of AI actions to display to player
  _showingAIAction: null, // Currently displayed AI action overlay
  _artPickerCard: null, // Currently selected card for art picking
  _artPickerArts: [], // Available arts for current card

  startGame(playerDeck, opponentDeck) {
    console.log('🎮 UIGame.startGame() called');
    console.log('📍 Current screen:', document.getElementById('screen-game')?.style.display);
    console.log('🌍 Window objects available:', Object.keys(window).length);

    // DEBUG: Check if objects exist in global scope RIGHT NOW
    console.log('🔍 IMMEDIATE CHECK:');
    console.log('  window.GameState:', window.GameState);
    console.log('  window.CardEngine:', window.CardEngine);
    console.log('  window.ManaSystem:', window.ManaSystem);
    console.log('  window.CombatSystem:', window.CombatSystem);
    console.log('  window.GameStack:', window.GameStack);
    console.log('  window.GameAI:', window.GameAI);

    // Check if they exist but are not enumerable
    console.log('🔍 PROPERTY DESCRIPTOR CHECK:');
    const objects = ['GameState', 'CardEngine', 'ManaSystem', 'CombatSystem', 'GameStack', 'GameAI'];
    objects.forEach(name => {
      const descriptor = Object.getOwnPropertyDescriptor(window, name);
      console.log(`  ${name} descriptor:`, descriptor);
    });

    // Wait a bit for dependencies to fully load
    const checkDependencies = () => {
      const requiredGlobals = ['GameState', 'CardEngine', 'ManaSystem', 'CombatSystem', 'GameStack', 'GameAI'];
      // Direct access check instead of typeof window[name]
      const missing = requiredGlobals.filter(name => {
        try {
          const obj = eval(name);
          return !obj || typeof obj !== 'object';
        } catch (e) {
          return true;
        }
      });

      console.log('🔍 Dependency check:');
      requiredGlobals.forEach(name => {
        try {
          const obj = eval(name);
          const exists = obj && typeof obj === 'object';
          console.log(`  ${name}: ${typeof obj} ${exists ? '✅' : '❌'}`);
        } catch (e) {
          console.log(`  ${name}: undefined ❌`);
        }
      });

      if (missing.length > 0) {
        console.error('❌ Missing required dependencies:', missing);
        console.error('Available game-related globals:', Object.keys(window).filter(k =>
          k.includes('Game') || k.includes('Card') || k.includes('Mana') || k.includes('Zone') || k.includes('Combat')
        ));

        // Try again in 100ms (maybe timing issue)
        if (!this._retryAttempted) {
          this._retryAttempted = true;
          console.log('⏳ Retrying dependency check in 100ms...');
          setTimeout(() => checkDependencies(), 100);
          return;
        }

        alert(`ERRO: Dependências não carregadas: ${missing.join(', ')}. Verifique o console para mais detalhes.`);
        return;
      }

      console.log('✅ All dependencies loaded successfully');
      this._actualStartGame(playerDeck, opponentDeck);
    };

    checkDependencies();
  },

  _actualStartGame(playerDeck, opponentDeck) {
    this.gameState = GameState.create(playerDeck, opponentDeck);
    this.selectedCard = null;
    this.selectedAttackers = new Set();
    this.selectedBlockers = {};
    this.targetingMode = null;
    this._pendingBlockerUid = null;
    this._logCollapsed = false;
    this._aiThinking = false;
    this._aiProcessing = false;
    this._continueCount = 0;

    // FORCE _aiThinking to ALWAYS be false
    Object.defineProperty(this, '_aiThinking', {
      get: () => false,
      set: (value) => { /* IGNORE ALL ATTEMPTS TO SET TRUE */ }
    });
    this._mulliganBottomCards = [];
    this._prevLife = [this.gameState.players[0].life, this.gameState.players[1].life];
    this._prevTurn = 0;
    this._prevActivePlayer = -1;
    this._prevHandSize = 0; // Track for draw animation
    this._gyOverlay = null;
    this._exileOverlay = null;
    this._fullControlMode = false;
    this._showStack = false;
    this._manaUndoStack = [];
    // Clear any stale toasts from previous game
    const oldToasts = document.getElementById('game-toast-container');
    if (oldToasts) oldToasts.innerHTML = '';
    this._applyTheme();
    this._setupKeyboard();
    this.render();
  },

  _setupKeyboard() {
    if (this._keyListener) {
      document.removeEventListener('keydown', this._keyListener);
    }
    this._keyListener = (e) => this._handleKey(e);
    document.addEventListener('keydown', this._keyListener);
  },

  _handleKey(e) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
    // Blur focused buttons to prevent Space/Enter double-firing (keydown + button click)
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
      document.activeElement.blur();
    }

    // Dismiss AI action overlay with Space or Enter
    if (this._showingAIAction && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      this.dismissAIAction();
      return;
    }

    // Ctrl toggles Full Control Mode (like Arena)
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
      e.preventDefault();
      this._fullControlMode = !this._fullControlMode;
      this._showControlModeIndicator();
      this.render();
      return;
    }

    // Tab toggles Stack view
    if (e.code === 'Tab') {
      e.preventDefault();
      this._showStack = !this._showStack;
      this.render();
      return;
    }

    // Escape closes overlays regardless of game state
    if (e.code === 'Escape') {
      if (this._actionModal) {
        e.preventDefault();
        this.closeAbilityModal();
        return;
      }
      if (this.targetingMode) {
        e.preventDefault();
        if (this._gyOverlay !== null) this._gyOverlay = null;
        this.cancelTargeting();
        return;
      }
      if (this.gameState._pendingHarmonize) {
        e.preventDefault();
        this.cancelHarmonize();
        return;
      }
      if (this.gameState._pendingHarmonizeConfirm) {
        e.preventDefault();
        this.cancelHarmonizeConfirm();
        return;
      }
      if (this._gyOverlay !== null) {
        e.preventDefault();
        this.closeGraveyard();
        return;
      }
      if (this._exileOverlay !== null) {
        e.preventDefault();
        this.closeExile();
        return;
      }
      if (this._fullControlMode) {
        this._fullControlMode = false;
        this._showControlModeIndicator();
        this.render();
        return;
      }
    }

    // A = Auto-pass until end step (skip all priority windows)
    if (e.code === 'KeyA') {
      e.preventDefault();
      if (gs._autoPassUntilEnd) {
        gs._autoPassUntilEnd = false;
        this._showAutoPassIndicator(false);
      } else {
        gs._autoPassUntilEnd = true;
        this._showAutoPassIndicator(true);
        // If currently waiting for input, auto-pass immediately
        const wi = gs.waitingForInput;
        if (wi && wi.playerId === 0 && (wi.type === 'main_phase' || wi.type === 'instant_priority' || wi.type === 'stack_priority')) {
          if (wi.type === 'stack_priority') {
            this.passStackPriority();
          } else {
            this.passPriority();
          }
        }
      }
      return;
    }

    const wi = gs.waitingForInput;
    if (!wi || wi.playerId !== 0) return;

    // Auto-pass: skip priority windows until end step
    if (gs._autoPassUntilEnd && (wi.type === 'main_phase' || wi.type === 'instant_priority' || wi.type === 'stack_priority')) {
      const phase = wi.phase || gs.phase;
      if (phase !== 'end' && phase !== 'end_step') {
        if (wi.type === 'stack_priority') {
          this.passStackPriority();
        } else {
          this.passPriority();
        }
        return;
      } else {
        // Reached end step — cancel auto-pass
        gs._autoPassUntilEnd = false;
        this._showAutoPassIndicator(false);
      }
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (wi.type === 'main_phase' || wi.type === 'instant_priority' || wi.type === 'stack_priority') {
          if (wi.type === 'stack_priority') {
            this.passStackPriority();
          } else {
            this.passPriority();
          }
        } else if (wi.type === 'declare_attackers') {
          // Space = confirm selected attackers (if any selected) or attack with all
          if (this.selectedAttackers && this.selectedAttackers.size > 0) {
            this.confirmAttackers();
          } else {
            this.attackWithAll();
          }
        } else if (wi.type === 'declare_blockers') {
          this.confirmBlockers();
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (wi.type === 'declare_attackers') {
          this.confirmAttackers();
        } else if (wi.type === 'declare_blockers') {
          this.confirmBlockers();
        } else if (wi.type === 'scry' || wi.type === 'surveil') {
          this.confirmScry();
        } else if (wi.type === 'look_top_choice') {
          this.confirmLookTop();
        } else if (wi.type === 'look_top_permanent_choice') {
          this.confirmLookTopPermanent();
        } else if (wi.type === 'mulligan') {
          this.keepHand();
        } else if (wi.type === 'modal_choice' && gs._pendingModal && (gs._pendingModal.chooseCount || 1) > 1) {
          this.confirmMultiModalChoice();
        } else if (wi.type === 'multi_buff_choice' && gs._pendingMultiBuffChoice) {
          this.confirmMultiBuffChoice();
        } else if (wi.type === 'order_blockers') {
          this.confirmBlockerOrder();
        } else if (wi.type === 'choose_gy_return' && gs._pendingGYReturn && gs._pendingGYReturn._selectedUid) {
          this.confirmGYReturn();
        } else if (wi.type === 'rummage_discard' && gs._pendingRummage && gs._pendingRummage.selected.length > 0) {
          this.confirmRummage();
        } else if (wi.type === 'trigger_cost') {
          this.payTriggerCost();
        } else if (wi.type === 'mandatory_discard' && this._selectedDiscardCards && this._selectedDiscardCards.length === (gs._pendingDiscard ? gs._pendingDiscard.amount : 1)) {
          this.confirmMandatoryDiscard();
        }
        break;
      case 'KeyA':
        // A = Also attack with all (alternative)
        if (wi.type === 'declare_attackers') {
          e.preventDefault();
          this.attackWithAll();
        }
        break;
      case 'KeyM':
        if (wi.type === 'mulligan') {
          e.preventDefault();
          this.doMulligan();
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (this.targetingMode) {
          this.cancelTargeting();
        } else if (wi.type === 'declare_attackers') {
          this.skipAttackers();
        } else if (wi.type === 'declare_blockers') {
          this.skipBlockers();
        } else if (wi.type === 'rummage_discard') {
          this.skipRummage();
        } else if (wi.type === 'optional_discard_choice') {
          this.skipOptionalDiscard();
        } else if (wi.type === 'trigger_cost') {
          this.skipTriggerCost();
        } else if (wi.type === 'behold_choice_multiple' && gs._pendingBeholdChoice && gs._pendingBeholdChoice.isOptional === true) {
          this.resolveBeholdChoiceDecline();
        } else if (wi.type === 'choose_gy_return') {
          this.skipGYReturn();
        }
        break;
      case 'KeyL':
        this._logCollapsed = !this._logCollapsed;
        this.render();
        break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        if (wi.type === 'modal_choice' && gs._pendingModal) {
          e.preventDefault();
          const modeIndex = parseInt(e.code.replace('Digit', '')) - 1;
          if (modeIndex < gs._pendingModal.modes.length) {
            const chooseN = gs._pendingModal.chooseCount || 1;
            if (chooseN > 1) {
              this.toggleModalMode(modeIndex);
            } else {
              this.confirmModalChoice(modeIndex);
            }
          }
        }
        if (wi.type === 'endure_choice' && gs._pendingEndure) {
          e.preventDefault();
          const digit = parseInt(e.code.replace('Digit', ''));
          if (digit === 1) this.resolveEndure('counters');
          else if (digit === 2) this.resolveEndure('spirits');
        }
        if (wi.type === 'mill_land_choice' && gs._pendingMillLandChoice) {
          e.preventDefault();
          const digit = parseInt(e.code.replace('Digit', ''));
          if (digit === 1) this.resolveMillLandChoice('land');
          else if (digit === 2) this.resolveMillLandChoice('counter');
        }
        if (wi.type === 'traveling_botanist_choice' && gs._pendingTravelingBotanist) {
          e.preventDefault();
          const digit = parseInt(e.code.replace('Digit', ''));
          if (digit === 1) this.resolveTravelingBotanist('hand');
          else if (digit === 2) this.resolveTravelingBotanist('graveyard');
        }
        if (wi.type === 'mana_color_choice' && gs._pendingManaChoice) {
          e.preventDefault();
          const idx = parseInt(e.code.replace('Digit', '')) - 1;
          if (idx >= 0 && idx < gs._pendingManaChoice.colors.length) {
            this.resolveManaChoice(gs._pendingManaChoice.colors[idx]);
          }
        }
        if (wi.type === 'unless_pay_decision' && gs._pendingUnlessPay) {
          e.preventDefault();
          const digit = parseInt(e.code.replace('Digit', ''));
          if (digit === 1) {
            // Pay to prevent counter
            this.resolveUnlessPay(true);
          } else if (digit === 2) {
            // Don't pay - let spell be countered
            this.resolveUnlessPay(false);
          }
        }
        if (wi.type === 'behold_choice_multiple' && gs._pendingBeholdChoice) {
          e.preventDefault();
          const idx = parseInt(e.code.replace('Digit', '')) - 1;
          const candidates = gs._pendingBeholdChoice.candidates;
          if (idx >= 0 && idx < candidates.length) {
            this.resolveBeholdChoiceMultiple(candidates[idx]);
          }
        }
        if (wi.type === 'behold_choice_optional' && gs._pendingBeholdChoice) {
          e.preventDefault();
          const digit = parseInt(e.code.replace('Digit', ''));
          if (digit === 1) {
            // Reveal dragon - show card selector
            this._setupBeholdCardChoice();
          } else if (digit === 2) {
            // Pay mana instead
            this.resolveBeholdChoiceOptional('pay');
          }
        }
        if (wi.type === 'target_choice_single' && gs._pendingTargetChoice) {
          e.preventDefault();
          const idx = parseInt(e.code.replace('Digit', '')) - 1;
          if (idx >= 0 && idx < gs._pendingTargetChoice.targets.length) {
            this.confirmTargetChoice(idx);
          }
        }
        break;
      case 'Backspace':
        // Undo mana generation (only if no gameplay impact yet)
        if (this._manaUndoStack.length > 0) {
          e.preventDefault();
          this.undoMana();
        }
        break;
    }
  },

  // Show temporary indicator when toggling full control mode
  _showControlModeIndicator() {
    const existing = document.getElementById('control-mode-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'control-mode-indicator';
    indicator.className = 'control-mode-indicator';
    indicator.innerHTML = this._fullControlMode
      ? '<span class="icon">&#9881;</span> FULL CONTROL <kbd>Esc</kbd> para sair'
      : '<span class="icon">&#9654;</span> AUTO PASS';
    document.body.appendChild(indicator);

    setTimeout(() => indicator.remove(), 2000);
  },

  _showAutoPassIndicator(enabled) {
    const existing = document.getElementById('auto-pass-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.id = 'auto-pass-indicator';
    indicator.className = 'control-mode-indicator';
    indicator.innerHTML = enabled
      ? '<span class="icon">&#9193;</span> AUTO-PASS ate End Step <kbd>A</kbd> para cancelar'
      : '<span class="icon">&#9654;</span> Auto-pass desativado';
    document.body.appendChild(indicator);

    setTimeout(() => indicator.remove(), enabled ? 3000 : 2000);
  },

  // Attack with all available creatures
  attackWithAll() {
    const gs = this.gameState;
    if (!gs) return;

    const creatures = gs.players[0].zones.battlefield.cards.filter(c => CardEngine.canAttack(c));
    creatures.forEach(c => c._attacking = true);
    this.selectedAttackers = new Set(creatures.map(c => c._uid));
    this.render();
  },

  render() {
    if (!this.gameState) return;
    const gs = this.gameState;
    const p0 = gs.players[0];
    const p1 = gs.players[1];

    const container = document.getElementById('screen-game');

    // Mulligan phase - special render
    if (gs.phase === 'mulligan') {
      container.innerHTML = this._renderMulliganScreen(gs, p0, p1);
      return;
    }

    const isMyTurn = gs.activePlayer === 0;
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    // Show playable cards: during my turn normally, or during opponent's turn for instants/flash
    const showPlayable = !this.targetingMode && (isMyTurn || (gs.waitingForInput && gs.waitingForInput.playerId === 0));
    const playable = showPlayable ? GameState.getPlayableCards(gs, 0) : [];
    const playableIds = new Set(playable.map(c => c._uid));

    // Harmonize: always show cards from graveyard with harmonize cost
    // Cards will be marked _harmonizeCanCast indicating if they can be played
    const harmonizeCards = GameState.getHarmonizableCards(gs, 0);

    let controlsHtml = '';
    try {
      controlsHtml = this._renderControls();
    } catch (e) {
      console.error('Controls render error:', e);
      controlsHtml = `<button class="btn btn-primary btn-sm" onclick="UIGame.forceAdvance()">Avancar</button>`;
    }

    // Detect life changes for animation classes + toasts
    // Safety: reset _prevLife if values are corrupt (NaN, undefined, or unreasonable)
    if (!Number.isFinite(this._prevLife[0]) || !Number.isFinite(this._prevLife[1])) {
      this._prevLife = [p0.life, p1.life];
    }
    const p0LifeClass = p0.life > this._prevLife[0] ? 'life-flash-up' : (p0.life < this._prevLife[0] ? 'life-flash-down' : '');
    const p1LifeClass = p1.life > this._prevLife[1] ? 'life-flash-up' : (p1.life < this._prevLife[1] ? 'life-flash-down' : '');

    const p0LifeDiff = p0.life - this._prevLife[0];
    const p1LifeDiff = p1.life - this._prevLife[1];
    if (p0LifeDiff !== 0 || p1LifeDiff !== 0) {
      // Validate diff is reasonable (not from stale _prevLife or corrupted state)
      const p0Valid = Number.isFinite(p0LifeDiff) && Math.abs(p0LifeDiff) <= 20;
      const p1Valid = Number.isFinite(p1LifeDiff) && Math.abs(p1LifeDiff) <= 20;
      if (p0Valid && p0LifeDiff < 0) this.showToast(`Voce: ${p0LifeDiff} vida (${p0.life})`, 'damage');
      else if (p0Valid && p0LifeDiff > 0) this.showToast(`Voce: +${p0LifeDiff} vida (${p0.life})`, 'heal');
      if (p1Valid && p1LifeDiff < 0) this.showToast(`Oponente: ${p1LifeDiff} vida (${p1.life})`, 'damage');
      else if (p1Valid && p1LifeDiff > 0) this.showToast(`Oponente: +${p1LifeDiff} vida (${p1.life})`, 'heal');
      if (!p0Valid || !p1Valid) {
        console.warn('[UIGame] Unreasonable life diff detected, resetting _prevLife. Diff:', p0LifeDiff, p1LifeDiff, 'Life:', p0.life, p1.life, 'PrevLife:', this._prevLife);
      }
      // Update immediately to prevent duplicate toasts on re-render
      this._prevLife = [p0.life, p1.life];
    }

    // Detect turn change for banner
    let turnBannerHtml = '';
    if (gs.turn > this._prevTurn && gs.phase !== 'mulligan') {
      const isNewMyTurn = gs.activePlayer === 0;
      turnBannerHtml = `<div class="turn-banner ${isNewMyTurn ? 'your-turn' : 'opp-turn'}">${isNewMyTurn ? 'Seu Turno' : 'Turno do Oponente'}</div>`;
    }

    // Mana available count + color breakdown
    const totalLands = p0.zones.battlefield.cards.filter(c => CardEngine.isLand(c)).length;
    const untappedLandCards = p0.zones.battlefield.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const untappedLands = untappedLandCards.length;
    const poolTotal = ManaSystem.poolTotal(gs.manaPool[0]);

    // Build color dots for available mana
    const availableDots = untappedLandCards.map(land => {
      const colors = ManaSystem.getLandManaColors(land);
      const c = colors[0] || 'C';
      const isDual = colors.length > 1;
      return `<span class="mana-dot mana-dot-${c}" title="${land.name}${isDual ? ' (' + colors.join('/') + ')' : ''}"></span>`;
    }).join('');
    // Build color dots for pool
    const poolDots = Object.entries(gs.manaPool[0])
      .filter(([, v]) => v > 0)
      .map(([color, amount]) => Array(amount).fill(`<span class="mana-dot mana-dot-${color}"></span>`).join(''))
      .join('');

    container.innerHTML = `
      <div class="game-layout ${isMyTurn ? 'my-turn' : 'opp-turn'} ${this._getPlaymatClass()} ${this._getSleeveClass()}"
           style="${this._getSleeveClass() === 'sleeve-custom' ? `--sleeve-art:url('${this._getSleeveArtUrl()}');` : ''}${this._getPlaymatClass() === 'playmat-custom' ? `--playmat-art:url('${this._getPlaymatArtUrl()}');` : ''}">
        <!-- Left Sidebar: Turn, Phases, Mana, Controls -->
        <div class="game-sidebar ${this._aiThinking ? 'ai-thinking' : ''}">
          <div class="sidebar-section sidebar-turn">
            <span class="turn-label">Turno ${gs.turn}</span>
            <span class="turn-player">${isMyTurn ? 'Voce' : 'Oponente'}</span>
          </div>
          <div class="sidebar-section sidebar-phase">
            <div class="phase-strip-vertical">${this._renderPhaseStripVertical()}</div>
          </div>
          <div class="sidebar-section sidebar-mana">
            <div class="sidebar-mana-label">Mana</div>
            <div class="mana-display">${this._renderManaPool(gs.manaPool[0])}</div>
            <div class="mana-summary">
              <div class="mana-available-colors" title="Mana disponível">${availableDots || '<small style="color:rgba(255,255,255,0.3)">—</small>'}</div>
              <span class="mana-used" title="Terrenos virados">${totalLands - untappedLands} <small>usada</small></span>
              ${poolTotal > 0 ? `<div class="mana-pool-colors" title="Mana na pool">${poolDots}</div>` : ''}
            </div>
            ${(this._manaUndoStack.length > 0 || gs._undoableAction) ? `<div class="mana-undo-hint" onclick="UIGame.undoLastAction()"><kbd>⌫</kbd> Desfazer ${this._manaUndoStack.length > 0 ? `(${this._manaUndoStack.length})` : ''}</div>` : ''}
          </div>
          <div class="sidebar-section sidebar-controls ${this._aiThinking ? 'ai-thinking' : ''}">
            ${controlsHtml}
          </div>
          <div class="sidebar-section sidebar-settings">
            <button class="btn btn-secondary btn-sm" onclick="AIProcessor.showConfigModal()" title="Configurar IA">
              &#9881; IA
            </button>
            <button class="btn btn-secondary btn-sm" onclick="UIGame.showVisualConfig()" title="Visuais">
              &#127912; Visuais
            </button>
            <button class="btn btn-warning btn-sm" onclick="UIGame.restartGame()" title="Reiniciar Partida">
              &#8635; Restart
            </button>
          </div>
        </div>

        <!-- Main game area -->
        <div class="game-main">
          <!-- Opponent bar -->
          <div class="game-opp-bar">
            <span class="opp-name">Oponente</span>
            <!-- Show BEHOLD badge if Dragon was revealed -->
            ${gs._beholding && gs._beholding[0] ? `
              <div class="behold-badge" title="Dragon revelado via Behold: ${gs._beholding[0].name}">
                🐉 ${gs._beholding[0].name}
              </div>
            ` : ''}
            <div class="life-box ${p1LifeClass}" ${this.targetingMode && this.targetingMode.effects && this.targetingMode.effects.some(e => e.target === 'any target' || e.target === 'creature or player') ? `onclick="UIGame.selectTarget('player', 1, null)" style="cursor:pointer;outline:2px solid #f44;animation:pulse 1s infinite"` : ''}>
              <span class="life-number">${p1.life}</span>
              <span class="life-label">vida</span>
            </div>
            ${this.targetingMode && this.targetingMode.effects && this.targetingMode.effects.some(e => e.target === 'any target' || e.target === 'creature or player') ? `<button class="btn-target-player" onclick="UIGame.selectTarget('player', 1, null)" style="background:#c33;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:12px;animation:pulse 1s infinite">Alvo: Jogador</button>` : ''}
            <span class="info-counts">
              <span title="Cartas na mao">&#9997; ${p1.zones.hand.count()}</span>
              <span title="Cartas no deck">&#128215; ${p1.zones.library.count()}</span>
              <span class="gy-clickable" title="Cemiterio (clique para ver)" onclick="UIGame.showGraveyard(1)">&#9760; ${p1.zones.graveyard.count()}</span>
              ${p1.zones.exile && p1.zones.exile.count() > 0 ? `<span class="exile-clickable" title="Exilio (clique para ver)" onclick="UIGame.showExile(1)">&#10060; ${p1.zones.exile.count()}</span>` : ''}
            </span>
          </div>

          <!-- Opponent battlefield -->
          <div class="game-opponent-bf battlefield opponent-bf">
            ${this._renderBattlefield(p1.zones.battlefield.getAll(), 1)}
          </div>

          <!-- Combat Zone (shows during combat) -->
          ${this._renderCombatZone()}

          <!-- Divider -->
          <div class="battlefield-divider"></div>

          <!-- My battlefield -->
          <div class="game-my-bf battlefield">
            ${this._renderBattlefield(p0.zones.battlefield.getAll(), 0)}
          </div>

          <!-- Harmonize indicator - always shown, but disabled when can't cast -->
          <div class="harmonize-bar ${harmonizeCards.length === 0 ? 'harmonize-empty' : ''}">
            <span class="harmonize-label">HARMONIZE</span>
            ${harmonizeCards.map(c => `
              <div class="harmonize-card ${!c._harmonizeCanCast ? 'harmonize-disabled' : ''}"
                   ${CardZoom.attr(c)}
                   title="Harmonizar ${c.name} (${CardEngine.getHarmonizeCost(c)})${!c._harmonizeCanCast ? ' [desabilitado]' : ''}"
                   ${c._harmonizeCanCast ? `onclick="UIGame.castHarmonize('${c._uid}')"` : ''}>
                <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" alt="${c.name}" loading="lazy">
                <span class="harmonize-cost">${CardEngine.getHarmonizeCost(c).replace(/\{/g, '').replace(/\}/g, '')}</span>
              </div>
            `).join('')}
          </div>

          <!-- Hand + Library + Life -->
          <div class="game-bottom-row">
            <div class="game-my-hand">
              ${this._renderHand(p0.zones.hand.getAll(), playableIds)}
              ${this._renderExiledPlayable(gs, playableIds)}
              ${this._renderGraveyardActivatable(gs)}
            </div>
            <div class="game-library" title="Biblioteca (${p0.zones.library.count()} cartas)">
              <div class="library-stack">
                <div class="library-card-back"></div>
                <div class="library-card-back lib-offset-1"></div>
                <div class="library-card-back lib-offset-2"></div>
              </div>
              <span class="library-count">${p0.zones.library.count()}</span>
            </div>
            <!-- My info bar (moved to bottom) -->
            <div class="my-info-bar">
              <span class="my-name">Voce</span>
              <div class="life-box ${p0LifeClass}">
                <span class="life-number">${p0.life}</span>
                <span class="life-label">vida</span>
              </div>
              <span class="info-counts">
                <span title="Cartas no deck">&#128215; ${p0.zones.library.count()}</span>
                <span class="gy-clickable" title="Cemiterio (clique para ver)" onclick="UIGame.showGraveyard(0)">&#9760; ${p0.zones.graveyard.count()}</span>
                ${p0.zones.exile && p0.zones.exile.count() > 0 ? `<span class="exile-clickable" title="Exilio (clique para ver)" onclick="UIGame.showExile(0)">&#10060; ${p0.zones.exile.count()}</span>` : ''}
              </span>
            </div>
          </div>
        </div>

        <!-- Game log -->
        <div class="game-log ${this._logCollapsed ? 'collapsed' : ''}" id="game-log">
          <div class="log-header" onclick="UIGame.toggleLog()">
            <h4>Log <span class="log-toggle">${this._logCollapsed ? '&#9654;' : '&#9660;'}</span></h4>
            <span class="log-shortcut">L</span>
          </div>
          ${!this._logCollapsed ? `
            <div class="log-entries" id="log-entries">
              ${gs.log.slice(-25).map(l => `<div class="log-entry">${l}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Turn banner -->
        ${turnBannerHtml}

        <!-- Stack overlay -->
        ${this._showStack ? this._renderStackOverlay() : ''}

        <!-- Full Control Mode indicator -->
        ${this._fullControlMode ? '<div class="full-control-badge-fixed">FULL CONTROL</div>' : ''}

        <!-- Keyboard shortcuts help -->
        ${this._renderShortcutsHelp()}

        <!-- Graveyard overlay -->
        ${this._gyOverlay !== null ? this._renderGraveyardOverlay() : ''}
        ${this._exileOverlay !== null ? this._renderExileOverlay() : ''}

        <!-- Scry/Surveil overlay -->
        ${gs._pendingScry ? this._renderScryOverlay(gs._pendingScry) : ''}

        <!-- Look Top Choice overlay -->
        ${gs._pendingLookTop ? (
          gs._pendingLookTop.type === 'look_top_land_choice' ? this._renderLookTopLandOverlay(gs._pendingLookTop) :
          gs._pendingLookTop.type === 'look_top_permanent_choice' ? this._renderLookTopPermanentOverlay(gs._pendingLookTop) :
          this._renderLookTopOverlay(gs._pendingLookTop)
        ) : ''}

        <!-- Hand Exile overlay (Aggressive Negotiations) -->
        ${gs._pendingHandExile ? this._renderHandExileOverlay(gs._pendingHandExile) : ''}

        <!-- Modal choice overlay -->
        ${gs._pendingModal ? this._renderModalOverlay(gs._pendingModal) : ''}

        <!-- Clash overlay -->
        ${gs._pendingClash ? this._renderClashOverlay(gs._pendingClash) : ''}

        <!-- Hideaway overlay -->
        ${gs._pendingHideaway ? this._renderHideawayOverlay(gs._pendingHideaway) : ''}

        <!-- Blight choice overlay -->
        ${gs._pendingBlight ? this._renderBlightOverlay(gs._pendingBlight) : ''}

        <!-- Graveyard return choice overlay (Monastery Messenger etc.) -->
        ${gs._pendingGYReturn ? this._renderGYReturnOverlay(gs._pendingGYReturn) : ''}

        <!-- Mana color choice overlay -->
        ${gs._pendingManaChoice ? this._renderManaChoiceOverlay(gs._pendingManaChoice) : ''}

        <!-- Unless pay decision overlay (counter with payment option) -->
        ${gs._pendingUnlessPay ? this._renderUnlessPayOverlay(gs._pendingUnlessPay) : ''}

        <!-- Behold choice overlays -->
        ${gs._pendingBeholdChoice && gs.waitingForInput && gs.waitingForInput.type === 'behold_choice_multiple' ? this._renderBeholdChoiceMultipleOverlay(gs._pendingBeholdChoice) : ''}
        ${gs._pendingBeholdChoice && gs.waitingForInput && gs.waitingForInput.type === 'behold_choice_optional' ? this._renderBeholdChoiceOptionalOverlay(gs._pendingBeholdChoice) : ''}
        ${gs._pendingBeholdCardChoice ? this._renderBeholdCardChoiceOverlay() : ''}

        <!-- Endure choice overlay -->
        ${gs._pendingEndure ? this._renderEndureOverlay(gs._pendingEndure) : ''}

        <!-- Harmonize creature choice overlay -->
        ${gs._pendingHarmonize ? this._renderHarmonizeCreatureOverlay(gs._pendingHarmonize) : ''}

        <!-- Harmonize confirmation overlay -->
        ${gs._pendingHarmonizeConfirm ? this._renderHarmonizeConfirmOverlay(gs._pendingHarmonizeConfirm) : ''}

        <!-- Mill land choice overlay -->
        ${gs._pendingMillLandChoice ? this._renderMillLandChoiceOverlay(gs._pendingMillLandChoice) : ''}

        <!-- Target choice overlay -->
        ${gs._pendingTargetChoice ? this._renderTargetChoiceOverlay(gs._pendingTargetChoice) : ''}

        <!-- Player choice overlay (any_player targeting) -->
        ${gs._pendingPlayerChoice ? this._renderPlayerChoiceOverlay(gs._pendingPlayerChoice) : ''}

        <!-- Graveyard choice overlay -->
        ${gs._pendingGraveyardChoice ? this._renderGraveyardChoiceOverlay(gs._pendingGraveyardChoice) : ''}

        <!-- Graveyard card choice overlay -->
        ${gs._pendingGraveyardCardChoice ? this._renderGraveyardCardChoiceOverlay(gs._pendingGraveyardCardChoice) : ''}

        <!-- Traveling Botanist choice overlay -->
        ${gs._pendingTravelingBotanist ? this._renderTravelingBotanistOverlay(gs._pendingTravelingBotanist) : ''}

        <!-- Sacrifice cost overlay -->
        ${this._pendingSacrificeCast ? this._renderSacrificeCostOverlay() : ''}

        <!-- Sacrifice ability cost overlay (for Unrooted Ancestor, etc.) -->
        ${this._pendingSacrificeCostAbility ? this._renderSacrificeAbilityCostOverlay() : ''}

        <!-- Discard cost overlay -->
        ${this._pendingDiscardCast ? this._renderDiscardCostOverlay() : ''}

        <!-- Tap creature cost overlay -->
        ${this._pendingTapCast ? this._renderTapCostOverlay() : ''}

        <!-- Ramp land choice overlay -->
        ${gs._pendingRamp ? this._renderRampOverlay(gs._pendingRamp) : ''}

        <!-- Search library overlay -->
        ${gs._pendingSearch ? this._renderSearchOverlay(gs._pendingSearch) : ''}

        <!-- Spell target overlay (for counter effects) -->
        ${this.targetingMode && this.targetingMode.effects && this.targetingMode.effects.some(e => e.target === 'spell' || e.target === 'creature_spell' || e.target === 'noncreature_spell') ? this._renderSpellTargetOverlay() : ''}

        <!-- Ability Modal (Arena-style) -->
        ${this._renderAbilityModal()}
        ${this._renderAdventureChoiceModal()}
        ${this._renderLegendaryChoiceModal()}
        ${this._renderArtPickerModal()}

        <!-- AI Action Notification -->
        ${this._showingAIAction ? this._renderAIActionOverlay() : ''}

        <!-- Priority Indicator -->
        ${this._renderPriorityIndicator()}

        <!-- Winner overlay -->
        ${gs.winner !== null ? `
          <div class="game-over-overlay">
            <div class="game-over-box ${gs.winner === 0 ? 'victory' : 'defeat'}">
              <h2>${gs.winner === 0 ? 'Vitoria!' : 'Derrota!'}</h2>
              <p>${gs.winner === 0 ? 'Voce venceu a partida!' : 'O oponente venceu a partida.'}</p>
              <div class="game-over-stats">
                <span>Sua vida: <strong>${p0.life}</strong></span>
                <span>Oponente: <strong>${p1.life}</strong></span>
                <span>Turnos: <strong>${gs.turn}</strong></span>
                <span>Criaturas jogadas: <strong>${gs.log.filter(l => l.includes('Entra no Campo')).length}</strong></span>
              </div>
              <div style="display:flex;gap:10px;justify-content:center">
                <button class="btn btn-success" onclick="UIGame.restartGame()">Nova Partida</button>
                <button class="btn btn-primary" onclick="App.goHome()">Menu Principal</button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // Detect card draw for animation (human player only, not during mulligan)
    const currentHandSize = p0.zones.hand.count();
    const drawnCount = currentHandSize - this._prevHandSize;
    if (drawnCount > 0 && this._prevHandSize > 0 && gs.phase !== 'mulligan') {
      requestAnimationFrame(() => this._animateCardDraw(Math.min(drawnCount, 5)));
    }
    this._prevHandSize = currentHandSize;

    // Update tracking for next render
    this._prevLife = [p0.life, p1.life];
    this._prevTurn = gs.turn;
    this._prevActivePlayer = gs.activePlayer;

    // Auto-scroll log
    const logEl = document.getElementById('log-entries');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;

    // Draw combat arrows after DOM update
    requestAnimationFrame(() => this._drawCombatArrows());

    // Preload opponent hand card images (next draw) + error fallback
    this._preloadCardImages(gs);
  },

  _preloadedUrls: new Set(),
  _preloadCardImages(gs) {
    // Preload opponent battlefield cards (we might need to see them soon)
    const urls = [];
    for (const p of gs.players) {
      for (const c of p.zones.battlefield.cards) {
        const url = c.image_small || c.image_normal;
        if (url && !this._preloadedUrls.has(url)) urls.push(url);
      }
      for (const c of p.zones.hand.getAll()) {
        const url = c.image_small || c.image_normal;
        if (url && !this._preloadedUrls.has(url)) urls.push(url);
      }
    }
    // Preload in background (max 6 at a time)
    urls.slice(0, 6).forEach(url => {
      this._preloadedUrls.add(url);
      const img = new Image();
      img.src = url;
    });

    // Add error fallback to all card images in DOM
    requestAnimationFrame(() => {
      document.querySelectorAll('.bf-card img, .hand-card img').forEach(img => {
        if (!img._errorHandler) {
          img._errorHandler = true;
          img.onerror = function() {
            this.style.display = 'none';
            this.parentElement.style.background = 'linear-gradient(135deg, #1a0a2e, #2d1b4e)';
          };
        }
      });
    });
  },

  // =================== Mulligan UI ===================

  _renderMulliganScreen(gs, p0, p1) {
    const mulls = gs.mulliganCount[0];
    const hand = p0.zones.hand.getAll();
    const bottomNeeded = mulls; // how many cards to put on bottom

    return `
      <div class="mulligan-overlay">
        <div class="mulligan-box">
          <h2>Mulligan</h2>
          <p class="mulligan-info">
            ${mulls === 0
              ? 'Sua mao inicial (7 cartas). Manter ou mulligan?'
              : `Mulligan #${mulls} - Voce comprou 7 cartas. Escolha ${bottomNeeded} para colocar no fundo.`}
          </p>
          <div class="mulligan-hand">
            ${hand.map(c => {
              const isSelected = this._mulliganBottomCards.includes(c._uid);
              return `
                <div class="mulligan-card ${isSelected ? 'mulligan-selected' : ''} ${mulls > 0 ? 'mulligan-pickable' : ''}"
                     ${mulls > 0 ? `onclick="UIGame.toggleMulliganBottom('${c._uid}')"` : ''}
                     ${CardZoom.attr(c)}
                     title="${c.name} ${c.mana_cost || ''} - ${c.type_line || ''}">
                  <div class="card-image-container">
                    <img src="${c.image_normal || c.image_small}" alt="${c.name}" loading="lazy">
                    <button class="card-art-button" onclick="event.stopPropagation(); UIGame.openArtPickerModal('${c._uid}')" title="Escolher arte">🎨</button>
                  </div>
                  ${isSelected ? '<div class="mulligan-bottom-badge">FUNDO</div>' : ''}
                </div>
              `;
            }).join('')}
          </div>
          <div class="mulligan-stats">
            <span>Terrenos: ${hand.filter(c => CardEngine.isLand(c)).length}</span>
            <span>Criaturas: ${hand.filter(c => CardEngine.isCreature(c)).length}</span>
            <span>Feiticos: ${hand.filter(c => !CardEngine.isLand(c) && !CardEngine.isCreature(c)).length}</span>
          </div>
          <div class="mulligan-actions">
            ${mulls > 0 && this._mulliganBottomCards.length === bottomNeeded ? `
              <button class="btn btn-primary" onclick="UIGame.keepHand()">
                Manter (${7 - mulls} cartas) <kbd>Enter</kbd>
              </button>
            ` : mulls === 0 ? `
              <button class="btn btn-primary" onclick="UIGame.keepHand()">
                Manter Mao <kbd>Enter</kbd>
              </button>
            ` : `
              <button class="btn btn-primary" disabled>
                Selecione ${bottomNeeded - this._mulliganBottomCards.length} carta(s) para o fundo
              </button>
            `}
            ${mulls < 3 ? `
              <button class="btn btn-accent" onclick="UIGame.doMulligan()">
                Mulligan (vai para ${6 - mulls} cartas) <kbd>M</kbd>
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  },

  toggleMulliganBottom(uid) {
    const mulls = this.gameState.mulliganCount[0];
    const needed = mulls;
    if (needed === 0) return;

    const idx = this._mulliganBottomCards.indexOf(uid);
    if (idx >= 0) {
      this._mulliganBottomCards.splice(idx, 1);
    } else if (this._mulliganBottomCards.length < needed) {
      this._mulliganBottomCards.push(uid);
    }
    this.render();
  },

  doMulligan() {
    const gs = this.gameState;
    this._mulliganBottomCards = [];
    GameState.mulligan(gs, 0);
    this.render();
  },

  keepHand() {
    const gs = this.gameState;
    const mulls = gs.mulliganCount[0];

    if (mulls > 0 && this._mulliganBottomCards.length < mulls) {
      // Auto-select cheapest cards if not enough selected
      const hand = gs.players[0].zones.hand.getAll()
        .filter(c => !this._mulliganBottomCards.includes(c._uid))
        .sort((a, b) => (a.cmc || 0) - (b.cmc || 0));
      while (this._mulliganBottomCards.length < mulls && hand.length > 0) {
        this._mulliganBottomCards.push(hand.shift()._uid);
      }
    }

    GameState.keepHand(gs, 0, this._mulliganBottomCards);
    this._mulliganBottomCards = [];

    // Check if both players are done
    if (gs.mulliganDone[0] && gs.mulliganDone[1]) {
      GameState.startGame(gs);
    }

    this.render();
    this._continueIfAI();
  },

  // =================== Rendering ===================

  _renderPhaseStrip() {
    const gs = this.gameState;
    const phases = [
      { key: 'untap', short: 'UNT' },
      { key: 'upkeep', short: 'UPK' },
      { key: 'draw', short: 'DRW' },
      { key: 'main1', short: 'M1' },
      { key: 'combat_begin', short: 'CBT' },
      { key: 'combat_attackers', short: 'ATK' },
      { key: 'combat_blockers', short: 'BLK' },
      { key: 'combat_damage', short: 'DMG' },
      { key: 'combat_end', short: 'END' },
      { key: 'main2', short: 'M2' },
      { key: 'end', short: 'END' },
      { key: 'cleanup', short: 'CLN' },
    ];

    return phases.map(p => {
      const isCurrent = gs.phase === p.key;
      const isPast = GameState.PHASES.indexOf(p.key) < gs.phaseIndex;
      return `<span class="phase-pip ${isCurrent ? 'active' : ''} ${isPast ? 'past' : ''}">${p.short}</span>`;
    }).join('');
  },

  _renderPhaseStripVertical() {
    const gs = this.gameState;
    const phases = [
      { key: 'untap', short: 'UNT', name: 'Desvirar' },
      { key: 'upkeep', short: 'UPK', name: 'Manutencao' },
      { key: 'draw', short: 'DRW', name: 'Compra' },
      { key: 'main1', short: 'M1', name: 'Principal 1' },
      { key: 'combat_begin', short: 'CBT', name: 'Combate' },
      { key: 'combat_attackers', short: 'ATK', name: 'Atacantes' },
      { key: 'combat_blockers', short: 'BLK', name: 'Bloqueio' },
      { key: 'combat_damage', short: 'DMG', name: 'Dano' },
      { key: 'combat_end', short: 'CEND', name: 'Fim Combate' },
      { key: 'main2', short: 'M2', name: 'Principal 2' },
      { key: 'end', short: 'END', name: 'Final' },
      { key: 'cleanup', short: 'CLN', name: 'Limpeza' },
    ];

    return phases.map(p => {
      const isCurrent = gs.phase === p.key;
      const isPast = GameState.PHASES.indexOf(p.key) < gs.phaseIndex;
      return `<div class="phase-row ${isCurrent ? 'active' : ''} ${isPast ? 'past' : ''}">
        <span class="phase-short">${p.short}</span>
      </div>`;
    }).join('');
  },

  _renderManaPool(pool) {
    const colors = [
      { key: 'W', symbol: 'W', cls: 'mana-w' },
      { key: 'U', symbol: 'U', cls: 'mana-u' },
      { key: 'B', symbol: 'B', cls: 'mana-b' },
      { key: 'R', symbol: 'R', cls: 'mana-r' },
      { key: 'G', symbol: 'G', cls: 'mana-g' },
      { key: 'C', symbol: 'C', cls: 'mana-c' },
    ];
    const parts = [];

    // Initialize previous pool if not exists
    if (!this._prevManaPool) {
      this._prevManaPool = {};
    }

    const prev = this._prevManaPool;

    for (const c of colors) {
      const current = pool[c.key] || 0;
      const previous = prev[c.key] || 0;

      for (let i = 0; i < current; i++) {
        // Only animate newly added mana, and only if we actually have previous state
        const isNew = (Object.keys(prev).length > 0) && (i >= previous);
        parts.push(`<span class="mana-pip ${c.cls} ${isNew ? 'in-pool' : ''}">${c.symbol}</span>`);
      }
    }

    // Only update previous pool if it's actually different
    const poolChanged = JSON.stringify(prev) !== JSON.stringify(pool);
    if (poolChanged) {
      this._prevManaPool = { ...pool };
    }

    const total = ManaSystem.poolTotal(pool);
    if (parts.length > 0) {
      return `
        <div class="mana-pool-visual">${parts.join('')}</div>
        <div class="mana-pool-total">${total} mana disponivel</div>
      `;
    }
    return '<span class="mana-empty">Sem mana na pool</span>';
  },

  _renderBattlefield(cards, playerId) {
    const lands = cards.filter(c => CardEngine.isLand(c));
    const creatures = cards.filter(c => CardEngine.isCreature(c));
    // Filter out attached equipment/auras (they render under their host)
    const other = cards.filter(c => !CardEngine.isLand(c) && !CardEngine.isCreature(c) && !c._attachedTo);

    const creaturesHtml = creatures.length > 0 || other.length > 0
      ? creatures.map(c => this._renderBfCard(c, playerId)).join('') +
        other.map(c => this._renderBfCard(c, playerId)).join('')
      : '<span class="bf-empty">Sem criaturas</span>';

    const landsHtml = lands.length > 0
      ? this._renderLandStacks(lands, playerId)
      : '';

    // Layout: lands on left, creatures/other in center-right
    return `
      <div class="bf-layout">
        <div class="bf-lands-col">
          ${landsHtml}
        </div>
        <div class="bf-creatures-col">
          ${creaturesHtml}
        </div>
      </div>
    `;
  },

  _renderBfCard(card, playerId) {
    const isCreature = CardEngine.isCreature(card);
    const isAttacking = card._attacking;
    const isBlocking = card._blocking;
    const isSelected = this.selectedAttackers.has(card._uid) || this.selectedBlockers[card._uid];
    const isPendingBlocker = this._pendingBlockerUid === card._uid;
    const tapped = card._tapped ? 'tapped' : '';
    // Summoning sick only applies to creatures
    const sick = isCreature && card._summoningSick && !CardEngine.hasKeyword(card, 'Haste') ? 'summoning-sick' : '';
    const power = isCreature ? CardEngine.getPower(card) : 0;
    const toughness = isCreature ? CardEngine.getToughness(card) : 0;
    const currentToughness = toughness - (card._damage || 0);
    const damaged = isCreature && card._damage > 0 ? 'damaged' : '';
    const tokenColor = card._isToken && card.colors && card.colors[0] ? `token-${card.colors[0]}` : '';
    const isToken = card._isToken ? `token ${tokenColor}` : '';

    let clickAction = '';
    let clickable = '';
    const gs = this.gameState;

    if (gs && gs.waitingForInput) {
      if (gs.waitingForInput.type === 'declare_attackers' && playerId === 0 && CardEngine.canAttack(card)) {
        clickAction = `onclick="UIGame.toggleAttacker('${card._uid}')"`;
        clickable = 'clickable can-attack';
      } else if (gs.waitingForInput.type === 'declare_blockers' && playerId === 0 && !card._tapped && CardEngine.isCreature(card)) {
        clickAction = `onclick="UIGame.selectBlocker('${card._uid}')"`;
        clickable = 'clickable can-block';
      } else if (gs.waitingForInput.type === 'declare_blockers' && playerId === 1 && card._attacking) {
        clickAction = `onclick="UIGame.assignBlockToAttacker('${card._uid}')"`;
        clickable = 'clickable target-attacker';
      } else if (gs.waitingForInput.type === 'buff_choice' && playerId === 0 && CardEngine.isCreature(card) &&
                 gs._pendingBuffChoice && gs._pendingBuffChoice.candidates.includes(card._uid)) {
        clickAction = `onclick="UIGame.selectBuffTarget('${card._uid}')"`;
        clickable = 'clickable can-block'; // green glow
      } else if (gs.waitingForInput.type === 'multi_buff_choice' && playerId === 0 && CardEngine.isCreature(card) &&
                 gs._pendingMultiBuffChoice && gs._pendingMultiBuffChoice.candidates.includes(card._uid)) {
        clickAction = `onclick="UIGame.selectMultiBuffTarget('${card._uid}')"`;
        const isSelected = gs._pendingMultiBuffChoice.selected.includes(card._uid);
        clickable = isSelected ? 'clickable selected' : 'clickable can-block';
      } else if (gs.waitingForInput.type === 'order_blockers' && playerId === 1 && card._blocking) {
        // Check if this blocker belongs to the currently ordered attacker
        const atkUids = gs.waitingForInput.attackerUids || [];
        const currentIdx = this._orderingAttackerIndex || 0;
        const currentAtkUid = atkUids[currentIdx];
        if (card._blocking === currentAtkUid) {
          clickAction = `onclick="UIGame.selectBlockerOrder('${card._uid}')"`;
          const orderPos = (this._blockerOrderSelection || []).indexOf(card._uid);
          clickable = orderPos >= 0 ? 'clickable selected' : 'clickable needs-ordering';
        }
      } else if (gs.waitingForInput.type === 'hand_exile_choice' && gs._pendingHandExile) {
        // Allow clicking on revealed hand cards to exile them
        const cards = gs._pendingHandExile.cards || [];
        if (cards.some(c => c._uid === card._uid)) {
          clickAction = `onclick="UIGame.selectHandExileTarget('${card._uid}')"`;
          clickable = 'clickable can-exile';
        }
      }
    }

    if (this.targetingMode && playerId !== undefined) {
      // Only allow targeting if card can be targeted
      const canTarget = CardEngine.canBeTargeted(card, 0);

      // Check if the card type matches what the effect requires
      const effects = this.targetingMode.effects || [];
      const requiresCreature = effects.some(e =>
        e.target === 'creature' || e.target === 'own_creature' || e.target === 'opponent_creature'
      );
      const requiresCreatureWithFlying = effects.some(e => e.target === 'creature_with_flying');
      const requiresCreatureWithoutFlying = effects.some(e => e.target === 'creature_without_flying');
      const requiresDragons = effects.some(e => e.target === 'dragons');
      const requiresArtifactOrEnchantment = effects.some(e =>
        e.target === 'artifact_or_enchantment' || e.target === 'opponent_artifact_or_enchantment'
      );
      const requiresNonland = effects.some(e => e.target === 'nonland_permanent' || e.target === 'opponent_nonland');
      const isCreature = CardEngine.isCreature(card);
      const hasFlying = CardEngine.hasKeyword(card, 'Flying');
      const isDragon = CardEngine.hasCreatureType(card, 'Dragon');
      const isLand = CardEngine.isLand(card);
      const isArtifact = (card.type_line || '').toLowerCase().includes('artifact');
      const isEnchantment = (card.type_line || '').toLowerCase().includes('enchantment');
      const isArtifactOrEnchantment = isArtifact || isEnchantment;

      // Check if target matches what the effect requires
      let matchesTargetType = true;
      if (requiresNonland) matchesTargetType = !isLand;
      else if (requiresCreatureWithFlying) matchesTargetType = isCreature && hasFlying;
      else if (requiresCreatureWithoutFlying) matchesTargetType = isCreature && !hasFlying;
      else if (requiresDragons) matchesTargetType = isDragon;
      else if (requiresCreature) matchesTargetType = isCreature;
      else if (requiresArtifactOrEnchantment) matchesTargetType = isArtifactOrEnchantment;

      // Restrict to attacking/blocking creatures if the effect requires it
      const needsAttackingOrBlocking = effects.some(e => e.target === 'attacking_or_blocking_creature');
      const isAttackingOrBlocking = card._attacking || card._blocking;

      if ((canTarget || this.targetingMode.isAura) && matchesTargetType && (!needsAttackingOrBlocking || isAttackingOrBlocking)) {
        const targetType = isCreature ? 'creature' : 'permanent';
        clickAction = `onclick="UIGame.selectTarget('${targetType}', ${playerId}, '${card._uid}')"`;
        clickable = 'clickable targetable';
      } else {
        clickable = needsAttackingOrBlocking && !isAttackingOrBlocking ? '' : 'hexproof-shield';
      }
    }

    // Keywords badge - expanded list
    const keywords = (card.keywords || []).filter(k =>
      ['Flying', 'First Strike', 'Double Strike', 'Deathtouch', 'Lifelink', 'Trample',
       'Vigilance', 'Haste', 'Reach', 'Menace', 'Defender', 'Hexproof', 'Indestructible',
       'Ward', 'Shroud', 'Flash'].includes(k)
    );
    const kwBadge = keywords.length > 0
      ? `<div class="bf-card-keywords">${keywords.map(k => k.slice(0, 3).toUpperCase()).join(' ')}</div>`
      : '';

    // Counter badges
    let counterBadge = '';
    if (card._counters) {
      const p1 = card._counters['+1/+1'] || 0;
      const m1 = card._counters['-1/-1'] || 0;
      if (p1 > 0) counterBadge += `<span class="counter-badge counter-plus">+${p1}</span>`;
      if (m1 > 0) counterBadge += `<span class="counter-badge counter-minus">-${m1}</span>`;
    }

    // Aura/Equipment indicator
    let attachBadge = '';
    if (card._attachedTo) {
      attachBadge = `<div class="attach-badge">${CardEngine.isAura(card) ? 'AURA' : 'EQP'}</div>`;
    }
    if (card._attachments && card._attachments.length > 0) {
      attachBadge = `<div class="attach-badge">+${card._attachments.length}</div>`;
    }

    // Equipment on battlefield (unattached) - show equip action
    let equipAction = '';
    if (CardEngine.isEquipment(card) && !card._attachedTo && playerId === 0 && gs && gs.waitingForInput && gs.waitingForInput.type === 'main_phase') {
      equipAction = `ondblclick="UIGame.startEquip('${card._uid}')"`;
    }

    // Transform badge for DFC cards
    let transformBadge = '';
    if (CardEngine.isTransformCard(card) && playerId === 0 && gs && gs.waitingForInput &&
        gs.waitingForInput.type === 'main_phase' && gs.waitingForInput.playerId === 0) {
      transformBadge = `<div class="transform-badge" onclick="event.stopPropagation(); UIGame.transformCard('${card._uid}')" title="Transformar">&#x21C4;</div>`;
    } else if (CardEngine.isTransformCard(card)) {
      transformBadge = `<div class="transform-badge" style="opacity:0.4" title="DFC">&#x21C4;</div>`;
    }

    // Planeswalker loyalty abilities - open modal on click
    const isPW = CardEngine.isPlaneswalker(card);
    const loyaltyAbilities = CardEngine.getLoyaltyAbilities(card);
    const hasPWAbility = isPW && loyaltyAbilities.length > 0 && playerId === 0;
    if (hasPWAbility && gs && gs.waitingForInput &&
        gs.waitingForInput.type === 'main_phase' && gs.waitingForInput.playerId === 0 &&
        !card._loyaltyUsedThisTurn) {
      clickAction = `onclick="UIGame.openPlaneswalkerModal('${card._uid}')"`;
      clickable = 'clickable has-ability';
    }

    // Activated abilities - open modal on click (Arena-style)
    const abilities = CardEngine.getActivatedAbilities(card);
    const hasActivated = abilities.length > 0 && playerId === 0;
    let hasAbilityClass = '';
    let abilityIndicator = '';

    if (hasActivated && gs && gs.waitingForInput &&
        (gs.waitingForInput.type === 'main_phase' || gs.waitingForInput.type === 'instant_priority' || gs.waitingForInput.type === 'stack_priority') &&
        gs.waitingForInput.playerId === 0) {
      // Check if any ability can be afforded
      const canAffordAny = abilities.some(ab => {
        if (ab.cost.tap && card._tapped) return false;
        const { manaCost, cmc } = UIGame._getAbilityManaCost(ab);
        if (cmc > 0) {
          const fakeCard = { mana_cost: manaCost, cmc };
          if (!ManaSystem.canAfford(gs, 0, fakeCard)) return false;
        }
        if (ab.cost.removeCounter && card._counters) {
          if ((card._counters[ab.cost.removeCounter] || 0) <= 0) return false;
        }
        if (ab.cost.blight) {
          // Need at least one creature to blight
          const hasCreature = gs.players[0].zones.battlefield.cards.some(c => CardEngine.isCreature(c));
          if (!hasCreature) return false;
        }
        return true;
      });
      if (canAffordAny) {
        hasAbilityClass = 'has-ability';
        abilityIndicator = `<div class="ability-indicator">!</div>`;
        // Single click opens ability modal (Arena-style)
        if (!equipAction) {
          clickAction = `onclick="UIGame.openAbilityModal('${card._uid}')"`;
          clickable = 'clickable';
        }
      }
    }

    // Token placeholder if no image
    const hasImage = card.image_small || card.image_normal;
    let imageHtml;
    if (hasImage) {
      imageHtml = `<div class="card-image-container">
        <img src="${card.image_small || card.image_normal}" alt="${card.name}" loading="lazy">
        <button class="card-art-button" onclick="event.stopPropagation(); UIGame.openArtPickerModal('${card._uid}')" title="Escolher arte">🎨</button>
      </div>`;
    } else {
      const tokenKws = (card.keywords || []).filter(k =>
        ['Flying', 'Deathtouch', 'Lifelink', 'Trample', 'Vigilance', 'Haste', 'First Strike', 'Menace'].includes(k)
      );
      const kwLine = tokenKws.length > 0 ? `<span class="token-keywords">${tokenKws.join(' / ')}</span>` : '';
      // Token art emoji based on creature type / name
      const tokenArt = this._getTokenArt(card);
      if (isCreature) {
        imageHtml = `<div class="token-placeholder">
          <span class="token-type">Token Creature</span>
          ${tokenArt ? `<span class="token-art">${tokenArt}</span>` : ''}
          <span class="token-name">${card.name}</span>
          <span class="token-pt">${power}/${toughness}</span>
          ${kwLine}
        </div>`;
      } else {
        imageHtml = `<div class="token-placeholder">
          <span class="token-type">Token</span>
          ${tokenArt ? `<span class="token-art">${tokenArt}</span>` : ''}
          <span class="token-name">${card.name}</span>
        </div>`;
      }
    }

    // Only show P/T for creatures
    const statsClass = isCreature && card._damage > 0 ? 'bf-card-stats has-damage' : 'bf-card-stats';
    const statsHtml = isCreature ? `<div class="${statsClass}">${power}/${currentToughness}</div>` : '';

    // Damage indicator badge
    const damageBadge = isCreature && card._damage > 0
      ? `<div class="bf-card-damage">-${card._damage}</div>`
      : '';

    // Stun counter badge
    const stunBadge = card._stunCounters > 0
      ? `<div class="bf-card-stun">${card._stunCounters} STUN</div>`
      : '';

    // Saga chapter badge
    const sagaBadge = card._isSaga
      ? `<div class="bf-card-saga">CH ${card._sagaChapter || 0}/${card._sagaMaxChapter || '?'}</div>`
      : '';

    // Planeswalker loyalty badge
    const loyaltyBadge = isPW
      ? `<div class="bf-card-loyalty">${card._loyalty || 0}</div>`
      : '';

    // Blocker order position badge
    let orderBadge = '';
    if (gs && gs.waitingForInput && gs.waitingForInput.type === 'order_blockers' && this._blockerOrderSelection) {
      const orderPos = this._blockerOrderSelection.indexOf(card._uid);
      if (orderPos >= 0) {
        orderBadge = `<div class="bf-card-order">${orderPos + 1}</div>`;
      }
    }

    return `
      <div class="bf-card ${tapped} ${isAttacking ? 'attacking' : ''} ${isBlocking ? 'blocking' : ''} ${isSelected ? 'selected' : ''} ${isPendingBlocker ? 'pending-blocker' : ''} ${sick} ${clickable} ${damaged} ${isToken} ${hasAbilityClass}"
           data-uid="${card._uid}"
           ${hasImage ? CardZoom.attr(card) : ''}
           ${clickAction}
           ${equipAction}
           onmouseenter="UIGame.showCardTooltip('${card._uid}', event)"
           onmouseleave="UIGame.hideCardTooltip()"
           title="${card.name}${keywords.length ? ' - ' + keywords.join(', ') : ''}${hasActivated ? ' [clique para habilidades]' : ''}${equipAction && CardEngine.isEquipment(card) ? ' [dbl-click: equipar]' : ''}">
        ${imageHtml}
        ${statsHtml}
        ${damageBadge}
        ${stunBadge}
        ${sagaBadge}
        ${loyaltyBadge}
        ${kwBadge}
        ${counterBadge}
        ${attachBadge}
        ${abilityIndicator}
        ${transformBadge}
        ${orderBadge}
        ${isAttacking ? '<div class="bf-card-badge atk-badge">ATK</div>' : ''}
        ${isBlocking ? '<div class="bf-card-badge blk-badge">BLK</div>' : ''}
        <div class="bf-card-name">${card.name}</div>
        ${this._renderExiledUnder(card, playerId)}
      </div>
    `;
  },

  _renderExiledUnder(card, playerId) {
    const items = [];

    // Attached equipment/auras (render under the equipped creature)
    if (card._attachments && card._attachments.length > 0 && this.gameState) {
      const bf = this.gameState.players[playerId].zones.battlefield;
      for (const attUid of card._attachments) {
        const att = bf.get(attUid);
        if (att) {
          items.push({
            name: att.name,
            image_small: att.image_small || (att.image_uris && att.image_uris.small),
            _uid: att._uid,
            _isAttachment: true
          });
        }
      }
    }

    // Champion exiled card
    if (card._championedCard && card._exiledCards) {
      items.push(...card._exiledCards);
    }
    // Hideaway card (face-down for opponent, face-up for human)
    if (card._hideawayCard) {
      const hw = card._hideawayCard;
      items.push({
        name: hw.name,
        image_small: playerId === 0 ? (hw.image_small || (hw.image_uris && hw.image_uris.small)) : null,
        _uid: hw._uid,
        _faceDown: playerId !== 0
      });
    }
    // Exile_top_play and other exiled cards
    if (card._exiledCards && !card._championedCard) {
      items.push(...card._exiledCards);
    }

    if (items.length === 0) return '';

    // Show max 3 thumbs, count badge if more
    const maxShow = 3;
    const shown = items.slice(0, maxShow);
    const thumbs = shown.map((ex, i) => {
      if (ex._faceDown) {
        return `<div class="exiled-under-thumb face-down" style="z-index:${i}" title="Carta exilada (oculta)"></div>`;
      }
      const img = ex.image_small || (ex.image_uris && ex.image_uris.small) || '';
      const cls = ex._isAttachment ? 'exiled-under-thumb attachment-thumb' : 'exiled-under-thumb';

      // For equipment, add click handler if player is human
      let clickHandler = '';
      if (ex._isAttachment && playerId === 0 && this.gameState && this.gameState.waitingForInput && this.gameState.waitingForInput.type === 'main_phase') {
        clickHandler = `onclick="event.stopPropagation(); UIGame.startReequip('${ex._uid}')"`;
      }

      // Equipment label showing cost and name
      const equipLabel = ex._isAttachment ? `<div class="equip-label">${ex.mana_cost || ''} ${ex.name}</div>` : '';

      return `<div class="${cls}" style="z-index:${i}" title="${ex.name}${ex._isAttachment ? ' [click para equipar em outra criatura]' : ''}" ${clickHandler}>
        ${img ? `<img src="${img}" alt="${ex.name}">` : `<span class="exiled-name">${(ex.name || '?').slice(0, 6)}</span>`}
        ${equipLabel}
      </div>`;
    }).join('');

    const countBadge = items.length > maxShow ? `<div class="exiled-under-count">+${items.length - maxShow}</div>` : '';
    return `<div class="exiled-under-container">${thumbs}${countBadge}</div>`;
  },

  _renderLandStacks(lands, playerId) {
    // Separate untapped and tapped, group by name
    const untapped = lands.filter(c => !c._tapped);
    const tapped = lands.filter(c => c._tapped);

    const groupByName = (arr) => {
      const groups = {};
      arr.forEach(c => {
        const key = c.name;
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
      });
      return Object.values(groups);
    };

    const untappedGroups = groupByName(untapped);
    const tappedGroups = groupByName(tapped);

    let html = '';
    untappedGroups.forEach(group => {
      html += `<div class="land-stack" data-count="${group.length}">`;
      group.forEach((c, i) => {
        html += this._renderBfLand(c, playerId, i);
      });
      html += `</div>`;
    });
    tappedGroups.forEach(group => {
      html += `<div class="land-stack tapped-stack" data-count="${group.length}">`;
      group.forEach((c, i) => {
        html += this._renderBfLand(c, playerId, i);
      });
      html += `</div>`;
    });
    return html;
  },

  _renderBfLand(card, playerId, stackIndex) {
    const tapped = card._tapped ? 'tapped' : '';
    const color = ManaSystem.getLandManaColor(card);
    let clickAction = '';
    let clickable = '';
    let abilityIndicator = '';
    let hasAbilityClass = '';
    const gs = this.gameState;

    // Check for activated abilities first (like Evolving Wilds)
    const abilities = CardEngine.getActivatedAbilities(card);
    const hasActivated = abilities.length > 0 && playerId === 0;

    if (hasActivated && gs && gs.waitingForInput &&
        (gs.waitingForInput.type === 'main_phase' || gs.waitingForInput.type === 'instant_priority' || gs.waitingForInput.type === 'stack_priority') &&
        gs.waitingForInput.playerId === 0) {
      // Check if any ability can be afforded
      const canAffordAny = abilities.some(ab => {
        if (ab.cost.tap && card._tapped) return false;
        const { manaCost, cmc } = UIGame._getAbilityManaCost(ab);
        if (cmc > 0) {
          const fakeCard = { mana_cost: manaCost, cmc };
          if (!ManaSystem.canAfford(gs, 0, fakeCard)) return false;
        }
        return true;
      });
      if (canAffordAny) {
        hasAbilityClass = 'has-ability';
        abilityIndicator = `<div class="ability-indicator">!</div>`;
        // Activated abilities take precedence over mana production
        clickAction = `onclick="UIGame.openAbilityModal('${card._uid}')"`;
        clickable = 'clickable';
      }
    }

    // If no activated abilities or can't afford them, set up mana tapping
    if (!clickAction && gs && gs.activePlayer === 0 && !card._tapped && playerId === 0) {
      clickAction = `onclick="UIGame.tapLand('${card._uid}')"`;
      clickable = 'clickable';
    }

    // Use card image if available, otherwise show colored fallback
    const hasImage = card.image_small || card.image_normal;
    const imageHtml = hasImage
      ? `<img src="${card.image_small || card.image_normal}" alt="${card.name}" loading="lazy">`
      : `<div class="land-fallback land-color-${color}">${card.name.replace('Basic Land — ', '').replace('Land — ', '')}</div>`;

    const si = stackIndex || 0;
    return `
      <div class="bf-land ${tapped} ${clickable} ${hasAbilityClass}" data-uid="${card._uid}" style="--stack-i:${si}" ${CardZoom.attr(card)} ${clickAction}
           title="${hasAbilityClass ? card.name + ' - Ativar habilidade' : card.name + ' - Tap: add {' + color + '}'}">
        ${imageHtml}
        ${abilityIndicator}
      </div>
    `;
  },

  _renderHand(cards, playableIds) {
    if (cards.length === 0) return '<div class="hand-empty">Mao vazia</div>';

    const gs = this.gameState;
    const discardMode = gs && gs.waitingForInput && (gs.waitingForInput.type === 'discard' || gs.waitingForInput.type === 'mandatory_discard' || gs.waitingForInput.type === 'discard_for_loot' || gs.waitingForInput.type === 'choose_discard_cost' || gs.waitingForInput.type === 'rummage_discard' || gs.waitingForInput.type === 'optional_discard_choice');
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';

    return cards.map(c => {
      const canPlay = playableIds.has(c._uid);
      const isSelected = this.selectedCard === c._uid;

      // Check for cycling ability
      const cycling = CardEngine.parseCyclingAbility(c);
      const canCycle = cycling && isMainPhase && gs.activePlayer === 0 && !discardMode;
      const canAffordCycling = canCycle && ManaSystem.canAfford(gs, 0, { mana_cost: `{${cycling.cost}}`, cmc: cycling.cost });

      let clickAction = '';
      let dblClickAction = '';
      let hoverAction = '';
      if (canPlay) {
        clickAction = `onclick="UIGame.playCard('${c._uid}')"`;
        // Mana preview on hover (adventure or evoke cost if can't afford main)
        let manaCostForPreview = c.mana_cost;
        let cmcForPreview = c.cmc;
        if (CardEngine.hasAdventure(c) && !ManaSystem.canAfford(gs, 0, c)) {
          manaCostForPreview = CardEngine.getAdventureCost(c);
          cmcForPreview = CardEngine.getAdventureCMC(c);
        } else if (CardEngine.getEvokeCost(c) && !ManaSystem.canAfford(gs, 0, c)) {
          manaCostForPreview = CardEngine.getEvokeCost(c);
          cmcForPreview = ManaSystem.parseCost(manaCostForPreview).total || 0;
        }
        hoverAction = `onmouseenter="UIGame.showManaPreview('${c._uid}', '${manaCostForPreview}', ${cmcForPreview})" onmouseleave="UIGame.hideManaPreview()"`;
      } else if (discardMode) {
        clickAction = `onclick="UIGame.discardCard('${c._uid}')"`;
      }

      // Cycling on double-click
      if (canAffordCycling) {
        dblClickAction = `ondblclick="UIGame.activateCycling('${c._uid}')"`;
      }

      // Show reduced cost if available, otherwise show original cost
      let costDisplay = '';
      if (c._costReduced && c._effectiveCmc !== undefined) {
        // Show original cost struck through and new cost
        const originalCmc = c.cmc || 0;
        const effectiveCmc = c._effectiveCmc;
        costDisplay = `<div class="hand-card-cost cost-reduced" title="Cost reduced: ${originalCmc} → ${effectiveCmc}">
          <span style="text-decoration: line-through; opacity: 0.6">${originalCmc}</span>
          <span style="margin-left: 2px; font-weight: bold; color: #4a9eff">${effectiveCmc}</span>
        </div>`;
      } else if (c.mana_cost) {
        costDisplay = `<div class="hand-card-cost">${c.mana_cost.replace(/\{/g, '').replace(/\}/g, ' ').trim()}</div>`;
      } else if (c.cmc > 0) {
        costDisplay = `<div class="hand-card-cost">${c.cmc}</div>`;
      }

      // Cycling badge
      const cyclingBadge = cycling
        ? `<div class="hand-card-cycling ${canAffordCycling ? 'can-afford' : ''}" title="${cycling.searchType || 'Cycling'}: {${cycling.cost}} - dbl-click">${cycling.searchType ? cycling.searchType.slice(0,3).toUpperCase() : 'CYC'}</div>`
        : '';

      // Evoke badge: show when card has evoke and can only afford evoke cost
      const hasEvoke = canPlay && CardEngine.getEvokeCost(c) && !ManaSystem.canAfford(gs, 0, c);
      const evokeBadge = hasEvoke
        ? `<div class="hand-card-evoke" title="Evoke: ${CardEngine.getEvokeCost(c)}">EVK</div>`
        : '';

      // Omen badge: show when card has omen mechanic
      const effects = CardEngine.getPreprocessedEffects(c);
      const hasOmen = effects && effects.omen;
      const omenBadge = hasOmen
        ? `<div class="hand-card-omen" title="Omen: embaralha na biblioteca">OMN</div>`
        : '';

      // Unplayable reason tooltip
      let unplayableReason = '';
      if (!canPlay && !discardMode && !CardEngine.isLand(c)) {
        const hasConditionalFlash = CardEngine.canCastWithConditionalFlash(c, gs, 0);
        if (!isMainPhase && !CardEngine.isInstant(c) && !CardEngine.hasFlash(c) && !hasConditionalFlash) {
          unplayableReason = ' (so na fase principal)';
        } else if (!ManaSystem.canAfford(gs, 0, c)) {
          unplayableReason = ` (mana insuficiente: ${c.mana_cost || c.cmc})`;
        }
      } else if (!canPlay && CardEngine.isLand(c)) {
        if (gs.landPlayedThisTurn) unplayableReason = ' (ja jogou terreno)';
        else if (!isMainPhase) unplayableReason = ' (so na fase principal)';
      }

      const isRummageSelected = gs._pendingRummage && gs._pendingRummage.selected.includes(c._uid);
      const isMandatoryDiscardSelected = this._selectedDiscardCards && this._selectedDiscardCards.includes(c._uid);

      const hasImage = c.image_normal || c.image_small;
      const imageContent = hasImage
        ? `<img src="${c.image_normal || c.image_small}" alt="${c.name}" loading="lazy">`
        : `<div style="width:100%; height:100%; background:#1a1a1a; border:2px solid #444; border-radius:8px; padding:6px; display:flex; flex-direction:column; justify-content:space-between; font-size:0.7rem">
            <div>
              <div style="font-weight:bold; margin-bottom:3px">${c.name}</div>
              <div style="color:#888; margin-bottom:3px">${c.mana_cost || ''}</div>
              <div style="color:#aaa; border-top:1px solid #333; padding-top:3px; margin-bottom:3px; font-size:0.65rem">${c.type_line || ''}</div>
            </div>
            <div style="font-size:0.6rem; color:#bbb; font-style:italic; overflow:hidden; text-overflow:ellipsis">${(c.oracle_text || '').substring(0, 60)}${c.oracle_text && c.oracle_text.length > 60 ? '...' : ''}</div>
          </div>`;

      return `
        <div class="hand-card ${canPlay ? 'playable' : ''} ${isSelected ? 'selected' : ''} ${discardMode ? 'discard-mode' : ''} ${canAffordCycling ? 'has-cycling' : ''} ${hasEvoke ? 'evoke-mode' : ''} ${isRummageSelected ? 'rummage-selected' : ''} ${isMandatoryDiscardSelected ? 'mandatory-discard-selected' : ''}"
             ${CardZoom.attr(c)}
             ${clickAction}
             ${dblClickAction}
             ${hoverAction}
             title="${c.name} ${c.mana_cost || ''} - ${c.type_line || ''}${unplayableReason}${cycling ? ` [dbl-click: ${cycling.searchType || 'Cycling'} {${cycling.cost}}]` : ''}">
          <div class="card-image-container">
            ${imageContent}
            ${hasImage ? '<button class="card-art-button" onclick="event.stopPropagation(); UIGame.openArtPickerModal(\'' + c._uid + '\')" title="Escolher arte">🎨</button>' : ''}
          </div>
          ${costDisplay}
          ${cyclingBadge}
          ${evokeBadge}
          ${omenBadge}
        </div>
      `;
    }).join('');
  },

  _renderExiledPlayable(gs, playableIds) {
    if (!gs._exiledPlayable) return '';
    const myExiled = Object.values(gs._exiledPlayable).filter(e => e.controller === 0);
    if (myExiled.length === 0) return '';

    return `<div class="exiled-playable-divider"></div>` + myExiled.map(entry => {
      const c = entry.card;
      const canPlay = playableIds.has(c._uid);
      let clickAction = '';
      let hoverAction = '';
      if (canPlay) {
        clickAction = `onclick="UIGame.playCard('${c._uid}')"`;
        hoverAction = `onmouseenter="UIGame.showManaPreview('${c._uid}', '${c.mana_cost}', ${c.cmc})" onmouseleave="UIGame.hideManaPreview()"`;
      }
      const costDisplay = c.mana_cost
        ? `<div class="hand-card-cost">${c.mana_cost.replace(/\{/g, '').replace(/\}/g, ' ').trim()}</div>`
        : (c.cmc > 0 ? `<div class="hand-card-cost">${c.cmc}</div>` : '');
      return `
        <div class="hand-card exiled-playable ${canPlay ? 'playable' : ''}"
             ${CardZoom.attr(c)}
             ${clickAction}
             ${hoverAction}
             title="${c.name} (exilado - pode jogar neste turno)">
          <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" alt="${c.name}" loading="lazy" style="width:100%;display:block">
          ${costDisplay}
          <div class="exiled-badge">EXL</div>
        </div>
      `;
    }).join('');
  },

  _renderGraveyardActivatable(gs) {
    if (!gs) return '';
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (!isMainPhase || gs.activePlayer !== 0) return '';
    const gyCards = gs.players[0].zones.graveyard.getAll();
    const activatable = gyCards.filter(c => {
      const abilities = CardEngine.getGraveyardAbilities(c);
      if (abilities.length === 0) return false;
      // Check if player can afford at least one graveyard ability
      return abilities.some(a => {
        if (!a.cost || !a.cost.mana) return true; // No mana cost (free activation)
        const fakeCard = { mana_cost: ManaSystem.formatManaCost(a.cost.mana), cmc: ManaSystem.parseCost(ManaSystem.formatManaCost(a.cost.mana)).total || 0 };
        return ManaSystem.canAfford(gs, 0, fakeCard);
      });
    });
    // Also add harmonizable cards
    const harmonizable = GameState.getHarmonizableCards(gs, 0);
    const allGy = [...activatable];
    const seenUids = new Set(activatable.map(c => c._uid));
    for (const c of harmonizable) {
      if (!seenUids.has(c._uid)) { allGy.push(c); seenUids.add(c._uid); }
    }
    if (allGy.length === 0) return '';

    return `<div class="gy-activatable-divider"></div>` + allGy.map(c => {
      const isHarmonize = harmonizable.some(h => h._uid === c._uid);
      const clickAction = isHarmonize
        ? `onclick="UIGame.castHarmonize('${c._uid}')"`
        : `onclick="UIGame.activateGraveyardAbility('${c._uid}')"`;
      // Show the ability's activation cost, not the card's original mana cost
      let costDisplay = '';
      if (isHarmonize) {
        const hCost = CardEngine.getHarmonizeCost(c);
        costDisplay = hCost ? `<div class="hand-card-cost">${hCost.replace(/\{/g, '').replace(/\}/g, ' ').trim()}</div>` : '';
      } else {
        const gyAbilities = CardEngine.getGraveyardAbilities(c);
        const abCost = gyAbilities.length > 0 && gyAbilities[0].cost && gyAbilities[0].cost.mana ? gyAbilities[0].cost.mana : '';
        costDisplay = abCost ? `<div class="hand-card-cost">{${abCost}}</div>` : '';
      }
      const badge = isHarmonize ? 'HRM' : 'RNW';
      return `
        <div class="hand-card gy-activatable playable"
             ${CardZoom.attr(c)}
             ${clickAction}
             title="${c.name} (${isHarmonize ? 'harmonize do cemiterio' : 'renew: ' + costDisplay})">
          <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" alt="${c.name}" loading="lazy" style="width:100%;display:block">
          ${costDisplay}
          <div class="gy-badge">${badge}</div>
        </div>
      `;
    }).join('');
  },

  _renderControls() {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return '';

    const wi = gs.waitingForInput;

    // AI THINKING PERMANENTLY DISABLED - NEVER SHOW THIS SHIT
    if (false) {
      return `<div class="ai-thinking-indicator">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Oponente pensando...</span>
      </div>`;
    }

    if (!wi) {
      return `<button class="btn btn-primary btn-sm" onclick="UIGame.forceAdvance()">Avancar</button>
              <span class="waiting-text">Processando...</span>`;
    }

    switch (wi.type) {
      case 'mulligan': {
        return `<span class="hint-text">Escolha manter ou mulligan</span>`;
      }
      case 'main_phase': {
        const playableCount = GameState.getPlayableCards(gs, 0).length;
        const landCount = gs.players[0].zones.battlefield.cards.filter(c => CardEngine.isLand(c) && !c._tapped).length;
        const manaAvail = ManaSystem.poolTotal(gs.manaPool[0]);
        let hint = '';
        if (playableCount > 0) {
          hint = `<span class="hint-playable">${playableCount} carta(s) jogavel(is)</span> - Clique para jogar. <kbd>Espaco</kbd> avanca.`;
        } else if (landCount > 0 && manaAvail === 0) {
          hint = 'Clique nos terrenos para gerar mana, depois jogue cartas. <kbd>Espaco</kbd> avanca.';
        } else {
          hint = 'Sem jogadas. <kbd>Espaco</kbd> para avancar.';
        }
        const btnLabel = gs.phase === 'main1' ? 'Ir para Combate &#9876;' : 'Passar Turno &#10140;';
        return `
          <button class="btn btn-primary btn-sm pass-btn" onclick="UIGame.passPriority()">
            ${btnLabel}
          </button>
          <span class="hint-text">${hint}</span>
        `;
      }
      case 'declare_attackers': {
        const canAttackCount = gs.players[0].zones.battlefield.cards.filter(c => CardEngine.canAttack(c)).length;
        return `
          <button class="btn attack-all-btn btn-sm" onclick="UIGame.attackWithAll()">
            Todos Atacam <kbd>A</kbd>
          </button>
          <button class="btn btn-accent btn-sm" onclick="UIGame.confirmAttackers()">
            Confirmar (${this.selectedAttackers.size}/${canAttackCount}) <kbd>Space</kbd>/<kbd>Enter</kbd>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="UIGame.skipAttackers()">
            Nao Atacar <kbd>Esc</kbd>
          </button>
        `;
      }
      case 'declare_blockers': {
        const atkCount = gs.combat.attackers.length;
        return `
          <button class="btn btn-blue btn-sm" onclick="UIGame.confirmBlockers()">
            Confirmar Bloqueios &#128737;
          </button>
          <button class="btn btn-secondary btn-sm" onclick="UIGame.skipBlockers()">
            Nao Bloquear
          </button>
          <span class="hint-text">
            ${this._pendingBlockerUid
              ? '<span class="hint-action">Agora clique no atacante para bloquear!</span>'
              : `${atkCount} atacante(s). Clique criatura sua, depois no atacante. <kbd>Enter</kbd> confirma.`}
          </span>
        `;
      }
      case 'discard': {
        return `
          <span class="hint-text hint-discard">&#9888; Descarte ${wi.amount} carta(s) - clique nelas na mao</span>
        `;
      }
      case 'discard_for_loot': {
        const lootAmt = gs._pendingLoot ? gs._pendingLoot.amount : 0;
        return `
          <span class="hint-text hint-discard">&#9888; Loot: descarte ${lootAmt} carta(s) - clique nelas na mao</span>
        `;
      }
      case 'rummage_discard': {
        const rp = gs._pendingRummage;
        const selectedCount = rp ? rp.selected.length : 0;
        const maxAmt = rp ? rp.amount : 1;
        const canConfirm = selectedCount > 0;
        return `
          <span class="hint-text hint-discard">&#9888; Rummage: descarte ate ${maxAmt} carta(s) para comprar igual - clique nelas</span>
          ${canConfirm ? `<button class="btn btn-primary btn-sm" onclick="UIGame.confirmRummage()">Confirmar (${selectedCount}) <kbd>Enter</kbd></button>` : ''}
          ${rp && rp.optional ? `<button class="btn btn-secondary btn-sm" onclick="UIGame.skipRummage()">Pular <kbd>Esc</kbd></button>` : ''}
        `;
      }
      case 'mandatory_discard': {
        const pending = gs._pendingDiscard;
        const amount = pending ? pending.amount : 1;
        const selected = this._selectedDiscardCards || [];
        const canConfirm = selected.length === amount;

        return `
          <span class="hint-text hint-discard">&#9888; Escolha ${amount} carta(s) para descartar - clique nelas (${selected.length}/${amount} escolhida${amount > 1 ? 's' : ''})</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmMandatoryDiscard()" ${!canConfirm ? 'disabled' : ''}>Confirmar <kbd>Enter</kbd></button>
        `;
      }
      case 'optional_discard_choice': {
        const drawOnDiscard = gs._pendingOptionalDiscard && gs._pendingOptionalDiscard.drawOnDiscard;
        const hintText = drawOnDiscard
          ? "&#9888; Rescue Leopard: voce pode descartar uma carta para comprar outra - clique nela ou <kbd>Esc</kbd> para pular"
          : "&#9888; Voce pode descartar uma carta - clique nela ou <kbd>Esc</kbd> para pular";

        return `
          <span class="hint-text hint-discard">${hintText}</span>
          <button class="btn btn-secondary btn-sm" onclick="UIGame.skipOptionalDiscard()">Pular <kbd>Esc</kbd></button>
        `;
      }
      case 'trigger_cost': {
        const wi = gs.waitingForInput;
        const trigger = wi.trigger;
        const effect = trigger.effects.find(e => e.cost);
        const costStr = effect ? effect.cost : '?';
        return `
          <span class="hint-text">🎯 Pagar ${costStr} para ativar habilidade de ${trigger.cardName}?</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.payTriggerCost()">Pagar <kbd>Enter</kbd></button>
          <button class="btn btn-secondary btn-sm" onclick="UIGame.skipTriggerCost()">Pular <kbd>Esc</kbd></button>
        `;
      }
      case 'choose_target': {
        const targetLabel = this.targetingMode?.isAura ? 'a aura' : (this.targetingMode?.card?.name || 'a habilidade');
        return `
          <span class="hint-text hint-target">&#127919; Escolha um alvo para <strong>${targetLabel}</strong></span>
          <button class="btn btn-secondary btn-sm" onclick="UIGame.cancelTargeting()">Cancelar <kbd>Esc</kbd></button>
        `;
      }
      case 'choose_gy_return': {
        const gyPending = gs._pendingGYReturn;
        const dest = gyPending?.toTopLibrary ? 'topo da biblioteca' : 'mao';
        return `
          <span class="hint-text">&#9760; Escolha uma carta do cemiterio para o <strong>${dest}</strong> (opcional)</span>
        `;
      }
      case 'scry': {
        const pending = gs._pendingScry;
        const topCount = pending ? pending.choices.filter(c => c === 'top').length : 0;
        const botCount = pending ? pending.choices.filter(c => c !== 'top').length : 0;
        return `
          <span class="hint-text">&#128270; Scry: clique nas cartas para mudar. Topo: ${topCount} | Fundo: ${botCount}</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmScry()">Confirmar</button>
        `;
      }
      case 'surveil': {
        const pendingS = gs._pendingScry;
        const topCountS = pendingS ? pendingS.choices.filter(c => c === 'top').length : 0;
        const gyCount = pendingS ? pendingS.choices.filter(c => c !== 'top').length : 0;
        return `
          <span class="hint-text">&#128270; Surveil: clique nas cartas para mudar. Topo: ${topCountS} | Cemiterio: ${gyCount}</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmScry()">Confirmar</button>
        `;
      }
      case 'look_top_choice': {
        const pendingL = gs._pendingLookTop;
        const pickCount = pendingL ? pendingL.pickCount : 1;
        const handCount = pendingL ? pendingL.choices.filter(c => c === 'hand').length : 0;
        const remainingPicks = pickCount - handCount;
        return `
          <span class="hint-text">✋ Escolha ${remainingPicks} carta(s) para a mão. Clique para alternar entre Mão e Cemitério.</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmLookTop()" ${remainingPicks > 0 ? 'disabled' : ''}>Confirmar</button>
        `;
      }
      case 'look_top_land_choice': {
        const pendingL = gs._pendingLookTop;
        const pickCount = pendingL ? pendingL.pickCount : 1;
        const selectedCount = pendingL ? pendingL.selected.length : 0;
        const landNames = pendingL && pendingL.lands ? pendingL.lands.map(c => c.name).join(', ') : '';
        return `
          <span class="hint-text">🌍 Terrenos encontrados: ${landNames || 'nenhum'}. Clique nas cartas do topo para escolher até ${pickCount} terreno(s) para a mão.</span>
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmLookTopLand()">Confirmar</button>
        `;
      }
      case 'modal_choice': {
        const chooseN = gs._pendingModal ? (gs._pendingModal.chooseCount || 1) : 1;
        const label = chooseN > 1
          ? `Escolha ${chooseN} modos para <strong>${gs._pendingModal ? gs._pendingModal.cardName : 'spell'}</strong> (1-4 toggle, Enter confirma)`
          : `Escolha um modo para <strong>${gs._pendingModal ? gs._pendingModal.cardName : 'spell'}</strong>`;
        return `<span class="hint-text">&#9881; ${label}</span>`;
      }
      case 'clash': {
        return `<span class="hint-text">&#9876; Clash! Escolha onde colocar sua carta revelada.</span>`;
      }
      case 'hideaway': {
        return `<span class="hint-text">&#128065; Hideaway: escolha uma carta para exilar.</span>`;
      }
      case 'order_blockers': {
        const currentAtk = this._orderingAttackerIndex != null ? this._orderingAttackerIndex : 0;
        const atkUids = wi.attackerUids || [];
        const totalAtk = atkUids.length;
        const atkUid = atkUids[currentAtk];
        const attacker = gs.combat.attackers.find(a => a.uid === atkUid);
        const atkName = attacker ? attacker.card.name : '???';
        const blockers = gs.combat.blockers[atkUid] || [];
        const ordered = this._blockerOrderSelection || [];
        const remaining = blockers.filter(b => !ordered.includes(b.uid));
        const blockerNames = remaining.map(b => b.card.name).join(', ');
        const orderedNames = ordered.map((uid, i) => {
          const b = blockers.find(bl => bl.uid === uid);
          return b ? `${i+1}. ${b.card.name}` : '';
        }).filter(Boolean).join(' → ');
        return `
          <span class="hint-text">&#9876; <strong>${atkName}</strong> tem ${blockers.length} bloqueadores${totalAtk > 1 ? ` (${currentAtk + 1}/${totalAtk})` : ''}. Clique nos bloqueadores do oponente na ordem que devem receber dano primeiro.</span>
          ${orderedNames ? `<span class="hint-text" style="color:#4fc3f7;margin-left:8px">${orderedNames}</span>` : ''}
          ${remaining.length > 0 ? `<span class="hint-text" style="color:#ff9800;margin-left:8px">Faltam: ${blockerNames}</span>` : ''}
          <button class="btn btn-primary btn-sm" onclick="UIGame.confirmBlockerOrder()" ${ordered.length < blockers.length ? 'disabled' : ''}>
            Confirmar Ordem <kbd>Enter</kbd>
          </button>
        `;
      }
      case 'instant_priority': {
        const playableInstants = GameState.getPlayableCards(gs, 0).filter(c => CardEngine.isInstant(c) || CardEngine.hasFlash(c));
        return `
          <button class="btn btn-primary btn-sm" onclick="UIGame.passPriority()">
            Passar Prioridade <kbd>Espaco</kbd>
          </button>
          <span class="hint-text hint-instant">&#9889; Voce pode jogar instants/flash (${playableInstants.length} disponivel). <kbd>Espaco</kbd> passa.</span>
        `;
      }
      case 'stack_priority': {
        const stackSize = gs.stack ? gs.stack.length : 0;
        const playableCards = GameState.getPlayableCards(gs, 0);
        const playableCounters = playableCards.filter(c => {
          const effects = CardEngine.getSpellEffects(c);
          return effects.some(e => e.type === 'counter' || e.type === 'counter_spell');
        });

        // Get last spell on stack (the one being responded to)
        const lastSpell = gs.stack && gs.stack.items && gs.stack.items.length > 0
          ? gs.stack.items[gs.stack.items.length - 1]
          : null;
        const lastSpellName = lastSpell ? lastSpell.card.name : 'Magia';

        const counterCardsHtml = playableCounters.map((c, idx) => {
          const safeUid = btoa(c._uid); // Base64 encode to avoid quote issues
          return `
          <div class="counter-card" data-card-uid="${safeUid}" onclick="UIGame._handleCounterClick(this)">
            <div class="counter-card-name">${c.name}</div>
            <div class="counter-card-cost">${c.mana_cost || '0'}</div>
          </div>
        `;
        }).join('');

        return `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="background: rgba(255,100,100,0.2); padding: 10px; border-radius: 4px; text-align: center;">
              ⚡ <strong>${lastSpellName}</strong> no stack! Responda com magia ou passe.
            </div>
            ${playableCounters.length > 0 ? `
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;">
                ${counterCardsHtml}
              </div>
            ` : `<span class="hint-text">Nenhuma contramagia disponível</span>`}
            <button class="btn btn-secondary btn-sm" onclick="UIGame.passStackPriority()">
              Passar <kbd>Espaco</kbd>
            </button>
          </div>
        `;
      }
      case 'counter_behold_choice': {
        const beholdPending = gs._pendingCounterBehold;
        const dragonName = beholdPending && beholdPending.candidates.length > 0
          ? beholdPending.candidates[0].name : 'Dragon';
        return `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div style="background: rgba(100,150,255,0.2); padding: 10px; border-radius: 4px; text-align: center;">
              🐉 Revelar <strong>${dragonName}</strong> da mao? (Behold)
              <div style="font-size: 0.85em; margin-top: 4px; opacity: 0.8;">
                Counter custa {4} em vez de {2} para o oponente
              </div>
            </div>
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button class="btn btn-primary btn-sm" onclick="UIGame.resolveCounterBeholdChoice(true)">
                Revelar Dragon
              </button>
              <button class="btn btn-secondary btn-sm" onclick="UIGame.resolveCounterBeholdChoice(false)">
                Nao revelar
              </button>
            </div>
          </div>
        `;
      }
      case 'buff_choice': {
        const buffEff = gs._pendingBuffChoice;
        const pw = buffEff ? `+${buffEff.effect.power || 0}/+${buffEff.effect.toughness || 0}` : '';
        return `<span class="hint-text">&#9876; Clique em uma criatura para dar ${pw}.</span>`;
      }
      case 'multi_buff_choice': {
        const buffEff = gs._pendingMultiBuffChoice;
        const pw = buffEff ? `+${buffEff.effect.power || 0}/+${buffEff.effect.toughness || 0}` : '';
        const selected = buffEff ? buffEff.selected.length : 0;
        const maxTargets = buffEff ? buffEff.maxTargets : 1;
        return `<span class="hint-text">&#9876; Clique em até ${maxTargets} criatura(s) para dar ${pw} (selecionadas: ${selected}). Enter para confirmar.</span>`;
      }
      case 'endure_choice': {
        return `<span class="hint-text">&#9876; Endure: escolha entre contadores +1/+1 ou tokens Spirit 1/1. Tecla 1 ou 2.</span>`;
      }
      case 'mill_land_choice': {
        const choice = gs._pendingMillLandChoice;
        const landNames = choice ? choice.milledLands.map(c => c.name).join(', ') : 'terreno';
        return `<span class="hint-text">&#9876; Mill: colocar ${landNames} na mao (1) ou +1/+1 counter (2)?</span>`;
      }
      case 'mana_color_choice': {
        const colorNames = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', C: 'Incolor' };
        const colors = gs._pendingManaChoice ? gs._pendingManaChoice.colors.map(c => colorNames[c] || c).join('/') : '';
        return `<span class="hint-text">&#9881; Escolha cor de mana: ${colors}</span>`;
      }
      case 'hand_exile_choice': {
        const cardNames = wi.cards ? wi.cards.map(c => c.name).join(', ') : '';
        return `<span class="hint-text">&#128065; Escolha uma carta não-terreno para exilar: ${cardNames}</span>`;
      }
      default:
        return `<button class="btn btn-primary btn-sm" onclick="UIGame.forceAdvance()">Avancar</button>`;
    }
  },

  // =================== Graveyard Peek ===================

  showGraveyard(playerId) {
    // Debounce to prevent rapid flickering
    if (this._gyOverlay === playerId) return;

    this._gyOverlay = playerId;
    this._debouncedRender();
  },

  closeGraveyard() {
    // Debounce to prevent rapid flickering
    if (this._gyOverlay === null) return;

    this._gyOverlay = null;
    this._debouncedRender();
  },

  _debouncedRender() {
    // Clear any pending render to prevent multiple renders
    if (this._renderTimeout) {
      clearTimeout(this._renderTimeout);
    }

    // Schedule render with small delay to batch updates
    this._renderTimeout = setTimeout(() => {
      this.render();
      this._renderTimeout = null;
    }, 16); // ~1 frame at 60fps
  },

  _renderGraveyardOverlay() {
    const gs = this.gameState;
    const pid = this._gyOverlay;
    const player = gs.players[pid];
    const cards = player.zones.graveyard.getAll();
    const name = pid === 0 ? 'Seu Cemiterio' : 'Cemiterio do Oponente';
    const isMainPhase = gs && (gs.phase === 'main1' || gs.phase === 'main2');
    const canActivateGY = pid === 0 && isMainPhase && gs.waitingForInput && gs.waitingForInput.playerId === 0;

    // Cache harmonize check to prevent excessive calculations during render
    if (!this._harmonizeCache || this._harmonizeCache._lastPhase !== gs.phase || this._harmonizeCache._lastTurn !== gs.turn) {
      this._harmonizeCache = {
        cards: canActivateGY ? GameState.getHarmonizableCards(gs, 0) : [],
        _lastPhase: gs.phase,
        _lastTurn: gs.turn
      };
    }

    // Use cached harmonize cards to prevent excessive calculations
    const harmonizeCards = this._harmonizeCache.cards;
    const harmonizeUids = new Set(harmonizeCards.map(c => c._uid));

    const cardsHtml = cards.length > 0
      ? cards.map(c => {
          const gyAbilities = CardEngine.getGraveyardAbilities(c);
          const hasGYAbility = canActivateGY && gyAbilities.length > 0;
          const canAfford = hasGYAbility && gyAbilities.some(a => {
            if (!a.cost.mana) return true;
            const fakeCard = { mana_cost: ManaSystem.formatManaCost(a.cost.mana), cmc: ManaSystem.parseCost(ManaSystem.formatManaCost(a.cost.mana)).total || 0 };
            return ManaSystem.canAfford(gs, 0, fakeCard);
          });
          const canHarmonize = harmonizeUids.has(c._uid);
          const isActivatable = canAfford || canHarmonize;
          return `
            <div class="gy-card ${isActivatable ? 'gy-activatable' : ''} ${canHarmonize ? 'gy-harmonize' : ''}" ${CardZoom.attr(c)} title="${c.name}${canHarmonize ? ' (Harmonize: ' + CardEngine.getHarmonizeCost(c) + ')' : ''}">
              <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" alt="${c.name}" loading="lazy">
              ${canAfford ? `<button class="gy-activate-btn" onclick="event.stopPropagation(); UIGame.activateGraveyardAbility('${c._uid}')">Ativar</button>` : ''}
              ${canHarmonize ? `<button class="gy-harmonize-btn" onclick="event.stopPropagation(); UIGame.closeGraveyard(); UIGame.castHarmonize('${c._uid}')">Harmonizar</button>` : ''}
            </div>
          `;
        }).join('')
      : '<p class="gy-empty">Cemiterio vazio</p>';

    return `
      <div class="gy-overlay" onclick="UIGame.closeGraveyard()" onmousedown="event.preventDefault()">
        <div class="gy-box" onclick="event.stopPropagation()">
          <h3>${name} (${cards.length})</h3>
          <div class="gy-cards">${cardsHtml}</div>
          <button class="btn btn-secondary btn-sm" style="margin-top:16px" onclick="UIGame.closeGraveyard()">Fechar</button>
        </div>
      </div>
    `;
  },

  // =================== Exile Peek ===================

  _exileOverlay: null,

  showExile(playerId) {
    // Debounce to prevent rapid flickering
    if (this._exileOverlay === playerId) return;

    this._exileOverlay = playerId;
    this._debouncedRender();
  },

  closeExile() {
    // Debounce to prevent rapid flickering
    if (this._exileOverlay === null) return;

    this._exileOverlay = null;
    this._debouncedRender();
  },

  _renderExileOverlay() {
    const gs = this.gameState;
    const pid = this._exileOverlay;
    const player = gs.players[pid];
    if (!player.zones.exile) return '';
    const cards = player.zones.exile.getAll();
    const name = pid === 0 ? 'Seu Exilio' : 'Exilio do Oponente';

    const cardsHtml = cards.length > 0
      ? cards.map(c => `
          <div class="gy-card" ${CardZoom.attr(c)} title="${c.name}" style="position:relative">
            <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" alt="${c.name}" loading="lazy">
            <button class="card-art-button" onclick="event.stopPropagation(); UIGame.openArtPickerModal('${c._uid}')" title="Escolher arte" style="position:absolute;top:4px;right:4px;z-index:10">🎨</button>
          </div>
        `).join('')
      : '<p class="gy-empty">Exilio vazio</p>';

    return `
      <div class="gy-overlay exile-overlay" onclick="UIGame.closeExile()">
        <div class="gy-box exile-box" onclick="event.stopPropagation()">
          <h3>${name} (${cards.length})</h3>
          <div class="gy-cards">${cardsHtml}</div>
          <button class="btn btn-secondary btn-sm" style="margin-top:16px" onclick="UIGame.closeExile()">Fechar</button>
        </div>
      </div>
    `;
  },

  toggleLog() {
    this._logCollapsed = !this._logCollapsed;
    this.render();
  },

  _renderStackOverlay() {
    const gs = this.gameState;
    const stack = gs.stack.items || [];

    const itemsHtml = stack.length > 0
      ? stack.map((item, idx) => {
          const isTop = idx === stack.length - 1;
          const controller = item.controller === 0 ? 'Voce' : 'Oponente';
          const effectsText = (item.effects || []).map(e => e.type).join(', ') || 'efeito';
          return `
            <div class="stack-overlay-item ${isTop ? 'top-item' : ''}">
              ${item.card.image_small ? `<img src="${item.card.image_small}" alt="${item.card.name}">` : ''}
              <div class="stack-overlay-item-info">
                <div class="stack-overlay-item-name">${item.card.name}</div>
                <div class="stack-overlay-item-effect">${effectsText}</div>
                <div class="stack-overlay-item-controller">${controller}</div>
              </div>
            </div>
          `;
        }).reverse().join('')
      : '<div class="stack-empty">Stack vazio</div>';

    return `
      <div class="stack-overlay">
        <div class="stack-overlay-header">
          <h4>Stack</h4>
          <kbd>Tab</kbd>
        </div>
        ${itemsHtml}
      </div>
    `;
  },

  _renderShortcutsHelp() {
    const gs = this.gameState;
    const wi = gs.waitingForInput;

    let shortcuts = [
      { key: 'Ctrl', desc: 'Full Control' },
      { key: 'Tab', desc: 'Stack' },
      { key: 'L', desc: 'Log' },
      { key: 'RClick', desc: 'Zoom' }
    ];

    // Show Backspace hint if there's mana to undo
    if (this._manaUndoStack.length > 0) {
      shortcuts.push({ key: '⌫', desc: 'Desfazer Mana' });
    }

    if (wi && wi.playerId === 0) {
      if (wi.type === 'main_phase' || wi.type === 'instant_priority' || wi.type === 'stack_priority') {
        shortcuts.unshift({ key: 'Space', desc: 'Passar' });
      }
      if (wi.type === 'declare_attackers') {
        shortcuts.unshift({ key: 'Enter', desc: 'Confirmar' });
        shortcuts.unshift({ key: 'Space', desc: 'Atacar Todos' });
      }
      if (wi.type === 'declare_blockers') {
        shortcuts.unshift({ key: 'Enter', desc: 'Confirmar' });
      }
    }

    return `
      <div class="shortcuts-help">
        ${shortcuts.map(s => `
          <div class="shortcut-item">
            <kbd>${s.key}</kbd>
            <span>${s.desc}</span>
          </div>
        `).join('')}
      </div>
    `;
  },

  // =================== Player actions ===================

  playCard(uid) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    let card = gs.players[0].zones.hand.get(uid);
    if (!card && gs._exiledPlayable && gs._exiledPlayable[uid]) {
      card = gs._exiledPlayable[uid].card;
    }
    if (!card) return;

    // Clear mana undo stack - playing a card is a gameplay action
    this._clearManaUndo();

    // Track if we were in instant priority mode (to return to it after casting)
    const wasInstantPriority = gs.waitingForInput && gs.waitingForInput.type === 'instant_priority';
    const instantPriorityPhase = wasInstantPriority ? gs.waitingForInput.phase : null;

    // Determine if we should cast the adventure side
    let castingAdventure = false;
    if (CardEngine.hasAdventure(card)) {
      // Check if player already chose via modal
      if (this._forceAdventureChoice !== undefined) {
        castingAdventure = this._forceAdventureChoice;
        this._forceAdventureChoice = undefined;
      } else {
        const canAffordMain = ManaSystem.canAfford(gs, 0, card);
        const advCost = CardEngine.getAdventureCost(card);
        const advCmc = CardEngine.getAdventureCMC(card);
        const canAffordAdv = advCost && ManaSystem.canPay(
          ManaSystem.getAvailableMana(gs, 0), advCost, advCmc
        );
        const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
        const advIsInstant = CardEngine.isAdventureInstant(card);

        if (canAffordAdv && canAffordMain && isMainPhase && !wasInstantPriority) {
          // Can afford both sides on main phase - show choice modal
          this._pendingAdventureChoice = { uid, card, advCost, advCmc };
          this.render();
          return; // Wait for player choice
        } else if (canAffordAdv && (!canAffordMain || !isMainPhase)) {
          castingAdventure = true;
        } else if (canAffordAdv && wasInstantPriority && advIsInstant) {
          castingAdventure = true;
        }
      }
    }

    // Track stack_priority too (for counterspells)
    const wasStackPriority = gs.waitingForInput && gs.waitingForInput.type === 'stack_priority';

    // During instant priority or stack priority, only allow instants, flash, or adventure instants
    if (wasInstantPriority || wasStackPriority) {
      if (!CardEngine.isInstant(card) && !CardEngine.hasFlash(card) && !(castingAdventure && CardEngine.isAdventureInstant(card))) {
        gs.log.push('So pode jogar instants ou cartas com flash agora.');
        this.render();
        return;
      }
    }

    // If this is a counterspell played during stack_priority, redirect to castCardAsCounter
    if (wasStackPriority) {
      const effects = CardEngine.getSpellEffects(card);
      const isCounter = effects.some(e => e.type === 'counter' || e.type === 'counter_spell');
      if (isCounter) {
        console.log(`[PLAYCARD] Detected counterspell ${card.name} during stack_priority, redirecting to castCardAsCounter`);
        this.castCardAsCounter(uid);
        return;
      }
    }

    if (CardEngine.isLand(card) && !castingAdventure) {
      const result = GameState.playLand(gs, 0, uid);
      if (!result.success) {
        gs.log.push(result.msg);
      }
      this.render();
      return;
    }

    // Check evoke as alternate cost
    let castingEvoke = false;
    if (!castingAdventure && CardEngine.getEvokeCost(card)) {
      const canAffordMain = ManaSystem.canAfford(gs, 0, card);
      const evokeCost = CardEngine.getEvokeCost(card);
      const evokeCmc = ManaSystem.parseCost(evokeCost).total || 0;
      const canAffordEvoke = ManaSystem.canPay(ManaSystem.getAvailableMana(gs, 0), evokeCost, evokeCmc);
      if (!canAffordMain && canAffordEvoke) {
        castingEvoke = true;
      }
    }

    // Verify card is actually affordable (use adventure/evoke cost if applicable)
    if (castingAdventure) {
      const advCost = CardEngine.getAdventureCost(card);
      const advCmc = CardEngine.getAdventureCMC(card);
      if (!ManaSystem.canPay(ManaSystem.getAvailableMana(gs, 0), advCost, advCmc)) {
        gs.log.push('Mana insuficiente para jogar ' + card.adventure.name + '.');
        this.render();
        return;
      }
    } else if (castingEvoke) {
      // Already verified evoke is affordable above
    } else {
      // effectiveCmc already includes cost reductions (from card._effectiveCmc set by getPlayableCards)
      // canPay handles reduced cmc by lowering generic portion of the mana cost
      const effectiveCost = card.mana_cost || '';
      const effectiveCmc = card._effectiveCmc !== undefined ? card._effectiveCmc : (card.cmc || 0);
      if (!ManaSystem.canPay(ManaSystem.getAvailableMana(gs, 0), effectiveCost, effectiveCmc)) {
        gs.log.push('Mana insuficiente para jogar ' + card.name + '.');
        this.render();
        return;
      }
    }

    // Check additional costs
    const additionalCosts = CardEngine.getAdditionalCosts(card);
    if (additionalCosts.length > 0) {
      for (const cost of additionalCosts) {
        if (cost.type === 'sacrifice') {
          // Check if player has something to sacrifice
          const bf = gs.players[0].zones.battlefield.cards;
          let sacrificeCandidates = [];
          if (cost.target === 'creature') sacrificeCandidates = bf.filter(c => CardEngine.isCreature(c));
          else if (cost.target === 'land') sacrificeCandidates = bf.filter(c => CardEngine.isLand(c));
          else if (cost.target === 'artifact') sacrificeCandidates = bf.filter(c => CardEngine.isArtifact(c));
          else sacrificeCandidates = [...bf];

          if (sacrificeCandidates.length === 0) {
            gs.log.push(`Nao pode jogar ${card.name} - precisa sacrificar ${cost.target}.`);
            this.render();
            return;
          }

          // If already chose sacrifice target (coming back from selection), continue
          if (card._sacrificeCostPaid) {
            delete card._sacrificeCostPaid;
            // Sacrifice was already performed, continue to casting
            break;
          }

          // Show sacrifice selection UI
          this._pendingSacrificeCast = {
            cardUid: uid,
            card: card,
            costTarget: cost.target,
            candidates: sacrificeCandidates,
            castingAdventure,
            castingEvoke,
            wasInstantPriority,
            instantPriorityPhase
          };
          gs.waitingForInput = { type: 'choose_sacrifice_cost', playerId: 0 };
          this.render();
          return;
        }
        if (cost.type === 'discard') {
          const handCount = gs.players[0].zones.hand.count();
          if (handCount <= cost.amount) {
            gs.log.push(`Nao pode jogar ${card.name} - precisa descartar ${cost.amount} carta(s).`);
            this.render();
            return;
          }

          // If already paid discard cost, continue
          if (card._discardCostPaid) {
            delete card._discardCostPaid;
            break;
          }

          // Show discard selection UI
          const discardCandidates = gs.players[0].zones.hand.getAll().filter(c => c._uid !== uid);
          this._pendingDiscardCast = {
            cardUid: uid,
            card: card,
            amount: cost.amount,
            candidates: discardCandidates,
            selected: []
          };
          gs.waitingForInput = { type: 'choose_discard_cost', playerId: 0 };
          this.render();
          return;
        }
        if (cost.type === 'pay_life') {
          if (gs.players[0].life <= cost.amount) {
            gs.log.push(`Nao pode jogar ${card.name} - precisa pagar ${cost.amount} vida.`);
            this.render();
            return;
          }
          // Auto-pay life cost
          gs.players[0].life -= cost.amount;
          gs.log.push(`Voce paga ${cost.amount} vida como custo adicional.`);
        }
        if (cost.type === 'tap_creature') {
          const untappedCreatures = gs.players[0].zones.battlefield.cards.filter(
            c => CardEngine.isCreature(c) && !c._tapped
          );
          if (untappedCreatures.length === 0) {
            gs.log.push(`Nao pode jogar ${card.name} - precisa virar uma criatura.`);
            this.render();
            return;
          }

          // If already paid tap cost, continue
          if (card._tapCostPaid) {
            delete card._tapCostPaid;
            break;
          }

          // Show tap creature selection UI
          this._pendingTapCast = {
            cardUid: uid,
            card: card,
            candidates: untappedCreatures
          };
          gs.waitingForInput = { type: 'choose_tap_cost', playerId: 0 };
          this.render();
          return;
        }
      }
    }

    // Determine mana cost and spell behavior
    let effectiveCost, effectiveCmc, effectiveText, effectiveName;
    if (castingEvoke) {
      effectiveCost = CardEngine.getEvokeCost(card);
      effectiveCmc = ManaSystem.parseCost(effectiveCost).total || 0;
      effectiveText = card.oracle_text;
      effectiveName = card.name;
    } else if (castingAdventure) {
      effectiveCost = card.adventure.mana_cost;
      effectiveCmc = CardEngine.getAdventureCMC(card);
      effectiveText = card.adventure.oracle_text;
      effectiveName = card.adventure.name;
    } else {
      // Check for conditional costs (e.g., Dragon's Prey +2 if target is dragon)
      effectiveCost = CardEngine.getEffectiveManaCost(card, null);

      // Use the effective CMC calculated in getPlayableCards (which includes cost reductions)
      // For hybrid mana, parseCost.total gives the minimum cost (e.g., 3 for {2/R}{2/W}{2/B})
      // card.cmc gives the maximum (6), which would cause over-payment
      if (card._effectiveCmc !== undefined) {
        effectiveCmc = card._effectiveCmc;
      } else {
        const parsedForCmc = ManaSystem.parseCost(effectiveCost);
        effectiveCmc = (parsedForCmc.hybrids && parsedForCmc.hybrids.length > 0)
          ? parsedForCmc.total
          : (card.cmc || parsedForCmc.total || 0);
      }
      effectiveText = card.oracle_text;
      effectiveName = card.name;
    }

    // Behold: if optional behold and no matching card in hand, add alternate cost
    const beholdCost = CardEngine.getBeholdCost(card);
    if (beholdCost && beholdCost.optional && beholdCost.alternateCost) {
      const handCards = gs.players[0].zones.hand.getAll();
      const hasBeholdTarget = handCards.some(c =>
        c._uid !== uid && CardEngine.hasCreatureType(c, beholdCost.subtype)
      );
      if (!hasBeholdTarget) {
        effectiveCmc = (effectiveCmc || 0) + beholdCost.alternateCost;
      }
    } else if (beholdCost && !beholdCost.optional) {
      const handCards = gs.players[0].zones.hand.getAll();
      const hasBeholdTarget = handCards.some(c =>
        c._uid !== uid && CardEngine.hasCreatureType(c, beholdCost.subtype)
      );
      if (!hasBeholdTarget) {
        gs.log.push(`Nao pode jogar ${card.name} - precisa de ${beholdCost.subtype} na mao para behold.`);
        this.render();
        return;
      }
    }

    // Cost reduction is already applied via card._effectiveCmc (set by getPlayableCards)
    // For cards where _effectiveCmc wasn't set (e.g., played outside normal flow), apply now
    if (!castingEvoke && card._effectiveCmc === undefined) {
      const bf = gs.players[0].zones.battlefield;
      for (const bfCard of bf.cards) {
        if (!bfCard._costReduction) continue;
        const cr = bfCard._costReduction;
        if (cr.target === 'dragon_spells' && CardEngine.hasCreatureType(card, 'Dragon')) {
          if (cr.reduction === 'free') { effectiveCmc = 0; effectiveCost = ''; }
          else { effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0)); }
        }
        if (cr.target === 'second_spell' && (gs._spellsThisTurn[0] || 0) >= 1) {
          effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0));
        }
        if (cr.target === 'creature_spells' && CardEngine.isCreature(card)) {
          effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0));
        }
        if (cr.target === 'spells' && cr.condition === 'per_power4_creature') {
          const p4count = bf.cards.filter(c => CardEngine.isCreature(c) && CardEngine.getPower(c) >= 4).length;
          if (p4count > 0) effectiveCmc = Math.max(0, effectiveCmc - (cr.reduction || 0) * p4count);
        }
      }
      // Self cost reduction (Focus the Mind, etc.)
      const dbEntry = typeof CardEffectsDB !== 'undefined' && CardEffectsDB[card.name?.toLowerCase()];
      if (dbEntry && dbEntry.self_cost_reduction) {
        const scr = dbEntry.self_cost_reduction;
        if (scr.condition === 'second_spell' && (gs._spellsThisTurn[0] || 0) >= 1) {
          effectiveCmc = Math.max(0, effectiveCmc - (scr.amount || 0));
        }
      }
    }

    // Mark card for adventure/evoke casting (used by castSpell)
    if (castingAdventure) {
      card._castingAdventure = true;
    }
    if (castingEvoke) {
      card._castingEvoke = true;
    }

    // Aura: needs a target creature to attach to
    if (CardEngine.isAura(card) && !castingAdventure) {
      GameState.autoTapForSpell(gs, 0, effectiveCost, effectiveCmc, card);
      this.targetingMode = { card, effects: [], isAura: true };
      gs.waitingForInput = { type: 'choose_target', playerId: 0 };
      this.render();
      return;
    }

    // Check if spell/creature needs targets
    // For adventures, treat as spell (instant/sorcery). For permanents: check ETB effects.
    const isPerm = castingAdventure ? false : CardEngine.isPermanent(card);
    const advCard = castingAdventure ? { ...card, oracle_text: card.adventure.oracle_text, type_line: card.adventure.type_line } : card;
    const etbEffects = isPerm ? CardEngine.getETBEffects(card) : [];

    // For adventure spells, check CardEffectsDB for cast effects (not just parsed effects)
    let spellEffects = !isPerm ? CardEngine.getSpellEffects(advCard) : [];
    if (castingAdventure) {
      const db = CardEngine.getPreprocessedEffects(card);
      if (db && db.cast) {
        spellEffects = db.cast;
      }
    }

    const relevantEffects = isPerm ? etbEffects : spellEffects;

    // Helper function to check if an effect needs targeting
    const effectNeedsTarget = (e) =>
      ['damage', 'destroy', 'exile', 'bounce', 'buff', 'debuff', 'counter', 'fight', 'tap', 'untap'].includes(e.type) &&
      e.target !== 'all_own_creatures' && e.target !== 'opponent' && e.target !== 'player' &&
      e.target !== 'creatures' && e.target !== 'nonland' && e.target !== 'opponent_creatures' &&
      e.target !== 'each opponent' && e.target !== 'all_creatures' &&
      e.target !== undefined && e.target !== null && e.target !== '';

    // Helper function to check if valid targets exist for the spell
    const hasValidTargets = (effects) => {
      if (!gs || !gs.players || !gs.players[1] || !gs.players[1].zones) return true; // Fallback: allow casting if validation fails
      const oppBf = gs.players[1].zones.battlefield.cards;
      const effectsNeedingTargets = effects.filter(effectNeedsTarget);

      if (effectsNeedingTargets.length === 0) return false;

      for (const effect of effectsNeedingTargets) {
        let hasValid = false;

        if (effect.target === 'spell' || effect.target === 'creature_spell' || effect.target === 'noncreature_spell') {
          // Must have at least one spell on the stack
          const stackItems = gs.stack && gs.stack.items ? gs.stack.items : [];
          hasValid = stackItems.length > 0;
          // If validating spell type, check if matching spells exist
          if (hasValid && effect.target === 'creature_spell') {
            hasValid = stackItems.some(s => CardEngine.isCreature(s.card));
          } else if (hasValid && effect.target === 'noncreature_spell') {
            hasValid = stackItems.some(s => !CardEngine.isCreature(s.card));
          }
        } else if (effect.target === 'attacking_or_blocking_creature') {
          // Must have at least one attacking or blocking creature
          hasValid = oppBf.some(c => c._attacking || c._blocking);
        } else if (effect.target === 'creature_with_flying') {
          // Must have at least one creature with flying
          hasValid = oppBf.some(c => CardEngine.isCreature(c) && CardEngine.hasKeyword(c, 'Flying'));
        } else if (effect.target === 'creature_without_flying') {
          // Must have at least one creature without flying
          hasValid = oppBf.some(c => CardEngine.isCreature(c) && !CardEngine.hasKeyword(c, 'Flying'));
        } else if (effect.target === 'dragons') {
          // Must have at least one Dragon
          hasValid = oppBf.some(c => CardEngine.isCreature(c) && CardEngine.hasCreatureType(c, 'Dragon'));
        } else if (effect.target === 'creature' || effect.target === 'creature_or_player') {
          // Must have at least one creature
          hasValid = oppBf.some(c => CardEngine.isCreature(c));
        } else if (effect.target === 'opponent_nonland' || effect.target === 'nonland_permanent') {
          // Must have at least one non-land permanent
          hasValid = oppBf.some(c => !CardEngine.isLand(c));
        } else if (effect.target === 'artifact' || effect.target === 'enchantment') {
          // Must have the specific permanent type
          const typeKey = effect.target;
          hasValid = oppBf.some(c => {
            const typeLower = (c.type_line || '').toLowerCase();
            return typeLower.includes(typeKey);
          });
        } else {
          // Other target types - assume there could be a valid target
          hasValid = true;
        }

        // If any effect doesn't have a valid target, can't cast
        if (!hasValid) return false;
      }

      return true;
    };

    // Check direct effects (but NOT for modal spells - modal targeting happens AFTER mode choice)
    const hasModal = !isPerm && spellEffects.some(e => e.type === 'modal');
    let needsTarget = !hasModal && relevantEffects.some(effectNeedsTarget);

    if (needsTarget) {
      // Validate that valid targets exist before entering targeting mode
      if (!hasValidTargets(relevantEffects)) {
        this.showToast('Sem alvo válido disponível!', 'info');
        return;
      }

      // Save mana state before tapping in case spell fails during targeting
      const bf = gs.players[0].zones.battlefield.cards;
      const landStatesBefore = new Map(bf.filter(c => CardEngine.isLand(c)).map(land => [land._uid, land._tapped]));
      const preTapManaPool = { ...gs.manaPool[0] };

      GameState.autoTapForSpell(gs, 0, effectiveCost, effectiveCmc, card);
      this.targetingMode = {
        card,
        effects: relevantEffects,
        isPermanent: isPerm,
        castingAdventure,
        castingEvoke,
        returnToInstantPriority: wasInstantPriority,
        instantPriorityPhase,
        // Save mana state for refund if spell fails
        preTapManaPool,
        landStatesBefore
      };
      gs.waitingForInput = { type: 'choose_target', playerId: 0 };
      this.render();
      return;
    }

    // Auto-tap and cast
    // Save mana pool state before tapping in case spell fails
    const preTapManaPool = { ...gs.manaPool[0] };
    const bf = gs.players[0].zones.battlefield.cards;
    const landStatesBefore = new Map(bf.filter(c => CardEngine.isLand(c)).map(land => [land._uid, land._tapped]));

    // Tap lands for mana
    GameState.autoTapForSpell(gs, 0, effectiveCost, effectiveCmc, card);

    const result = GameState.castSpell(gs, 0, uid, [], castingAdventure, castingEvoke);
    if (!result.success) {
      // Spell failed - undo mana taps
      for (const [landUid, wasTapped] of landStatesBefore) {
        const land = gs.players[0].zones.battlefield.get(landUid);
        if (land) land._tapped = wasTapped;
      }
      gs.manaPool[0] = { ...preTapManaPool };
      gs.log.push(result.msg);
      this.showToast('Mana reembolsada', 'info');
      this.render();
      return;
    }

    // Show cast notification + toast
    if (result.success) {
      if (castingEvoke) {
        this.showTriggerNotification(`${card.name}: Evocado!`, '💨');
        this.showToast(`Evocou ${card.name}`, 'cast');
      } else if (CardEngine.isPermanent(card)) {
        this.showTriggerNotification(`${card.name}: Entra no Campo!`, '✨');
        this.showToast(`Jogou ${card.name}`, 'cast');
      } else if (castingAdventure) {
        this.showTriggerNotification(`${effectiveName}!`, '📖');
        this.showToast(`Aventura: ${effectiveName}`, 'cast');
      } else {
        this.showTriggerNotification(`${card.name}!`, '🔮');
        this.showToast(`Conjurou ${card.name}`, 'cast');
      }
    }

    // Return to instant priority if we were in it
    if (wasInstantPriority && result.success) {
      gs.waitingForInput = { type: 'instant_priority', playerId: 0, phase: instantPriorityPhase };
    }

    this.render();
  },

  selectTarget(type, playerId, uid) {
    const gs = this.gameState;

    // Handle saga chapter targeting
    if (gs._pendingSagaChapter && !this.targetingMode) {
      const { saga, chapter, effects, controller } = gs._pendingSagaChapter;
      const targets = [{ type, player: playerId, uid }];

      gs.log.push(`${saga.name} — Capitulo ${chapter}: alvo escolhido.`);

      // Clear pending saga state
      gs._pendingSagaChapter = null;
      gs.waitingForInput = null;

      // Resolve chapter effects through the stack
      GameStack.push(gs.stack, { card: saga, controller, targets, effects: [...effects] });
      const stackLog = GameStack.resolve(gs.stack, gs);
      gs.log.push(...stackLog);

      this.render();
      this._continueIfAI();
      return;
    }

    if (!this.targetingMode) return;

    // Handle spell targeting (for counter effects)
    if (type === 'spell') {
      const gs = this.gameState;

      // Find the spell on the stack
      const stackEntry = gs.stack.find(s => s.card._uid === uid);
      if (!stackEntry) {
        gs.log.push('Spell nao encontrado na stack.');
        this.render();
        return;
      }

      const targetSpell = stackEntry.card;
      this.targetingMode.collectedTargets = [targetSpell];

      // All targets collected for spell targeting
      const targets = this.targetingMode.collectedTargets;
      const { card, effects, returnToInstantPriority, instantPriorityPhase } = this.targetingMode;

      // Fire creature_targeted_by_opponent trigger if applicable
      if (stackEntry.controller === 1) { // Opponent's spell
        GameState.fireTrigger(gs, 'creature_targeted_by_opponent', { playerId: 1 });
      }

      // Resolve through stack with spell as target
      GameStack.push(gs.stack, {
        card: card,
        controller: 0,
        targets: targets,
        effects: effects
      });
      const stackLog = GameStack.resolve(gs.stack, gs);
      gs.log.push(...stackLog);

      this.targetingMode = null;
      if (returnToInstantPriority) {
        gs.waitingForInput = { type: 'instant_priority', playerId: 0, phase: instantPriorityPhase };
      } else if (!gs.waitingForInput || gs.waitingForInput.type === 'choose_target') {
        gs.waitingForInput = { type: 'main_phase', playerId: 0 };
      }
      this.render();
      return;
    }

    // Handle harmonize spell targeting
    if (this.targetingMode.harmonize) {
      const { card, cardUid, creatureUid } = this.targetingMode;
      const targets = [{ type, player: playerId, uid }];

      // Validate the clicked target
      const targetCard = gs.players[playerId].zones.battlefield.get(uid);
      if (type === 'creature' && targetCard && !CardEngine.canBeTargeted(targetCard, 0)) {
        gs.log.push(`${targetCard.name} nao pode ser alvo.`);
        this.render();
        return;
      }

      this.targetingMode = null;
      this._executeHarmonize(cardUid, creatureUid, targets);
      return;
    }

    // Handle graveyard ability targeting
    if (this.targetingMode.graveyardAbility) {
      const { card, ability } = this.targetingMode;
      const targets = [{ type, player: playerId, uid }];

      // Validate target
      if (type !== 'creature' || playerId !== 0) {
        gs.log.push(`Alvo invalido para ${card.name}.`);
        this.render();
        return;
      }

      const targetCreature = gs.players[0].zones.battlefield.get(uid);
      if (!targetCreature || !CardEngine.canBeTargeted(targetCreature, 0)) {
        gs.log.push(`${targetCreature ? targetCreature.name : 'Alvo'} nao pode ser alvo.`);
        this.render();
        return;
      }


      // Pay mana cost now that we have a valid target
      if (ability.cost && ability.cost.mana) {
        const fakeCard = { mana_cost: ManaSystem.formatManaCost(ability.cost.mana), cmc: ManaSystem.parseCost(ManaSystem.formatManaCost(ability.cost.mana)).total || 0 };

        // Double-check: Verify we still have mana available (in case other abilities used it during targeting)
        if (!ManaSystem.canAfford(gs, 0, fakeCard)) {
          gs.log.push(`Erro: Mana insuficiente para ativar ${card.name}. Talvez outra habilidade tenha usado sua mana.`);
          // Reset targeting mode
          this.targetingMode = null;
          gs.waitingForInput = null;
          this.render();
          return;
        }

        GameState.autoTapForSpell(gs, 0, ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
        gs.manaPool[0] = ManaSystem.payMana(gs.manaPool[0], ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
      }

      gs.log.push(`${card.name}: habilidade do cemiterio ativada!`);
      this.showTriggerNotification(`${card.name}: Renew!`, '🪦');

      // Remove card from graveyard
      const gy = gs.players[0].zones.graveyard;
      gy.remove(card._uid);
      // Track card leaving graveyard (for Essence Anchor condition etc.)
      if (!gs._cardLeftGraveyardThisTurn) gs._cardLeftGraveyardThisTurn = {};
      gs._cardLeftGraveyardThisTurn[0] = true;

      if (ability.cost.exile) {
        if (gs.players[0].zones.exile) {
          gs.players[0].zones.exile.add(card);
        }
      } else {
        // Return to graveyard after resolving (some abilities don't exile)
        gy.add(card);
      }

      // Resolve graveyard ability effects
      for (const effect of ability.effects) {
        const result = GameState._resolveSimpleEffect(gs, 0, effect, {
          cardUid: card._uid,
          card,
          fromZone: 'graveyard',
          targets
        });
        if (result) gs.log.push(result);
      }

      this.showTriggerNotification(`${card.name} -> ${targetCreature.name}`, '🎯');
      this.targetingMode = null;
      this.closeGraveyard();
      this._checkGameEnd();
      this.render();
      return;
    }

    // Handle discard bonus targeting (Glacial Dragonhunt)
    if (this.targetingMode.discardBonus) {
      const bonusEffects = this.targetingMode.effects;
      const targetCreature = gs.players[playerId].zones.battlefield.get(uid);

      if (!targetCreature || !CardEngine.isCreature(targetCreature)) {
        gs.log.push('Alvo invalido - selecione uma criatura.');
        this.render();
        return;
      }

      if (!CardEngine.canBeTargeted(targetCreature, 0)) {
        gs.log.push(`${targetCreature.name} nao pode ser alvo (hexproof/shroud).`);
        this.render();
        return;
      }

      // Apply bonus effects
      for (const bonusEffect of bonusEffects) {
        if (bonusEffect.type === 'damage') {
          if (typeof VFX !== 'undefined') VFX.damage(targetCreature._uid);
          targetCreature._damage = (targetCreature._damage || 0) + bonusEffect.amount;
          if (targetCreature._damage >= CardEngine.getToughness(targetCreature)) {
            GameState.creatureDies(gs, targetCreature, playerId);
            gs.log.push(`Glacial Dragonhunt causa ${bonusEffect.amount} dano em ${targetCreature.name} - morre!`);
          } else {
            gs.log.push(`Glacial Dragonhunt causa ${bonusEffect.amount} dano em ${targetCreature.name}.`);
          }
        }
      }

      this.targetingMode = null;
      this._pendingDiscardBonus = null;
      gs.waitingForInput = null;

      // Continue processing spell effects
      if (gs._pendingStackEffects) {
        GameStack._processNextEffect(gs);
      } else {
        GameState.advancePhase(gs);
      }

      this._checkGameEnd();
      this.render();
      this._continueIfAI();
      return;
    }

    const { card, effects, returnToInstantPriority, instantPriorityPhase, castingAdventure, castingEvoke, modalMode } = this.targetingMode;

    // Initialize targets array if not already done
    if (!this.targetingMode.collectedTargets) {
      this.targetingMode.collectedTargets = [];
    }

    // Add this target
    const target = { type, player: playerId, uid };
    this.targetingMode.collectedTargets.push(target);

    // Check if we need more targets (multiple effects with different target_index)
    const effectsWithTargets = effects.filter(e =>
      ['damage', 'destroy', 'exile', 'bounce', 'buff', 'debuff', 'counter', 'fight', 'tap', 'untap'].includes(e.type) &&
      e.target !== 'all_own_creatures' && e.target !== 'opponent' && e.target !== 'player' &&
      e.target !== 'creatures' && e.target !== 'nonland' && e.target !== 'opponent_creatures' &&
      e.target !== 'each opponent' && e.target !== 'all_creatures'
    );

    const uniqueTargetIndices = new Set(effectsWithTargets.map(e => e.target_index !== undefined ? e.target_index : 0));
    const needsMoreTargets = this.targetingMode.collectedTargets.length < uniqueTargetIndices.size;

    if (needsMoreTargets) {
      // Need more targets, show hint
      const targetCount = this.targetingMode.collectedTargets.length;
      const totalNeeded = uniqueTargetIndices.size;
      gs.log.push(`Alvo ${targetCount}/${totalNeeded} selecionado. Escolha o proximo alvo.`);
      this.render();
      return;
    }

    // All targets collected
    const targets = this.targetingMode.collectedTargets;

    // Fire creature_targeted_by_opponent trigger for opponent's creatures being targeted
    if (targets && targets.length > 0) {
      for (const target of targets) {
        if (target.player === 1) { // Targeting opponent's creatures
          GameState.fireTrigger(gs, 'creature_targeted_by_opponent', { playerId: 1 });
        }
      }
    }

    // If this is a modal spell targeting, resolve through stack instead of castSpell
    if (modalMode && gs._pendingModalAfterTargets) {
      const modalData = gs._pendingModalAfterTargets;
      if (modalData.allEffects.length > 0) {
        GameStack.push(gs.stack, {
          card: modalData.card,
          controller: modalData.controller,
          targets: targets,
          effects: modalData.allEffects
        });
        const stackLog = GameStack.resolve(gs.stack, gs);
        gs.log.push(...stackLog);
      }
      gs._pendingModalAfterTargets = null;
    } else {
      // Normal spell casting with targets
      const result = GameState.castSpell(gs, 0, card._uid, targets, castingAdventure, castingEvoke);
      if (!result.success) {
        // Spell failed after target selection - refund mana if it was tapped
        if (this.targetingMode.preTapManaPool && this.targetingMode.landStatesBefore) {
          // Restore land tapped states
          for (const [landUid, wasTapped] of this.targetingMode.landStatesBefore) {
            const land = gs.players[0].zones.battlefield.get(landUid);
            if (land) land._tapped = wasTapped;
          }
          // Restore mana pool
          gs.manaPool[0] = { ...this.targetingMode.preTapManaPool };
          gs.log.push('Mana reembolsada - Conjuração falhou.');
          this.showToast('Mana reembolsada', 'info');
        } else {
          gs.log.push(result.msg);
          this.showToast('Conjuração falhou', 'info');
        }
      }

      // Show cast notification
      if (result.success) {
        const targetCard = gs.players[playerId].zones.battlefield.get(uid);
        const targetName = targetCard ? targetCard.name : '';
        if (castingEvoke) {
          this.showTriggerNotification(`${card.name}: Evocado!`, '💨');
        } else if (CardEngine.isPermanent(card)) {
          this.showTriggerNotification(`${card.name}: Entra no Campo!`, '✨');
        } else {
          this.showTriggerNotification(`${card.name}${targetName ? ' -> ' + targetName : ''}`, '🎯');
        }
      }
    }

    this.targetingMode = null;
    // Return to instant priority if that's where we came from
    if (returnToInstantPriority) {
      gs.waitingForInput = { type: 'instant_priority', playerId: 0, phase: instantPriorityPhase };
    } else if (!gs.waitingForInput || gs.waitingForInput.type === 'choose_target') {
      // Only reset to main_phase if castSpell didn't set a special waitingForInput (e.g. scry/surveil from ETB)
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }
    this.render();
  },

  cancelTargeting() {
    const gs = this.gameState;

    // If canceling discardBonus targeting, skip bonus effects but continue stack
    if (this.targetingMode && this.targetingMode.discardBonus) {
      this.targetingMode = null;
      this._pendingDiscardBonus = null;
      gs.waitingForInput = null;
      gs.log.push('Dano cancelado (sem alvo valido).');

      if (gs._pendingStackEffects) {
        GameStack._processNextEffect(gs);
      } else {
        GameState.advancePhase(gs);
      }
      this.render();
      this._continueIfAI();
      return;
    }

    // Just cancel the targeting mode
    this.targetingMode = null;
    gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  // =================== Equipment ===================

  transformCard(cardUid) {
    const gs = this.gameState;
    if (!gs || gs.activePlayer !== 0) return;

    const result = GameState.transformCreature(gs, 0, cardUid);
    if (result.success) {
      const card = gs.players[0].zones.battlefield.get(cardUid);
      this.showTriggerNotification(`${card ? card.name : 'Transformado'}!`, '🔄');
    } else {
      gs.log.push(result.msg);
    }
    this.render();
  },

  startEquip(equipUid) {
    const gs = this.gameState;
    if (!gs || gs.activePlayer !== 0) return;
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (!isMainPhase) return;

    const equip = gs.players[0].zones.battlefield.get(equipUid);
    if (!equip || !CardEngine.isEquipment(equip)) return;

    // Check equip cost
    const effects = CardEngine.parseEquipmentEffects(equip);
    const costEffect = effects.find(e => e.type === 'equip_cost');
    const manaCost = costEffect ? costEffect.cost : '{3}';
    const parsedCost = ManaSystem.parseCost(manaCost);
    const cmc = parsedCost.total;

    // Check if can afford equip cost
    const fakeCard = { mana_cost: manaCost, cmc };
    if (!ManaSystem.canAfford(gs, 0, fakeCard)) {
      gs.log.push(`Mana insuficiente para equipar ${equip.name} (custo: ${manaCost}).`);
      this.render();
      return;
    }

    // Auto-tap for equip cost
    GameState.autoTapForSpell(gs, 0, manaCost, cmc);

    // Enter targeting mode for equip
    this.targetingMode = { card: equip, effects: [], isEquip: true, equipCost: manaCost, equipCmc: cmc };
    gs.waitingForInput = { type: 'choose_target', playerId: 0 };
    gs.log.push(`Escolha uma criatura para equipar ${equip.name}.`);
    this.render();
  },

  startReequip(equipUid) {
    const gs = this.gameState;
    if (!gs || gs.activePlayer !== 0) return;
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (!isMainPhase) return;

    const equip = gs.players[0].zones.battlefield.get(equipUid);
    if (!equip || !CardEngine.isEquipment(equip)) return;

    // Find the creature this equipment is attached to
    let currentHost = null;
    for (const c of gs.players[0].zones.battlefield.cards) {
      if (c._attachments && c._attachments.includes(equipUid)) {
        currentHost = c;
        break;
      }
    }

    if (!currentHost) {
      gs.log.push(`Equipamento ${equip.name} nao está anexado a nenhuma criatura.`);
      this.render();
      return;
    }

    // Check equip cost
    const effects = CardEngine.parseEquipmentEffects(equip);
    const costEffect = effects.find(e => e.type === 'equip_cost');
    const manaCost = costEffect ? costEffect.cost : '{3}';
    const parsedCost = ManaSystem.parseCost(manaCost);
    const cmc = parsedCost.total;

    // Check if can afford equip cost
    const fakeCard = { mana_cost: manaCost, cmc };
    if (!ManaSystem.canAfford(gs, 0, fakeCard)) {
      gs.log.push(`Mana insuficiente para equipar ${equip.name} (custo: ${manaCost}).`);
      this.render();
      return;
    }

    // Auto-tap for equip cost
    GameState.autoTapForSpell(gs, 0, manaCost, cmc);

    // Detach from current host
    if (currentHost._attachments) {
      const idx = currentHost._attachments.indexOf(equipUid);
      if (idx !== -1) {
        currentHost._attachments.splice(idx, 1);
      }
    }
    equip._attachedTo = null;
    equip._attachedToOwner = null;

    // Enter targeting mode for equip
    this.targetingMode = { card: equip, effects: [], isEquip: true, equipCost: manaCost, equipCmc: cmc, isReequip: true };
    gs.waitingForInput = { type: 'choose_target', playerId: 0 };
    gs.log.push(`Desanexou ${equip.name} de ${currentHost.name}. Escolha uma criatura para equipar.`);
    this.render();
  },

  // =================== Activated Abilities ===================

  activateAbility(cardUid) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card) return;

    // Hideaway land activation
    if (card._hideaway && card._hideawayCard && !card._tapped) {
      const result = GameState.activateHideaway(gs, 0, cardUid);
      if (result.success) {
        this.showTriggerNotification(`Hideaway: ${card._hideawayCard ? card._hideawayCard.name : 'carta'} jogada!`, '🔮');
      } else {
        gs.log.push(result.msg);
      }
      this._checkGameEnd();
      this.render();
      this._continueIfAI();
      return;
    }

    const abilities = CardEngine.getActivatedAbilities(card);
    if (abilities.length === 0) return;

    // If only one ability, activate it directly
    if (abilities.length === 1) {
      this._executeAbility(card, abilities[0]);
      return;
    }

    // Multiple abilities: show a selection (pick first for simplicity)
    // TODO: ability picker overlay for multiple abilities
    this._executeAbility(card, abilities[0]);
  },

  // Helper: parse ability mana cost (handles both numeric and string formats from DB)
  // Shared helper: convert "{1}{R}{G}" or "1RG" to colored mana pip HTML
  _formatManaCostPips(manaCostStr) {
    if (!manaCostStr) return '';
    const pips = manaCostStr.match(/\{([^}]+)\}/g);
    if (!pips) return manaCostStr;
    return pips.map(pip => {
      const val = pip.replace(/[{}]/g, '');
      const isNum = /^\d+$/.test(val);
      const isX = val === 'X';
      const colorClass = isNum || isX ? 'mana-c' : `mana-${val.toLowerCase()}`;
      return `<span class="mana-pip mana-pip-sm ${colorClass}">${val}</span>`;
    }).join('');
  },

  _getAbilityManaCost(ability) {
    const cost = ability.cost;
    if (!cost || cost.mana === undefined || cost.mana === null || cost.mana === 0) return { manaCost: '', cmc: 0 };

    // Numeric format from regex parser
    if (typeof cost.mana === 'number') {
      return { manaCost: `{${cost.mana}}`, cmc: cost.mana };
    }

    // String format from CardEffectsDB like "1R", "1WBG", "W", "4W", "XB", "2BB"
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

  _executeAbility(card, ability) {
    const gs = this.gameState;

    // Check tap requirement
    if (ability.cost.tap && card._tapped) {
      gs.log.push(`${card.name} ja esta virado.`);
      this.render();
      return;
    }

    // Check summoning sickness for tap abilities (only creatures have summoning sickness)
    if (ability.cost.tap && card._summoningSick && CardEngine.isCreature(card) && !CardEngine.hasKeyword(card, 'Haste')) {
      gs.log.push(`${card.name} tem enjoo de invocacao e nao pode ser virado.`);
      this.render();
      return;
    }

    // Check sorcery speed restriction
    if (ability.sorcerySpeed) {
      if (gs.phase !== 'main1' && gs.phase !== 'main2') {
        gs.log.push(`${card.name}: so pode ativar na fase principal.`);
        this.render();
        return;
      }
      if (gs.activePlayer !== 0) {
        gs.log.push(`${card.name}: so pode ativar no seu turno.`);
        this.render();
        return;
      }
    }

    // Check mana cost (handles both numeric and string formats)
    const { manaCost, cmc } = this._getAbilityManaCost(ability);
    if (cmc > 0) {
      const fakeCard = { mana_cost: manaCost, cmc };
      if (!ManaSystem.canAfford(gs, 0, fakeCard)) {
        gs.log.push(`Mana insuficiente para ativar ${card.name} (custo: ${manaCost}).`);
        this.render();
        return;
      }
      GameState.autoTapForSpell(gs, 0, manaCost, cmc);
      gs.manaPool[0] = ManaSystem.payMana(gs.manaPool[0], manaCost, cmc);
    }

    // Tap if needed
    if (ability.cost.tap) {
      card._tapped = true;
    }

    // Remove counter cost
    if (ability.cost.removeCounter && card._counters) {
      const cType = ability.cost.removeCounter;
      if ((card._counters[cType] || 0) <= 0) {
        gs.log.push(`${card.name} nao tem contadores ${cType} para remover.`);
        this.render();
        return;
      }
      card._counters[cType] = (card._counters[cType] || 0) - 1;
    }

    // Blight cost: put -1/-1 counter(s) on a creature you control
    if (ability.cost.blight) {
      const blightAmt = ability.cost.blight;
      const result = GameState._performBlight(gs, 0, blightAmt);
      if (result) gs.log.push(result);
    }

    // Sacrifice cost (sacrifice self)
    if (ability.cost.sacrifice) {
      const bf = gs.players[0].zones.battlefield;
      bf.remove(card._uid);
      gs.players[0].zones.graveyard.add(card);
      gs.log.push(`Sacrifica ${card.name} como custo.`);
    }

    // once_per_turn enforcement
    if (ability.cost.once_per_turn) {
      if (!gs._abilityUsedThisTurn) gs._abilityUsedThisTurn = {};
      const key = card._uid + '_' + JSON.stringify(ability.effects.map(e => e.type));
      if (gs._abilityUsedThisTurn[key]) {
        gs.log.push(`${card.name}: habilidade so pode ser usada uma vez por turno.`);
        this.render();
        return;
      }
      gs._abilityUsedThisTurn[key] = true;
    }

    // sacrifice_creature cost (interactive picker for human player)
    if (ability.cost.sacrifice_creature) {
      const others = gs.players[0].zones.battlefield.cards
        .filter(c => CardEngine.isCreature(c) && c._uid !== card._uid)
        .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
      if (others.length === 0) {
        gs.log.push(`Nenhuma criatura para sacrificar como custo.`);
        this.render();
        return;
      }
      // For human player: show picker modal
      if (gs.players[0].isHuman) {
        this._pendingSacrificeCostAbility = {
          cardUid: card._uid,
          abilityIndex,
          candidates: others
        };
        gs.waitingForInput = { type: 'choose_sacrifice_ability_cost', playerId: 0 };
        this.render();
        return;
      } else {
        // For AI: sacrifice weakest
        const victim = others[0];
        GameState.creatureDies(gs, victim, 0);
        gs.log.push(`Sacrifica ${victim.name} como custo.`);
      }
    }

    // sacrifice_token cost
    if (ability.cost.sacrifice_token) {
      const tokens = gs.players[0].zones.battlefield.cards
        .filter(c => CardEngine.isCreature(c) && c._isToken && c._uid !== card._uid)
        .sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
      if (tokens.length === 0) {
        gs.log.push(`Nenhum token para sacrificar como custo.`);
        this.render();
        return;
      }
      GameState.creatureDies(gs, tokens[0], 0);
      gs.log.push(`Sacrifica ${tokens[0].name} token como custo.`);
    }

    // exile_gy_creature cost
    if (ability.cost.exile_gy_creature) {
      const gyCreatures = gs.players[0].zones.graveyard.getAll().filter(c => CardEngine.isCreature(c));
      if (gyCreatures.length === 0) {
        gs.log.push(`Nenhuma criatura no cemiterio para exilar como custo.`);
        this.render();
        return;
      }
      const victim = gyCreatures.sort((a, b) => (a.cmc || 0) - (b.cmc || 0))[0];
      gs.players[0].zones.graveyard.remove(victim._uid);
      gs.players[0].zones.exile.add(victim);
      gs.log.push(`Exila ${victim.name} do cemiterio como custo.`);
    }

    // discard_hand cost
    if (ability.cost.discard_hand) {
      const hand = gs.players[0].zones.hand;
      const cards = hand.getAll();
      for (const c of cards) {
        hand.remove(c._uid);
        gs.players[0].zones.graveyard.add(c);
      }
      if (cards.length > 0) gs.log.push(`Descarta mao (${cards.length} cartas) como custo.`);
    }

    // tap_creature cost (tap weakest untapped creature)
    if (ability.cost.tap_creature) {
      const untapped = gs.players[0].zones.battlefield.cards
        .filter(c => CardEngine.isCreature(c) && !c._tapped && c._uid !== card._uid);
      if (untapped.length === 0) {
        gs.log.push(`Nenhuma criatura desvirada para virar como custo.`);
        this.render();
        return;
      }
      untapped.sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));
      untapped[0]._tapped = true;
      gs.log.push(`Vira ${untapped[0].name} como custo.`);
    }

    // life cost
    if (ability.cost.life) {
      const lifeCost = typeof ability.cost.life === 'number' ? ability.cost.life : 1;
      if (gs.players[0].life <= lifeCost) {
        gs.log.push(`Vida insuficiente para pagar custo (${lifeCost}).`);
        this.render();
        return;
      }
      gs.players[0].life -= lifeCost;
      gs.log.push(`Paga ${lifeCost} vida como custo.`);
    }

    // Condition check for activated abilities
    if (ability.condition) {
      if (!GameState._checkEffectCondition(gs, 0, { condition: ability.condition })) {
        gs.log.push(`Condicao nao atendida para ativar ${card.name}.`);
        this.render();
        return;
      }
    }

    gs.log.push(`${card.name}: habilidade ativada!`);

    // Show trigger notification (Arena-style)
    this.showTriggerNotification(`${card.name}: Habilidade Ativada!`, '⚡');

    // Resolve effects
    for (const effect of ability.effects) {
      if (effect.type === 'add_mana') {
        console.log(`[MANA DEBUG] Effect:`, effect, `Player 0 isHuman:`, gs.players[0].isHuman);
      }
      const result = GameState._resolveSimpleEffect(gs, 0, effect, { cardUid: card._uid, card });
      if (effect.type === 'add_mana') {
        console.log(`[MANA DEBUG] Result:`, result, `WaitingForInput:`, gs.waitingForInput, `PendingChoice:`, gs._pendingManaChoice);
      }
      if (result) gs.log.push(result);
    }

    this._checkGameEnd();
    this.render();
  },

  _checkGameEnd() {
    const gs = this.gameState;
    if (gs.players[0].life <= 0 || gs.players[1].life <= 0) {
      GameState._checkWinner(gs);
    }
  },

  // =================== Graveyard Activation ===================

  activateGraveyardAbility(cardUid) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    const gy = gs.players[0].zones.graveyard;
    const card = gy.get(cardUid);
    if (!card) return;

    const abilities = CardEngine.getGraveyardAbilities(card);
    if (abilities.length === 0) return;

    const ability = abilities[0]; // Use first graveyard ability

    // Check sorcery speed restriction
    if (ability.sorcerySpeed) {
      if (gs.phase !== 'main1' && gs.phase !== 'main2') {
        gs.log.push(`${card.name}: so pode ativar na fase principal.`);
        this.render();
        return;
      }
      if (gs.activePlayer !== 0) {
        gs.log.push(`${card.name}: so pode ativar no seu turno.`);
        this.render();
        return;
      }
    }

    // Check mana cost
    if (ability.cost && ability.cost.mana) {
      const fakeCard = { mana_cost: ManaSystem.formatManaCost(ability.cost.mana), cmc: ManaSystem.parseCost(ManaSystem.formatManaCost(ability.cost.mana)).total || 0 };
      if (!ManaSystem.canAfford(gs, 0, fakeCard)) {
        gs.log.push(`Mana insuficiente para ativar ${card.name} do cemiterio.`);
        this.render();
        return;
      }
    }

    // Check if ability needs targeting
    // Effects that require choosing a target: counter, grant_counter, grant_counters, buff, destroy, etc.
    const needsTargeting = ability.effects.some(effect =>
      effect.target && ['creature', 'opponent_creature', 'any_creature'].includes(effect.target) &&
      ['counter', 'grant_counter', 'grant_counters', 'buff', 'destroy', 'exile', 'bounce', 'tap', 'damage'].includes(effect.type)
    );

    if (needsTargeting) {
      // Verify there are valid targets
      const validTargets = gs.players[0].zones.battlefield.cards
        .filter(c => CardEngine.isCreature(c) && CardEngine.canBeTargeted(c, 0));


      if (validTargets.length === 0) {
        gs.log.push(`Nenhum alvo valido para ${card.name}.`);
        this.render();
        return;
      }

      // Close graveyard overlay before entering targeting mode (otherwise it blocks clicks)
      this.closeGraveyard();

      // Store graveyard ability context and enter targeting mode
      this.targetingMode = {
        graveyardAbility: true,
        card: card,
        ability: ability,
        effects: ability.effects
      };
      gs.waitingForInput = { type: 'choose_target', playerId: 0 };
      gs.log.push(`Escolha um alvo para ${card.name}.`);
      this.render();
      return;
    }

    // Pay mana cost for non-targeting abilities
    if (ability.cost && ability.cost.mana) {
      const fakeCard = { mana_cost: ManaSystem.formatManaCost(ability.cost.mana), cmc: ManaSystem.parseCost(ManaSystem.formatManaCost(ability.cost.mana)).total || 0 };
      GameState.autoTapForSpell(gs, 0, ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
      gs.manaPool[0] = ManaSystem.payMana(gs.manaPool[0], ManaSystem.formatManaCost(ability.cost.mana), fakeCard.cmc);
    }

    gs.log.push(`${card.name}: habilidade do cemiterio ativada!`);
    this.showTriggerNotification(`${card.name}: Renew!`, '🪦');

    // Remove card from graveyard
    gy.remove(cardUid);
    // Track card leaving graveyard (for Essence Anchor condition etc.)
    if (!gs._cardLeftGraveyardThisTurn) gs._cardLeftGraveyardThisTurn = {};
    gs._cardLeftGraveyardThisTurn[0] = true;

    if (ability.cost && ability.cost.exile) {
      if (gs.players[0].zones.exile) {
        gs.players[0].zones.exile.add(card);
      }
    } else {
      // Return to graveyard after resolving (some abilities don't exile)
      gy.add(card);
    }

    // Resolve effects without targeting
    for (const effect of ability.effects) {
      const result = GameState._resolveSimpleEffect(gs, 0, effect, { cardUid: card._uid, card, fromZone: 'graveyard', targets: [] });
      if (result) gs.log.push(result);
    }

    this.closeGraveyard();
    this._checkGameEnd();
    this.render();
  },

  // =================== Harmonize (cast from graveyard) ===================

  castHarmonize(cardUid, selectedCreatureUid = null) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    const gy = gs.players[0].zones.graveyard;
    const card = gy.get(cardUid);
    if (!card) return;

    const harmonizeCost = CardEngine.getHarmonizeCost(card);
    if (!harmonizeCost) return;

    // Phase 1: Show creature choice overlay (only on first call, not from skip/select)
    if (selectedCreatureUid === null) {
      const bf = gs.players[0].zones.battlefield;
      const tapCandidates = bf.cards.filter(c =>
        CardEngine.isCreature(c) && !c._tapped && CardEngine.getPower(c) > 0
      );

      if (tapCandidates.length > 0) {
        gs._pendingHarmonize = {
          cardUid,
          card,
          creatures: tapCandidates
        };
        gs.waitingForInput = { type: 'harmonize_tap_creature', playerId: 0 };
        this.render();
        return;
      }
      // No creatures available — fall through to cast without discount
    }

    // Phase 2: Creature chosen (or skipped/'none'). Check if spell needs targeting.
    const creatureUid = (selectedCreatureUid === 'none') ? null : selectedCreatureUid;
    gs._pendingHarmonize = null;

    // Check if spell effects need player-chosen targets
    const spellEffects = CardEngine.getSpellEffects(card);
    const targetedEffects = spellEffects.filter(e =>
      e.target && ['creature', 'opponent_creature', 'any_creature', 'any', 'player_or_creature'].includes(e.target) &&
      ['damage', 'destroy', 'exile', 'bounce', 'buff', 'counter', 'tap', 'fight', 'grant', 'grant_counter', 'grant_counters'].includes(e.type)
    );

    if (targetedEffects.length > 0) {
      // Need targeting — enter targeting mode with harmonize context
      this.targetingMode = {
        harmonize: true,
        card,
        cardUid: cardUid,
        effects: spellEffects,
        creatureUid: creatureUid
      };
      gs.waitingForInput = { type: 'choose_target', playerId: 0 };
      gs.log.push(`Escolha um alvo para ${card.name} (harmonize).`);
      this.render();
      return;
    }

    // Phase 2b: Show confirmation before casting (no targeting needed)
    gs._pendingHarmonizeConfirm = {
      cardUid,
      card,
      creatureUid
    };
    gs.waitingForInput = { type: 'harmonize_confirm', playerId: 0 };
    this.render();
  },

  _executeHarmonize(cardUid, creatureUid, targets) {
    console.log(`[HARMONIZE UI] _executeHarmonize called with:`, { cardUid, creatureUid, targets });
    const gs = this.gameState;
    const card = gs.players[0].zones.graveyard.get(cardUid);
    if (!card) {
      console.log(`[HARMONIZE UI] ERROR: Card not found in graveyard`);
      return;
    }

    console.log(`[HARMONIZE UI] Calling GameState.castHarmonize...`);
    const result = GameState.castHarmonize(gs, 0, cardUid, targets, creatureUid);
    console.log(`[HARMONIZE UI] castHarmonize returned:`, result);
    if (result.success) {
      this.showTriggerNotification(`${card.name}: Harmonize!`, '🎵');
    } else {
      gs.log.push(result.msg);
    }

    gs._pendingHarmonize = null;
    gs.waitingForInput = null;
    this._checkGameEnd();
    this.render();
  },

  selectHarmonizeCreature(creatureUid) {
    const gs = this.gameState;
    if (!gs._pendingHarmonize) return;

    const pending = gs._pendingHarmonize;
    // Proceed to Phase 2 with chosen creature
    this.castHarmonize(pending.cardUid, creatureUid);
  },

  skipHarmonizeCreature() {
    const gs = this.gameState;
    if (!gs._pendingHarmonize) return;

    const pending = gs._pendingHarmonize;
    // 'none' signals "no creature" without re-triggering the overlay
    this.castHarmonize(pending.cardUid, 'none');
  },

  cancelHarmonize() {
    const gs = this.gameState;
    if (!gs._pendingHarmonize) return;

    gs._pendingHarmonize = null;
    gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  confirmHarmonizeCast() {
    const gs = this.gameState;
    if (!gs._pendingHarmonizeConfirm) return;

    const { cardUid, creatureUid } = gs._pendingHarmonizeConfirm;
    gs._pendingHarmonizeConfirm = null;

    // Execute the harmonize
    this._executeHarmonize(cardUid, creatureUid, []);
  },

  cancelHarmonizeConfirm() {
    const gs = this.gameState;
    if (!gs._pendingHarmonizeConfirm) return;

    gs._pendingHarmonizeConfirm = null;
    gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  // =================== Sacrifice ===================

  sacrificeCard(cardUid) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card) return;

    GameState.sacrifice(gs, 0, cardUid);
    this._checkGameEnd();
    this.render();
  },

  // Override selectTarget to handle equip
  _originalSelectTarget: null,

  tapLand(uid) {
    const gs = this.gameState;
    if (!gs) return;

    const land = gs.players[0].zones.battlefield.get(uid);
    if (!land || land._tapped) return;

    // Check if dual land — show color choice popup
    const colors = ManaSystem.getLandManaColors(land);
    if (colors.length > 1) {
      this._showManaChoice(uid, colors);
      return;
    }

    // Single color — tap directly
    // Save undoable action
    gs._undoableAction = {
      type: 'mana_tap',
      playerId: 0,
      landUid: uid,
      prevTapped: land._tapped,
      prevManaPool: { ...gs.manaPool[0] }
    };

    this._manaUndoStack.push({
      type: 'tap_land',
      landUid: uid,
      prevManaPool: { ...gs.manaPool[0] }
    });
    GameState.tapLandForMana(gs, 0, uid);
    this.render();
  },

  _showManaChoice(uid, colors) {
    // Remove any existing popup
    this._closeManaChoice();

    const landEl = document.querySelector(`[data-uid="${uid}"]`);
    if (!landEl) return;

    const rect = landEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'mana-choice-popup';
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top - 8}px`;

    const colorNames = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', C: 'Incolor' };
    for (const color of colors) {
      const btn = document.createElement('div');
      btn.className = `mana-choice-btn mana-choice-${color}`;
      btn.title = colorNames[color] || color;
      btn.onclick = (e) => { e.stopPropagation(); this._tapWithColor(uid, color); };
      popup.appendChild(btn);
    }

    // Close on outside click or Esc
    this._manaChoiceCleanup = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') this._closeManaChoice();
      if (e.type === 'mousedown' && !popup.contains(e.target)) this._closeManaChoice();
    };
    document.addEventListener('mousedown', this._manaChoiceCleanup);
    document.addEventListener('keydown', this._manaChoiceCleanup);

    document.body.appendChild(popup);
    this._manaChoicePopup = popup;
  },

  _tapWithColor(uid, color) {
    const gs = this.gameState;
    if (!gs) return;

    this._closeManaChoice();

    const land = gs.players[0].zones.battlefield.get(uid);

    // Save undoable action
    gs._undoableAction = {
      type: 'mana_tap',
      playerId: 0,
      landUid: uid,
      prevTapped: land._tapped,
      prevManaPool: { ...gs.manaPool[0] }
    };

    this._manaUndoStack.push({
      type: 'tap_land',
      landUid: uid,
      prevManaPool: { ...gs.manaPool[0] }
    });
    GameState.tapLandForMana(gs, 0, uid, color);
    this.render();
  },

  _closeManaChoice() {
    if (this._manaChoicePopup) {
      this._manaChoicePopup.remove();
      this._manaChoicePopup = null;
    }
    if (this._manaChoiceCleanup) {
      document.removeEventListener('mousedown', this._manaChoiceCleanup);
      document.removeEventListener('keydown', this._manaChoiceCleanup);
      this._manaChoiceCleanup = null;
    }
  },

  undoMana() {
    const gs = this.gameState;
    if (!gs || this._manaUndoStack.length === 0) return;

    const undoAction = this._manaUndoStack.pop();

    if (undoAction.type === 'tap_land') {
      // Restore land to untapped state
      const land = gs.players[0].zones.battlefield.get(undoAction.landUid);
      if (land) {
        land._tapped = false;
      }
      // Restore previous mana pool
      gs.manaPool[0] = { ...undoAction.prevManaPool };
      gs.log.push('Mana desfeita (Backspace).');
    }

    this.render();
  },

  // Clear mana undo stack when gameplay-affecting action happens
  _clearManaUndo() {
    this._manaUndoStack = [];
  },

  activateCycling(uid) {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;
    if (gs.activePlayer !== 0) return;

    const result = GameState.activateCycling(gs, 0, uid);
    if (!result.success) {
      gs.log.push(result.msg);
    }
    this.render();
  },

  // =================== Ability Modal (Arena-style) ===================

  openAbilityModal(cardUid) {
    const gs = this.gameState;
    if (!gs) return;

    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card) return;

    const abilities = CardEngine.getActivatedAbilities(card);
    if (abilities.length === 0) return;

    // Calculate which abilities can be afforded
    const abilitiesWithAfford = abilities.map((ab, idx) => {
      let canAfford = true;
      if (ab.cost.tap && card._tapped) canAfford = false;
      const { manaCost, cmc } = this._getAbilityManaCost(ab);
      if (cmc > 0) {
        const fakeCard = { mana_cost: manaCost, cmc };
        if (!ManaSystem.canAfford(gs, 0, fakeCard)) canAfford = false;
      }
      // Check remove counter cost
      if (ab.cost.removeCounter && card._counters) {
        if ((card._counters[ab.cost.removeCounter] || 0) <= 0) canAfford = false;
      }
      // Check blight cost
      if (ab.cost.blight) {
        const hasCreature = gs.players[0].zones.battlefield.cards.some(c => CardEngine.isCreature(c));
        if (!hasCreature) canAfford = false;
      }
      return { ...ab, index: idx, canAfford };
    });

    this._actionModal = { card, abilities: abilitiesWithAfford };
    this.render();
  },

  closeAbilityModal() {
    this._actionModal = null;
    this.render();
  },

  // Art picker modal functions
  async openArtPickerModal(cardUid) {
    const gs = this.gameState;
    if (!gs) return;

    let card = null;
    // Try to find card in all zones
    for (const player of gs.players) {
      for (const zone of [player.zones.battlefield, player.zones.hand, player.zones.graveyard, player.zones.exile]) {
        card = zone.get?.(cardUid) || zone.cards?.find(c => c._uid === cardUid);
        if (card) break;
      }
      if (card) break;
    }
    if (!card) return;

    // Fetch available arts
    const arts = await CardEngine.getAvailableArts(card);
    if (arts.length <= 1) {
      UIGame.showToast('Essa carta não possui artes alternativas', 'info');
      return;
    }

    this._artPickerCard = card;
    this._artPickerArts = arts;
    this.render();
  },

  closeArtPickerModal() {
    this._artPickerCard = null;
    this._artPickerArts = [];
    this.render();
  },

  selectArt(artIndex) {
    if (!this._artPickerCard || !this._artPickerArts[artIndex]) return;
    CardEngine.setSelectedArt(this._artPickerCard, artIndex);
    this.showToast('Arte alterada!', 'info');
    this.closeArtPickerModal();
  },

  _hasVariableXCost(ability) {
    // Check if mana cost contains X
    if (ability.cost.mana && ability.cost.mana.includes('X')) {
      return true;
    }
    // Check if life cost is X
    if (ability.cost.life === 'X') {
      return true;
    }
    // Check if effects use X
    if (ability.effects && ability.effects.some(e => e.amount === 'X')) {
      return true;
    }
    return false;
  },

  _showXValueModal(card, ability) {
    this._actionModal = {
      type: 'x_value',
      card,
      ability,
      xValue: 1,
      minX: 1,
      maxX: this._calculateMaxX(ability)
    };
    this.render();
  },

  _calculateMaxX(ability) {
    const gs = this.gameState;
    const pool = gs.players[0].manaPool;
    const life = gs.players[0].life;

    let maxX = 20; // Default reasonable maximum

    // If mana cost has X, limit by available mana
    if (ability.cost.mana && ability.cost.mana.includes('X')) {
      const cost = ManaSystem.parseCost(ManaSystem.formatManaCost(ability.cost.mana));
      const availableMana = Object.values(pool).reduce((a, b) => a + b, 0);
      const fixedCost = cost.total - cost.variableX;
      maxX = Math.min(maxX, availableMana - fixedCost);
    }

    // If life cost is X, limit by available life
    if (ability.cost.life === 'X') {
      maxX = Math.min(maxX, life - 1); // Keep at least 1 life
    }

    return Math.max(1, maxX);
  },

  confirmXValue(xValue) {
    const modal = this._actionModal;
    if (!modal || modal.type !== 'x_value') return;

    // Execute ability with chosen X value
    this._executeAbilityWithX(modal.card, modal.ability, xValue);
    this._actionModal = null;
    this.render();
  },

  adjustXValue(delta) {
    if (!this._actionModal || this._actionModal.type !== 'x_value') return;

    const newValue = this._actionModal.xValue + delta;
    this._actionModal.xValue = Math.max(this._actionModal.minX, Math.min(this._actionModal.maxX, newValue));
    this.render();
  },

  _executeAbilityWithX(card, ability, xValue) {
    const gs = this.gameState;

    // Check tap requirement
    if (ability.cost.tap && card._tapped) {
      gs.log.push(`${card.name} ja esta virado.`);
      this.render();
      return;
    }

    // Check mana cost with X resolved
    if (ability.cost.mana) {
      const resolvedManaCost = ManaSystem.formatManaCost(ability.cost.mana.replace(/X/g, xValue.toString()));
      const cost = ManaSystem.parseCost(resolvedManaCost);
      if (!ManaSystem.canPay(gs.players[0].manaPool, resolvedManaCost, cost.total)) {
        gs.log.push(`Mana insuficiente para ativar ${card.name}.`);
        this.render();
        return;
      }
      // Pay the mana
      GameState.autoTapForSpell(gs, 0, resolvedManaCost, cost.total);
    }

    // Pay life cost with X resolved
    if (ability.cost.life) {
      const lifeCost = ability.cost.life === 'X' ? xValue : (typeof ability.cost.life === 'number' ? ability.cost.life : 1);
      if (gs.players[0].life <= lifeCost) {
        gs.log.push(`Vida insuficiente para pagar custo (${lifeCost}).`);
        this.render();
        return;
      }
      gs.players[0].life -= lifeCost;
      gs.log.push(`Paga ${lifeCost} vida como custo.`);
    }

    // Pay tap cost
    if (ability.cost.tap) {
      card._tapped = true;
      gs.log.push(`Vira ${card.name} como custo.`);
    }

    // Resolve effects with X value
    const resolvedEffects = ability.effects.map(effect => {
      const newEffect = { ...effect };
      if (newEffect.amount === 'X') {
        newEffect.amount = xValue;
      }
      return newEffect;
    });

    // Set X context for resolution
    gs._currentXValue = xValue;

    // Execute effects via stack
    StackSystem.resolve(gs, { _uid: card._uid, name: card.name }, resolvedEffects, 0);

    // Clear X context
    gs._currentXValue = null;

    GameState._checkWinner(gs);
    this.render();
  },

  confirmAbility(cardUid, abilityIndex) {
    const gs = this.gameState;
    if (!gs) return;

    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card) return;

    const abilities = CardEngine.getActivatedAbilities(card);
    if (abilityIndex >= abilities.length) return;

    const ability = abilities[abilityIndex];

    // Check if ability has X costs
    const hasXCost = this._hasVariableXCost(ability);
    if (hasXCost) {
      this._showXValueModal(card, ability);
      return;
    }

    this._executeAbility(card, ability);
    this._actionModal = null;
    this.render();
  },

  _renderXValueModal() {
    const { card, ability, xValue, minX, maxX } = this._actionModal;

    // Calculate cost preview
    const resolvedManaCost = ability.cost.mana ? ManaSystem.formatManaCost(ability.cost.mana.replace(/X/g, xValue.toString())) : '';
    const lifeCost = ability.cost.life === 'X' ? xValue : (ability.cost.life || 0);

    return `
      <div class="modal-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;">
        <div class="modal-content" style="background:#2c3e50;padding:20px;border-radius:10px;color:#ecf0f1;text-align:center;min-width:300px;">
          <h3 style="margin-top:0;color:#3498db;">Escolha o valor de X</h3>
          <p style="margin:10px 0;"><strong>${card.name}</strong></p>

          <div style="display:flex;align-items:center;justify-content:center;margin:20px 0;">
            <button onclick="window.uiGame.adjustXValue(-1)"
                    style="background:#e74c3c;color:#fff;border:none;padding:10px 15px;border-radius:5px;cursor:pointer;font-size:18px;margin-right:10px;"
                    ${xValue <= minX ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>-</button>

            <span style="font-size:24px;font-weight:bold;margin:0 20px;min-width:40px;display:inline-block;background:#34495e;padding:10px;border-radius:5px;">X = ${xValue}</span>

            <button onclick="window.uiGame.adjustXValue(1)"
                    style="background:#27ae60;color:#fff;border:none;padding:10px 15px;border-radius:5px;cursor:pointer;font-size:18px;margin-left:10px;"
                    ${xValue >= maxX ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>+</button>
          </div>

          <div style="margin:15px 0;font-size:14px;color:#bdc3c7;">
            <div>Custo Total: ${resolvedManaCost || 'Nenhum mana'} ${lifeCost > 0 ? `+ ${lifeCost} vida` : ''}</div>
            <div style="margin-top:5px;color:#95a5a6;">Efeito: Endure ${xValue}</div>
          </div>

          <div style="margin-top:20px;">
            <button onclick="window.uiGame.confirmXValue(${xValue})"
                    style="background:#3498db;color:#fff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;margin-right:10px;font-weight:bold;">
              Ativar
            </button>
            <button onclick="window.uiGame.closeAbilityModal()"
                    style="background:#95a5a6;color:#fff;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  _renderAbilityModal() {
    if (!this._actionModal) return '';

    // Handle X value selection modal
    if (this._actionModal.type === 'x_value') {
      return this._renderXValueModal();
    }

    const { card, abilities, isPlaneswalker } = this._actionModal;
    const gs = this.gameState;

    const abilitiesHtml = abilities.map(ab => {
      const costParts = [];

      if (isPlaneswalker && ab.cost.loyalty !== undefined) {
        // Loyalty cost display
        const lc = ab.cost.loyalty;
        const label = typeof lc === 'number' ? (lc >= 0 ? `+${lc}` : `${lc}`) : `${lc}`;
        const lcColor = typeof lc === 'number' && lc >= 0 ? '#2ecc71' : '#e74c3c';
        costParts.push(`<span class="loyalty-cost-pip" style="background:${lcColor};color:#fff;padding:2px 6px;border-radius:50%;font-weight:bold;font-size:0.75rem;">${label}</span>`);
      } else {
        const { manaCost, cmc } = UIGame._getAbilityManaCost(ab);
        if (cmc > 0) {
          const pips = manaCost.match(/\{([^}]+)\}/g) || [];
          pips.forEach(pip => {
            const val = pip.replace(/[{}]/g, '');
            const colorClass = /^\d+$/.test(val) ? 'mana-c' : `mana-${val.toLowerCase()}`;
            costParts.push(`<span class="mana-pip ${colorClass}">${val}</span>`);
          });
        }
        if (ab.cost.tap) {
          costParts.push(`<span class="tap-symbol">T</span>`);
        }
        if (ab.cost.removeCounter) {
          costParts.push(`<span style="font-size:0.65rem;color:var(--text-muted)">-1 ${ab.cost.removeCounter}</span>`);
        }
        if (ab.cost.blight) {
          costParts.push(`<span style="font-size:0.65rem;color:#e74c3c">Blight ${ab.cost.blight}</span>`);
        }
      }

      const confirmFn = isPlaneswalker
        ? `UIGame.confirmLoyaltyAbility('${card._uid}', ${ab.index})`
        : `UIGame.confirmAbility('${card._uid}', ${ab.index})`;

      return `
        <div class="ability-option ${ab.canAfford ? '' : 'cannot-afford'}"
             ${ab.canAfford ? `onclick="${confirmFn}"` : ''}>
          <div class="ability-cost">
            ${costParts.join('')}
            <span style="color: var(--text-muted); font-size: 0.7rem;">:</span>
          </div>
          <div class="ability-text">${this._formatAbilityText(ab)}</div>
          ${!ab.canAfford ? '<div style="color: var(--accent); font-size: 0.65rem; margin-top: 4px;">Custo insuficiente</div>' : ''}
        </div>
      `;
    }).join('');

    const loyaltyInfo = isPlaneswalker
      ? `<div style="color:#f39c12;font-size:0.75rem;margin-top:4px;">Lealdade: ${card._loyalty || 0}</div>`
      : '';

    return `
      <div class="action-modal-overlay" onclick="UIGame.closeAbilityModal()">
        <div class="action-modal" onclick="event.stopPropagation()">
          <div class="action-modal-header">
            <img class="action-modal-card-img" src="${card.image_small || card.image_normal}" alt="${card.name}">
            <div class="action-modal-card-info">
              <h3>${card.name}</h3>
              <div class="card-type">${card.type_line || 'Criatura'}</div>
              ${loyaltyInfo}
            </div>
          </div>
          <div class="action-modal-abilities">
            ${abilitiesHtml}
          </div>
          <div class="action-modal-footer">
            <button class="btn btn-secondary btn-sm" onclick="UIGame.closeAbilityModal()">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  },

  _formatAbilityText(ability) {
    const effects = ability.effects.map(e => {
      switch (e.type) {
        case 'draw': return `Compre ${e.amount} carta(s)`;
        case 'damage': return `Cause ${e.amount} de dano`;
        case 'damage_each_opponent': return `Cause ${e.amount} de dano a cada oponente`;
        case 'gainLife': return `Ganhe ${e.amount} vida`;
        case 'loseLife': return `Oponente perde ${e.amount} vida`;
        case 'counter_self': return `Coloque ${e.amount} marcador(es) ${e.counter}`;
        case 'create_token': return `Crie ${e.count} token(s) ${e.power}/${e.toughness}`;
        case 'buff_self': return `Esta criatura recebe ${e.power >= 0 ? '+' : ''}${e.power}/${e.toughness >= 0 ? '+' : ''}${e.toughness}`;
        case 'add_mana': return `Adicione {${e.color}}`;
        case 'destroy': return `Destrua criatura alvo`;
        case 'tap': return `Vire criatura alvo`;
        case 'untap_self': return `Desvire esta criatura`;
        case 'untap': return `Desvire ${e.target || 'permanente'}`;
        case 'counter_all': return `${e.amount || 1}x ${e.counter || '+1/+1'} em criaturas`;
        case 'grant_all': return `Conceda ${e.keyword || 'habilidade'} a criaturas`;
        case 'gain_life': return `Ganhe ${e.amount || 0} vida`;
        case 'discard': return `Oponente descarta ${e.amount || 1} carta(s)`;
        case 'exile': return `Exile permanente alvo`;
        default: return ability.text || 'Efeito';
      }
    });
    return effects.join('. ') + '.';
  },

  // =================== Planeswalker Loyalty Modal ===================

  openPlaneswalkerModal(cardUid) {
    const gs = this.gameState;
    if (!gs) return;

    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card || !CardEngine.isPlaneswalker(card)) return;
    if (card._loyaltyUsedThisTurn) return;

    const loyaltyAbilities = CardEngine.getLoyaltyAbilities(card);
    if (loyaltyAbilities.length === 0) return;

    const abilitiesWithAfford = loyaltyAbilities.map((ab, idx) => {
      let canAfford = true;
      const loyaltyCost = ab.cost.loyalty;
      // For negative costs, check loyalty
      if (typeof loyaltyCost === 'number' && loyaltyCost < 0) {
        if ((card._loyalty || 0) + loyaltyCost < 0) canAfford = false;
      }
      return { ...ab, index: idx, canAfford };
    });

    this._actionModal = { card, abilities: abilitiesWithAfford, isPlaneswalker: true };
    this.render();
  },

  confirmLoyaltyAbility(cardUid, abilityIndex) {
    const gs = this.gameState;
    if (!gs) return;
    const result = GameState.activateLoyaltyAbility(gs, 0, cardUid, abilityIndex);
    if (result.success) {
      this.showTriggerNotification(`Planeswalker: Habilidade Ativada!`, '⚡');
    } else {
      gs.log.push(result.msg);
    }
    this._actionModal = null;
    this.render();
  },

  // =================== Adventure Choice Modal ===================

  _pendingAdventureChoice: null,
  _forceAdventureChoice: undefined,

  chooseAdventureMode(mode) {
    // mode: 'creature' or 'adventure'
    const choice = this._pendingAdventureChoice;
    if (!choice) return;
    const uid = choice.uid;
    this._pendingAdventureChoice = null;
    this._forceAdventureChoice = (mode === 'adventure');
    this.playCard(uid); // Re-enter playCard with the choice flag set
  },

  // =================== Legendary Choice Modal ===================

  chooseLegendaryAction(choice) {
    const gs = this.gameState;
    if (!gs._pendingLegendaryChoice) return;

    const {
      cardToCast,
      cardUid,
      targets,
      castingAdventure,
      castingEvoke,
      existingCards,
      playerId
    } = gs._pendingLegendaryChoice;

    if (choice === 'cast_keep_new') {
      // Player chose to cast and keep the new card
      gs._legendaryChoice = 'keep_new';
      gs._pendingLegendaryChoice = null;
      gs.waitingForInput = null;

      // Set flag to skip legendary check on this cast (already approved by player)
      gs._skipLegendaryCheck = true;

      // Continue with the original cast
      const result = GameState.castSpell(gs, playerId, cardUid, targets, castingAdventure, castingEvoke);
      if (!result.success) {
        gs.log.push(result.msg);
      }

      // Clear the flag
      gs._skipLegendaryCheck = false;
      gs._legendaryChoice = null;
    } else if (choice === 'cast_keep_existing') {
      // Player chose to cast but keep the existing card
      gs._legendaryChoice = 'keep_existing';
      gs._pendingLegendaryChoice = null;
      gs.waitingForInput = null;

      // Set flag to skip legendary check on this cast (already approved by player)
      gs._skipLegendaryCheck = true;

      // Continue with the original cast
      const result = GameState.castSpell(gs, playerId, cardUid, targets, castingAdventure, castingEvoke);
      if (!result.success) {
        gs.log.push(result.msg);
      }

      // Clear the flag
      gs._skipLegendaryCheck = false;
      gs._legendaryChoice = null;
    } else {
      // Player chose to cancel - don't cast the card
      gs._pendingLegendaryChoice = null;
      gs.waitingForInput = null;
      gs.log.push(`Conjuração de ${cardToCast.name} cancelada.`);
    }

    this.render();
  },

  _renderLegendaryChoiceModal() {
    const gs = this.gameState;
    if (!gs._pendingLegendaryChoice || gs.waitingForInput?.type !== 'legendary_choice_pre_cast') return '';

    const { cardToCast, existingCards } = gs._pendingLegendaryChoice;

    return `
      <div class="modal-overlay">
        <div class="modal-dialog legendary-choice-modal">
          <div class="modal-header">
            <h3>⚠️ Regra Lendária</h3>
            <p>Você já controla uma criatura lendária com esse nome. Você pode conjurar <strong>${cardToCast.name}</strong>, mas deve escolher qual versão manter:</p>
          </div>
          <div class="modal-body">
            <div class="legendary-warning">
              <div class="existing-card">
                <img src="${existingCards[0].image_small || '/img/card-back.jpg'}" alt="${existingCards[0].name}" />
                <p><strong>No campo:</strong> ${existingCards[0].name}</p>
              </div>
              <div class="arrow">→</div>
              <div class="new-card">
                <img src="${cardToCast.image_small || '/img/card-back.jpg'}" alt="${cardToCast.name}" />
                <p><strong>Conjurando:</strong> ${cardToCast.name}</p>
              </div>
            </div>
            <div class="legendary-choices">
              <button class="btn btn-cancel" onclick="UIGame.chooseLegendaryAction('cancel')">
                Cancelar Conjuração
              </button>
              <button class="btn btn-primary" onclick="UIGame.chooseLegendaryAction('cast_keep_new')">
                Conjurar - Manter Nova
              </button>
              <button class="btn btn-warning" onclick="UIGame.chooseLegendaryAction('cast_keep_existing')">
                Conjurar - Manter Existente
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _renderArtPickerModal() {
    if (!this._artPickerCard || !this._artPickerArts || this._artPickerArts.length === 0) return '';

    return `
      <div class="modal-overlay" onclick="UIGame.closeArtPickerModal()">
        <div class="modal-dialog art-picker-modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <h3>🎨 Escolher Arte</h3>
            <p>${this._artPickerCard.name}</p>
          </div>
          <div class="modal-body art-picker-body">
            <div class="art-grid">
              ${this._artPickerArts.map((art, idx) => `
                <div class="art-option" onclick="UIGame.selectArt(${idx})">
                  <img src="${art.image}" alt="Arte ${idx + 1}" loading="lazy">
                  <div class="art-info">
                    <small>${art.setName}</small>
                    <small>#${art.collector}</small>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="UIGame.closeArtPickerModal()">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  },

  _renderAdventureChoiceModal() {
    if (!this._pendingAdventureChoice) return '';
    const { card } = this._pendingAdventureChoice;
    const advName = card.adventure ? card.adventure.name : 'Aventura';
    const advType = card.adventure ? card.adventure.type_line : 'Sorcery';
    const advCost = card.adventure ? card.adventure.mana_cost : '';
    const mainCost = card.mana_cost || '';

    return `
      <div class="action-modal-overlay" onclick="UIGame._pendingAdventureChoice = null; UIGame.render();">
        <div class="action-modal" onclick="event.stopPropagation()" style="max-width:380px">
          <div class="action-modal-header">
            <img class="action-modal-card-img" src="${card.image_small || card.image_normal}" alt="${card.name}">
            <div class="action-modal-card-info">
              <h3>${card.name}</h3>
              <div class="card-type">Escolha como jogar:</div>
            </div>
          </div>
          <div class="action-modal-abilities">
            <div class="ability-option" onclick="UIGame.chooseAdventureMode('creature')" style="cursor:pointer">
              <div class="ability-cost"><span class="mana-pip mana-c">${mainCost.replace(/[{}]/g, '')}</span></div>
              <div class="ability-text"><strong>${card.name}</strong> — ${card.type_line || 'Creature'}</div>
            </div>
            <div class="ability-option" onclick="UIGame.chooseAdventureMode('adventure')" style="cursor:pointer">
              <div class="ability-cost"><span class="mana-pip mana-c">${advCost.replace(/[{}]/g, '')}</span></div>
              <div class="ability-text"><strong>${advName}</strong> — ${advType}</div>
            </div>
          </div>
          <div class="action-modal-footer">
            <button class="btn btn-secondary btn-sm" onclick="UIGame._pendingAdventureChoice = null; UIGame.render();">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  },

  _renderPriorityIndicator() {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return '';

    const wi = gs.waitingForInput;
    if (!wi) return '';

    // Only show during instant priority or specific phases
    if (wi.type !== 'instant_priority' && wi.type !== 'main_phase' && wi.type !== 'declare_attackers' && wi.type !== 'declare_blockers') {
      return '';
    }

    const isMyPriority = wi.playerId === 0;
    const priorityClass = isMyPriority ? 'your-priority' : 'opp-priority';
    const priorityText = isMyPriority ? 'Sua Prioridade' : 'Prioridade Oponente';

    return `
      <div class="priority-indicator ${priorityClass}">
        <div class="priority-dot"></div>
        <span class="priority-text">${priorityText}</span>
      </div>
    `;
  },

  _renderCombatZone() {
    // Completely removed - battlefield shows all combat info visually
    return '';
  },

  // Draw SVG arrows from blockers to attackers on the battlefield
  _animateCardDraw(count) {
    const libEl = document.querySelector('.game-library');
    const handEl = document.querySelector('.game-my-hand');
    if (!libEl || !handEl) return;

    const libRect = libEl.getBoundingClientRect();
    const handRect = handEl.getBoundingClientRect();

    for (let i = 0; i < count; i++) {
      const clone = document.createElement('div');
      clone.className = 'draw-animation-card';
      clone.style.left = libRect.left + libRect.width / 2 - 30 + 'px';
      clone.style.top = libRect.top + libRect.height / 2 - 42 + 'px';
      document.body.appendChild(clone);

      const targetX = handRect.left + handRect.width / 2 - 30;
      const targetY = handRect.top + handRect.height / 2 - 42;

      setTimeout(() => {
        clone.style.transform = `translate(${targetX - parseFloat(clone.style.left)}px, ${targetY - parseFloat(clone.style.top)}px)`;
        clone.style.opacity = '0';
      }, 50 + i * 100);

      setTimeout(() => clone.remove(), 550 + i * 100);
    }
  },

  _drawCombatArrows() {
    // Remove old arrows
    const old = document.getElementById('combat-arrows-svg');
    if (old) old.remove();

    const gs = this.gameState;
    if (!gs || !gs.combat || !gs.combat.attackers || gs.combat.attackers.length === 0) return;
    const combatPhases = ['combat_blockers', 'combat_damage'];
    if (!combatPhases.includes(gs.phase)) return;

    const blockers = gs.combat.blockers;
    let hasBlockers = false;
    for (const atkUid in blockers) {
      if (blockers[atkUid] && blockers[atkUid].length > 0) { hasBlockers = true; break; }
    }
    if (!hasBlockers) return;

    const gameMain = document.querySelector('.game-main');
    if (!gameMain) return;
    const mainRect = gameMain.getBoundingClientRect();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'combat-arrows-svg';
    svg.setAttribute('width', mainRect.width);
    svg.setAttribute('height', mainRect.height);
    svg.style.cssText = `position:absolute;top:0;left:0;width:${mainRect.width}px;height:${mainRect.height}px;pointer-events:none;z-index:50;`;

    // Defs for arrowhead
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
    polygon.setAttribute('fill', '#e94960');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const colors = ['#e94960', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];
    let colorIdx = 0;

    for (const atkUid in blockers) {
      const blkList = blockers[atkUid];
      if (!blkList || blkList.length === 0) continue;

      const atkEl = document.querySelector(`[data-uid="${atkUid}"]`);
      if (!atkEl) continue;
      const atkRect = atkEl.getBoundingClientRect();
      const atkX = atkRect.left + atkRect.width / 2 - mainRect.left;
      const atkY = atkRect.top + atkRect.height / 2 - mainRect.top;

      const color = colors[colorIdx % colors.length];
      colorIdx++;

      // Create unique arrowhead for this color
      const markerId = `arrow-${colorIdx}`;
      const m2 = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      m2.setAttribute('id', markerId);
      m2.setAttribute('markerWidth', '10');
      m2.setAttribute('markerHeight', '7');
      m2.setAttribute('refX', '10');
      m2.setAttribute('refY', '3.5');
      m2.setAttribute('orient', 'auto');
      const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      p2.setAttribute('points', '0 0, 10 3.5, 0 7');
      p2.setAttribute('fill', color);
      m2.appendChild(p2);
      defs.appendChild(m2);

      for (const blk of blkList) {
        const blkEl = document.querySelector(`[data-uid="${blk.uid}"]`);
        if (!blkEl) continue;
        const blkRect = blkEl.getBoundingClientRect();
        const blkX = blkRect.left + blkRect.width / 2 - mainRect.left;
        const blkY = blkRect.top + blkRect.height / 2 - mainRect.top;

        // Draw curved line from blocker to attacker
        const midY = (blkY + atkY) / 2;
        const ctrlX = (blkX + atkX) / 2 + (blkX - atkX) * 0.15;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${blkX} ${blkY} Q ${ctrlX} ${midY} ${atkX} ${atkY}`);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-dasharray', '8,4');
        path.setAttribute('marker-end', `url(#${markerId})`);
        path.setAttribute('opacity', '0.85');
        // Animate dash
        path.innerHTML = `<animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite"/>`;
        svg.appendChild(path);
      }
    }

    gameMain.style.position = 'relative';
    gameMain.appendChild(svg);
  },

  // Show a trigger notification (Arena-style)
  showTriggerNotification(text, icon = '⚡') {
    const notification = document.createElement('div');
    notification.className = 'trigger-notification';
    notification.innerHTML = `
      <div class="trigger-notification-content">
        <span class="trigger-icon">${icon}</span>
        <span class="trigger-text">${text}</span>
      </div>
    `;
    document.body.appendChild(notification);

    // Remove after animation completes
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 2500);
  },

  toggleAttacker(uid) {
    if (this.selectedAttackers.has(uid)) {
      this.selectedAttackers.delete(uid);
      const card = this.gameState.players[0].zones.battlefield.get(uid);
      if (card) card._attacking = false;
    } else {
      this.selectedAttackers.add(uid);
      const card = this.gameState.players[0].zones.battlefield.get(uid);
      if (card) card._attacking = true;
    }
    this.render();
  },

  confirmAttackers() {
    const gs = this.gameState;
    gs.combat = CombatSystem.createCombatState();
    gs.combat.phase = 'declare_attackers';

    this.selectedAttackers.forEach(uid => {
      const card = gs.players[0].zones.battlefield.get(uid);
      if (card) CombatSystem.declareAttacker(gs.combat, card);
    });

    this.selectedAttackers.clear();

    if (gs.combat.attackers.length > 0) {
      gs.log.push(`Voce ataca com ${gs.combat.attackers.length} criatura(s).`);
      // Tap attacking creatures (unless vigilance) - MTG: tap at declaration
      gs.combat.attackers.forEach(({ card }) => {
        if (!CardEngine.hasKeyword(card, 'Vigilance') && !card._tapped) {
          card._tapped = true;
          card._tappedByAttack = true; // Mark so _resetCombatState doesn't re-tap
          // Fire "becomes tapped" triggers
          const tapLogs = GameState.fireTrigger(gs, 'becomes_tapped', {
            cardUid: card._uid, card: card, controllerId: 0
          });
          if (tapLogs.length > 0) gs.log.push(...tapLogs);
        }
      });
      // Fire "attacks" triggers (e.g., Firebending adds mana)
      const triggerLogs = CombatSystem.fireAttackTriggers(gs.combat, gs, 0);
      gs.log.push(...triggerLogs);
      // Show visual notifications for triggers
      if (triggerLogs.length > 0) {
        triggerLogs.forEach((log, i) => {
          setTimeout(() => {
            this.showTriggerNotification(log, '⚔️');
          }, i * 500);
        });
      }
    }

    gs.waitingForInput = null;
    GameState.advancePhase(gs);
    this.render();

    this._continueIfAI();
  },

  skipAttackers() {
    const gs = this.gameState;
    this.selectedAttackers.clear();

    gs.players[0].zones.battlefield.cards.forEach(c => c._attacking = false);
    gs.combat.attackers = [];
    gs.waitingForInput = null;

    gs.phaseIndex = GameState.PHASES.indexOf('combat_end');
    gs.phase = 'combat_end';
    GameState.advancePhase(gs);
    this.render();
    this._continueIfAI();
  },

  selectBlocker(uid) {
    const gs = this.gameState;
    if (!gs.combat.attackers.length) return;

    if (this._pendingBlockerUid === uid) {
      this._pendingBlockerUid = null;
      this.render();
      return;
    }

    this._pendingBlockerUid = uid;
    this.render();
  },

  assignBlockToAttacker(attackerUid) {
    const gs = this.gameState;
    if (!this._pendingBlockerUid) return;

    const blocker = gs.players[0].zones.battlefield.get(this._pendingBlockerUid);
    if (blocker) {
      const success = CombatSystem.declareBlocker(gs.combat, blocker, attackerUid, gs);
      if (success) {
        const atkName = gs.combat.attackers.find(a => a.uid === attackerUid)?.card.name || 'atacante';
        gs.log.push(`${blocker.name} bloqueia ${atkName}.`);
        this.selectedBlockers[this._pendingBlockerUid] = attackerUid;
      } else {
        // Blocker is already blocking another attacker
        if (blocker._blocking) {
          const currentAtkName = gs.combat.attackers.find(a => a.uid === blocker._blocking)?.card.name || 'atacante';
          gs.log.push(`${blocker.name} ja esta bloqueando ${currentAtkName}.`);
        } else {
          gs.log.push(`${blocker.name} nao pode bloquear este atacante.`);
        }
      }
    }
    this._pendingBlockerUid = null;
    this.render();
  },

  confirmBlockers() {
    const gs = this.gameState;

    // Validate menace and other blocking rules
    const invalidBlocks = CombatSystem.validateBlockers(gs.combat);
    if (invalidBlocks.length > 0) {
      // Remove invalid blocks
      for (const { attacker } of invalidBlocks) {
        const blockers = gs.combat.blockers[attacker._uid] || [];
        blockers.forEach(({ card }) => {
          card._blocking = null;
        });
        delete gs.combat.blockers[attacker._uid];
        gs.log.push(invalidBlocks[0].reason);
      }
      this.selectedBlockers = {};
      this.render();
      return; // Don't advance, let player reassign
    }

    this._pendingBlockerUid = null;
    this.selectedBlockers = {};

    gs.waitingForInput = null;
    GameState.advancePhase(gs);
    this.render();
    this._continueIfAI();
  },

  // Blocker ordering: player clicks blockers in desired damage order
  selectBlockerOrder(blockerUid) {
    if (!this._blockerOrderSelection) this._blockerOrderSelection = [];

    const idx = this._blockerOrderSelection.indexOf(blockerUid);
    if (idx >= 0) {
      // Remove and all after it (undo from this point)
      this._blockerOrderSelection.splice(idx);
    } else {
      this._blockerOrderSelection.push(blockerUid);
    }
    this.render();
  },

  confirmBlockerOrder() {
    const gs = this.gameState;
    const wi = gs.waitingForInput;
    if (!wi || wi.type !== 'order_blockers') return;

    const atkUids = wi.attackerUids || [];
    const currentIdx = this._orderingAttackerIndex || 0;
    const currentAtkUid = atkUids[currentIdx];
    const blockers = gs.combat.blockers[currentAtkUid] || [];

    // Validate all blockers are ordered
    if ((this._blockerOrderSelection || []).length < blockers.length) return;

    // Save order for this attacker
    CombatSystem.setBlockerOrder(gs.combat, currentAtkUid, this._blockerOrderSelection);

    // Move to next attacker that needs ordering
    const nextIdx = currentIdx + 1;
    if (nextIdx < atkUids.length) {
      this._orderingAttackerIndex = nextIdx;
      this._blockerOrderSelection = [];
      this.render();
      return;
    }

    // All ordered - continue to damage
    this._orderingAttackerIndex = 0;
    this._blockerOrderSelection = [];
    gs.combat._blockerOrderDone = true;
    gs.waitingForInput = null;
    GameState._processPhase(gs);
    this.render();
    this._continueIfAI();
  },

  skipBlockers() {
    const gs = this.gameState;
    this._pendingBlockerUid = null;
    this.selectedBlockers = {};
    gs.waitingForInput = null;
    GameState.advancePhase(gs);
    this.render();
    this._continueIfAI();
  },

  discardCard(uid) {
    const gs = this.gameState;
    const wi = gs.waitingForInput;
    if (!wi) return;

    // Handle loot discard (draw N, then discard N)
    if (wi.type === 'discard_for_loot') {
      const hand = gs.players[0].zones.hand;
      const card = hand.remove(uid);
      if (card) {
        gs.players[0].zones.graveyard.add(card);
        gs.log.push(`Voce descarta ${card.name} (loot).`);
        if (gs._pendingLoot) gs._pendingLoot.amount--;
        if (!gs._pendingLoot || gs._pendingLoot.amount <= 0) {
          gs._pendingLoot = null;
          gs.waitingForInput = null;
          GameState.advancePhase(gs);
        }
      }
      this.render();
      return;
    }

    // Rummage: toggle card selection (not immediate discard)
    if (wi.type === 'rummage_discard') {
      const rp = gs._pendingRummage;
      if (!rp) return;
      const idx = rp.selected.indexOf(uid);
      if (idx >= 0) {
        rp.selected.splice(idx, 1); // deselect
      } else if (rp.selected.length < rp.amount) {
        rp.selected.push(uid); // select
      }
      this.render();
      return;
    }

    // Optional discard: immediate discard of selected card
    if (wi.type === 'optional_discard_choice') {
      this.confirmOptionalDiscard(uid);
      return;
    }

    // Mandatory discard: toggle selection (for multi-card discard)
    if (wi.type === 'mandatory_discard') {
      if (!this._selectedDiscardCards) this._selectedDiscardCards = [];
      const idx = this._selectedDiscardCards.indexOf(uid);
      const pending = gs._pendingDiscard;
      const maxSelect = pending ? pending.amount : 1;

      if (idx >= 0) {
        // Deselect
        this._selectedDiscardCards.splice(idx, 1);
      } else if (this._selectedDiscardCards.length < maxSelect) {
        // Select (up to amount needed)
        this._selectedDiscardCards.push(uid);
      }
      this.render();
      return;
    }

    if (wi.type !== 'discard' && wi.type !== 'choose_discard_cost') return;

    const hand = gs.players[0].zones.hand;
    const card = hand.remove(uid);
    if (card) {
      gs.players[0].zones.graveyard.add(card);
      gs.log.push(`Voce descarta ${card.name}.`);
      wi.amount--;

      if (wi.amount <= 0) {
        gs.waitingForInput = null;
        GameState.advancePhase(gs);
      }
    }
    this.render();
  },

  confirmRummage() {
    const gs = this.gameState;
    if (!gs || !gs._pendingRummage) return;
    const rp = gs._pendingRummage;
    if (rp.selected.length === 0) return;
    const hand = gs.players[0].zones.hand;
    // Discard selected cards
    for (const uid of rp.selected) {
      const card = hand.remove(uid);
      if (card) {
        gs.players[0].zones.graveyard.add(card);
        gs.log.push(`Voce descarta ${card.name} (rummage).`);
      }
    }
    // Draw that many
    const drawCount = rp.selected.length;
    for (let i = 0; i < drawCount; i++) {
      const drawn = gs.players[0].zones.library.drawFromTop();
      if (drawn) gs.players[0].zones.hand.add(drawn);
    }
    gs.log.push(`Voce compra ${drawCount} carta(s) (rummage).`);
    gs._pendingRummage = null;
    gs.waitingForInput = null;
    GameState.advancePhase(gs);
    this.render();
    this._continueIfAI();
  },

  skipRummage() {
    const gs = this.gameState;
    if (!gs || !gs._pendingRummage) return;
    gs.log.push('Voce opta por nao descartar.');
    gs._pendingRummage = null;
    gs.waitingForInput = null;
    GameState.advancePhase(gs);
    this.render();
    this._continueIfAI();
  },

  // === Optional Discard (Glacial Dragonhunt) ===
  confirmOptionalDiscard(cardUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingOptionalDiscard) return;

    const hand = gs.players[0].zones.hand;
    const card = hand.get(cardUid);
    if (!card) return;

    // Discard the selected card
    hand.remove(cardUid);
    gs.players[0].zones.graveyard.add(card);

    // Track nonland discard for conditions
    const discardedNonland = !CardEngine.isLand(card);
    if (discardedNonland) {
      if (!gs._lastDiscardedNonland) gs._lastDiscardedNonland = {};
      gs._lastDiscardedNonland[0] = true;
    }

    gs.log.push(`Voce descarta ${card.name}.`);

    // Check if this should also draw a card (Rescue Leopard)
    if (gs._pendingOptionalDiscard.drawOnDiscard) {
      const drawn = gs.players[0].zones.library.drawFromTop();
      if (drawn) {
        gs.players[0].zones.hand.add(drawn);
        gs.log.push(`Voce compra uma carta.`);
      }
    }

    // Check if this should return a card from graveyard (Awaken the Honored Dead)
    if (gs._pendingOptionalDiscard.returnFromGY) {
      const returnCards = gs._pendingOptionalDiscard.returnCards || [];
      if (returnCards.length > 0) {
        returnCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        const returned = returnCards[0];
        gs.players[0].zones.graveyard.remove(returned._uid);
        gs.players[0].zones.hand.add(returned);
        gs.log.push(`Retorna ${returned.name} do cemiterio para a mao.`);
      }
    }

    // Check for onNonlandDiscard bonus effects (Glacial Dragonhunt)
    const bonusEffects = gs._pendingOptionalDiscard.onNonlandDiscard;
    if (discardedNonland && bonusEffects && bonusEffects.length > 0) {
      const targetedBonus = bonusEffects.find(e => e.target === 'creature');
      if (targetedBonus) {
        // Need to pick a target creature - enter targeting mode
        gs._pendingOptionalDiscard = null;
        gs.waitingForInput = null;

        // Store bonus effects for after targeting
        this._pendingDiscardBonus = {
          effects: bonusEffects,
          controller: 0
        };

        // Enter targeting mode
        this.targetingMode = {
          discardBonus: true,
          effects: bonusEffects,
          onSelect: (target) => {
            this._resolveDiscardBonusTarget(target);
          }
        };
        gs.waitingForInput = { type: 'choose_target', playerId: 0 };
        gs.log.push(`Escolha uma criatura alvo para ${targetedBonus.amount} dano.`);
        this.render();
        return;
      }
    }

    // Cleanup
    gs._pendingOptionalDiscard = null;
    gs.waitingForInput = null;

    // Continue processing spell effects
    if (gs._pendingStackEffects) {
      GameStack._processNextEffect(gs);
    } else {
      GameState.advancePhase(gs);
    }

    this.render();
    this._continueIfAI();
  },

  confirmMandatoryDiscard() {
    const gs = this.gameState;
    if (!gs || !gs._pendingDiscard) return;

    const pending = gs._pendingDiscard;
    const selected = this._selectedDiscardCards || [];

    if (selected.length !== pending.amount) {
      gs.log.push(`Selecione exatamente ${pending.amount} carta(s) para descartar.`);
      this.render();
      return;
    }

    const hand = gs.players[pending.targetPlayer].zones.hand;
    const gy = gs.players[pending.targetPlayer].zones.graveyard;
    const discarded = [];

    for (const uid of selected) {
      const card = hand.remove(uid);
      if (card) {
        gy.add(card);
        discarded.push(card.name);

        // Track nonland discard for conditions
        if (!CardEngine.isLand(card)) {
          if (!gs._lastDiscardedNonland) gs._lastDiscardedNonland = {};
          gs._lastDiscardedNonland[pending.controller] = true;
        }

        // Fire opponent_discards trigger if applicable
        if (pending.targetPlayer !== pending.controller) {
          GameState.fireTrigger(gs, 'opponent_discards', { playerId: pending.controller, cardUid: card._uid });
        }
      }
    }

    if (discarded.length > 0) {
      gs.log.push(`Voce descarta: ${discarded.join(', ')}.`);
    }

    // Cleanup
    this._selectedDiscardCards = [];
    gs._pendingDiscard = null;
    gs.waitingForInput = null;

    // Continue processing spell effects
    if (gs._pendingStackEffects) {
      GameStack._processNextEffect(gs);
    } else {
      GameState.advancePhase(gs);
    }

    this.render();
    this._continueIfAI();
  },

  skipOptionalDiscard() {
    const gs = this.gameState;
    if (!gs || !gs._pendingOptionalDiscard) return;

    gs.log.push('Voce opta por nao descartar carta.');

    // Cleanup
    gs._pendingOptionalDiscard = null;
    gs.waitingForInput = null;

    // Continue processing spell effects
    if (gs._pendingStackEffects) {
      GameStack._processNextEffect(gs);
    } else {
      GameState.advancePhase(gs);
    }

    this.render();
    this._continueIfAI();
  },

  payTriggerCost() {
    const gs = this.gameState;
    if (!gs) return;

    GameState.resolveTriggerCost(gs, 'pay');
    this.render();
    this._continueIfAI();
  },

  skipTriggerCost() {
    const gs = this.gameState;
    if (!gs) return;

    GameState.resolveTriggerCost(gs, 'skip');
    this.render();
    this._continueIfAI();
  },

  forceAdvance() {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;
    this._clearManaUndo();
    gs._undoableAction = null; // Clear undoable actions when advancing phase
    gs.waitingForInput = null;
    gs.manaPool[0] = ManaSystem.emptyPool();
    try {
      GameState.advancePhase(gs);
    } catch (e) {
      console.error('[UIGame] forceAdvance error:', e);
      // Recover: ensure we have waitingForInput so game isn't stuck
      if (!gs.waitingForInput) {
        gs.waitingForInput = { type: 'main_phase', playerId: gs.activePlayer };
      }
    }
    this.render();
    this._continueIfAI();
  },

  passPriority() {
    const gs = this.gameState;
    // Clear mana undo stack - passing priority commits the action
    this._clearManaUndo();
    gs._undoableAction = null; // Clear undoable actions when passing priority
    const wasInstantPriority = gs.waitingForInput && gs.waitingForInput.type === 'instant_priority';
    gs.waitingForInput = null;
    gs.manaPool[0] = ManaSystem.emptyPool();
    try {
      if (wasInstantPriority) {
        // Mark priority as passed so phase processing continues
        gs._priorityPassed = true;
        GameState._processPhase(gs);
      } else {
        GameState.advancePhase(gs);
      }
    } catch (e) {
      console.error('[UIGame] passPriority error:', e);
      // Recover: ensure we have waitingForInput so game isn't stuck
      if (!gs.waitingForInput) {
        gs.waitingForInput = { type: 'main_phase', playerId: gs.activePlayer };
      }
    }
    this.render();
    this._continueIfAI();
  },

  passStackPriority() {
    const gs = this.gameState;
    this._clearManaUndo();
    gs.waitingForInput = null;
    gs.manaPool[0] = ManaSystem.emptyPool();

    try {
      const pending = gs._pendingCastOnStack;

      if (pending) {
        // A spell/permanent was cast and we paused for human response
        delete gs._pendingCastOnStack;

        // Check if top of stack was countered
        const stackItem = gs.stack && gs.stack.items && gs.stack.items.length > 0
          ? gs.stack.items[gs.stack.items.length - 1] : null;
        const wasCountered = stackItem && stackItem.card && stackItem.card._countered;

        console.log(`[PASS_STACK] Resolving: ${pending.card.name}, countered=${wasCountered}, isPermanent=${pending.isPermanent}`);

        // Pop the pending spell from the stack
        if (stackItem) gs.stack.items.pop();

        if (wasCountered) {
          // COUNTERED: card goes to graveyard
          gs.players[pending.playerId].zones.graveyard.add(pending.card);
          gs.log.push(`${pending.card.name} foi anulado e vai para o cemitério.`);
          if (typeof VFX !== 'undefined') VFX.counterSpell(pending.card.name);
        } else if (pending.isPermanent) {
          // NOT COUNTERED + PERMANENT: re-add card to hand temporarily, resume castSpell
          gs.players[pending.playerId].zones.hand.add(pending.card);
          gs._resumingFromStackPriority = true;
          const result = GameState.castSpell(gs, pending.playerId, pending.card._uid, pending.targets, false, pending.isEvoke);
          console.log(`[PASS_STACK] Resumed permanent castSpell: ${result?.success}`);
        } else {
          // NOT COUNTERED + SPELL: resolve effects
          const effects = CardEngine.getSpellEffects(pending.card);
          GameStack.push(gs.stack, { card: pending.card, controller: pending.playerId, targets: pending.targets, effects });
          const stackLog = GameStack.resolve(gs.stack, gs);
          gs.log.push(...stackLog);
          // Send instant/sorcery to graveyard
          gs.players[pending.playerId].zones.graveyard.add(pending.card);
          // Spell copy
          if (gs._pendingSpellCopy && gs._pendingSpellCopy[pending.playerId]) {
            delete gs._pendingSpellCopy[pending.playerId];
            gs.log.push(`Copia de ${pending.card.name} resolvida!`);
            const copyCard = { ...pending.card, name: pending.card.name + ' (Copia)', _uid: pending.card._uid + '_copy' };
            GameStack.push(gs.stack, { card: copyCard, controller: pending.playerId, targets: pending.targets, effects: [...effects] });
            const copyLog = GameStack.resolve(gs.stack, gs);
            gs.log.push(...copyLog);
          }
        }

        // Continue game flow
        GameState._processPhase(gs);
      } else {
        // Legacy path: no pending cast, just resolve stack
        if (gs.stack && gs.stack.items && gs.stack.items.length > 0) {
          const stackLog = GameStack.resolve(gs.stack, gs);
          gs.log.push(...stackLog);
        }
        GameState._processPhase(gs);
      }
    } catch (e) {
      console.error('[UIGame] passStackPriority error:', e);
      if (!gs.waitingForInput) {
        gs.waitingForInput = { type: 'main_phase', playerId: gs.activePlayer };
      }
    }

    this.render();
    this._continueIfAI();
  },

  _handleCounterClick(element) {
    try {
      const encodedUid = element.getAttribute('data-card-uid');
      const cardUid = atob(encodedUid); // Decode from base64
      this.castCardAsCounter(cardUid);
    } catch (err) {
      console.error('Error in counter click handler:', err);
    }
  },

  castCardAsCounter(cardUid, beholdChoice) {
    const gs = this.gameState;
    const hand = gs.players[0].zones.hand;
    const card = hand.get(cardUid);

    if (!card) {
      console.error('Card not found:', cardUid);
      this.showToast('Carta nao encontrada', 'error');
      return;
    }

    // Get the target spell (last on stack)
    const targetSpell = gs.stack && gs.stack.items && gs.stack.items.length > 0
      ? gs.stack.items[gs.stack.items.length - 1]
      : null;

    if (!targetSpell) {
      console.error('No spell on stack to counter');
      this.showToast('Nenhum spell na stack para contrar', 'error');
      return;
    }

    try {
      const targetCard = targetSpell.card;

      // 1. Check behold BEFORE paying mana (need to ask player first)
      const beholdCost = CardEngine.getBeholdCost(card);
      if (beholdCost && beholdChoice === undefined) {
        // Check if there are Dragon candidates in hand
        const candidates = hand.getAll().filter(c =>
          c._uid !== cardUid && CardEngine.hasCreatureType(c, beholdCost.subtype)
        );
        if (candidates.length > 0 && beholdCost.optional) {
          // Show behold choice overlay - pause here
          gs._pendingCounterBehold = { cardUid, candidates };
          gs.waitingForInput = { type: 'counter_behold_choice', playerId: 0 };
          this.render();
          return;
        }
        // No candidates or not optional: continue without behold
      }

      console.log(`🎯 Counter: ${card.name} → ${targetCard.name}, behold=${beholdChoice}`);

      // 2. Pay mana for the counter spell (com cost reduction)
      const cost = card.mana_cost || '';
      const { cmc: counterCmc } = GameState.getEffectiveCmcWithReduction(gs, 0, card);
      GameState.autoTapForSpell(gs, 0, cost, counterCmc, card);

      if (!ManaSystem.canPay(gs.manaPool[0], cost, counterCmc)) {
        this.showToast('Mana insuficiente', 'error');
        this.render();
        return;
      }
      gs.manaPool[0] = ManaSystem.payMana(gs.manaPool[0], cost, counterCmc);

      // 3. Handle behold based on choice
      if (!gs._beholding) gs._beholding = {};
      if (beholdChoice === true && beholdCost) {
        const candidates = hand.getAll().filter(c =>
          c._uid !== cardUid && CardEngine.hasCreatureType(c, beholdCost.subtype)
        );
        if (candidates.length > 0) {
          const picked = candidates[0];
          gs._beholding[0] = picked;
          gs.log.push(`Voce revela ${picked.name} (behold).`);
        }
      }

      // 4. Remove counter from hand, track spell
      hand.remove(cardUid);
      gs._spellsThisTurn[0] = (gs._spellsThisTurn[0] || 0) + 1;

      // 5. Resolve the counter effect directly against the target
      const effects = CardEngine.getSpellEffects(card);
      gs.log.push(`Voce lanca ${card.name}.`);
      if (typeof VFX !== 'undefined') VFX.spellCast(card.name);

      // Push counter to stack and resolve it (this will process counter_spell effect)
      GameStack.push(gs.stack, { card, controller: 0, targets: [targetCard], effects });
      // Only resolve the counter spell (pop just the top item)
      const counterItem = gs.stack.items.pop();
      const counterLog = GameStack._resolveItem(counterItem, gs);
      if (Array.isArray(counterLog)) gs.log.push(...counterLog);

      // 6. Send counter to graveyard
      gs.players[0].zones.graveyard.add(card);

      // 7. If unless_pay paused for human decision, don't continue yet
      if (gs.waitingForInput && gs.waitingForInput.type === 'unless_pay_decision') {
        console.log(`[COUNTER] Paused for unless_pay decision`);
        this.render();
        return;
      }

      // 8. Check if target was countered and handle the pending cast
      const pending = gs._pendingCastOnStack;
      console.log(`[COUNTER] Target _countered: ${targetCard._countered}, pending: ${!!pending}`);

      if (targetCard._countered && pending) {
        // Counter succeeded! Clean up pending cast
        delete gs._pendingCastOnStack;
        // Pop the original spell from the stack
        const stackItem = gs.stack.items.length > 0 ? gs.stack.items.pop() : null;
        // Send to graveyard
        gs.players[pending.playerId].zones.graveyard.add(pending.card);
        gs.log.push(`${pending.card.name} foi anulado e vai para o cemiterio.`);
        if (typeof VFX !== 'undefined') VFX.counterSpell(pending.card.name);

        // Clear and continue
        gs.waitingForInput = null;
        gs.manaPool[0] = ManaSystem.emptyPool();
        GameState._processPhase(gs);
      } else if (!targetCard._countered) {
        // Counter failed (opponent paid unless cost) - return to stack_priority
        console.log(`[COUNTER] Counter failed, returning to stack_priority`);
        // Keep stack_priority active so human can pass or try another spell
        if (pending) {
          gs.waitingForInput = { type: 'stack_priority', playerId: 0, spellCaster: pending.playerId };
        }
      }

      // Clean up beholding
      if (gs._beholding) delete gs._beholding[0];
      delete gs._pendingCounterBehold;

    } catch (err) {
      console.error('Error casting counter:', err);
      this.showToast(`Erro: ${err.message}`, 'error');
    }

    this.render();
    this._continueIfAI();
  },

  resolveCounterBeholdChoice(wantBehold) {
    const gs = this.gameState;
    const pending = gs._pendingCounterBehold;
    if (!pending) return;

    delete gs._pendingCounterBehold;
    gs.waitingForInput = null;

    // Continue casting the counter with the behold decision
    this.castCardAsCounter(pending.cardUid, wantBehold);
  },

  // =================== Scry/Surveil ===================

  // =================== Modal Choice Overlay ===================

  _modalSelectedModes: [],

  _renderModalOverlay(pending) {
    const chooseCount = pending.chooseCount || 1;
    const isMulti = chooseCount > 1;

    if (isMulti) {
      // Multi-select mode (choose two)
      const selected = this._modalSelectedModes || [];
      const modesHtml = pending.modes.map((mode, i) => {
        const desc = this._describeModalMode(mode);
        const isSelected = selected.includes(i);
        const cls = isSelected ? 'modal-mode-btn modal-mode-selected' : 'modal-mode-btn';
        return `
          <button class="${cls}" onclick="UIGame.toggleModalMode(${i})">
            <span class="modal-mode-num">${isSelected ? '&#10003;' : (i + 1)}</span>
            <span class="modal-mode-desc">${desc}</span>
          </button>
        `;
      }).join('');

      const confirmDisabled = selected.length !== chooseCount ? 'disabled' : '';
      return `
        <div class="modal-choice-overlay">
          <div class="modal-choice-box">
            <h3>${pending.cardName} — Escolha ${chooseCount} modos (${selected.length}/${chooseCount})</h3>
            <div class="modal-modes">${modesHtml}</div>
            <button class="btn btn-primary modal-confirm-btn" onclick="UIGame.confirmMultiModalChoice()" ${confirmDisabled}>
              Confirmar <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      `;
    }

    // Single select (choose one)
    const modesHtml = pending.modes.map((mode, i) => {
      const desc = this._describeModalMode(mode);
      return `
        <button class="modal-mode-btn" onclick="UIGame.confirmModalChoice(${i})">
          <span class="modal-mode-num">${i + 1}</span>
          <span class="modal-mode-desc">${desc}</span>
        </button>
      `;
    }).join('');

    return `
      <div class="modal-choice-overlay">
        <div class="modal-choice-box">
          <h3>${pending.cardName} — Escolha um modo</h3>
          <div class="modal-modes">${modesHtml}</div>
        </div>
      </div>
    `;
  },

  _describeModalMode(mode) {
    if (Array.isArray(mode)) return mode[0].description || mode.map(m => this._describeModalMode(m)).join('. ');
    if (mode.description) return mode.description;
    const t = mode.type;
    const a = mode.amount || '';
    const tgt = mode.target || '';
    if (t === 'damage') return `${a} dano a ${tgt === 'creature' ? 'uma criatura' : tgt === 'player' || tgt === 'opponent' ? 'um jogador' : 'alvo'}`;
    if (t === 'destroy') {
      if (tgt === 'artifact_or_enchantment') return 'Destruir artefato ou encantamento alvo';
      if (tgt === 'creature_or_planeswalker') return 'Destruir criatura ou planeswalker alvo';
      return `Destruir ${tgt.replace(/_/g, ' ')}`;
    }
    if (t === 'destroy_all') return `Destruir ${tgt.replace(/_/g, ' ')}`;
    if (t === 'exile') return `Exilar ${tgt.replace(/_/g, ' ')}`;
    if (t === 'bounce' || t === 'bounce_to_library') return `Devolver ${tgt.replace(/_/g, ' ')}`;
    if (t === 'draw') return `Comprar ${a || 1} carta(s)`;
    if (t === 'gainLife' || t === 'gain_life') return `Ganhar ${a} vida`;
    if (t === 'loseLife' || t === 'lose_life') return `Oponente perde ${a} vida`;
    if (t === 'create_token') return `Criar ${mode.count || 1}x ${mode.name || 'token'} ${mode.power || '?'}/${mode.toughness || '?'}`;
    if (t === 'buff') return `${mode.power >= 0 ? '+' : ''}${mode.power || 0}/${mode.toughness >= 0 ? '+' : ''}${mode.toughness || 0} em criatura`;
    if (t === 'buff_all') return `${mode.power >= 0 ? '+' : ''}${mode.power || 0}/${mode.toughness >= 0 ? '+' : ''}${mode.toughness || 0} em todas as criaturas`;
    if (t === 'counter_spell') return `Anular ${tgt ? tgt.replace(/_/g, ' ') : 'magia'}`;
    if (t === 'counter_all') return `Colocar ${a || 1} marcador ${mode.counter} em todas as ${tgt === 'own_creatures' ? 'suas criaturas' : tgt.replace(/_/g, ' ')}`;
    if (t === 'counter' && mode.counter) return `Colocar ${a || 1} marcador ${mode.counter} em ${tgt ? tgt.replace(/_/g, ' ') : 'criatura'}`;
    if (t === 'counter') return `Anular ${tgt ? tgt.replace(/_/g, ' ') : 'magia'}`;
    if (t === 'tap') return `Virar ${tgt ? tgt.replace(/_/g, ' ') : 'permanente'}`;
    if (t === 'triggered') {
      const event = mode.event || '';
      const effects = mode.effects || [];
      const effectDesc = effects.map(eff => this._describeModalMode(eff)).join(', ');
      if (event === 'counter_placed') return `Quando marcador é colocado: ${effectDesc}`;
      if (event === 'attacks') return `Quando atacar: ${effectDesc}`;
      if (event === 'end_step') return `No final do turno: ${effectDesc}`;
      if (event === 'combat_damage_player') return `Quando causar dano de combate ao jogador: ${effectDesc}`;
      if (event === 'cast_noncreature') return `Quando conjurar mágica não criatura: ${effectDesc}`;
      if (event === 'upkeep') return `Na sua manutenção: ${effectDesc}`;
      return `Triggered (${event}): ${effectDesc}`;
    }
    if (t === 'surveil') return `Surveil ${a}`;
    if (t === 'scry') return `Scry ${a}`;
    if (t === 'mill') return `Mill ${a}`;
    if (t === 'ramp') return `Buscar terreno`;
    if (t === 'return_from_graveyard') return `Devolver carta do cemiterio`;
    if (t === 'debuff') return `${mode.power || 0}/${mode.toughness || 0} em criatura`;
    if (t === 'static') {
      if (mode.ability === 'play_lands_from_graveyard') return 'Jogar terrenos do cemitério';
      if (mode.ability === 'double_attack_triggers') return 'Triggers de ataque disparam duas vezes';
      return `Efeito estático: ${mode.ability || '?'}`;
    }
    if (t === 'anthem') {
      const p = mode.power >= 0 ? '+' : '';
      const t = mode.toughness >= 0 ? '+' : '';
      const kw = mode.keywords ? ` e ${mode.keywords.join(', ')}` : '';
      return `Criaturas recebem ${p}${mode.power || 0}/${t}${mode.toughness || 0}${kw}`;
    }
    if (t === 'sacrifice') return `Sacrifice ${tgt ? tgt.replace(/_/g, ' ') : 'permanente'}`;
    return `${t} ${a} ${tgt}`.trim();
  },

  toggleModalMode(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingModal) return;
    const chooseCount = gs._pendingModal.chooseCount || 1;
    if (!this._modalSelectedModes) this._modalSelectedModes = [];

    const idx = this._modalSelectedModes.indexOf(index);
    if (idx >= 0) {
      this._modalSelectedModes.splice(idx, 1);
    } else if (this._modalSelectedModes.length < chooseCount) {
      this._modalSelectedModes.push(index);
    }
    this.render();
  },

  confirmMultiModalChoice() {
    const gs = this.gameState;
    if (!gs || !gs._pendingModal) return;
    const pending = gs._pendingModal;
    const chooseCount = pending.chooseCount || 1;
    const selected = this._modalSelectedModes || [];
    if (selected.length !== chooseCount) return;

    const chosenModes = selected.sort((a,b) => a-b).map(i => pending.modes[i]);
    const modeEffects = chosenModes.flatMap(m => Array.isArray(m) ? m : [m]);
    const allEffects = [...modeEffects, ...(pending.remainingEffects || [])];

    gs.log.push(`Modos escolhidos: ${chosenModes.map(m => this._describeModalMode(m)).join(', ')}.`);

    if (allEffects.length > 0) {
      GameStack.push(gs.stack, {
        card: pending.card,
        controller: pending.controller,
        targets: pending.targets || [],
        effects: allEffects
      });
      const stackLog = GameStack.resolve(gs.stack, gs);
      gs.log.push(...stackLog);
    }

    gs._pendingModal = null;
    gs.waitingForInput = null;
    this._modalSelectedModes = [];

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  confirmModalChoice(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingModal) return;

    const pending = gs._pendingModal;
    const chosenMode = pending.modes[index];
    if (!chosenMode) return;

    // Track modal choice on enchantments for conditional triggers
    if (pending.card && pending.card.name) {
      const cardName = pending.card.name.toLowerCase();
      if (cardName === 'glacierwood siege') {
        pending.card._temurMode = (index === 0); // Temur is index 0
      } else if (cardName === 'frostcliff siege') {
        pending.card._jeskaiMode = (index === 0); // Jeskai is index 0
        pending.card._temurMode = (index === 1); // Temur is index 1
      }
    }

    const modeEffects = Array.isArray(chosenMode) ? chosenMode : [chosenMode];
    const allEffects = [...modeEffects, ...(pending.remainingEffects || [])];

    gs.log.push(`Modo escolhido: ${this._describeModalMode(chosenMode)}.`);

    // Check if chosen mode needs targets
    const effectNeedsTarget = (e) =>
      ['damage', 'destroy', 'exile', 'bounce', 'buff', 'debuff', 'counter', 'fight', 'tap', 'untap'].includes(e.type) &&
      e.target !== 'all_own_creatures' && e.target !== 'opponent' && e.target !== 'player' &&
      e.target !== 'creatures' && e.target !== 'nonland' && e.target !== 'opponent_creatures' &&
      e.target !== 'each opponent' && e.target !== 'all_creatures';

    const modeNeedsTargets = modeEffects.some(effectNeedsTarget);

    if (modeNeedsTargets) {
      // Modal mode needs targets - enter targeting mode
      gs._pendingModalAfterTargets = {
        card: pending.card,
        controller: pending.controller,
        allEffects: allEffects,
        remainingEffects: pending.remainingEffects || []
      };
      gs._pendingModal = null;

      this.targetingMode = {
        card: pending.card,
        effects: modeEffects,
        isPermanent: false,
        modalMode: true,
        returnToInstantPriority: false
      };
      gs.waitingForInput = { type: 'choose_target', playerId: 0 };
      this.render();
    } else {
      // No targets needed, resolve immediately
      if (allEffects.length > 0) {
        GameStack.push(gs.stack, {
          card: pending.card,
          controller: pending.controller,
          targets: pending.targets || [],
          effects: allEffects
        });
        const stackLog = GameStack.resolve(gs.stack, gs);
        gs.log.push(...stackLog);
      }

      gs._pendingModal = null;
      gs.waitingForInput = null;

      const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
      if (isMainPhase && gs.activePlayer === 0) {
        gs.waitingForInput = { type: 'main_phase', playerId: 0 };
      }

      this.render();
      this._continueIfAI();
    }
  },

  // =================== Clash ===================

  _renderClashOverlay(pending) {
    const myCard = pending.myCard;
    const oppCard = pending.oppCard;
    const myImg = myCard ? (myCard.image_small || myCard.image_normal || '') : '';
    const oppImg = oppCard ? (oppCard.image_small || oppCard.image_normal || '') : '';
    const resultText = pending.won
      ? '<span class="clash-win">Voce venceu o clash!</span>'
      : '<span class="clash-lose">Oponente venceu o clash.</span>';

    return `
      <div class="clash-overlay">
        <div class="clash-box">
          <h3>${pending.cardName} — Clash!</h3>
          <div class="clash-cards">
            <div class="clash-card-col">
              <div class="clash-label">Voce (${pending.myCmc})</div>
              ${myCard ? `<img class="clash-card-img" src="${myImg}" alt="${myCard.name}">` : '<div class="clash-empty">Vazio</div>'}
              <div class="clash-card-name">${myCard ? myCard.name : '—'}</div>
              <div class="clash-choice-btns">
                <button class="btn btn-sm btn-primary" onclick="UIGame.confirmClash('top')">Topo</button>
                <button class="btn btn-sm" onclick="UIGame.confirmClash('bottom')">Fundo</button>
              </div>
            </div>
            <div class="clash-vs">VS</div>
            <div class="clash-card-col">
              <div class="clash-label">Oponente (${pending.oppCmc})</div>
              ${oppCard ? `<img class="clash-card-img" src="${oppImg}" alt="${oppCard.name}">` : '<div class="clash-empty">Vazio</div>'}
              <div class="clash-card-name">${oppCard ? oppCard.name : '—'}</div>
            </div>
          </div>
          <div class="clash-result">${resultText}</div>
        </div>
      </div>
    `;
  },

  confirmClash(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingClash) return;
    const pending = gs._pendingClash;

    // Put human's card on top or bottom
    if (pending.myCard) {
      const lib = gs.players[pending.controller].zones.library;
      if (choice === 'top') lib.addToTop(pending.myCard);
      else lib.addToBottom(pending.myCard);
      gs.log.push(`Voce coloca ${pending.myCard.name} no ${choice === 'top' ? 'topo' : 'fundo'}.`);
    }

    // Opponent AI puts their card back
    if (pending.oppCard) {
      const opponent = pending.controller === 0 ? 1 : 0;
      const oppLib = gs.players[opponent].zones.library;
      const keepOnTop = (pending.oppCmc >= 3) || CardEngine.isCreature(pending.oppCard);
      if (keepOnTop) oppLib.addToTop(pending.oppCard);
      else oppLib.addToBottom(pending.oppCard);
    }

    // If won, resolve bonus effects
    if (pending.won && pending.bonusEffects && pending.bonusEffects.length > 0) {
      const allEffects = [...pending.bonusEffects, ...(pending.remainingEffects || [])];
      if (allEffects.length > 0) {
        GameStack.push(gs.stack, {
          card: pending.card,
          controller: pending.controller,
          targets: pending.targets || [],
          effects: allEffects
        });
        const stackLog = GameStack.resolve(gs.stack, gs);
        gs.log.push(...stackLog);
      }
    } else if (pending.remainingEffects && pending.remainingEffects.length > 0) {
      GameStack.push(gs.stack, {
        card: pending.card,
        controller: pending.controller,
        targets: pending.targets || [],
        effects: pending.remainingEffects
      });
      const stackLog = GameStack.resolve(gs.stack, gs);
      gs.log.push(...stackLog);
    }

    gs._pendingClash = null;
    gs.waitingForInput = null;

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  // =================== Hideaway ===================

  _renderHideawayOverlay(pending) {
    const cardsHtml = pending.cards.map((card, i) => {
      const img = card.image_small || card.image_normal || '';
      return `
        <div class="hideaway-card" onclick="UIGame.confirmHideaway(${i})">
          <img src="${img}" alt="${card.name}" class="hideaway-card-img">
          <div class="hideaway-card-name">${card.name}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>${pending.landName} — Hideaway</h3>
          <p class="hideaway-hint">Escolha uma carta para exilar (as outras vao para o fundo da biblioteca)</p>
          <div class="hideaway-cards">${cardsHtml}</div>
        </div>
      </div>
    `;
  },

  confirmHideaway(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingHideaway) return;
    const pending = gs._pendingHideaway;

    const pick = pending.cards[index];
    if (!pick) return;

    // Find the land on battlefield
    const land = gs.players[pending.playerId].zones.battlefield.get(pending.landUid);
    if (land) {
      land._hideawayCard = pick;
    }

    // Put rest on bottom
    const rest = pending.cards.filter((_, i) => i !== index);
    const lib = gs.players[pending.playerId].zones.library;
    rest.sort(() => Math.random() - 0.5);
    rest.forEach(c => lib.addToBottom(c));

    gs.log.push(`Voce exila ${pick.name} com ${pending.landName}.`);

    gs._pendingHideaway = null;
    gs.waitingForInput = null;

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  _renderBlightOverlay(pending) {
    const gs = this.gameState;
    const creatures = gs.players[pending.playerId].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
    const cardsHtml = creatures.map(c => {
      const img = c.image_small || c.image_normal || '';
      const stats = `${CardEngine.getPower(c)}/${CardEngine.getToughness(c)}`;
      const counters = c._counters && c._counters['-1/-1'] ? ` (-1/-1: ${c._counters['-1/-1']})` : '';
      return `
        <div class="hideaway-card" onclick="UIGame.confirmBlight('${c._uid}')" style="cursor:pointer">
          ${img ? `<img src="${img}" alt="${c.name}" class="hideaway-card-img">` : `<div class="hideaway-card-name" style="padding:10px">${c.name}<br>${stats}${counters}</div>`}
          <div class="hideaway-card-name">${c.name} ${stats}${counters}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Blight ${pending.amount}</h3>
          <p class="hideaway-hint">Escolha uma criatura sua para receber ${pending.amount} contador(es) -1/-1</p>
          <div class="hideaway-cards">${cardsHtml}</div>
        </div>
      </div>
    `;
  },

  confirmBlight(creatureUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingBlight) return;
    GameState.resolveBlightChoice(gs, creatureUid);
    this.render();
    this._continueIfAI();
  },

  // === Buff Target Choice ===
  selectBuffTarget(creatureUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingBuffChoice) return;
    GameState.resolveBuffChoice(gs, creatureUid);
    // Resume pending stack effects if any
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }
    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (!gs.waitingForInput && isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }
    this.render();
    this._continueIfAI();
  },

  // === Hand Exile Choice (Aggressive Negotiations) ===
  selectHandExileTarget(cardUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingHandExile) return;

    GameState.resolveHandExileChoice(gs, cardUid);
    this.render();
    this._continueIfAI();
  },

  // === Multi Buff Choice (Rally the Monastery) ===
  selectMultiBuffTarget(creatureUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingMultiBuffChoice) return;

    const pending = gs._pendingMultiBuffChoice;
    const selectedIdx = pending.selected.indexOf(creatureUid);

    if (selectedIdx >= 0) {
      // Remove from selection
      pending.selected.splice(selectedIdx, 1);
    } else {
      // Add to selection if under limit
      if (pending.selected.length < pending.maxTargets) {
        pending.selected.push(creatureUid);
      }
    }

    this.render();
  },

  confirmMultiBuffChoice() {
    const gs = this.gameState;
    if (!gs || !gs._pendingMultiBuffChoice) return;

    GameState.resolveMultiBuffChoice(gs);
    this.render();
    this._continueIfAI();
  },

  // === Mana Color Choice ===
  _renderManaChoiceOverlay(pending) {
    const colorNames = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', C: 'Incolor' };
    const colorClasses = { W: '#f9fae5', U: '#0e6faf', B: '#6b2d7b', R: '#d32029', G: '#0e6a33', C: '#999' };
    const colorsHtml = pending.colors.map((c, i) => `
      <div class="hideaway-card" onclick="UIGame.resolveManaChoice('${c}')" style="cursor:pointer;padding:20px;text-align:center;min-width:100px">
        <div class="mana-pip mana-${c.toLowerCase()}" style="width:36px;height:36px;line-height:36px;font-size:18px;margin:0 auto 8px">${c}</div>
        <div class="hideaway-card-name" style="font-size:13px;font-weight:bold">${colorNames[c] || c}</div>
      </div>
    `).join('');
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Escolha a cor de mana</h3>
          <p class="hideaway-hint">Adicionar 1 mana de qual cor?</p>
          <div class="hideaway-cards" style="justify-content:center;gap:16px">
            ${colorsHtml}
          </div>
          <p style="font-size:11px;color:#888;margin-top:8px">Tecla ${pending.colors.map((c, i) => `${i + 1} = ${colorNames[c] || c}`).join(', ')}</p>
        </div>
      </div>
    `;
  },

  resolveManaChoice(color) {
    const gs = this.gameState;
    if (!gs || !gs._pendingManaChoice) return;
    GameState.resolveManaChoice(gs, color);
    this.render();
    this._continueIfAI();
  },

  // === Unless Pay Decision (Counter spell with payment option) ===
  resolveUnlessPay(shouldPay) {
    const gs = this.gameState;
    if (!gs || !gs._pendingUnlessPay) return;
    GameState.resolveUnlessPay(gs, shouldPay);
    this.render();
    this._continueIfAI();
  },

  _renderUnlessPayOverlay(pending) {
    const costStr = pending.wasDragonBeheld ? `{${pending.cost}} (Dragon Beheld)` : `{${pending.cost}}`;
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:500px">
          <h3>Counter com Taxa de Pagamento</h3>
          <p class="hideaway-hint">${pending.spell.name} será anulado a menos que seu controlador pague ${costStr}</p>
          <div style="display:flex;gap:16px;justify-content:center;margin:16px 0">
            <button class="btn btn-success btn-lg" onclick="UIGame.resolveUnlessPay(true)" style="cursor:pointer;padding:12px 24px">
              💰 Pagar ${costStr}
            </button>
            <button class="btn btn-danger btn-lg" onclick="UIGame.resolveUnlessPay(false)" style="cursor:pointer;padding:12px 24px">
              ✗ Deixar Anular
            </button>
          </div>
          <p style="font-size:11px;color:#888;margin-top:8px">Tecla <kbd>1</kbd> para Pagar, <kbd>2</kbd> para Não Pagar</p>
        </div>
      </div>
    `;
  },

  // === Behold Choice ===
  resolveBeholdChoiceMultiple(card) {
    const gs = this.gameState;
    if (!gs || !gs._pendingBeholdChoice) return;

    const pending = gs._pendingBeholdChoice;
    const cardUid = pending.cardUid;
    const handCard = gs.players[pending.playerId].zones.hand.get(cardUid);
    if (handCard) {
      handCard._beholdPaid = true;
      handCard._beholdCardUid = card._uid;
    }

    // Continue casting with behold selected
    const result = GameState.castSpell(gs, pending.playerId, cardUid);
    if (!result.success) {
      gs.log.push(result.msg);
    }
    gs._pendingBeholdChoice = null;
    gs.waitingForInput = null;
    this.render();
    this._continueIfAI();
  },

  resolveBeholdChoiceDecline() {
    const gs = this.gameState;
    if (!gs || !gs._pendingBeholdChoice) return;

    // Clear behold choice without setting _beholding
    gs._pendingBeholdChoice = null;
    gs.waitingForInput = null;

    // Continue casting the spell (effects will skip create_token due to condition check)
    this.render();
    this._continueIfAI();
  },

  resolveBeholdChoiceOptional(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingBeholdChoice) return;

    const pending = gs._pendingBeholdChoice;
    const cardUid = pending.cardUid;

    if (choice === 'reveal') {
      // User wants to show card selector overlay
      this._setupBeholdCardChoice();
      return;
    } else {
      // Pay mana instead
      const result = GameState.castSpell(gs, pending.playerId, cardUid);
      if (!result.success) {
        gs.log.push(result.msg);
      }
    }
    gs._pendingBeholdChoice = null;
    gs.waitingForInput = null;
    this.render();
    this._continueIfAI();
  },

  _setupBeholdCardChoice() {
    const gs = this.gameState;
    const pending = gs._pendingBeholdChoice;
    const hand = gs.players[pending.playerId].zones.hand;
    const candidates = hand.getAll().filter(c =>
      CardEngine.hasCreatureType(c, pending.beholdCost.subtype)
    );

    if (candidates.length > 0) {
      gs.waitingForInput = { type: 'behold_card_choice' };
      gs._pendingBeholdCardChoice = {
        cardUid: pending.cardUid,
        candidates,
        playerId: pending.playerId
      };
      this.render();
    }
  },

  confirmBeholdCardChoice(idx) {
    const gs = this.gameState;
    const pending = gs._pendingBeholdCardChoice;
    if (!pending || idx < 0 || idx >= pending.candidates.length) return;

    const card = pending.candidates[idx];
    const cardUid = pending.cardUid;

    // Mark card for behold
    const handCard = gs.players[pending.playerId].zones.hand.get(cardUid);
    if (handCard) {
      handCard._beholdPaid = true;
      handCard._beholdCardUid = card._uid;
    }

    // Continue casting
    const result = GameState.castSpell(gs, pending.playerId, cardUid);
    if (!result.success) {
      gs.log.push(result.msg);
    }

    gs._pendingBeholdChoice = null;
    gs._pendingBeholdCardChoice = null;
    gs.waitingForInput = null;
    this.render();
    this._continueIfAI();
  },

  _renderBeholdChoiceMultipleOverlay(pending) {
    const candidates = pending.candidates;
    const baseType = pending.beholdCost ? pending.beholdCost.subtype : 'Dragon';
    const isOptional = pending.isOptional === true;
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:600px">
          <h3>Revelar ${baseType} para Behold${isOptional ? ' (Opcional)' : ''}</h3>
          <p class="hideaway-hint">Escolha qual ${baseType} revelar:</p>
          <div class="hideaway-cards" style="gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            ${candidates.map((card, idx) => `
              <div class="hideaway-card" onclick="UIGame.resolveBeholdChoiceMultiple(UIGame.gameState._pendingBeholdChoice.candidates[${idx}])" style="cursor:pointer">
                <div class="hideaway-card-name">${card.name}</div>
                <div class="hideaway-card-type" style="font-size:10px;color:#aaa">${card.type_line || ''}</div>
              </div>
            `).join('')}
          </div>
          ${isOptional ? `
            <button class="btn btn-warning" onclick="UIGame.resolveBeholdChoiceDecline()" style="width:100%;margin-top:12px;padding:8px">
              Declinar
            </button>
          ` : ''}
          <p style="font-size:11px;color:#888;margin-top:12px">Clique para escolher ou pressione <kbd>1</kbd>-<kbd>${candidates.length}</kbd>${isOptional ? ' ou <kbd>Esc</kbd> para declinar' : ''}</p>
        </div>
      </div>
    `;
  },

  _renderBeholdChoiceOptionalOverlay(pending) {
    const alternateCost = pending.beholdCost ? pending.beholdCost.alternateCost || 1 : 1;
    const baseType = pending.beholdCost ? pending.beholdCost.subtype : 'Dragon';
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:500px">
          <h3>Behold (Opcional)</h3>
          <p class="hideaway-hint">Você não tem ${baseType} na mão</p>
          <div style="display:flex;gap:16px;justify-content:center;margin:16px 0">
            <button class="btn btn-info btn-lg" onclick="UIGame.resolveBeholdChoiceOptional('reveal')" style="cursor:pointer;padding:12px 24px">
              🐉 Revelar ${baseType}
            </button>
            <button class="btn btn-warning btn-lg" onclick="UIGame.resolveBeholdChoiceOptional('pay')" style="cursor:pointer;padding:12px 24px">
              💰 Pagar {${alternateCost}}
            </button>
          </div>
          <p style="font-size:11px;color:#888;margin-top:8px">Tecla <kbd>1</kbd> para Revelar, <kbd>2</kbd> para Pagar</p>
        </div>
      </div>
    `;
  },

  _renderBeholdCardChoiceOverlay() {
    const gs = this.gameState;
    const pending = gs._pendingBeholdCardChoice;
    if (!pending) return '';

    const candidates = pending.candidates;
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:600px">
          <h3>Escolher Dragão para Revelar</h3>
          <p class="hideaway-hint">Clique em um dragão para revelar:</p>
          <div class="hideaway-cards" style="gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            ${candidates.map((card, idx) => `
              <div class="hideaway-card" onclick="UIGame.confirmBeholdCardChoice(${idx})" style="cursor:pointer">
                <div class="hideaway-card-name">${card.name}</div>
                <div class="hideaway-card-type" style="font-size:10px;color:#aaa">${card.type_line || ''}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  // === Endure Choice ===
  _renderEndureOverlay(pending) {
    const cardName = (() => {
      const gs = this.gameState;
      const card = gs.players[pending.controllerId].zones.battlefield.get(pending.cardUid);
      return card ? card.name : 'Criatura';
    })();

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Endure ${pending.amount}</h3>
          <p class="hideaway-hint">Escolha: colocar ${pending.amount} contador(es) +1/+1 em ${cardName} ou criar ${pending.amount} Spirit(s) 1/1</p>
          <div class="hideaway-cards" style="justify-content:center;gap:20px">
            <div class="hideaway-card" onclick="UIGame.resolveEndure('counters')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">⬆️</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">+${pending.amount}/+${pending.amount}</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Counters +1/+1</div>
            </div>
            <div class="hideaway-card" onclick="UIGame.resolveEndure('spirits')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">👻</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">${pending.amount}x Spirit 1/1</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Token</div>
            </div>
          </div>
          <p style="font-size:11px;color:#888;margin-top:8px">Tecla 1 = Counters, 2 = Spirits</p>
        </div>
      </div>
    `;
  },

  _renderHarmonizeCreatureOverlay(pending) {
    const harmonizeCost = CardEngine.getHarmonizeCost(pending.card);
    const cmc = CardEngine.getHarmonizeCMC(pending.card);

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:500px;">
          <h3 style="margin-bottom:8px;">🎵 Harmonizar: ${pending.card.name}</h3>
          <p style="font-size:12px;color:#aaa;margin:4px 0 16px 0;">Custo harmonize: <strong>${harmonizeCost}</strong> (CMC ${cmc})</p>

          <p class="hideaway-hint" style="margin-bottom:12px;">Escolha uma criatura para virar (poder = desconto em mana genérica):</p>

          <div class="hideaway-cards" style="gap:10px;max-height:250px;overflow-y:auto;margin-bottom:12px;">
            ${pending.creatures.map((c) => {
              const power = CardEngine.getPower(c);
              const finalCost = Math.max(0, cmc - power);
              return `
                <div class="hideaway-card creature-choice" onclick="UIGame.selectHarmonizeCreature('${c._uid}')"
                     style="cursor:pointer;display:flex;gap:8px;align-items:center;padding:8px;border:2px solid #2ecc71;border-radius:6px;background:rgba(46,204,113,0.1);transition:all 0.15s;">
                  <img src="${c.image_small || c.image_normal || '/img/card-back.jpg'}" style="width:45px;height:45px;border-radius:4px;object-fit:cover;" alt="${c.name}">
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:bold;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#2ecc71;">${c.name}</div>
                    <div style="font-size:11px;color:#aaa;margin-top:2px;">Poder ${power} → Custo final: <strong style="color:#3498db;">${finalCost}</strong></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div style="display:flex;gap:8px;">
            <button onclick="UIGame.skipHarmonizeCreature()"
                    style="flex:1;padding:10px;background:#555;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold;font-size:13px;">
              Sem Desconto (${cmc} mana)
            </button>
            <button onclick="UIGame.cancelHarmonize()"
                    style="flex:1;padding:10px;background:#e74c3c;border:none;border-radius:4px;color:#fff;cursor:pointer;font-weight:bold;font-size:13px;">
              ❌ Cancelar
            </button>
          </div>

          <p style="font-size:10px;color:#666;margin-top:10px;text-align:center;">Esc = Cancelar | Click = Escolher</p>
        </div>
      </div>
    `;
  },

  _renderHarmonizeConfirmOverlay(pending) {
    const gs = this.gameState;
    const harmonizeCost = CardEngine.getHarmonizeCost(pending.card);
    const cmc = CardEngine.getHarmonizeCMC(pending.card);

    let discount = 0;
    let creatureName = null;
    if (pending.creatureUid) {
      const creature = gs.players[0].zones.battlefield.get(pending.creatureUid);
      if (creature) {
        discount = CardEngine.getPower(creature);
        creatureName = creature.name;
      }
    }

    const finalCost = Math.max(0, cmc - discount);
    const poolMana = Object.values(gs.manaPool[0]).reduce((a, b) => a + b, 0);
    const availableMana = ManaSystem.getAvailableMana(gs, 0);
    const totalAvailable = poolMana + Object.values(availableMana).reduce((a, b) => a + b, 0);
    const canAfford = totalAvailable >= finalCost;

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box" style="max-width:450px;">
          <h3 style="margin-bottom:12px;">✅ Confirmar Harmonize</h3>

          <div style="background:rgba(52,152,219,0.1);border:2px solid #3498db;border-radius:8px;padding:12px;margin-bottom:16px;">
            <div style="font-size:14px;font-weight:bold;color:#3498db;margin-bottom:8px;">${pending.card.name}</div>
            <div style="font-size:12px;color:#aaa;line-height:1.5;">
              <div>Custo harmonize: <strong>${harmonizeCost}</strong></div>
              ${creatureName ? `<div>Criatura: <strong style="color:#2ecc71;">${creatureName}</strong> (poder ${discount})</div>` : '<div>Sem desconto de criatura</div>'}
              <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">
                Custo final: <strong style="color:#e67e22;font-size:15px;">${finalCost} mana</strong>
              </div>
              <div style="font-size:11px;margin-top:4px;">
                Mana disponível: ${totalAvailable} (${poolMana} pool + terrenos) ${canAfford ? '✓' : '⚠️ INSUFICIENTE'}
              </div>
            </div>
          </div>

          ${!canAfford ? `<div style="background:rgba(231,76,60,0.2);border:1px solid #e74c3c;border-radius:4px;padding:8px;margin-bottom:12px;font-size:12px;color:#e74c3c;">⚠️ Mana insuficiente! Você precisará tapar terrenos.</div>` : ''}

          <div style="display:flex;gap:8px;">
            <button onclick="UIGame.confirmHarmonizeCast()" ${!canAfford ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}
                    style="flex:1;padding:12px;background:#2ecc71;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:bold;font-size:14px;">
              ✓ Harmonizar
            </button>
            <button onclick="UIGame.cancelHarmonizeConfirm()"
                    style="flex:1;padding:12px;background:#e74c3c;border:none;border-radius:6px;color:#fff;cursor:pointer;font-weight:bold;font-size:14px;">
              ❌ Cancelar
            </button>
          </div>

          <p style="font-size:10px;color:#666;margin-top:12px;text-align:center;">Após harmonizar, a carta será exilada</p>
        </div>
      </div>
    `;
  },

  _renderMillLandChoiceOverlay(pending) {
    const cardName = (() => {
      const gs = this.gameState;
      const card = gs.players[pending.controller].zones.battlefield.get(pending.cardUid);
      return card ? card.name : 'Criatura';
    })();

    const landNames = pending.milledLands.map(c => c.name).join(', ');

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Mill Choice</h3>
          <p class="hideaway-hint">${cardName}: colocar terreno na mao ou receber +1/+1 counter?</p>
          <div class="hideaway-cards" style="justify-content:center;gap:20px">
            <div class="hideaway-card" onclick="UIGame.resolveMillLandChoice('land')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">🏞️</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">${landNames}</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Para a mao</div>
            </div>
            <div class="hideaway-card" onclick="UIGame.resolveMillLandChoice('counter')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">⬆️</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">+1/+1 Counter</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Em ${cardName}</div>
            </div>
          </div>
          <p style="font-size:11px;color:#888;margin-top:8px">Tecla 1 = Terreno, 2 = Counter</p>
        </div>
      </div>
    `;
  },

  resolveEndure(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingEndure) return;
    GameState.resolveEndureChoice(gs, choice);
    this.render();
    this._continueIfAI();
  },

  resolveMillLandChoice(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingMillLandChoice) return;
    GameState.resolveMillLandChoice(gs, choice);
    this.render();
    this._continueIfAI();
  },

  // === Target Choice (for abilities needing player selection) ===
  _renderTargetChoiceOverlay(pending) {
    if (!pending.targets || pending.targets.length === 0) return '';

    const prompt = pending.prompt || 'Escolha um alvo';

    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width:700px">
          <h3>${prompt}</h3>
          <p class="scry-hint">Clique no card que deseja escolher como alvo</p>
          <div class="scry-cards" style="justify-content:center">
            ${pending.targets.map((card, idx) => `
              <div class="scry-card scry-keep" onclick="UIGame.confirmTargetChoice(${idx})" style="cursor:pointer">
                <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                <div class="scry-card-name">${card.name}</div>
              </div>
            `).join('')}
          </div>
          <p style="font-size:0.85rem;color:#aaa;margin-top:12px">Teclas 1-${pending.targets.length} para escolher rapidamente</p>
        </div>
      </div>
    `;
  },

  confirmTargetChoice(targetIndex) {
    const gs = this.gameState;
    if (!gs || !gs._pendingTargetChoice) return;

    const pending = gs._pendingTargetChoice;
    if (targetIndex < 0 || targetIndex >= pending.targets.length) return;

    const target = pending.targets[targetIndex];

    // Execute the effect on the chosen target
    if (pending.effectType === 'tap') {
      target._tapped = true;
      gs.log.push(`${target.name} e virado.`);

      // Fire becomes_tapped trigger
      const targetOwner = gs.players[0].zones.battlefield.get(target._uid) ? 0 : 1;
      const tapLogs = GameState.fireTrigger(gs, 'becomes_tapped', { cardUid: target._uid, card: target, controllerId: targetOwner });
      gs.log.push(...tapLogs);
    }

    gs._pendingTargetChoice = null;
    gs.waitingForInput = null;
    this.render();
    this._continueIfAI();
  },

  // === Player Choice (any_player targeting) ===
  _renderPlayerChoiceOverlay(pending) {
    const label = pending.effectType === 'mill' ? `Mill ${pending.amount} cartas` : pending.effectType;
    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Escolha o Alvo</h3>
          <p class="hideaway-hint">${label} - escolha quem sera o alvo:</p>
          <div class="hideaway-cards" style="justify-content:center;gap:20px">
            <div class="hideaway-card" onclick="UIGame.resolvePlayerChoice('self')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">&#129489;</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">Voce</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Mill em voce mesmo</div>
            </div>
            <div class="hideaway-card" onclick="UIGame.resolvePlayerChoice('opponent')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">&#128520;</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">Oponente</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">Mill no oponente</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _renderGraveyardChoiceOverlay(pending) {
    const gs = this.gameState;
    const myGy = gs.players[0].zones.graveyard.getAll();
    const oppGy = gs.players[1].zones.graveyard.getAll();

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Escolha o Cemiterio</h3>
          <p class="hideaway-hint">Exilar cartas - escolha de qual cemiterio:</p>
          <div class="hideaway-cards" style="justify-content:center;gap:20px">
            <div class="hideaway-card" onclick="UIGame.resolveGraveyardChoice('self')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">&#129686;</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">Seu Cemiterio</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">${myGy.length} cartas</div>
            </div>
            <div class="hideaway-card" onclick="UIGame.resolveGraveyardChoice('opponent')" style="cursor:pointer;padding:20px;text-align:center;min-width:140px">
              <div style="font-size:28px;margin-bottom:8px">&#128128;</div>
              <div class="hideaway-card-name" style="font-size:14px;font-weight:bold">Cemiterio Oponente</div>
              <div style="font-size:11px;color:#aaa;margin-top:4px">${oppGy.length} cartas</div>
            </div>
          </div>
          ${gs._undoableAction ? `<div class="hideaway-buttons" style="margin-top:15px;text-align:center">
            <button onclick="UIGame.undoLastAction()" style="background:#666;color:white;border:none;padding:8px 16px;border-radius:4px;cursor:pointer">&#x2190; Voltar</button>
          </div>` : ''}
        </div>
      </div>
    `;
  },

  _renderGraveyardCardChoiceOverlay(pending) {
    if (!pending || !pending.cards) return '';

    const playerName = pending.playerId === 0 ? 'Seu cemiterio' : 'Cemiterio do oponente';
    const selectedCards = this._selectedGraveyardCards || [];
    const minAmount = pending.minAmount || 0;
    const isUpTo = minAmount === 0;
    const exactAmount = pending.exactAmount || false;

    // For exact_amount: can only confirm if exactly X or 0 (all or nothing)
    let canConfirm;
    if (exactAmount && isUpTo) {
      canConfirm = selectedCards.length === pending.amount || selectedCards.length === 0;
    } else {
      canConfirm = selectedCards.length >= minAmount && selectedCards.length <= pending.amount;
    }

    const chooseText = exactAmount && isUpTo
      ? `Escolha exatamente ${pending.amount} carta(s) ou nenhuma`
      : isUpTo ? `Escolha até ${pending.amount} carta(s)` : `Escolha ${pending.amount} carta(s)`;

    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width: 90vw">
          <h3>Escolha cartas para exilar</h3>
          <p class="scry-hint">${chooseText} de ${playerName} para exilar:</p>
          <div class="scry-cards" style="max-height: 60vh; overflow-y: auto">
            ${pending.cards.map(card => {
              const isSelected = selectedCards.includes(card._uid);
              return `
                <div class="scry-card ${isSelected ? 'selected' : ''}" onclick="UIGame.toggleGraveyardCard('${card._uid}')" style="opacity: ${isSelected ? '1' : '0.7'}; border: ${isSelected ? '2px solid #4CAF50' : '1px solid #666'}; cursor:pointer">
                  <img src="${card.image_normal || card.image_small}" alt="${card.name}" style="width:100%;border-radius:6px;display:block" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(card) : ''}>
                  <div class="scry-card-name">${card.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="scry-buttons">
            <button onclick="UIGame.confirmGraveyardCardChoice()" ${!canConfirm ? 'disabled' : ''}>
              Confirmar (${selectedCards.length}/${pending.amount})
            </button>
            ${isUpTo && selectedCards.length === 0 ? '<button onclick="UIGame.confirmGraveyardCardChoice()">Não Exilar</button>' : ''}
            <button onclick="UIGame.undoGraveyardChoice()" style="background:#666;margin-left:10px">&#x2190; Voltar</button>
          </div>
        </div>
      </div>
    `;
  },

  _renderTravelingBotanistOverlay(pending) {
    if (!pending || !pending.card) return '';

    const card = pending.card;
    const isLand = pending.isLand;

    return `
      <div class="hideaway-overlay">
        <div class="hideaway-box">
          <h3>Traveling Botanist</h3>
          <p class="hideaway-hint">Topo da biblioteca:</p>
          <div class="hideaway-cards" style="justify-content:center;gap:20px;margin:20px 0">
            <div class="hideaway-card" style="padding:15px;text-align:center;min-width:200px;border:2px solid ${isLand ? '#4CAF50' : '#666'}">
              <div class="hideaway-card-name" style="font-size:16px;font-weight:bold;margin-bottom:8px">${card.name}</div>
              <div class="hideaway-card-cost" style="margin-bottom:8px">${card.mana_cost || '{0}'}</div>
              <div class="hideaway-card-type" style="color:#ccc;font-size:12px">${card.type_line || 'Unknown'}</div>
              ${isLand ? '<div style="color:#4CAF50;margin-top:8px;font-weight:bold">✓ É Terreno!</div>' : '<div style="color:#999;margin-top:8px">Não é terreno</div>'}
            </div>
          </div>
          <div class="hideaway-buttons" style="text-align:center;gap:10px">
            <button onclick="UIGame.resolveTravelingBotanist('hand')" style="background:#4CAF50;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;margin:5px">
              📥 Revelar e Botar na Mão (1)
            </button>
            <button onclick="UIGame.resolveTravelingBotanist('graveyard')" style="background:#9C27B0;color:white;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;margin:5px">
              ⚰️ Botar no Cemitério (2)
            </button>
            <div style="color:#888;font-size:12px;margin-top:10px">
              Pressione (1) ou (2) para escolher
            </div>
          </div>
        </div>
      </div>
    `;
  },

  resolvePlayerChoice(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingPlayerChoice) return;
    const pending = gs._pendingPlayerChoice;
    gs._pendingPlayerChoice = null;
    gs.waitingForInput = null;

    const controller = pending.controller;
    const opponent = 1 - controller;
    const targetPlayer = choice === 'opponent' ? opponent : controller;

    if (pending.effectType === 'mill') {
      const millAmt = pending.amount;
      const lib = gs.players[targetPlayer].zones.library;
      const gy = gs.players[targetPlayer].zones.graveyard;
      const milled = [];
      for (let i = 0; i < millAmt && lib.count() > 0; i++) {
        const c = lib.drawFromTop();
        gy.add(c);
        milled.push(c.name);
      }
      if (milled.length > 0) {
        const who = targetPlayer === 0 ? 'Voce' : 'Oponente';
        gs.log.push(`${who} coloca ${milled.length} carta(s) no cemiterio: ${milled.slice(0, 3).join(', ')}${milled.length > 3 ? '...' : ''}`);
      }
    }

    // Continue resolving remaining effects
    if (pending.remainingEffects && pending.remainingEffects.length > 0) {
      GameStack.push(gs.stack, { card: pending.card, controller, targets: pending.targets, effects: pending.remainingEffects });
      const stackLog = GameStack.resolve(gs.stack, gs);
      gs.log.push(...stackLog);
    }

    this.render();
    this._continueIfAI();
  },

  resolveGraveyardChoice(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingGraveyardChoice) return;

    const pending = gs._pendingGraveyardChoice;
    const effect = pending.effect;
    const controller = pending.controller;
    const opponent = pending.opponent;

    // Save undoable state before proceeding to card selection
    gs._undoableAction = {
      type: 'graveyard_choice',
      pendingState: { ...pending }
    };

    gs._pendingGraveyardChoice = null;

    // Determine target player based on choice
    const efgPid = choice === 'opponent' ? opponent : controller;
    const efgGy = gs.players[efgPid].zones.graveyard;
    const efgCards = efgGy.getAll();

    if (efgCards.length > 0) {
      // Check if human player needs to choose specific cards
      if (effect.choose_cards && controller === 0) {
        // For "up to X" effects, allow choosing 0 to X cards
        const efgAmt = effect.amount || 1;
        const maxAmount = effect.up_to_max ? efgAmt : efgAmt;
        const minAmount = effect.up_to_max ? 0 : efgAmt;

        gs.waitingForInput = { type: 'graveyard_card_choice', playerId: controller };
        gs._pendingGraveyardCardChoice = {
          playerId: efgPid,
          amount: maxAmount,
          minAmount: minAmount,
          cards: efgCards,
          effect,
          controller,
          remainingEffects: [], // Will be handled by stack resolution
          targets: []
        };
        this._selectedGraveyardCards = []; // Reset selection
      } else {
        // Auto-pick highest CMC cards (AI or not choose_cards)
        const efgExile = gs.players[efgPid].zones.exile;
        const efgAmt = effect.amount || 1;
        efgCards.sort((a, b) => (b.cmc || 0) - (a.cmc || 0));
        for (let efgI = 0; efgI < efgAmt && efgI < efgCards.length; efgI++) {
          const picked = efgCards[efgI];
          efgGy.remove(picked._uid);
          efgExile.add(picked);
          gs.log.push(`${picked.name} exilado do cemiterio.`);
        }
      }
    }

    this.render();
    this._continueIfAI();
  },

  toggleGraveyardCard(uid) {
    const gs = this.gameState;
    if (!gs._pendingGraveyardCardChoice) return;

    if (!this._selectedGraveyardCards) this._selectedGraveyardCards = [];

    const idx = this._selectedGraveyardCards.indexOf(uid);
    if (idx >= 0) {
      // Deselect
      this._selectedGraveyardCards.splice(idx, 1);
    } else if (this._selectedGraveyardCards.length < gs._pendingGraveyardCardChoice.amount) {
      // Select if under limit
      this._selectedGraveyardCards.push(uid);
    }

    this.render();
  },

  confirmGraveyardCardChoice() {
    const gs = this.gameState;
    if (!gs._pendingGraveyardCardChoice || !this._selectedGraveyardCards) return;

    const pending = gs._pendingGraveyardCardChoice;
    const selectedCards = this._selectedGraveyardCards;

    // Clear state
    gs._pendingGraveyardCardChoice = null;
    gs.waitingForInput = null;
    this._selectedGraveyardCards = [];

    // Exile selected cards
    const gy = gs.players[pending.playerId].zones.graveyard;
    const exile = gs.players[pending.playerId].zones.exile;

    selectedCards.forEach(uid => {
      const card = gy.getCard(uid);
      if (card) {
        gy.remove(uid);
        exile.add(card);
        gs.log.push(`${card.name} exilado do cemiterio.`);
      }
    });

    // Track that cards were exiled (for if_exiled condition)
    if (selectedCards.length > 0) {
      gs._exiledThisResolution = true;
    }

    // Continue with remaining effects if any
    if (pending.remainingEffects && pending.remainingEffects.length > 0) {
      GameStack.resolveEffects(gs, pending.controller, pending.card, pending.remainingEffects, pending.targets || []);
    }

    this.render();
    this._continueIfAI();
  },

  resolveTravelingBotanist(choice) {
    const gs = this.gameState;
    if (!gs || !gs._pendingTravelingBotanist) return;

    const pending = gs._pendingTravelingBotanist;
    const card = pending.card;
    const controller = pending.controller;

    gs._pendingTravelingBotanist = null;
    gs.waitingForInput = null;

    switch (choice) {
      case 'hand':
        gs.players[controller].zones.hand.add(card);
        gs.log.push(`Revela ${card.name} (terreno) e bota na mao.`);
        break;
      case 'graveyard':
        gs.players[controller].zones.graveyard.add(card);
        gs.log.push(`${card.name} (terreno) vai para o cemiterio.`);
        break;
    }

    this.render();
    this._continueIfAI();
  },

  undoGraveyardChoice() {
    const gs = this.gameState;

    // Clear the card selection and go back to graveyard choice
    this._selectedGraveyardCards = [];
    gs._pendingGraveyardCardChoice = null;
    gs.waitingForInput = { type: 'graveyard_choice', playerId: 0 };

    this.render();
  },

  undoLastAction() {
    const gs = this.gameState;

    // Try new undo system first
    if (gs._undoableAction) {
      const undoInfo = gs._undoableAction;

      switch (undoInfo.type) {
        case 'mana_tap':
          this._undoManaTap(undoInfo);
          break;
        case 'graveyard_choice':
          this._undoGraveyardChoice(undoInfo);
          break;
      }

      gs._undoableAction = null;
      this.render();
      return;
    }

    // Fallback to legacy mana undo system
    if (this._manaUndoStack.length > 0) {
      this.undoMana();
    }
  },

  _undoManaTap(undoInfo) {
    const gs = this.gameState;
    const { playerId, landUid, prevTapped, prevManaPool } = undoInfo;

    // Restore land tapped state
    const land = gs.players[playerId].zones.battlefield.get(landUid);
    if (land) {
      land._tapped = prevTapped;
    }

    // Restore mana pool
    gs.manaPool[playerId] = { ...prevManaPool };

    gs.log.push("Mana desfeita.");
  },

  _undoGraveyardChoice(undoInfo) {
    const gs = this.gameState;

    // Restore previous state before graveyard choice
    gs._pendingGraveyardChoice = undoInfo.pendingState;
    gs._pendingGraveyardCardChoice = null;
    gs.waitingForInput = { type: 'graveyard_choice', playerId: 0 };
    this._selectedGraveyardCards = [];
  },

  // === Sacrifice as Additional Cost ===
  _renderSacrificeCostOverlay() {
    const pending = this._pendingSacrificeCast;
    if (!pending) return '';
    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>Sacrificar ${pending.costTarget}</h3>
          <p class="scry-hint">Escolha uma ${pending.costTarget} para sacrificar como custo de <strong>${pending.card.name}</strong></p>
          <div class="scry-cards">
            ${pending.candidates.map(c => `
              <div class="scry-card scry-keep" onclick="UIGame.confirmSacrificeCost('${c._uid}')" style="cursor:pointer">
                <img src="${c.image_normal || c.image_small || ''}" alt="${c.name}" style="width:100px;border-radius:6px" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(c) : ''}>
                <div class="scry-card-name">${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})</div>
              </div>
            `).join('')}
          </div>
          <button class="btn" onclick="UIGame.cancelSacrificeCost()" style="margin-top:8px">Cancelar</button>
        </div>
      </div>
    `;
  },

  confirmSacrificeCost(creatureUid) {
    const gs = this.gameState;
    const pending = this._pendingSacrificeCast;
    if (!gs || !pending) return;

    // Sacrifice the creature
    GameState.sacrifice(gs, 0, creatureUid);
    gs.log.push(`Voce sacrifica ${gs.players[0].zones.graveyard.cards.find(c => c._uid === creatureUid)?.name || 'criatura'} como custo.`);

    // Mark the card as having paid the sacrifice cost
    const card = gs.players[0].zones.hand.get(pending.cardUid);
    if (card) card._sacrificeCostPaid = true;

    // Clear pending state
    const { castingAdventure, castingEvoke, wasInstantPriority, instantPriorityPhase } = pending;
    this._pendingSacrificeCast = null;

    // Resume playCard - the card now has _sacrificeCostPaid flag
    this.playCard(pending.cardUid);
  },

  cancelSacrificeCost() {
    this._pendingSacrificeCast = null;
    const gs = this.gameState;
    if (gs) gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  // === Sacrifice Creature as Ability Cost ===

  _renderSacrificeAbilityCostOverlay() {
    const pending = this._pendingSacrificeCostAbility;
    if (!pending) return '';
    const card = this.gameState.players[0].zones.battlefield.get(pending.cardUid);
    if (!card) return '';

    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>Sacrificar criatura</h3>
          <p class="scry-hint">Escolha uma criatura para sacrificar como custo da habilidade de <strong>${card.name}</strong></p>
          <div class="scry-cards">
            ${pending.candidates.map(c => `
              <div class="scry-card scry-keep" onclick="UIGame.confirmSacrificeAbilityCost('${c._uid}')" style="cursor:pointer">
                <img src="${c.image_normal || c.image_small || ''}" alt="${c.name}" style="width:100px;border-radius:6px" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(c) : ''}>
                <div class="scry-card-name">${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})</div>
              </div>
            `).join('')}
          </div>
          <button class="btn" onclick="UIGame.cancelSacrificeAbilityCost()" style="margin-top:8px">Cancelar</button>
        </div>
      </div>
    `;
  },

  confirmSacrificeAbilityCost(creatureUid) {
    const gs = this.gameState;
    const pending = this._pendingSacrificeCostAbility;
    if (!gs || !pending) return;

    // Sacrifice the chosen creature
    GameState.creatureDies(gs, gs.players[0].zones.battlefield.get(creatureUid), 0);
    gs.log.push(`Sacrifica criatura como custo.`);

    // Clear pending and resume ability execution
    const { cardUid, abilityIndex } = pending;
    this._pendingSacrificeCostAbility = null;

    // Resume ability execution
    this._executeAbilityAfterSacrificeChoice(cardUid, abilityIndex);
  },

  cancelSacrificeAbilityCost() {
    this._pendingSacrificeCostAbility = null;
    const gs = this.gameState;
    if (gs) gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  _executeAbilityAfterSacrificeChoice(cardUid, abilityIndex) {
    const gs = this.gameState;
    const card = gs.players[0].zones.battlefield.get(cardUid);
    if (!card) return;

    const abilities = CardEngine.getActivatedAbilities(card);
    if (abilityIndex >= abilities.length) return;

    const ability = abilities[abilityIndex];
    this._executeAbility(card, ability);
    this._actionModal = null;
    this.render();
  },

  // === Discard as Additional Cost ===
  _renderDiscardCostOverlay() {
    const pending = this._pendingDiscardCast;
    if (!pending) return '';
    const selectedSet = new Set(pending.selected);
    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>Descartar ${pending.amount} carta(s)</h3>
          <p class="scry-hint">Escolha ${pending.amount} carta(s) para descartar como custo de <strong>${pending.card.name}</strong> (${pending.selected.length}/${pending.amount} selecionadas)</p>
          <div class="scry-cards">
            ${pending.candidates.map(c => `
              <div class="scry-card ${selectedSet.has(c._uid) ? 'scry-away' : 'scry-keep'}" onclick="UIGame.toggleDiscardCost('${c._uid}')" style="cursor:pointer">
                <img src="${c.image_normal || c.image_small || ''}" alt="${c.name}" style="width:100px;border-radius:6px" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(c) : ''}>
                <div class="scry-card-name">${c.name}${selectedSet.has(c._uid) ? ' [DESCARTAR]' : ''}</div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:center">
            <button class="btn btn-primary" onclick="UIGame.confirmDiscardCost()" ${pending.selected.length !== pending.amount ? 'disabled style="opacity:0.5"' : ''}>Confirmar</button>
            <button class="btn" onclick="UIGame.cancelDiscardCost()">Cancelar</button>
          </div>
        </div>
      </div>
    `;
  },

  toggleDiscardCost(uid) {
    const pending = this._pendingDiscardCast;
    if (!pending) return;
    const idx = pending.selected.indexOf(uid);
    if (idx >= 0) {
      pending.selected.splice(idx, 1);
    } else if (pending.selected.length < pending.amount) {
      pending.selected.push(uid);
    }
    this.render();
  },

  confirmDiscardCost() {
    const gs = this.gameState;
    const pending = this._pendingDiscardCast;
    if (!gs || !pending || pending.selected.length !== pending.amount) return;

    // Discard selected cards
    for (const uid of pending.selected) {
      const discarded = gs.players[0].zones.hand.remove(uid);
      if (discarded) {
        gs.players[0].zones.graveyard.add(discarded);
        gs.log.push(`Voce descarta ${discarded.name} como custo.`);
      }
    }

    // Mark cost as paid and resume
    const card = gs.players[0].zones.hand.get(pending.cardUid);
    if (card) card._discardCostPaid = true;
    this._pendingDiscardCast = null;
    this.playCard(pending.cardUid);
  },

  cancelDiscardCost() {
    this._pendingDiscardCast = null;
    const gs = this.gameState;
    if (gs) gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  // === Tap Creature as Additional Cost ===
  _renderSpellTargetOverlay() {
    const gs = this.gameState;
    if (!gs.stack || gs.stack.length === 0) return '';

    // Filter spells based on targeting requirement
    const targetEffect = this.targetingMode?.effects?.find(e =>
      e.target === 'spell' || e.target === 'creature_spell' || e.target === 'noncreature_spell'
    );
    if (!targetEffect) return '';

    let stackItems = gs.stack;
    if (targetEffect.target === 'creature_spell') {
      stackItems = stackItems.filter(s => CardEngine.isCreature(s.card));
    } else if (targetEffect.target === 'noncreature_spell') {
      stackItems = stackItems.filter(s => !CardEngine.isCreature(s.card));
    }

    if (stackItems.length === 0) return '';

    const cardLabel = this.targetingMode?.card?.name || 'spell';

    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width:600px">
          <h3>Escolha um spell para ${cardLabel}</h3>
          <p class="scry-hint">Clique no spell que deseja anular</p>
          <div class="scry-cards" style="justify-content:center">
            ${stackItems.map((item, idx) => `
              <div class="scry-card scry-keep" onclick="UIGame.selectTarget('spell', ${item.controller}, '${item.card._uid}')" style="cursor:pointer;position:relative">
                <img src="${item.card.image_normal || item.card.image_small}" alt="${item.card.name}" loading="lazy" style="width:100%;border-radius:6px">
                <div class="scry-card-name">${item.card.name}</div>
                <div style="position:absolute;bottom:4px;right:4px;background:#333;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px">
                  ${item.controller === 0 ? 'Você' : 'Oponente'}
                </div>
              </div>
            `).join('')}
          </div>
          <p style="font-size:0.85rem;color:#aaa;margin-top:12px">Clique no spell ou pressione Esc para cancelar</p>
        </div>
      </div>
    `;
  },

  _renderTapCostOverlay() {
    const pending = this._pendingTapCast;
    if (!pending) return '';
    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>Virar uma criatura</h3>
          <p class="scry-hint">Escolha uma criatura para virar como custo de <strong>${pending.card.name}</strong></p>
          <div class="scry-cards">
            ${pending.candidates.map(c => `
              <div class="scry-card scry-keep" onclick="UIGame.confirmTapCost('${c._uid}')" style="cursor:pointer">
                <img src="${c.image_normal || c.image_small || ''}" alt="${c.name}" style="width:100px;border-radius:6px" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(c) : ''}>
                <div class="scry-card-name">${c.name} (${CardEngine.getPower(c)}/${CardEngine.getToughness(c)})</div>
              </div>
            `).join('')}
          </div>
          <button class="btn" onclick="UIGame.cancelTapCost()" style="margin-top:8px">Cancelar</button>
        </div>
      </div>
    `;
  },

  confirmTapCost(creatureUid) {
    const gs = this.gameState;
    const pending = this._pendingTapCast;
    if (!gs || !pending) return;

    // Tap the creature
    const creature = gs.players[0].zones.battlefield.get(creatureUid);
    if (creature) {
      creature._tapped = true;
      gs.log.push(`Voce vira ${creature.name} como custo.`);
    }

    // Mark cost as paid and resume
    const card = gs.players[0].zones.hand.get(pending.cardUid);
    if (card) card._tapCostPaid = true;
    this._pendingTapCast = null;
    this.playCard(pending.cardUid);
  },

  cancelTapCost() {
    this._pendingTapCast = null;
    const gs = this.gameState;
    if (gs) gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
  },

  _renderScryOverlay(pending) {
    const isSurveil = pending.type === 'surveil';
    const title = isSurveil ? 'Surveil' : 'Scry';
    const destLabel = isSurveil ? 'Cemiterio' : 'Fundo';

    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>${title} ${pending.cards.length}</h3>
          <p class="scry-hint">Clique para alternar entre <strong>Topo</strong> e <strong>${destLabel}</strong></p>
          <div class="scry-cards">
            ${pending.cards.map((card, i) => {
              const choice = pending.choices[i];
              const isTop = choice === 'top';
              return `
                <div class="scry-card ${isTop ? 'scry-keep' : 'scry-away'}" onclick="UIGame.toggleScryCard(${i})">
                  <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                  <div class="scry-card-label ${isTop ? 'label-top' : 'label-away'}">
                    ${isTop ? '&#9650; Topo' : (isSurveil ? '&#9760; Cemiterio' : '&#9660; Fundo')}
                  </div>
                  <div class="scry-card-name">${card.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          <button class="btn btn-primary" onclick="UIGame.confirmScry()">Confirmar</button>
        </div>
      </div>
    `;
  },

  _renderGYReturnOverlay(pending) {
    const { candidates, amount, toTopLibrary, toHand } = pending;
    const dest = toTopLibrary ? 'topo da biblioteca' : 'mao';
    const selected = pending._selectedUid || null;

    return `
      <div class="scry-overlay" style="align-items:center;">
        <div class="scry-box" style="max-width:600px;">
          <h3>Recuperar do Cemiterio</h3>
          <p class="scry-hint">Escolha ate <strong>${amount}</strong> carta para o <strong>${dest}</strong>, ou pule.</p>
          <div class="scry-cards" style="max-height:50vh; overflow-y:auto;">
            ${candidates.map(card => {
              const isSel = selected === card._uid;
              const imgSrc = card.image_small || card.image_normal || '';
              const hasImg = imgSrc && !imgSrc.includes('undefined');
              return `
                <div class="scry-card ${isSel ? 'scry-keep' : 'scry-away'}" onclick="UIGame.toggleGYReturnCard('${card._uid}')" style="width:120px;">
                  ${hasImg
                    ? `<img src="${imgSrc}" alt="${card.name}" style="width:100%; display:block; border-radius:8px;" ${CardZoom.attr(card)}>`
                    : `<div style="width:100%; height:168px; background:#1a1a2e; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:8px; font-size:0.7rem; color:#ccc; text-align:center;">${card.name}</div>`
                  }
                  <div class="scry-card-label ${isSel ? 'label-top' : 'label-away'}">
                    ${isSel ? '&#9650; Escolhida' : '&mdash;'}
                  </div>
                  <div class="scry-card-name">${card.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          <div style="display:flex; gap:8px; justify-content:center; margin-top:8px;">
            <button class="btn btn-primary" onclick="UIGame.confirmGYReturn()" ${!selected ? 'disabled' : ''}>Confirmar</button>
            <button class="btn btn-secondary" onclick="UIGame.skipGYReturn()">Pular</button>
          </div>
        </div>
      </div>
    `;
  },

  toggleGYReturnCard(uid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingGYReturn) return;
    const pending = gs._pendingGYReturn;
    // Toggle selection
    pending._selectedUid = (pending._selectedUid === uid) ? null : uid;
    this.render();
  },

  confirmGYReturn() {
    const gs = this.gameState;
    if (!gs || !gs._pendingGYReturn) return;
    const pending = gs._pendingGYReturn;
    const selectedUid = pending._selectedUid;
    if (!selectedUid) return;

    const { toTopLibrary, toHand, controller } = pending;
    const gy = gs.players[controller].zones.graveyard;
    const card = gy.get(selectedUid);
    if (!card) return;

    // Remove from graveyard
    gy.remove(selectedUid);

    // Fire trigger when card leaves graveyard
    GameState.fireTrigger(gs, 'card_leaves_graveyard', { playerId: controller, card });

    if (toTopLibrary) {
      gs.players[controller].zones.library.cards.unshift(card);
      gs.log.push(`${card.name} volta do cemiterio para o topo da biblioteca.`);
    } else if (toHand !== false) {
      gs.players[controller].zones.hand.add(card);
      gs.log.push(`${card.name} volta do cemiterio para a mao.`);
    }

    // Clean up
    gs._pendingGYReturn = null;
    gs.waitingForInput = null;

    // Resume pending stack effects if any
    this._resumeAfterGYReturn(gs);
  },

  skipGYReturn() {
    const gs = this.gameState;
    if (!gs || !gs._pendingGYReturn) return;
    gs.log.push('Optou por nao recuperar carta do cemiterio.');
    gs._pendingGYReturn = null;
    gs.waitingForInput = null;

    // Resume pending stack effects if any
    this._resumeAfterGYReturn(gs);
  },

  _resumeAfterGYReturn(gs) {
    // Resume pending stack effects (other ETB effects after this one)
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }
    this.render();
    GameState._continueIfAI(gs);
  },

  _renderLookTopOverlay(pending) {
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.choices.filter(c => c === 'hand').length;
    const remainingPicks = pickCount - selectedCount;

    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>Escolher ${pickCount} para a Mão</h3>
          <p class="scry-hint">Escolha <strong>${remainingPicks}</strong> carta(s) para ir para a <strong>Mão</strong>. As demais irão para o <strong>Cemitério</strong>.</p>
          <div class="scry-cards">
            ${pending.cards.map((card, i) => {
              const choice = pending.choices[i];
              const isHand = choice === 'hand';
              return `
                <div class="scry-card ${isHand ? 'scry-keep' : 'scry-away'}" onclick="UIGame.toggleLookTopCard(${i})">
                  <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                  <div class="scry-card-label ${isHand ? 'label-top' : 'label-away'}">
                    ${isHand ? '✋ Mão' : '⚰️ Cemitério'}
                  </div>
                  <div class="scry-card-name">${card.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          <button class="btn btn-primary" onclick="UIGame.confirmLookTop()" ${remainingPicks !== 0 ? 'disabled' : ''}>
            Confirmar${remainingPicks > 0 ? ` (escolha mais ${remainingPicks})` : ''}
          </button>
        </div>
      </div>
    `;
  },

  _renderLookTopLandOverlay(pending) {
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.selected ? pending.selected.length : 0;
    const remainingPicks = pickCount - selectedCount;
    const allCards = [...(pending.lands || []), ...(pending.nonLands || [])];

    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>🌍 Revelar Terrenos</h3>
          <p class="scry-hint">Escolha até <strong>${pickCount}</strong> terreno(s) para ir para a <strong>Mão</strong>. Os demais irão para o <strong>Fundo</strong>.</p>
          <div class="scry-cards">
            ${allCards.map((card) => {
              const isLand = pending.lands.includes(card);
              const isSelected = pending.selected.includes(card.uid);
              return `
                <div class="scry-card ${isSelected ? 'scry-keep' : 'scry-away'} ${!isLand ? 'scry-nonland' : ''}"
                     onclick="${isLand ? `UIGame.toggleLookTopLandCard('${card.uid}')` : ''}"
                     style="${!isLand ? 'opacity:0.6;cursor:default' : 'cursor:pointer'}">
                  <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                  <div class="scry-card-label ${isSelected ? 'label-top' : 'label-away'}">
                    ${isSelected ? '✋ Mão' : (isLand ? '🌍 Fundo' : '📋 Não-terra')}
                  </div>
                  <div class="scry-card-name">${card.name}</div>
                </div>
              `;
            }).join('')}
          </div>
          <button class="btn btn-primary" onclick="UIGame.confirmLookTopLand()">
            Confirmar (${selectedCount} terreno(s))
          </button>
        </div>
      </div>
    `;
  },

  _renderLookTopPermanentOverlay(pending) {
    const putCount = pending.putCount || 0;
    const selectedCount = (pending.selected || []).length;
    const remainingSelections = putCount - selectedCount;

    return `
      <div class="scry-overlay">
        <div class="scry-box">
          <h3>⚔️ Revelar Permanentes</h3>
          <p class="scry-hint">Escolha até <strong>${putCount}</strong> permanente(s) nao-criatura nao-terreno (CMC ≤ 3) para colocar no campo. Os demais irão para o fundo.</p>
          <div class="scry-cards">
            ${pending.cards.map((card, idx) => {
              const isCandidate = pending.candidates.includes(card);
              const isSelected = pending.selected.includes(card._uid || card.id || idx);
              return `
                <div class="scry-card ${isSelected ? 'scry-keep' : 'scry-away'} ${!isCandidate ? 'scry-nonland' : ''}"
                     onclick="UIGame.toggleLookTopPermanent(${idx})"
                     style="${!isCandidate ? 'opacity:0.5;cursor:not-allowed' : 'cursor:pointer'}">
                  <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                  <div class="scry-card-label ${isSelected ? 'label-top' : 'label-away'}">
                    ${isSelected ? '✋ Campo' : isCandidate ? '❌ Fundo' : '⚠️ Inelegivel'}
                  </div>
                  <div class="scry-card-name">${card.name}</div>
                  <div class="scry-card-type" style="font-size:10px;color:#aaa">${card.type_line || ''}</div>
                </div>
              `;
            }).join('')}
          </div>
          <button class="btn btn-primary" onclick="UIGame.confirmLookTopPermanent()" ${remainingSelections < 0 ? 'disabled' : ''}>
            Confirmar${selectedCount < putCount ? ` (${selectedCount}/${putCount})` : ''}
          </button>
        </div>
      </div>
    `;
  },

  toggleScryCard(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingScry) return;
    const pending = gs._pendingScry;
    pending.choices[index] = pending.choices[index] === 'top' ? 'away' : 'top';
    this.render();
  },

  confirmScry() {
    const gs = this.gameState;
    if (!gs || !gs._pendingScry) return;

    const pending = gs._pendingScry;
    const lib = gs.players[pending.playerId].zones.library;
    const isSurveil = pending.type === 'surveil';

    const keepCards = [];
    const awayCards = [];

    pending.cards.forEach((card, i) => {
      if (pending.choices[i] === 'top') {
        keepCards.push(card);
      } else {
        awayCards.push(card);
      }
    });

    for (const c of keepCards.reverse()) {
      lib.addToTop(c);
    }

    if (isSurveil) {
      const gy = gs.players[pending.playerId].zones.graveyard;
      for (const c of awayCards) {
        gy.add(c);
      }
      gs.log.push(`Surveil: ${keepCards.length} no topo, ${awayCards.length} pro cemiterio.`);
    } else {
      for (const c of awayCards) {
        lib.addToBottom(c);
      }
      gs.log.push(`Scry: ${keepCards.length} no topo, ${awayCards.length} no fundo.`);
    }

    gs._pendingScry = null;
    gs.waitingForInput = null;

    // Resume pending stack effects (e.g., surveil 2 → draw 2 on Cruel Truths)
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  toggleLookTopCard(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.choices.filter(c => c === 'hand').length;

    if (pending.choices[index] === 'hand') {
      // Deselecting a card for hand
      pending.choices[index] = 'graveyard';
    } else {
      // Selecting a card for hand (only if we haven't reached the limit)
      if (selectedCount < pickCount) {
        pending.choices[index] = 'hand';
      }
    }

    this.render();
  },

  toggleLookTopLandCard(cardUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.selected ? pending.selected.length : 0;

    const idx = pending.selected.indexOf(cardUid);
    if (idx >= 0) {
      // Card is already selected, deselect it
      pending.selected.splice(idx, 1);
    } else {
      // Card is not selected, select it (only if under limit)
      if (selectedCount < pickCount) {
        pending.selected.push(cardUid);
      }
    }

    this.render();
  },

  confirmLookTop() {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.choices.filter(c => c === 'hand').length;

    // Must select exactly the right number of cards
    if (selectedCount !== pickCount) return;

    const handCards = [];
    const graveyardCards = [];

    pending.cards.forEach((card, i) => {
      if (pending.choices[i] === 'hand') {
        handCards.push(card);
      } else {
        graveyardCards.push(card);
      }
    });

    // Add cards to appropriate zones
    const player = gs.players[pending.playerId];
    handCards.forEach(c => {
      player.zones.hand.add(c);
      gs.log.push(`${c.name} vai para a mao.`);
    });
    graveyardCards.forEach(c => {
      player.zones.graveyard.add(c);
    });

    if (graveyardCards.length > 0) {
      gs.log.push(`${graveyardCards.length} carta(s) vao para o cemiterio.`);
    }

    gs._pendingLookTop = null;
    gs.waitingForInput = null;

    // Resume pending stack effects if any
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }

    const isMainPhaseAfterLookTop = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhaseAfterLookTop && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  confirmLookTopLand() {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const pickCount = pending.pickCount || 1;
    const selectedCount = pending.selected ? pending.selected.length : 0;

    const handCards = [];
    const bottomCards = [];

    // Process selected lands to hand
    pending.lands.forEach(land => {
      if (pending.selected.includes(land.uid)) {
        handCards.push(land);
      } else {
        bottomCards.push(land);
      }
    });

    // Add non-land cards to bottom
    if (pending.nonLands) {
      bottomCards.push(...pending.nonLands);
    }

    // Add cards to appropriate zones
    const player = gs.players[pending.playerId];
    const lib = player.zones.library;

    handCards.forEach(c => {
      player.zones.hand.add(c);
      gs.log.push(`${c.name} (terreno) vai para a mao.`);
    });

    bottomCards.forEach(c => lib.addToBottom(c));

    if (bottomCards.length > 0) {
      gs.log.push(`${bottomCards.length} carta(s) vao para o fundo do grimorio.`);
    }

    gs._pendingLookTop = null;
    gs.waitingForInput = null;

    // Resume pending stack effects if any
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }

    const isMainPhaseAfterLookTop = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhaseAfterLookTop && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  toggleLookTopPermanent(index) {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const putCount = pending.putCount || 0;
    const card = pending.cards[index];
    const isCandidate = pending.candidates.includes(card);

    if (!isCandidate) return; // Can't select non-candidates

    const idx = pending.selected.indexOf(card._uid || card.id || index);
    if (idx >= 0) {
      // Card is already selected, deselect it
      pending.selected.splice(idx, 1);
    } else {
      // Card is not selected, select it (only if under limit and is candidate)
      if (pending.selected.length < putCount) {
        pending.selected.push(card._uid || card.id || index);
      }
    }

    this.render();
  },

  confirmLookTopPermanent() {
    const gs = this.gameState;
    if (!gs || !gs._pendingLookTop) return;

    const pending = gs._pendingLookTop;
    const putCount = pending.putCount || 0;

    // Get selected permanent cards to put on battlefield
    const toBfCards = pending.candidates.filter(c =>
      pending.selected.includes(c._uid || c.id || pending.cards.indexOf(c))
    );

    // Get all other cards (rest go to bottom)
    const toBottomCards = pending.cards.filter(c => !toBfCards.includes(c));

    // Add cards to appropriate zones
    const player = gs.players[pending.playerId];
    const bf = player.zones.battlefield;
    const lib = player.zones.library;

    // Place selected permanents on battlefield
    toBfCards.forEach(c => {
      bf.add(c);
      gs.log.push(`${c.name} entra no campo.`);
    });

    // Shuffle remaining cards to bottom of library
    const shuffled = toBottomCards.sort(() => Math.random() - 0.5);
    shuffled.forEach(c => lib.addToBottom(c));

    if (shuffled.length > 0) {
      gs.log.push(`${shuffled.length} carta(s) vao para o fundo do grimorio.`);
    }

    gs._pendingLookTop = null;
    gs.waitingForInput = null;

    // Resume pending stack effects if any
    if (gs._pendingStackEffects) {
      const pendingStack = gs._pendingStackEffects;
      gs._pendingStackEffects = null;
      const resumeLog = GameStack._resolveItem(
        { card: pendingStack.card, controller: pendingStack.controller, targets: pendingStack.targets, effects: pendingStack.effects },
        gs
      );
      gs.log.push(...resumeLog);
    }

    const isMainPhaseAfterLookTop = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhaseAfterLookTop && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  // ========== RAMP LAND CHOICE ==========

  _renderRampOverlay(pending) {
    const lands = pending.lands || [];
    const dest = pending.toTop ? 'topo do grimorio' : pending.toHand ? 'mao' : pending.toBattlefield ? 'campo de batalha virado' : 'campo de batalha';
    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width:600px">
          <h3>Buscar Terreno</h3>
          <p class="scry-hint">Escolha qual terreno basico buscar (vai para ${dest})</p>
          <div class="scry-cards" style="justify-content:center">
            ${lands.map(land => `
              <div class="scry-card scry-keep" onclick="UIGame.confirmRampChoice('${land._uid}')"
                   style="cursor:pointer">
                <img src="${land.image_normal || land.image_small}" alt="${land.name}" ${CardZoom.attr(land)}>
                <div class="scry-card-name">${land.name}</div>
              </div>
            `).join('')}
          </div>
          ${pending.optional ? `<div style="text-align:center;margin-top:12px">
            <button class="btn btn-secondary" onclick="UIGame.confirmRampChoice(null)" style="font-size:0.85rem">Nao buscar</button>
          </div>` : ''}
        </div>
      </div>
    `;
  },

  _renderSearchOverlay(pending) {
    const candidates = pending.candidates || [];
    const dest = pending.toTop ? 'topo do grimorio' : pending.toHand ? 'mao' : pending.toBattlefield ? (pending.tapped ? 'campo de batalha virado' : 'campo de batalha') : 'mao';
    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width:700px">
          <h3>Buscar na Biblioteca</h3>
          <p class="scry-hint">Escolha uma carta${pending.optional ? ' (ou decline)' : ''} (vai para ${dest})</p>
          <div class="scry-cards" style="justify-content:center">
            ${candidates.map(card => {
              const hasImage = card.image_normal || card.image_small;
              if (hasImage) {
                return `
                  <div class="scry-card scry-keep" onclick="UIGame.confirmSearchChoice('${card._uid}')" style="cursor:pointer">
                    <img src="${card.image_normal || card.image_small}" alt="${card.name}" ${CardZoom.attr(card)}>
                    <div class="scry-card-name">${card.name}</div>
                  </div>
                `;
              } else {
                // Fallback: show card info as text box
                const manaCost = card.mana_cost || '';
                const typeLine = card.type_line || 'Unknown';
                const oracleText = (card.oracle_text || '').substring(0, 80) + (card.oracle_text && card.oracle_text.length > 80 ? '...' : '');
                return `
                  <div class="scry-card scry-keep" onclick="UIGame.confirmSearchChoice('${card._uid}')"
                       style="cursor:pointer; width:140px; height:200px; background:#1a1a1a; border:2px solid #444; border-radius:8px; padding:8px; display:flex; flex-direction:column; justify-content:space-between">
                    <div>
                      <div style="font-weight:bold; font-size:0.85rem; margin-bottom:4px">${card.name}</div>
                      <div style="font-size:0.7rem; color:#888; margin-bottom:4px">${manaCost}</div>
                      <div style="font-size:0.7rem; color:#aaa; border-top:1px solid #333; padding-top:4px; margin-bottom:4px">${typeLine}</div>
                      <div style="font-size:0.65rem; color:#bbb; font-style:italic">${oracleText}</div>
                    </div>
                  </div>
                `;
              }
            }).join('')}
          </div>
          ${pending.optional ? `<div style="text-align:center;margin-top:12px">
            <button class="btn btn-secondary" onclick="UIGame.confirmSearchChoice(null)" style="font-size:0.85rem">Declinar</button>
          </div>` : ''}
        </div>
      </div>
    `;
  },

  _renderHandExileOverlay(pending) {
    const cards = pending.cards || [];
    return `
      <div class="scry-overlay">
        <div class="scry-box" style="max-width:700px">
          <h3>Aggressive Negotiations</h3>
          <p class="scry-hint">Escolha uma carta não-terreno da sua mão para exilar</p>
          <div class="scry-cards">
            ${cards.map(card => `
              <div class="scry-card scry-keep" onclick="UIGame.selectHandExileTarget('${card._uid}')" style="cursor:pointer">
                <img src="${card.image_normal || card.image_small || ''}" alt="${card.name}" style="width:100px;border-radius:6px" ${typeof CardZoom !== 'undefined' ? CardZoom.attr(card) : ''}>
                <div class="scry-card-name">${card.name}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  confirmRampChoice(landUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingRamp) return;

    const pending = gs._pendingRamp;
    const pid = pending.playerId;
    const lib = gs.players[pid].zones.library;
    const bf = gs.players[pid].zones.battlefield;

    if (landUid === null) {
      // Optional: chose not to search
      lib.shuffle();
      gs.log.push(`Voce escolheu nao buscar terreno.`);
    } else {
      const landIdx = lib.cards.findIndex(c => c._uid === landUid);
      if (landIdx !== -1) {
        const land = lib.cards.splice(landIdx, 1)[0];
        if (pending.toHand) {
          gs.players[pid].zones.hand.add(land);
          lib.shuffle();
          gs.log.push(`Voce busca ${land.name} da biblioteca para a mao.`);
        } else if (pending.toTop) {
          lib.cards.unshift(land);
          gs.log.push(`Voce busca ${land.name} e coloca no topo do grimorio.`);
        } else if (pending.toBattlefield) {
          const bfLand = CardEngine.prepareForBattlefield(land);
          bfLand._tapped = true;
          bfLand._summoningSick = false;
          bf.add(bfLand);
          lib.shuffle();
          gs.log.push(`Voce busca ${land.name} e coloca no campo virado.`);
        } else {
          const bfLand = CardEngine.prepareForBattlefield(land);
          bfLand._tapped = pending.tapped || false;
          bfLand._summoningSick = false;
          bf.add(bfLand);
          lib.shuffle();
          gs.log.push(`Voce busca ${land.name} da biblioteca${pending.tapped ? ' (virado)' : ''}.`);
        }
      }
    }

    gs._pendingRamp = null;
    gs.waitingForInput = null;

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  confirmSearchChoice(cardUid) {
    const gs = this.gameState;
    if (!gs || !gs._pendingSearch) return;

    const pending = gs._pendingSearch;
    const pid = pending.controller;
    const lib = gs.players[pid].zones.library;
    const bf = gs.players[pid].zones.battlefield;

    if (cardUid === null) {
      // Optional: chose not to search
      lib.shuffle();
      gs.log.push(`Voce escolheu declinar a busca.`);
    } else {
      const cardIdx = lib.cards.findIndex(c => c._uid === cardUid);
      if (cardIdx !== -1) {
        const card = lib.cards.splice(cardIdx, 1)[0];
        if (pending.toHand) {
          gs.players[pid].zones.hand.add(card);
          lib.shuffle();
          gs.log.push(`Voce busca ${card.name} da biblioteca para a mao.`);
        } else if (pending.toTop) {
          lib.cards.unshift(card);
          // Don't shuffle - goes on top
          gs.log.push(`Voce busca ${card.name} e coloca no topo do grimorio.`);
        } else if (pending.toBattlefield) {
          const bfCard = CardEngine.prepareForBattlefield(card);
          bfCard._tapped = pending.tapped || false;
          bfCard._summoningSickness = false; // Lands don't have summoning sickness
          bfCard._ownerId = pid;
          bf.add(bfCard);
          GameState._registerCardTriggers(gs, bfCard, pid);
          lib.shuffle();
          gs.log.push(`Voce busca ${card.name} e coloca no campo${pending.tapped ? ' virado' : ''}.`);
        } else {
          // Default: to hand
          gs.players[pid].zones.hand.add(card);
          lib.shuffle();
          gs.log.push(`Voce busca ${card.name} da biblioteca.`);
        }
      }
    }

    gs._pendingSearch = null;
    gs.waitingForInput = null;

    const isMainPhase = gs.phase === 'main1' || gs.phase === 'main2';
    if (isMainPhase && gs.activePlayer === 0) {
      gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    }

    this.render();
    this._continueIfAI();
  },

  // ========== MANA PREVIEW ==========

  _manaPreviewLands: null, // Set of land UIDs to highlight

  showManaPreview(cardUid, manaCost, cmc) {
    const gs = this.gameState;
    if (!gs) return;
    const wouldTap = GameState.previewAutoTap(gs, 0, manaCost, cmc);
    this._manaPreviewLands = new Set(wouldTap);

    // Add active class to land container for dimming non-tapped lands
    const landsCol = document.querySelector('.game-my-bf .bf-lands-col');
    if (landsCol) {
      landsCol.classList.add('mana-preview-active');
      landsCol.style.position = 'relative'; // for badge positioning
    }

    // Highlight lands without full re-render
    document.querySelectorAll('.bf-land').forEach(el => {
      const uid = el.getAttribute('data-uid');
      if (uid && this._manaPreviewLands.has(uid)) {
        el.classList.add('mana-preview-tap');
      }
    });

    // Show mana cost badge
    if (landsCol && manaCost) {
      this._showManaCostBadge(landsCol, manaCost);
    }
  },

  hideManaPreview() {
    this._manaPreviewLands = null;
    document.querySelectorAll('.bf-land.mana-preview-tap').forEach(el => {
      el.classList.remove('mana-preview-tap');
    });
    const landsCol = document.querySelector('.game-my-bf .bf-lands-col');
    if (landsCol) {
      landsCol.classList.remove('mana-preview-active');
      const badge = landsCol.querySelector('.mana-preview-badge');
      if (badge) badge.remove();
    }
  },

  _showManaCostBadge(container, manaCost) {
    // Remove existing badge
    const old = container.querySelector('.mana-preview-badge');
    if (old) old.remove();

    // Parse mana cost string like "{2}{W}{W}" into pip elements
    const symbols = manaCost.match(/\{([^}]+)\}/g);
    if (!symbols || symbols.length === 0) return;

    const badge = document.createElement('div');
    badge.className = 'mana-preview-badge';

    for (const sym of symbols) {
      const val = sym.replace(/[{}]/g, '');
      const pip = document.createElement('span');
      pip.className = 'mana-pip';
      pip.textContent = val;

      // Color class
      const colorMap = { W: 'mana-w', U: 'mana-u', B: 'mana-b', R: 'mana-r', G: 'mana-g', C: 'mana-c' };
      if (colorMap[val]) {
        pip.classList.add(colorMap[val]);
      } else {
        // Generic/numeric mana
        pip.style.background = 'linear-gradient(145deg, #888, #555)';
        pip.style.color = '#fff';
        pip.style.borderColor = '#999';
      }
      badge.appendChild(pip);
    }

    container.appendChild(badge);
  },

  // ========== AI ACTION NOTIFICATION OVERLAY ==========

  _renderAIActionOverlay() {
    const action = this._showingAIAction;
    if (!action) return '';

    let cardImgHtml = '';
    let actionIcon = '🧙';
    let actionTitle = '';
    let detailHtml = '';

    if (action.type === 'cast') {
      actionIcon = '🪄';
      actionTitle = 'Oponente conjura';
      const card = action.card;
      const imgSrc = card.image_normal || card.image_small || '';
      cardImgHtml = imgSrc ? `<img src="${imgSrc}" alt="${card.name}" class="ai-action-card-img">` : '';
      detailHtml = `
        <div class="ai-action-card-name">${card.name}</div>
        <div class="ai-action-card-type">${card.type_line || ''}</div>
        ${action.targetDesc ? `<div class="ai-action-target">Alvo: <strong>${action.targetDesc.replace(' em ', '')}</strong></div>` : ''}
      `;
    } else if (action.type === 'attack') {
      actionIcon = '⚔️';
      actionTitle = `Oponente ataca com ${action.attackers.length} criatura(s)`;
      cardImgHtml = `<div class="ai-action-attackers">${action.attackers.map(a => {
        const img = a.image_normal || a.image_small || '';
        const aName = a.name || 'Criatura';
        const aPow = CardEngine.getPower ? CardEngine.getPower(a) : (a.power != null ? a.power : '?');
        const aTou = CardEngine.getToughness ? CardEngine.getToughness(a) : (a.toughness != null ? a.toughness : '?');
        return `<div class="ai-action-attacker">
          ${img ? `<img src="${img}" alt="${aName}" class="ai-action-attacker-img">` : `<span>${aName}</span>`}
          <div class="ai-action-attacker-stats">${aPow}/${aTou}</div>
        </div>`;
      }).join('')}</div>`;
    } else if (action.type === 'end_step_pause') {
      actionIcon = '⏸️';
      actionTitle = 'Fim do turno do Oponente';
      detailHtml = `<div class="ai-action-card-type">End Step — Sua prioridade para jogar instants</div>`;
    }

    return `
      <div class="ai-action-overlay" onclick="UIGame.dismissAIAction()">
        <div class="ai-action-box" onclick="event.stopPropagation()">
          <div class="ai-action-header">
            <span class="ai-action-icon">${actionIcon}</span>
            <span class="ai-action-title">${actionTitle}</span>
          </div>
          <div class="ai-action-body">
            ${cardImgHtml}
            ${detailHtml}
          </div>
          <button class="btn btn-primary ai-action-ok" onclick="UIGame.dismissAIAction()">
            OK <kbd>Space</kbd>
          </button>
        </div>
      </div>
    `;
  },

  _continueIfAI() {
    const gs = this.gameState;
    if (!gs || gs.winner !== null) return;

    // DEBUG LOGS
    console.log(`[DEBUG] _continueIfAI called - activePlayer: ${gs.activePlayer}, phase: ${gs.phase}, waitingForInput:`, gs.waitingForInput);

    // If there are pending AI actions to show, display next one
    if (gs._aiActions && gs._aiActions.length > 0) {
      console.log(`[DEBUG] Showing AI action:`, gs._aiActions[0]);
      this._showingAIAction = gs._aiActions.shift();
      this._aiThinking = false;
      this.render();
      return;
    }

    // If showing an action, don't continue
    if (this._showingAIAction) return;

    // Process AI turns and phases without waitingForInput
    if (!gs.waitingForInput) {
      console.log(`[DEBUG] Processing phase for activePlayer ${gs.activePlayer}`);
      this._aiThinking = false;
      if (!gs._aiActions) gs._aiActions = [];
      GameState._processPhase(gs);

      // Show AI actions if any
      if (gs._aiActions && gs._aiActions.length > 0) {
        this._showingAIAction = gs._aiActions.shift();
        this.render();
        return;
      }

      this.render();
      return;
    }

    // Process AI input when it's AI's turn to respond
    if (gs.waitingForInput && gs.waitingForInput.playerId !== 0) {
      console.log(`[DEBUG] Processing AI input:`, gs.waitingForInput);
      this._aiThinking = false;
      gs.waitingForInput = null;
      if (!gs._aiActions) gs._aiActions = [];
      GameState._processPhase(gs);

      // Show AI actions if any
      if (gs._aiActions && gs._aiActions.length > 0) {
        this._showingAIAction = gs._aiActions.shift();
        this.render();
        return;
      }

      this.render();
    }
  },

  dismissAIAction() {
    this._showingAIAction = null;
    const gs = this.gameState;

    // If more actions queued, show next
    if (gs && gs._aiActions && gs._aiActions.length > 0) {
      this._showingAIAction = gs._aiActions.shift();
      this.render();
      return;
    }

    // Continue game
    this.render();
    this._continueIfAI();
  },

  // =================== Toast Notifications ===================

  showToast(message, type = 'info', duration = 2300) {
    let container = document.getElementById('game-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'game-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `game-toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), duration);
  },

  // =================== Visual Config (Playmat & Sleeves) ===================

  _getPlaymatClass() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      if (prefs.playmat === 'custom' && prefs.playmatArt && prefs.playmatArt.art_crop) {
        return 'playmat-custom';
      }
      return prefs.playmat && prefs.playmat !== 'default' ? `playmat-${prefs.playmat}` : '';
    } catch { return ''; }
  },

  _getPlaymatArtUrl() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      return (prefs.playmatArt && prefs.playmatArt.art_crop) || '';
    } catch { return ''; }
  },

  _getSleeveClass() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      if (prefs.sleeve === 'custom' && prefs.sleeveArt && prefs.sleeveArt.art_crop) {
        return 'sleeve-custom';
      }
      return prefs.sleeve && prefs.sleeve !== 'default' ? `sleeve-${prefs.sleeve}` : '';
    } catch { return ''; }
  },

  _getSleeveArtUrl() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      return (prefs.sleeveArt && prefs.sleeveArt.art_crop) || '';
    } catch { return ''; }
  },

  showVisualConfig() {
    const existing = document.querySelector('.visual-config-overlay');
    if (existing) { existing.remove(); return; }

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    const currentPlaymat = prefs.playmat || 'default';
    const currentSleeve = prefs.sleeve || 'default';
    const currentTheme = prefs.theme || 'planeswalker';

    const themes = [
      { id: 'planeswalker', label: 'Spark' },
      { id: 'nyx', label: 'Nyx' },
      { id: 'phyrexian', label: 'Phyrexia' },
      { id: 'kamigawa', label: 'Kamigawa' },
      { id: 'obscura', label: 'Obscura' },
    ];

    const playmats = [
      { id: 'default', label: 'Padrão' },
      { id: 'forest', label: 'Floresta' },
      { id: 'ocean', label: 'Oceano' },
      { id: 'mountain', label: 'Montanha' },
      { id: 'plains', label: 'Planície' },
      { id: 'swamp', label: 'Pântano' },
      { id: 'nyx', label: 'Nyx' },
    ];

    const sleeves = [
      { id: 'default', label: 'Padrão' },
      { id: 'gold', label: 'Ouro' },
      { id: 'silver', label: 'Prata' },
      { id: 'fire', label: 'Fogo' },
      { id: 'ice', label: 'Gelo' },
      { id: 'nature', label: 'Natureza' },
      { id: 'dark', label: 'Sombra' },
      { id: 'ruby', label: 'Rubi' },
    ];

    const themeGrid = themes.map(t =>
      `<div class="theme-option theme-opt-${t.id} ${currentTheme === t.id ? 'selected' : ''}"
            onclick="UIGame._setTheme('${t.id}')">
        <span class="theme-label">${t.label}</span>
      </div>`
    ).join('');

    const playmatGrid = playmats.map(p =>
      `<div class="visual-option playmat-opt-${p.id} ${currentPlaymat === p.id && !prefs.playmatArt ? 'selected' : ''}"
            onclick="UIGame._setPlaymat('${p.id}')">
        <span class="option-label">${p.label}</span>
      </div>`
    ).join('') + `
      <div class="visual-option playmat-opt-custom ${prefs.playmatArt ? 'selected' : ''}"
           onclick="UIGame._showPlaymatArtSearch()"
           ${prefs.playmatArt ? `style="background:url('${prefs.playmatArt.art_crop}') center/cover"` : ''}>
        <span class="option-label">${prefs.playmatArt ? prefs.playmatArt.name.slice(0,8) : 'Arte'}</span>
      </div>`;

    const sleeveGrid = sleeves.map(s =>
      `<div class="visual-option sleeve-opt-${s.id} ${currentSleeve === s.id ? 'selected' : ''}"
            onclick="UIGame._setSleeve('${s.id}')">
        <span class="option-label">${s.label}</span>
      </div>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'visual-config-overlay';
    overlay.innerHTML = `
      <div class="visual-config-modal">
        <h3>Personalizar Visuais</h3>
        <div class="visual-config-section">
          <label>Tema</label>
          <div class="theme-options-row" id="theme-grid">${themeGrid}</div>
        </div>
        <div class="visual-config-section">
          <label>Playmat</label>
          <div class="visual-config-grid" id="playmat-grid">${playmatGrid}</div>
        </div>
        <div class="visual-config-section">
          <label>Sleeves</label>
          <div class="visual-config-grid" id="sleeve-grid">${sleeveGrid}</div>
        </div>
        <button class="visual-config-close" onclick="document.querySelector('.visual-config-overlay').remove()">Fechar</button>
      </div>
    `;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },

  _setPlaymat(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.playmat = id;
    delete prefs.playmatArt;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    // Update selection UI
    document.querySelectorAll('#playmat-grid .visual-option').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.playmat-opt-${id}`)?.classList.add('selected');
    // Apply immediately
    this.render();
  },

  _showPlaymatArtSearch() {
    // Close visual config overlay, open search overlay
    document.querySelector('.visual-config-overlay')?.remove();
    DeckBuilder.showPlaymatArtPicker();
  },

  _setSleeve(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.sleeve = id;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    // Update selection UI
    document.querySelectorAll('#sleeve-grid .visual-option').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.sleeve-opt-${id}`)?.classList.add('selected');
    // Apply immediately
    this.render();
  },

  _setTheme(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.theme = id;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    // Remove old theme classes from body
    document.body.classList.remove('theme-planeswalker', 'theme-nyx', 'theme-phyrexian', 'theme-kamigawa', 'theme-obscura');
    // Add new theme class (default = no class)
    if (id !== 'default') {
      document.body.classList.add('theme-' + id);
    }
    // Update selection UI
    document.querySelectorAll('#theme-grid .theme-option').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.theme-opt-${id}`)?.classList.add('selected');
  },

  restartGame() {
    const confirmRestart = confirm('Deseja realmente reiniciar a partida? Você irá começar com uma nova mão.');
    if (!confirmRestart) return;

    // Reset the game state for a fresh start
    const currentDecks = {
      player: this.gameState.players[0]._originalDeck || [],
      opponent: this.gameState.players[1]._originalDeck || []
    };

    // Store original decks if not already stored
    if (!this.gameState.players[0]._originalDeck) {
      currentDecks.player = [...this.gameState.players[0].zones.library.cards, ...this.gameState.players[0].zones.hand.cards, ...this.gameState.players[0].zones.battlefield.cards, ...this.gameState.players[0].zones.graveyard.cards, ...this.gameState.players[0].zones.exile.cards];
    }
    if (!this.gameState.players[1]._originalDeck) {
      currentDecks.opponent = [...this.gameState.players[1].zones.library.cards, ...this.gameState.players[1].zones.hand.cards, ...this.gameState.players[1].zones.battlefield.cards, ...this.gameState.players[1].zones.graveyard.cards, ...this.gameState.players[1].zones.exile.cards];
    }

    // Call App.startGame with the current decks to restart
    App.startGame(currentDecks.player, currentDecks.opponent);
  },

  _applyTheme() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      const theme = prefs.theme || 'planeswalker';
      document.body.classList.remove('theme-planeswalker', 'theme-nyx', 'theme-phyrexian', 'theme-kamigawa', 'theme-obscura');
      document.body.classList.add('theme-' + theme);
    } catch { /* ignore */ }
  },

  // =================== Token Art ===================

  _getTokenArt(card) {
    const name = (card.name || '').toLowerCase();
    const type = (card.type_line || '').toLowerCase();
    // Map common creature types to emoji art
    if (name.includes('dragon') || type.includes('dragon')) return '🐉';
    if (name.includes('angel') || type.includes('angel')) return '👼';
    if (name.includes('demon') || type.includes('demon')) return '👿';
    if (name.includes('zombie') || type.includes('zombie')) return '💀';
    if (name.includes('soldier') || type.includes('soldier')) return '⚔️';
    if (name.includes('warrior') || type.includes('warrior')) return '🗡️';
    if (name.includes('knight') || type.includes('knight')) return '🛡️';
    if (name.includes('spirit') || type.includes('spirit')) return '👻';
    if (name.includes('elemental') || type.includes('elemental')) return '🔥';
    if (name.includes('beast') || type.includes('beast')) return '🦁';
    if (name.includes('bird') || type.includes('bird')) return '🦅';
    if (name.includes('snake') || type.includes('snake') || name.includes('serpent')) return '🐍';
    if (name.includes('wolf') || type.includes('wolf')) return '🐺';
    if (name.includes('goblin') || type.includes('goblin')) return '👺';
    if (name.includes('elf') || type.includes('elf')) return '🧝';
    if (name.includes('cat') || type.includes('cat')) return '🐱';
    if (name.includes('rat') || type.includes('rat')) return '🐀';
    if (name.includes('insect') || type.includes('insect')) return '🦟';
    if (name.includes('spider') || type.includes('spider')) return '🕷️';
    if (name.includes('fish') || type.includes('fish') || name.includes('merfolk')) return '🐟';
    if (name.includes('saproling') || type.includes('saproling') || type.includes('plant')) return '🌿';
    if (name.includes('treasure')) return '💎';
    if (name.includes('food')) return '🍖';
    if (name.includes('clue')) return '🔍';
    if (name.includes('blood')) return '🩸';
    if (type.includes('human')) return '🧑';
    if (type.includes('faerie')) return '🧚';
    if (type.includes('treefolk')) return '🌳';
    if (type.includes('giant')) return '🗿';
    if (type.includes('golem') || type.includes('construct')) return '🤖';
    return null;
  },

  // =================== Card Tooltip ===================

  _tooltipEl: null,
  _tooltipTimeout: null,

  _ensureTooltip() {
    if (!this._tooltipEl) {
      this._tooltipEl = document.createElement('div');
      this._tooltipEl.id = 'card-tooltip';
      document.body.appendChild(this._tooltipEl);
    }
    return this._tooltipEl;
  },

  showCardTooltip(uid, event) {
    const gs = this.gameState;
    if (!gs) return;

    // Find card in any zone
    let card = null;
    for (const p of gs.players) {
      card = p.zones.battlefield.get(uid) || p.zones.hand.getAll().find(c => c._uid === uid);
      if (card) break;
    }
    if (!card) return;

    clearTimeout(this._tooltipTimeout);
    this._tooltipTimeout = setTimeout(() => {
      const tip = this._ensureTooltip();
      const oracleText = card.oracle_text || '';
      const costPips = card.mana_cost ? this._formatManaCostPips(card.mana_cost) : '';
      const pt = CardEngine.isCreature(card) ? `<div class="tooltip-pt">${CardEngine.getPower(card)}/${CardEngine.getToughness(card)}</div>` : '';
      const loyalty = CardEngine.isPlaneswalker && CardEngine.isPlaneswalker(card) && card._loyalty !== undefined
        ? `<div class="tooltip-pt" style="color:#f39c12">Lealdade: ${card._loyalty}</div>` : '';
      // Format oracle text: bold keywords, italic reminder text
      const formattedText = oracleText
        .replace(/\{([WUBRGCX\d]+)\}/g, (m, v) => {
          const cls = /^\d+$/.test(v) ? 'mana-c' : `mana-${v.toLowerCase()}`;
          return `<span class="mana-pip mana-pip-xs ${cls}">${v}</span>`;
        })
        .replace(/\(([^)]+)\)/g, '<em style="color:rgba(255,255,255,0.45)">($1)</em>')
        .replace(/\n/g, '<br>');
      tip.innerHTML = `
        <div class="tooltip-header">
          <div class="tooltip-name">${card.name}</div>
          ${costPips ? `<div class="tooltip-cost">${costPips}</div>` : ''}
        </div>
        <div class="tooltip-type">${card.type_line || ''}</div>
        ${formattedText ? `<div class="tooltip-text">${formattedText}</div>` : ''}
        ${pt}${loyalty}
      `;

      // Position near cursor
      const x = event.clientX + 16;
      const y = event.clientY - 10;
      tip.style.left = Math.min(x, window.innerWidth - 260) + 'px';
      tip.style.top = Math.min(y, window.innerHeight - 200) + 'px';
      tip.classList.add('visible');
    }, 400); // 400ms delay to avoid flickering
  },

  hideCardTooltip() {
    clearTimeout(this._tooltipTimeout);
    if (this._tooltipEl) {
      this._tooltipEl.classList.remove('visible');
    }
  },

  destroy() {
    if (this._keyListener) {
      document.removeEventListener('keydown', this._keyListener);
      this._keyListener = null;
    }
    if (this._tooltipEl) {
      this._tooltipEl.remove();
      this._tooltipEl = null;
    }
    const toastContainer = document.getElementById('game-toast-container');
    if (toastContainer) toastContainer.remove();
  }
};

// Override selectTarget to also handle equip targeting
const _origSelectTarget = UIGame.selectTarget.bind(UIGame);
UIGame.selectTarget = function(type, playerId, uid) {
  if (this.targetingMode && this.targetingMode.isEquip) {
    const gs = this.gameState;
    // Only equip own creatures
    if (playerId !== 0) {
      gs.log.push('So pode equipar criaturas suas.');
      this.render();
      return;
    }
    const creature = gs.players[0].zones.battlefield.get(uid);
    if (!creature || !CardEngine.isCreature(creature)) {
      gs.log.push('Selecione uma criatura.');
      this.render();
      return;
    }

    // Pay equip cost
    const manaCost = this.targetingMode.equipCost;
    const cmc = this.targetingMode.equipCmc;
    gs.manaPool[0] = ManaSystem.payMana(gs.manaPool[0], manaCost, cmc);

    GameState.equipCreature(gs, 0, this.targetingMode.card._uid, uid);
    this.targetingMode = null;
    gs.waitingForInput = { type: 'main_phase', playerId: 0 };
    this.render();
    return;
  }
  _origSelectTarget(type, playerId, uid);
};
