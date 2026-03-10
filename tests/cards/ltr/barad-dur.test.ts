import { describe, it, expect } from 'vitest';
import { TestGame } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Barad-dûr
 * Legendary Land
 *
 * Barad-dûr enters tapped unless you control a legendary creature.
 * {T}: Add {B}.
 * {X}{X}{B}, {T}: Amass Orcs X. Activate only if a creature died this turn.
 */
describe('Barad-dûr', () => {
  const DB = CardEffectsDB['barad-dûr'];
  const CARD_DEF = {
    name: 'Barad-dûr',
    type_line: 'Legendary Land',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "enters tapped unless you control a legendary creature" ──
  it('has enters_tapped static with condition no_legendary_creature', () => {
    expect(DB.static).toBeDefined();
    const entersTapped = DB.static.find((s: any) => s.type === 'enters_tapped');
    expect(entersTapped).toBeDefined();
    expect(entersTapped.condition).toBe('no_legendary_creature');
  });

  // ── Oracle: "{T}: Add {B}" ──
  it('has add_mana static for {B}', () => {
    const addMana = DB.static.find((s: any) => s.type === 'add_mana');
    expect(addMana).toBeDefined();
    expect(addMana.color).toBe('B');
  });

  // ── Oracle: "{X}{X}{B}, {T}: Amass Orcs X" ──
  it('has activated ability costing {X}{X}{B} + tap for amass Orcs X', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const amassAbility = DB.activated.find((a: any) =>
      a.effects.some((e: any) => e.type === 'amass')
    );
    expect(amassAbility).toBeDefined();
    expect(amassAbility.cost.mana).toBe('XXB');
    expect(amassAbility.cost.tap).toBe(true);
  });

  it('amass effect has amount X and subtype Orcs', () => {
    const amassAbility = DB.activated.find((a: any) =>
      a.effects.some((e: any) => e.type === 'amass')
    );
    const amassEffect = amassAbility.effects.find((e: any) => e.type === 'amass');
    expect(amassEffect).toBeDefined();
    expect(amassEffect.amount).toBe('X');
    expect(amassEffect.subtype).toBe('Orcs');
  });

  // ── Oracle: "Activate only if a creature died this turn" ──
  it('amass ability has condition creature_died_this_turn', () => {
    const amassAbility = DB.activated.find((a: any) =>
      a.effects.some((e: any) => e.type === 'amass')
    );
    expect(amassAbility.condition).toBe('creature_died_this_turn');
  });

  // ── Human interaction ──
  describe('Human player', () => {
    it('can be played as land', () => {
      const game = new TestGame();
      game.setHuman(0, true);
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });

  // ── AI interaction ──
  describe('AI player', () => {
    it('can be played as land without crash', () => {
      const game = new TestGame();
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });
});
