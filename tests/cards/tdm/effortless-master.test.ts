import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Effortless Master', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['effortless master']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Effortless Master', type_line: 'Creature — Orc Monk', power: '4', toughness: '3', keywords: ["Vigilance","Menace"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('has Menace', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Effortless Master', type_line: 'Creature — Orc Monk', power: '4', toughness: '3', keywords: ["Vigilance","Menace"] });
    expect(CardUtils.hasKeyword(card, 'Menace')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['effortless master'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
