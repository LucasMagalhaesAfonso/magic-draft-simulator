const Booster = {
  MYTHIC_CHANCE: 1 / 7.4,

  _isBasicLand(card) {
    const tl = (card.type_line || '').toLowerCase();
    return tl.includes('basic') && tl.includes('land');
  },

  generate(cardPool) {
    // Exclude basic lands from common pool (they're not in real booster packs)
    const byRarity = {
      common: cardPool.filter(c => c.rarity === 'common' && !this._isBasicLand(c)),
      uncommon: cardPool.filter(c => c.rarity === 'uncommon'),
      rare: cardPool.filter(c => c.rarity === 'rare'),
      mythic: cardPool.filter(c => c.rarity === 'mythic')
    };

    const pack = [];
    const usedIds = new Set();

    const pickRandom = (pool, count) => {
      const available = pool.filter(c => !usedIds.has(c.id));
      const picked = this._shuffle(available).slice(0, count);
      picked.forEach(c => usedIds.add(c.id));
      return picked;
    };

    // 1 Rare or Mythic
    const isMythic = Math.random() < this.MYTHIC_CHANCE && byRarity.mythic.length > 0;
    const rareSlot = pickRandom(isMythic ? byRarity.mythic : byRarity.rare, 1);
    pack.push(...rareSlot);

    // 3 Uncommons
    pack.push(...pickRandom(byRarity.uncommon, 3));

    // 10 Commons
    pack.push(...pickRandom(byRarity.common, 10));

    return pack;
  },

  generateMultiple(cardPool, count) {
    const packs = [];
    for (let i = 0; i < count; i++) {
      packs.push(this.generate(cardPool));
    }
    return packs;
  },

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
};
