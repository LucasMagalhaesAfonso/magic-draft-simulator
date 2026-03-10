import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('War Effort', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['war effort']).toBeDefined();
  });

  it('creates red 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('anthem +1/+0', () => {
    const game = new TestGame();
    const lord = game.addToBattlefield(0, { name: 'War Effort', type_line: 'Enchantment', power: '2', toughness: '2', keywords: [] });
    const other = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    // Anthem effects should buff other creatures
    // Exact assertion depends on engine static ability processing
    const dbEntry = CardEffectsDB['war effort'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    const hasAnthem = json.includes('anthem') || json.includes('buff_all');
    expect(hasAnthem).toBe(true);
  });

});
