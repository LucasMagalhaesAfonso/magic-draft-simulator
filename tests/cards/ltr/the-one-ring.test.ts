import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * The One Ring — {4}
 * Legendary Artifact
 *
 * Indestructible
 * When The One Ring enters, if you cast it, you gain protection from
 * everything until your next turn.
 * At the beginning of your upkeep, you lose 1 life for each burden counter.
 * {T}: Put a burden counter on The One Ring, then draw a card for each
 * burden counter on The One Ring.
 *
 * IMPLEMENTED: indestructible + protection_from_everything ETB + burden upkeep + activated draw.
 */
describe('The One Ring', () => {
  const DB = CardEffectsDB['the one ring'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Indestructible" ──
  it('has indestructible', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('indestructible');
  });

  // ── Oracle: "you gain protection from everything until your next turn" ──
  it('ETB grants protection_from_everything if cast', () => {
    const grant = DB.etb.find((e: any) => e.type === 'grant');
    expect(grant).toBeDefined();
    expect(grant.keywords).toContain('protection_from_everything');
    expect(grant.target).toBe('self_controller');
    expect(grant.duration).toBe('until_next_turn');
    expect(grant.condition).toBe('was_cast');
  });

  // ── Oracle: "you lose 1 life for each burden counter" ──
  it('has upkeep trigger losing life per burden counters', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'upkeep');
    expect(trigger).toBeDefined();
    const lose = trigger.effects.find((e: any) => e.type === 'loseLife');
    expect(lose.amount).toBe('burden_counters');
  });

  // ── Oracle: "{T}: Put a burden counter, then draw per burden counters" ──
  it('has activated ability: tap to add burden counter and draw', () => {
    expect(DB.activated).toBeDefined();
    const ability = DB.activated[0];
    expect(ability.cost.tap).toBe(true);
    const counter = ability.effects.find((e: any) => e.type === 'counter_self');
    expect(counter.counter).toBe('burden');
    const draw = ability.effects.find((e: any) => e.type === 'draw');
    expect(draw.amount).toBe('burden_counters');
  });
});
