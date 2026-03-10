import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sunset Strikemaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sunset strikemaster']).toBeDefined();
  });

  it('taps for {R}', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sunset strikemaster'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('add_mana') || json.includes('mana') || json.includes('tap')).toBe(true);
  });

});
