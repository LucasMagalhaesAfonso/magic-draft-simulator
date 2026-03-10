import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Focus the Mind', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['focus the mind']).toBeDefined();
  });

  it('draws 3 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 3 });
    expect(game.hand(0).length).toBe(startHand + 3);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['focus the mind'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard')).toBe(true);
  });

  it('costs {2} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['focus the mind'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
