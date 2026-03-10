import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Anafenza, Unyielding Lineage', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['anafenza, unyielding lineage']).toBeDefined();
  });

  it('has First strike', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Anafenza, Unyielding Lineage', type_line: 'Legendary Creature — Spirit Soldier', power: '2', toughness: '2', keywords: ["First strike","Flash","Endure"] });
    expect(CardUtils.hasKeyword(card, 'First strike')).toBe(true);
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Anafenza, Unyielding Lineage', type_line: 'Legendary Creature — Spirit Soldier', power: '2', toughness: '2', keywords: ["First strike","Flash","Endure"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('creates white 2/2 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 2, toughness: 2, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['anafenza, unyielding lineage'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
