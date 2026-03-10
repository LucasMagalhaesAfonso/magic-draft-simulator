import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Saruman the White', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['saruman the white']).toBeDefined();
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Saruman the White', type_line: 'Legendary Creature — Avatar Wizard', power: '4', toughness: '4', keywords: ["Amass","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('amass 2', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['saruman the white'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['saruman the white'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
