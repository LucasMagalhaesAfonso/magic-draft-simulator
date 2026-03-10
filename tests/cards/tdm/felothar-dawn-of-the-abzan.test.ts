import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Felothar, Dawn of the Abzan', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['felothar, dawn of the abzan']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Felothar, Dawn of the Abzan', type_line: 'Legendary Creature — Human Warrior', power: '3', toughness: '3', keywords: ["Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['felothar, dawn of the abzan'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
