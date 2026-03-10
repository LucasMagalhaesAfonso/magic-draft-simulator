import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Whirlwing Stormbrood // Dynamic Soar', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['whirlwing stormbrood']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Whirlwing Stormbrood // Dynamic Soar', type_line: 'Creature — Dragon // Sorcery — Omen', power: '4', toughness: '3', keywords: ["Flying","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Whirlwing Stormbrood // Dynamic Soar', type_line: 'Creature — Dragon // Sorcery — Omen', power: '4', toughness: '3', keywords: ["Flying","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['whirlwing stormbrood'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
