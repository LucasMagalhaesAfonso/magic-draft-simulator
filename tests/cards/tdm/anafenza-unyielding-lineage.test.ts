// @ts-nocheck
// anafenza-unyielding-lineage.test.ts — BDD tests para Anafenza, Unyielding Lineage (TDM)
// Oracle:
//   Flash
//   First strike
//   Whenever another nontoken creature you control dies, Anafenza endures 2.
//   (Put two +1/+1 counters on it or create a 2/2 white Spirit creature token.)

import { describe, it, expect } from 'vitest';
import * as GameState from '../../../src/engine/game-state';
import { CardEffectsDB } from '../../../src/engine/card-effects';
import { TestGame, CardDef } from '../../helpers/game-helper';
import {
  runCardTest,
  findScryfallCard,
  assertNoCrash,
  assertGameFinished,
} from '../../gameplay/card-test-runner';

// ─── definições de carta ─────────────────────────────────────────────────────

const ANAFENZA: CardDef = {
  name: 'Anafenza, Unyielding Lineage',
  type_line: 'Legendary Creature — Spirit Soldier',
  mana_cost: '{2}{W}',
  oracle_text: "Flash\nFirst strike\nWhenever another nontoken creature you control dies, Anafenza endures 2. (Put two +1/+1 counters on it or create a 2/2 white Spirit creature token.)",
  power: '2',
  toughness: '2',
  cmc: 3,
  colors: ['W'],
  color_identity: ['W'],
  keywords: ['First strike', 'Flash', 'Endure'],
};

const CREATURE: CardDef = {
  name: 'Ally Creature',
  type_line: 'Creature — Human',
  oracle_text: '',
  mana_cost: '{2}{G}',
  power: '2',
  toughness: '2',
  cmc: 3,
  colors: ['G'],
};

// ─── helper ──────────────────────────────────────────────────────────────────

function gameWithAnafenza() {
  const game = new TestGame({ realETBHooks: true });
  for (let i = 0; i < 10; i++) game.addToLibraryTop(0, CREATURE);
  for (let i = 0; i < 10; i++) game.addToLibraryTop(1, CREATURE);
  const anafenza = game.addToBattlefield(0, ANAFENZA);
  game.state.phase = 'main1';
  game.state.activePlayer = 0;
  return { game, anafenza };
}

// ─── testes ──────────────────────────────────────────────────────────────────

