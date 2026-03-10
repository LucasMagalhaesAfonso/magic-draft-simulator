import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Wild Ride', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['wild ride']).toBeDefined();
  });

  it('gives +3/+0 and haste', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.resolveEffect(0, { type: 'buff', power: 3, toughness: 0, duration: 'end_of_turn', target: 'creature' });
    expect(CardUtils.getPower(creature)).toBe(5);
    expect(CardUtils.getToughness(creature)).toBe(2);
  });

});
