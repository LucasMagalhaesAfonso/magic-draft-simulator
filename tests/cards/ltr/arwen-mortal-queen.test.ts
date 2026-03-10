import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Arwen, Mortal Queen — {1}{G}{W}
 * Legendary Creature — Elf Noble (2/2)
 *
 * Arwen, Mortal Queen enters with an indestructible counter on it.
 * {1}, Remove an indestructible counter from Arwen: Another target creature
 * gains indestructible until end of turn. Put a +1/+1 counter and a lifelink
 * counter on that creature and a +1/+1 counter and a lifelink counter on Arwen.
 */
describe('Arwen, Mortal Queen', () => {
  const DB = CardEffectsDB['arwen, mortal queen'];
  const CARD_DEF = {
    name: 'Arwen, Mortal Queen',
    type_line: 'Legendary Creature — Elf Noble',
    mana_cost: '{1}{G}{W}',
    power: '2',
    toughness: '2',
    keywords: [],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "enters with an indestructible counter on it" ──
  it('ETB places indestructible counter on self', () => {
    expect(DB.etb).toBeDefined();
    const counterEffect = DB.etb.find((e: any) => e.type === 'counter_self' && e.counter === 'indestructible');
    expect(counterEffect).toBeDefined();
    expect(counterEffect.amount).toBe(1);
  });

  // ── Oracle: "{1}, Remove an indestructible counter from Arwen" ──
  it('activated ability costs {1} + remove indestructible counter', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost.mana).toBe('1');
    expect(ability.cost.removeCounter).toBe('indestructible');
  });

  // ── Oracle: "Another target creature gains indestructible until end of turn" ──
  it('activated grants indestructible to other creature until end of turn', () => {
    const ability = DB.activated[0];
    const grantEffect = ability.effects.find((e: any) => e.type === 'grant');
    expect(grantEffect).toBeDefined();
    expect(grantEffect.keywords).toContain('indestructible');
    expect(grantEffect.target).toBe('other_creature');
    expect(grantEffect.duration).toBe('end_of_turn');
  });

  // ── Oracle: "Put a +1/+1 counter and a lifelink counter on that creature" ──
  it('activated puts +1/+1 and lifelink counters on target', () => {
    const ability = DB.activated[0];
    const plusCounter = ability.effects.find((e: any) => e.type === 'counter' && e.counter === '+1/+1' && e.target === 'same');
    expect(plusCounter).toBeDefined();
    expect(plusCounter.amount).toBe(1);
    const lifelinkCounter = ability.effects.find((e: any) => e.type === 'counter' && e.counter === 'lifelink' && e.target === 'same');
    expect(lifelinkCounter).toBeDefined();
    expect(lifelinkCounter.amount).toBe(1);
  });

  // ── Oracle: "and a +1/+1 counter and a lifelink counter on Arwen" ──
  it('activated puts +1/+1 and lifelink counters on self', () => {
    const ability = DB.activated[0];
    const selfPlus = ability.effects.find((e: any) => e.type === 'counter_self' && e.counter === '+1/+1');
    expect(selfPlus).toBeDefined();
    expect(selfPlus.amount).toBe(1);
    const selfLifelink = ability.effects.find((e: any) => e.type === 'counter_self' && e.counter === 'lifelink');
    expect(selfLifelink).toBeDefined();
    expect(selfLifelink.amount).toBe(1);
  });

  // ── Stats: 2/2 ──
  it('is 2/2', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(2);
    expect(CardUtils.getToughness(card)).toBe(2);
  });

  // ── Human interaction ──
  describe('Human player', () => {
    it('can cast from hand', () => {
      const game = new TestGame();
      game.setHuman(0, true);
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });

  // ── AI interaction ──
  describe('AI player', () => {
    it('can cast from hand without crash', () => {
      const game = new TestGame();
      const { result } = game.castFromHand(0, CARD_DEF);
      expect(result).not.toBe(false);
    });
  });
});
