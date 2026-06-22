// @ts-nocheck
// ugin-eye-of-the-storms.test.ts — BDD tests para Ugin, Eye of the Storms (TDM)
// Oracle:
//   "When you cast this spell, exile up to one target permanent that's one or more colors.
//    Whenever you cast a colorless spell, exile up to one target permanent that's one or more colors.
//    +2: You gain 3 life and draw a card.
//    0: Add {C}{C}{C}.
//    −11: Search your library for any number of colorless nonland cards, exile them, then shuffle.
//         Until end of turn, you may cast those cards without paying their mana costs."

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

const UGIN: CardDef = {
  name: 'Ugin, Eye of the Storms',
  type_line: 'Legendary Planeswalker — Ugin',
  mana_cost: '{7}',
  oracle_text: "When you cast this spell, exile up to one target permanent that's one or more colors.\nWhenever you cast a colorless spell, exile up to one target permanent that's one or more colors.\n+2: You gain 3 life and draw a card.\n0: Add {C}{C}{C}.\n−11: Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs.",
  cmc: 7,
  colors: [],
  color_identity: [],
};

const COLORED_CREATURE: CardDef = {
  name: 'Colored Creature',
  type_line: 'Creature — Human',
  oracle_text: '',
  mana_cost: '{2}{G}',
  power: '2',
  toughness: '2',
  cmc: 3,
  colors: ['G'],
};

const COLORLESS_SPELL: CardDef = {
  name: 'Colorless Spell',
  type_line: 'Instant',
  oracle_text: '',
  mana_cost: '{3}',
  cmc: 3,
  colors: [],
};

// ─── helper ──────────────────────────────────────────────────────────────────

function gameWithUgin(loyaltyOverride?: number) {
  const game = new TestGame({ realETBHooks: true });
  for (let i = 0; i < 10; i++) game.addToLibraryTop(0, COLORLESS_SPELL);
  for (let i = 0; i < 10; i++) game.addToLibraryTop(1, COLORED_CREATURE);
  const ugin = game.addToBattlefield(0, UGIN);
  if (loyaltyOverride !== undefined) ugin._loyalty = loyaltyOverride;
  game.state.phase = 'main1';
  game.state.activePlayer = 0;
  return { game, ugin };
}

// ─── testes ──────────────────────────────────────────────────────────────────

