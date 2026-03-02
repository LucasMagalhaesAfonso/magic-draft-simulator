// mana.ts — Mana system: pool management, cost parsing, payment
// Ported from legacy mana.js

import type { GameCard, ManaPool, ParsedManaCost, EngineGameState } from './engine-types';
import { isLand, isCreature, getPower } from './card-utils';

// ============================================
// Pool Management
// ============================================

export function createPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return Object.values(pool).reduce((a, b) => a + b, 0);
}

export function poolToString(pool: ManaPool): string {
  const parts: string[] = [];
  for (const [color, amount] of Object.entries(pool)) {
    if (amount > 0) parts.push(`${amount}${color}`);
  }
  return parts.join(' ') || '0';
}

// ============================================
// Cost Formatting
// ============================================

export function formatManaCost(costStr: string | number | null | undefined): string {
  if (!costStr) return '';
  const str = String(costStr);
  if (str.includes('{')) return str;

  let result = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (/\d/.test(ch)) {
      let num = '';
      while (i < str.length && /\d/.test(str[i])) {
        num += str[i];
        i++;
      }
      result += `{${num}}`;
    } else if ('WUBRGXCS'.includes(ch.toUpperCase())) {
      result += `{${ch.toUpperCase()}}`;
      i++;
    } else {
      i++;
    }
  }
  return result;
}

// ============================================
// Cost Parsing
// ============================================

export function parseCost(manaCost: string | null | undefined): ParsedManaCost {
  if (!manaCost) return { generic: 0, colored: {}, hybrids: [], variableX: 0, total: 0 };

  const colored: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const hybrids: string[][] = [];
  let generic = 0;
  let variableX = 0;

  const symbols = manaCost.match(/\{([^}]+)\}/g) || [];
  symbols.forEach(sym => {
    const val = sym.replace(/[{}]/g, '');

    if (colored[val] !== undefined) {
      colored[val]++;
    } else if (/^\d+$/.test(val)) {
      generic += parseInt(val);
    } else if (val === 'X') {
      variableX++;
    } else if (val === 'C' || val === 'S') {
      generic++;
    } else if (val.includes('/')) {
      const parts = val.split('/');
      if (parts.includes('P')) {
        const colorPart = parts.find(p => colored[p] !== undefined);
        if (colorPart) {
          colored[colorPart]++;
        } else {
          generic++;
        }
      } else {
        hybrids.push(parts);
      }
    } else if (val.includes('X')) {
      let xCount = 0;
      let remainingCost = val;

      while (remainingCost.includes('X')) {
        xCount++;
        remainingCost = remainingCost.replace('X', '');
      }

      variableX += xCount;

      for (const char of remainingCost) {
        if (colored[char] !== undefined) {
          colored[char]++;
        } else if (/^\d+$/.test(char)) {
          generic += parseInt(char);
        }
      }
    }
  });

  // Calculate total considering hybrid minimum
  let hybridCost = 0;
  for (const parts of hybrids) {
    let minCost = Infinity;
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        minCost = Math.min(minCost, parseInt(part));
      } else {
        minCost = Math.min(minCost, 1);
      }
    }
    if (minCost !== Infinity) hybridCost += minCost;
  }

  const total = generic + Object.values(colored).reduce((a, b) => a + b, 0) + hybridCost + variableX;
  return { generic, colored, hybrids, variableX, total };
}

// ============================================
// Cost String Conversion
// ============================================

export function costToString(costObj: Record<string, number>): string {
  const parts: string[] = [];

  if ((costObj.generic || 0) > 0) {
    parts.push(`{${costObj.generic}}`);
  }

  const colors = ['W', 'U', 'B', 'R', 'G'];
  colors.forEach(color => {
    const count = costObj[color] || 0;
    for (let i = 0; i < count; i++) {
      parts.push(`{${color}}`);
    }
  });

  if ((costObj.C || 0) > 0) {
    for (let i = 0; i < costObj.C; i++) {
      parts.push('{C}');
    }
  }

  return parts.length > 0 ? parts.join('') : '{0}';
}

// ============================================
// Can Pay / Pay Mana
// ============================================

