import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Storm of Saruman', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['storm of saruman']).toBeDefined();
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Storm of Saruman', type_line: 'Enchantment', keywords: ["Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

});
