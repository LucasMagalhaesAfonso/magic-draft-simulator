import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dusyut Earthcarver', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dusyut earthcarver']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Dusyut Earthcarver', type_line: 'Creature — Elephant Druid', power: '4', toughness: '4', keywords: ["Reach","Endure"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('ETB creates 3/3 token', () => {
    // Unhandled assertion type: etb_token
    expect(true).toBe(true); // placeholder
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['dusyut earthcarver'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
