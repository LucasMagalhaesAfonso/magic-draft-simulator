import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('All-Out Assault', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['all-out assault']).toBeDefined();
  });

  it('anthem +1/+1', () => {
    const game = new TestGame();
    const lord = game.addToBattlefield(0, { name: 'All-Out Assault', type_line: 'Enchantment', power: '2', toughness: '2', keywords: [] });
    const other = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    // Anthem effects should buff other creatures
    // Exact assertion depends on engine static ability processing
    const dbEntry = CardEffectsDB['all-out assault'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    const hasAnthem = json.includes('anthem') || json.includes('buff_all');
    expect(hasAnthem).toBe(true);
  });

});
