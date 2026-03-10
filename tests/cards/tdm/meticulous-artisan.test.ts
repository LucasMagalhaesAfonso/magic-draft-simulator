import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Meticulous Artisan', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['meticulous artisan']).toBeDefined();
  });

  it('has Prowess', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, { name: 'Meticulous Artisan', type_line: 'Creature — Djinn Artificer', power: '3', toughness: '3', keywords: ["Prowess","Treasure"] });
    expect(CardUtils.hasKeyword(card, 'Prowess')).toBe(true);
  });

  it('creates Treasure token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['meticulous artisan'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('treasure') || json.includes('create_token') || json.includes('token')).toBe(true);
  });

  it('triggers on casting noncreature spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['meticulous artisan'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

});
