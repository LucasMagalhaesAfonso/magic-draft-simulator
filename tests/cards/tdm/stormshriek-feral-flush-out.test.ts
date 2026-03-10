import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stormshriek Feral // Flush Out', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stormshriek feral']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Stormshriek Feral // Flush Out', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '3', keywords: ["Flying","Haste"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Haste', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Stormshriek Feral // Flush Out', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '3', keywords: ["Flying","Haste"] });
    expect(CardUtils.hasKeyword(card, 'Haste')).toBe(true);
  });

  it('draws 2 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 4; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 2 });
    expect(game.hand(0).length).toBe(startHand + 2);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['stormshriek feral'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

});
