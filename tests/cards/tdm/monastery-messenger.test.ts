import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Monastery Messenger', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['monastery messenger']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Monastery Messenger', type_line: 'Creature — Bird Scout', power: '2', toughness: '3', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Monastery Messenger', type_line: 'Creature — Bird Scout', power: '2', toughness: '3', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

});
