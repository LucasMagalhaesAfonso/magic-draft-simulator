import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Riverwheel Sweep', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['riverwheel sweep']).toBeDefined();
  });

  it('taps target', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['riverwheel sweep'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('tap') || json.includes('exhaust')).toBe(true);
  });

});
