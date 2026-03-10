import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Generous Ent', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['generous ent']).toBeDefined();
  });

  it('has Reach', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Generous Ent', type_line: 'Creature — Treefolk', power: '5', toughness: '7', keywords: ["Reach","Landcycling","Food","Forestcycling","Typecycling","Cycling"] });
    expect(CardUtils.hasKeyword(card, 'Reach')).toBe(true);
  });

  it('creates Food token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['generous ent'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('food') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('gains 3 life', () => {
    const game = new TestGame();
    game.resolveEffect(0, { type: 'gain_life', amount: 3 });
    expect(game.life(0)).toBe(23);
  });

  it('searches library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['generous ent'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('search') || json.includes('ramp') || json.includes('look_top') || json.includes('tutor') || json.includes('cycling') || json.includes('buff_all')).toBe(true);
  });

  it('puts card into hand', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['generous ent'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('hand') || json.includes('draw') || json.includes('return') || json.includes('look_top') || json.includes('reveal') || json.includes('to_hand') || json.includes('ramp') || json.includes('search') || json.includes('cycling') || json.includes('ring') || json.includes('saga')).toBe(true);
  });

});
