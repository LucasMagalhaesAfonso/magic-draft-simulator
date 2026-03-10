import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Prince Imrahil the Fair — {1}{G}{W}
 * Legendary Creature — Human Noble (3/3)
 *
 * Whenever you draw your second card each turn, create a 1/1 white Human Soldier
 * creature token.
 *
 * IMPLEMENTED: second_draw trigger event + create_token Human Soldier.
 */
describe('Prince Imrahil the Fair', () => {
  const DB = CardEffectsDB['prince imrahil the fair'];

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Whenever you draw your second card each turn" ──
  it('triggers on second_draw', () => {
    const trigger = DB.triggered.find((t: any) => t.event === 'second_draw');
    expect(trigger).toBeDefined();
  });

  // ── Oracle: "create a 1/1 white Human Soldier" ──
  it('creates 1/1 Human Soldier token', () => {
    const trigger = DB.triggered[0];
    const token = trigger.effects.find((e: any) => e.type === 'create_token');
    expect(token).toBeDefined();
    expect(token.power).toBe(1);
    expect(token.toughness).toBe(1);
    expect(token.name).toBe('Human Soldier');
  });
});
