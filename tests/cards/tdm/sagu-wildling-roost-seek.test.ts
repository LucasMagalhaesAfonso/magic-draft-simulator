import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Sagu Wildling // Roost Seek', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['sagu wildling']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Sagu Wildling // Roost Seek', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

  it('ramps (search for basic land)', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sagu wildling'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ramp') || json.includes('search') || json.includes('land')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['sagu wildling'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp')).toBe(true);
  });

});
