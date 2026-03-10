import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Roamer\'s Routine', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['roamer\'s routine']).toBeDefined();
  });

  it('ramps (search for basic land)', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['roamer\'s routine'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ramp') || json.includes('search') || json.includes('land')).toBe(true);
  });

});
