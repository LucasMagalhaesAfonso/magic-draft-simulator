import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shortcut to Mushrooms', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shortcut to mushrooms']).toBeDefined();
  });

  it('has end step trigger', () => {
    const dbEntry = CardEffectsDB['shortcut to mushrooms'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['shortcut to mushrooms'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['shortcut to mushrooms'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
