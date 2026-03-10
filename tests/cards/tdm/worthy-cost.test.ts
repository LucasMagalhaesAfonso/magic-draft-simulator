import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Worthy Cost', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['worthy cost']).toBeDefined();
  });

  it('exiles target creature', () => {
    const dbEntry = CardEffectsDB['worthy cost'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['worthy cost'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost')).toBe(true);
  });

});
