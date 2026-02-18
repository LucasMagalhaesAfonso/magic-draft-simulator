const Draft = {
  PLAYERS: 8,
  ROUNDS: 3,
  PACK_SIZE: 14,

  state: null,

  start(cardPool) {
    // Create bots
    const bots = [];
    for (let i = 1; i < this.PLAYERS; i++) {
      bots.push(BotAI.createBot(i));
    }

    // Generate all packs (8 players x 3 rounds = 24 packs)
    const allPacks = [];
    for (let r = 0; r < this.ROUNDS; r++) {
      const roundPacks = [];
      for (let p = 0; p < this.PLAYERS; p++) {
        roundPacks.push(Booster.generate(cardPool));
      }
      allPacks.push(roundPacks);
    }

    this.state = {
      round: 0,
      pick: 0,
      packs: allPacks,         // [round][player] = array of cards
      currentPacks: allPacks[0], // current round packs per player
      bots,
      playerPool: [],
      selectedCard: null,
      finished: false
    };

    this._updateUI();
  },

  getPlayerPack() {
    if (!this.state || this.state.finished) return [];
    return this.state.currentPacks[0] || [];
  },

  selectCard(cardId) {
    const pack = this.getPlayerPack();
    const card = pack.find(c => c.id === cardId);
    if (!card) return;

    this.state.selectedCard = card;

    // Update UI selection
    document.querySelectorAll('.card-wrapper').forEach(el => {
      el.classList.toggle('selected', el.dataset.cardId === cardId);
    });

    document.getElementById('draft-confirm-btn').disabled = false;
  },

  confirmPick() {
    if (!this.state.selectedCard) return;

    // Player picks
    this.state.playerPool.push(this.state.selectedCard);
    const playerPack = this.state.currentPacks[0];
    this.state.currentPacks[0] = playerPack.filter(c => c.id !== this.state.selectedCard.id);

    // Bots pick
    for (let i = 0; i < this.state.bots.length; i++) {
      const botPack = this.state.currentPacks[i + 1];
      if (botPack && botPack.length > 0) {
        const picked = BotAI.pickCard(this.state.bots[i], botPack);
        this.state.currentPacks[i + 1] = botPack.filter(c => c.id !== picked.id);
      }
    }

    // Pass packs
    this._passPacks();

    this.state.pick++;
    this.state.selectedCard = null;

    // Check if round ended (all packs empty or picked through)
    const playerPack2 = this.state.currentPacks[0];
    if (!playerPack2 || playerPack2.length === 0) {
      this.state.round++;
      this.state.pick = 0;

      if (this.state.round >= this.ROUNDS) {
        this.state.finished = true;
        this._finishDraft();
        return;
      }

      // Start new round - notify bots of new pack
      this.state.currentPacks = this.state.packs[this.state.round];
      for (const bot of this.state.bots) {
        BotAI.newPack(bot);
      }
    }

    this._updateUI();
  },

  _passPacks() {
    const packs = this.state.currentPacks;
    const direction = this.state.round % 2 === 0 ? 1 : -1; // Left on rounds 1,3; right on round 2

    if (direction === 1) {
      // Pass left: each player passes to player-1
      const last = packs[0];
      for (let i = 0; i < packs.length - 1; i++) {
        packs[i] = packs[i + 1];
      }
      packs[packs.length - 1] = last;
    } else {
      // Pass right: each player passes to player+1
      const first = packs[packs.length - 1];
      for (let i = packs.length - 1; i > 0; i--) {
        packs[i] = packs[i - 1];
      }
      packs[0] = first;
    }
  },

  _updateUI() {
    const pack = this.getPlayerPack();

    // Update header info
    document.getElementById('draft-round').textContent = this.state.round + 1;
    document.getElementById('draft-pick').textContent = this.state.pick + 1;
    document.getElementById('draft-remaining').textContent = pack.length;
    document.getElementById('draft-confirm-btn').disabled = true;

    // Render pack
    const grid = document.getElementById('pack-grid');
    if (pack.length === 0) {
      grid.innerHTML = '<p class="loading-text">Aguardando proximo pack...</p>';
    } else {
      grid.innerHTML = pack.map(card => `
        <div class="card-wrapper" data-card-id="${card.id}"
             ${CardZoom.attr(card)}
             onclick="Draft.selectCard('${card.id}')"
             onmouseenter="Draft._showPreview('${card.image_large || card.image_normal}')"
             onmouseleave="Draft._hidePreview()"
             ondblclick="Draft.selectCard('${card.id}'); Draft.confirmPick();">
          <img class="card-img" src="${card.image_normal || card.image_small}" alt="${card.name}" loading="lazy">
          <div class="card-rarity-dot ${card.rarity}"></div>
        </div>
      `).join('');
    }

    // Render pool
    this._renderPool();
  },

  _renderPool() {
    const pool = this.state.playerPool;
    document.getElementById('pool-count').textContent = pool.length;

    const colorGroups = { W: [], U: [], B: [], R: [], G: [], Multi: [], Colorless: [] };

    pool.forEach(card => {
      const colors = card.colors || [];
      if (colors.length === 0) {
        const ci = card.color_identity || [];
        if (ci.length === 0) {
          colorGroups.Colorless.push(card);
        } else if (ci.length > 1) {
          colorGroups.Multi.push(card);
        } else {
          (colorGroups[ci[0]] || colorGroups.Colorless).push(card);
        }
      } else if (colors.length > 1) {
        colorGroups.Multi.push(card);
      } else {
        (colorGroups[colors[0]] || colorGroups.Colorless).push(card);
      }
    });

    const colorNames = { W: 'Branco', U: 'Azul', B: 'Preto', R: 'Vermelho', G: 'Verde', Multi: 'Multi', Colorless: 'Incolor' };
    const container = document.getElementById('pool-colors');

    container.innerHTML = Object.entries(colorGroups)
      .filter(([, cards]) => cards.length > 0)
      .map(([color, cards]) => `
        <div class="pool-color-group">
          <h4>${colorNames[color]} (${cards.length})</h4>
          ${cards.sort((a, b) => a.cmc - b.cmc).map(c => `
            <div class="pool-card-mini ${c.rarity}"
                 onmouseenter="Draft._showPreview('${c.image_large || c.image_normal}')"
                 onmouseleave="Draft._hidePreview()">
              ${this._manaCostIcons(c.mana_cost)} ${c.name}
            </div>
          `).join('')}
        </div>
      `).join('');
  },

  _manaCostIcons(manaCost) {
    if (!manaCost) return '';
    return `<span style="opacity:0.6;font-size:0.7rem">${manaCost.replace(/[{}]/g, '')}</span>`;
  },

  _showPreview(imageUrl) {
    if (!imageUrl) return;
    const preview = document.getElementById('card-preview');
    const img = document.getElementById('card-preview-img');
    img.src = imageUrl;
    preview.style.display = 'block';
  },

  _hidePreview() {
    document.getElementById('card-preview').style.display = 'none';
  },

  simulateRest() {
    if (!this.state || this.state.finished) return;

    // Create a temporary bot to pick for the human player
    const humanBot = BotAI.createBot(99);
    humanBot.pool = [...this.state.playerPool];
    // Sync bot state from existing picks
    this.state.playerPool.forEach(card => {
      const colors = card.colors && card.colors.length > 0 ? card.colors : card.color_identity || [];
      colors.forEach(c => {
        if (humanBot.colorCount[c] !== undefined) humanBot.colorCount[c]++;
      });
      // Track mana pips from cost
      const cost = card.mana_cost || '';
      const pips = cost.match(/\{([WUBRG])\}/gi) || [];
      pips.forEach(p => {
        const color = p.replace(/[{}]/g, '').toUpperCase();
        if (humanBot.colorPips[color] !== undefined) humanBot.colorPips[color]++;
      });
      const tl = card.type_line || '';
      if (tl.includes('Creature')) humanBot.creatureCount++;
      else if (!tl.includes('Land')) humanBot.spellCount++;
      const cmcSlot = Math.min(Math.max(Math.ceil(card.cmc || 0), 0), 6);
      humanBot.curveCounts[cmcSlot] = (humanBot.curveCounts[cmcSlot] || 0) + 1;
    });
    humanBot.pickCount = this.state.playerPool.length;
    humanBot.packNumber = this.state.round;

    while (!this.state.finished) {
      const playerPack = this.state.currentPacks[0];
      if (!playerPack || playerPack.length === 0) {
        this.state.round++;
        this.state.pick = 0;
        if (this.state.round >= this.ROUNDS) {
          this.state.finished = true;
          break;
        }
        this.state.currentPacks = this.state.packs[this.state.round];
        // Notify bots of new pack
        for (const bot of this.state.bots) {
          BotAI.newPack(bot);
        }
        BotAI.newPack(humanBot);
        continue;
      }

      // Human bot picks
      const picked = BotAI.pickCard(humanBot, playerPack);
      this.state.playerPool.push(picked);
      this.state.currentPacks[0] = playerPack.filter(c => c.id !== picked.id);

      // Other bots pick
      for (let i = 0; i < this.state.bots.length; i++) {
        const botPack = this.state.currentPacks[i + 1];
        if (botPack && botPack.length > 0) {
          const bPicked = BotAI.pickCard(this.state.bots[i], botPack);
          this.state.currentPacks[i + 1] = botPack.filter(c => c.id !== bPicked.id);
        }
      }

      this._passPacks();
      this.state.pick++;

      const nextPack = this.state.currentPacks[0];
      if (!nextPack || nextPack.length === 0) {
        this.state.round++;
        this.state.pick = 0;
        if (this.state.round >= this.ROUNDS) {
          this.state.finished = true;
          break;
        }
        this.state.currentPacks = this.state.packs[this.state.round];
        // Notify bots of new pack
        for (const bot of this.state.bots) {
          BotAI.newPack(bot);
        }
        BotAI.newPack(humanBot);
      }
    }

    this._finishDraft();
  },

  skipToGame() {
    // Simulate remaining draft picks
    if (!this.state.finished) {
      this.simulateRest();
    }
    // Auto-build deck and start game
    App.openDeckBuilder();
    DeckBuilder.autoBuild();
    App.startGame();
  },

  _finishDraft() {
    const grid = document.getElementById('pack-grid');
    grid.innerHTML = `
      <div style="text-align:center; padding:40px; width:100%;">
        <h2 style="color:var(--gold); margin-bottom:16px;">Draft Completo!</h2>
        <p style="margin-bottom:8px;">Voce draftou <strong>${this.state.playerPool.length}</strong> cartas.</p>
        <p style="color:var(--text-muted); margin-bottom:24px;">Agora monte seu deck de 40 cartas.</p>
        <button class="btn btn-primary" onclick="App.openDeckBuilder()">Montar Deck</button>
        <button class="btn btn-secondary" onclick="App.goHome()" style="margin-left:12px;">Novo Draft</button>
      </div>
    `;
    document.querySelector('.draft-header').style.display = 'none';
  }
};
