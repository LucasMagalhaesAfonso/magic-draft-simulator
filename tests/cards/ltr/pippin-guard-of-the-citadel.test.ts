import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Pippin, Guard of the Citadel — {G}{W}
 * Legendary Creature — Halfling Soldier (2/2)
 *
 * Vigilance, ward {1}
 * {T}: Another target creature you control gains protection from the card type
 * of your choice until end of turn.
 *
 * IMPLEMENTED: vigilance + ward + activated protection grant (simplified as protection keyword).
 */
describe('Pippin, Guard of the Citadel', () => {
  const DB = CardEffectsDB['pippin, guard of the citadel'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Vigilance" ──
  it('has vigilance', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('vigilance');
  });

  // ── Oracle: "ward {1}" ──
  it('has ward', () => {
    const ward = DB.static.find((s: any) => s.type === 'ward');
    expect(ward).toBeDefined();
    expect(ward.amount).toBe(1);
  });

  // ── Oracle: "{T}: target creature gains protection" ──
  it('has activated ability granting protection', () => {
    expect(DB.activated).toBeDefined();
    const ability = DB.activated[0];
    expect(ability.cost.tap).toBe(true);
    const grant = ability.effects.find((e: any) => e.type === 'grant');
    expect(grant).toBeDefined();
    expect(grant.keywords).toContain('protection');
    expect(grant.target).toBe('own_creature');
  });
});
