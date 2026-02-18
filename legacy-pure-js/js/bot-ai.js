/**
 * Bot AI for Draft Picks & Deck Building
 *
 * Uses BREAD (Bombs, Removal, Evasion, Aggro, Dregs) strategy,
 * color signal reading, mana curve awareness, and archetype tracking.
 *
 * Key principles:
 * - Stay open early (picks 1-4), commit to 2 colors by pick 6-8
 * - Read signals: late good cards = open color
 * - Never go 3+ colors unless splashing a bomb with fixing
 * - Prioritize removal and bombs over everything
 * - Maintain a healthy mana curve (peak at 2-3 CMC)
 */
const BotAI = {
  // =================== Constants ===================

  // Pick phases for color commitment
  PHASE_OPEN: 4,       // Stay open: picks 1-4
  PHASE_COMMIT: 8,     // Committing: picks 5-8
  PHASE_LOCKED: 99,    // Locked in: picks 9+

  // Ideal limited deck targets
  IDEAL_CREATURES: 15,
  IDEAL_SPELLS: 8,
  IDEAL_LANDS: 17,
  IDEAL_DECK_SIZE: 40,

  // BREAD-based power levels (independent of rarity)
  POWER_BOMB: 9.0,
  POWER_REMOVAL: 7.0,
  POWER_EVASION: 5.0,
  POWER_AGGRO: 3.5,
  POWER_FILLER: 2.0,
  POWER_DREG: 0.5,

  // Color penalty multipliers per phase
  COLOR_PENALTY: {
    open: { onColor: 0.5, partial: 0, offColor: -0.5, thirdColor: -1.0 },
    commit: { onColor: 2.5, partial: 1.0, offColor: -3.0, thirdColor: -5.0 },
    locked: { onColor: 3.5, partial: 1.5, offColor: -6.0, thirdColor: -8.0 }
  },

  // =================== Bot creation ===================

  createBot(id) {
    return {
      id,
      name: `Bot ${id}`,
      pool: [],
      // Color tracking
      colorPips: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      colorCount: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      // Curve tracking
      curveCounts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
      // Balance tracking
      creatureCount: 0,
      spellCount: 0,
      removalCount: 0,
      // Draft state
      pickCount: 0,
      packNumber: 0,   // Which pack round (0, 1, 2)
      pickInPack: 0,    // Which pick within current pack
      // Color commitment
      committedColors: null, // null = uncommitted, [color1, color2] when committed
      // Signal tracking: track what colors are being passed to us
      signals: { W: 0, U: 0, B: 0, R: 0, G: 0 },
      // Archetype tracking
      tribalCounts: {},  // { 'Goblin': 3, 'Elf': 5, ... }
      keywordCounts: {}  // { 'Flying': 4, 'Deathtouch': 2, ... }
    };
  },

  // =================== Main pick logic ===================

  pickCard(bot, pack) {
    if (pack.length === 0) return null;
    if (pack.length === 1) return this._doPick(bot, pack[0]);

    // Update signals from what's in the pack (late picks with good cards = signal)
    this._readSignals(bot, pack);

    let bestCard = pack[0];
    let bestScore = -Infinity;

    for (const card of pack) {
      const score = this._evaluateCard(bot, card);
      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }

    return this._doPick(bot, bestCard);
  },

  _doPick(bot, card) {
    bot.pool.push(card);
    bot.pickCount++;
    bot.pickInPack++;

    // Track colors (by pip count for accurate color weight)
    const mc = card.mana_cost || '';
    const pips = mc.match(/\{([WUBRG])\}/g) || [];
    pips.forEach(m => {
      const c = m.replace(/[{}]/g, '');
      if (bot.colorPips[c] !== undefined) bot.colorPips[c]++;
    });

    // Track color by card count too
    const colors = this._getCardColors(card);
    colors.forEach(c => { if (bot.colorCount[c] !== undefined) bot.colorCount[c]++; });

    // Track curve
    const cmcSlot = Math.min(Math.max(Math.ceil(card.cmc || 0), 0), 6);
    bot.curveCounts[cmcSlot] = (bot.curveCounts[cmcSlot] || 0) + 1;

    // Track creature/spell balance
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) {
      bot.creatureCount++;
    } else if (!typeLine.includes('land')) {
      bot.spellCount++;
      // Track removal
      const text = (card.oracle_text || '').toLowerCase();
      if (this._isRemoval(text, typeLine)) bot.removalCount++;
    }

    // Track tribal subtypes
    if (card.type_line && card.type_line.includes('—')) {
      const subtypes = card.type_line.split('—').pop().trim().split(' ');
      subtypes.forEach(st => {
        const s = st.trim();
        if (s.length > 2) {
          bot.tribalCounts[s] = (bot.tribalCounts[s] || 0) + 1;
        }
      });
    }

    // Track keywords
    (card.keywords || []).forEach(kw => {
      bot.keywordCounts[kw] = (bot.keywordCounts[kw] || 0) + 1;
    });

    // Try to commit colors if we haven't yet and have enough picks
    if (!bot.committedColors && bot.pickCount >= this.PHASE_OPEN) {
      this._tryCommitColors(bot);
    }

    return card;
  },

  // =================== Card Evaluation ===================

  _evaluateCard(bot, card) {
    let score = 0;

    // 1. Intrinsic card power (BREAD)
    score += this._cardPower(card);

    // 2. Color fit (biggest factor in preventing 5-color decks)
    score += this._colorFit(bot, card);

    // 3. Mana curve needs
    score += this._curveNeed(bot, card);

    // 4. Creature/spell balance
    score += this._balanceNeed(bot, card);

    // 5. Synergy (tribal, keywords, text)
    score += this._synergyFit(bot, card);

    // 6. Signal bonus (pick colors that are open)
    score += this._signalBonus(bot, card);

    return score;
  },

  // --- 1. Card Power (BREAD) ---
  _cardPower(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const typeLine = (card.type_line || '').toLowerCase();
    const keywords = (card.keywords || []).map(k => k.toLowerCase());
    const rarity = card.rarity || 'common';
    let score = 0;

    // Bombs: rares/mythics with game-winning effects
    if (this._isBomb(card, text, rarity)) {
      return this.POWER_BOMB + (rarity === 'mythic' ? 1.5 : 0);
    }

    // Removal: destroy/exile/damage target creature
    if (this._isRemoval(text, typeLine)) {
      score = this.POWER_REMOVAL;
      // Premium removal (unconditional, instant-speed)
      if (text.includes('destroy target creature') || text.includes('exile target creature')) {
        score += 1.0;
      }
      if (typeLine.includes('instant')) score += 0.5;
      // Conditional removal is worth less
      if (text.includes('deals') && text.includes('damage to target')) {
        const dmgMatch = text.match(/deals (\d+)/);
        if (dmgMatch && parseInt(dmgMatch[1]) <= 2) score -= 1.0; // Low damage
      }
      return score;
    }

    // Evasion creatures
    const hasEvasion = keywords.some(k =>
      ['flying', 'menace', 'trample', 'skulk', 'shadow', 'fear', 'intimidate'].includes(k)
    ) || text.includes("can't be blocked");

    if (typeLine.includes('creature')) {
      const power = parseInt(card.power) || 0;
      const toughness = parseInt(card.toughness) || 0;
      const cmc = card.cmc || 0;
      const statTotal = power + toughness;

      if (hasEvasion) {
        score = this.POWER_EVASION;
        // Better evasion creatures get more
        if (power >= 3) score += 0.5;
        if (keywords.includes('flying') && power >= 2) score += 0.5;
      } else if (statTotal >= cmc * 2 + 1 || power >= cmc) {
        // Efficiently-statted creature (good aggro)
        score = this.POWER_AGGRO;
      } else {
        // Below-rate creature
        score = this.POWER_FILLER;
      }

      // Keyword bonuses on creatures
      if (keywords.includes('deathtouch')) score += 1.5;
      if (keywords.includes('lifelink')) score += 1.0;
      if (keywords.includes('first strike') || keywords.includes('double strike')) score += 1.0;
      if (keywords.includes('vigilance')) score += 0.5;
      if (keywords.includes('haste')) score += 0.5;
      if (keywords.includes('reach')) score += 0.3;
      if (keywords.includes('flash')) score += 0.5;
      if (keywords.includes('hexproof')) score += 1.0;
      if (keywords.includes('indestructible')) score += 2.0;

      // ETB/triggered ability bonus
      if (text.includes('enters') || text.includes('when') || text.includes('whenever')) {
        if (text.includes('draw')) score += 1.5;
        if (text.includes('create') && text.includes('token')) score += 1.0;
        if (text.includes('destroy') || text.includes('exile')) score += 2.0;
        if (text.includes('deal') && text.includes('damage')) score += 1.0;
      }

      // Vanilla penalty
      if ((!card.oracle_text || card.oracle_text.trim() === '') && keywords.length === 0) {
        score -= 1.0;
      }

      return score;
    }

    // Non-creature spells
    if (text.includes('draw') && text.includes('card')) score += 3.0;
    if (text.includes('search your library for a basic land') || text.includes('add {')) score += 2.5;
    if (text.includes('create') && text.includes('token')) score += 2.5;
    if (text.includes('all creatures get') || text.includes('creatures you control get')) score += 2.0;

    // Auras are risky
    if (typeLine.includes('aura')) {
      score = Math.max(score, this.POWER_FILLER) - 0.5;
    }

    // Equipment is decent
    if (typeLine.includes('equipment')) {
      score = Math.max(score, this.POWER_AGGRO);
    }

    // Sagas are generally good
    if (typeLine.includes('saga')) {
      score = Math.max(score, this.POWER_EVASION);
    }

    return Math.max(score, this.POWER_DREG);
  },

  _isBomb(card, text, rarity) {
    if (rarity !== 'rare' && rarity !== 'mythic') return false;

    // Game-ending effects
    if (text.includes('you win the game')) return true;
    if (text.includes('each opponent loses')) return true;
    if (text.includes('destroy all') && !text.includes('you control')) return true;

    // Powerful rare creatures with big stats + abilities
    const typeLine = (card.type_line || '').toLowerCase();
    if (typeLine.includes('creature')) {
      const power = parseInt(card.power) || 0;
      const toughness = parseInt(card.toughness) || 0;
      const keywords = (card.keywords || []).map(k => k.toLowerCase());

      // Big creatures with keywords
      if (power + toughness >= 8 && keywords.length >= 1) return true;
      if (power >= 5 && keywords.includes('flying')) return true;
      if (power >= 4 && keywords.includes('trample') && keywords.includes('haste')) return true;

      // Creatures that generate major advantage
      if (text.includes('draw') && text.includes('card') && (text.includes('whenever') || text.includes('each'))) return true;
      if (text.includes('create') && text.includes('token') && text.includes('whenever')) return true;
    }

    // Planeswalkers
    if (typeLine.includes('planeswalker')) return true;

    // Rares with card draw engines
    if (rarity === 'rare' && text.includes('draw') && text.includes('each') && text.includes('turn')) return true;

    return false;
  },

  _isRemoval(text, typeLine) {
    if (text.includes('destroy target creature')) return true;
    if (text.includes('destroy target nonland')) return true;
    if (text.includes('exile target creature')) return true;
    if (text.includes('exile target nonland')) return true;
    if (/deals \d+ damage to (target|any)/.test(text)) return true;
    if (text.includes('target creature gets -') && text.includes('until end of turn')) return true;
    if (text.includes('fight')) return true;
    if (text.includes("target creature's owner")) return true;
    return false;
  },

  // --- 2. Color Fit (most important for avoiding 5-color) ---
  _colorFit(bot, card) {
    const colors = this._getCardColors(card);

    // Colorless cards are always welcome
    if (colors.length === 0) return 1.0;

    // Determine phase
    const phase = bot.pickCount < this.PHASE_OPEN ? 'open'
      : bot.pickCount < this.PHASE_COMMIT ? 'commit'
      : 'locked';

    const penalties = this.COLOR_PENALTY[phase];
    const topColors = bot.committedColors || this._getTopColors(bot, 2);

    if (topColors.length === 0) {
      // No color preference yet - slight bonus for mono-color cards
      return colors.length === 1 ? 0.3 : 0;
    }

    // Check color overlap
    const onColorCount = colors.filter(c => topColors.includes(c)).length;

    if (onColorCount === colors.length) {
      // Fully on-color
      return penalties.onColor;
    } else if (onColorCount > 0) {
      // Partially on-color (e.g., WB card in a WU deck)
      // In locked phase, only accept if the card is really powerful
      if (phase === 'locked') return penalties.partial;
      return penalties.partial;
    } else {
      // Completely off-color
      // Count how many distinct colors we'd be adding
      const currentColors = new Set(topColors);
      const newColors = colors.filter(c => !currentColors.has(c));

      if (newColors.length > 0 && currentColors.size >= 2) {
        // This would be a 3rd+ color = very bad
        return penalties.thirdColor;
      }
      return penalties.offColor;
    }
  },

  // --- 3. Mana Curve Needs ---
  _curveNeed(bot, card) {
    const typeLine = (card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) return 0;

    const cmc = Math.ceil(card.cmc || 0);
    const totalCreatures = bot.creatureCount;

    // Early in draft, less strict about curve
    if (totalCreatures < 5) return 0;

    // 2-drops are king in limited
    if (cmc === 2 && bot.curveCounts[2] < 5) return 2.0;
    if (cmc === 2 && bot.curveCounts[2] < 3) return 3.0;

    // 3-drops are second most important
    if (cmc === 3 && bot.curveCounts[3] < 4) return 1.5;
    if (cmc === 3 && bot.curveCounts[3] < 2) return 2.5;

    // Some 4-drops
    if (cmc === 4 && bot.curveCounts[4] < 3) return 1.0;

    // 1-drops are nice but not essential
    if (cmc === 1 && bot.curveCounts[1] < 2) return 0.5;

    // 5+ drops: want 2-3 total, not more
    const highCmc = (bot.curveCounts[5] || 0) + (bot.curveCounts[6] || 0);
    if (cmc >= 5 && highCmc < 2) return 0.5;
    if (cmc >= 5 && highCmc >= 3) return -2.0;
    if (cmc >= 6 && highCmc >= 2) return -2.5;

    // Penalty for too many at same slot
    if (bot.curveCounts[cmc] >= 5) return -1.5;

    return 0;
  },

  // --- 4. Creature/Spell Balance ---
  _balanceNeed(bot, card) {
    const typeLine = (card.type_line || '').toLowerCase();
    const isCreature = typeLine.includes('creature');
    const isLand = typeLine.includes('land');
    if (isLand) return 0;

    const total = bot.creatureCount + bot.spellCount;
    if (total < 6) return 0; // Too early

    const creatureRatio = bot.creatureCount / total;

    // Target: ~65% creatures (15 creatures / 23 spells)
    if (isCreature) {
      if (creatureRatio < 0.50) return 2.0;  // Desperately need creatures
      if (creatureRatio < 0.60) return 1.0;  // Could use creatures
      if (creatureRatio > 0.75) return -1.0; // Too many creatures
    } else {
      if (creatureRatio > 0.70) return 1.5;  // Need spells
      if (creatureRatio > 0.65) return 0.5;  // Could use spells
      if (creatureRatio < 0.45) return -1.0; // Too many spells
    }

    // Bonus for first few removal spells
    if (!isCreature && bot.removalCount < 3 && this._isRemoval(
      (card.oracle_text || '').toLowerCase(),
      typeLine
    )) {
      return 1.0;
    }

    return 0;
  },

  // --- 5. Synergy (tribal, keywords, archetype) ---
  _synergyFit(bot, card) {
    let bonus = 0;
    const text = (card.oracle_text || '').toLowerCase();
    const keywords = (card.keywords || []).map(k => k.toLowerCase());

    // Tribal synergy
    if (card.type_line && card.type_line.includes('—')) {
      const subtypes = card.type_line.split('—').pop().trim().split(' ');
      for (const st of subtypes) {
        const s = st.trim();
        if (s.length > 2 && bot.tribalCounts[s]) {
          const count = bot.tribalCounts[s];
          // Tribal gets better with more of the same type
          if (count >= 4) bonus += 2.0;
          else if (count >= 2) bonus += 1.0;
          else bonus += 0.3;
        }
      }
    }

    // Cards that reference creature types we have
    for (const [type, count] of Object.entries(bot.tribalCounts)) {
      if (count >= 2 && type.length > 3 && text.includes(type.toLowerCase())) {
        bonus += 1.5; // Card synergizes with our tribal theme
      }
    }

    // Keyword synergy (e.g., lots of flying = more flying is better)
    for (const kw of keywords) {
      if (bot.keywordCounts[kw] && bot.keywordCounts[kw] >= 2) {
        bonus += 0.3;
      }
    }

    // Text-based synergy: payoffs for having certain types
    if (text.includes('for each creature') || text.includes('creature you control')) {
      const creatureCount = bot.creatureCount;
      if (creatureCount >= 8) bonus += 1.5;
    }

    return Math.min(bonus, 3.0);
  },

  // --- 6. Signal Reading ---
  _signalBonus(bot, card) {
    if (bot.pickCount < 3) return 0; // Too early for signals

    const colors = this._getCardColors(card);
    if (colors.length === 0) return 0;

    let signalBonus = 0;
    for (const c of colors) {
      // Positive signal = this color is being passed to us
      signalBonus += (bot.signals[c] || 0) * 0.3;
    }

    return Math.min(signalBonus, 1.5);
  },

  _readSignals(bot, pack) {
    // Signals work best from picks 4-8 (mid-pack)
    if (bot.pickInPack < 3 || bot.pickInPack > 10) return;

    // Count good cards still in pack by color
    for (const card of pack) {
      const power = this._cardPower(card);
      // If a good card (power >= 5) is still in pack at pick 5+, its color is open
      if (power >= 5.0 && bot.pickInPack >= 4) {
        const colors = this._getCardColors(card);
        colors.forEach(c => {
          if (bot.signals[c] !== undefined) {
            bot.signals[c] += (power >= 7.0) ? 2 : 1;
          }
        });
      }
    }
  },

  // =================== Color Management ===================

  _tryCommitColors(bot) {
    // Get top 2 colors by combined weight (pips + card count + signals)
    const colorScores = {};
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      colorScores[c] = (bot.colorPips[c] || 0) * 2
        + (bot.colorCount[c] || 0) * 1.5
        + (bot.signals[c] || 0) * 0.5;
    }

    const sorted = Object.entries(colorScores)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    if (sorted.length >= 2) {
      // Commit if top 2 colors are significantly ahead
      const top = sorted[0][1];
      const second = sorted[1][1];
      const third = sorted[2] ? sorted[2][1] : 0;

      // Commit when top 2 are clearly ahead of the rest
      if (top + second > third * 3 && bot.pickCount >= this.PHASE_OPEN) {
        bot.committedColors = [sorted[0][0], sorted[1][0]];
      }
    } else if (sorted.length === 1 && bot.pickCount >= this.PHASE_COMMIT) {
      // Only one color so far, commit to it + best signal
      const signalSort = Object.entries(bot.signals)
        .filter(([c]) => c !== sorted[0][0] && bot.signals[c] > 0)
        .sort((a, b) => b[1] - a[1]);
      if (signalSort.length > 0) {
        bot.committedColors = [sorted[0][0], signalSort[0][0]];
      }
    }
  },

  _getCardColors(card) {
    if (card.colors && card.colors.length > 0) return card.colors;
    if (card.color_identity && card.color_identity.length > 0) return card.color_identity;

    const colors = [];
    const mc = card.mana_cost || '';
    if (mc.includes('W')) colors.push('W');
    if (mc.includes('U')) colors.push('U');
    if (mc.includes('B')) colors.push('B');
    if (mc.includes('R')) colors.push('R');
    if (mc.includes('G')) colors.push('G');
    return colors;
  },

  _getTopColors(bot, count) {
    // Combine pip count + card count for ranking
    const scores = {};
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      scores[c] = (bot.colorPips[c] || 0) * 2 + (bot.colorCount[c] || 0);
    }
    return Object.entries(scores)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([k]) => k);
  },

  // =================== Pack number tracking ===================
  // Called by Draft when a new round starts
  newPack(bot) {
    bot.packNumber++;
    bot.pickInPack = 0;
  },

  // =================== Deck Building ===================

  /**
   * Build the best 40-card deck from a pool.
   * Strategy:
   * 1. Determine the best 2-color pair
   * 2. Score all on-color cards
   * 3. Select best 23 non-land cards respecting curve + balance
   * 4. Add 17 lands with proper distribution
   *
   * Returns { deck: Card[], lands: {W,U,B,R,G}, sideboard: Card[] }
   */
  buildDeck(pool) {
    if (!pool || pool.length === 0) return { deck: [], lands: { W: 0, U: 0, B: 0, R: 0, G: 0 }, sideboard: [] };

    // 1. Find the best 2-color pair
    const bestColors = this._findBestColorPair(pool);

    // 2. Separate on-color vs off-color cards
    const onColor = [];
    const splashable = [];
    const offColor = [];

    for (const card of pool) {
      const typeLine = (card.type_line || '').toLowerCase();
      if (typeLine.includes('land') && !typeLine.includes('basic')) {
        onColor.push(card); // Non-basic lands are fine
        continue;
      }

      const colors = this._getCardColors(card);
      if (colors.length === 0) {
        onColor.push(card); // Colorless always included
      } else if (colors.every(c => bestColors.includes(c))) {
        onColor.push(card); // Fully on-color
      } else if (colors.some(c => bestColors.includes(c))) {
        // Partially on-color - only splashable if it's very powerful
        const power = this._cardPower(card);
        if (power >= this.POWER_REMOVAL) {
          splashable.push(card); // Bomb/removal in partial color
        } else {
          offColor.push(card);
        }
      } else {
        offColor.push(card);
      }
    }

    // 3. Score and sort on-color cards
    const scored = onColor
      .filter(c => !(c.type_line || '').toLowerCase().includes('basic land'))
      .map(card => ({
        card,
        score: this._deckBuildScore(card, bestColors)
      }))
      .sort((a, b) => b.score - a.score);

    // 4. Select cards respecting curve and balance
    const deck = this._selectDeckCards(scored, splashable);

    // 5. Calculate lands
    const lands = this._calculateLands(deck, bestColors);

    // 6. Remaining cards are sideboard
    const deckUids = new Set(deck.map(c => c._uid));
    const sideboard = pool.filter(c => !deckUids.has(c._uid));

    return { deck, lands, sideboard };
  },

  _findBestColorPair(pool) {
    // Score each card for intrinsic power
    const cardScores = pool.map(card => ({
      card,
      score: this._cardPower(card),
      colors: this._getCardColors(card)
    }));

    // Try all 10 color pairs and score each
    const colorPairs = [
      ['W', 'U'], ['W', 'B'], ['W', 'R'], ['W', 'G'],
      ['U', 'B'], ['U', 'R'], ['U', 'G'],
      ['B', 'R'], ['B', 'G'],
      ['R', 'G']
    ];

    let bestPair = ['W', 'U'];
    let bestPairScore = -Infinity;

    for (const [c1, c2] of colorPairs) {
      let pairScore = 0;
      let pairCreatures = 0;
      let pairSpells = 0;
      let pairRemoval = 0;
      const pairCards = [];

      for (const { card, score, colors } of cardScores) {
        if (colors.length === 0 || colors.every(c => c === c1 || c === c2)) {
          pairCards.push({ card, score });
          const tl = (card.type_line || '').toLowerCase();
          if (tl.includes('creature')) pairCreatures++;
          else if (!tl.includes('land')) {
            pairSpells++;
            if (this._isRemoval((card.oracle_text || '').toLowerCase(), tl)) pairRemoval++;
          }
        }
      }

      // Need enough playable cards
      if (pairCards.length < 18) continue;

      // Score = sum of top 23 cards' power
      pairCards.sort((a, b) => b.score - a.score);
      const top23 = pairCards.slice(0, 23);
      pairScore = top23.reduce((sum, c) => sum + c.score, 0);

      // Bonus for good creature ratio (14-17 creatures out of 23)
      const creatureTarget = Math.min(pairCreatures, 17);
      if (creatureTarget >= 13 && creatureTarget <= 17) pairScore += 5;
      if (creatureTarget < 10) pairScore -= 10;

      // Bonus for having removal
      if (pairRemoval >= 3) pairScore += 5;
      if (pairRemoval >= 1) pairScore += 2;

      // Bonus for curve (check 2-drops)
      const twos = pairCards.filter(c =>
        Math.ceil(c.card.cmc || 0) === 2 && (c.card.type_line || '').toLowerCase().includes('creature')
      ).length;
      if (twos >= 3) pairScore += 3;
      if (twos < 2) pairScore -= 3;

      if (pairScore > bestPairScore) {
        bestPairScore = pairScore;
        bestPair = [c1, c2];
      }
    }

    return bestPair;
  },

  _deckBuildScore(card, colors) {
    let score = this._cardPower(card);
    const cmc = Math.ceil(card.cmc || 0);
    const typeLine = (card.type_line || '').toLowerCase();

    // Rarity tiebreaker
    const rarityBonus = { mythic: 0.3, rare: 0.2, uncommon: 0.1, common: 0 };
    score += rarityBonus[card.rarity] || 0;

    // Small bonus for on-color vs colorless
    const cardColors = this._getCardColors(card);
    if (cardColors.length > 0 && cardColors.every(c => colors.includes(c))) {
      score += 0.1;
    }

    return score;
  },

  _selectDeckCards(scoredCards, splashable) {
    const deck = [];
    let creatures = 0;
    let spells = 0;
    const cmcBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    // First pass: add best cards
    for (const { card, score } of scoredCards) {
      if (deck.length >= 23) break;

      const typeLine = (card.type_line || '').toLowerCase();
      if (typeLine.includes('basic land')) continue;

      const isCreature = typeLine.includes('creature');
      const cmc = Math.min(Math.max(Math.ceil(card.cmc || 0), 1), 6);

      // Check if we should skip due to curve
      const highCmc = (cmcBuckets[5] || 0) + (cmcBuckets[6] || 0);
      if (cmc >= 5 && highCmc >= 3 && score < this.POWER_REMOVAL) continue;
      if (cmc >= 6 && highCmc >= 2 && score < this.POWER_REMOVAL) continue;

      // Check creature/spell balance (removal always gets through)
      const isRemoval = !isCreature && this._isRemoval((card.oracle_text || '').toLowerCase(), typeLine);
      if (isCreature && creatures >= 18 && score < this.POWER_EVASION) continue;
      if (!isCreature && spells >= 10 && score < this.POWER_EVASION && !isRemoval) continue;

      deck.push(card);
      if (isCreature) creatures++;
      else spells++;
      cmcBuckets[cmc] = (cmcBuckets[cmc] || 0) + 1;
    }

    // If we still have room, add splashable bombs
    if (deck.length < 23) {
      const scoredSplash = splashable
        .map(card => ({ card, score: this._cardPower(card) }))
        .sort((a, b) => b.score - a.score);

      for (const { card } of scoredSplash) {
        if (deck.length >= 23) break;
        deck.push(card);
      }
    }

    // If still short, fill from remaining scored cards (relaxed constraints)
    if (deck.length < 23) {
      for (const { card } of scoredCards) {
        if (deck.length >= 23) break;
        if (deck.includes(card)) continue;
        const typeLine = (card.type_line || '').toLowerCase();
        if (typeLine.includes('basic land')) continue;
        deck.push(card);
      }
    }

    return deck;
  },

  _calculateLands(deck, mainColors) {
    const lands = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const pipCounts = { W: 0, U: 0, B: 0, R: 0, G: 0 };

    // Count colored pips in deck (non-land cards only)
    // Also track non-basic lands that produce colors (dual lands, etc.)
    const dualLandColors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let nonBasicLandCount = 0;

    for (const card of deck) {
      const typeLine = (card.type_line || '').toLowerCase();
      if (typeLine.includes('land') && !typeLine.includes('basic land')) {
        // Non-basic land in deck: count its color contribution
        nonBasicLandCount++;
        const landColors = typeof ManaSystem !== 'undefined'
          ? ManaSystem.getLandManaColors(card)
          : (card.color_identity || []);
        for (const c of landColors) {
          if (dualLandColors[c] !== undefined) dualLandColors[c]++;
        }
        continue;
      }

      const mc = card.mana_cost || '';
      const pips = mc.match(/\{([WUBRG])\}/g) || [];
      pips.forEach(m => {
        const c = m.replace(/[{}]/g, '');
        if (pipCounts[c] !== undefined) pipCounts[c]++;
      });
    }

    const totalPips = Object.values(pipCounts).reduce((a, b) => a + b, 0);
    // Reduce basic land count by non-basic lands already in deck
    const totalLands = Math.max(0, this.IDEAL_LANDS - nonBasicLandCount);

    if (totalPips === 0) {
      // All colorless? Split between main colors
      const half = Math.ceil(totalLands / 2);
      lands[mainColors[0]] = half;
      lands[mainColors[1]] = totalLands - half;
      return lands;
    }

    // Adjust pip needs: subtract dual land contributions
    const adjustedPips = { ...pipCounts };
    for (const [color, count] of Object.entries(dualLandColors)) {
      if (adjustedPips[color] > 0) {
        adjustedPips[color] = Math.max(0, adjustedPips[color] - count);
      }
    }
    const adjustedTotal = Object.values(adjustedPips).reduce((a, b) => a + b, 0);

    // Distribute basic lands proportionally to remaining pip needs
    const activeColors = Object.entries(adjustedTotal > 0 ? adjustedPips : pipCounts)
      .filter(([, v]) => v > 0);

    const distTotal = adjustedTotal > 0 ? adjustedTotal : totalPips;
    for (const [color, pips] of activeColors) {
      lands[color] = Math.max(1, Math.round((pips / distTotal) * totalLands));
    }

    // Limit splash colors to 2-3 lands max (but dual lands already cover some)
    for (const [color] of activeColors) {
      if (!mainColors.includes(color)) {
        const dualCoverage = dualLandColors[color] || 0;
        lands[color] = Math.min(lands[color], Math.max(0, 3 - dualCoverage));
      }
    }

    // Adjust total to exactly totalLands
    let currentTotal = Object.values(lands).reduce((a, b) => a + b, 0);
    const sortedLands = Object.entries(lands)
      .filter(([, v]) => v > 0)
      .sort((a, b) => {
        // Prefer adjusting main colors
        const aMain = mainColors.includes(a[0]) ? 1 : 0;
        const bMain = mainColors.includes(b[0]) ? 1 : 0;
        if (aMain !== bMain) return bMain - aMain;
        return b[1] - a[1];
      });

    while (currentTotal > totalLands) {
      for (const entry of sortedLands) {
        if (entry[1] > 1 && currentTotal > totalLands) {
          entry[1]--;
          lands[entry[0]]--;
          currentTotal--;
        }
      }
      if (currentTotal > totalLands) break; // Safety
    }
    while (currentTotal < totalLands) {
      // Add to the main color with most pips
      const mainColor = pipCounts[mainColors[0]] >= pipCounts[mainColors[1]]
        ? mainColors[0] : mainColors[1];
      lands[mainColor]++;
      currentTotal++;
    }

    return lands;
  }
};
