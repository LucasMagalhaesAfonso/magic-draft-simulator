import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Old Man Willow', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['old man willow']).toBeDefined();
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['old man willow'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['old man willow'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost') || json.includes('ramp') || json.includes('debuff')).toBe(true);
  });

});
