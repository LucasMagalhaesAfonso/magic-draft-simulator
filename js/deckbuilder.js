const DeckBuilder = {
  state: null,

  BASIC_LANDS: {
    W: { name: 'Plains', type_line: 'Basic Land — Plains', colors: [], color_identity: ['W'], cmc: 0, rarity: 'common', mana_cost: '', oracle_text: '{T}: Add {W}.', keywords: [], power: null, toughness: null, image_normal: 'https://api.scryfall.com/cards/named?exact=Plains&format=image&version=normal', image_small: 'https://api.scryfall.com/cards/named?exact=Plains&format=image&version=small', image_large: 'https://api.scryfall.com/cards/named?exact=Plains&format=image&version=large', set: 'basic', collector_number: '0' },
    U: { name: 'Island', type_line: 'Basic Land — Island', colors: [], color_identity: ['U'], cmc: 0, rarity: 'common', mana_cost: '', oracle_text: '{T}: Add {U}.', keywords: [], power: null, toughness: null, image_normal: 'https://api.scryfall.com/cards/named?exact=Island&format=image&version=normal', image_small: 'https://api.scryfall.com/cards/named?exact=Island&format=image&version=small', image_large: 'https://api.scryfall.com/cards/named?exact=Island&format=image&version=large', set: 'basic', collector_number: '0' },
    B: { name: 'Swamp', type_line: 'Basic Land — Swamp', colors: [], color_identity: ['B'], cmc: 0, rarity: 'common', mana_cost: '', oracle_text: '{T}: Add {B}.', keywords: [], power: null, toughness: null, image_normal: 'https://api.scryfall.com/cards/named?exact=Swamp&format=image&version=normal', image_small: 'https://api.scryfall.com/cards/named?exact=Swamp&format=image&version=small', image_large: 'https://api.scryfall.com/cards/named?exact=Swamp&format=image&version=large', set: 'basic', collector_number: '0' },
    R: { name: 'Mountain', type_line: 'Basic Land — Mountain', colors: [], color_identity: ['R'], cmc: 0, rarity: 'common', mana_cost: '', oracle_text: '{T}: Add {R}.', keywords: [], power: null, toughness: null, image_normal: 'https://api.scryfall.com/cards/named?exact=Mountain&format=image&version=normal', image_small: 'https://api.scryfall.com/cards/named?exact=Mountain&format=image&version=small', image_large: 'https://api.scryfall.com/cards/named?exact=Mountain&format=image&version=large', set: 'basic', collector_number: '0' },
    G: { name: 'Forest', type_line: 'Basic Land — Forest', colors: [], color_identity: ['G'], cmc: 0, rarity: 'common', mana_cost: '', oracle_text: '{T}: Add {G}.', keywords: [], power: null, toughness: null, image_normal: 'https://api.scryfall.com/cards/named?exact=Forest&format=image&version=normal', image_small: 'https://api.scryfall.com/cards/named?exact=Forest&format=image&version=small', image_large: 'https://api.scryfall.com/cards/named?exact=Forest&format=image&version=large', set: 'basic', collector_number: '0' }
  },

  init(pool) {
    this.state = {
      pool: pool.map(c => ({ ...c, _uid: c.id + '_' + Math.random().toString(36).slice(2, 6) })),
      deck: [],
      lands: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      sortBy: 'cmc'
    };
    this._autoSuggestLands();
    this.render();
  },

  _autoSuggestLands() {
    const deck = this.state.deck;
    const colorPips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let nonBasicLandCount = 0;
    const dualLandColors = { W: 0, U: 0, B: 0, R: 0, G: 0 };

    // Count pips from deck cards, and track non-basic lands
    const source = deck.length > 0 ? deck : this.state.pool;
    source.forEach(card => {
      const typeLine = (card.type_line || '').toLowerCase();

      // Count non-basic lands that produce colors
      if (typeLine.includes('land') && !typeLine.includes('basic land')) {
        if (deck.length > 0) { // Only count when deck has cards
          nonBasicLandCount++;
          const landColors = typeof ManaSystem !== 'undefined'
            ? ManaSystem.getLandManaColors(card)
            : (card.color_identity || []);
          for (const c of landColors) {
            if (dualLandColors[c] !== undefined) dualLandColors[c]++;
          }
        }
        return;
      }

      const mc = card.mana_cost || '';
      (mc.match(/\{([WUBRG])\}/g) || []).forEach(m => {
        const c = m.replace(/[{}]/g, '');
        if (colorPips[c] !== undefined) colorPips[c]++;
      });
    });

    const totalPips = Object.values(colorPips).reduce((a, b) => a + b, 0);
    if (totalPips === 0) return;

    const nonLandCards = deck.length > 0
      ? deck.filter(c => !(c.type_line || '').toLowerCase().includes('land')).length
      : 23;
    const totalLands = Math.max(0, 40 - nonLandCards - nonBasicLandCount);

    // Adjust pips by dual land coverage
    const adjustedPips = { ...colorPips };
    for (const [color, count] of Object.entries(dualLandColors)) {
      adjustedPips[color] = Math.max(0, adjustedPips[color] - count);
    }
    const adjustedTotal = Object.values(adjustedPips).reduce((a, b) => a + b, 0);
    const distPips = adjustedTotal > 0 ? adjustedPips : colorPips;
    const distTotal = adjustedTotal > 0 ? adjustedTotal : totalPips;

    Object.keys(this.state.lands).forEach(c => {
      if (distPips[c] > 0) {
        this.state.lands[c] = Math.max(1, Math.round((distPips[c] / distTotal) * totalLands));
      } else {
        this.state.lands[c] = 0;
      }
    });

    // Adjust to hit exactly totalLands
    let currentTotal = Object.values(this.state.lands).reduce((a, b) => a + b, 0);
    const activeColors = Object.entries(this.state.lands).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

    while (currentTotal > totalLands && activeColors.length > 0) {
      for (const [c] of activeColors) {
        if (this.state.lands[c] > 1 && currentTotal > totalLands) {
          this.state.lands[c]--;
          currentTotal--;
        }
      }
    }
    while (currentTotal < totalLands && activeColors.length > 0) {
      this.state.lands[activeColors[0][0]]++;
      currentTotal++;
    }
  },

  addToDeck(uid) {
    const idx = this.state.pool.findIndex(c => c._uid === uid);
    if (idx === -1) return;
    const card = this.state.pool.splice(idx, 1)[0];
    this.state.deck.push(card);
    this._autoSuggestLands();
    this.render();
  },

  removeFromDeck(uid) {
    const idx = this.state.deck.findIndex(c => c._uid === uid);
    if (idx === -1) return;
    const card = this.state.deck.splice(idx, 1)[0];
    this.state.pool.push(card);
    this._autoSuggestLands();
    this.render();
  },

  addAllToDeck() {
    this.state.deck.push(...this.state.pool);
    this.state.pool = [];
    this._autoSuggestLands();
    this.render();
  },

  removeAllFromDeck() {
    this.state.pool.push(...this.state.deck);
    this.state.deck = [];
    this._autoSuggestLands();
    this.render();
  },

  setLandCount(color, count) {
    this.state.lands[color] = Math.max(0, Math.min(20, count));
    this.render();
  },

  autoBuild() {
    // Move everything back to pool
    const allCards = [...this.state.pool, ...this.state.deck];
    this.state.pool = allCards;
    this.state.deck = [];

    // Use BotAI's smart deck building algorithm
    const result = BotAI.buildDeck(allCards);

    // Move selected cards from pool to deck
    const deckUids = new Set(result.deck.map(c => c._uid));
    this.state.deck = [];
    this.state.pool = [];

    for (const card of allCards) {
      if (deckUids.has(card._uid)) {
        this.state.deck.push(card);
      } else {
        this.state.pool.push(card);
      }
    }

    // Apply calculated land distribution
    this.state.lands = { ...result.lands };

    this.render();
  },

  getTotalDeckSize() {
    const landTotal = Object.values(this.state.lands).reduce((a, b) => a + b, 0);
    return this.state.deck.length + landTotal;
  },

  getDeckList() {
    const lines = ['// Deck'];
    const sorted = [...this.state.deck].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(c => lines.push(`1 ${c.name}`));

    Object.entries(this.state.lands).forEach(([color, count]) => {
      if (count > 0) {
        lines.push(`${count} ${this.BASIC_LANDS[color].name}`);
      }
    });

    lines.push('');
    lines.push('// Sideboard');
    this.state.pool.sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
      lines.push(`1 ${c.name}`);
    });

    return lines.join('\n');
  },

  _sortCards(cards, sortBy) {
    return [...cards].sort((a, b) => {
      if (sortBy === 'cmc') return a.cmc - b.cmc || a.name.localeCompare(b.name);
      if (sortBy === 'color') {
        const ca = (a.colors || [])[0] || 'Z';
        const cb = (b.colors || [])[0] || 'Z';
        return ca.localeCompare(cb) || a.cmc - b.cmc;
      }
      if (sortBy === 'rarity') {
        const order = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
        return (order[a.rarity] || 3) - (order[b.rarity] || 3) || a.cmc - b.cmc;
      }
      if (sortBy === 'type') {
        const isCreatureA = a.type_line.includes('Creature') ? 0 : 1;
        const isCreatureB = b.type_line.includes('Creature') ? 0 : 1;
        return isCreatureA - isCreatureB || a.cmc - b.cmc;
      }
      return 0;
    });
  },

  _getCurveData() {
    const curve = {};
    this.state.deck.forEach(c => {
      if (c.type_line.includes('Land')) return;
      const slot = Math.min(Math.max(Math.ceil(c.cmc), 0), 7);
      const label = slot >= 7 ? '7+' : String(slot);
      curve[label] = (curve[label] || 0) + 1;
    });
    return curve;
  },

  render() {
    const container = document.getElementById('screen-deckbuilder');
    const deckSorted = this._sortCards(this.state.deck, this.state.sortBy);
    const poolSorted = this._sortCards(this.state.pool, this.state.sortBy);
    const totalSize = this.getTotalDeckSize();
    const curve = this._getCurveData();
    const maxCurve = Math.max(1, ...Object.values(curve));
    const creatures = this.state.deck.filter(c => c.type_line.includes('Creature')).length;
    const spells = this.state.deck.filter(c => !c.type_line.includes('Creature') && !c.type_line.includes('Land')).length;
    const nonBasicLands = this.state.deck.filter(c => (c.type_line || '').includes('Land') && !(c.type_line || '').includes('Basic Land')).length;
    const landTotal = Object.values(this.state.lands).reduce((a, b) => a + b, 0) + nonBasicLands;

    container.innerHTML = `
      <div class="db-container">
        <div class="db-header">
          <div class="db-title">
            <h2>Deck Builder</h2>
            <span class="db-size ${totalSize === 40 ? 'valid' : totalSize > 40 ? 'over' : 'under'}">
              ${totalSize}/40 cartas
            </span>
          </div>
          <div class="db-actions">
            <button class="btn btn-secondary btn-sm" onclick="DeckBuilder.autoBuild()">Auto-Build</button>
            <button class="btn btn-secondary btn-sm" onclick="DeckBuilder.addAllToDeck()">Add Tudo</button>
            <button class="btn btn-secondary btn-sm" onclick="DeckBuilder.removeAllFromDeck()">Remover Tudo</button>
            <button class="btn btn-secondary btn-sm" onclick="DeckBuilder.exportDeck()">Exportar</button>
            <button class="btn btn-secondary btn-sm" onclick="DeckBuilder.saveDeck()">Salvar</button>
            <button class="btn btn-primary btn-sm" onclick="App.startGame()" ${totalSize >= 30 ? '' : 'disabled'}>Jogar!</button>
            <select class="db-sort" onchange="DeckBuilder.state.sortBy=this.value; DeckBuilder.render()">
              <option value="cmc" ${this.state.sortBy === 'cmc' ? 'selected' : ''}>Custo de Mana</option>
              <option value="color" ${this.state.sortBy === 'color' ? 'selected' : ''}>Cor</option>
              <option value="rarity" ${this.state.sortBy === 'rarity' ? 'selected' : ''}>Raridade</option>
              <option value="type" ${this.state.sortBy === 'type' ? 'selected' : ''}>Tipo</option>
            </select>
          </div>
        </div>

        <div class="db-stats-row">
          <div class="db-curve">
            <div class="curve-chart">
              ${[0, 1, 2, 3, 4, 5, 6, 7].map(n => {
                const label = n >= 7 ? '7+' : String(n);
                const val = curve[label] || 0;
                const height = Math.round((val / maxCurve) * 34);
                return `<div class="curve-bar-group">
                  <span class="curve-val">${val || ''}</span>
                  <div class="curve-bar" style="height:${height}px"></div>
                  <span class="curve-label">${label}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
          <div class="db-counts-separator"></div>
          <div class="db-counts">
            <span>Criaturas: <strong>${creatures}</strong></span>
            <span>Feiticos: <strong>${spells}</strong></span>
            <span>Terrenos: <strong>${landTotal}</strong>${nonBasicLands > 0 ? ` <small style="color:var(--gold)">(${nonBasicLands} especial)</small>` : ''}</span>
          </div>
          <div class="db-counts-separator"></div>
          <div class="db-lands">
            <div class="lands-grid">
              ${Object.entries(this.state.lands).map(([color, count]) => {
                const artPrefs = this._getLandArtPrefs();
                const hasCustomArt = artPrefs[color];
                const previewSrc = hasCustomArt ? artPrefs[color].image_small : this.BASIC_LANDS[color].image_small;
                return `
                <div class="land-control">
                  <img src="${previewSrc}" alt="${this.BASIC_LANDS[color].name}" class="land-art-preview"
                       onclick="DeckBuilder.showLandArtPicker('${color}')" title="Clique para trocar a arte">
                  <div class="land-buttons">
                    <button class="land-btn" onclick="DeckBuilder.setLandCount('${color}', ${count - 1})">-</button>
                    <span class="land-count land-${color}">${count}</span>
                    <button class="land-btn" onclick="DeckBuilder.setLandCount('${color}', ${count + 1})">+</button>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>

        <!-- DECK SECTION -->
        <div class="db-section db-deck-section">
          <h3 class="db-section-title">
            <span class="db-section-icon">&#9876;</span>
            Deck <span class="db-section-count">${this.state.deck.length} cartas + ${landTotal} terrenos</span>
          </h3>

          <!-- Non-land cards -->
          ${deckSorted.filter(c => !c.type_line.includes('Land')).length > 0 ? `
          <div class="db-card-grid">
            ${deckSorted.filter(c => !c.type_line.includes('Land')).map(c => `
              <div class="db-card" ${CardZoom.attr(c)} onclick="DeckBuilder.removeFromDeck('${c._uid}')"
                   onmouseenter="Draft._showPreview('${c.image_large || c.image_normal}')"
                   onmouseleave="Draft._hidePreview()">
                <img src="${c.image_normal || c.image_small}" alt="${c.name}" loading="lazy">
                <div class="card-rarity-dot ${c.rarity}"></div>
              </div>
            `).join('')}
          </div>` : `<span class="db-empty-text">Clique em cartas do Pool para adicionar ao deck</span>`}

          <!-- Non-basic lands in deck -->
          ${deckSorted.filter(c => c.type_line.includes('Land')).length > 0 ? `
            <div class="db-nonbasic-lands">
              <h4 class="db-sub-title">Terrenos Especiais</h4>
              <div class="db-card-grid db-lands-grid">
                ${deckSorted.filter(c => c.type_line.includes('Land')).map(c => `
                  <div class="db-card" ${CardZoom.attr(c)} onclick="DeckBuilder.removeFromDeck('${c._uid}')"
                       onmouseenter="Draft._showPreview('${c.image_large || c.image_normal}')"
                       onmouseleave="Draft._hidePreview()">
                    <img src="${c.image_normal || c.image_small}" alt="${c.name}" loading="lazy">
                    <div class="card-rarity-dot ${c.rarity}"></div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Basic lands inline (no duplicate visual) -->
        </div>

        <!-- CUSTOMIZATION SECTION -->
        <div class="db-section db-customization-section">
          <h3 class="db-section-title">
            <span class="db-section-icon">&#127912;</span>
            Personalizar
          </h3>
          ${this._renderCustomizationPanel()}
        </div>

        <!-- SIDEBOARD SECTION -->
        <div class="db-section db-pool-section">
          <h3 class="db-section-title">
            <span class="db-section-icon">&#128220;</span>
            Pool / Sideboard <span class="db-section-count">${this.state.pool.length} cartas</span>
          </h3>
          <div class="db-card-grid">
            ${poolSorted.map(c => `
              <div class="db-card pool-card" ${CardZoom.attr(c)} onclick="DeckBuilder.addToDeck('${c._uid}')"
                   onmouseenter="Draft._showPreview('${c.image_large || c.image_normal}')"
                   onmouseleave="Draft._hidePreview()">
                <img src="${c.image_normal || c.image_small}" alt="${c.name}" loading="lazy">
                <div class="card-rarity-dot ${c.rarity}"></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      ${this._renderSavedDecks()}

      <div class="card-preview" id="card-preview" style="display:none">
        <img id="card-preview-img" src="" alt="Preview">
      </div>
    `;
  },

  exportDeck() {
    const text = this.getDeckList();
    navigator.clipboard.writeText(text).then(() => {
      this._showToast('Lista copiada para a area de transferencia!');
    }).catch(() => {
      const w = window.open('', '_blank');
      w.document.write(`<pre>${text}</pre>`);
    });
  },

  // =================== Deck Save/Load System ===================

  STORAGE_KEY: 'magic_draft_saved_decks',

  _getSavedDecks() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  },

  _saveDeckList(decks) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(decks));
  },

  saveDeck() {
    if (!this.state || this.state.deck.length === 0) {
      this._showToast('Deck vazio - adicione cartas antes de salvar.');
      return;
    }

    const name = prompt('Nome do deck:');
    if (!name || !name.trim()) return;

    const decks = this._getSavedDecks();

    // Serialize deck data (only essential fields)
    const deckData = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      date: new Date().toISOString(),
      cards: this.state.deck.map(c => ({
        id: c.id,
        name: c.name,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        power: c.power,
        toughness: c.toughness,
        colors: c.colors,
        color_identity: c.color_identity,
        rarity: c.rarity,
        keywords: c.keywords,
        image_normal: c.image_normal,
        image_small: c.image_small,
        image_large: c.image_large,
        set: c.set,
        collector_number: c.collector_number
      })),
      lands: { ...this.state.lands },
      sideboard: this.state.pool.map(c => ({
        id: c.id,
        name: c.name,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        power: c.power,
        toughness: c.toughness,
        colors: c.colors,
        color_identity: c.color_identity,
        rarity: c.rarity,
        keywords: c.keywords,
        image_normal: c.image_normal,
        image_small: c.image_small,
        image_large: c.image_large,
        set: c.set,
        collector_number: c.collector_number
      })),
      stats: {
        creatures: this.state.deck.filter(c => (c.type_line || '').includes('Creature')).length,
        spells: this.state.deck.filter(c => !(c.type_line || '').includes('Creature') && !(c.type_line || '').includes('Land')).length,
        totalSize: this.getTotalDeckSize()
      }
    };

    decks.push(deckData);
    this._saveDeckList(decks);
    this._showToast(`Deck "${name.trim()}" salvo!`);
    this.render();
  },

  loadDeck(deckId) {
    const decks = this._getSavedDecks();
    const saved = decks.find(d => d.id === deckId);
    if (!saved) return;

    // Restore deck with _uid
    const deck = saved.cards.map(c => ({
      ...c,
      _uid: c.id + '_' + Math.random().toString(36).slice(2, 6)
    }));
    const sideboard = (saved.sideboard || []).map(c => ({
      ...c,
      _uid: c.id + '_' + Math.random().toString(36).slice(2, 6)
    }));

    this.state = {
      pool: sideboard,
      deck: deck,
      lands: { ...saved.lands },
      sortBy: this.state ? this.state.sortBy : 'cmc'
    };

    this._showToast(`Deck "${saved.name}" carregado!`);
    this.render();
  },

  deleteDeck(deckId) {
    const decks = this._getSavedDecks();
    const deck = decks.find(d => d.id === deckId);
    if (!deck) return;
    if (!confirm(`Deletar deck "${deck.name}"?`)) return;

    const filtered = decks.filter(d => d.id !== deckId);
    this._saveDeckList(filtered);
    this._showToast(`Deck "${deck.name}" deletado.`);
    this.render();
  },

  _showToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.db-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'db-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  },

  _renderCustomizationPanel() {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    const currentPlaymat = prefs.playmat || 'default';
    const currentSleeve = prefs.sleeve || 'default';

    const playmats = [
      { id: 'default', label: 'Padrao', emoji: '&#9724;' },
      { id: 'forest', label: 'Floresta', emoji: '&#127795;' },
      { id: 'ocean', label: 'Oceano', emoji: '&#127754;' },
      { id: 'mountain', label: 'Montanha', emoji: '&#9968;' },
      { id: 'plains', label: 'Planicie', emoji: '&#127774;' },
      { id: 'swamp', label: 'Pantano', emoji: '&#128128;' },
      { id: 'nyx', label: 'Nyx', emoji: '&#10024;' }
    ];

    const sleeves = [
      { id: 'default', label: 'Padrao', emoji: '&#9724;' },
      { id: 'gold', label: 'Ouro', emoji: '&#127942;' },
      { id: 'silver', label: 'Prata', emoji: '&#129351;' },
      { id: 'fire', label: 'Fogo', emoji: '&#128293;' },
      { id: 'ice', label: 'Gelo', emoji: '&#10052;' },
      { id: 'nature', label: 'Natureza', emoji: '&#127807;' },
      { id: 'dark', label: 'Sombra', emoji: '&#128126;' },
      { id: 'ruby', label: 'Rubi', emoji: '&#128142;' }
    ];

    return `
      <div class="db-custom-row">
        <div class="db-custom-group">
          <label>Playmat</label>
          <div class="db-custom-options">
            ${playmats.map(p => `
              <div class="db-custom-opt playmat-opt-${p.id} ${currentPlaymat === p.id && !prefs.playmatArt ? 'selected' : ''}"
                   onclick="DeckBuilder._setPlaymat('${p.id}')" title="${p.label}">
                <span class="db-custom-emoji">${p.emoji}</span>
                <span class="db-custom-label">${p.label}</span>
              </div>
            `).join('')}
            <div class="db-custom-opt db-custom-art-opt ${prefs.playmatArt ? 'selected' : ''}"
                 onclick="DeckBuilder.showPlaymatArtPicker()" title="Escolher arte"
                 ${prefs.playmatArt ? `style="background:url('${prefs.playmatArt.art_crop}') center/cover"` : ''}>
              <span class="db-custom-emoji">${prefs.playmatArt ? '' : '&#127912;'}</span>
              <span class="db-custom-label">${prefs.playmatArt ? prefs.playmatArt.name.slice(0,8) : 'Arte'}</span>
            </div>
          </div>
        </div>
        <div class="db-custom-group">
          <label>Sleeves</label>
          <div class="db-custom-options">
            ${sleeves.map(s => `
              <div class="db-custom-opt sleeve-opt-${s.id} ${currentSleeve === s.id && !prefs.sleeveArt ? 'selected' : ''}"
                   onclick="DeckBuilder._setSleeve('${s.id}')" title="${s.label}">
                <span class="db-custom-emoji">${s.emoji}</span>
                <span class="db-custom-label">${s.label}</span>
              </div>
            `).join('')}
            <div class="db-custom-opt db-custom-art-opt ${prefs.sleeveArt ? 'selected' : ''}"
                 onclick="DeckBuilder.showSleeveArtPicker()" title="Escolher arte"
                 ${prefs.sleeveArt ? `style="background:url('${prefs.sleeveArt.art_crop}') center/cover"` : ''}>
              <span class="db-custom-emoji">${prefs.sleeveArt ? '' : '&#127912;'}</span>
              <span class="db-custom-label">${prefs.sleeveArt ? prefs.sleeveArt.name.slice(0,8) : 'Arte'}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _setPlaymat(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.playmat = id;
    delete prefs.playmatArt;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    this.render();
  },

  _setSleeve(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.sleeve = id;
    delete prefs.sleeveArt; // clear custom art when picking preset
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    this.render();
  },

  async showSleeveArtPicker() {
    const existing = document.querySelector('.sleeve-art-overlay');
    if (existing) existing.remove();

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    const currentArtId = prefs.sleeveArt ? prefs.sleeveArt.id : null;

    const overlay = document.createElement('div');
    overlay.className = 'sleeve-art-overlay land-art-overlay';
    overlay.innerHTML = `
      <div class="land-art-modal">
        <h3>Escolher Arte para Sleeve</h3>
        <div class="sleeve-search-box">
          <input type="text" id="sleeve-search-input" class="sleeve-search-input"
                 placeholder="Digite o nome de uma carta..." autofocus>
          <button class="btn btn-primary btn-sm" onclick="DeckBuilder._searchSleeveArt()">Buscar</button>
        </div>
        <div id="sleeve-art-results" class="sleeve-art-results">
          <p class="land-art-hint">Busque uma carta para ver artes disponiveis</p>
        </div>
        <div class="land-art-actions">
          ${currentArtId ? '<button class="btn btn-secondary btn-sm" onclick="DeckBuilder._clearSleeveArt()">Remover Arte</button>' : ''}
          <button class="btn btn-primary btn-sm" onclick="document.querySelector('.sleeve-art-overlay').remove()">Fechar</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    // Enter key triggers search
    const input = document.getElementById('sleeve-search-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') DeckBuilder._searchSleeveArt();
    });
  },

  async _searchSleeveArt() {
    const input = document.getElementById('sleeve-search-input');
    const query = (input ? input.value : '').trim();
    if (!query || query.length < 2) return;

    const results = document.getElementById('sleeve-art-results');
    results.innerHTML = '<p class="land-art-hint">Buscando...</p>';

    try {
      const q = encodeURIComponent(query);
      const resp = await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=art&order=released&dir=desc`);
      if (!resp.ok) {
        results.innerHTML = '<p class="land-art-hint">Nenhum resultado encontrado.</p>';
        return;
      }
      const json = await resp.json();
      const arts = (json.data || []).slice(0, 24).map(c => ({
        id: c.id,
        name: c.name,
        set: c.set_name || c.set,
        artist: c.artist || '',
        art_crop: c.image_uris ? c.image_uris.art_crop : (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris.art_crop : ''),
        image_small: c.image_uris ? c.image_uris.small : '',
        image_normal: c.image_uris ? c.image_uris.normal : ''
      })).filter(a => a.art_crop);

      if (arts.length === 0) {
        results.innerHTML = '<p class="land-art-hint">Nenhuma arte encontrada.</p>';
        return;
      }

      this._tempSleeveArts = arts;
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      const currentId = prefs.sleeveArt ? prefs.sleeveArt.id : null;

      results.innerHTML = `
        <div class="land-art-grid">
          ${arts.map((art, i) => `
            <div class="land-art-option ${art.id === currentId ? 'selected' : ''}"
                 onclick="DeckBuilder._selectSleeveArt(${i})">
              <img src="${art.art_crop}" alt="${art.name}" loading="lazy">
              <span class="land-art-set">${art.name}</span>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.error('Sleeve art search error:', e);
      results.innerHTML = '<p class="land-art-hint">Erro na busca.</p>';
    }
  },

  _selectSleeveArt(index) {
    if (!this._tempSleeveArts) return;
    const art = this._tempSleeveArts[index];
    if (!art) return;

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.sleeveArt = art;
    prefs.sleeve = 'custom';
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));

    // Update selection UI
    document.querySelectorAll('.land-art-option').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.land-art-option')[index]?.classList.add('selected');

    this._showToast(`Sleeve: ${art.name}`);
    this.render();
  },

  _clearSleeveArt() {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    delete prefs.sleeveArt;
    prefs.sleeve = 'default';
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    document.querySelector('.sleeve-art-overlay')?.remove();
    this.render();
    this._showToast('Sleeve resetado ao padrao.');
  },

  // =================== Playmat Art Selection ===================

  async showPlaymatArtPicker() {
    const existing = document.querySelector('.playmat-art-overlay');
    if (existing) existing.remove();

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    const currentArtId = prefs.playmatArt ? prefs.playmatArt.id : null;

    const overlay = document.createElement('div');
    overlay.className = 'playmat-art-overlay land-art-overlay';
    overlay.innerHTML = `
      <div class="land-art-modal">
        <h3>Escolher Arte para Playmat</h3>
        <div class="sleeve-search-box">
          <input type="text" id="playmat-search-input" class="sleeve-search-input"
                 placeholder="Digite o nome de uma carta..." autofocus>
          <button class="btn btn-primary btn-sm" onclick="DeckBuilder._searchPlaymatArt()">Buscar</button>
        </div>
        <div id="playmat-art-results" class="sleeve-art-results">
          <p class="land-art-hint">Busque uma carta para ver artes disponiveis</p>
        </div>
        <div class="land-art-actions">
          ${currentArtId ? '<button class="btn btn-secondary btn-sm" onclick="DeckBuilder._clearPlaymatArt()">Remover Arte</button>' : ''}
          <button class="btn btn-primary btn-sm" onclick="document.querySelector('.playmat-art-overlay').remove()">Fechar</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const input = document.getElementById('playmat-search-input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') DeckBuilder._searchPlaymatArt();
    });
  },

  async _searchPlaymatArt() {
    const input = document.getElementById('playmat-search-input');
    const query = (input ? input.value : '').trim();
    if (!query || query.length < 2) return;

    const results = document.getElementById('playmat-art-results');
    results.innerHTML = '<p class="land-art-hint">Buscando...</p>';

    try {
      const q = encodeURIComponent(query);
      const resp = await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=art&order=released&dir=desc`);
      if (!resp.ok) {
        results.innerHTML = '<p class="land-art-hint">Nenhum resultado encontrado.</p>';
        return;
      }
      const json = await resp.json();
      const arts = (json.data || []).slice(0, 24).map(c => ({
        id: c.id,
        name: c.name,
        set: c.set_name || c.set,
        artist: c.artist || '',
        art_crop: c.image_uris ? c.image_uris.art_crop : (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris.art_crop : ''),
        image_small: c.image_uris ? c.image_uris.small : '',
        image_normal: c.image_uris ? c.image_uris.normal : ''
      })).filter(a => a.art_crop);

      if (arts.length === 0) {
        results.innerHTML = '<p class="land-art-hint">Nenhuma arte encontrada.</p>';
        return;
      }

      this._tempPlaymatArts = arts;
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      const currentId = prefs.playmatArt ? prefs.playmatArt.id : null;

      results.innerHTML = `
        <div class="land-art-grid">
          ${arts.map((art, i) => `
            <div class="land-art-option ${art.id === currentId ? 'selected' : ''}"
                 onclick="DeckBuilder._selectPlaymatArt(${i})">
              <img src="${art.art_crop}" alt="${art.name}" loading="lazy">
              <span class="land-art-set">${art.name}</span>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.error('Playmat art search error:', e);
      results.innerHTML = '<p class="land-art-hint">Erro na busca.</p>';
    }
  },

  _selectPlaymatArt(index) {
    if (!this._tempPlaymatArts) return;
    const art = this._tempPlaymatArts[index];
    if (!art) return;

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.playmatArt = art;
    prefs.playmat = 'custom';
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));

    document.querySelectorAll('.playmat-art-overlay .land-art-option').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.playmat-art-overlay .land-art-option')[index]?.classList.add('selected');

    this._showToast(`Playmat: ${art.name}`);
    this.render();
  },

  _clearPlaymatArt() {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    delete prefs.playmatArt;
    prefs.playmat = 'default';
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    document.querySelector('.playmat-art-overlay')?.remove();
    this.render();
    this._showToast('Playmat resetado ao padrao.');
  },

  // =================== Land Art Selection ===================

  _getLandArtPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      return prefs.landArt || {};
    } catch { return {}; }
  },

  _setLandArt(color, artData) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    if (!prefs.landArt) prefs.landArt = {};
    prefs.landArt[color] = artData;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
  },

  // Get the effective basic land object (with custom art if selected)
  getEffectiveLand(color) {
    const artPrefs = this._getLandArtPrefs();
    const base = { ...this.BASIC_LANDS[color] };
    if (artPrefs[color]) {
      base.image_normal = artPrefs[color].image_normal;
      base.image_small = artPrefs[color].image_small;
      base.image_large = artPrefs[color].image_large;
    }
    return base;
  },

  async _fetchLandArts(landName) {
    const cacheKey = `mtg_land_arts_${landName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (data.ts && Date.now() - data.ts < 7 * 24 * 3600 * 1000) return data.arts;
      } catch {}
    }

    try {
      const q = encodeURIComponent(`!"${landName}" t:basic unique:art`);
      const resp = await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=art&order=released&dir=desc`);
      if (!resp.ok) return [];
      const json = await resp.json();
      const arts = (json.data || []).slice(0, 30).map(c => ({
        id: c.id,
        set: c.set_name || c.set,
        image_small: c.image_uris ? c.image_uris.small : (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris.small : ''),
        image_normal: c.image_uris ? c.image_uris.normal : (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris.normal : ''),
        image_large: c.image_uris ? c.image_uris.large : (c.card_faces && c.card_faces[0] ? c.card_faces[0].image_uris.large : ''),
        artist: c.artist || ''
      })).filter(a => a.image_small);

      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), arts }));
      return arts;
    } catch (e) {
      console.error('Failed to fetch land arts:', e);
      return [];
    }
  },

  async showLandArtPicker(color) {
    const existing = document.querySelector('.land-art-overlay');
    if (existing) existing.remove();

    const landName = this.BASIC_LANDS[color].name;
    const artPrefs = this._getLandArtPrefs();
    const currentArtId = artPrefs[color] ? artPrefs[color].id : null;

    // Show loading overlay
    const overlay = document.createElement('div');
    overlay.className = 'land-art-overlay';
    overlay.innerHTML = `
      <div class="land-art-modal">
        <h3>Escolher Arte - ${landName}</h3>
        <div class="land-art-loading">Carregando artes...</div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    // Fetch arts
    const arts = await this._fetchLandArts(landName);

    if (arts.length === 0) {
      overlay.querySelector('.land-art-loading').textContent = 'Nenhuma arte encontrada.';
      return;
    }

    const modalContent = overlay.querySelector('.land-art-modal');
    modalContent.innerHTML = `
      <h3>Escolher Arte - ${landName}</h3>
      <p class="land-art-hint">${arts.length} artes disponiveis. Clique para selecionar.</p>
      <div class="land-art-grid">
        ${arts.map((art, i) => `
          <div class="land-art-option ${art.id === currentArtId ? 'selected' : ''}"
               onclick="DeckBuilder._selectLandArt('${color}', ${i})">
            <img src="${art.image_small}" alt="${landName} - ${art.set}" loading="lazy">
            <span class="land-art-set">${art.set}</span>
          </div>
        `).join('')}
      </div>
      <div class="land-art-actions">
        <button class="btn btn-secondary btn-sm" onclick="DeckBuilder._resetLandArt('${color}')">Resetar Padrao</button>
        <button class="btn btn-primary btn-sm" onclick="document.querySelector('.land-art-overlay').remove()">Fechar</button>
      </div>
    `;

    // Store arts temporarily for selection
    this._tempLandArts = { color, arts };
  },

  _selectLandArt(color, index) {
    if (!this._tempLandArts || this._tempLandArts.color !== color) return;
    const art = this._tempLandArts.arts[index];
    if (!art) return;

    this._setLandArt(color, art);

    // Update selection UI
    document.querySelectorAll('.land-art-option').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.land-art-option')[index]?.classList.add('selected');

    this.render();
    this._showToast(`Arte de ${this.BASIC_LANDS[color].name} atualizada!`);
  },

  _resetLandArt(color) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    if (prefs.landArt) {
      delete prefs.landArt[color];
      localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    }
    document.querySelector('.land-art-overlay')?.remove();
    this.render();
    this._showToast(`Arte de ${this.BASIC_LANDS[color].name} restaurada ao padrao.`);
  },

  _renderSavedDecks() {
    const decks = this._getSavedDecks();
    if (decks.length === 0) return '';

    return `
      <div class="db-saved-section">
        <h3>Decks Salvos (${decks.length})</h3>
        <div class="db-saved-list">
          ${decks.map(d => {
            const colors = this._getDeckColors(d);
            const dateStr = new Date(d.date).toLocaleDateString('pt-BR');
            return `
              <div class="db-saved-item">
                <div class="db-saved-info">
                  <span class="db-saved-colors">${colors}</span>
                  <span class="db-saved-name">${d.name}</span>
                  <span class="db-saved-stats">${d.stats.totalSize} cartas | ${d.stats.creatures}C ${d.stats.spells}S | ${dateStr}</span>
                </div>
                <div class="db-saved-actions">
                  <button class="btn btn-sm btn-primary" onclick="DeckBuilder.loadDeck('${d.id}')">Carregar</button>
                  <button class="btn btn-sm btn-danger" onclick="DeckBuilder.deleteDeck('${d.id}')">X</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  },

  _getDeckColors(deckData) {
    const colorMap = { W: '&#9737;', U: '&#128167;', B: '&#9760;', R: '&#128293;', G: '&#127795;' };
    const colors = new Set();
    (deckData.cards || []).forEach(c => {
      (c.colors || c.color_identity || []).forEach(cl => colors.add(cl));
    });
    return [...colors].map(c => `<span class="mana-${c}">${colorMap[c] || c}</span>`).join('');
  }
};
