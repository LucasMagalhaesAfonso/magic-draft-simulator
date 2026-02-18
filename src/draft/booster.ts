// booster.ts — Booster pack generation for draft
// Ported from legacy booster.js

import type { Card } from '../lib/types';

const MYTHIC_CHANCE = 1 / 7.4;

function isBasicLand(card: Card): boolean {
  const tl = (card.type_line || '').toLowerCase();
  return tl.includes('basic') && tl.includes('land');
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a single booster pack from a card pool.
 * Standard distribution: 1 rare/mythic, 3 uncommons, 10 commons.
 */
export function generate(cardPool: Card[]): Card[] {
  const byRarity = {
    common: cardPool.filter(c => c.rarity === 'common' && !isBasicLand(c)),
    uncommon: cardPool.filter(c => c.rarity === 'uncommon'),
    rare: cardPool.filter(c => c.rarity === 'rare'),
    mythic: cardPool.filter(c => c.rarity === 'mythic'),
  };

  const pack: Card[] = [];
  const usedIds = new Set<string>();

  const pickRandom = (pool: Card[], count: number): Card[] => {
    const available = pool.filter(c => !usedIds.has(c.id));
    const picked = shuffle(available).slice(0, count);
    picked.forEach(c => usedIds.add(c.id));
    return picked;
  };

  // 1 Rare or Mythic
  const isMythic = Math.random() < MYTHIC_CHANCE && byRarity.mythic.length > 0;
  pack.push(...pickRandom(isMythic ? byRarity.mythic : byRarity.rare, 1));

  // 3 Uncommons
  pack.push(...pickRandom(byRarity.uncommon, 3));

  // 10 Commons
  pack.push(...pickRandom(byRarity.common, 10));

  return pack;
}

/**
 * Generate multiple booster packs.
 */
export function generateMultiple(cardPool: Card[], count: number): Card[][] {
  const packs: Card[][] = [];
  for (let i = 0; i < count; i++) {
    packs.push(generate(cardPool));
  }
  return packs;
}