export function canPay(pool: ManaPool, manaCost: string, cmc?: number): boolean {
  const cost = parseCost(manaCost);

  // Fallback: if mana_cost is empty but cmc > 0
  if (cost.total === 0 && cmc && cmc > 0) {
    const totalMana = Object.values(pool).reduce((a, b) => a + b, 0);
    return totalMana >= cmc;
  }

  if (!cost.hybrids || cost.hybrids.length === 0) {
    // Cost reduction
    if (cmc !== undefined && cmc >= 0 && cost.total > cmc) {
      const reduction = cost.total - cmc;
      cost.generic = Math.max(0, cost.generic - reduction);
      cost.total = cmc;
    }
    if (cmc && cmc > 0 && cost.total < cmc) {
      const totalMana = Object.values(pool).reduce((a, b) => a + b, 0);
      if (totalMana < cmc) return false;
    }
  }

  if (!cost.hybrids || cost.hybrids.length === 0) {
    const tempPool: Record<string, number> = { ...pool };

    for (const [color, amount] of Object.entries(cost.colored)) {
      if ((tempPool[color] || 0) < amount) return false;
      tempPool[color] -= amount;
    }

    const remaining = Object.values(tempPool).reduce((a, b) => a + b, 0);
    return remaining >= cost.generic;
  }

  return _canPayWithHybrids(pool, cost);
}

function _canPayWithHybrids(pool: ManaPool, cost: ParsedManaCost): boolean {
  const combinations = _generateHybridCombinations(cost.hybrids);
  for (const combination of combinations) {
    if (_canPayCombination(pool, cost, combination)) return true;
  }
  return false;
}

export function _generateHybridCombinations(hybrids: string[][]): string[][] {
  if (hybrids.length === 0) return [[]];
  const [first, ...rest] = hybrids;
  const restCombinations = _generateHybridCombinations(rest);
  const combinations: string[][] = [];
  for (const option of first) {
    for (const restCombination of restCombinations) {
      combinations.push([option, ...restCombination]);
    }
  }
  return combinations;
}

function _canPayCombination(pool: ManaPool, cost: ParsedManaCost, hybridChoices: string[]): boolean {
  const tempPool: Record<string, number> = { ...pool };
  const tempColored: Record<string, number> = { ...cost.colored };
  let tempGeneric = cost.generic;

  for (const choice of hybridChoices) {
    if (/^\d+$/.test(choice)) {
      tempGeneric += parseInt(choice);
    } else {
      if (tempColored[choice] === undefined) tempColored[choice] = 0;
      tempColored[choice]++;
    }
  }

  for (const [color, amount] of Object.entries(tempColored)) {
    if ((tempPool[color] || 0) < amount) return false;
    tempPool[color] -= amount;
  }

  const remaining = Object.values(tempPool).reduce((a, b) => a + b, 0);
  return remaining >= tempGeneric;
}

export function payMana(pool: ManaPool, manaCost: string, cmc?: number): ManaPool {
  const cost = parseCost(manaCost);

  if (cost.total === 0 && cmc && cmc > 0) {
    cost.generic = cmc;
    cost.total = cmc;
  }

  if (cmc !== undefined && (!cost.hybrids || cost.hybrids.length === 0)) {
    const diff = cmc - cost.total;
    if (diff !== 0) {
      cost.generic = Math.max(0, cost.generic + diff);
      cost.total = cmc;
    }
  }

  if (cost.hybrids && cost.hybrids.length > 0) {
    return _payWithHybrids(pool, cost);
  }

  const newPool: ManaPool = { ...pool };

  for (const [color, amount] of Object.entries(cost.colored)) {
    newPool[color] = Math.max(0, (newPool[color] || 0) - amount);
  }

  let genericLeft = cost.generic;
  const colorPriority = Object.entries(newPool)
    .filter(([, v]) => v > 0)
    .sort((a, b) => a[1] - b[1]);

  for (const [color] of colorPriority) {
    while (genericLeft > 0 && newPool[color] > 0) {
      newPool[color]--;
      genericLeft--;
    }
  }

  return newPool;
}

function _payWithHybrids(pool: ManaPool, cost: ParsedManaCost): ManaPool {
  const combinations = _generateHybridCombinations(cost.hybrids);

  let bestPool: ManaPool | null = null;
  let bestRemaining = -1;

  for (const combination of combinations) {
    const testPool = _payCombination(pool, cost, combination);
    if (testPool !== null) {
      const remaining = Object.values(testPool).reduce((a, b) => a + b, 0);
      if (remaining > bestRemaining) {
        bestRemaining = remaining;
        bestPool = testPool;
      }
    }
  }

  return bestPool || pool;
}

