import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragonclaw Strike', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragonclaw strike']).toBeDefined();
  });

  it('fight', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['dragonclaw strike'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('fight')).toBe(true);
  });

});
