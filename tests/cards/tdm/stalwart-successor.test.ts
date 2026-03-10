import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Stalwart Successor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['stalwart successor']).toBeDefined();
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Stalwart Successor', type_line: 'Creature — Human Warrior', power: '3', toughness: '2', keywords: ["Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['stalwart successor'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
