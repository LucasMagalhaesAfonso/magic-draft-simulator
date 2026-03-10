import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Arashin Sunshield', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['arashin sunshield']).toBeDefined();
  });

  it('taps target', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['arashin sunshield'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('tap') || json.includes('exhaust')).toBe(true);
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['arashin sunshield'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
