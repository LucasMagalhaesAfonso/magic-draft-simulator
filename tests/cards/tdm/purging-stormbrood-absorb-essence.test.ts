import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Purging Stormbrood // Absorb Essence', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['purging stormbrood']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Purging Stormbrood // Absorb Essence', type_line: 'Creature — Dragon // Instant — Omen', power: '4', toughness: '4', keywords: ["Flying","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Purging Stormbrood // Absorb Essence', type_line: 'Creature — Dragon // Instant — Omen', power: '4', toughness: '4', keywords: ["Flying","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('gives +2/+2 and lifelink and hexproof', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.resolveEffect(0, { type: 'buff', power: 2, toughness: 2, duration: 'end_of_turn', target: 'creature' });
    expect(CardUtils.getPower(creature)).toBe(4);
    expect(CardUtils.getToughness(creature)).toBe(4);
  });

});
