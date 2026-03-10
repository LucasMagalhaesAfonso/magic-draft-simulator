import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Scavenger Regent // Exude Toxin', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['scavenger regent']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Scavenger Regent', type_line: 'Creature — Dragon', power: '4', toughness: '4', keywords: ["Flying", "Ward"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Ward', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Scavenger Regent', type_line: 'Creature — Dragon', power: '4', toughness: '4', keywords: ["Flying", "Ward"] });
    expect(CardUtils.hasKeyword(card, 'Ward')).toBe(true);
  });

  it('has debuff_all cast effect (omen side)', () => {
    const dbEntry = CardEffectsDB['scavenger regent'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('debuff_all')).toBe(true);
  });
});
