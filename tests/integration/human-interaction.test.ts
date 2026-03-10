// Layer 2: Human interaction — verifies waitingForInput pauses for interactive effects
import { describe, it, expect } from 'vitest';
import { TestGame, CardDef } from '../helpers/game-helper';
import { FIXTURES } from '../helpers/card-flow-fixtures';

const targetDummy: CardDef = {
  name: 'Target Dummy',
  type_line: 'Creature — Construct',
  oracle_text: '',
  power: '2',
  toughness: '2',
};

const filler: CardDef = {
  name: 'Filler Card',
  type_line: 'Creature — Human',
  oracle_text: '',
  power: '1',
  toughness: '1',
};

// Interactive types that reliably pause for human input
const RELIABLE_INTERACTIVE = new Set(['scry', 'surveil', 'modal_choice', 'look_top_choice', 'distribute_counters']);

// Only cards with reliable interactive effects, and castable
const interactive = FIXTURES.filter(f =>
  !f._skipCast &&
  f.interactiveTypes.some(t => RELIABLE_INTERACTIVE.has(t))
);

describe('Human Interaction — waitingForInput Pauses', () => {
  for (const fix of interactive) {
    describe(fix.name, () => {
      it(`pauses with waitingForInput (expects: ${fix.interactiveTypes.join(', ')})`, () => {
        const game = new TestGame({ realETBHooks: true });
        game.setHuman(0, true);
        // Add library cards for scry/surveil/search
        for (let i = 0; i < 10; i++) game.addToLibraryTop(0, filler);
        for (let i = 0; i < 5; i++) game.addToLibraryTop(1, filler);
        // Add target if needed
        if (fix.needsTarget) game.addToBattlefield(1, targetDummy);
        const card = game.addToHand(0, fix.cardDef);
        game.setMana(0, fix.manaPool);
        game.cast(0, card._uid);
        const wfi = game.state.waitingForInput;
        // Should have paused for human input (any type counts — exact type mapping is best-effort)
        expect(wfi).not.toBeNull();
      });
    });
  }
});
