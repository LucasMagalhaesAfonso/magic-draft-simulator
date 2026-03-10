import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Cori Mountain Monastery', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['cori mountain monastery']).toBeDefined();
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['cori mountain monastery'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
