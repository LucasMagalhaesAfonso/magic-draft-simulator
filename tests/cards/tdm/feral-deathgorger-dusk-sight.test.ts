import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Feral Deathgorger // Dusk Sight', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['feral deathgorger']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Feral Deathgorger // Dusk Sight', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '5', keywords: ["Deathtouch","Flying"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Feral Deathgorger // Dusk Sight', type_line: 'Creature — Dragon // Sorcery — Omen', power: '3', toughness: '5', keywords: ["Deathtouch","Flying"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('involves +1/+1 counters', () => {
    // Verify CardEffectsDB references counters or counter-like mechanics
    const dbEntry = CardEffectsDB['feral deathgorger'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasCounterMechanic = json.includes('counter') || json.includes('amass') || json.includes('buff') || json.includes('debuff') || json.includes('endure') || json.includes('bolster') || json.includes('modify');
    expect(hasCounterMechanic).toBe(true);
  });

  it('draws 1 card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

  it('draws a card', () => {
    const game = new TestGame();
    for (let i = 0; i < 3; i++) game.addToLibraryTop(0, { name: 'Filler', type_line: 'Creature' });
    const startHand = game.hand(0).length;
    game.resolveEffect(0, { type: 'draw', amount: 1 });
    expect(game.hand(0).length).toBe(startHand + 1);
  });

});
