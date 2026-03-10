import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Coordinated Maneuver', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['coordinated maneuver']).toBeDefined();
  });

  it('destroys target enchantment', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Enchantment' });
    game.resolveEffect(0, { type: 'destroy', target: 'enchantment' }, { targetUid: target._uid });
    expect(game.battlefield(1).find(c => c._uid === target._uid)).toBeUndefined();
  });

});
