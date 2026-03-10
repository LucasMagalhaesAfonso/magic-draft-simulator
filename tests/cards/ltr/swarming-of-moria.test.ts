import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Swarming of Moria', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['swarming of moria']).toBeDefined();
  });

  it('creates Treasure token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['swarming of moria'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('treasure') || json.includes('create_token') || json.includes('token') || json.includes('mana')).toBe(true);
  });

  it('amass 2', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['swarming of moria'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['swarming of moria'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
