import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Karakyk Guardian', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['karakyk guardian']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Karakyk Guardian', type_line: 'Creature — Dragon', power: '6', toughness: '5', keywords: ["Flying","Vigilance","Trample"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Karakyk Guardian', type_line: 'Creature — Dragon', power: '6', toughness: '5', keywords: ["Flying","Vigilance","Trample"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Karakyk Guardian', type_line: 'Creature — Dragon', power: '6', toughness: '5', keywords: ["Flying","Vigilance","Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

});
