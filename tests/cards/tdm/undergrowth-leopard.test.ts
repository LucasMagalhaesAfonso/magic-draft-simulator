import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Undergrowth Leopard', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['undergrowth leopard']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Undergrowth Leopard', type_line: 'Creature — Cat', power: '2', toughness: '2', keywords: ["Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('destroys target artifact', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Artifact' });
    game.resolveEffect(0, { type: 'destroy', target: 'artifact' }, { targetUid: target._uid });
    expect(game.battlefield(1).find(c => c._uid === target._uid)).toBeUndefined();
  });

});
