import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Shelob, Child of Ungoliant', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['shelob, child of ungoliant']).toBeDefined();
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shelob, Child of Ungoliant', type_line: 'Legendary Creature — Spider Demon', power: '8', toughness: '8', keywords: ["Food","Ward","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Shelob, Child of Ungoliant', type_line: 'Legendary Creature — Spider Demon', power: '8', toughness: '8', keywords: ["Food","Ward","Deathtouch"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

});
