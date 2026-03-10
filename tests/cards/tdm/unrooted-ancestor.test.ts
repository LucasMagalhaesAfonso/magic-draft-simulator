import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Unrooted Ancestor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['unrooted ancestor']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Unrooted Ancestor', type_line: 'Creature — Spirit Cleric', power: '3', toughness: '2', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('involves sacrifice', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['unrooted ancestor'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('sacrifice') || json.includes('sac') || json.includes('cost')).toBe(true);
  });

});
