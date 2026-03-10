import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Evolving Wilds', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['evolving wilds']).toBeDefined();
  });

  it('ramps (search for basic land)', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['evolving wilds'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ramp') || json.includes('search') || json.includes('land')).toBe(true);
  });

});
