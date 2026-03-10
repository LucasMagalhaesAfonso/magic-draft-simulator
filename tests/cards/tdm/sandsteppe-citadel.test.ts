import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sandsteppe Citadel', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sandsteppe citadel']).toBeDefined();
  });

  it('enters tapped', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sandsteppe citadel'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('enters_tapped')).toBe(true);
  });

});
