import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dragon Sniper', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dragon sniper']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Dragon Sniper', type_line: 'Creature — Human Archer', power: '1', toughness: '1', keywords: ["Reach","Vigilance","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Dragon Sniper', type_line: 'Creature — Human Archer', power: '1', toughness: '1', keywords: ["Reach","Vigilance","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Dragon Sniper', type_line: 'Creature — Human Archer', power: '1', toughness: '1', keywords: ["Reach","Vigilance","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

});
