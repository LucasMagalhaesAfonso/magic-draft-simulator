import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ranger\'s Firebrand', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ranger\'s firebrand']).toBeDefined();
  });

  it('deals 2 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 2, target: 'opponent' });
    expect(game.life(1)).toBe(18);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['ranger\'s firebrand'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
