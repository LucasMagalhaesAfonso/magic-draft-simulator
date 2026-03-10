// Layer 3: Combat flow — attack, block, damage, keywords, triggers
import { describe, it, expect } from 'vitest';
import { TestGame, CardDef } from '../helpers/game-helper';
import { FIXTURES } from '../helpers/card-flow-fixtures';
import * as Combat from '../../src/engine/combat';

const creatures = FIXTURES.filter(f => f.isCreature && !f.isLand);

describe('Combat Flow — Creature Combat Tests', () => {
  for (const fix of creatures) {
    const kwLower = fix.keywords.map(k => k.toLowerCase());
    describe(fix.name, () => {
      it('can attack without summoning sickness', () => {
        const game = new TestGame();
        const card = game.addToBattlefield(0, fix.cardDef);
        game.startCombat(0);
        const canAttack = !kwLower.includes('defender');
        const result = game.declareAttacker(card);
        expect(result).toBe(canAttack);
      });

      if (!kwLower.includes('defender') && fix.power > 0 && !kwLower.includes('double strike')) {
        it('deals correct combat damage to opponent', () => {
          const game = new TestGame();
          const card = game.addToBattlefield(0, fix.cardDef);
          game.startCombat(0);
          game.declareAttacker(card);
          game.resolveCombatDamage();
          expect(game.life(1)).toBe(20 - fix.power);
        });
      }

      if (kwLower.includes('defender')) {
        it('cannot attack (Defender)', () => {
          const game = new TestGame();
          const card = game.addToBattlefield(0, fix.cardDef);
          game.startCombat(0);
          expect(game.declareAttacker(card)).toBe(false);
        });
      }

      if (kwLower.includes('flying')) {
        it('cannot be blocked by non-flyer without reach', () => {
          const game = new TestGame();
          const attacker = game.addToBattlefield(0, fix.cardDef);
          const blocker = game.addToBattlefield(1, {
            name: 'Ground Blocker',
            type_line: 'Creature — Human',
            power: '3',
            toughness: '3',
          });
          game.startCombat(0);
          game.declareAttacker(attacker);
          const canBlock = Combat.declareBlocker(game.state.combat, blocker, attacker._uid, game.state);
          expect(canBlock).toBe(false);
        });
      }

      if (kwLower.includes('lifelink') && !kwLower.includes('defender') && fix.power > 0) {
        it('gains life from combat damage (Lifelink)', () => {
          const game = new TestGame();
          const card = game.addToBattlefield(0, fix.cardDef);
          game.startCombat(0);
          game.declareAttacker(card);
          game.resolveCombatDamage();
          expect(game.life(0)).toBe(20 + fix.power);
        });
      }
    });
  }
});
