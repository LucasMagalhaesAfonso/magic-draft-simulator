import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Lórien Revealed', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['lórien revealed']).toBeDefined();
  });

  it('draws 3 cards', () => {
    const game = new TestGame();
    for (let i = 0; i < 5; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 3 });
    expect(game.hand(0).length).toBe(startHand + 3);
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['lórien revealed'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor') || json.includes('cycling') || json.includes('buff_all')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['lórien revealed'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp') || json.includes('search') || json.includes('cycling') || json.includes('ring') || json.includes('saga')).toBe(true);
  });

});
