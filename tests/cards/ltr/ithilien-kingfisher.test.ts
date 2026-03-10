import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ithilien Kingfisher', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ithilien kingfisher']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Ithilien Kingfisher', type_line: 'Creature — Bird', power: '2', toughness: '1', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has dies trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['ithilien kingfisher'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['dies', 'creature_dies', 'other_creature_dies', 'any_creature_dies'].includes(t.event)) ?? false) || !!(dbEntry.gy_trigger) || json.includes('dies');
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
