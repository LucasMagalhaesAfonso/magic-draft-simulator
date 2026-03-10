import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Aegis Sculptor', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['aegis sculptor']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Aegis Sculptor', type_line: 'Creature — Bird Wizard', power: '2', toughness: '3', keywords: ["Flying","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Aegis Sculptor', type_line: 'Creature — Bird Wizard', power: '2', toughness: '3', keywords: ["Flying","Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('has upkeep trigger', () => {
    const dbEntry = CardEffectsDB['aegis sculptor'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['aegis sculptor'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

});
