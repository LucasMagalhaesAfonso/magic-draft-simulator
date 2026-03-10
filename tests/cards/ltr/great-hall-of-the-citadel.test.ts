import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Great Hall of the Citadel
 * Land
 *
 * {T}: Add {C}.
 * {1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast legendary spells.
 *
 * IMPLEMENTED: two activated abilities — colorless mana + restricted legendary-only dual mana.
 */
describe('Great Hall of the Citadel', () => {
  const DB = CardEffectsDB['great hall of the citadel'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{T}: Add {C}" ──
  it('has colorless mana ability', () => {
    const ability1 = DB.activated.find((a: any) => a.effects.some((e: any) => e.type === 'add_mana' && e.color === 'C'));
    expect(ability1).toBeDefined();
  });

  // ── Oracle: "{1}, {T}: Add two mana — legendary only" ──
  it('has legendary-restricted dual mana ability', () => {
    const ability2 = DB.activated.find((a: any) => a.restriction === 'legendary');
    expect(ability2).toBeDefined();
    const addMana = ability2.effects.find((e: any) => e.type === 'add_mana');
    expect(addMana.amount).toBe(2);
  });
});