describe('Ugin, Eye of the Storms', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. REGISTRO
  // ═══════════════════════════════════════════════════════════════════════════

  describe('registro', () => {
    it('está no CardEffectsDB', () => {
      expect(CardEffectsDB['ugin, eye of the storms']).toBeDefined();
    });

    it('tem triggered cast_spell self (exile colored_permanent ao ser castado)', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      expect(entry.triggered).toBeDefined();
      const selfCast = entry.triggered.find((t: any) => t.event === 'cast_spell' && t.self === true);
      expect(selfCast).toBeDefined();
      const exileEffect = selfCast.effects.find((e: any) => e.type === 'exile' && e.target === 'colored_permanent');
      expect(exileEffect).toBeDefined();
      expect(exileEffect.optional).toBe(true);
      expect(exileEffect.up_to_max).toBe(1);
    });

    it('tem triggered cast_colorless para exilar colored_permanent', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      expect(entry.triggered).toBeDefined();
      const trigger = entry.triggered.find((t: any) => t.event === 'cast_colorless');
      expect(trigger).toBeDefined();
      const exileEffect = trigger.effects.find((e: any) => e.type === 'exile' && e.target === 'colored_permanent');
      expect(exileEffect).toBeDefined();
      expect(exileEffect.optional).toBe(true);
    });

    it('tem 3 activated abilities (loyalty)', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      expect(entry.activated).toBeDefined();
      expect(entry.activated).toHaveLength(3);
    });

    it('+2 ability: gainLife 3 + draw 1', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      const plusTwo = entry.activated.find((a: any) => a.cost?.loyalty === 2);
      expect(plusTwo).toBeDefined();
      const types = plusTwo.effects.map((e: any) => e.type);
      expect(types).toContain('gainLife');
      expect(types).toContain('draw');
      const gainEffect = plusTwo.effects.find((e: any) => e.type === 'gainLife');
      expect(gainEffect.amount).toBe(3);
      const drawEffect = plusTwo.effects.find((e: any) => e.type === 'draw');
      expect(drawEffect.amount).toBe(1);
    });

    it('0 ability: add_mana {C}{C}{C}', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      const zero = entry.activated.find((a: any) => a.cost?.loyalty === 0);
      expect(zero).toBeDefined();
      const manaEffect = zero.effects.find((e: any) => e.type === 'add_mana');
      expect(manaEffect).toBeDefined();
      expect(manaEffect.color).toBe('C');
      expect(manaEffect.amount).toBe(3);
    });

    it('-11 ability: search_library colorless_nonland', () => {
      const entry = CardEffectsDB['ugin, eye of the storms'];
      const minusEleven = entry.activated.find((a: any) => a.cost?.loyalty === -11);
      expect(minusEleven).toBeDefined();
      const searchEffect = minusEleven.effects.find((e: any) => e.type === 'search_library');
      expect(searchEffect).toBeDefined();
      expect(searchEffect.target).toBe('colorless_nonland');
    });

    it('existe no scryfall-tdm.json', () => {
      const sc = findScryfallCard('Ugin, Eye of the Storms', 'tdm');
      expect(sc).not.toBeNull();
    });

    it('mana cost é {7}', () => {
      const sc = findScryfallCard('Ugin, Eye of the Storms', 'tdm');
      expect(sc.mana_cost).toBe('{7}');
    });

    it('type_line é Legendary Planeswalker — Ugin', () => {
      const sc = findScryfallCard('Ugin, Eye of the Storms', 'tdm');
      expect(sc.type_line).toBe('Legendary Planeswalker — Ugin');
    });

    it('mana cost é colorless (sem {W}{U}{B}{R}{G})', () => {
      const sc = findScryfallCard('Ugin, Eye of the Storms', 'tdm');
      expect(sc.mana_cost).not.toMatch(/\{[WUBRG]\}/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. +2 LOYALTY ABILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('+2 loyalty ability — gain 3 life and draw a card', () => {
    it('adiciona 2 de lealdade ao ativar', () => {
      const { game, ugin } = gameWithUgin(5);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      expect(ugin._loyalty).toBe(7);
    });

    it('jogador ganha exatamente 3 de vida', () => {
      const { game, ugin } = gameWithUgin(5);
      const lifeBefore = game.life(0);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      expect(game.life(0)).toBe(lifeBefore + 3);
    });

    it('jogador compra exatamente 1 carta', () => {
      const { game, ugin } = gameWithUgin(5);
      const handBefore = game.hand(0).length;
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      expect(game.hand(0).length).toBe(handBefore + 1);
    });

    it('não pode ativar novamente no mesmo turno', () => {
      const { game, ugin } = gameWithUgin(5);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      const result = GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      expect(result.success).toBe(false);
    });

    it('log registra ativação +2', () => {
      const { game, ugin } = gameWithUgin(5);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      const log = game.state.log.join(' ');
      expect(log).toMatch(/\+2/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 0 LOYALTY ABILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('0 loyalty ability — add {C}{C}{C}', () => {
    it('lealdade não muda ao ativar 0', () => {
      const { game, ugin } = gameWithUgin(5);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 1);
      expect(ugin._loyalty).toBe(5);
    });

    it('adiciona 3 de mana incolor ao pool', () => {
      const { game, ugin } = gameWithUgin(5);
      const manaBefore = game.state.manaPool[0].C || 0;
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 1);
      expect(game.state.manaPool[0].C).toBe(manaBefore + 3);
    });

    it('log registra ativação 0', () => {
      const { game, ugin } = gameWithUgin(5);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 1);
      const log = game.state.log.join(' ');
      expect(log).toMatch(/\+0|loyalty 5/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. -11 LOYALTY ABILITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('-11 loyalty ability — search library for colorless nonland cards', () => {
    it('falha se lealdade é insuficiente', () => {
      const { game, ugin } = gameWithUgin(5);
      const result = GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 2);
      expect(result.success).toBe(false);
    });

    it('ativa com lealdade suficiente (11+)', () => {
      const { game, ugin } = gameWithUgin(11);
      const result = GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 2);
      expect(result.success).toBe(true);
    });

    it('remove 11 de lealdade ao ativar', () => {
      const { game, ugin } = gameWithUgin(12);
      GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 2);
      expect(ugin._loyalty).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CAST TRIGGER — exile colored permanent on cast
  // ═══════════════════════════════════════════════════════════════════════════

  describe('cast trigger — exila permanent colorida ao ser castado', () => {
    it('permanent colorida do oponente é exilada ao castar Ugin', () => {
      const game = new TestGame({ realETBHooks: true });
      for (let i = 0; i < 10; i++) game.addToLibraryTop(0, COLORLESS_SPELL);
      for (let i = 0; i < 10; i++) game.addToLibraryTop(1, COLORLESS_SPELL);
      const coloredPermanent = game.addToBattlefield(1, COLORED_CREATURE);
      const ugin = game.addToHand(0, UGIN);
      game.setMana(0, { C: 7 });
      game.state.phase = 'main1';
      game.cast(0, ugin._uid);
      const oppBf = game.battlefield(1);
      const oppExile = game.state.players[1].zones.exile?.cards || [];
      const wasExiledOrRemoved = !oppBf.find(c => c._uid === coloredPermanent._uid);
      expect(wasExiledOrRemoved).toBe(true);
    });

    it('colorless permanent NÃO é exilado (trigger só afeta permanentes coloridos)', () => {
      const game = new TestGame({ realETBHooks: true });
      for (let i = 0; i < 10; i++) game.addToLibraryTop(0, COLORLESS_SPELL);
      for (let i = 0; i < 10; i++) game.addToLibraryTop(1, COLORLESS_SPELL);
      const colorlessPermanent = game.addToBattlefield(1, {
        name: 'Colorless Artifact',
        type_line: 'Artifact',
        oracle_text: '',
        mana_cost: '{3}',
        cmc: 3,
        colors: [],
      });
      const ugin = game.addToHand(0, UGIN);
      game.setMana(0, { C: 7 });
      game.state.phase = 'main1';
      game.cast(0, ugin._uid);
      const oppBf = game.battlefield(1);
      // Colorless artifact should still be there (no valid target for the exile)
      expect(oppBf.find(c => c._uid === colorlessPermanent._uid)).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TRIGGERED — exile colored permanent when casting colorless spell
  // ═══════════════════════════════════════════════════════════════════════════

  describe('triggered ability — exila permanent colorida ao castar feitiço incolor', () => {
    it('dispara trigger cast_colorless quando feitiço incolor é castado', () => {
      const { game, ugin } = gameWithUgin(5);
      const coloredPermanent = game.addToBattlefield(1, COLORED_CREATURE);
      const spell = game.addToHand(0, COLORLESS_SPELL);
      game.setMana(0, { C: 3 });
      game.cast(0, spell._uid);
      const oppBf = game.battlefield(1);
      const wasExiledOrRemoved = !oppBf.find(c => c._uid === coloredPermanent._uid);
      expect(wasExiledOrRemoved).toBe(true);
    });

    it('NÃO dispara ao castar feitiço colorido', () => {
      const { game, ugin } = gameWithUgin(5);
      const coloredPermanent = game.addToBattlefield(1, COLORED_CREATURE);
      const coloredSpell = game.addToHand(0, {
        name: 'Lightning Bolt Test',
        type_line: 'Instant',
        oracle_text: '',
        mana_cost: '{R}',
        cmc: 1,
        colors: ['R'],
      });
      game.setMana(0, { R: 1 });
      game.cast(0, coloredSpell._uid);
      const oppBf = game.battlefield(1);
      // Colored spell cast should NOT trigger Ugin's exile
      const stillThere = oppBf.find(c => c._uid === coloredPermanent._uid);
      expect(stillThere).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. GERENCIAMENTO DE LEALDADE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('gerenciamento de lealdade', () => {
    it('não pode ativar fora do main phase', () => {
      const { game, ugin } = gameWithUgin(5);
      game.state.phase = 'combat_attackers';
      const result = GameState.activateLoyaltyAbility(game.state, 0, ugin._uid, 0);
      expect(result.success).toBe(false);
    });

    it('não pode ativar se Ugin não está no battlefield', () => {
      const game = new TestGame();
      game.state.phase = 'main1';
      const result = GameState.activateLoyaltyAbility(game.state, 0, 'fake-uid', 0);
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SMOKE TEST
  // ═══════════════════════════════════════════════════════════════════════════

  it('não quebra uma partida completa', () => {
    const result = runCardTest({
      cardName: 'Ugin, Eye of the Storms',
      setCode: 'tdm',
      copies: 2,
      assertions: [assertNoCrash(), assertGameFinished()],
    });
    expect(result.error).toBeNull();
    expect(result.assertions.every(a => a.passed)).toBe(true);
  });

});
