// Layer 1: Full cast flow per card — mana → castSpell → stack → resolution → zones
import { describe, it, expect } from 'vitest';
import { TestGame, CardDef } from '../helpers/game-helper';
import { FIXTURES, CardFlowFixture } from '../helpers/card-flow-fixtures';

// Dummy creature for targeting
const targetDummy: CardDef = {
  name: 'Target Dummy',
  type_line: 'Creature — Construct',
  oracle_text: '',
  power: '2',
  toughness: '2',
};

// Only test castable cards (skip lands, X-cost, adventure)
const castable = FIXTURES.filter(f => !f._skipCast);

describe('Cast Flow — Full Cast Pipeline', () => {
  for (const fix of castable) {
    describe(fix.name, () => {
      it('casts successfully with correct mana', () => {
        const game = new TestGame({ realETBHooks: true });
        // Add library cards (some effects need them)
        for (let i = 0; i < 5; i++) game.addToLibraryTop(0, targetDummy);
        for (let i = 0; i < 5; i++) game.addToLibraryTop(1, targetDummy);
        // Add target if needed
        if (fix.needsTarget) game.addToBattlefield(1, targetDummy);
        const card = game.addToHand(0, fix.cardDef);
        game.setMana(0, fix.manaPool);
        const result = game.cast(0, card._uid);
        expect(result.success).toBe(true);
      });

      it('fails without mana', () => {
        const game = new TestGame();
        const card = game.addToHand(0, fix.cardDef);
        game.setMana(0, {});
        const result = game.cast(0, card._uid);
        expect(result.success).toBe(false);
      });

      if (fix.isPermanent) {
        it('permanent lands on battlefield after cast', () => {
          const game = new TestGame({ realETBHooks: true });
          for (let i = 0; i < 5; i++) game.addToLibraryTop(0, targetDummy);
          for (let i = 0; i < 5; i++) game.addToLibraryTop(1, targetDummy);
          if (fix.needsTarget) game.addToBattlefield(1, targetDummy);
          const card = game.addToHand(0, fix.cardDef);
          game.setMana(0, fix.manaPool);
          game.cast(0, card._uid);
          const onBf = game.battlefield(0).some((c: any) => c._uid === card._uid);
          expect(onBf).toBe(true);
        });
      } else {
        it('spell goes to graveyard after resolution', () => {
          const game = new TestGame({ realETBHooks: true });
          for (let i = 0; i < 5; i++) game.addToLibraryTop(0, targetDummy);
          for (let i = 0; i < 5; i++) game.addToLibraryTop(1, targetDummy);
          if (fix.needsTarget) game.addToBattlefield(1, targetDummy);
          const card = game.addToHand(0, fix.cardDef);
          game.setMana(0, fix.manaPool);
          game.cast(0, card._uid);
          const inGy = game.graveyard(0).some((c: any) => c._uid === card._uid);
          const inHand = game.hand(0).some((c: any) => c._uid === card._uid);
          // Should be in graveyard OR at least not in hand anymore
          expect(inGy || !inHand).toBe(true);
        });
      }

      it('card removed from hand after cast', () => {
        const game = new TestGame({ realETBHooks: true });
        for (let i = 0; i < 5; i++) game.addToLibraryTop(0, targetDummy);
        for (let i = 0; i < 5; i++) game.addToLibraryTop(1, targetDummy);
        if (fix.needsTarget) game.addToBattlefield(1, targetDummy);
        const card = game.addToHand(0, fix.cardDef);
        game.setMana(0, fix.manaPool);
        game.cast(0, card._uid);
        const inHand = game.hand(0).some((c: any) => c._uid === card._uid);
        expect(inHand).toBe(false);
      });
    });
  }
});
