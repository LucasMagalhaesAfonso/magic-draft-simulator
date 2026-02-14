const CardEngine = {
  // ========== PRE-PROCESSED EFFECTS (AI-generated) ==========

  // Get effects from pre-processed database or AI cache, returns null if not found
  // Priority: 1. CardEffectsDB (static) -> 2. AIProcessor cache (dynamic)
  getPreprocessedEffects(card) {
    try {
      // First check static database
      if (typeof CardEffectsDB !== 'undefined') {
        const cardKey = card.name.toLowerCase();
        if (CardEffectsDB[cardKey]) {
          return CardEffectsDB[cardKey];
        }
      }
    } catch (e) { /* CardEffectsDB may be in TDZ if script failed to load */ }
    try {
      // Then check AI processor cache
      if (typeof AIProcessor !== 'undefined' && AIProcessor.isInCache(card.name)) {
        return AIProcessor.getFromCache(card.name);
      }
    } catch (e) { /* AIProcessor may be in TDZ */ }
    return null;
  },

  // Process a card with AI if not in cache and API is configured
  // Returns promise that resolves to effects or null
  async processWithAI(card) {
    if (typeof AIProcessor === 'undefined') return null;
    if (!AIProcessor.isConfigured()) return null;
    if (AIProcessor.isInCache(card.name)) {
      return AIProcessor.getFromCache(card.name);
    }
    return await AIProcessor.processCard(card);
  },

  // Check if a card has any effects (from any source)
  hasAnyEffects(card) {
    const db = this.getPreprocessedEffects(card);
    if (db) return true;

    // Check regex parsing
    const etb = this.parseETBEffects(card);
    if (etb && etb.length > 0) return true;

    const triggered = this.parseTriggeredAbilities(card);
    if (triggered && triggered.length > 0) return true;

    const activated = this.parseActivatedAbilities(card);
    if (activated && activated.length > 0) return true;

    return false;
  },

  // Get ETB effects - check database first, then fallback to regex
  getETBEffects(card) {
    const db = this.getPreprocessedEffects(card);
    if (db) {
      // Modal ETB (Siege enchantments): inject modal choice on enter
      if (db.modal && db.modal.chooseOnETB && db.modal.modes) {
        // Normalize modes: Siege modes have { label, effects: [...] } — extract effects arrays
        const normalizedModes = db.modal.modes.map(m => {
          if (m.effects && Array.isArray(m.effects)) return m.effects;
          return [m];
        });
        return [{ type: 'modal', modes: normalizedModes, chooseTwo: false, isETBModal: true }];
      }
      if (db.etb) return db.etb;
    }
    return this.parseETBEffects(card);
  },

  // Get spell effects (for instants/sorceries) - check database first
  getSpellEffects(card) {
    const db = this.getPreprocessedEffects(card);
    console.log(`[SPELL EFFECTS DEBUG] Card: ${card.name}, DB found:`, !!db, db ? 'cast:' : 'no db', db?.cast);
    if (db) {
      // If card is modal, inject a modal effect with modes
      if (db.modal && db.modes) {
        return [{ type: 'modal', modes: db.modes, chooseTwo: db.chooseTwo || false }];
      }
      if (db.cast) {
        console.log('[SPELL EFFECTS DEBUG] Returning db.cast:', db.cast);
        return db.cast;
      }
    }
    console.log('[SPELL EFFECTS DEBUG] Falling back to parseSpellEffects');
    return this.parseSpellEffects(card);
  },

  // Get triggered abilities - check database first
  getTriggeredAbilities(card) {
    const db = this.getPreprocessedEffects(card);
    if (db && db.triggered) return db.triggered;
    return this.parseTriggeredAbilities(card);
  },

  // Get activated abilities - check database first (excludes loyalty and graveyard abilities)
  getActivatedAbilities(card) {
    // If creature loses all abilities (e.g., Fresh Start), return empty
    if (card._losesAllAbilities) return [];

    const db = this.getPreprocessedEffects(card);
    if (db && db.activated) return db.activated.filter(a =>
      (!a.cost || !a.cost.zone || a.cost.zone !== 'graveyard') &&
      (!a.cost || a.cost.loyalty === undefined)
    );

    // Special handling for tokens with built-in activated abilities
    if (card._isToken && card.name && card.name.toLowerCase() === 'treasure') {
      return [{
        cost: { tap: true, sacrifice: true },
        effects: [{ type: "add_mana", colors: ["W", "U", "B", "R", "G"], choose: 1 }],
        text: "{T}, Sacrifice this artifact: Add one mana of any color."
      }];
    }

    return this.parseActivatedAbilities(card);
  },

  // Get mana-generating abilities (for smart auto-tap)
  getManaAbilities(card) {
    const abilities = [];
    const allAbilities = this.getActivatedAbilities(card);

    for (const ability of allAbilities) {
      // Check if this ability generates mana
      if (ability.effects && Array.isArray(ability.effects)) {
        const hasManaEffect = ability.effects.some(e => e.type === 'add_mana');
        if (hasManaEffect) {
          abilities.push(ability);
        }
      }
    }

    return abilities;
  },

  // Get loyalty abilities (planeswalker only)
  getLoyaltyAbilities(card) {
    const db = this.getPreprocessedEffects(card);
    if (db && db.activated) return db.activated.filter(a => a.cost && a.cost.loyalty !== undefined);
    return [];
  },

  // Get starting loyalty for a planeswalker
  getStartingLoyalty(card) {
    if (card.loyalty) return parseInt(card.loyalty) || 0;
    // Fallback: infer from abilities (max positive cost + 1 as rough estimate)
    const abilities = this.getLoyaltyAbilities(card);
    if (abilities.length > 0) {
      const maxPositive = Math.max(0, ...abilities.map(a => a.cost.loyalty || 0));
      return maxPositive + 2; // reasonable default
    }
    return 3; // generic default
  },

  // Get graveyard-activated abilities (renew mechanic)
  getGraveyardAbilities(card) {
    const db = this.getPreprocessedEffects(card);
    const abilities = [];
    if (db && db.activated) abilities.push(...db.activated.filter(a => a.cost && a.cost.zone === 'graveyard'));
    if (db && db.graveyard) abilities.push(...db.graveyard);
    return abilities;
  },

  // === Harmonize (cast from graveyard) ===

  getHarmonizeCost(card) {
    // Check DB first
    const db = this.getPreprocessedEffects(card);
    if (db && db.harmonize) return db.harmonize;
    // Check oracle_text for harmonize keyword
    const text = (card.oracle_text || '');
    const match = text.match(/[Hh]armonize\s+((?:\{[^}]+\})+)/);
    if (match) return match[1];
    // Check if card was granted harmonize (by Songcrafter Mage)
    if (card._harmonizeGranted) return card.mana_cost || '{0}';
    return null;
  },

  hasHarmonize(card) {
    return this.getHarmonizeCost(card) !== null;
  },

  getHarmonizeCMC(card) {
    const cost = this.getHarmonizeCost(card);
    if (!cost) return 0;
    const parsed = ManaSystem.parseCost(cost);
    return parsed.total || 0;
  },

  // Get additional costs - check database first
  getAdditionalCosts(card) {
    const db = this.getPreprocessedEffects(card);
    if (db && db.additional_costs) return db.additional_costs;
    return this.parseAdditionalCosts(card);
  },

  // ========== HELPERS ==========

  // Helper: convert word numbers ("two", "three") and digit strings to integers
  _wordToNum(word) {
    if (!word) return null;
    const map = {a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10};
    return map[word.toLowerCase()] || parseInt(word) || null;
  },

  hasKeyword(card, keyword, gameState = null) {
    // Check regular keywords
    if ((card.keywords || []).some(k => k && typeof k === 'string' && k.toLowerCase() === keyword.toLowerCase())) {
      return true;
    }

    // Check keyword counters
    if (card._counters) {
      const kwLower = keyword.toLowerCase();
      if (card._counters[kwLower] && card._counters[kwLower] > 0) {
        return true;
      }
    }

    // Check temporary keywords (end-of-turn grants)
    if (card._tempKeywords && card._tempKeywords.some(k => k && typeof k === 'string' && k.toLowerCase() === keyword.toLowerCase())) {
      return true;
    }

    // Check grants (requires gameState)
    if (gameState && card._isToken && card._attacking) {
      // For attacking tokens, check if any creature grants them keywords
      const cardController = this._findCardController(gameState, card);
      if (cardController !== null) {
        const battlefield = gameState.players[cardController].zones.battlefield.cards;
        for (const granter of battlefield) {
          if (granter._grantAttackingTokens && typeof granter._grantAttackingTokens === 'string' && granter._grantAttackingTokens.toLowerCase() === keyword.toLowerCase()) {
            return true;
          }
        }
      }
    }

    return false;
  },

  // Helper to find which player controls a card
  _findCardController(gameState, card) {
    for (let pid = 0; pid < gameState.players.length; pid++) {
      const bf = gameState.players[pid].zones.battlefield.cards;
      if (bf.some(c => c._uid === card._uid)) {
        return pid;
      }
    }
    return null;
  },

  isCreature(card) {
    return (card.type_line || '').includes('Creature');
  },

  isLand(card) {
    return (card.type_line || '').includes('Land');
  },

  isInstant(card) {
    return (card.type_line || '').includes('Instant');
  },

  isSorcery(card) {
    return (card.type_line || '').includes('Sorcery');
  },

  isEnchantment(card) {
    return (card.type_line || '').includes('Enchantment');
  },

  isSaga(card) {
    return (card.type_line || '').toLowerCase().includes('saga');
  },

  getSagaChapters(card) {
    const db = this.getPreprocessedEffects(card);
    if (db && db.saga && db.chapters) return db.chapters;
    return null;
  },

  isArtifact(card) {
    return (card.type_line || '').includes('Artifact');
  },

  isPlaneswalker(card) {
    return (card.type_line || '').includes('Planeswalker');
  },

  isPermanent(card) {
    return !this.isInstant(card) && !this.isSorcery(card);
  },

  isBasicLand(card) {
    return (card.type_line || '').includes('Basic Land');
  },

  // Adventure support
  hasAdventure(card) {
    return !!(card.adventure && card.adventure.name);
  },

  isAdventureInstant(card) {
    return this.hasAdventure(card) && (card.adventure.type_line || '').includes('Instant');
  },

  isAdventureSorcery(card) {
    return this.hasAdventure(card) && (card.adventure.type_line || '').includes('Sorcery');
  },

  getAdventureCost(card) {
    return card.adventure ? card.adventure.mana_cost : '';
  },

  getAdventureCMC(card) {
    if (!card.adventure) return 0;
    const parsed = ManaSystem.parseCost(card.adventure.mana_cost);
    return parsed.total || 0;
  },

  getPower(card) {
    let p = parseInt(card.power);
    // Vivid: * power = number of colors among your permanents
    if (isNaN(p) && card._vividPower) {
      p = card._vividPowerValue || 0;
    }
    // power_equals: * power = dynamic value (e.g. creature count)
    if (isNaN(p) && card._dynamicPower != null) {
      p = card._dynamicPower;
    }
    return isNaN(p) ? 0 : p + (card._powerMod || 0) + (card._counters ? card._counters['+1/+1'] - card._counters['-1/-1'] : 0);
  },

  getToughness(card) {
    const t = parseInt(card.toughness);
    return isNaN(t) ? 0 : t + (card._toughnessMod || 0) + (card._counters ? card._counters['+1/+1'] - card._counters['-1/-1'] : 0);
  },

  // Check if card has Vivid-based P/T (*/N or N/*)
  hasVividPT(card) {
    const text = (card.oracle_text || '').toLowerCase();
    return (card.power === '*' || card.toughness === '*') && text.includes('vivid');
  },

  canAttack(card) {
    if (!this.isCreature(card)) return false;
    if (card._tapped) return false;
    if (this.hasKeyword(card, 'Defender')) return false;
    if (card._summoningSick && !this.hasKeyword(card, 'Haste')) return false;
    return true;
  },

  canBlock(card, attacker, gameState = null) {
    if (!this.isCreature(card)) return false;
    if (card._tapped) return false;
    if (card._cantBlockThisTurn) return false;

    // Unblockable: attacker with unblockable static or keyword can't be blocked
    if (attacker._unblockable || this.hasKeyword(attacker, 'Unblockable', gameState)) return false;

    // Flying - can only be blocked by flying or reach
    if (this.hasKeyword(attacker, 'Flying', gameState)) {
      if (!this.hasKeyword(card, 'Flying', gameState) && !this.hasKeyword(card, 'Reach', gameState)) {
        return false;
      }
    }

    return true;
  },

  parseSpellEffects(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const effects = [];

    // --- Damage ---
    const dmgMatch = text.match(/deals? (\d+) damage to (any target|(?:target )?(creature|player|opponent|creature or player|creature or planeswalker))/);
    if (dmgMatch) {
      let dmgTarget = dmgMatch[2];
      if (dmgTarget !== 'any target') dmgTarget = dmgTarget.replace(/^target /, '');
      effects.push({
        type: 'damage',
        amount: parseInt(dmgMatch[1]),
        target: dmgTarget
      });
    }

    // Damage to each creature (board-wide damage)
    const dmgAllMatch = text.match(/deals? (\d+) damage to each creature/);
    if (dmgAllMatch) {
      effects.push({ type: 'damage_all_creatures', amount: parseInt(dmgAllMatch[1]) });
    }

    // Damage to each opponent
    const dmgOppMatch = text.match(/deals? (\d+) damage to each opponent/);
    if (dmgOppMatch) {
      effects.push({ type: 'damage', amount: parseInt(dmgOppMatch[1]), target: 'opponent' });
    }

    // --- Destroy ---
    if (text.includes('destroy target creature') || text.includes('destroy target nonland permanent')) {
      effects.push({ type: 'destroy', target: 'creature' });
    }

    // Board wipes
    if (text.includes('destroy all creatures')) {
      effects.push({ type: 'destroy_all', target: 'creatures' });
    }
    if (text.includes('destroy all nonland permanents')) {
      effects.push({ type: 'destroy_all', target: 'nonland' });
    }

    // Destroy all opponent creatures (one-sided)
    if (text.match(/destroy all creatures (?:target )?opponent controls/)) {
      effects.push({ type: 'destroy_all', target: 'opponent_creatures' });
    }

    // --- Exile ---
    if (text.includes('exile target creature') || text.includes('exile target nonland permanent')) {
      effects.push({ type: 'exile', target: 'creature' });
    }
    if (text.includes('exile all creatures')) {
      effects.push({ type: 'exile_all', target: 'creatures' });
    }

    // --- Draw cards ---
    const drawMatch = text.match(/draw (?:a |an |(\w+) )?cards?/);
    if (drawMatch) {
      effects.push({ type: 'draw', amount: drawMatch[1] ? (this._wordToNum(drawMatch[1]) || 1) : 1 });
    }

    // --- Gain life ---
    const lifeMatch = text.match(/gain (\d+) life/);
    if (lifeMatch) {
      effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });
    }

    // --- Lose life (opponent) ---
    const loseLifeMatch = text.match(/(?:target (?:opponent|player)|each opponent) loses? (\d+) life/);
    if (loseLifeMatch) {
      effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });
    }

    // --- Drain (lose life + gain life) ---
    // Pattern: "each opponent loses N life and you gain N life" or "target player loses N life. You gain N life."
    if (!loseLifeMatch) {
      const drainMatch = text.match(/loses? (\d+) life.*?(?:you )?gain (\d+) life/);
      if (drainMatch) {
        effects.push({ type: 'loseLife', amount: parseInt(drainMatch[1]), target: 'opponent' });
        effects.push({ type: 'gainLife', amount: parseInt(drainMatch[2]) });
      }
    }

    // --- Buff (+X/+Y) ---
    const buffMatch = text.match(/(?:target creature |creatures you control )gets? ([+-]\d+)\/([+-]\d+)/);
    if (buffMatch) {
      effects.push({
        type: 'buff',
        power: parseInt(buffMatch[1]),
        toughness: parseInt(buffMatch[2]),
        target: text.includes('creatures you control') ? 'all_own_creatures' : 'creature'
      });
    }

    // --- +1/+1 counters ---
    const counterMatch = text.match(/put (?:a |(\w+) )?(\+1\/\+1) counters? on (target creature|it|a creature you control|each creature you control)/);
    if (counterMatch) {
      const amount = counterMatch[1] ? (this._wordToNum(counterMatch[1]) || parseInt(counterMatch[1]) || 1) : 1;
      const target = counterMatch[3];
      if (target === 'each creature you control') {
        effects.push({ type: 'counter_all', counter: '+1/+1', amount });
      } else {
        effects.push({ type: 'counter', counter: '+1/+1', amount, target: 'creature' });
      }
    }

    // --- -1/-1 counters ---
    const negCounterMatch = text.match(/put (?:a |(\w+) )?(-1\/-1) counters? on (target creature)/);
    if (negCounterMatch) {
      effects.push({ type: 'counter', counter: '-1/-1', amount: negCounterMatch[1] ? (this._wordToNum(negCounterMatch[1]) || parseInt(negCounterMatch[1]) || 1) : 1, target: 'creature' });
    }

    // --- Return to hand (bounce) ---
    if (text.includes('return target creature to its owner\'s hand') || text.includes('return target nonland permanent to its owner\'s hand')) {
      effects.push({ type: 'bounce', target: 'creature' });
    }

    // --- Scry ---
    const scryMatch = text.match(/scry (\d+)/);
    if (scryMatch) {
      effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });
    }

    // --- Surveil ---
    const surveilMatch = text.match(/surveil (\d+)/);
    if (surveilMatch) {
      effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });
    }

    // --- Mill ---
    const millMatch = text.match(/(?:target player )?(?:mills?|puts? the top) (\d+) cards/);
    if (millMatch) {
      const millTarget = text.includes('target player') || text.includes('target opponent') ? 'opponent' : 'self';
      effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: millTarget });
    }

    // --- Search library for basic land (ramp) ---
    if (text.match(/search your library for a basic land card/)) {
      const tapped = text.includes('tapped');
      effects.push({ type: 'ramp', landType: 'basic', tapped });
    }

    // --- Search library for a land (fetch) ---
    if (text.match(/search your library for a land card/) && !text.includes('basic')) {
      effects.push({ type: 'ramp', landType: 'any', tapped: text.includes('tapped') });
    }

    // --- Create tokens ---
    const tokenMatch = text.match(/create (?:a |an |(\w+) )?(\d+)\/(\d+) (\w+(?:\s\w+)?)(?: creature)? tokens?/);
    if (tokenMatch) {
      effects.push({
        type: 'create_token',
        count: tokenMatch[1] ? (this._wordToNum(tokenMatch[1]) || 1) : 1,
        power: parseInt(tokenMatch[2]),
        toughness: parseInt(tokenMatch[3]),
        name: tokenMatch[4]
      });
    }
    // Alternate pattern: "create a 1/1 white Soldier creature token"
    if (!tokenMatch) {
      const tokenMatch2 = text.match(/create (?:a |an |(\w+) )?(\d+)\/(\d+) (\w+) (\w+(?:\s\w+)?)(?: creature)? tokens?/);
      if (tokenMatch2) {
        effects.push({
          type: 'create_token',
          count: tokenMatch2[1] ? (this._wordToNum(tokenMatch2[1]) || 1) : 1,
          power: parseInt(tokenMatch2[2]),
          toughness: parseInt(tokenMatch2[3]),
          name: tokenMatch2[5],
          color: tokenMatch2[4]
        });
      }
    }
    // Simplest pattern: "create two 1/1 tokens" or "create a token"
    if (effects.every(e => e.type !== 'create_token')) {
      const simpleToken = text.match(/create (?:a |an? |(\w+) )?(\d+)\/(\d+)\b[^.]*?tokens?/);
      if (simpleToken) {
        effects.push({
          type: 'create_token',
          count: simpleToken[1] ? (this._wordToNum(simpleToken[1]) || 1) : 1,
          power: parseInt(simpleToken[2]),
          toughness: parseInt(simpleToken[3]),
          name: 'Token'
        });
      }
    }

    // --- Discard ---
    const discardMatch = text.match(/(?:target (?:player|opponent) )?discards? (?:a |(\w+) )?cards?/);
    if (discardMatch && !text.includes('you discard') && !text.includes('as an additional cost')) {
      const discardTarget = text.includes('target opponent') || text.includes('target player') || text.includes('each opponent') ? 'opponent' : 'self';
      if (discardTarget === 'opponent') {
        effects.push({ type: 'discard', amount: discardMatch[1] ? (this._wordToNum(discardMatch[1]) || parseInt(discardMatch[1]) || 1) : 1, target: 'opponent' });
      }
    }

    // --- Fight ---
    if (text.includes('fights target') || text.includes('fight another target') || text.includes('fight target')) {
      effects.push({ type: 'fight', target: 'creature' });
    }

    // --- Tap/Untap ---
    if (text.includes('tap target creature')) {
      effects.push({ type: 'tap', target: 'creature' });
    }
    if (text.includes('untap target creature')) {
      effects.push({ type: 'untap', target: 'creature' });
    }

    // --- Prevent damage / protection ---
    const preventMatch = text.match(/prevent (?:the next )?(\d+) damage/);
    if (preventMatch) {
      effects.push({ type: 'prevent_damage', amount: parseInt(preventMatch[1]) });
    }

    // --- Blight ---
    const blightMatch = text.match(/(?:you may )?blight (\d+)/);
    if (blightMatch && !text.includes('as an additional cost')) {
      effects.push({ type: 'blight', amount: parseInt(blightMatch[1]), optional: text.includes('you may blight') });
    }

    // --- Convoke ---
    if (text.includes('convoke')) {
      // Convoke is handled in the casting system, not as an effect
      // But mark it for the card
    }

    return effects;
  },

  // ETB (Enter the Battlefield) effects
  parseETBEffects(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const cardName = (card.name || '').toLowerCase();

    // Must have text indicating THIS card enters, not "whenever a creature enters"
    // Replace card name with ~ for matching
    const normalizedText = text.replace(new RegExp(cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');

    // Patterns for self-ETB (this card entering, not other cards)
    const selfETBPatterns = [
      /when ~ enters/,
      /when ~ enters the battlefield/,
      /when this creature enters/,
      /when this (?:artifact|enchantment|permanent) enters/,
      /~ enters the battlefield with/,
      /~ enters the battlefield,/,
      /as ~ enters/,
      /as this creature enters/
    ];

    // Exclude patterns for other cards entering
    const excludePatterns = [
      /whenever (?:a|another) creature enters/,
      /whenever (?:a|another) (?:artifact|permanent) enters/,
      /whenever a creature enters the battlefield under/
    ];

    // Check for exclude patterns first
    if (excludePatterns.some(pattern => pattern.test(normalizedText))) {
      // Only return effects if ALSO has self ETB
      const hasSelfETB = selfETBPatterns.some(pattern => pattern.test(normalizedText));
      if (!hasSelfETB) return [];
    } else {
      // Check if this card has a self-ETB pattern
      const hasSelfETB = selfETBPatterns.some(pattern => pattern.test(normalizedText));
      if (!hasSelfETB) return [];
    }

    const effects = [];

    // ETB damage - improved regex to catch more patterns
    const dmgMatch = text.match(/enters[^.]*?deals? (\d+) damage/);
    if (dmgMatch) {
      const dmgTarget = text.match(/enters[^.]*?deals? \d+ damage to (any target|target creature|each opponent|target player|target opponent|creature or player|creature or planeswalker)/);
      let target = 'any target';
      let condition = null;

      if (dmgTarget) {
        if (dmgTarget[1].includes('opponent')) target = 'opponent';
        else if (dmgTarget[1].includes('creature')) target = 'creature';
        else if (dmgTarget[1].includes('player')) target = 'player';
        else target = dmgTarget[1];
      }

      // Check for specific conditional patterns (Unsparing Boltcaster)
      const conditionalMatch = text.match(/enters[^.]*?deals? \d+ damage to target creature an opponent controls that was dealt damage this turn/);
      if (conditionalMatch) {
        target = 'opponent_creature';
        condition = 'dealt_damage_this_turn';
      }

      const effect = { type: 'damage', amount: parseInt(dmgMatch[1]), target };
      if (condition) effect.condition = condition;
      effects.push(effect);
    }

    // ETB draw (handles "draw a card", "draw two cards", "draw 3 cards")
    const drawCheck = text.match(/enters[^.]*?(?:you )?(?:may )?draw (?:a |an |(\w+) )?cards?/);
    if (drawCheck) {
      effects.push({ type: 'draw', amount: drawCheck[1] ? (this._wordToNum(drawCheck[1]) || 1) : 1 });
    }

    // ETB gain life - improved to catch numeric and word amounts
    const lifeMatch = text.match(/enters[^.]*?(?:you )?gain (\d+|\w+) life/);
    if (lifeMatch) {
      const amt = parseInt(lifeMatch[1]) || this._wordToNum(lifeMatch[1]);
      if (amt) effects.push({ type: 'gainLife', amount: amt });
    }

    // ETB scry
    const scryMatch = text.match(/enters[^.]*?scry (\d+)/);
    if (scryMatch) {
      effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });
    }

    // ETB create token (handles "create a 1/1", "create two 1/1", "create 2 1/1")
    const tokenMatch = text.match(/enters[^.]*?create (?:a |an |(\w+) )?(\d+)\/(\d+)/);
    if (tokenMatch) {
      effects.push({
        type: 'create_token',
        count: tokenMatch[1] ? (this._wordToNum(tokenMatch[1]) || 1) : 1,
        power: parseInt(tokenMatch[2]),
        toughness: parseInt(tokenMatch[3]),
        name: 'Token'
      });
    }

    // ETB +1/+1 counter on itself ("enters with" or "enters the battlefield with")
    const counterSelfMatch = text.match(/enters[^.]*?with (?:a |(\w+) )?\+1\/\+1 counter/);
    if (counterSelfMatch) {
      effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterSelfMatch[1] ? (this._wordToNum(counterSelfMatch[1]) || 1) : 1 });
    }

    // ETB +1/+1 counter on target creature
    const counterTargetMatch = text.match(/enters[^.]*?put (?:a |(\w+) )?\+1\/\+1 counters? on (target creature|another target creature|each creature you control)/);
    if (counterTargetMatch) {
      const amount = counterTargetMatch[1] ? (this._wordToNum(counterTargetMatch[1]) || 1) : 1;
      if (counterTargetMatch[2] === 'each creature you control') {
        effects.push({ type: 'counter_all', counter: '+1/+1', amount });
      } else {
        effects.push({ type: 'counter', counter: '+1/+1', amount, target: 'creature' });
      }
    }

    // ETB search for basic land (ramp)
    if (text.match(/enters[^.]*?search your library for a basic land/)) {
      effects.push({ type: 'ramp', landType: 'basic', tapped: text.includes('tapped') });
    }

    // ETB opponent loses life
    const loseMatch = text.match(/enters[^.]*?(?:each opponent|target opponent|opponents?) loses? (\d+) life/);
    if (loseMatch) {
      effects.push({ type: 'loseLife', amount: parseInt(loseMatch[1]), target: 'opponent' });
    }

    // ETB mill - improved
    const millMatch = text.match(/enters[^.]*?(?:target player mills?|mills?|puts? the top) (\d+)/);
    if (millMatch) {
      const millTarget = text.includes('target player') || text.includes('opponent') ? 'opponent' : 'self';
      effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: millTarget });
    }

    // ETB surveil
    const surveilMatch = text.match(/enters[^.]*?surveil (\d+)/);
    if (surveilMatch) {
      effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });
    }

    // ETB destroy - improved
    if (text.match(/enters[^.]*?destroy (?:target |up to one target )?(?:creature|nonland permanent|artifact|enchantment)/)) {
      effects.push({ type: 'destroy', target: 'creature' });
    }

    // ETB exile - improved
    if (text.match(/enters[^.]*?exile (?:target |up to one target )?(?:creature|nonland permanent|card|artifact)/)) {
      effects.push({ type: 'exile', target: 'creature' });
    }

    // ETB bounce - improved
    if (text.match(/enters[^.]*?return (?:target |up to one target )?(?:creature|nonland permanent|another)[^.]*?to its owner's hand/)) {
      effects.push({ type: 'bounce', target: 'creature' });
    }

    // ETB fight - improved
    if (text.match(/enters[^.]*?(?:it )?fights? (?:up to one )?(?:target|another target)/)) {
      effects.push({ type: 'fight', target: 'creature' });
    }

    // ETB tap - improved
    if (text.match(/enters[^.]*?tap (?:up to (?:\w+ )?)?(?:target )?creature/)) {
      effects.push({ type: 'tap', target: 'creature' });
    }

    // ETB buff/debuff - handle complex patterns like Gurmag Rakshasa
    const complexETBMatch = text.match(/enters[^.]*?target creature an opponent controls gets ([+-]\d+)\/([+-]\d+)[^.]*?and target creature you control gets ([+-]\d+)\/([+-]\d+)/);
    if (complexETBMatch) {
      // First effect: opponent creature debuff
      effects.push({
        type: 'debuff',
        power: parseInt(complexETBMatch[1]),
        toughness: parseInt(complexETBMatch[2]),
        target: 'opponent_creature',
        duration: 'end_of_turn'
      });
      // Second effect: own creature buff
      effects.push({
        type: 'buff',
        power: parseInt(complexETBMatch[3]),
        toughness: parseInt(complexETBMatch[4]),
        target: 'own_creature',
        duration: 'end_of_turn'
      });
    } else {
      // ETB buff (simple pattern)
      const etbBuffMatch = text.match(/enters[^.]*?(?:target creature |another target creature |creatures you control )gets? ([+-]\d+)\/([+-]\d+)/);
      if (etbBuffMatch) {
        effects.push({
          type: 'buff',
          power: parseInt(etbBuffMatch[1]),
          toughness: parseInt(etbBuffMatch[2]),
          target: text.match(/enters[^.]*?creatures you control/) ? 'all_own_creatures' : 'creature'
        });
      }
    }

    // ETB discard opponent
    const discardMatch = text.match(/enters[^.]*?(?:target opponent|each opponent|opponents?) discards? (?:a |(\w+) )?cards?/);
    if (discardMatch) {
      effects.push({ type: 'discard', amount: discardMatch[1] ? (this._wordToNum(discardMatch[1]) || 1) : 1, target: 'opponent' });
    }

    // ETB prevent damage
    const preventMatch = text.match(/enters[^.]*?prevent (?:the next )?(\d+) damage/);
    if (preventMatch) {
      effects.push({ type: 'prevent_damage', amount: parseInt(preventMatch[1]) });
    }

    // ETB blight
    const blightMatch = text.match(/enters[^.]*?(?:you may )?blight (\d+)/);
    if (blightMatch) {
      effects.push({ type: 'blight', amount: parseInt(blightMatch[1]), optional: text.includes('you may blight') });
    }

    return effects;
  },

  prepareForBattlefield(card) {
    const isCreature = this.isCreature(card);
    const prepared = {
      ...card,
      _tapped: false,
      _summoningSick: isCreature,
      _powerMod: 0,
      _toughnessMod: 0,
      _damage: 0,
      _attacking: false,
      _blocking: null,
      _blockedBy: [],
      _counters: { '+1/+1': 0, '-1/-1': 0 }
    };
    // Preserve back face data for transform cards
    if (card.backFace) {
      prepared._backFace = card.backFace;
      prepared._transformed = false;
    }
    // Initialize planeswalker loyalty
    if (this.isPlaneswalker(card)) {
      prepared._loyalty = this.getStartingLoyalty(card);
      prepared._loyaltyUsedThisTurn = false;
    }
    return prepared;
  },

  // Create a token creature
  createToken(controller, power, toughness, name, keywords = []) {
    const token = {
      id: 'token_' + Math.random().toString(36).slice(2, 8),
      _uid: 'token_' + Math.random().toString(36).slice(2, 8),
      _ownerId: controller,
      name: name || 'Token',
      type_line: 'Creature Token',
      power: String(power),
      toughness: String(toughness),
      oracle_text: '',
      mana_cost: '',
      cmc: 0,
      colors: [],
      color_identity: [],
      rarity: 'token',
      keywords: keywords,
      image_small: null,
      image_normal: null,
      image_large: null,
      _isToken: true,
      _tapped: false,
      _summoningSick: true,
      _powerMod: 0,
      _toughnessMod: 0,
      _damage: 0,
      _attacking: false,
      _blocking: null,
      _blockedBy: [],
      _counters: { '+1/+1': 0, '-1/-1': 0 }
    };

    // Special handling for specific token types
    if (name && name.toLowerCase() === 'treasure') {
      token.type_line = 'Artifact Token';
      token.power = '';
      token.toughness = '';
      token.oracle_text = '{T}, Sacrifice this artifact: Add one mana of any color.';
      token._summoningSick = false; // Artifacts don't have summoning sickness
      delete token._powerMod;
      delete token._toughnessMod;
      delete token._damage;
      delete token._attacking;
      delete token._blocking;
      delete token._blockedBy;
      delete token._counters;
    }

    // Look up real token art from Scryfall
    if (typeof App !== 'undefined' && App.tokenArtMap) {
      const lookupName = (name || '').toLowerCase();
      // Try exact match (name + power + toughness)
      const exactKey = `${lookupName}_${power}_${toughness}`;
      const art = App.tokenArtMap[exactKey] || App.tokenArtMap[lookupName];
      if (art) {
        token.image_small = art.image_small || null;
        token.image_normal = art.image_normal || null;
      }
    }

    return token;
  },

  // === Keyword protection checks ===

  hasHexproof(card) {
    return this.hasKeyword(card, 'Hexproof');
  },

  hasShroud(card) {
    return this.hasKeyword(card, 'Shroud');
  },

  hasIndestructible(card) {
    return this.hasKeyword(card, 'Indestructible');
  },

  hasWard(card) {
    return this.hasKeyword(card, 'Ward');
  },

  getWardCost(card) {
    if (!this.hasWard(card)) return 0;
    const text = (card.oracle_text || '').toLowerCase();
    const m = text.match(/ward\s*\{(\d+)\}/i) || text.match(/ward\s*\{(\w)\}/i);
    if (m) return parseInt(m[1]) || 1;
    return 1; // Default ward cost
  },

  hasFlash(card) {
    if (this.hasKeyword(card, 'Flash')) return true;

    // Check conditional flash (e.g., Molten Exhale with behold Dragon)
    const db = this.getPreprocessedEffects(card);
    if (db && db.static) {
      return db.static.some(s => s.type === 'conditional_flash');
    }
    return false;
  },

  // Check if card can be cast with flash due to conditional flash ability
  canCastWithConditionalFlash(card, gameState, playerId) {
    const db = this.getPreprocessedEffects(card);
    if (!db || !db.static) return false;

    const conditionalFlash = db.static.find(s => s.type === 'conditional_flash');
    if (!conditionalFlash) return false;

    // Check condition
    if (conditionalFlash.condition === 'behold_dragon') {
      const bf = gameState.players[playerId].zones.battlefield;
      const hasDragonBF = bf.cards.some(c => CardEngine.isCreature(c) && CardEngine.hasCreatureType(c, 'Dragon'));

      const hand = gameState.players[playerId].zones.hand;
      const hasDragonHand = hand.getAll().some(c => CardEngine.hasCreatureType(c, 'Dragon') && c._uid !== card._uid);

      return hasDragonBF || hasDragonHand;
    }

    return false;
  },

  hasLifelink(card) {
    return this.hasKeyword(card, 'Lifelink');
  },

  // === Lorwyn Mechanics ===

  hasChangeling(card) {
    return this.hasKeyword(card, 'Changeling');
  },

  /**
   * Check if a card has a specific creature subtype.
   * Changeling creatures count as ALL creature types.
   */
  hasCreatureType(card, type) {
    if (this.hasChangeling(card)) return true;
    const typeLine = (card.type_line || '');
    if (!typeLine.includes('—')) return false;
    const subtypes = typeLine.split('—').pop().trim().toLowerCase();
    return subtypes.includes(type.toLowerCase());
  },

  // Check if a land has a specific land subtype (Plains, Swamp, Forest, Island, Mountain)
  hasLandType(card, type) {
    const typeLine = (card.type_line || '');
    if (!typeLine.includes('—')) return false;
    const subtypes = typeLine.split('—').pop().trim().toLowerCase();
    return subtypes.includes(type.toLowerCase());
  },

  // Check if card is a Dragon (for Dragon's Prey conditional cost)
  isDragon(card) {
    return this.hasCreatureType(card, 'Dragon');
  },

  // Get card's color identity (WUBRG)
  getCardColors(card) {
    const colors = [];
    const manaCost = card.mana_cost || '';
    const colorLine = card.color_identity || card.colors || [];

    // Parse mana cost for color symbols
    if (manaCost.includes('W')) colors.push('W');
    if (manaCost.includes('U')) colors.push('U');
    if (manaCost.includes('B')) colors.push('B');
    if (manaCost.includes('R')) colors.push('R');
    if (manaCost.includes('G')) colors.push('G');

    // Also check color_identity array if available
    if (Array.isArray(colorLine)) {
      colorLine.forEach(color => {
        if (['W', 'U', 'B', 'R', 'G'].includes(color) && !colors.includes(color)) {
          colors.push(color);
        }
      });
    }

    return colors;
  },

  // Get conditional cost based on target (for Dragon's Prey)
  getConditionalCost(card, targetCard = null) {
    const db = this.getPreprocessedEffects(card);
    if (!db || !db.conditional_cost) return null;

    const condition = db.conditional_cost.condition;
    const additionalMana = db.conditional_cost.additional_mana;

    // Check if condition is met
    if (condition === 'target_dragon' && targetCard && this.isDragon(targetCard)) {
      return additionalMana;
    }

    return null;
  },

  // Get effective mana cost including conditional costs
  getEffectiveManaCost(card, targetCard = null) {
    let baseCost = card.mana_cost || '{0}';
    const conditionalCost = this.getConditionalCost(card, targetCard);

    if (conditionalCost) {
      // Parse base cost and additional cost, then combine
      const baseParsed = ManaSystem.parseCost(baseCost);
      const additionalParsed = ManaSystem.parseCost(conditionalCost);

      // Combine costs
      const combinedCost = { ...baseParsed };
      Object.keys(additionalParsed).forEach(color => {
        combinedCost[color] = (combinedCost[color] || 0) + additionalParsed[color];
      });

      // Convert back to mana cost string
      return ManaSystem.costToString(combinedCost);
    }

    return baseCost;
  },

  isKindred(card) {
    return (card.type_line || '').toLowerCase().includes('kindred');
  },

  hasConvoke(card) {
    return this.hasKeyword(card, 'Convoke') || (card.oracle_text || '').toLowerCase().includes('convoke');
  },

  // Behold: check if card requires behold cost
  getBeholdCost(card) {
    const costs = this.getAdditionalCosts(card);
    return costs.find(c => c.type === 'behold') || null;
  },

  // === Transform / DFC ===

  isTransformCard(card) {
    return !!(card.backFace || card._backFace);
  },

  // Get the transform cost from oracle text
  // ECL pattern: "{cost}: Transform ~" on the front face
  getTransformCost(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const match = text.match(/\{([^}]+)\}(?:\{([^}]+)\})?(?:\{([^}]+)\})?:\s*transform/);
    if (match) {
      let cost = `{${match[1]}}`;
      if (match[2]) cost += `{${match[2]}}`;
      if (match[3]) cost += `{${match[3]}}`;
      return cost;
    }
    return null;
  },

  // Transform a card on the battlefield: swap to back face or front face
  transformCard(card) {
    if (!card._backFace && !card.backFace) return false;

    if (card._transformed) {
      // Transform back to front face
      const front = card._frontFaceData;
      if (front) {
        card.name = front.name;
        card.type_line = front.type_line;
        card.oracle_text = front.oracle_text;
        card.power = front.power;
        card.toughness = front.toughness;
        card.colors = front.colors;
        card.image_small = front.image_small;
        card.image_normal = front.image_normal;
        card.image_large = front.image_large;
        card.keywords = front.keywords;
      }
      card._transformed = false;
    } else {
      // Save front face data if not saved yet
      if (!card._frontFaceData) {
        card._frontFaceData = {
          name: card.name,
          type_line: card.type_line,
          oracle_text: card.oracle_text,
          power: card.power,
          toughness: card.toughness,
          colors: card.colors,
          image_small: card.image_small,
          image_normal: card.image_normal,
          image_large: card.image_large,
          keywords: [...(card.keywords || [])],
        };
      }
      // Apply back face
      const back = card._backFace || card.backFace;
      card.name = back.name;
      card.type_line = back.type_line;
      card.oracle_text = back.oracle_text;
      card.power = back.power;
      card.toughness = back.toughness;
      card.colors = back.colors || card.colors;
      card.image_small = back.image_small || card.image_small;
      card.image_normal = back.image_normal || card.image_normal;
      card.image_large = back.image_large || card.image_large;
      if (back.keywords) card.keywords = back.keywords;
      card._transformed = true;
    }
    return true;
  },

  // Count distinct colors among permanents a player controls
  countVividColors(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const colors = new Set();
    bf.cards.forEach(c => {
      (c.colors || c.color_identity || []).forEach(clr => colors.add(clr));
    });
    return colors.size;
  },

  /**
   * Get all creature subtypes for a card.
   * Returns array of subtypes. Changeling returns special marker.
   */
  getSubtypes(card) {
    const typeLine = (card.type_line || '');
    if (!typeLine.includes('—')) return [];
    const subtypes = typeLine.split('—').pop().trim().split(' ').map(s => s.trim()).filter(s => s.length > 0);
    return subtypes;
  },

  /**
   * Parse Evoke cost from oracle text.
   * Evoke {cost} - Returns the evoke mana cost string or null.
   */
  getEvokeCost(card) {
    if (!this.hasKeyword(card, 'Evoke')) return null;
    const text = card.oracle_text || '';
    const match = text.match(/evoke\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
    if (match) return match[1];
    // Also try "Evoke—{cost}" format
    const match2 = text.match(/evoke[—\-]+\s*(\{[^}]+\}(?:\{[^}]+\})*)/i);
    if (match2) return match2[1];
    return null;
  },

  /**
   * Parse Affinity type from oracle text or CardEffectsDB.
   * Returns the affinity type ('creatures', 'artifacts', etc.) or null if no affinity.
   */
  getAffinityType(card) {
    // Check CardEffectsDB first
    const db = this.getPreprocessedEffects(card);
    if (db && db.affinity) {
      return db.affinity.type;
    }

    // Fallback: check oracle text
    const text = (card.oracle_text || '').toLowerCase();
    const match = text.match(/affinity\s+for\s+(\w+)/);
    if (match) return match[1];
    return null;
  },

  /**
   * Check if card has affinity.
   */
  hasAffinity(card) {
    return this.getAffinityType(card) !== null;
  },

  /**
   * Parse Champion requirement from oracle text.
   * Returns the creature type to exile, or null if not champion.
   */
  getChampionType(card) {
    if (!this.hasKeyword(card, 'Champion')) return null;
    const text = (card.oracle_text || '').toLowerCase();
    // "Champion a [type]" or "Champion an [type]"
    const match = text.match(/champion (?:a|an) (\w+)/);
    if (match) return match[1];
    return 'creature'; // Fallback
  },

  /**
   * Parse "enters tapped unless" condition for lands.
   * Returns array of land types needed to enter untapped, or null if no such condition.
   * E.g., "enters tapped unless you control a Swamp or a Mountain" -> ["Swamp", "Mountain"]
   */
  getEntersTappedUnlessCondition(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const match = text.match(/enters tapped unless you control (?:a |an )?(.+?)(?:\.|$)/i);
    if (!match) return null;

    const conditionText = match[1];
    const types = [];

    // Extract land types: "a Plains or an Island" -> ["Plains", "Island"]
    const landMatches = conditionText.match(/(?:a |an )?([A-Z][a-z]+)/g);
    if (landMatches) {
      landMatches.forEach(m => {
        const type = m.replace(/^(?:a |an )\s*/i, '').trim();
        if (!types.includes(type)) types.push(type);
      });
    }

    return types.length > 0 ? types : null;
  },

  // Check if a card can be targeted by a specific player
  canBeTargeted(card, byPlayerId) {
    // Hexproof: can't be targeted by opponents
    if (this.hasHexproof(card) && card._ownerId !== byPlayerId) return false;
    // Shroud: can't be targeted by anyone
    if (this.hasShroud(card)) return false;
    return true;
  },

  // Check if a creature loses all abilities (e.g., from Fresh Start aura)
  losesAllAbilities(card) {
    return !!card._losesAllAbilities;
  },

  // === Type checks ===

  isAura(card) {
    const typeLine = (card.type_line || '').toLowerCase();
    return typeLine.includes('enchantment') && typeLine.includes('aura');
  },

  isEquipment(card) {
    const typeLine = (card.type_line || '').toLowerCase();
    return typeLine.includes('artifact') && typeLine.includes('equipment');
  },

  isLegendary(card) {
    const typeLine = (card.type_line || '').toLowerCase();
    return typeLine.includes('legendary');
  },

  // Find legendary cards with the same name on the battlefield
  findLegendaryDuplicates(gameState, playerId, cardName) {
    return gameState.players[playerId].zones.battlefield.cards.filter(
      c => this.isLegendary(c) && c.name === cardName
    );
  },

  // === Aura effects ===

  parseAuraEffects(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const effects = [];

    // Enchant creature
    if (!text.includes('enchant')) return effects;

    // Static buff: "enchanted creature gets +X/+Y"
    const buffMatch = text.match(/enchanted creature gets? ([+-]\d+)\/([+-]\d+)/);
    if (buffMatch) {
      effects.push({ type: 'buff', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });
    }

    // Keyword grant: "enchanted creature has flying/trample/etc"
    const kwGrant = text.match(/enchanted creature (?:has|gains) ([\w\s,]+?)(?:\.|$)/);
    if (kwGrant) {
      const kwText = kwGrant[1];
      const possibleKw = ['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
        'trample', 'vigilance', 'haste', 'reach', 'menace', 'hexproof', 'indestructible', 'defender'];
      possibleKw.forEach(kw => {
        if (kwText.includes(kw)) {
          effects.push({ type: 'grant_keyword', keyword: kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') });
        }
      });
    }

    // "Enchanted creature can't attack" / "can't block"
    if (text.includes("enchanted creature can't attack")) {
      effects.push({ type: 'grant_keyword', keyword: 'Defender' });
    }
    if (text.includes("enchanted creature can't block")) {
      effects.push({ type: 'cant_block' });
    }

    // Power/toughness set: "enchanted creature has base power and toughness X/Y"
    const baseMatch = text.match(/enchanted creature (?:has base power and toughness|is) (\d+)\/(\d+)/);
    if (baseMatch) {
      effects.push({ type: 'set_pt', power: parseInt(baseMatch[1]), toughness: parseInt(baseMatch[2]) });
    }

    return effects;
  },

  // === Equipment effects ===

  parseEquipmentEffects(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const effects = [];

    // "Equipped creature gets +X/+Y"
    const buffMatch = text.match(/equipped creature gets? ([+-]\d+)\/([+-]\d+)/);
    if (buffMatch) {
      effects.push({ type: 'buff', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });
    }

    // Keyword grant
    const kwGrant = text.match(/equipped creature (?:has|gains) ([\w\s,]+?)(?:\.|$)/);
    if (kwGrant) {
      const kwText = kwGrant[1];
      const possibleKw = ['flying', 'first strike', 'double strike', 'deathtouch', 'lifelink',
        'trample', 'vigilance', 'haste', 'reach', 'menace', 'hexproof', 'indestructible'];
      possibleKw.forEach(kw => {
        if (kwText.includes(kw)) {
          effects.push({ type: 'grant_keyword', keyword: kw.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') });
        }
      });
    }

    // Equip cost - support colored mana costs like {1}{R}, {2}{W}, etc.
    const equipMatch = text.match(/equip(?:—| )?(\{[^}]+\}(?:\{[^}]+\})*)/);
    if (equipMatch) {
      effects.push({ type: 'equip_cost', cost: equipMatch[1] });
    } else {
      // Fallback: try old numeric pattern for backwards compatibility
      const numericMatch = text.match(/equip(?:—| )?\{(\d+)\}/);
      if (numericMatch) {
        effects.push({ type: 'equip_cost', cost: `{${numericMatch[1]}}` });
      } else {
        // Default equip cost
        effects.push({ type: 'equip_cost', cost: '{3}' });
      }
    }

    return effects;
  },

  // === Triggered abilities ===

  parseTriggeredAbilities(card) {
    const rawText = (card.oracle_text || '').toLowerCase();
    const name = (card.name || '').toLowerCase();
    // Normalize: replace card name with ~ for easier matching
    const text = rawText.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~');
    const triggers = [];

    // "When ~ attacks" / "Whenever ~ attacks"
    if (text.match(/when(?:ever)?\s+(?:~|this creature|equipped creature|enchanted creature)\s+attacks/)) {
      const effect = this._parseEffectFromTrigger(text, 'attacks');
      if (effect) triggers.push({ event: 'attacks', self: true, effects: effect });
    }

    // "Whenever ~ deals combat damage to a player"
    if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+deals combat damage to a player/)) {
      const effect = this._parseEffectFromTrigger(text, 'deals combat damage');
      if (effect) triggers.push({ event: 'combat_damage_player', self: true, effects: effect });
    }

    // "When ~ dies" / "Whenever ~ dies"
    if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+dies/)) {
      const effect = this._parseEffectFromTrigger(text, 'dies');
      if (effect) triggers.push({ event: 'dies', self: true, effects: effect });
    }

    // "Whenever a creature you control dies"
    if (text.match(/whenever a creature you control dies/)) {
      const effect = this._parseEffectFromTrigger(text, 'dies');
      if (effect) triggers.push({ event: 'any_creature_dies', controller: true, effects: effect });
    }

    // "At the beginning of your upkeep"
    if (text.match(/at the beginning of your upkeep/)) {
      const effect = this._parseEffectFromTrigger(text, 'upkeep');
      if (effect) triggers.push({ event: 'upkeep', self: true, effects: effect });
    }

    // "Whenever you gain life"
    if (text.match(/whenever you gain life/)) {
      const effect = this._parseEffectFromTrigger(text, 'gain life');
      if (effect) triggers.push({ event: 'gain_life', self: true, effects: effect });
    }

    // "Whenever ~ becomes tapped" / "Whenever this creature becomes tapped"
    if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+becomes tapped/)) {
      const effect = this._parseEffectFromTrigger(text, 'becomes tapped');
      if (effect) triggers.push({ event: 'becomes_tapped', self: true, effects: effect });
    }

    // "Whenever you cast your second spell each turn" (Flurry)
    if (text.match(/whenever you cast your second spell/)) {
      const effect = this._parseEffectFromTrigger(text, 'second spell');
      if (effect) triggers.push({ event: 'second_spell', self: true, effects: effect });
    }

    // "At the beginning of your end step" / "At end of turn"
    if (text.match(/at the (?:beginning of (?:your|each) end step|end of (?:your |each )?turn)/)) {
      const effect = this._parseEffectFromTrigger(text, 'end step');
      if (effect) triggers.push({ event: 'end_step', self: true, effects: effect });
    }

    // "Whenever ~ enters the battlefield or attacks" / "Whenever ~ enters or attacks"
    if (text.match(/when(?:ever)?\s+(?:~|this creature)\s+enters[^.]*?or attacks/)) {
      const effect = this._parseEffectFromTrigger(text, '(?:enters|attacks)');
      if (effect) triggers.push({ event: 'enters_or_attacks', self: true, effects: effect });
    }

    // "Whenever another creature you control dies"
    if (text.match(/whenever another creature you control dies/)) {
      const effect = this._parseEffectFromTrigger(text, 'dies');
      if (effect) triggers.push({ event: 'other_creature_dies', controller: true, effects: effect });
    }

    // "Whenever a Dragon enters the battlefield under your control"
    if (text.match(/whenever a dragon enters/)) {
      const effect = this._parseEffectFromTrigger(text, 'dragon enters');
      if (effect) triggers.push({ event: 'dragon_enters', controller: true, effects: effect });
    }

    return triggers;
  },

  _parseEffectFromTrigger(text, triggerPhrase) {
    // Extract the effect portion after the trigger phrase
    const parts = text.split(/,\s*/);
    const effects = [];

    // Simple patterns for common trigger effects
    const drawMatch = text.match(new RegExp(triggerPhrase + '[^.]*?draw (?:a |an |(\\w+) )?cards?'));
    if (drawMatch) effects.push({ type: 'draw', amount: drawMatch[1] ? (this._wordToNum(drawMatch[1]) || 1) : 1 });

    const lifeMatch = text.match(new RegExp(triggerPhrase + '[^.]*?gain (\\d+) life'));
    if (lifeMatch) effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });

    const loseLifeMatch = text.match(new RegExp(triggerPhrase + '[^.]*?(?:each opponent|target opponent) loses? (\\d+) life'));
    if (loseLifeMatch) effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });

    const dmgMatch = text.match(new RegExp(triggerPhrase + '[^.]*?deals? (\\d+) damage'));
    if (dmgMatch) effects.push({ type: 'damage', amount: parseInt(dmgMatch[1]), target: 'opponent' });

    const buffMatch = text.match(new RegExp(triggerPhrase + '[^.]*?gets? ([+-]\\d+)\\/([+-]\\d+)'));
    if (buffMatch) effects.push({ type: 'buff_self', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });

    const counterMatch = text.match(new RegExp(triggerPhrase + '[^.]*?put (?:a |(\\d+) )?\\+1\\/\\+1 counter'));
    if (counterMatch) effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterMatch[1] ? parseInt(counterMatch[1]) : 1 });

    const tokenMatch = text.match(new RegExp(triggerPhrase + '[^.]*?create (?:a |(\\d+) )?(\\d+)\\/(\\d+)'));
    if (tokenMatch) effects.push({ type: 'create_token', count: tokenMatch[1] ? parseInt(tokenMatch[1]) : 1, power: parseInt(tokenMatch[2]), toughness: parseInt(tokenMatch[3]), name: 'Token' });

    const scryMatch = text.match(new RegExp(triggerPhrase + '[^.]*?scry (\\d+)'));
    if (scryMatch) effects.push({ type: 'scry', amount: parseInt(scryMatch[1]) });

    const millMatch = text.match(new RegExp(triggerPhrase + '[^.]*?mills? (\\d+)'));
    if (millMatch) effects.push({ type: 'mill', amount: parseInt(millMatch[1]), target: 'opponent' });

    // Add mana - "add {R}" or "add {G}{G}" etc (text is lowercase)
    const addManaMatch = text.match(new RegExp(triggerPhrase + '[^.]*?add \\{([wubrgc])\\}'));
    if (addManaMatch) effects.push({ type: 'add_mana', color: addManaMatch[1].toUpperCase() });

    // Surveil
    const surveilMatch = text.match(new RegExp(triggerPhrase + '[^.]*?surveil (\\d+)'));
    if (surveilMatch) effects.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });

    // Damage to each opponent
    const dmgEachMatch = text.match(new RegExp(triggerPhrase + '[^.]*?deals? (\\d+) damage to each opponent'));
    if (dmgEachMatch) effects.push({ type: 'damage_each_opponent', amount: parseInt(dmgEachMatch[1]) });

    // Lose life - opponent
    const loseLifeOppMatch = text.match(new RegExp(triggerPhrase + '[^.]*?each opponent loses? (\\d+) life'));
    if (loseLifeOppMatch) effects.push({ type: 'loseLife', amount: parseInt(loseLifeOppMatch[1]), target: 'opponent' });

    // Endure N
    const endureMatch = text.match(new RegExp(triggerPhrase + '[^.]*?endure (\\d+)'));
    if (endureMatch) effects.push({ type: 'endure', amount: parseInt(endureMatch[1]) });

    // Create token with keyword (e.g. "create a 1/1 white Warrior creature token with haste")
    if (effects.every(e => e.type !== 'create_token')) {
      const tokenKwMatch = text.match(new RegExp(triggerPhrase + '[^.]*?create (?:a |an? |(\\w+) )?(\\d+)\\/(\\d+)[^.]*?tokens?'));
      if (tokenKwMatch) {
        const count = tokenKwMatch[1] ? (this._wordToNum(tokenKwMatch[1]) || 1) : 1;
        const keywords = [];
        const tokenText = text.match(/create[^.]+/)?.[0] || '';
        ['flying', 'haste', 'lifelink', 'deathtouch', 'vigilance', 'trample', 'menace', 'prowess'].forEach(kw => {
          if (tokenText.includes(kw)) keywords.push(kw.charAt(0).toUpperCase() + kw.slice(1));
        });
        const attacking = tokenText.includes('tapped and attacking');
        effects.push({
          type: 'create_token',
          count,
          power: parseInt(tokenKwMatch[2]),
          toughness: parseInt(tokenKwMatch[3]),
          name: 'Token',
          keywords: keywords.length > 0 ? keywords : undefined,
          attacking: attacking || undefined
        });
      }
    }

    // Untap self
    if (text.match(new RegExp(triggerPhrase + '[^.]*?untap ~'))) {
      effects.push({ type: 'untap_self' });
    }

    // "look at the top card of your library. If it's a land card, you may ... put it into your hand"
    if (text.match(/look at the top card.*if it'?s a land card.*put it into your hand/)) {
      effects.push({ type: 'peek_top_land' });
    }

    return effects.length > 0 ? effects : null;
  },

  // === Cycling abilities (from hand) ===

  // Parse a mana cost string like "{1}{R}" or "{2}" into CMC number
  _parseCyclingCost(costStr) {
    const symbols = costStr.match(/\{[^}]+\}/g) || [];
    let cmc = 0;
    let manaCost = '';
    for (const sym of symbols) {
      manaCost += sym;
      const inner = sym.replace(/[{}]/g, '').toUpperCase();
      if (/^\d+$/.test(inner)) cmc += parseInt(inner);
      else cmc += 1; // Colored mana = 1 CMC each
    }
    return { cmc, manaCost };
  },

  parseCyclingAbility(card) {
    const text = (card.oracle_text || '').toLowerCase();

    // Basic cycling: "Cycling {cost}" (may be multi-symbol like {1}{W})
    const cyclingMatch = text.match(/(?<![a-z])cycling ((?:\{[^}]+\})+)/);
    if (cyclingMatch && !text.match(/landcycling/)) {
      const { cmc, manaCost } = this._parseCyclingCost(cyclingMatch[1]);
      return { type: 'cycling', cost: cmc, manaCost, searchType: null };
    }

    // Plainscycling, Swampcycling, etc: "Plainscycling {cost}"
    const typeCyclingMatch = text.match(/(plains|island|swamp|mountain|forest)cycling ((?:\{[^}]+\})+)/);
    if (typeCyclingMatch) {
      const landTypeMap = {
        'plains': 'Plains',
        'island': 'Island',
        'swamp': 'Swamp',
        'mountain': 'Mountain',
        'forest': 'Forest'
      };
      const { cmc, manaCost } = this._parseCyclingCost(typeCyclingMatch[2]);
      return {
        type: 'typecycling',
        cost: cmc,
        manaCost,
        searchType: landTypeMap[typeCyclingMatch[1]]
      };
    }

    // Basic land cycling: "Basic landcycling {cost}" (may be multi-symbol)
    const basicLandCycling = text.match(/basic landcycling ((?:\{[^}]+\})+)/);
    if (basicLandCycling) {
      const { cmc, manaCost } = this._parseCyclingCost(basicLandCycling[1]);
      return { type: 'basiclandcycling', cost: cmc, manaCost, searchType: 'basic' };
    }

    return null;
  },

  hasCycling(card) {
    return this.parseCyclingAbility(card) !== null;
  },

  // Parse additional costs for casting a spell
  parseAdditionalCosts(card) {
    const text = (card.oracle_text || '').toLowerCase();
    const costs = [];

    // "As an additional cost to cast this spell, sacrifice a creature"
    const sacrificeMatch = text.match(/as an additional cost[^,]*,\s*sacrifice (?:a |an? )?(\w+)/);
    if (sacrificeMatch) {
      const type = sacrificeMatch[1];
      if (type === 'creature') costs.push({ type: 'sacrifice', target: 'creature' });
      else if (type === 'land') costs.push({ type: 'sacrifice', target: 'land' });
      else if (type === 'permanent') costs.push({ type: 'sacrifice', target: 'permanent' });
      else if (type === 'artifact') costs.push({ type: 'sacrifice', target: 'artifact' });
      else costs.push({ type: 'sacrifice', target: 'permanent' });
    }

    // "As an additional cost to cast this spell, discard a card"
    const discardMatch = text.match(/as an additional cost[^,]*,\s*discard (?:a |(\d+) )?cards?/);
    if (discardMatch) {
      costs.push({ type: 'discard', amount: discardMatch[1] ? parseInt(discardMatch[1]) : 1 });
    }

    // "As an additional cost to cast this spell, pay X life"
    const lifeMatch = text.match(/as an additional cost[^,]*,\s*pay (\d+) life/);
    if (lifeMatch) {
      costs.push({ type: 'pay_life', amount: parseInt(lifeMatch[1]) });
    }

    // "As an additional cost to cast this spell, tap an untapped creature you control"
    if (text.match(/as an additional cost[^,]*,\s*tap an untapped creature/)) {
      costs.push({ type: 'tap_creature' });
    }

    // Behold: "as an additional cost, behold a [type]" or "behold a [type] or pay {N}"
    // Skip if behold is only for granting flash ("if you behold" = optional flash enabler, not a cost)
    const beholdMatch = text.match(/behold (?:a |an )?(\w+)/);
    if (beholdMatch && text.includes('behold') && !text.match(/as though it had flash if you behold/i)) {
      const beholdType = beholdMatch[1];
      // Check if it's "behold or pay" (optional behold) or "you may behold" (also optional)
      const orPayMatch = text.match(/behold[^.]*or pay \{(\d+)\}/);
      const mayBehold = !!text.match(/you may behold/i);
      costs.push({
        type: 'behold',
        subtype: beholdType.charAt(0).toUpperCase() + beholdType.slice(1),
        optional: !!orPayMatch || mayBehold,
        alternateCost: orPayMatch ? parseInt(orPayMatch[1]) : 0
      });
    }

    return costs;
  },

  hasAdditionalCosts(card) {
    return this.parseAdditionalCosts(card).length > 0;
  },

  // === Activated abilities ===

  parseActivatedAbilities(card) {
    const text = (card.oracle_text || '').toLowerCase();
    if (!text.includes(':')) return [];

    const abilities = [];
    // Split by newlines to get individual abilities
    const lines = text.split('\n');

    for (const line of lines) {
      // Pattern: "{cost}: {effect}" or "{T}: {effect}" or "{T}, Pay N life: effect"
      // Skip mana abilities (those that just add mana)
      if (line.match(/\{t\}\s*:\s*add \{/)) continue;
      // Skip equip (handled separately)
      if (line.startsWith('equip')) continue;

      // Match "{N}: effect" or "{T}: effect" or "{N}, {T}: effect"
      const costMatch = line.match(/^(?:\{([^}]+)\}(?:,\s*)?)+\s*:\s*(.+)/);
      if (!costMatch) continue;

      const costPart = line.split(':')[0].trim();
      const effectPart = line.split(':').slice(1).join(':').trim();

      // Parse cost - preserve mana string for colored requirements
      let manaCostStr = '';
      let requiresTap = false;
      const costSymbols = costPart.match(/\{([^}]+)\}/g) || [];
      costSymbols.forEach(sym => {
        const val = sym.replace(/[{}]/g, '').toUpperCase();
        if (val === 'T') requiresTap = true;
        else manaCostStr += val; // Build string like "1R", "2BB", "W"
      });

      // Parse effect
      const effects = [];
      const drawMatch = effectPart.match(/draw (?:a |(\d+) )?cards?/);
      if (drawMatch) effects.push({ type: 'draw', amount: drawMatch[1] ? parseInt(drawMatch[1]) : 1 });

      const buffMatch = effectPart.match(/gets? ([+-]\d+)\/([+-]\d+)/);
      if (buffMatch) effects.push({ type: 'buff_self', power: parseInt(buffMatch[1]), toughness: parseInt(buffMatch[2]) });

      // Damage to each opponent
      const dmgEachOppMatch = effectPart.match(/deals? (\d+) damage to each opponent/);
      if (dmgEachOppMatch) {
        effects.push({ type: 'damage_each_opponent', amount: parseInt(dmgEachOppMatch[1]) });
      } else {
        // Regular damage
        const dmgMatch = effectPart.match(/deals? (\d+) damage/);
        if (dmgMatch) {
          const target = effectPart.includes('target creature') ? 'creature' :
                        effectPart.includes('any target') ? 'any target' : 'opponent';
          effects.push({ type: 'damage', amount: parseInt(dmgMatch[1]), target });
        }
      }

      const lifeMatch = effectPart.match(/gain (\d+) life/);
      if (lifeMatch) effects.push({ type: 'gainLife', amount: parseInt(lifeMatch[1]) });

      const loseLifeMatch = effectPart.match(/(?:target opponent|each opponent) loses? (\d+) life/);
      if (loseLifeMatch) effects.push({ type: 'loseLife', amount: parseInt(loseLifeMatch[1]), target: 'opponent' });

      const counterMatch = effectPart.match(/put (?:a |(\d+) )?\+1\/\+1 counter/);
      if (counterMatch) effects.push({ type: 'counter_self', counter: '+1/+1', amount: counterMatch[1] ? parseInt(counterMatch[1]) : 1 });

      const tokenMatch = effectPart.match(/create (?:a |(\d+) )?(\d+)\/(\d+)/);
      if (tokenMatch) effects.push({ type: 'create_token', count: tokenMatch[1] ? parseInt(tokenMatch[1]) : 1, power: parseInt(tokenMatch[2]), toughness: parseInt(tokenMatch[3]), name: 'Token' });

      // Add mana (effectPart is lowercase)
      const addManaMatch = effectPart.match(/add \{([wubrgc])\}/);
      if (addManaMatch) effects.push({ type: 'add_mana', color: addManaMatch[1].toUpperCase() });

      // Destroy target
      if (effectPart.includes('destroy target')) {
        effects.push({ type: 'destroy', target: 'creature' });
      }

      // Tap/Untap
      if (effectPart.includes('tap target')) {
        effects.push({ type: 'tap', target: 'creature' });
      }
      if (effectPart.includes('untap')) {
        effects.push({ type: 'untap_self' });
      }

      if (effects.length > 0) {
        abilities.push({
          cost: { mana: manaCostStr || 0, tap: requiresTap },
          effects,
          text: line.trim()
        });
      }
    }

    return abilities;
  },

  // ========== ART PICKER SYSTEM ==========

  // Get available arts for a card from Scryfall
  async getAvailableArts(card) {
    try {
      // Use cards already fetched or fetch from Scryfall
      if (card._allPrints && Array.isArray(card._allPrints)) {
        // Already cached all prints
        return card._allPrints.map((print, idx) => ({
          index: idx,
          image: print.image_uris?.small || print.image_uris?.normal || print.image_small || print.image_normal,
          imageSmall: print.image_uris?.small || print.image_small,
          imageNormal: print.image_uris?.normal || print.image_normal,
          url: print.scryfall_uri,
          setName: print.set_name,
          collector: print.collector_number,
          fullArt: print.full_art || false,
          borderless: print.borderless || false,
          foil: print.foil || false
        }));
      }

      // Fetch from Scryfall if not cached
      const searchUrl = `https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(card.name)}"&unique=prints&order=released&dir=desc`;
      const response = await fetch(searchUrl);
      if (!response.ok) return [];

      const data = await response.json();
      if (!data.data || data.data.length === 0) return [];

      // Cache all prints on the card object
      card._allPrints = data.data;

      return data.data.map((print, idx) => ({
        index: idx,
        image: print.image_uris?.small || print.image_uris?.normal || print.image_small || print.image_normal,
        imageSmall: print.image_uris?.small || print.image_small,
        imageNormal: print.image_uris?.normal || print.image_normal,
        url: print.scryfall_uri,
        setName: print.set_name,
        collector: print.collector_number,
        fullArt: print.full_art || false,
        borderless: print.borderless || false,
        foil: print.foil || false
      }));
    } catch (e) {
      console.warn('Failed to fetch card arts:', e);
      return [];
    }
  },

  // Get currently selected art for a card
  getSelectedArt(card) {
    if (card._selectedArtIndex !== undefined && card._allPrints) {
      const print = card._allPrints[card._selectedArtIndex];
      if (print) {
        return print.image_uris?.small || print.image_uris?.normal || print.image_small || print.image_normal;
      }
    }
    return card.image_small || card.image_normal;
  },

  // Set selected art for a card
  setSelectedArt(card, artIndex) {
    if (card._allPrints && card._allPrints[artIndex]) {
      card._selectedArtIndex = artIndex;
      const print = card._allPrints[artIndex];
      // Update with correct image URIs from Scryfall
      if (print.image_uris) {
        card.image_small = print.image_uris.small;
        card.image_normal = print.image_uris.normal;
        card.image_uris = print.image_uris;
      } else {
        // Fallback to direct image properties
        card.image_small = print.image_small;
        card.image_normal = print.image_normal;
      }
      return true;
    }
    return false;
  }
};
