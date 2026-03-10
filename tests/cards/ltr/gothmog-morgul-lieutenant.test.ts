import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Gothmog, Morgul Lieutenant — {3}{B}{B}
 * Legendary Creature — Orc Soldier (4/3)
 *
 * When Gothmog enters, amass Orcs 1.
 * Creature tokens you control have deathtouch.
 *
 * IMPLEMENTED: amass ETB + grant_all deathtouch to tokens.
 */
describe('Gothmog, Morgul Lieutenant', () => {
  const DB = CardEffectsDB['gothmog, morgul lieutenant'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "amass Orcs 1" ──
  it('has amass 1 ETB', () => {
    const amass = DB.etb.find((e: any) => e.type === 'amass');
    expect(amass).toBeDefined();
    expect(amass.amount).toBe(1);
  });

  // ── Oracle: "Creature tokens you control have deathtouch" ──
  it('has grant_all deathtouch to tokens', () => {
    const grantAll = DB.static.find((s: any) => s.type === 'grant_all' && s.target === 'tokens');
    expect(grantAll).toBeDefined();
    expect(grantAll.keyword).toBe('Deathtouch');
  });
});
