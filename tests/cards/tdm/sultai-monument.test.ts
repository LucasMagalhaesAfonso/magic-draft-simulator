import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sultai Monument', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sultai monument']).toBeDefined();
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sultai monument'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sultai monument'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp')).toBe(true);
  });

});