function _payCombination(pool: ManaPool, cost: ParsedManaCost, hybridChoices: string[]): ManaPool | null {
  const newPool: ManaPool = { ...pool };
  const tempColored: Record<string, number> = { ...cost.colored };
  let tempGeneric = cost.generic;

  for (const choice of hybridChoices) {
    if (/^\d+$/.test(choice)) {
      tempGeneric += parseInt(choice);
    } else {
      if (tempColored[choice] === undefined) tempColored[choice] = 0;
      tempColored[choice]++;
    }
  }

  for (const [color, amount] of Object.entries(tempColored)) {
    if ((newPool[color] || 0) < amount) return null;
    newPool[color] -= amount;
  }

  let genericLeft = tempGeneric;
  const colorPriority = Object.entries(newPool)
    .filter(([, v]) => v > 0)
    .sort((a, b) => a[1] - b[1]);

  for (const [color] of colorPriority) {
    while (genericLeft > 0 && newPool[color] > 0) {
      newPool[color]--;
      genericLeft--;
    }
  }

  if (genericLeft > 0) return null;
  return newPool;
}

// ============================================
// Land Mana Detection
// ============================================

export function getLandManaColor(card: GameCard): string {
  const colors = getLandManaColors(card);
  return colors.length > 0 ? colors[0] : 'C';
}

export function getLandManaColors(card: GameCard): string[] {
  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();
  const colors: string[] = [];

  // Check basic land types
  if (typeLine.includes('plains')) colors.push('W');
  if (typeLine.includes('island')) colors.push('U');
  if (typeLine.includes('swamp')) colors.push('B');
  if (typeLine.includes('mountain')) colors.push('R');
  if (typeLine.includes('forest')) colors.push('G');

  if (colors.length > 0) return colors;

  // "any color" mana — but skip if it says "spend this mana only" (restricted mana, treat as colorless)
  if (oracleText.includes('add one mana of any color') ||
      oracleText.includes('add mana of any color') ||
      oracleText.includes('add any color') ||
      oracleText.includes('add one mana of any type')) {
    if (oracleText.includes('spend this mana only')) return ['C'];
    if (card.color_identity && card.color_identity.length > 0) {
      return [...card.color_identity];
    }
    return ['W', 'U', 'B', 'R', 'G'];
  }

  // Dual/multi color "or" pattern
  if (oracleText.includes(' or ') && oracleText.includes('add ')) {
    if (card.color_identity && card.color_identity.length > 1) {
      return [...card.color_identity];
    }
  }

  // Mana production in oracle text
  if (oracleText.includes('add {w}') || oracleText.includes('add one or more {w}')) colors.push('W');
  if (oracleText.includes('add {u}') || oracleText.includes('add one or more {u}')) colors.push('U');
  if (oracleText.includes('add {b}') || oracleText.includes('add one or more {b}')) colors.push('B');
  if (oracleText.includes('add {r}') || oracleText.includes('add one or more {r}')) colors.push('R');
  if (oracleText.includes('add {g}') || oracleText.includes('add one or more {g}')) colors.push('G');

  if (colors.length > 0) return colors;

  // Color identity fallback
  if (card.color_identity && card.color_identity.length > 0) {
    return [...card.color_identity];
  }

  // If oracle text has no "add" (mana production text), this land produces no mana
  // e.g. Evolving Wilds only sacrifices to fetch — it never taps for mana
  if (!oracleText.includes('add ')) {
    return [];
  }

  return ['C'];
}

// ============================================
// Available Mana Calculation
// ============================================

export function getAvailableMana(state: EngineGameState, playerId: number): ManaPool {
  const bf = state.players[playerId].zones.battlefield;
  const availableLands = bf.cards.filter(c => isLand(c) && !c._tapped);
  const available = createPool();

  availableLands.forEach(l => {
    const colors = getLandManaColors(l);
    colors.forEach(color => {
      available[color] = (available[color] || 0) + 1;
    });
  });

  Object.keys(state.manaPool[playerId]).forEach(k => {
    available[k] = (available[k] || 0) + state.manaPool[playerId][k];
  });

  return available;
}

