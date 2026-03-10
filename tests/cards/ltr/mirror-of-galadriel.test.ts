import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Mirror of Galadriel — {2}
 * Legendary Artifact
 *
 * {5}, {T}: Scry 1, then draw a card.
 * This ability costs {1} less to activate for each legendary creature you control.
 *
 * IMPLEMENTED: activated scry+draw with cost_reduction per legendary_creature.
 */
describe('Mirror of Galadriel', () => {
  const DB = CardEffectsDB['mirror of galadriel'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  it('has activated ability', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThan(0);
  });

  // ── Oracle: "Scry 1, then draw a card" ──
  it('activated ability has scry and draw', () => {
    const ability = DB.activated[0];
    const scry = ability.effects.find((e: any) => e.type === 'scry');
    expect(scry).toBeDefined();
    const draw = ability.effects.find((e: any) => e.type === 'draw');
    expect(draw).toBeDefined();
  });

  // ── Oracle: "costs {1} less per legendary creature" ──
  it('has cost_reduction per legendary_creature', () => {
    const ability = DB.activated[0];
    expect(ability.cost_reduction).toBeDefined();
    expect(ability.cost_reduction.per).toBe('legendary_creature');
    expect(ability.cost_reduction.amount).toBe(1);
  });
});
