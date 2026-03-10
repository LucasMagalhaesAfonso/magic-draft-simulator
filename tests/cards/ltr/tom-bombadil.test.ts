import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Tom Bombadil — {W}{U}{B}{R}{G}
 * Legendary Creature — God Bard (4/4)
 *
 * As long as there are four or more lore counters among Sagas you control,
 * Tom Bombadil has hexproof and indestructible.
 * Whenever the final chapter ability of a Saga you control resolves, reveal
 * cards from the top of your library until you reveal a Saga card. Put that
 * card onto the battlefield and the rest on the bottom in random order.
 * This ability triggers only once each turn.
 *
 * IMPLEMENTED: conditional hexproof+indestructible + saga_final_chapter trigger + once_per_turn.
 */
describe('Tom Bombadil', () => {
  const DB = CardEffectsDB['tom bombadil'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "hexproof and indestructible" (conditional) ──
  it('has hexproof and indestructible with four_lore_counters condition', () => {
    const kw = DB.static.find((s: any) => s.type === 'has_keyword');
    expect(kw.keywords).toContain('hexproof');
    expect(kw.keywords).toContain('indestructible');
    expect(kw.condition).toBe('four_lore_counters_on_sagas');
  });

  // ── Oracle: "Whenever the final chapter ability of a Saga" ──
  it('has saga_final_chapter trigger', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'saga_final_chapter');
    expect(trigger).toBeDefined();
  });

  // ── Oracle: "This ability triggers only once each turn" ──
  it('trigger is once_per_turn', () => {
    const trigger = DB.triggered[0];
    expect(trigger.once_per_turn).toBe(true);
  });

  // ── Oracle: "reveal until Saga, put onto battlefield" ──
  it('trigger searches for saga to battlefield', () => {
    const trigger = DB.triggered[0];
    const search = trigger.effects.find((e: any) => e.type === 'search_library');
    expect(search).toBeDefined();
    expect(search.target).toBe('saga');
    expect(search.to_battlefield).toBe(true);
  });
});
