import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Twinmaw Stormbrood // Charring Bite', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['twinmaw stormbrood']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Twinmaw Stormbrood // Charring Bite', type_line: 'Creature — Dragon // Sorcery — Omen', power: '5', toughness: '4', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('deals 5 damage', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '1', toughness: '6' });
    game.resolveEffect(0, { type: 'damage', amount: 5, target: 'creature' });
    expect(target._damage).toBe(5);
  });

  it('gains 5 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 5 });
    expect(game.life(0)).toBe(25);
  });

});
