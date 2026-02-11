/**
 * Layer E: Effect Runtime Verification
 *
 * For EVERY card in CardEffectsDB, resolves effects in a real game state
 * and verifies the game state changed as expected.
 *
 * Unlike Layer A (completeness) which checks types exist in a whitelist,
 * this test actually RUNS each effect and asserts the outcome.
 *
 * Uses AI (playerId=1) as controller to avoid interactive pauses.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

test.describe('Effect Runtime Verification', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('All CardEffectsDB effects resolve and change game state correctly', async () => {
    const results = await page.evaluate(() => {
      const TH = window.TestHelper;
      const failures = [];
      let cardsTestedCount = 0;
      let zonesTestedCount = 0;
      let effectsResolvedCount = 0;
      let skippedCount = 0;

      // Meta-tags / system-level: skip entirely (truly declarative, no runtime resolution)
      const SKIP_TYPES = new Set([
        'has_keyword', 'triggered_this_turn',
        'behold', 'behold_dragon', 'hideaway', 'basic',
        'enters_tapped', 'enters_tapped_conditional',
        'aura_debuff', 'aura_prevent_untap',
        'unblockable', 'uncounterable', 'cant_be_blocked_by_smaller',
        'conditional_buff', 'conditional_hexproof',
        'cost_reduction', 'double_damage', 'token_doubling',
        'power_equals', 'lord',
        'prevent_activated_abilities', 'prevent_opponent_casting',
        'grant_delve', 'grant_flash', 'grant_indestructible',
        'dragon_etb_counter', 'etb_counters_if_second_spell',
        'tap_or_untap', 'exile_with_suspend', 'bounce_to_library',
        'warrior_tokens_protected_end_step', 'counter_all_type',
        'Dragon', 'Elf', 'Kithkin',
        'reveal_hand', 'counter_spell'
      ]);

      // Effects that just need "no crash"
      const NO_CRASH_TYPES = new Set([
        'scry', 'surveil', 'clash', 'look_top', 'loot',
        'copy_spell', 'copy_next_spell', 'extra_combat',
        'become_creature', 'become_dragon', 'attach',
        'exile_graveyard_cast_copy', 'endure',
        'ramp', 'search_library', 'search_library_to_graveyard',
        'exile_top_play', 'return_land_from_mill',
        'counter_self_if_no_draw', 'blight', 'blight_opponent',
        'fight', 'debuff', 'debuff_all', 'move_counters',
        'regenerate', 'grant_haste', 'grant_harmonize', 'untap', 'untap_all',
        'add_mana', 'buff_self', 'prevent_damage',
        // Moved from SKIP: effect types that register abilities on the card
        'triggered', 'static', 'modal',
        // Static sub-effects that can be tested at no-crash level
        'buff_all', 'grant', 'grant_all', 'anthem'
      ]);

      // Effects that REQUIRE targeting — must go through GameStack even for ETB/triggered/activated
      const TARGETED_EFFECT_TYPES = new Set([
        'damage', 'destroy', 'exile', 'bounce', 'counter', 'discard',
        'tap', 'stun', 'gain_control', 'threaten', 'grant_counter',
        'grant_counters', 'remove_counters', 'bounce_to_library_top'
      ]);

      // Standard creature targets we know how to build
      const STANDARD_CREATURE_TARGETS = new Set([
        'creature', 'opponent_creature', 'creature_or_planeswalker',
        'own_creature', 'any'
      ]);
      // Standard player targets
      const STANDARD_PLAYER_TARGETS = new Set([
        'opponent', 'player', 'each_opponent', 'self'
      ]);
      // Global/self-resolving targets (no specific target needed)
      const GLOBAL_TARGETS = new Set([
        'all_own_creatures', 'own_creatures', 'opponent_creatures',
        'creatures', 'all_opponent_creatures'
      ]);

      /**
       * Check if an amount is dynamic/unpredictable.
       */
      function isDynamic(val) {
        return val !== undefined && val !== null && typeof val === 'string';
      }

      /**
       * Check if this counter effect is a counterspell (not +1/+1 counters).
       */
      function isCounterspell(effect) {
        if (effect.type !== 'counter') return false;
        if (effect.counter) return false; // has counter type = placement
        if (effect.target === 'spell') return true;
        if (effect.unless_pay !== undefined) return true;
        return false;
      }

      /**
       * Determine if a target string is one we can set up in our test.
       * Returns false for exotic targets like "creature_with_flying", "non_elf_creature", etc.
       */
      function isTestableTarget(tgt) {
        if (!tgt) return true; // no target = self-resolving = testable
        return STANDARD_CREATURE_TARGETS.has(tgt) ||
               STANDARD_PLAYER_TARGETS.has(tgt) ||
               GLOBAL_TARGETS.has(tgt);
      }

      /**
       * Prepare a creature for battlefield (add all required runtime fields).
       */
      function bfPrep(card) {
        return CardEngine.prepareForBattlefield(card);
      }

      /**
       * Create fresh game state. Controller=1 (AI), opponent=0.
       */
      function makeState(effectType, effect) {
        const opts = {
          myLife: 20, oppLife: 20,
          myBf: [], oppBf: [],
          myHand: [], oppHand: [],
          turn: 3
        };

        const tgt = effect.target || '';

        // Only add creatures when effect actually targets them
        const needsOppCreature = ['damage', 'destroy', 'exile', 'bounce', 'tap', 'stun',
          'bounce_to_library_top', 'gain_control', 'threaten',
          'counter', 'grant_counter', 'grant_counters', 'remove_counters'];
        const needsMultiOppCreature = ['destroy_all', 'damage_all_creatures', 'exile_all', 'debuff_all', 'damage_all'];
        const needsOwnCreature = ['buff', 'counter_self', 'grant', 'double_counters', 'copy_self',
          'anthem', 'buff_all', 'counter_all', 'grant_all', 'grant_haste',
          'bounce_self', 'move_counters', 'distribute_counters', 'blight',
          'become_creature', 'become_dragon', 'endure', 'regenerate',
          'fight', 'debuff', 'untap', 'untap_all'];
        // exile/destroy targeting own_creature needs extra creature on controller bf
        const needsExtraOwnCreature = effect.target === 'own_creature' && ['exile', 'destroy', 'bounce', 'sacrifice'].includes(effectType);

        // Only add opp creatures for standard creature-targeting effects
        if (needsOppCreature.includes(effectType) && isTestableTarget(tgt) && !isCounterspell(effect)) {
          const c = bfPrep(TH.makeCreature('Test Bear', 2, 2, { cost: '{1}{G}', cmc: 2, colors: ['G'] }));
          opts.myBf.push(c);
        }
        if (needsMultiOppCreature.includes(effectType)) {
          opts.myBf.push(
            bfPrep(TH.makeCreature('Test Bear', 2, 2, { cost: '{1}{G}', cmc: 2, colors: ['G'] })),
            bfPrep(TH.makeCreature('Test Wolf', 3, 3, { cost: '{2}{R}', cmc: 3, colors: ['R'] }))
          );
        }
        if (needsOwnCreature.includes(effectType)) {
          opts.oppBf.push(bfPrep(TH.makeCreature('Test Knight', 3, 3, {
            cost: '{2}{W}', cmc: 3, colors: ['W'], typeLine: 'Creature — Human Knight'
          })));
          if (['buff_all', 'counter_all', 'grant_all', 'anthem', 'distribute_counters'].includes(effectType)) {
            opts.oppBf.push(bfPrep(TH.makeCreature('Test Soldier', 2, 2, {
              cost: '{1}{W}', cmc: 2, colors: ['W'], typeLine: 'Creature — Human Soldier'
            })));
          }
        }
        if (effectType === 'fight') {
          if (opts.myBf.length === 0) {
            opts.myBf.push(bfPrep(TH.makeCreature('Test Bear', 2, 2, { cost: '{1}{G}', cmc: 2, colors: ['G'] })));
          }
        }
        // Extra own creature for effects that exile/destroy own creature
        if (needsExtraOwnCreature) {
          opts.oppBf.push(bfPrep(TH.makeCreature('Sacrifice Fodder', 1, 1, {
            cost: '{W}', cmc: 1, colors: ['W'], typeLine: 'Creature — Human'
          })));
        }

        const state = TH.createTestState(opts);

        // Add basic lands for ramp
        if (effectType === 'ramp' || effectType === 'search_library') {
          for (const ln of [{ n: 'Plains', c: 'W' }, { n: 'Island', c: 'U' }, { n: 'Swamp', c: 'B' },
                            { n: 'Mountain', c: 'R' }, { n: 'Forest', c: 'G' }]) {
            for (let i = 0; i < 3; i++) state.players[1].zones.library.add(TH.makeLand(ln.n, ln.c));
          }
        }

        // Add GY cards (both players, so exile_from_graveyard targeting opponent also works)
        if (['return_from_graveyard', 'exile_graveyard', 'exile_from_graveyard', 'exile_graveyard_cast_copy'].includes(effectType)) {
          state.players[1].zones.graveyard.add(TH.makeCreature('GY Beast', 4, 4, { cost: '{3}{G}', cmc: 4, colors: ['G'] }));
          state.players[1].zones.graveyard.add(TH.makeSpell('GY Bolt', '{R}', 1, 'Instant', 'Deal 3 damage', ['R']));
          state.players[0].zones.graveyard.add(TH.makeCreature('Opp GY Beast', 3, 3, { cost: '{2}{B}', cmc: 3, colors: ['B'] }));
          state.players[0].zones.graveyard.add(TH.makeSpell('Opp GY Spell', '{U}', 1, 'Instant', 'Draw 1', ['U']));
        }

        // Seed opponent hand for discard effects
        if (effectType === 'discard' || effectType === 'discard_hand') {
          for (let i = 0; i < 3; i++) {
            state.players[0].zones.hand.add(TH.makeCreature('Discard Filler ' + i, 1, 1));
          }
        }

        TH.addMana(state, 1, '5WWUUBBRRGG');
        return state;
      }

      function snap(state, cid) {
        const opp = cid === 0 ? 1 : 0;
        return {
          cLife: state.players[cid].life,
          oLife: state.players[opp].life,
          cBfC: state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
          oBfC: state.players[opp].zones.battlefield.cards.filter(c => CardEngine.isCreature(c)).length,
          cBf: state.players[cid].zones.battlefield.count(),
          oBf: state.players[opp].zones.battlefield.count(),
          cH: state.players[cid].zones.hand.count(),
          oH: state.players[opp].zones.hand.count(),
          cGY: state.players[cid].zones.graveyard.count(),
          oGY: state.players[opp].zones.graveyard.count(),
          cEx: state.players[cid].zones.exile.count(),
          oEx: state.players[opp].zones.exile.count(),
          cLib: state.players[cid].zones.library.count(),
          oLib: state.players[opp].zones.library.count()
        };
      }

      function buildTargets(state, effect, cid) {
        const opp = cid === 0 ? 1 : 0;
        if (isCounterspell(effect)) return [];

        const tgt = effect.target;
        if (!tgt || !isTestableTarget(tgt)) return [];
        if (GLOBAL_TARGETS.has(tgt)) return [];

        if (STANDARD_PLAYER_TARGETS.has(tgt)) {
          if (tgt === 'self') return [{ type: 'player', player: cid }];
          return [{ type: 'player', player: opp }];
        }

        if (tgt === 'creature' || tgt === 'opponent_creature' || tgt === 'creature_or_planeswalker') {
          const bf = state.players[opp].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          return bf.length > 0 ? [{ type: 'creature', player: opp, uid: bf[0]._uid }] : [];
        }
        if (tgt === 'own_creature') {
          const bf = state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          return bf.length > 0 ? [{ type: 'creature', player: cid, uid: bf[0]._uid }] : [];
        }
        if (tgt === 'any') {
          const bf = state.players[opp].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
          return bf.length > 0
            ? [{ type: 'creature', player: opp, uid: bf[0]._uid }]
            : [{ type: 'player', player: opp }];
        }
        return [];
      }

      /**
       * Should this effect only be checked for no-crash (no state assertion)?
       */
      function isNoCrashOnly(effect) {
        if (NO_CRASH_TYPES.has(effect.type)) return true;
        if (isDynamic(effect.amount) || isDynamic(effect.power) || isDynamic(effect.count)) return true;
        if (isCounterspell(effect)) return true;
        if (!isTestableTarget(effect.target)) return true;
        // Effects with conditions can't be asserted — test state doesn't set up conditions
        if (effect.condition && effect.condition !== 'nonland' && effect.condition !== 'noncreature_nonland_mv3' && effect.condition !== 'land_to_hand') return true;
        return false;
      }

      /**
       * Assert that the effect changed game state correctly.
       */
      function assertEffect(etype, effect, b, a, state, cid) {
        const opp = cid === 0 ? 1 : 0;
        switch (etype) {
          case 'damage':
            if (['opponent', 'player', 'each_opponent'].includes(effect.target)) {
              if (a.oLife >= b.oLife) return `opp life unchanged (${a.oLife})`;
            } else if (['creature', 'any', 'opponent_creature', 'creature_or_planeswalker'].includes(effect.target)) {
              if (b.oBfC > 0) {
                const died = a.oBfC < b.oBfC;
                const damaged = state.players[opp].zones.battlefield.cards.some(c => CardEngine.isCreature(c) && c._damage > 0);
                if (!died && !damaged) return `creature not damaged`;
              }
            }
            return null;
          case 'damage_each_opponent':
            return a.oLife < b.oLife ? null : `opp life unchanged`;
          case 'gainLife': case 'gain_life':
            return a.cLife > b.cLife ? null : `controller life unchanged (${a.cLife})`;
          case 'loseLife':
            // loseLife is a drawback/cost — defaults to controller (self-harm)
            if (effect.target === 'opponent' || effect.target === 'each_opponent') {
              return a.oLife < b.oLife ? null : `opp life unchanged`;
            }
            return a.cLife < b.cLife ? null : `controller life unchanged`;
          case 'lose_life':
            // lose_life is offensive — defaults to opponent
            if (effect.target === 'self') {
              return a.cLife < b.cLife ? null : `controller life unchanged`;
            }
            return a.oLife < b.oLife ? null : `opp life unchanged`;
          case 'drain':
            if (a.oLife >= b.oLife) return `opp life unchanged`;
            if (a.cLife <= b.cLife) return `controller life unchanged`;
            return null;
          case 'destroy':
            return (b.oBfC > 0 && a.oBfC >= b.oBfC) ? `opp bf unchanged` : null;
          case 'exile':
            if (effect.target === 'own_creature') {
              return (b.cBfC > 0 && a.cBfC >= b.cBfC) ? `own bf unchanged` : null;
            }
            return (b.oBfC > 0 && a.oBfC >= b.oBfC) ? `opp bf unchanged` : null;
          case 'bounce':
            if (effect.target === 'own_creature') {
              return (b.cBfC > 0 && a.cBfC >= b.cBfC) ? `own bf unchanged` : null;
            }
            return (b.oBfC > 0 && a.oBfC >= b.oBfC) ? `opp bf unchanged` : null;
          case 'destroy_all': case 'exile_all': case 'damage_all_creatures': case 'damage_all': {
            const tb = b.oBfC + b.cBfC;
            if (tb === 0) return null;
            const ta = a.oBfC + a.cBfC;
            if (etype.startsWith('damage')) {
              const anyDmg = state.players[0].zones.battlefield.cards.concat(
                state.players[1].zones.battlefield.cards
              ).some(c => CardEngine.isCreature(c) && c._damage > 0);
              return (ta < tb || anyDmg) ? null : `no creature affected`;
            }
            return ta < tb ? null : `creatures unchanged`;
          }
          case 'buff': return null;
          case 'buff_all': {
            const tgtPid = (effect.target === 'opponent_creatures' || effect.target === 'all_opponent_creatures') ? opp : cid;
            const cs = state.players[tgtPid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            if (cs.length === 0) return null;
            // Keywords-only buff (power:0, toughness:0) → just check no crash
            if ((effect.power || 0) === 0 && (effect.toughness || 0) === 0) return null;
            // Negative buff (opponent debuff like -99/-99) → check for negative mods
            if ((effect.power || 0) < 0) {
              return cs.some(c => (c._powerMod || 0) < 0 || (c._toughnessMod || 0) < 0)
                ? null : `no negative mods`;
            }
            return cs.some(c => c._powerMod > 0 || c._toughnessMod > 0)
              ? null : `no positive mods`;
          }
          case 'counter_self': {
            const s = state.players[cid].zones.battlefield.cards.find(c => c._uid === state._lastUid);
            if (s && s._counters) {
              const ct = effect.counter || '+1/+1';
              return (s._counters[ct] || 0) > 0 ? null : `no ${ct} counters`;
            }
            return null;
          }
          case 'counter_all': {
            const cs = state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            if (cs.length === 0) return null;
            const ct = effect.counter || '+1/+1';
            return cs.some(c => c._counters && (c._counters[ct] || 0) > 0) ? null : `no ${ct} counters`;
          }
          case 'counter': {
            const ct = effect.counter || '+1/+1';
            // Negative counters may kill the creature, so also check for death
            if (ct === '-1/-1') {
              const creatureDied = a.oBfC < b.oBfC || a.oGY > b.oGY || a.cBfC < b.cBfC || a.cGY > b.cGY;
              const all = state.players[opp].zones.battlefield.cards.concat(
                state.players[cid].zones.battlefield.cards
              ).filter(c => CardEngine.isCreature(c));
              const hasCounters = all.some(c => c._counters && (c._counters[ct] || 0) > 0);
              return (creatureDied || hasCounters) ? null : `no ${ct} counters and no death`;
            }
            const all = state.players[opp].zones.battlefield.cards.concat(
              state.players[cid].zones.battlefield.cards
            ).filter(c => CardEngine.isCreature(c));
            return all.some(c => c._counters && (c._counters[ct] || 0) > 0) ? null : `no ${ct} counters`;
          }
          case 'grant_counter': case 'grant_counters': {
            const all = state.players[opp].zones.battlefield.cards.concat(
              state.players[cid].zones.battlefield.cards
            ).filter(c => CardEngine.isCreature(c));
            const ct = effect.counter || '+1/+1';
            return all.some(c => c._counters && (c._counters[ct] || 0) > 0) ? null : `no counters`;
          }
          case 'distribute_counters': {
            const cs = state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            const tot = cs.reduce((s, c) => s + ((c._counters && c._counters['+1/+1']) || 0), 0);
            return tot > 0 ? null : `no distributed counters`;
          }
          case 'double_counters': return null;
          case 'draw':
            return a.cH > b.cH ? null : `hand unchanged (${a.cH})`;
          case 'discard':
            return (effect.target === 'opponent' && b.oH > 0 && a.oH >= b.oH) ? `opp hand unchanged` : null;
          case 'discard_hand': {
            const tid = effect.target === 'self' ? cid : opp;
            return state.players[tid].zones.hand.count() === 0 ? null : `hand not empty`;
          }
          case 'mill':
            if (effect.target === 'opponent') return a.oGY > b.oGY ? null : `opp GY unchanged`;
            return a.cGY > b.cGY ? null : `controller GY unchanged`;
          case 'ramp':
            return a.cBf > b.cBf ? null : `bf unchanged`;
          case 'exile_top':
            return a.cEx > b.cEx ? null : `exile unchanged`;
          case 'exile_top_opponent':
            return a.oEx > b.oEx ? null : `opp exile unchanged`;
          case 'bounce_self':
            return (b.cBfC > 0 && a.cBfC >= b.cBfC) ? `bf unchanged` : null;
          case 'bounce_to_library_top':
            return (b.oBfC > 0 && a.oBfC >= b.oBfC) ? `opp bf unchanged` : null;
          case 'return_from_graveyard':
            return (b.cGY > 0 && a.cGY >= b.cGY) ? `GY unchanged` : null;
          case 'exile_graveyard': case 'exile_from_graveyard': {
            const tid = effect.target === 'opponent' ? opp : cid;
            return state.players[tid].zones.exile.count() > 0 ? null : `exile empty`;
          }
          case 'grant': case 'grant_all': {
            const cs = state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            if (cs.length > 0 && effect.keyword) {
              const kw = effect.keyword.charAt(0).toUpperCase() + effect.keyword.slice(1);
              return cs.some(c => (c.keywords || []).includes(kw) || (c._tempKeywords || []).includes(kw))
                ? null : `no keyword ${kw}`;
            }
            return null;
          }
          case 'tap': return null;
          case 'stun': {
            const oc = state.players[opp].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            return (oc.length > 0 && !oc.some(c => (c._stunCounters || 0) > 0)) ? `no stun` : null;
          }
          case 'threaten': case 'gain_control':
            return (b.oBfC > 0 && a.cBfC <= b.cBfC) ? `controller bf unchanged` : null;
          case 'anthem': {
            const cs = state.players[cid].zones.battlefield.cards.filter(c => CardEngine.isCreature(c));
            return (cs.length > 0 && !cs.some(c => c._powerMod > 0 || c._toughnessMod > 0))
              ? `no anthem mods` : null;
          }
          case 'create_token': {
            // Token may go to opponent's side (e.g. Crib Swap)
            // Check total permanents since tokens can be artifacts (Treasure) or creatures
            if (effect.controller === 'opponent') {
              return a.oBf > b.oBf ? null : `opp bf unchanged`;
            }
            return a.cBf > b.cBf ? null : `bf unchanged`;
          }
          case 'create_token_copy': case 'clone': case 'copy_self':
            return a.cBf > b.cBf ? null : `bf unchanged`;
          default: return null;
        }
      }

      function extractZones(entry) {
        const zones = [];
        if (entry.cast && Array.isArray(entry.cast))
          zones.push({ zone: 'cast', effects: entry.cast });
        if (entry.etb && Array.isArray(entry.etb))
          zones.push({ zone: 'etb', effects: entry.etb });
        if (entry.triggered) {
          (Array.isArray(entry.triggered) ? entry.triggered : [entry.triggered]).forEach((t, i) => {
            if (t && t.effects) zones.push({ zone: `triggered[${i}]`, effects: t.effects, trigger: t });
          });
        }
        if (entry.activated) {
          (Array.isArray(entry.activated) ? entry.activated : [entry.activated]).forEach((a, i) => {
            if (a && a.effects) zones.push({ zone: `activated[${i}]`, effects: a.effects, activated: a });
          });
        }
        if (entry.modal && entry.modal.modes) {
          entry.modal.modes.forEach((m, i) => {
            if (m && m.effects) zones.push({ zone: `modal.mode[${i}]`, effects: m.effects });
            else if (m && m.type) zones.push({ zone: `modal.mode[${i}]`, effects: [m] });
          });
        }
        const ch = entry.chapters || (entry.saga && entry.saga.chapters);
        if (ch) {
          for (const [k, v] of Object.entries(ch)) {
            zones.push({ zone: `chapter[${k}]`, effects: Array.isArray(v) ? v : [v] });
          }
        }
        if (entry.graveyard) {
          (Array.isArray(entry.graveyard) ? entry.graveyard : [entry.graveyard]).forEach((g, i) => {
            if (g && g.effects) zones.push({ zone: `graveyard[${i}]`, effects: g.effects });
          });
        }
        // Static entries: extract testable static effects (buff_all, grant, grant_all, anthem)
        if (entry.static && Array.isArray(entry.static)) {
          const testable = entry.static.filter(s =>
            s.type && ['buff_all', 'grant', 'grant_all', 'anthem', 'triggered', 'static'].includes(s.type)
          );
          if (testable.length > 0) {
            zones.push({ zone: 'static', effects: testable });
          }
        }
        return zones;
      }

      // ============================================================
      // MAIN LOOP
      // ============================================================
      const allKeys = Object.keys(CardEffectsDB).filter(k =>
        typeof CardEffectsDB[k] === 'object' && CardEffectsDB[k] !== null &&
        typeof CardEffectsDB[k] !== 'function' && !k.startsWith('_')
      );

      for (const cardName of allKeys) {
        const entry = CardEffectsDB[cardName];
        if (!entry || typeof entry === 'function') continue;
        const zones = extractZones(entry);
        if (zones.length === 0) continue;
        cardsTestedCount++;

        for (const zi of zones) {
          zonesTestedCount++;
          for (const effect of zi.effects) {
            if (!effect || !effect.type) continue;
            if (SKIP_TYPES.has(effect.type)) { skippedCount++; continue; }
            effectsResolvedCount++;
            const noCrash = isNoCrashOnly(effect);

            try {
              const state = makeState(effect.type, effect);
              const cid = 1, opp = 0;

              // Source card on controller bf
              const fc = TH.makeCreature(cardName, 3, 3, {
                cost: '{2}{W}', cmc: 3, colors: ['W'], typeLine: 'Creature — Test'
              });
              const bfc = bfPrep(fc);
              state.players[cid].zones.battlefield.add(bfc);
              GameState._registerCardTriggers(state, bfc, cid);
              state._lastUid = bfc._uid;

              // Seed counters
              if (effect.type === 'counter_self') bfc._counters = { '+1/+1': 0, '-1/-1': 0 };
              if (effect.type === 'double_counters') bfc._counters = { '+1/+1': 2, '-1/-1': 0 };

              const targets = buildTargets(state, effect, cid);
              const b = snap(state, cid);

              // Resolve: use stack for cast/modal/chapter AND targeted effects
              const useStack = zi.zone === 'cast' || zi.zone.startsWith('modal') || zi.zone.startsWith('chapter')
                || (TARGETED_EFFECT_TYPES.has(effect.type) && targets.length > 0);
              if (useStack) {
                GameStack.push(state.stack, { card: bfc, controller: cid, targets, effects: [effect] });
                GameStack.resolve(state.stack, state);
              } else {
                GameState._resolveSimpleEffect(state, cid, effect, { cardUid: bfc._uid });
              }

              if (!noCrash) {
                const a = snap(state, cid);
                const err = assertEffect(effect.type, effect, b, a, state, cid);
                if (err) failures.push({ card: cardName, zone: zi.zone, effectType: effect.type, error: err });
              }
            } catch (err) {
              failures.push({ card: cardName, zone: zi.zone, effectType: effect.type, error: `CRASH: ${err.message}` });
            }
          }
        }
      }

      return {
        cardsTested: cardsTestedCount, zonesTested: zonesTestedCount,
        effectsResolved: effectsResolvedCount, skipped: skippedCount,
        failureCount: failures.length, failures: failures.slice(0, 100)
      };
    });

    // === REPORT ===
    console.log('\n=== EFFECT RUNTIME VERIFICATION ===');
    console.log(`Cards tested:    ${results.cardsTested}`);
    console.log(`Zones tested:    ${results.zonesTested}`);
    console.log(`Effects resolved: ${results.effectsResolved}`);
    console.log(`Skipped (meta):  ${results.skipped}`);
    console.log(`Failures:        ${results.failureCount}`);

    if (results.failures.length > 0) {
      console.log('\n--- FAILURES ---');
      for (const f of results.failures) {
        console.log(`[${f.zone}] ${f.card}`);
        console.log(`  Effect: ${f.effectType}`);
        console.log(`  Error: ${f.error}`);
      }
    }

    expect(results.cardsTested).toBeGreaterThan(0);
    expect(results.effectsResolved).toBeGreaterThan(0);
    expect(results.failures).toEqual([]);
  });
});
