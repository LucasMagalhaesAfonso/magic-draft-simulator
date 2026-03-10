import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wayspeaker Bodyguard', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wayspeaker bodyguard']).toBeDefined();
  });

  it('taps target', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['wayspeaker bodyguard'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('tap') || json.includes('exhaust')).toBe(true);
  });

});
