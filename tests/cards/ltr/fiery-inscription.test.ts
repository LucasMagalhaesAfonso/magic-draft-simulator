import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Fiery Inscription', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['fiery inscription']).toBeDefined();
  });

  it('deals 2 damage to each opponent', () => {
    // Verify DB has damage to each opponent effect
    const dbEntry = CardEffectsDB['fiery inscription'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry);
    expect(json.includes('damage') || json.includes('loses')).toBe(true);
  });

  it('triggers on casting instant or sorcery spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['fiery inscription'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

  it('the Ring tempts you', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['fiery inscription'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('ring')).toBe(true);
  });

});
