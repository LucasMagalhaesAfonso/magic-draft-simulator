import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Breaching Dragonstorm', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['breaching dragonstorm']).toBeDefined();
  });

  it('has exile_top_play ETB effect', () => {
    const dbEntry = CardEffectsDB['breaching dragonstorm'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile_top_play')).toBe(true);
  });
});
