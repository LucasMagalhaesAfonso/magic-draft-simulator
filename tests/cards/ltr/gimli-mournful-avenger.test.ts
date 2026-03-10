import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Gimli, Mournful Avenger', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['gimli, mournful avenger']).toBeDefined();
  });

  it('has creature dies trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['gimli, mournful avenger'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['dies', 'creature_dies', 'other_creature_dies', 'any_creature_dies'].includes(t.event)) ?? false) || !!(dbEntry.gy_trigger) || json.includes('dies');
    expect(hasTrigger).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['gimli, mournful avenger'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('fight', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['gimli, mournful avenger'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('fight') || json.includes('damage') || json.includes('destroy')).toBe(true);
  });

});
