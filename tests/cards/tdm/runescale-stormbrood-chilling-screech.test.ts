import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Runescale Stormbrood // Chilling Screech', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['runescale stormbrood']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Runescale Stormbrood', type_line: 'Creature — Dragon', power: '2', toughness: '4', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('triggers on casting noncreature spell', () => {
    const dbEntry = CardEffectsDB['runescale stormbrood'];
    const hasTrigger = dbEntry.triggered?.some((t: any) =>
      ['cast_noncreature', 'cast_noncreature_or_dragon'].includes(t.event)
    ) ?? false;
    expect(hasTrigger).toBe(true);
  });

  it('has counter_spell in cast effects (omen side)', () => {
    const dbEntry = CardEffectsDB['runescale stormbrood'];
    const json = JSON.stringify(dbEntry);
    expect(json).toContain('counter_spell');
  });
});
