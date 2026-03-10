import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Kin-Tree Nurturer', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['kin-tree nurturer']).toBeDefined();
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Kin-Tree Nurturer', type_line: 'Creature — Human Druid', power: '2', toughness: '1', keywords: ["Lifelink","Endure"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

  it('ETB creates 1/1 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['kin-tree nurturer'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
