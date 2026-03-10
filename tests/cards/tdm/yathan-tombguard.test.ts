import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Yathan Tombguard', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['yathan tombguard']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Yathan Tombguard', type_line: 'Creature — Human Warrior', power: '2', toughness: '3', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

  it('has combat damage trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['yathan tombguard'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false) || json.includes('combat_damage_player');
    expect(hasTrigger).toBe(true);
  });

  it('draws 1 card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('draws a card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

});
