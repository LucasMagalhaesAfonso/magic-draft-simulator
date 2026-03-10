import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Shadow of the Enemy — {4}{B}{B}
 * Sorcery
 *
 * Exile all creature cards from target player's graveyard. You may cast
 * spells from among those cards for as long as they remain exiled, and
 * mana of any type can be spent to cast them.
 *
 * IMPLEMENTED: exile_graveyard opponent creature_only + cast_from_exile + any_mana.
 */
describe('Shadow of the Enemy', () => {
  const DB = CardEffectsDB['shadow of the enemy'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Exile all creature cards from target player's graveyard" ──
  it('exiles opponent creature cards from graveyard', () => {
    const exile = DB.cast.find((e: any) => e.type === 'exile_graveyard');
    expect(exile).toBeDefined();
    expect(exile.target).toBe('opponent');
    expect(exile.creature_only).toBe(true);
  });

  // ── Oracle: "You may cast spells from among those cards" ──
  it('allows casting from exile', () => {
    const exile = DB.cast.find((e: any) => e.type === 'exile_graveyard');
    expect(exile.cast_from_exile).toBe(true);
  });

  // ── Oracle: "mana of any type can be spent" ──
  it('allows any mana to cast exiled cards', () => {
    const exile = DB.cast.find((e: any) => e.type === 'exile_graveyard');
    expect(exile.any_mana).toBe(true);
  });
});
