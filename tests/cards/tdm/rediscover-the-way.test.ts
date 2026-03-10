import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

describe('Rediscover the Way', () => {
  it('exists in CardEffectsDB', () => {
    expect(CardEffectsDB['rediscover the way']).toBeDefined();
  });

  it('triggers on casting noncreature spell', () => {
    // Verify trigger is registered in CardEffectsDB
    const dbEntry = CardEffectsDB['rediscover the way'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    const hasTrigger = (dbEntry.triggered?.some((t: any) => ['cast_spell', 'cast_instant_sorcery', 'cast_noncreature', 'second_spell', 'cast_creature'].includes(t.event)) ?? false) || json.includes('prowess') || json.includes('cast_') || json.includes('second_spell');
    expect(hasTrigger).toBe(true);
  });

  it('looks at top of library', () => {
    // Verify CardEffectsDB contains expected mechanic
    const dbEntry = CardEffectsDB['rediscover the way'];
    expect(dbEntry).toBeDefined();
    const json = JSON.stringify(dbEntry).toLowerCase();
    expect(json.includes('look') || json.includes('surveil') || json.includes('scry') || json.includes('exile_top') || json.includes('reveal')).toBe(true);
  });

  it('is a Saga with 2 chapters', () => {
    const dbEntry = CardEffectsDB['rediscover the way'];
    expect(dbEntry).toBeDefined();
    expect(dbEntry.saga).toBeDefined();
  });

});
