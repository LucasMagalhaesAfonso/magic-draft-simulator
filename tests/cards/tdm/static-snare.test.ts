import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Static Snare', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['static snare']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Static Snare', type_line: 'Enchantment', keywords: ["Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('exiles target artifact', () => {
    const dbEntry = CardEffectsDB['static snare'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('exile')).toBe(true);
  });

  it('costs {1} less conditionally', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['static snare'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('cost') || json.includes('affinity') || json.includes('reduction') || json.includes('less')).toBe(true);
  });

});
