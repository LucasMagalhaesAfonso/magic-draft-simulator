const Cache = {
  PREFIX: 'mtg_draft_',
  CARD_SCHEMA_VERSION: 2, // Increment when _simplifyCard changes (v2: adventure support)

  _checkSchemaVersion() {
    const key = this.PREFIX + 'schema_version';
    const stored = parseInt(localStorage.getItem(key) || '0');
    if (stored < this.CARD_SCHEMA_VERSION) {
      console.log(`Cache schema updated (v${stored} -> v${this.CARD_SCHEMA_VERSION}), clearing card caches...`);
      // Clear all set caches (not the sets list, just the card data)
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.PREFIX + 'set_')) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(key, String(this.CARD_SCHEMA_VERSION));
    }
  },

  getSetCards(setCode) {
    this._checkSchemaVersion();
    const key = this.PREFIX + 'set_' + setCode.toLowerCase();
    const data = localStorage.getItem(key);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed.timestamp && Date.now() - parsed.timestamp > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.cards;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  },

  saveSetCards(setCode, cards) {
    const key = this.PREFIX + 'set_' + setCode.toLowerCase();
    const data = { cards, timestamp: Date.now() };
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('Cache full, clearing old data...');
      this.clearOldest();
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        console.error('Could not cache set data');
      }
    }
  },

  getSets() {
    const key = this.PREFIX + 'sets_list';
    const data = localStorage.getItem(key);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed.timestamp && Date.now() - parsed.timestamp > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.sets;
    } catch {
      localStorage.removeItem(key);
      return null;
    }
  },

  saveSets(sets) {
    const key = this.PREFIX + 'sets_list';
    try {
      localStorage.setItem(key, JSON.stringify({ sets, timestamp: Date.now() }));
    } catch {
      console.warn('Could not cache sets list');
    }
  },

  clearOldest() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(this.PREFIX + 'set_')) {
        try {
          const d = JSON.parse(localStorage.getItem(k));
          keys.push({ key: k, timestamp: d.timestamp || 0 });
        } catch {
          keys.push({ key: k, timestamp: 0 });
        }
      }
    }
    keys.sort((a, b) => a.timestamp - b.timestamp);
    if (keys.length > 0) {
      localStorage.removeItem(keys[0].key);
    }
  },

  clearAll() {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(this.PREFIX)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }
};
