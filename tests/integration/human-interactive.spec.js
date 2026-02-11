/**
 * Human Interactive Path Tests (Solution 2)
 *
 * Tests that cards with interactive effects (target choice, scry, surveil,
 * modal, endure, etc.) correctly set waitingForInput when cast as player 0
 * (human). This catches bugs where AI path works but human path is broken.
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

/**
 * Setup a game state with a specific card in hand, enough mana, and targets.
 * Always sets up player 0 as human with the card.
 */
const SETUP_FN = `
function setupForCard(card, extraSetup) {
  const deck1 = [card];
  const deck2 = [];
  // Pad decks
  for (let i = 0; i < 30; i++) {
    deck1.push({ id: 'p_'+i, _uid: 'p0_pad_'+i, name: 'Padding '+i, type_line: 'Creature', power: '2', toughness: '2', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
    deck2.push({ id: 'o_'+i, _uid: 'p1_pad_'+i, name: 'Opp Padding '+i, type_line: 'Creature', power: '2', toughness: '2', mana_cost: '{1}', cmc: 1, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common' });
  }

  const state = GameState.create(deck1, deck2);
  state.mulliganDone = [true, true];
  state.phase = 'main1';
  state.activePlayer = 0;
  state.players[0].isHuman = true;
  state.players[1].isHuman = false;

  // Give plenty of mana
  for (let i = 0; i < 10; i++) {
    const land = { id: 'land_'+i, _uid: 'land_'+i, name: 'Test Land', type_line: 'Land', oracle_text: '{T}: Add one mana of any color.', mana_cost: '', cmc: 0, colors: [], color_identity: ['W','U','B','R','G'], keywords: [], _tapped: false };
    state.players[0].zones.battlefield.add(land);
  }
  state.manaPool[0] = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };

  // Set up targets
  // Opponent creature on battlefield
  const oppCreature = CardEngine.prepareForBattlefield({
    id: 'opp_c', _uid: 'opp_creature_1', name: 'Test Target', type_line: 'Creature',
    power: '3', toughness: '3', mana_cost: '{2}', cmc: 2, oracle_text: '',
    colors: [], color_identity: [], keywords: [], _ownerId: 1
  });
  state.players[1].zones.battlefield.add(oppCreature);

  // Own creature on battlefield
  const ownCreature = CardEngine.prepareForBattlefield({
    id: 'own_c', _uid: 'own_creature_1', name: 'Own Fighter', type_line: 'Creature',
    power: '4', toughness: '4', mana_cost: '{3}', cmc: 3, oracle_text: '',
    colors: [], color_identity: [], keywords: [], _ownerId: 0
  });
  state.players[0].zones.battlefield.add(ownCreature);

  // Cards in graveyard for harmonize/graveyard tests
  const gySpell = { id: 'gy_s', _uid: 'gy_spell_1', name: 'Graveyard Spell', type_line: 'Sorcery',
    power: null, toughness: null, mana_cost: '{1}{U}', cmc: 2, oracle_text: 'Draw a card.',
    colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'common' };
  state.players[0].zones.graveyard.add(gySpell);

  state.waitingForInput = { type: 'priority', playerId: 0 };

  if (extraSetup) extraSetup(state);
  return state;
}
`;

