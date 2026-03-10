import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Qarsi Revenant', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['qarsi revenant']).toBeDefined();
  });

  it('has Deathtouch', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Qarsi Revenant', type_line: 'Creature — Vampire', power: '3', toughness: '3', keywords: ["Deathtouch","Flying","Lifelink","Renew"] });
    expect(CardUtils.hasKeyword(card, 'Deathtouch')).toBe(true);
  });

  it('has Flying', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Qarsi Revenant', type_line: 'Creature — Vampire', power: '3', toughness: '3', keywords: ["Deathtouch","Flying","Lifelink","Renew"] });
    expect(CardUtils.hasKeyword(card, 'Flying')).toBe(true);
  });

  it('has Lifelink', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Qarsi Revenant', type_line: 'Creature — Vampire', power: '3', toughness: '3', keywords: ["Deathtouch","Flying","Lifelink","Renew"] });
    expect(CardUtils.hasKeyword(card, 'Lifelink')).toBe(true);
  });

});
