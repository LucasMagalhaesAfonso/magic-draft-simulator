import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Éowyn, Fearless Knight', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['éowyn, fearless knight']).toBeDefined();
  });

  it('has haste keyword', () => {
    const dbEntry = CardEffectsDB['éowyn, fearless knight'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json).toContain('haste');
  });

  it('has ETB exile effect', () => {
    const dbEntry = CardEffectsDB['éowyn, fearless knight'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('etb') || json.includes('enters')).toBe(true);
    expect(json).toContain('exile');
  });
});
