import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Gandalf the Grey — {3}{U}{R}
 * Legendary Creature — Avatar Wizard (3/4)
 *
 * Whenever you cast an instant or sorcery spell, choose one that hasn't been chosen —
 * - You may tap or untap target permanent.
 * - Gandalf deals 3 damage to each opponent.
 * - Copy target instant or sorcery spell you control. You may choose new targets for the copy.
 * - Put Gandalf on top of its owner's library.
 *
 * IMPLEMENTED: cast_instant_sorcery trigger with 4-mode unique_modes modal.
 */
describe('Gandalf the Grey', () => {
  const DB = CardEffectsDB['gandalf the grey'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you cast an instant or sorcery spell" ──
  it('triggers on cast_instant_sorcery', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered[0];
    expect(trigger.event).toBe('cast_instant_sorcery');
  });

  // ── Oracle: "choose one that hasn't been chosen" ──
  it('has modal effect with unique_modes', () => {
    const trigger = DB.triggered[0];
    const modal = trigger.effects.find((e: any) => e.type === 'modal');
    expect(modal).toBeDefined();
    expect(modal.unique_modes).toBe(true);
    expect(modal.modes).toHaveLength(4);
  });

  // ── Mode 1: tap or untap target permanent ──
  it('mode 1: tap_or_untap permanent', () => {
    const modal = DB.triggered[0].effects.find((e: any) => e.type === 'modal');
    const mode1 = modal.modes[0];
    expect(mode1[0].type).toBe('tap_or_untap');
  });

  // ── Mode 2: 3 damage to each opponent ──
  it('mode 2: 3 damage to each opponent', () => {
    const modal = DB.triggered[0].effects.find((e: any) => e.type === 'modal');
    const mode2 = modal.modes[1];
    expect(mode2[0].type).toBe('damage');
    expect(mode2[0].amount).toBe(3);
    expect(mode2[0].target).toBe('each_opponent');
  });

  // ── Mode 3: copy spell ──
  it('mode 3: copy instant or sorcery', () => {
    const modal = DB.triggered[0].effects.find((e: any) => e.type === 'modal');
    const mode3 = modal.modes[2];
    expect(mode3[0].type).toBe('copy_spell');
  });

  // ── Mode 4: put on top of library ──
  it('mode 4: put Gandalf on top of library', () => {
    const modal = DB.triggered[0].effects.find((e: any) => e.type === 'modal');
    const mode4 = modal.modes[3];
    expect(mode4[0].type).toBe('put_on_top_library');
    expect(mode4[0].target).toBe('self');
  });
});
