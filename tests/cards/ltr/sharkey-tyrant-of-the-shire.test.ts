import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Sharkey, Tyrant of the Shire — {2}{B}{G}
 * Legendary Creature — Avatar Rogue (3/3)
 *
 * Menace
 * Activated abilities of lands your opponents control can't be activated
 * unless they're mana abilities.
 * Sharkey has all activated abilities of lands your opponents control
 * except mana abilities.
 * Mana of any type can be spent to activate Sharkey's abilities.
 *
 * IMPLEMENTED: menace + lock_opponent_lands + copy_land_abilities + any_mana_for_abilities.
 */
describe('Sharkey, Tyrant of the Shire', () => {
  const DB = CardEffectsDB['sharkey, tyrant of the shire'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Menace" ──
  it('has menace', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('menace');
  });

  // ── Oracle: "Activated abilities of lands opponents control can't be activated" ──
  it('has lock_opponent_lands static', () => {
    const lock = DB.static.find((s: any) => s.type === 'lock_opponent_lands');
    expect(lock).toBeDefined();
  });

  // ── Oracle: "Sharkey has all activated abilities of lands opponents control" ──
  it('has copy_land_abilities static', () => {
    const copy = DB.static.find((s: any) => s.type === 'copy_land_abilities');
    expect(copy).toBeDefined();
    expect(copy.target).toBe('opponent_lands');
  });

  // ── Oracle: "Mana of any type can be spent" ──
  it('has any_mana_for_abilities static', () => {
    const anyMana = DB.static.find((s: any) => s.type === 'any_mana_for_abilities');
    expect(anyMana).toBeDefined();
  });
});
