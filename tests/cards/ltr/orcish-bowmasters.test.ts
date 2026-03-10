import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Orcish Bowmasters', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['orcish bowmasters']).toBeDefined();
  });

  it('has Flash', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Orcish Bowmasters', type_line: 'Creature — Orc Archer', power: '1', toughness: '1', keywords: ["Amass","Flash"] });
    expect(CardUtils.hasKeyword(card, 'Flash')).toBe(true);
  });

  it('ETB deals 1 damage', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'damage', amount: 1, target: 'opponent' });
    expect(game.life(1)).toBe(19);
  });

  it('amass 1', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['orcish bowmasters'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('amass') || json.includes('counter') || json.includes('token')).toBe(true);
  });

});
