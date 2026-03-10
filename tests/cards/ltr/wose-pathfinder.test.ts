import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wose Pathfinder', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wose pathfinder']).toBeDefined();
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['wose pathfinder'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
