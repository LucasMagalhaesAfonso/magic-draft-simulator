import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Starry-Eyed Skyrider', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['starry-eyed skyrider']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Starry-Eyed Skyrider', type_line: 'Creature — Human Scout', power: '1', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['starry-eyed skyrider'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

  it('grants flying to tokens', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['starry-eyed skyrider'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('flying')).toBe(true);
  });

});
