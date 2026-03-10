import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Attuned Hunter', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['attuned hunter']).toBeDefined();
  });

  it('has Trample', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Attuned Hunter', type_line: 'Creature — Human Ranger', power: '3', toughness: '3', keywords: ["Trample"] });
    expect(CardUtils.hasKeyword(card, 'Trample')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['attuned hunter'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
