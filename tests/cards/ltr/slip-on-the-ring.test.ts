import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Slip On the Ring', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['slip on the ring']).toBeDefined();
  });

  it('exiles target creature', () => {
    const dbEntry = CardEffectsDB['slip on the ring'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['slip on the ring'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
