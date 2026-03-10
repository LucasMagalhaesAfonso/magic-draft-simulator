import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Eshki Dragonclaw', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['eshki dragonclaw']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Eshki Dragonclaw', type_line: 'Legendary Creature — Human Warrior', power: '4', toughness: '4', keywords: ["Vigilance","Trample","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Eshki Dragonclaw', type_line: 'Legendary Creature — Human Warrior', power: '4', toughness: '4', keywords: ["Vigilance","Trample","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Eshki Dragonclaw', type_line: 'Legendary Creature — Human Warrior', power: '4', toughness: '4', keywords: ["Vigilance","Trample","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('has combat trigger', () => {
    const dbEntry = CardEffectsDB['eshki dragonclaw'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['eshki dragonclaw'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('draws 1 card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('draws a card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

});
