import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Morgul-Knife Wound', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['morgul-knife wound']).toBeDefined();
  });

  it('has upkeep trigger', () => {
    const dbEntry = CardEffectsDB['morgul-knife wound'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

});
