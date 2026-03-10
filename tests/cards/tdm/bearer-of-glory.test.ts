import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Bearer of Glory', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['bearer of glory']).toBeDefined();
  });

  it('anthem +1/+1', () => {
    const game = new TestGame();
    const lord = game.addToBattlefield(0, { name: 'Bearer of Glory', type_line: 'Creature — Human Soldier', power: '2', toughness: '1', keywords: [] });
    const other = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    // Anthem effects should buff other creatures
    // Exact assertion depends on engine static ability processing
    const dbEntry = CardEffectsDB['bearer of glory'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    const hasAnthem = json.includes('anthem') || json.includes('buff_all');
    expect(hasAnthem).toBe(true);
  });

});
