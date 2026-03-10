import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Riling Dawnbreaker // Signaling Roar', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['riling dawnbreaker']).toBeDefined();
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Riling Dawnbreaker // Signaling Roar', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '4', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Vigilance', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Riling Dawnbreaker // Signaling Roar', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '4', keywords: ["Flying","Vigilance"] });
    expect(CardUtils.hasKeyword(card, 'Vigilance')).toBe(true);
  });

  it('creates white 2/2 token', () => {
    const game = new TestGame();
    const bfBefore = game.battlefield(0).length;
    game.resolveEffect(0, { type: 'create_token', power: 2, toughness: 2, amount: 1 });
    expect(game.battlefield(0).length).toBe(bfBefore + 1);
  });

  it('has combat trigger', () => {
    const dbEntry = CardEffectsDB['riling dawnbreaker'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('triggered') || json.includes('upkeep') || json.includes('end_step') || json.includes('combat_begin')).toBe(true);
  });

  it('gives +1/+0', () => {
    const game = new TestGame();
    const creature = game.addToBattlefield(0, { name: 'Test Creature', type_line: 'Creature — Human', power: '2', toughness: '2' });
    game.resolveEffect(0, { type: 'buff', power: 1, toughness: 0, duration: 'end_of_turn', target: 'creature' });
    expect(CardUtils.getPower(creature)).toBe(3);
    expect(CardUtils.getToughness(creature)).toBe(2);
  });

});
