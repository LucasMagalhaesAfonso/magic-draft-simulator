import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Théoden, King of Rohan', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['théoden, king of rohan']).toBeDefined();
  });

  it('has enters trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['théoden, king of rohan'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'enters_battlefield') ?? false) || json.includes('enters_battlefield');
    expect(hasTrigger).toBe(true);
  });

});
