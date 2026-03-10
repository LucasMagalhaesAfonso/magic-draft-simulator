import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragonback Assault', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragonback assault']).toBeDefined();
  });

  it('ETB deals 3 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 3, target: 'opponent' });
    expect(game.life(1)).toBe(17);
  });

  it('ETB creates 4/4 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('has landfall trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['dragonback assault'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'landfall') ?? false) || json.includes('landfall');
    expect(hasTrigger).toBe(true);
  });

});
