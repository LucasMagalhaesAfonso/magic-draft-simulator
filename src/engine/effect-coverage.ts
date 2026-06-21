// effect-coverage.ts — Track which cards have full/partial/no effect coverage

import { CardEffectsDB } from './card-effects';

export type CoverageLevel = 'hardcoded' | 'generated' | 'complex' | 'no_oracle';

export interface CardCoverage {
  name: string;
  oracle_text: string;
  type_line: string;
  level: CoverageLevel;
}

const _coverage: Map<string, CoverageLevel> = new Map();
const _complexBySet: Map<string, CardCoverage[]> = new Map();
const HARDCODED_KEYS = new Set(Object.keys(CardEffectsDB));

export function classifyCards(
  setCode: string,
  cards: Array<{ name: string; oracle_text?: string; type_line?: string }>
): void {
  const complex: CardCoverage[] = [];
  for (const card of cards) {
    const key = card.name.toLowerCase();
    const typeLine = (card.type_line || '').toLowerCase();
    const oracle = (card.oracle_text || '').trim();

    let level: CoverageLevel;
    if (!oracle || typeLine.includes('basic land')) {
      level = 'no_oracle';
    } else if (HARDCODED_KEYS.has(key)) {
      level = 'hardcoded';
    } else if (CardEffectsDB[key]) {
      level = 'generated';
    } else {
      level = 'complex';
      complex.push({ name: card.name, oracle_text: oracle, type_line: card.type_line || '', level: 'complex' });
    }
    _coverage.set(key, level);
  }
  _complexBySet.set(setCode, complex);
}

export function getCoverageStats(): {
  total: number;
  hardcoded: number;
  generated: number;
  complex: number;
  no_oracle: number;
  pct: number;
} {
  const entries = [..._coverage.values()];
  const total     = entries.length;
  const hardcoded = entries.filter(l => l === 'hardcoded').length;
  const generated = entries.filter(l => l === 'generated').length;
  const complex   = entries.filter(l => l === 'complex').length;
  const no_oracle = entries.filter(l => l === 'no_oracle').length;
  const covered   = hardcoded + generated + no_oracle;
  const pct       = total > 0 ? Math.round((covered / total) * 100) : 0;
  return { total, hardcoded, generated, complex, no_oracle, pct };
}

export function getComplexCards(setCode?: string): CardCoverage[] {
  if (setCode) return _complexBySet.get(setCode) || [];
  const all: CardCoverage[] = [];
  for (const cards of _complexBySet.values()) all.push(...cards);
  // Deduplicate by name
  const seen = new Set<string>();
  return all.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
}

export function markGenerated(cardName: string): void {
  const key = cardName.toLowerCase();
  if (_coverage.get(key) === 'complex') {
    _coverage.set(key, 'generated');
    for (const [sc, list] of _complexBySet.entries()) {
      _complexBySet.set(sc, list.filter(c => c.name.toLowerCase() !== key));
    }
  }
}
