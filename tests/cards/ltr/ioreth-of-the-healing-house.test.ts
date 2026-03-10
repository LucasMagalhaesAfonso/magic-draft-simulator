import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Ioreth of the Healing House — {1}{W}
 * Legendary Creature — Human (1/3)
 *
 * {T}: Untap another target permanent.
 * {T}: Untap two other target legendary creatures.
 *
 * IMPLEMENTED: two activated abilities — untap permanent + untap 2 legendary creatures.
 */
describe('Ioreth of the Healing House', () => {
  const DB = CardEffectsDB['ioreth of the healing house'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "{T}: Untap another target permanent" ──
  it('has untap permanent ability', () => {
    const ability1 = DB.activated.find((a: any) => a.effects.some((e: any) => e.type === 'untap' && e.target === 'permanent'));
    expect(ability1).toBeDefined();
    expect(ability1.cost.tap).toBe(true);
  });

  // ── Oracle: "{T}: Untap two other target legendary creatures" ──
  it('has untap 2 legendary creatures ability', () => {
    const ability2 = DB.activated.find((a: any) => a.effects.some((e: any) => e.target === 'legendary_creature' && e.count === 2));
    expect(ability2).toBeDefined();
  });
});
