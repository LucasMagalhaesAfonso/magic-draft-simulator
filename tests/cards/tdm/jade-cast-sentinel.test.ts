import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Jade-Cast Sentinel', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['jade-cast sentinel']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Jade-Cast Sentinel', type_line: 'Artifact Creature — Ape Snake', power: '1', toughness: '5', keywords: ["Reach"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('has activated ability', () => {
    const dbEntry = CardEffectsDB['jade-cast sentinel'];
    expect(dbEntry).toBeDefined();
    const hasActivated = dbEntry.activated && dbEntry.activated.length > 0;
    expect(hasActivated).toBe(true);
  });

});
