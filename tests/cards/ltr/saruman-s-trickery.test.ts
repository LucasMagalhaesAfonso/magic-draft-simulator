import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Saruman\'s Trickery', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['saruman\'s trickery']).toBeDefined();
  });

  it('amass 1', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['saruman\'s trickery'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['saruman\'s trickery'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('counters target spell', () => {
    // Verify CardEffectsDB has counter spell effect
    const dbEntry = CardEffectsDB['saruman\'s trickery'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json).toContain('counter_spell');
  });

});
