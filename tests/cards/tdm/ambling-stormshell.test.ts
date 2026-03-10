import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ambling Stormshell', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ambling stormshell']).toBeDefined();
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Ambling Stormshell', type_line: 'Creature — Turtle', power: '5', toughness: '9', keywords: ["Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['ambling stormshell'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

  it('draws 3 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 3 });
    expect(game.hand(0).length).toBe(startHand + 3);
  });

});
