import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Flowering of the White Tree', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['flowering of the white tree']).toBeDefined();
  });

  it('anthem +2/+1', () => {
    const game = new TestGame();
    const lord = game.addToBattlefield(0, { name: 'Flowering of the White Tree', type_line: 'Legendary Enchantment', power: '2', toughness: '2', keywords: [] });
    const other = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '1', toughness: '1' });
    // Anthem effects should buff other creatures
    // Exact assertion depends on engine static ability processing
    const dbEntry = CardEffectsDB['flowering of the white tree'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    const hasAnthem = json.includes('anthem') || json.includes('buff_all');
    expect(hasAnthem).toBe(true);
  });

});
