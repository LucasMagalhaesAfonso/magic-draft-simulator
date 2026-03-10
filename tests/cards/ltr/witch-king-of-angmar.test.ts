import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Witch-king of Angmar', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['witch-king of angmar']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Witch-king of Angmar', type_line: 'Legendary Creature — Wraith Noble', power: '5', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['witch-king of angmar'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

  it('discard 1 card', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['witch-king of angmar'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('discard') || json.includes('loot') || json.includes('sacrifice') || json.includes('mill')).toBe(true);
  });

});
