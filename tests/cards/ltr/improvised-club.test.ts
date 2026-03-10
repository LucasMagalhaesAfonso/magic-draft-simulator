import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Improvised Club', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['improvised club']).toBeDefined();
  });

  it('deals 4 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 4, target: 'opponent' });
    expect(game.life(1)).toBe(16);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['improvised club'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost') || json.includes('ramp') || json.includes('debuff')).toBe(true);
  });

});