export function canAfford(
  state: EngineGameState,
  playerId: number,
  card: GameCard,
  manaCost?: string,
  cmc?: number,
  overrideCmc?: number
): boolean {
  // Fall back to card properties when manaCost/cmc not explicitly provided
  const effectiveManaCost = manaCost ?? card?.mana_cost ?? '';
  const effectiveCmc = cmc ?? card?.cmc ?? 0;

  const bf = state.players[playerId].zones.battlefield;
  const availableLands = bf.cards.filter(c => isLand(c) && !c._tapped);
  const available = createPool();
  let manaProducingLandCount = 0;

  availableLands.forEach(l => {
    const colors = getLandManaColors(l);
    if (colors.length > 0) manaProducingLandCount++;
    colors.forEach(color => {
      available[color] = (available[color] || 0) + 1;
    });
  });

  Object.keys(state.manaPool[playerId]).forEach(k => {
    available[k] = (available[k] || 0) + state.manaPool[playerId][k];
  });

  const pTotal = poolTotal(state.manaPool[playerId]);
  const actualTotal = manaProducingLandCount + pTotal;
  const requiredTotal = (overrideCmc !== undefined) ? overrideCmc : (effectiveCmc || 0);

  if (actualTotal < requiredTotal) return false;

  return canPay(available, effectiveManaCost, requiredTotal);
}

// ============================================
// Convoke Helpers
// ============================================

export function getConvokeCreatures(state: EngineGameState, playerId: number): GameCard[] {
  const bf = state.players[playerId].zones.battlefield;
  return bf.cards.filter(c => isCreature(c) && !c._tapped && !c._summoningSick);
}

export function getConvokeContribution(state: EngineGameState, playerId: number): { count: number; colors: ManaPool } {
  const creatures = getConvokeCreatures(state, playerId);
  const pool = createPool();

  creatures.forEach(c => {
    const colors = c.colors || c.color_identity || [];
    if (colors.length > 0) {
      colors.forEach(clr => {
        pool[clr] = (pool[clr] || 0) + 1;
      });
    } else {
      pool.C = (pool.C || 0) + 1;
    }
  });

  return { count: creatures.length, colors: pool };
}

export function autoConvoke(state: EngineGameState, playerId: number, manaCost: string, cmc: number): number {
  const cost = parseCost(manaCost);
  if (cost.total === 0 && cmc && cmc > 0) { cost.generic = cmc; cost.total = cmc; }
  if (cmc && cmc > 0 && cost.total < cmc && (!cost.hybrids || cost.hybrids.length === 0)) {
    cost.generic += (cmc - cost.total);
    cost.total = cmc;
  }

  const creatures = getConvokeCreatures(state, playerId);
  if (creatures.length === 0) return 0;

  creatures.sort((a, b) => getPower(a) - getPower(b));

  const bf = state.players[playerId].zones.battlefield;
  const untappedLands = bf.cards.filter(c => isLand(c) && !c._tapped).length;
  const poolMana = poolTotal(state.manaPool[playerId]);
  const availableFromLands = untappedLands + poolMana;
  const deficit = Math.max(0, cost.total - availableFromLands);

  if (deficit <= 0) return 0;

  const maxToTap = Math.min(deficit, cost.total);
  let tappedCount = 0;

  // Check colored deficit
  const landPool = getAvailableMana(state, playerId);
  const coloredDeficit: Record<string, number> = {};
  for (const [clr, amt] of Object.entries(cost.colored)) {
    const canCover = Math.min(landPool[clr] || 0, amt);
    coloredDeficit[clr] = amt - canCover;
  }

  // First: tap creatures matching colored needs
  for (const creature of creatures) {
    if (tappedCount >= maxToTap) break;
    const colors = creature.colors || creature.color_identity || [];
    for (const clr of colors) {
      if (coloredDeficit[clr] && coloredDeficit[clr] > 0) {
        coloredDeficit[clr]--;
        creature._tapped = true;
        state.manaPool[playerId][clr] =
          (state.manaPool[playerId][clr] || 0) + 1;
        tappedCount++;
        break;
      }
    }
  }

  // Second: tap remaining for generic
  for (const creature of creatures) {
    if (tappedCount >= maxToTap) break;
    if (creature._tapped) continue;
    creature._tapped = true;
    const colors = creature.colors || creature.color_identity || [];
    const addColor = colors.length > 0 ? colors[0] : 'C';
    state.manaPool[playerId][addColor] =
      (state.manaPool[playerId][addColor] || 0) + 1;
    tappedCount++;
  }

  return tappedCount;
}