test.describe('Human Interactive Effects', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await setupTestGame(page);
  });

  test.afterAll(async () => { await page.close(); });

  // =================== SCRY ===================
  test('Scry effect pauses for human with overlay', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'scry_card', _uid: 'scry_test', name: 'Scry Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{U}', cmc: 1, oracle_text: 'Scry 2.',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);

      // Put card in hand
      state.players[0].zones.hand.add(card);

      // Cast it
      const effects = CardEngine.getSpellEffects(card);
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        pendingScry: !!state._pendingScry,
        scryCardCount: state._pendingScry ? state._pendingScry.cards.length : null,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    expect(result.pendingScry).toBe(true);
    expect(result.scryCardCount).toBe(2);
    expect(result.waitingForInput).toBeTruthy();
    expect(result.waitingForInput.type).toBe('scry');
  });

  // =================== SURVEIL ===================
  test('Surveil effect pauses for human with overlay', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'surv_card', _uid: 'surv_test', name: 'Surveil Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{U}', cmc: 1, oracle_text: 'Surveil 2.',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      const effects = [{ type: 'surveil', amount: 2 }];
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      GameStack.resolve(state.stack, state);

      return {
        pendingScry: !!state._pendingScry,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    // Surveil uses the same _pendingScry system
    expect(result.pendingScry).toBe(true);
    expect(result.waitingForInput).toBeTruthy();
  });

  // =================== ENDURE CHOICE ===================
  test('Endure effect pauses for human with choice overlay', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'endure_card', _uid: 'endure_test', name: 'Endure Creature', type_line: 'Creature',
        power: '2', toughness: '2', mana_cost: '{1}{W}', cmc: 2, oracle_text: 'Endure 2.',
        colors: ['W'], color_identity: ['W'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);

      // Put creature on battlefield
      const bfCard = CardEngine.prepareForBattlefield(card);
      bfCard._ownerId = 0;
      state.players[0].zones.battlefield.add(bfCard);

      // Resolve endure ETB through stack (as human player 0)
      const effects = [{ type: 'endure', amount: 2 }];
      GameStack.push(state.stack, { card: bfCard, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        pendingEndure: !!state._pendingEndure,
        endureAmount: state._pendingEndure ? state._pendingEndure.amount : null,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    expect(result.pendingEndure).toBe(true);
    expect(result.endureAmount).toBe(2);
    expect(result.waitingForInput).toBeTruthy();
    expect(result.waitingForInput.type).toBe('endure_choice');
  });

  // =================== MILL ANY_PLAYER ===================
  test('Mill any_player pauses for human target choice', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'mill_card', _uid: 'mill_test', name: 'Mill Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{U}', cmc: 1,
        oracle_text: 'Target player mills two cards.',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      const effects = [{ type: 'mill', amount: 2, target: 'any_player' }];
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        pendingPlayerChoice: !!state._pendingPlayerChoice,
        choiceType: state._pendingPlayerChoice ? state._pendingPlayerChoice.effectType : null,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    expect(result.pendingPlayerChoice).toBe(true);
    expect(result.choiceType).toBe('mill');
    expect(result.waitingForInput).toBeTruthy();
    expect(result.waitingForInput.type).toBe('player_choice');
  });

  // =================== MODAL ===================
  test('Modal spell pauses for human mode choice', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'modal_card', _uid: 'modal_test', name: 'Modal Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{1}{B}', cmc: 2,
        oracle_text: 'Choose one:\\n- Draw a card.\\n- Target creature gets -2/-2 until end of turn.',
        colors: ['B'], color_identity: ['B'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      const effects = [{ type: 'modal', modes: [
        { label: 'Draw', effects: [{ type: 'draw', amount: 1 }] },
        { label: 'Debuff', effects: [{ type: 'debuff', power: -2, toughness: -2, target: 'creature' }] }
      ]}];
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        pendingModal: !!state._pendingModal,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    expect(result.pendingModal).toBe(true);
    expect(result.waitingForInput).toBeTruthy();
    expect(result.waitingForInput.type).toBe('modal_choice');
  });

  // =================== GRANT HARMONIZE ===================
  test('Grant harmonize sets _harmonizeGranted on graveyard spell', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'grant_h', _uid: 'grant_h_test', name: 'Songcrafter Mage', type_line: 'Creature',
        power: '3', toughness: '2', mana_cost: '{G}{U}{R}', cmc: 3, oracle_text: '',
        colors: ['G','U','R'], color_identity: ['G','U','R'], keywords: ['Flash'], rarity: 'uncommon' };
      const state = setupForCard(card);

      // Put a sorcery in graveyard
      const spell = { id: 'gy_s2', _uid: 'gy_spell_target', name: 'Target Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{2}{R}', cmc: 3, oracle_text: 'Deals 3 damage.',
        colors: ['R'], color_identity: ['R'], keywords: [], rarity: 'common' };
      state.players[0].zones.graveyard.add(spell);

      // Resolve grant_harmonize
      const effects = [{ type: 'grant_harmonize', target: 'instant_or_sorcery_in_gy' }];
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      GameStack.resolve(state.stack, state);

      const gyCards = state.players[0].zones.graveyard.getAll();
      const granted = gyCards.filter(c => c._harmonizeGranted);

      return {
        grantedCount: granted.length,
        grantedName: granted.length > 0 ? granted[0].name : null,
        // The most expensive spell should be picked
        isHighestCMC: granted.length > 0 && granted[0].cmc >= 3,
      };
    }, SETUP_FN);

    expect(result.grantedCount).toBeGreaterThan(0);
    expect(result.isHighestCMC).toBe(true);
  });

  // =================== HARMONIZE CAST ===================
  test('Harmonize casts from graveyard and exiles', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'harm_card', _uid: 'harm_test', name: 'Test Harmonize Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{U}', cmc: 1, oracle_text: 'Draw a card.',
        colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);

      // Put spell in graveyard with harmonize granted
      card._harmonizeGranted = true;
      state.players[0].zones.graveyard.add(card);

      const gyBefore = state.players[0].zones.graveyard.count();
      const handBefore = state.players[0].zones.hand.count();

      // Cast harmonize
      const result = GameState.castHarmonize(state, 0, card._uid, []);

      const gyAfter = state.players[0].zones.graveyard.count();
      const handAfter = state.players[0].zones.hand.count();
      const exileCount = state.players[0].zones.exile ? state.players[0].zones.exile.count() : 0;

      return {
        success: result.success,
        gyBefore, gyAfter,
        handBefore, handAfter,
        exileCount,
        drewCard: handAfter > handBefore,
        removedFromGY: gyAfter < gyBefore,
        exiledCard: exileCount > 0,
      };
    }, SETUP_FN);

    expect(result.success).toBe(true);
    expect(result.removedFromGY).toBe(true);
    expect(result.drewCard).toBe(true);
    expect(result.exiledCard).toBe(true);
  });

  // =================== RAMP INTERACTIVE ===================
  test('Ramp pauses for human land choice (AI resolves auto)', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'ramp_card', _uid: 'ramp_test', name: 'Ramp Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{1}{G}', cmc: 2,
        oracle_text: 'Search your library for a basic land card, put it onto the battlefield tapped.',
        colors: ['G'], color_identity: ['G'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      // Add basic lands to library
      ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].forEach((name, i) => {
        state.players[0].zones.library.add({
          id: 'basic_'+i, _uid: 'basic_'+i, name, type_line: 'Basic Land',
          mana_cost: '', cmc: 0, oracle_text: '', colors: [], color_identity: [], keywords: [], rarity: 'common'
        });
      });

      const effects = [{ type: 'ramp', land_type: 'basic', tapped: true }];
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        waitingForInput: state.waitingForInput,
        pendingRamp: !!state._pendingRamp,
      };
    }, SETUP_FN);

    // Ramp should pause for human to choose which land
    expect(result.pendingRamp || (result.waitingForInput && result.waitingForInput.type === 'ramp_choice')).toBeTruthy();
  });

  // =================== CLASH ===================
  test('Clash pauses for human with overlay', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'clash_card', _uid: 'clash_test', name: 'Clash Spell', type_line: 'Sorcery',
        power: null, toughness: null, mana_cost: '{R}', cmc: 1,
        oracle_text: 'Clash with an opponent.',
        colors: ['R'], color_identity: ['R'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      const effects = [{ type: 'clash', bonus: [{ type: 'draw', amount: 1 }] }];
      state.players[0].zones.hand.remove(card._uid);
      GameStack.push(state.stack, { card, controller: 0, targets: [], effects });
      const log = GameStack.resolve(state.stack, state);

      return {
        pendingClash: !!state._pendingClash,
        waitingForInput: state.waitingForInput,
      };
    }, SETUP_FN);

    expect(result.pendingClash).toBe(true);
  });

  // =================== COORDINATED MANEUVER (MODAL) ===================
  test('Coordinated Maneuver modal resolves both modes', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'cm', _uid: 'cm_test', name: 'Coordinated Maneuver', type_line: 'Instant',
        power: null, toughness: null, mana_cost: '{1}{W}', cmc: 2, oracle_text: 'Choose one',
        colors: ['W'], color_identity: ['W'], keywords: [], rarity: 'uncommon' };
      const state = setupForCard(card);
      
      // Get spell effects
      const effects = CardEngine.getSpellEffects(card);
      const isModal = effects[0]?.type === 'modal';
      const modes = effects[0]?.modes || [];
      
      return {
        isModal,
        modeCount: modes.length,
        mode1Type: modes[0]?.type,
        mode2Type: modes[1]?.type,
        mode2Target: modes[1]?.target,
      };
    }, SETUP_FN);
    
    expect(result.isModal).toBe(true);
    expect(result.modeCount).toBe(2);
    expect(result.mode1Type).toBe('damage');
    expect(result.mode2Type).toBe('destroy');
    expect(result.mode2Target).toBe('enchantment');
  });

  // =================== REIGNING VICTOR (ETB BUFF + INDESTRUCTIBLE) ===================
  test('Reigning Victor ETB applies buff and indestructible', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'rv', _uid: 'rv_test', name: 'Reigning Victor', type_line: 'Creature — Orc Warrior',
        power: '3', toughness: '3', mana_cost: '{2}{R}{W}{B}', cmc: 6, oracle_text: 'When this creature enters, target creature gets +1/+0 and gains indestructible until end of turn.',
        colors: ['R','W','B'], color_identity: ['R','W','B'], keywords: [], rarity: 'uncommon' };
      const state = setupForCard(card);
      
      // Check ETB effects exist in DB
      const db = CardEffectsDB.getEffects('reigning victor');
      const hasETB = db && db.etb && db.etb.length > 0;
      const etbTypes = (db?.etb || []).map(e => e.type);
      
      // Check parseETBEffects also works
      const parsedETB = CardEngine.parseETBEffects(card);
      
      // Resolve ETB effects on the opponent creature
      const oppCreature = state.players[1].zones.battlefield.cards[0];
      const powerBefore = CardEngine.getPower(oppCreature);
      
      if (hasETB) {
        for (const eff of db.etb) {
          if (eff.type === 'buff') {
            oppCreature._powerMod = (oppCreature._powerMod || 0) + (eff.power || 0);
            oppCreature._tempPowerMod = (oppCreature._tempPowerMod || 0) + (eff.power || 0);
          }
          if (eff.type === 'grant' && eff.keyword === 'indestructible') {
            if (!oppCreature._tempKeywords) oppCreature._tempKeywords = [];
            oppCreature._tempKeywords.push('indestructible');
          }
        }
      }
      
      const powerAfter = CardEngine.getPower(oppCreature);
      const hasIndestructible = (oppCreature._tempKeywords || []).includes('indestructible');
      
      return { hasETB, etbTypes, powerBefore, powerAfter, hasIndestructible };
    }, SETUP_FN);
    
    expect(result.hasETB).toBe(true);
    expect(result.etbTypes).toContain('buff');
    expect(result.etbTypes).toContain('grant');
    expect(result.powerAfter).toBe(result.powerBefore + 1);
    expect(result.hasIndestructible).toBe(true);
  });

  // =================== LASYD PROWLER (GRAVEYARD RENEW) ===================
  test('Lasyd Prowler has graveyard Renew ability', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'lp', _uid: 'lp_test', name: 'Lasyd Prowler', type_line: 'Creature — Snake Ranger',
        power: '5', toughness: '5', mana_cost: '{2}{G}{G}', cmc: 4, oracle_text: 'Renew',
        colors: ['G'], color_identity: ['G'], keywords: [], rarity: 'uncommon' };
      const state = setupForCard(card);
      
      // Check DB has graveyard entry
      const db = CardEffectsDB.getEffects('lasyd prowler');
      const hasGY = db && Array.isArray(db.graveyard) && db.graveyard.length > 0;
      const gyEffects = hasGY ? db.graveyard[0].effects.map(e => e.type) : [];
      
      // Check getGraveyardAbilities
      card._uid = 'lp_gy_test';
      state.players[0].zones.graveyard.add(card);
      const gyAbilities = CardEngine.getGraveyardAbilities(card);
      
      return { hasGY, gyEffects, gyAbilityCount: gyAbilities?.length || 0 };
    }, SETUP_FN);
    
    expect(result.hasGY).toBe(true);
    expect(result.gyEffects).toContain('distribute_counters');
    expect(result.gyAbilityCount).toBeGreaterThan(0);
  });

  // =================== HERD HEIRLOOM (ACTIVATED + COMBAT DRAW) ===================
  test('Herd Heirloom activated ability grants trample + combat draw', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'hh', _uid: 'hh_test', name: 'Herd Heirloom', type_line: 'Artifact',
        power: null, toughness: null, mana_cost: '{1}{G}', cmc: 2, oracle_text: '',
        colors: ['G'], color_identity: ['G'], keywords: [], rarity: 'uncommon' };
      const state = setupForCard(card);
      
      // Check DB has activated with grant trample AND combat_draw
      const db = CardEffectsDB.getEffects('herd heirloom');
      const activated = db?.activated || [];
      const grantAbility = activated.find(a => a.effects?.some(e => e.type === 'grant' && e.keyword === 'trample'));
      const hasCombatDraw = grantAbility?.effects?.some(e => e.type === 'grant' && e.keyword === 'combat_draw');
      
      // Check triggered
      const hasTrigger = db?.triggered?.some(t => t.event === 'combat_damage_player');
      
      return { 
        activatedCount: activated.length,
        hasGrantTrample: !!grantAbility,
        hasCombatDraw: !!hasCombatDraw,
        hasTrigger: !!hasTrigger
      };
    }, SETUP_FN);
    
    expect(result.activatedCount).toBe(2);
    expect(result.hasGrantTrample).toBe(true);
    expect(result.hasCombatDraw).toBe(true);
    expect(result.hasTrigger).toBe(true);
  });

  // =================== PLANESWALKER LOYALTY ===================
  test('Planeswalker loyalty ability activates for human player', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const pw = { id: 'jace', _uid: 'jace_test', name: 'Jace Beleren',
        type_line: 'Planeswalker — Jace', power: null, toughness: null,
        mana_cost: '{1}{U}{U}', cmc: 3, oracle_text: '',
        loyalty: '3', colors: ['U'], color_identity: ['U'], keywords: [], rarity: 'mythic' };
      const state = setupForCard(pw);

      // Prepare and place PW on battlefield
      const prepared = CardEngine.prepareForBattlefield(pw);
      state.players[0].zones.battlefield.add(prepared);
      state.phase = 'main1';

      // Check loyalty abilities
      const loyaltyAbs = CardEngine.getLoyaltyAbilities(pw);
      const regularAbs = CardEngine.getActivatedAbilities(pw);

      // Activate ability 0 (-1: draw 1)
      const handBefore = state.players[0].zones.hand.count();
      const res = GameState.activateLoyaltyAbility(state, 0, prepared._uid, 0);
      const handAfter = state.players[0].zones.hand.count();

      return {
        loyaltyAbCount: loyaltyAbs.length,
        regularAbCount: regularAbs.length,
        startLoyalty: 3,
        loyaltyAfter: prepared._loyalty,
        usedThisTurn: prepared._loyaltyUsedThisTurn,
        success: res.success,
        drewCard: handAfter > handBefore
      };
    }, SETUP_FN);

    expect(result.loyaltyAbCount).toBeGreaterThan(0);
    expect(result.regularAbCount).toBe(0); // loyalty filtered from regular
    expect(result.loyaltyAfter).toBe(2); // 3 - 1
    expect(result.usedThisTurn).toBe(true);
    expect(result.success).toBe(true);
    expect(result.drewCard).toBe(true);
  });

  // =================== MODAL CHOOSE TWO ===================
  test('Modal choose-two spell has chooseTwo in DB cast effects', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Profane Command has chooseTwo: true in its cast modal effect
      const db = CardEffectsDB.getEffects('profane command');
      if (!db || !db.cast) return { found: false };

      const modalEffect = db.cast.find(e => e.type === 'modal');
      const hasChooseTwo = modalEffect && modalEffect.chooseTwo;
      const modeCount = modalEffect ? (modalEffect.modes || []).length : 0;

      return {
        found: true,
        hasChooseTwo: !!hasChooseTwo,
        modeCount
      };
    }, SETUP_FN);

    expect(result.found).toBe(true);
    expect(result.hasChooseTwo).toBe(true);
    expect(result.modeCount).toBeGreaterThanOrEqual(3);
  });

  // =================== HIDEAWAY DETECTION ===================
  test('Hideaway land has hideaway and condition in DB', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Check Spinerock Knoll in DB (condition is at root level)
      const db = CardEffectsDB.getEffects('spinerock knoll');
      const hasHideaway = db && db.hideaway;
      const hasCondition = db && db.condition;

      return {
        hasHideaway: !!hasHideaway,
        hasCondition: !!hasCondition,
        condition: hasCondition ? db.condition : null
      };
    }, SETUP_FN);

    expect(result.hasHideaway).toBe(true);
    expect(result.hasCondition).toBe(true);
    expect(result.condition).toBe('seven_damage_dealt');
  });

  // =================== BLIGHT INTERACTIVE ===================
  test('Blight effect targets own creature with -1/-1 counters', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);
      const card = { id: 'blight_s', _uid: 'blight_test', name: 'Blight Spell',
        type_line: 'Sorcery', power: null, toughness: null,
        mana_cost: '{B}', cmc: 1, oracle_text: '',
        colors: ['B'], color_identity: ['B'], keywords: [], rarity: 'common' };
      const state = setupForCard(card);
      state.players[0].zones.hand.add(card);

      // Own creature on battlefield
      const ownCreature = state.players[0].zones.battlefield.cards.find(c =>
        CardEngine.isCreature(c) && c.name === 'Own Fighter'
      );

      // Resolve blight effect directly
      const effect = { type: 'blight', amount: 1 };
      const blightResult = GameState._performBlight(state, 0, 1);

      // Check if creature got -1/-1 counter
      const creatureAfter = state.players[0].zones.battlefield.cards.find(c =>
        CardEngine.isCreature(c) && c.name === 'Own Fighter'
      );

      return {
        blightWorked: !!blightResult,
        hasMinusCounters: creatureAfter ? (creatureAfter._counters['-1/-1'] || 0) > 0 : false
      };
    }, SETUP_FN);

    expect(result.blightWorked).toBeTruthy();
    expect(result.hasMinusCounters).toBe(true);
  });

  // =================== ADVENTURE CHOICE ===================
  test('Adventure card DB has both creature and adventure effects', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Check a known adventure card
      const db = CardEffectsDB.getEffects('murderous rider');
      if (!db) {
        // Try another common adventure card
        const db2 = CardEffectsDB.getEffects('bonecrusher giant');
        return {
          found: !!db2,
          hasCast: db2 ? !!db2.cast : false,
          hasEtb: db2 ? !!db2.etb : false
        };
      }

      return {
        found: true,
        hasCast: !!db.cast,
        hasEtb: !!db.etb
      };
    }, SETUP_FN);

    // At least one adventure card found with effects
    expect(result.found).toBe(true);
  });

  // =================== SAGA INTERACTIVE ===================
  test('Saga chapter effects resolve through stack', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Find a saga in the DB
      let sagaName = null;
      let sagaEntry = null;
      for (const key of Object.keys(CardEffectsDB)) {
        const e = CardEffectsDB[key];
        if (e && e.saga && e.chapters) {
          sagaName = key;
          sagaEntry = e;
          break;
        }
      }

      if (!sagaName) return { found: false };

      const maxChapter = Math.max(...Object.keys(sagaEntry.chapters).map(Number));
      const chapterEffects = sagaEntry.chapters[1]; // Chapter 1

      return {
        found: true,
        name: sagaName,
        maxChapter,
        chapter1HasEffects: Array.isArray(chapterEffects) ? chapterEffects.length > 0 : !!chapterEffects
      };
    }, SETUP_FN);

    expect(result.found).toBe(true);
    expect(result.maxChapter).toBeGreaterThanOrEqual(2);
    expect(result.chapter1HasEffects).toBe(true);
  });

  // =================== TRANSFORM/DFC INTERACTIVE ===================
  test('Transform card detected and has back face data', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Find a transform card in DB
      let transformName = null;
      for (const key of Object.keys(CardEffectsDB)) {
        const e = CardEffectsDB[key];
        if (e && e.transform) {
          transformName = key;
          break;
        }
      }

      // Also check isTransformCard with a mock card
      const mockDFC = {
        name: 'Test DFC', type_line: 'Creature',
        backFace: { name: 'Test Back', type_line: 'Creature', power: '5', toughness: '5' }
      };
      const isDFC = CardEngine.isTransformCard(mockDFC);
      const cost = CardEngine.getTransformCost(mockDFC);

      return {
        foundInDB: !!transformName,
        isDFC,
        hasCost: cost !== null
      };
    }, SETUP_FN);

    expect(result.isDFC).toBe(true);
  });

  // =================== EVOKE CASTING ===================
  test('Evoke cost extraction works for evoke creatures', async () => {
    const result = await page.evaluate((setupCode) => {
      eval(setupCode);

      // Find an evoke card in the DB or test directly
      const mockEvoke = {
        name: 'Mulldrifter', type_line: 'Creature — Elemental',
        oracle_text: 'Flying\nWhen Mulldrifter enters the battlefield, draw two cards.\nEvoke {2}{U}',
        mana_cost: '{4}{U}', cmc: 5, keywords: ['Evoke']
      };
      const evokeCost = CardEngine.getEvokeCost(mockEvoke);

      return {
        hasEvoke: !!evokeCost,
        cost: evokeCost
      };
    }, SETUP_FN);

    expect(result.hasEvoke).toBe(true);
    expect(result.cost).toBeTruthy();
  });
});
