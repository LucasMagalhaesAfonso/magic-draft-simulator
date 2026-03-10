import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Maelstrom of the Spirit Dragon', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['maelstrom of the spirit dragon']).toBeDefined();
  });

  it('has activated abilities', () => {
    const dbEntry = CardEffectsDB['maelstrom of the spirit dragon'];
    expect(dbEntry.activated?.length).toBeGreaterThan(0);
  });

  it('adds mana', () => {
    const dbEntry = CardEffectsDB['maelstrom of the spirit dragon'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('add_mana')).toBe(true);
  });
});
