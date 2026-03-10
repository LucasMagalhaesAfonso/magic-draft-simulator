import { describe, it, expect } from 'vitest';
import { TestGame, CardUtils } from '../../helpers/game-helper';
import { CardEffectsDB } from '../../../src/engine/card-effects';

/**
 * Boromir, Warden of the Tower — {2}{W}
 * Legendary Creature — Human Soldier (3/3)
 *
 * Vigilance.
 * Whenever an opponent casts a spell, if no mana was spent to cast it,
 * counter that spell.
 * Sacrifice Boromir: Creatures you control gain indestructible until end of
 * turn. The Ring tempts you.
 */
describe('Boromir, Warden of the Tower', () => {
  const DB = CardEffectsDB['boromir, warden of the tower'];
  const CARD_DEF = {
    name: 'Boromir, Warden of the Tower',
    type_line: 'Legendary Creature — Human Soldier',
    mana_cost: '{2}{W}',
    power: '3',
    toughness: '3',
    keywords: ['Vigilance'],
  };

  it('exists in CardEffectsDB', () => {
    expect(DB).toBeDefined();
  });

  // ── Oracle: "Vigilance" ──
  it('has vigilance keyword in static', () => {
    expect(DB.static).toBeDefined();
    const vigStatic = DB.static.find((s: any) => s.type === 'has_keyword' && s.keywords?.includes('vigilance'));
    expect(vigStatic).toBeDefined();
  });

  // ── Oracle: "Whenever an opponent casts a spell, if no mana was spent to cast it,
  //    counter that spell" ──
  it('has opponent_casts_free_spell trigger with counter_spell', () => {
    expect(DB.triggered).toBeDefined();
    const trigger = DB.triggered.find((t: any) => t.event === 'opponent_casts_free_spell');
    expect(trigger).toBeDefined();
    expect(trigger.self).toBe(false);
    const counterEffect = trigger.effects.find((e: any) => e.type === 'counter_spell');
    expect(counterEffect).toBeDefined();
  });

  // ── Oracle: "Sacrifice Boromir:" (activated ability cost) ──
  it('activated ability costs sacrifice self', () => {
    expect(DB.activated).toBeDefined();
    expect(DB.activated.length).toBeGreaterThanOrEqual(1);
    const ability = DB.activated[0];
    expect(ability.cost).toBeDefined();
    expect(ability.cost.sacrifice).toBe('self');
  });

  // ── Oracle: "Creatures you control gain indestructible until end of turn" ──
  it('activated grants all creatures indestructible until end of turn', () => {
    const ability = DB.activated[0];
    const grantAll = ability.effects.find((e: any) => e.type === 'grant_all');
    expect(grantAll).toBeDefined();
    expect(grantAll.keywords).toContain('indestructible');
    expect(grantAll.duration).toBe('end_of_turn');
  });

  // ── Oracle: "The Ring tempts you" (part of activated) ──
  it('activated also ring_tempts', () => {
    const ability = DB.activated[0];
    const ringEffect = ability.effects.find((e: any) => e.type === 'ring_tempts');
    expect(ringEffect).toBeDefined();
  });

  // ── Stats: 3/3 ──
  it('is 3/3', () => {
    const game = new TestGame();
    const card = game.addToBattlefield(0, CARD_DEF);
    expect(CardUtils.getPower(card)).toBe(3);
    expect(CardUtils.getToughness(card)).toBe(3);
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
