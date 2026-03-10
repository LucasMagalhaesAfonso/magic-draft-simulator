import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Strider, Ranger of the North', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['strider, ranger of the north']).toBeDefined();
  });

  it('has landfall trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['strider, ranger of the north'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'landfall') ?? false) || json.includes('landfall');
    expect(hasTrigger).toBe(true);
  });

});
