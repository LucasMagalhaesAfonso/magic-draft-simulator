import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Disruptive Stormbrood // Petty Revenge', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['disruptive stormbrood']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Disruptive Stormbrood // Petty Revenge', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '3', keywords: ["Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('destroys target creature', () => {
    const game = new TestGame();
    const target = game.addToBattlefield(1, { name: 'Target', type_line: 'Creature — Beast', power: '3', toughness: '3' });
    game.resolveEffect(0, { type: 'destroy', target: 'creature' }, { targetUid: target._uid });
    expect(game.battlefield(1).find(c => c._uid === target._uid)).toBeUndefined();
  });

});