describe('Anafenza, Unyielding Lineage', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. REGISTRO
  // ═══════════════════════════════════════════════════════════════════════════

  describe('registro', () => {
    it('está no CardEffectsDB', () => {
      expect(CardEffectsDB['anafenza, unyielding lineage']).toBeDefined();
    });

    it('tem triggered other_creature_dies com condição nontoken e efeito endure 2', () => {
      const entry = CardEffectsDB['anafenza, unyielding lineage'];
      const trigger = entry.triggered?.find((t: any) => t.event === 'other_creature_dies');
      expect(trigger).toBeDefined();
      expect(trigger.condition).toBe('nontoken');
      const endureEffect = trigger.effects.find((e: any) => e.type === 'endure');
      expect(endureEffect).toBeDefined();
      expect(endureEffect.amount).toBe(2);
    });

    it('tem static first strike e flash', () => {
      const entry = CardEffectsDB['anafenza, unyielding lineage'];
      const staticEntry = entry.static?.find((s: any) =>
        s.type === 'has_keyword' &&
        s.keywords?.some((k: string) => k.toLowerCase().includes('first strike'))
      );
      expect(staticEntry).toBeDefined();
      const flashEntry = entry.static?.find((s: any) =>
        s.type === 'has_keyword' &&
        s.keywords?.some((k: string) => k.toLowerCase().includes('flash'))
      );
      expect(flashEntry).toBeDefined();
    });

    it('existe no scryfall-tdm.json', () => {
      const sc = findScryfallCard('Anafenza, Unyielding Lineage', 'tdm');
      expect(sc).not.toBeNull();
    });

    it('mana cost é {2}{W}', () => {
      const sc = findScryfallCard('Anafenza, Unyielding Lineage', 'tdm');
      expect(sc.mana_cost).toBe('{2}{W}');
    });

    it('type_line é Legendary Creature — Spirit Soldier', () => {
      const sc = findScryfallCard('Anafenza, Unyielding Lineage', 'tdm');
      expect(sc.type_line).toBe('Legendary Creature — Spirit Soldier');
    });

    it('é 2/2', () => {
      const sc = findScryfallCard('Anafenza, Unyielding Lineage', 'tdm');
      expect(sc.power).toBe('2');
      expect(sc.toughness).toBe('2');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. KEYWORDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('keywords', () => {
    it('tem First strike no card object', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, ANAFENZA);
      const hasFS = (card.keywords || []).some((k: string) => k.toLowerCase().includes('first strike')) ||
                    (card._tempKeywords || []).some((k: string) => k.toLowerCase().includes('first strike'));
      expect(hasFS).toBe(true);
    });

    it('tem Flash no card object', () => {
      const game = new TestGame();
      const card = game.addToBattlefield(0, ANAFENZA);
      const hasFlash = (card.keywords || []).some((k: string) => k.toLowerCase().includes('flash')) ||
                       (card._tempKeywords || []).some((k: string) => k.toLowerCase().includes('flash'));
      expect(hasFlash).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ENDURE TRIGGER — nontoken creature you control dies
  // ═══════════════════════════════════════════════════════════════════════════

  describe('endure trigger — quando criatura nontoken sua morre', () => {
    it('Anafenza recebe 2 contadores +1/+1 quando criatura aliada nontoken morre (IA path)', () => {
      const { game, anafenza } = gameWithAnafenza();
      const ally = game.addToBattlefield(0, CREATURE);
      GameState.sacrifice(game.state, 0, ally._uid);
      const counters = anafenza._counters?.['+1/+1'] || 0;
      expect(counters).toBe(2);
    });

    it('trigger NÃO dispara quando criatura do oponente morre', () => {
      const { game, anafenza } = gameWithAnafenza();
      const oppCreature = game.addToBattlefield(1, CREATURE);
      GameState.sacrifice(game.state, 1, oppCreature._uid);
      const counters = anafenza._counters?.['+1/+1'] || 0;
      expect(counters).toBe(0);
    });

    it('trigger NÃO dispara quando token morre', () => {
      const { game, anafenza } = gameWithAnafenza();
      const token = game.addToBattlefield(0, {
        ...CREATURE,
        name: 'Token Creature',
        _isToken: true,
      });
      token._isToken = true;
      GameState.sacrifice(game.state, 0, token._uid);
      const counters = anafenza._counters?.['+1/+1'] || 0;
      expect(counters).toBe(0);
    });

    it('acumula contadores quando múltiplas criaturas morrem', () => {
      const { game, anafenza } = gameWithAnafenza();
      const ally1 = game.addToBattlefield(0, CREATURE);
      const ally2 = game.addToBattlefield(0, CREATURE);
      GameState.sacrifice(game.state, 0, ally1._uid);
      GameState.sacrifice(game.state, 0, ally2._uid);
      const counters = anafenza._counters?.['+1/+1'] || 0;
      expect(counters).toBe(4);
    });

    it('log menciona endure 2 quando trigger dispara', () => {
      const { game, anafenza } = gameWithAnafenza();
      const ally = game.addToBattlefield(0, CREATURE);
      GameState.sacrifice(game.state, 0, ally._uid);
      const log = game.state.log.join(' ');
      expect(log.toLowerCase()).toMatch(/endure 2/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ENDURE — escolha dos efeitos
  // ═══════════════════════════════════════════════════════════════════════════

  describe('endure — criação de token Spirit quando Anafenza não existe', () => {
    it('cria token Spirit quando Anafenza não está no battlefield', () => {
      const game = new TestGame({ realETBHooks: true });
      for (let i = 0; i < 5; i++) game.addToLibraryTop(0, CREATURE);
      // Resolve endure directly without Anafenza on battlefield (endure falls back to token)
      const bfBefore = game.battlefield(0).length;
      game.resolveEffect(0, { type: 'endure', amount: 2 }, { cardUid: 'nonexistent-uid' });
      // Should create Spirit tokens since no creature found
      const bfAfter = game.battlefield(0).length;
      expect(bfAfter).toBeGreaterThan(bfBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. SMOKE TEST
  // ═══════════════════════════════════════════════════════════════════════════

  it('não quebra uma partida completa', () => {
    const result = runCardTest({
      cardName: 'Anafenza, Unyielding Lineage',
      setCode: 'tdm',
      copies: 3,
      assertions: [assertNoCrash(), assertGameFinished()],
    });
    expect(result.error).toBeNull();
    expect(result.assertions.every(a => a.passed)).toBe(true);
  });

});
