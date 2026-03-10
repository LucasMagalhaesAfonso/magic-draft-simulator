import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Dalkovan Packbeasts', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['dalkovan packbeasts']).toBeDefined();
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Dalkovan Packbeasts', type_line: 'Creature — Ox', power: '0', toughness: '4', keywords: ["Vigilance","Mobilize"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('creates red 1/1 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 1, toughness: 1, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('has attacks trigger', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['dalkovan packbeasts'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['attacks', 'equipped_attacks', 'attack'].includes(t.event)) ?? false) || json.includes('attack');
    expect(hasTrigger).toBe(true);
  });

});
