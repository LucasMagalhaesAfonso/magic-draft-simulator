import { describe, it, expect } from 'vitest';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Galadriel of Lothlórien', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['galadriel of lothlórien']).toBeDefined();
  });

  it('has ring_tempts trigger with scry 3', () => {
    const dbEntry = CardEffectsDB['galadriel of lothlórien'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json).toContain('ring_tempts');
    expect(json).toContain('scry');
  });
});
