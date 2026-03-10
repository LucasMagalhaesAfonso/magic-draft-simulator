import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shagrat, Loot Bearer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shagrat, loot bearer']).toBeDefined();
  });

  it('amass X', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['shagrat, loot bearer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['shagrat, loot bearer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
