import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Hew the Entwood — {4}{G}{G}
 * Sorcery
 *
 * Sacrifice any number of lands. Reveal the top X cards of your library,
 * where X is the number of lands sacrificed this way. Choose any number of
 * artifact and/or land cards revealed this way. Put nonland cards chosen
 * onto the battlefield, land cards onto the battlefield tapped,
 * rest on bottom in random order.
 *
 * IMPLEMENTED: sacrifice lands (any_number) + ramp based on sacrificed_count.
 */
describe('Hew the Entwood', () => {
  const DB = CardEffectsDB['hew the entwood'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Sacrifice any number of lands" ──
  it('has additional_costs sacrifice land any_number', () => {
    expect(DB.additional_costs).toBeDefined();
    const sac = DB.additional_costs.find((c: any) => c.type === 'sacrifice');
    expect(sac).toBeDefined();
    expect(sac.target).toBe('land');
    expect(sac.any_number).toBe(true);
  });

  // ── Oracle: reveal X, choose artifacts/lands to BF (simplified as ramp) ──
  it('has ramp effect with sacrificed_count amount', () => {
    const ramp = DB.cast.find((e: any) => e.type === 'ramp');
    expect(ramp).toBeDefined();
    expect(ramp.amount).toBe('sacrificed_count');
  });
});
