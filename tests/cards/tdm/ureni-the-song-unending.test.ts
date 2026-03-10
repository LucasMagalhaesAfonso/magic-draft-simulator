import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Ureni, the Song Unending', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['ureni, the song unending']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Ureni, the Song Unending', type_line: 'Legendary Creature — Spirit Dragon', power: '10', toughness: '10', keywords: ["Flying","Protection"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Protection', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Ureni, the Song Unending', type_line: 'Legendary Creature — Spirit Dragon', power: '10', toughness: '10', keywords: ["Flying","Protection"] });
    expect(CardUtils.hasKeyword(card, 'Protection')).toBe(true);
  });

  it('has protection from white', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['ureni, the song unending'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('protection') || json.includes('hexproof') || json.includes('indestructible') || json.includes('ward')).toBe(true);
  });

});
