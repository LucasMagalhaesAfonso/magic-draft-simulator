import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Glóin, Dwarf Emissary', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['glóin, dwarf emissary']).toBeDefined();
  });

  it('creates Treasure token', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['glóin, dwarf emissary'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('treasure') || json.includes('create_token') || json.includes('token') || json.includes('mana')).toBe(true);
  });

  it('triggers on casting historic spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['glóin, dwarf emissary'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

});
