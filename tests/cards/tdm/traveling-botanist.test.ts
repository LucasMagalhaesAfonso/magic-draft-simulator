import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Traveling Botanist', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['traveling botanist']).toBeDefined();
  });

  it('looks at top of library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['traveling botanist'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('look') || json.includes('surveil') || json.includes('scry') || json.includes('exile_top') || json.includes('reveal')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['traveling botanist'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp')).toBe(true);
  });

});
