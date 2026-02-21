const GAME_VERSION = '2026-02-20-215735';

const App = {
  currentScreen: null,
  setCards: null,
  selectedSet: null,
  tokenArtMap: {},

  screens: ['screen-home', 'screen-loading', 'screen-draft', 'screen-deckbuilder', 'screen-game'],

  init() {
    this._initializeCache();
    this._applyTheme();
    this.showScreen('screen-home');
    this.loadSets();
  },

  _initializeCache() {
    const savedVersion = localStorage.getItem('GAME_VERSION');
    if (savedVersion !== GAME_VERSION) {
      if (savedVersion) {
        console.log(`🔄 Cache invalidated: ${savedVersion} → ${GAME_VERSION}`);
      }
      localStorage.clear();
      localStorage.setItem('GAME_VERSION', GAME_VERSION);
    }
  },

  _applyTheme() {
    try {
      const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
      const theme = prefs.theme || 'planeswalker';
      document.body.classList.remove('theme-planeswalker', 'theme-nyx', 'theme-phyrexian', 'theme-kamigawa', 'theme-obscura');
      document.body.classList.add('theme-' + theme);
    } catch { /* ignore */ }
  },

  showScreen(screenId) {
    this.screens.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', id !== screenId);
    });
    this.currentScreen = screenId;
    // Toggle slim header in game mode
    const header = document.querySelector('.header');
    if (header) header.classList.toggle('game-mode', screenId === 'screen-game');
  },

  async loadSets() {
    // Add hero section if not already present
    const homeContainer = document.querySelector('.home-container');
    if (homeContainer && !homeContainer.querySelector('.home-hero')) {
      const hero = document.createElement('div');
      hero.className = 'home-hero';
      hero.innerHTML = `<h2>Magic Draft Simulator</h2><p>Escolha uma edicao para iniciar um Draft ou Sealed contra bots com IA</p>`;
      homeContainer.insertBefore(hero, homeContainer.firstChild);
    }

    const container = document.getElementById('sets-grid');
    const searchInput = document.getElementById('set-search');

    // Safety check to prevent null reference error that breaks JS execution
    if (!container) {
      console.warn('⚠️ sets-grid element not found, skipping loadSets');
      return;
    }

    container.innerHTML = '<p class="loading-text">Carregando edicoes...</p>';

    try {
      const sets = await Scryfall.fetchSets();
      this.renderSets(sets, container);

      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (!query) {
          this.renderSets(sets, container);
          return;
        }
        const filtered = sets.filter(s =>
          s.name.toLowerCase().includes(query) || s.code.toLowerCase().includes(query)
        );
        this.renderSets(filtered, container);
      });
    } catch (err) {
      container.innerHTML = `<p class="error-text">Erro ao carregar edicoes: ${err.message}</p>`;
    }
  },

  renderSets(sets, container) {
    if (sets.length === 0) {
      container.innerHTML = '<p class="loading-text">Nenhuma edicao encontrada</p>';
      return;
    }

    container.innerHTML = sets.map(s => `
      <div class="set-card" data-code="${s.code}" onclick="App.selectSet('${s.code}', '${s.name.replace(/'/g, "\\'")}')">
        <img class="set-icon" src="${s.icon_svg_uri}" alt="${s.code}" onerror="this.style.display='none'">
        <div class="set-info">
          <span class="set-name">${s.name}</span>
          <span class="set-meta">${s.code.toUpperCase()} · ${s.released_at ? s.released_at.substring(0, 4) : ''} · ${s.card_count} cartas</span>
        </div>
      </div>
    `).join('');
  },

  async selectSet(code, name) {
    this.selectedSet = { code, name };
    this.showScreen('screen-loading');

    const progressEl = document.getElementById('loading-progress');
    progressEl.textContent = `Carregando ${name}...`;

    try {
      this.setCards = await Scryfall.fetchSetCards(code, ({ page, loaded }) => {
        progressEl.textContent = `Carregando ${name}... (${loaded} cartas, pagina ${page})`;
      });

      progressEl.textContent = `${this.setCards.length} cartas carregadas!`;

      const byRarity = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
      this.setCards.forEach(c => { if (byRarity[c.rarity] !== undefined) byRarity[c.rarity]++; });

      document.getElementById('set-stats').innerHTML = `
        <div class="stat"><span class="stat-label">Common</span><span class="stat-value">${byRarity.common}</span></div>
        <div class="stat"><span class="stat-label">Uncommon</span><span class="stat-value">${byRarity.uncommon}</span></div>
        <div class="stat"><span class="stat-label">Rare</span><span class="stat-value">${byRarity.rare}</span></div>
        <div class="stat"><span class="stat-label">Mythic</span><span class="stat-value">${byRarity.mythic}</span></div>
      `;
      document.getElementById('start-draft-section').classList.remove('hidden');
    } catch (err) {
      progressEl.textContent = `Erro: ${err.message}`;
    }
  },

  startDraft() {
    if (!this.setCards) return;
    this.showScreen('screen-draft');
    Draft.start(this.setCards);
  },

  startSealed() {
    if (!this.setCards) return;
    // Generate 6 boosters for sealed
    const pool = [];
    for (let i = 0; i < 6; i++) {
      pool.push(...Booster.generate(this.setCards));
    }
    this.showScreen('screen-deckbuilder');
    DeckBuilder.init(pool);
  },

  openDeckBuilder() {
    if (Draft.state && Draft.state.playerPool) {
      this.showScreen('screen-deckbuilder');
      DeckBuilder.init(Draft.state.playerPool);
    }
  },

  async startGame() {
    if (!DeckBuilder.state) return;

    // Fetch token arts for this set (non-blocking, best-effort)
    if (this.selectedSet && this.selectedSet.code) {
      try {
        const tokens = await Scryfall.fetchSetTokens(this.selectedSet.code);
        this.tokenArtMap = this._buildTokenArtMap(tokens);
      } catch (e) {
        console.warn('Token art fetch failed:', e);
        this.tokenArtMap = {};
      }
    }

    // Build player deck with lands (using custom art if selected)
    const playerDeck = [...DeckBuilder.state.deck];
    Object.entries(DeckBuilder.state.lands).forEach(([color, count]) => {
      for (let i = 0; i < count; i++) {
        const land = {
          ...DeckBuilder.getEffectiveLand(color),
          id: `basic_${color}_${i}_${Math.random().toString(36).slice(2, 6)}`
        };
        playerDeck.push(land);
      }
    });

    // Build opponent deck from a random bot (or generate one)
    let opponentDeck;
    if (Draft.state && Draft.state.bots && Draft.state.bots.length > 0) {
      // Use the best bot's pool
      const bestBot = Draft.state.bots.reduce((best, bot) =>
        bot.pool.length > best.pool.length ? bot : best
      , Draft.state.bots[0]);

      opponentDeck = this._buildBotDeck(bestBot.pool);
    } else {
      // Sealed mode - generate an AI deck from new boosters
      const aiPool = [];
      for (let i = 0; i < 6; i++) {
        aiPool.push(...Booster.generate(this.setCards));
      }
      opponentDeck = this._buildBotDeck(aiPool);
    }

    this.showScreen('screen-game');
    UIGame.startGame(playerDeck, opponentDeck);
  },

  _buildTokenArtMap(tokens) {
    const map = {};
    for (const t of tokens) {
      const name = (t.name || '').toLowerCase();
      if (!name) continue;
      // Exact key: name + power + toughness
      if (t.power && t.toughness) {
        const exactKey = `${name}_${t.power}_${t.toughness}`;
        if (!map[exactKey]) map[exactKey] = t;
      }
      // Name-only fallback (first match wins)
      if (!map[name]) map[name] = t;
    }
    return map;
  },

  _buildBotDeck(pool) {
    // Give cards _uid if they don't have one (needed by BotAI.buildDeck)
    const poolWithUid = pool.map(c => {
      if (!c._uid) c._uid = c.id + '_' + Math.random().toString(36).slice(2, 6);
      return c;
    });

    // Use BotAI's smart deck building algorithm
    const result = BotAI.buildDeck(poolWithUid);
    const deck = [...result.deck];

    // Add basic lands
    Object.entries(result.lands).forEach(([color, count]) => {
      for (let i = 0; i < count; i++) {
        deck.push({
          ...DeckBuilder.BASIC_LANDS[color],
          id: `bot_basic_${color}_${i}_${Math.random().toString(36).slice(2, 6)}`
        });
      }
    });

    return deck;
  },

  showThemePicker() {
    const existing = document.querySelector('.theme-picker-overlay');
    if (existing) { existing.remove(); return; }

    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    const current = prefs.theme || 'planeswalker';

    const themes = [
      { id: 'planeswalker', label: 'Spark' },
      { id: 'nyx', label: 'Nyx' },
      { id: 'phyrexian', label: 'Phyrexia' },
      { id: 'kamigawa', label: 'Kamigawa' },
      { id: 'obscura', label: 'Obscura' },
    ];

    const grid = themes.map(t =>
      `<div class="theme-option theme-opt-${t.id} ${current === t.id ? 'selected' : ''}"
            onclick="App._pickTheme('${t.id}')">
        <span class="theme-label">${t.label}</span>
      </div>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.className = 'theme-picker-overlay';
    overlay.innerHTML = `
      <div class="theme-picker-modal">
        <h3>Tema</h3>
        <div class="theme-options-row">${grid}</div>
      </div>
    `;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  },

  _pickTheme(id) {
    const prefs = JSON.parse(localStorage.getItem('mtg_draft_user_prefs') || '{}');
    prefs.theme = id;
    localStorage.setItem('mtg_draft_user_prefs', JSON.stringify(prefs));
    this._applyTheme();
    // Update selection UI
    document.querySelectorAll('.theme-picker-overlay .theme-option').forEach(el => el.classList.remove('selected'));
    document.querySelector(`.theme-picker-overlay .theme-opt-${id}`)?.classList.add('selected');
    // Also update game visual config if open
    if (typeof UIGame !== 'undefined') {
      document.querySelectorAll('#theme-grid .theme-option').forEach(el => el.classList.remove('selected'));
      document.querySelector(`#theme-grid .theme-opt-${id}`)?.classList.add('selected');
    }
  },

  goHome() {
    this.showScreen('screen-home');
    document.getElementById('start-draft-section').classList.add('hidden');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
