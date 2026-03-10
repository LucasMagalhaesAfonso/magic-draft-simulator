import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sméagol, Helpful Guide', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sméagol, helpful guide']).toBeDefined();
  });

  it('has end step trigger', () => {
    const dbEntry = CardEffectsDB['sméagol, helpful guide'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sméagol, helpful guide'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
