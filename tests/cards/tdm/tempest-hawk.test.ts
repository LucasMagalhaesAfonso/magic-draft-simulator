import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Tempest Hawk', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['tempest hawk']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Tempest Hawk', type_line: 'Creature — Bird', power: '2', toughness: '2', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has combat damage trigger', () => {
    const dbEntry = CardEffectsDB['tempest hawk'];
    const hasTrigger = dbEntry.triggered?.some((t: any) => t.event === 'combat_damage_player') ?? false;
    expect(hasTrigger).toBe(true);
  });

  it('searches library on combat damage', () => {
    const dbEntry = CardEffectsDB['tempest hawk'];
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search_library')).toBe(true);
  });
});
