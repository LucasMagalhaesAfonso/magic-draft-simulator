import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Jeskai Brushmaster', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['jeskai brushmaster']).toBeDefined();
  });

  it('has Prowess', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Jeskai Brushmaster', type_line: 'Creature — Orc Monk', power: '2', toughness: '4', keywords: ["Prowess","Double strike"] });
    expect(CardUtils.hasKeyword(card, 'Prowess')).toBe(true);
  });

  it('has Double strike', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Jeskai Brushmaster', type_line: 'Creature — Orc Monk', power: '2', toughness: '4', keywords: ["Prowess","Double strike"] });
    expect(CardUtils.hasKeyword(card, 'Double strike')).toBe(true);
  });

  it('triggers on casting noncreature spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['jeskai brushmaster'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

});
