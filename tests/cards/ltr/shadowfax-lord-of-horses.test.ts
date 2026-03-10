import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Shadowfax, Lord of Horses — {3}{R}{W}
 * Legendary Creature — Horse (4/4)
 *
 * Haste
 * Horses you control have haste.
 * Whenever Shadowfax attacks, you may put a creature card with lesser
 * power from your hand onto the battlefield tapped and attacking.
 *
 * IMPLEMENTED: haste + grant_all haste horses + attacks trigger put_creature_from_hand.
 */
describe('Shadowfax, Lord of Horses', () => {
  const DB = CardEffectsDB['shadowfax, lord of horses'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Haste" ──
  it('has haste', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('haste');
  });

  // ── Oracle: "Horses you control have haste" ──
  it('grants haste to horses', () => {
    const grant = DB.static.find((s: any) => s.type === 'grant_all' && s.target === 'horses');
    expect(grant).toBeDefined();
    expect(grant.keyword).toBe('haste');
  });

  // ── Oracle: "Whenever Shadowfax attacks" ──
  it('has attacks trigger (self)', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'attacks');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(true);
  });

  // ── Oracle: "put creature from hand tapped and attacking" ──
  it('trigger puts creature from hand tapped and attacking', () => {
    const trigger = DB.triggered[0];
    const put = trigger.effects.find((e: any) => e.type === 'put_creature_from_hand');
    expect(put).toBeDefined();
    expect(put.condition).toBe('lesser_power');
    expect(put.tapped).toBe(true);
    expect(put.attacking).toBe(true);
  });
});
