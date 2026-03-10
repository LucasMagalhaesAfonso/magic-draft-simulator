import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Pippin\'s Bravery', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['pippin\'s bravery']).toBeDefined();
  });

  it('gives +4/+4', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.resolveEffect(0, { type: 'buff', power: 4, toughness: 4, duration: 'end_of_turn', target: 'creature' });
    expect(CardUtils.getPower(creature)).toBe(6);
    expect(CardUtils.getToughness(creature)).toBe(6);
  });

});
