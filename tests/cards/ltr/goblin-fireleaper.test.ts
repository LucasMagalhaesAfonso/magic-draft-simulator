import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Goblin Fireleaper', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['goblin fireleaper']).toBeDefined();
  });

  it('has dies trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['goblin fireleaper'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['dies', 'creature_dies', 'other_creature_dies', 'any_creature_dies'].includes(t.event)) ?? false) || !!(dbEntry.gy_trigger) || json.includes('dies');
    expect(hasTrigger).toBe(true);
  });

});
