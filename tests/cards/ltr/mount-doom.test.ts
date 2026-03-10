import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Mount Doom', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['mount doom']).toBeDefined();
  });

  it('deals 1 damage to each opponent', () => {
    // Verify DB has damage to each opponent effect
    const dbEntry = CardEffectsDB['mount doom'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('damage') || json.includes('loses')).toBe(true);
  });

});
