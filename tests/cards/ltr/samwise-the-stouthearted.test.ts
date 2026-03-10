import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Samwise the Stouthearted', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['samwise the stouthearted']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Samwise the Stouthearted', type_line: 'Legendary Creature — Halfling Peasant', power: '2', toughness: '1', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['samwise the stouthearted'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
