const Scryfall = {
  BASE_URL: 'https://api.scryfall.com',
  RATE_LIMIT_MS: 100,
  _lastRequest: 0,

  async _rateLimit() {
    const now = Date.now();
    const elapsed = now - this._lastRequest;
    if (elapsed < this.RATE_LIMIT_MS) {
      await new Promise(r => setTimeout(r, this.RATE_LIMIT_MS - elapsed));
    }
    this._lastRequest = Date.now();
  },

  async _fetch(url) {
    await this._rateLimit();
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.details || `Scryfall error: ${res.status}`);
    }
    return res.json();
  },

  async fetchSets() {
    const cached = Cache.getSets();
    if (cached) return cached;

    const data = await this._fetch(`${this.BASE_URL}/sets`);
    const draftableSets = data.data
      .filter(s =>
        ['core', 'expansion', 'draft_innovation', 'masters'].includes(s.set_type) &&
        s.card_count > 0
      )
      .map(s => ({
        code: s.code,
        name: s.name,
        released_at: s.released_at,
        icon_svg_uri: s.icon_svg_uri,
        card_count: s.card_count,
        set_type: s.set_type
      }))
      .sort((a, b) => b.released_at.localeCompare(a.released_at));

    Cache.saveSets(draftableSets);
    return draftableSets;
  },

  async fetchSetCards(setCode, onProgress) {
    const cached = Cache.getSetCards(setCode);
    if (cached) return cached;

    let allCards = [];
    let url = `${this.BASE_URL}/cards/search?q=set:${setCode}+is:booster&unique=prints&order=set`;
    let page = 1;

    while (url) {
      if (onProgress) onProgress({ page, loaded: allCards.length });
      const data = await this._fetch(url);
      const cards = data.data.map(c => this._simplifyCard(c));
      allCards = allCards.concat(cards);
      url = data.has_more ? data.next_page : null;
      page++;
    }

    Cache.saveSetCards(setCode, allCards);
    return allCards;
  },

  async fetchSetTokens(setCode) {
    const cacheKey = `mtg_token_arts_${setCode.toLowerCase()}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (data.ts && Date.now() - data.ts < 7 * 24 * 3600 * 1000) return data.tokens;
      }
    } catch {}

    try {
      // Token sets use 't' prefix (e.g., 'ttdm' for TDM tokens)
      const tokenSetCode = 't' + setCode.toLowerCase();
      const url = `${this.BASE_URL}/cards/search?q=set:${tokenSetCode}+t:token&unique=prints&order=name`;
      const data = await this._fetch(url);
      const tokens = (data.data || []).map(c => ({
        name: c.name || '',
        power: c.power || null,
        toughness: c.toughness || null,
        type_line: c.type_line || '',
        keywords: c.keywords || [],
        image_small: (c.image_uris && c.image_uris.small) || '',
        image_normal: (c.image_uris && c.image_uris.normal) || '',
      })).filter(t => t.image_small);

      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), tokens }));
      return tokens;
    } catch (e) {
      console.warn('Token art fetch failed for set:', setCode, e);
      return [];
    }
  },

  _simplifyCard(card) {
    const face = card.card_faces && card.card_faces.length > 0 ? card.card_faces[0] : card;

    // Detect adventure cards: layout === 'adventure' and second face is the adventure spell
    let adventure = null;
    if (card.layout === 'adventure' && card.card_faces && card.card_faces.length >= 2) {
      const advFace = card.card_faces[1];
      adventure = {
        name: advFace.name || '',
        mana_cost: advFace.mana_cost || '',
        type_line: advFace.type_line || '',
        oracle_text: advFace.oracle_text || '',
      };
    }

    // Detect transform (DFC) cards: layout === 'transform' or 'modal_dfc'
    let backFace = null;
    if ((card.layout === 'transform' || card.layout === 'modal_dfc') && card.card_faces && card.card_faces.length >= 2) {
      const bf = card.card_faces[1];
      backFace = {
        name: bf.name || '',
        mana_cost: bf.mana_cost || '',
        type_line: bf.type_line || '',
        oracle_text: bf.oracle_text || '',
        power: bf.power || null,
        toughness: bf.toughness || null,
        colors: bf.colors || [],
        keywords: bf.keywords || card.keywords || [],
        image_small: (bf.image_uris && bf.image_uris.small) || '',
        image_normal: (bf.image_uris && bf.image_uris.normal) || '',
        image_large: (bf.image_uris && bf.image_uris.large) || '',
      };
    }

    return {
      id: card.id,
      name: card.name,
      layout: card.layout || 'normal',
      mana_cost: face.mana_cost || card.mana_cost || '',
      cmc: card.cmc || 0,
      type_line: face.type_line || card.type_line || '',
      oracle_text: face.oracle_text || card.oracle_text || '',
      power: face.power || card.power || null,
      toughness: face.toughness || card.toughness || null,
      colors: face.colors || card.colors || [],
      color_identity: card.color_identity || [],
      rarity: card.rarity,
      keywords: card.keywords || [],
      image_small: (card.image_uris && card.image_uris.small) ||
                   (card.card_faces && card.card_faces[0].image_uris && card.card_faces[0].image_uris.small) || '',
      image_normal: (card.image_uris && card.image_uris.normal) ||
                    (card.card_faces && card.card_faces[0].image_uris && card.card_faces[0].image_uris.normal) || '',
      image_large: (card.image_uris && card.image_uris.large) ||
                   (card.card_faces && card.card_faces[0].image_uris && card.card_faces[0].image_uris.large) || '',
      collector_number: card.collector_number,
      set: card.set,
      loyalty: face.loyalty || card.loyalty || null,
      adventure: adventure,
      backFace: backFace
    };
  }
};
