const ManaSystem = {
  createPool() {
    return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  },

  parseCost(manaCost) {
    if (!manaCost) return { generic: 0, colored: {}, hybrids: [], variableX: 0, total: 0 };
    const colored = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const hybrids = []; // Array of hybrid requirements
    let generic = 0;
    let variableX = 0;

    const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
    symbols.forEach(sym => {
      const val = sym.replace(/[{}]/g, '');
      if (colored[val] !== undefined) {
        // Standard colored mana: {W}, {U}, {B}, {R}, {G}
        colored[val]++;
      } else if (/^\d+$/.test(val)) {
        // Generic mana: {1}, {2}, {3}, etc.
        generic += parseInt(val);
      } else if (val === 'X') {
        // X costs - variable, needs user input
        variableX++;
      } else if (val === 'C' || val === 'S') {
        // Colorless {C} or Snow {S} - treat as 1 generic
        generic++;
      } else if (val.includes('/')) {
        // Hybrid mana: {G/U}, {2/W}, {G/P}, {R/G}, etc.
        const parts = val.split('/');
        if (parts.includes('P')) {
          // Phyrexian hybrid {G/P} - can pay with colored mana OR 2 life
          const colorPart = parts.find(p => colored[p] !== undefined);
          if (colorPart) {
            // For now, treat as optional colored (simplified)
            colored[colorPart]++;
          } else {
            generic++;
          }
        } else {
          // Regular hybrid: store as hybrid requirement
          hybrids.push(parts);
        }
      } else if (val.includes('X')) {
        // Mixed X costs like "XB", "XRR", "2X", etc.
        let xCount = 0;
        let remainingCost = val;

        // Count X's and remove them
        while (remainingCost.includes('X')) {
          xCount++;
          remainingCost = remainingCost.replace('X', '');
        }

        // Store X count
        variableX += xCount;

        // Parse remaining cost
        for (const char of remainingCost) {
          if (colored[char] !== undefined) {
            colored[char]++;
          } else if (/^\d+$/.test(char)) {
            generic += parseInt(char);
          }
        }
      }
    });

    const total = generic + Object.values(colored).reduce((a, b) => a + b, 0) + hybrids.length + variableX;
    return { generic, colored, hybrids, variableX, total };
  },

  canPay(pool, manaCost, cmc) {
    const cost = this.parseCost(manaCost);

    // Fallback: if mana_cost is empty/unparseable but cmc > 0, check total >= cmc
    if (cost.total === 0 && cmc && cmc > 0) {
      const totalMana = Object.values(pool).reduce((a, b) => a + b, 0);
      return totalMana >= cmc;
    }

    // Extra safety: if parsed total doesn't match cmc, use the HIGHER value
    if (cmc && cmc > 0 && cost.total < cmc) {
      // Mana cost parsed lower than cmc (missing symbols?) - use cmc as minimum
      const totalMana = Object.values(pool).reduce((a, b) => a + b, 0);
      if (totalMana < cmc) return false;
    }

    // If no hybrids, use old logic
    if (!cost.hybrids || cost.hybrids.length === 0) {
      const tempPool = { ...pool };

      // Pay colored costs first
      for (const [color, amount] of Object.entries(cost.colored)) {
        if ((tempPool[color] || 0) < amount) return false;
        tempPool[color] -= amount;
      }

      // Pay generic with remaining mana
      const remaining = Object.values(tempPool).reduce((a, b) => a + b, 0);
      return remaining >= cost.generic;
    }

    // Handle hybrids: try all combinations
    return this._canPayWithHybrids(pool, cost);
  },

  _canPayWithHybrids(pool, cost) {
    // Generate all possible ways to pay hybrids
    const hybridCombinations = this._generateHybridCombinations(cost.hybrids);

    for (const combination of hybridCombinations) {
      if (this._canPayCombination(pool, cost, combination)) {
        return true;
      }
    }

    return false;
  },

  _generateHybridCombinations(hybrids) {
    if (hybrids.length === 0) return [[]];

    const [first, ...rest] = hybrids;
    const restCombinations = this._generateHybridCombinations(rest);
    const combinations = [];

    for (const option of first) {
      for (const restCombination of restCombinations) {
        combinations.push([option, ...restCombination]);
      }
    }

    return combinations;
  },

  _canPayCombination(pool, cost, hybridChoices) {
    const tempPool = { ...pool };
    const tempColored = { ...cost.colored };
    let tempGeneric = cost.generic;

    // Process hybrid choices
    for (const choice of hybridChoices) {
      if (/^\d+$/.test(choice)) {
        // Numeric choice (e.g., "2" from {2/W})
        tempGeneric += parseInt(choice);
      } else if (tempColored[choice] !== undefined) {
        // Color choice (e.g., "W" from {2/W})
        tempColored[choice]++;
      }
    }

    // Pay colored costs first
    for (const [color, amount] of Object.entries(tempColored)) {
      if ((tempPool[color] || 0) < amount) return false;
      tempPool[color] -= amount;
    }

    // Pay generic with remaining mana
    const remaining = Object.values(tempPool).reduce((a, b) => a + b, 0);
    return remaining >= tempGeneric;
  },

  // Check if player can afford a spell with untapped lands + current pool
  getAvailableMana(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    const availableLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const available = this.createPool();
    availableLands.forEach(l => {
      const colors = this.getLandManaColors(l);
      colors.forEach(color => {
        available[color] = (available[color] || 0) + 1;
      });
    });
    Object.keys(state.manaPool[playerId]).forEach(k => {
      available[k] = (available[k] || 0) + state.manaPool[playerId][k];
    });
    return available;
  },

  canAfford(state, playerId, card, targetCard = null) {
    const bf = state.players[playerId].zones.battlefield;
    const availableLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped);
    const available = this.createPool();

    // Count mana from untapped lands
    availableLands.forEach(l => {
      const colors = this.getLandManaColors(l);
      colors.forEach(color => {
        available[color] = (available[color] || 0) + 1;
      });
    });

    // Add current mana pool
    Object.keys(state.manaPool[playerId]).forEach(k => {
      available[k] = (available[k] || 0) + state.manaPool[playerId][k];
    });

    // Quick total check: actual mana sources (lands + pool) must be >= cmc
    const poolTotal = this.poolTotal(state.manaPool[playerId]);
    const actualTotal = availableLands.length + poolTotal;

    // Get effective mana cost considering conditional costs (like Dragon's Prey)
    const effectiveManaCost = CardEngine.getEffectiveManaCost(card, targetCard);
    const effectiveCost = this.parseCost(effectiveManaCost);
    const requiredTotal = effectiveCost.total || card.cmc || 0;

    if (actualTotal < requiredTotal) return false;

    return this.canPay(available, effectiveManaCost, effectiveCost.total);
  },

  payMana(pool, manaCost, cmc) {
    const cost = this.parseCost(manaCost);
    // Fallback: if mana_cost empty but cmc > 0, pay as generic
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

    const newPool = { ...pool };

    // Pay colored costs
    for (const [color, amount] of Object.entries(cost.colored)) {
      newPool[color] = Math.max(0, (newPool[color] || 0) - amount);
    }

    // Pay generic - use least useful colors first
    let genericLeft = cost.generic;
    const colorPriority = Object.entries(newPool)
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[1] - b[1]); // Use smallest pools first

    for (const [color] of colorPriority) {
      while (genericLeft > 0 && newPool[color] > 0) {
        newPool[color]--;
        genericLeft--;
      }
    }

    return newPool;
  },

  // Returns a SINGLE color for basic/simple lands (backward compat)
  getLandManaColor(card) {
    const colors = this.getLandManaColors(card);
    return colors.length > 0 ? colors[0] : 'C';
  },

  // Returns ALL colors a land can produce
  getLandManaColors(card) {
    const typeLine = (card.type_line || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const colors = [];

    // Check for basic land types first
    if (typeLine.includes('plains')) colors.push('W');
    if (typeLine.includes('island')) colors.push('U');
    if (typeLine.includes('swamp')) colors.push('B');
    if (typeLine.includes('mountain')) colors.push('R');
    if (typeLine.includes('forest')) colors.push('G');

    // If basic land types found, return them
    if (colors.length > 0) return colors;

    // Check for "any color" mana first (before individual color checks)
    if (oracleText.includes('add one mana of any color') ||
        oracleText.includes('add mana of any color') ||
        oracleText.includes('add any color') ||
        oracleText.includes('add one mana of any type')) {
      // Use color identity for "any color" lands
      if (card.color_identity && card.color_identity.length > 0) {
        return [...card.color_identity];
      }
      return ['W', 'U', 'B', 'R', 'G']; // All colors if no identity
    }

    // Check for dual/multi color patterns like "{B} or {R}" before individual colors
    if (oracleText.includes(' or ') && oracleText.includes('add ')) {
      // This is likely a dual/multi land - use color identity instead of text parsing
      if (card.color_identity && card.color_identity.length > 1) {
        return [...card.color_identity];
      }
    }

    // Check for mana production in oracle text
    if (oracleText.includes('add {w}') || oracleText.includes('add one or more {w}')) colors.push('W');
    if (oracleText.includes('add {u}') || oracleText.includes('add one or more {u}')) colors.push('U');
    if (oracleText.includes('add {b}') || oracleText.includes('add one or more {b}')) colors.push('B');
    if (oracleText.includes('add {r}') || oracleText.includes('add one or more {r}')) colors.push('R');
    if (oracleText.includes('add {g}') || oracleText.includes('add one or more {g}')) colors.push('G');

    // If we found mana colors in text, return them
    if (colors.length > 0) return colors;

    // Use color identity as fallback for dual/tri lands
    if (card.color_identity && card.color_identity.length > 1) {
      return [...card.color_identity];
    }

    // Single color identity
    if (card.color_identity && card.color_identity.length === 1) {
      return [...card.color_identity];
    }

    return ['C'];
  },

  emptyPool() {
    return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  },

  poolTotal(pool) {
    return Object.values(pool).reduce((a, b) => a + b, 0);
  },

  poolToString(pool) {
    const parts = [];
    for (const [color, amount] of Object.entries(pool)) {
      if (amount > 0) parts.push(`${amount}${color}`);
    }
    return parts.join(' ') || '0';
  },

  // --- Convoke helpers ---

  // Get untapped creatures that can be tapped for convoke
  getConvokeCreatures(state, playerId) {
    const bf = state.players[playerId].zones.battlefield;
    return bf.cards.filter(c =>
      CardEngine.isCreature(c) && !c._tapped && !c._summoningSick
    );
  },

  // Calculate how many convoke creatures can contribute, returning {count, colorContrib}
  getConvokeContribution(state, playerId) {
    const creatures = this.getConvokeCreatures(state, playerId);
    const pool = this.createPool();
    creatures.forEach(c => {
      const colors = c.colors || c.color_identity || [];
      if (colors.length > 0) {
        colors.forEach(clr => { pool[clr] = (pool[clr] || 0) + 1; });
      } else {
        pool.C = (pool.C || 0) + 1;
      }
    });
    return { count: creatures.length, colors: pool };
  },

  // Auto-convoke: tap creatures to help pay for a spell.
  // Each tapped creature adds 1 mana of its color (or colorless) to the pool.
  // Returns number of creatures tapped.
  autoConvoke(state, playerId, manaCost, cmc) {
    const cost = this.parseCost(manaCost);
    if (cost.total === 0 && cmc && cmc > 0) { cost.generic = cmc; cost.total = cmc; }
    if (cmc && cmc > 0 && cost.total < cmc) { cost.generic += (cmc - cost.total); cost.total = cmc; }

    const creatures = this.getConvokeCreatures(state, playerId);
    if (creatures.length === 0) return 0;

    // Sort: prefer smaller creatures first (tap weakest to convoke)
    creatures.sort((a, b) => CardEngine.getPower(a) - CardEngine.getPower(b));

    // Figure out how many creatures we actually need
    // Count mana from untapped lands + current pool
    const bf = state.players[playerId].zones.battlefield;
    const untappedLands = bf.cards.filter(c => CardEngine.isLand(c) && !c._tapped).length;
    const poolMana = this.poolTotal(state.manaPool[playerId]);
    const availableFromLands = untappedLands + poolMana;
    const deficit = Math.max(0, cost.total - availableFromLands);

    if (deficit <= 0) return 0; // Lands can cover it, no need for convoke

    const maxToTap = Math.min(deficit, cost.total); // Don't tap more than the spell costs
    let tappedCount = 0;
    const coloredNeeded = { ...cost.colored };

    // First: tap creatures that match colored mana needs still unmet by lands
    // Check which colored costs the pool/lands can already cover
    const landPool = this.getAvailableMana(state, playerId);
    const coloredDeficit = {};
    for (const [clr, amt] of Object.entries(cost.colored)) {
      const canCover = Math.min(landPool[clr] || 0, amt);
      coloredDeficit[clr] = amt - canCover;
    }

    for (const creature of creatures) {
      if (tappedCount >= maxToTap) break;
      const colors = creature.colors || creature.color_identity || [];
      let usedForColored = false;
      for (const clr of colors) {
        if (coloredDeficit[clr] && coloredDeficit[clr] > 0) {
          coloredDeficit[clr]--;
          creature._tapped = true;
          state.manaPool[playerId][clr] = (state.manaPool[playerId][clr] || 0) + 1;
          tappedCount++;
          usedForColored = true;
          break;
        }
      }
    }

    // Second: tap remaining creatures for generic mana (add as colorless)
    for (const creature of creatures) {
      if (tappedCount >= maxToTap) break;
      if (creature._tapped) continue;
      creature._tapped = true;
      // Add as first color of creature, or C if colorless
      const colors = creature.colors || creature.color_identity || [];
      const addColor = colors.length > 0 ? colors[0] : 'C';
      state.manaPool[playerId][addColor] = (state.manaPool[playerId][addColor] || 0) + 1;
      tappedCount++;
    }

    return tappedCount;
  },

  // Convert parsed cost object back to string (for conditional costs)
  costToString(costObj) {
    const parts = [];

    // Add generic cost
    if (costObj.generic > 0) {
      parts.push(`{${costObj.generic}}`);
    }

    // Add colored costs in WUBRG order
    const colors = ['W', 'U', 'B', 'R', 'G'];
    colors.forEach(color => {
      const count = costObj[color] || 0;
      for (let i = 0; i < count; i++) {
        parts.push(`{${color}}`);
      }
    });

    // Add colorless if any
    if (costObj.C > 0) {
      for (let i = 0; i < costObj.C; i++) {
        parts.push('{C}');
      }
    }

    return parts.length > 0 ? parts.join('') : '{0}';
  }
};
