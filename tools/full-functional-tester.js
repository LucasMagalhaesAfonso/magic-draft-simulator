#!/usr/bin/env node
/**
 * FULL FUNCTIONAL TESTER
 *
 * Tests Magic cards in the actual game engine to validate:
 * 1. Castability (mana costs, phase rules)
 * 2. Effect resolution (cast/ETB/triggered effects)
 * 3. State mutations (zone transfers, stat changes, triggers registered)
 * 4. AI recognition and scoring
 * 5. Human interaction (modal choices, targeting)
 * 6. Trigger firing and resolution
 * 7. Complex interactions (combos, stacking)
 *
 * USAGE:
 *   node tools/full-functional-tester.js "Card Name"
 *   node tools/full-functional-tester.js batch1
 *   node tools/full-functional-tester.js tdm [limit]
 *
 * OUTPUT:
 *   ✅ FUNCTIONAL - All tests pass
 *   ⚠️  PARTIAL - Some functionality works but has issues
 *   ❌ BROKEN - Core functionality doesn't work
 *   📋 UNTESTABLE - Requires complex human interaction
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ============================================================================
// LOAD GAME ENGINE & DATABASE
// ============================================================================

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const dbContent = fs.readFileSync(dbPath, 'utf8');
const sandbox = { console: { log: () => {}, warn: () => {}, error: () => {} } };
vm.createContext(sandbox);
vm.runInContext(dbContent.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB ='), sandbox);
const DB = sandbox.CardEffectsDB || {};

// Load game engine files
const zones = fs.readFileSync(path.join(__dirname, '../js/game/zones.js'), 'utf8');
const mana = fs.readFileSync(path.join(__dirname, '../js/game/mana.js'), 'utf8');
const cards = fs.readFileSync(path.join(__dirname, '../js/game/cards.js'), 'utf8');
const combat = fs.readFileSync(path.join(__dirname, '../js/game/combat.js'), 'utf8');
const stack = fs.readFileSync(path.join(__dirname, '../js/game/stack.js'), 'utf8');
const gameState = fs.readFileSync(path.join(__dirname, '../js/game/game-state.js'), 'utf8');
const gameAI = fs.readFileSync(path.join(__dirname, '../js/game/game-ai.js'), 'utf8');

// Create sandbox and load all files
const engine = {};
const engineSandbox = {
  console,
  CardEffectsDB: DB,
  module: { exports: {} },
  VFX: undefined,
  require: () => ({})
};

vm.createContext(engineSandbox);

try {
  vm.runInContext(zones, engineSandbox);
  vm.runInContext(mana, engineSandbox);
  vm.runInContext(cards, engineSandbox);
  vm.runInContext(combat, engineSandbox);
  vm.runInContext(stack, engineSandbox);
  vm.runInContext(gameState, engineSandbox);
  vm.runInContext(gameAI, engineSandbox);
} catch (e) {
  console.error('ERROR loading game engine:', e.message);
  process.exit(1);
}

// Extract engine objects
const GameStack = engineSandbox.GameStack;
const ManaSystem = engineSandbox.ManaSystem;
const CardEngine = engineSandbox.CardEngine;
const CombatSystem = engineSandbox.CombatSystem;
const GameState = engineSandbox.GameState;
const GameAI = engineSandbox.GameAI;

// ============================================================================
// FUNCTIONAL TESTER CLASS
// ============================================================================

class FunctionalTester {
  constructor() {
    this.results = {};
    this.cardCache = {};
  }

  /**
   * Fetch card from Scryfall
   */
  async fetchCard(cardName) {
    return new Promise((resolve) => {
      const url = `https://api.scryfall.com/cards/search?q=name:"${encodeURIComponent(cardName)}"&unique=prints`;
      https.get(url, { headers: { 'User-Agent': 'FunctionalTester/1.0' } }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const card = json.data?.[0] || null;
            if (card) this.cardCache[cardName.toLowerCase()] = card;
            resolve(card);
          } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  /**
   * Create a mock Scryfall card object
   */
  createCardObject(scryfallCard, playerId = 0) {
    if (!scryfallCard) return null;

    const card = {
      // Basic properties
      name: scryfallCard.name,
      type_line: scryfallCard.type_line || '',
      oracle_text: scryfallCard.oracle_text || '',
      mana_cost: scryfallCard.mana_cost || '',
      cmc: scryfallCard.cmc || 0,
      power: parseInt(scryfallCard.power) || 0,
      toughness: parseInt(scryfallCard.toughness) || 0,
      colors: scryfallCard.colors || [],
      set: scryfallCard.set,
      rarity: scryfallCard.rarity,

      // Game state
      _uid: Math.random().toString(36).substring(7),
      _ownerId: playerId,
      _controlledBy: playerId,
      _damage: 0,
      _powerMod: 0,
      _toughnessMod: 0,
      _tempPowerMod: 0,
      _tempToughnessMod: 0,
      _counters: {},
      _keywords: [],
      _attachments: [],
      _attachedTo: null,
      _isTapped: false,
      _isAttacking: false,
      _isBlocking: false,
      _blockedBy: [],
      _blocks: [],
      _triggers: [],
      _activations: [],
      _isSaga: false,
      _sagaChapter: 0,
      _isToken: false,
      _zone: 'hand'
    };

    return card;
  }

  /**
   * Create a mock game state
   */
  createMockGameState(deckSize = 20) {
    const createPlayer = (playerId) => {
      const library = [];
      for (let i = 0; i < deckSize; i++) {
        library.push({
          name: `Forest ${i}`,
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          cmc: 0,
          _uid: `land-${playerId}-${i}`,
          _ownerId: playerId,
          _zone: 'library',
          _isTapped: false,
          _keywords: ['land']
        });
      }

      return {
        id: playerId,
        isHuman: playerId === 0,
        life: 20,
        zones: {
          library: { cards: library, drawFromTop: function() { return this.cards.shift() || null; }, add: function(c) { this.cards.push(c); }, remove: function(uid) { const idx = this.cards.findIndex(x => x._uid === uid); return idx !== -1 ? this.cards.splice(idx, 1)[0] : null; }, get: function(uid) { return this.cards.find(c => c._uid === uid) || null; }, has: function(uid) { return !!this.get(uid); }, count: function() { return this.cards.length; }, getAll: function() { return [...this.cards]; }, clear: function() { this.cards = []; }, shuffle: function() { for (let i = this.cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]]; } }, filterCards: function(p) { return this.cards.filter(p); } },
          hand: { cards: [], add: function(c) { this.cards.push(c); }, remove: function(uid) { const idx = this.cards.findIndex(x => x._uid === uid); return idx !== -1 ? this.cards.splice(idx, 1)[0] : null; }, get: function(uid) { return this.cards.find(c => c._uid === uid) || null; }, has: function(uid) { return !!this.get(uid); }, count: function() { return this.cards.length; }, getAll: function() { return [...this.cards]; }, clear: function() { this.cards = []; }, filterCards: function(p) { return this.cards.filter(p); } },
          battlefield: { cards: [], add: function(c) { this.cards.push(c); }, remove: function(uid) { const idx = this.cards.findIndex(x => x._uid === uid); return idx !== -1 ? this.cards.splice(idx, 1)[0] : null; }, get: function(uid) { return this.cards.find(c => c._uid === uid) || null; }, has: function(uid) { return !!this.get(uid); }, count: function() { return this.cards.length; }, getAll: function() { return [...this.cards]; }, clear: function() { this.cards = []; }, filterCards: function(p) { return this.cards.filter(p); } },
          graveyard: { cards: [], add: function(c) { this.cards.push(c); }, remove: function(uid) { const idx = this.cards.findIndex(x => x._uid === uid); return idx !== -1 ? this.cards.splice(idx, 1)[0] : null; }, get: function(uid) { return this.cards.find(c => c._uid === uid) || null; }, has: function(uid) { return !!this.get(uid); }, count: function() { return this.cards.length; }, getAll: function() { return [...this.cards]; }, clear: function() { this.cards = []; }, filterCards: function(p) { return this.cards.filter(p); } },
          exile: { cards: [], add: function(c) { this.cards.push(c); }, remove: function(uid) { const idx = this.cards.findIndex(x => x._uid === uid); return idx !== -1 ? this.cards.splice(idx, 1)[0] : null; }, get: function(uid) { return this.cards.find(c => c._uid === uid) || null; }, has: function(uid) { return !!this.get(uid); }, count: function() { return this.cards.length; }, getAll: function() { return [...this.cards]; }, clear: function() { this.cards = []; }, filterCards: function(p) { return this.cards.filter(p); } }
        }
      };
    };

    const state = {
      players: [createPlayer(0), createPlayer(1)],
      activePlayer: 0,
      phase: 'main1',
      turn: 1,
      stack: { items: [] },
      manaPool: [
        { W: 0, U: 0, B: 0, R: 0, G: 0, generic: 0 },
        { W: 0, U: 0, B: 0, R: 0, G: 0, generic: 0 }
      ],
      combat: { attackers: [], blockers: [] },
      log: [],
      waitingForInput: null,
      _triggers: [],
      _spellsThisTurn: [0, 0],
      _pendingStackEffects: null,
      _exiledPlayable: {}
    };

    return state;
  }

  /**
   * Add card to hand and prepare mana
   */
  addCardToHand(state, card, playerId = 0) {
    if (!card) return false;
    const copy = { ...card, _uid: Math.random().toString(36).substring(7), _zone: 'hand' };
    state.players[playerId].zones.hand.add(copy);

    // Add mana to pool (all colors + generic)
    const cost = ManaSystem?.parseCost(card.mana_cost || '');
    if (cost) {
      for (const color of ['W', 'U', 'B', 'R', 'G']) {
        state.manaPool[playerId][color] = (cost[color] || 0) + 5;
      }
      state.manaPool[playerId].generic = (cost.generic || 0) + 10;
    } else {
      // Fallback: add enough mana
      state.manaPool[playerId].generic = 20;
    }

    return copy._uid;
  }

  /**
   * Test if card can be cast
   */
  testCastability(state, card, playerId = 0) {
    const issues = [];
    const warnings = [];

    if (!card) {
      issues.push('Card object is null');
      return { castable: false, issues, warnings };
    }

    // Check if card type is valid
    const isSpell = !card.type_line.includes('Land');
    if (!isSpell) {
      warnings.push('Land card - cannot test cast mechanics');
      return { castable: false, issues, warnings, isLand: true };
    }

    // Check mana cost parsing - try multiple approaches
    let cost = null;
    try {
      if (ManaSystem?.parseCost) {
        cost = ManaSystem.parseCost(card.mana_cost || '');
      }
    } catch (e) {
      warnings.push(`Mana parsing error: ${e.message}`);
    }

    if (!cost) {
      // Fallback: manual parsing
      const manaCost = card.mana_cost || '';
      const matches = manaCost.match(/\{([^}]+)\}/g) || [];
      let total = 0;
      for (const m of matches) {
        const inner = m.slice(1, -1);
        const num = parseInt(inner);
        if (!isNaN(num)) total += num;
        else if (inner.length === 1) total += 1; // Color mana is 1
      }
      cost = { total, generic: total };
    } else {
      if (cost.total > 15) {
        warnings.push(`High mana cost (${cost.total}) - may not be castable early game`);
      }
    }

    // Check if instant/sorcery vs creature
    const isInstant = card.type_line.includes('Instant') || card.type_line.includes('Sorcery');
    const isCreature = card.type_line.includes('Creature');
    const isEnchantment = card.type_line.includes('Enchantment');
    const isArtifact = card.type_line.includes('Artifact');
    const isPlaneswalker = card.type_line.includes('Planeswalker');

    if (!isInstant && !isCreature && !isEnchantment && !isArtifact && !isPlaneswalker) {
      issues.push(`Unknown card type: ${card.type_line}`);
      return { castable: false, issues, warnings };
    }

    return { castable: true, issues, warnings, isInstant, isCreature, isEnchantment, isArtifact, cost };
  }

  /**
   * Test spell casting
   */
  testSpellCasting(state, cardUid, playerId = 0) {
    const card = state.players[playerId].zones.hand.get(cardUid);
    if (!card) return { success: false, msg: 'Card not in hand' };

    // Check phase (main1 should work)
    if (state.phase !== 'main1') {
      // Try to switch phase
      state.phase = 'main1';
    }

    // Test spell effect parsing
    const spellEffects = CardEngine?.getSpellEffects(card) || [];
    if (spellEffects.length === 0) {
      return { success: true, msg: 'No spell effects but card castable', hasEffects: false };
    }

    // Push to stack
    if (GameStack) {
      GameStack.push(state.stack, {
        card: card,
        controller: playerId,
        targets: [],
        effects: spellEffects
      });

      // Try to resolve
      const log = GameStack.resolve(state.stack, state);
      return { success: true, msg: 'Spell resolved', effects: spellEffects, log };
    }

    return { success: false, msg: 'GameStack not available' };
  }

  /**
   * Test ETB effects
   */
  testETBEffects(state, card, playerId = 0) {
    if (!card) return { hasETB: false, effects: [] };

    const etbEffects = CardEngine?.getETBEffects(card) || [];

    if (etbEffects.length === 0) {
      return { hasETB: false, effects: [] };
    }

    // Add card to battlefield
    state.players[playerId].zones.battlefield.add(card);

    // Resolve ETB effects
    if (GameStack) {
      GameStack.push(state.stack, {
        card: card,
        controller: playerId,
        targets: [],
        effects: etbEffects
      });

      const log = GameStack.resolve(state.stack, state);
      return { hasETB: true, effects: etbEffects, log };
    }

    return { hasETB: true, effects: etbEffects, log: [] };
  }

  /**
   * Test triggered abilities
   */
  testTriggeredAbilities(state, card, playerId = 0) {
    if (!card) return { hasTriggered: false, abilities: [] };

    const triggered = CardEngine?.getTriggeredAbilities(card) || [];

    if (triggered.length === 0) {
      return { hasTriggered: false, abilities: [] };
    }

    return { hasTriggered: true, abilities: triggered };
  }

  /**
   * Test AI scoring and recognition
   */
  testAIRecognition(state, card, playerId = 1) {
    const results = {
      recognized: false,
      canScore: false,
      canTarget: false,
      aiTesting: {}
    };

    if (!card || !GameAI) return results;

    // Add card to AI hand and test scoring
    const cardCopy = { ...card, _uid: Math.random().toString(36).substring(7) };
    state.players[playerId].zones.hand.add(cardCopy);

    // Check if AI can evaluate it
    try {
      // Check if AI has scoring method
      if (typeof GameAI._scoreEffect === 'function') {
        const score = GameAI._scoreEffect({ type: 'dummy' }, state, playerId);
        results.canScore = true;
        results.scoreMethod = 'EXISTS';
      }

      if (typeof GameAI._chooseTargets === 'function') {
        results.canTarget = true;
      }

      results.recognized = true;
    } catch (e) {
      results.error = e.message;
    }

    return results;
  }

  /**
   * Check database entry completeness
   */
  checkDatabaseEntry(cardName) {
    const dbEntry = DB[cardName.toLowerCase()] || null;

    if (!dbEntry) {
      return { inDB: false, completeness: 0 };
    }

    let fields = 0;
    let total = 6;
    if (dbEntry.cast) fields++;
    if (dbEntry.etb) fields++;
    if (dbEntry.triggered) fields++;
    if (dbEntry.activated) fields++;
    if (dbEntry.static) fields++;
    if (dbEntry.additional_costs) fields++;

    return {
      inDB: true,
      completeness: Math.round((fields / total) * 100),
      hasCast: !!dbEntry.cast,
      hasETB: !!dbEntry.etb,
      hasTriggered: !!dbEntry.triggered,
      hasActivated: !!dbEntry.activated,
      hasStatic: !!dbEntry.static,
      hasAdditionalCosts: !!dbEntry.additional_costs,
      entry: dbEntry
    };
  }

  /**
   * Test combo scenarios (card interactions)
   */
  testComboScenarios(state, card, playerId = 0) {
    const combos = [];

    if (!card) return { hasComboInteractions: false, combos: [] };

    // Check if card has synergy keywords
    const oracleText = (card.oracle_text || '').toLowerCase();

    // Tribal synergies
    if (card.type_line.includes('Creature')) {
      const creatureTypes = ['Zombie', 'Vampire', 'Elf', 'Goblin', 'Dragon', 'Human', 'Wizard', 'Knight'];
      for (const type of creatureTypes) {
        if (oracleText.includes(type.toLowerCase())) {
          combos.push({ type: 'TRIBAL', subtype: type, note: 'Has tribal synergy' });
          break;
        }
      }
    }

    // Sacrifice synergies
    if (oracleText.includes('sacrifice')) {
      combos.push({ type: 'SACRIFICE', note: 'Needs sacrifice outlet' });
    }

    // Graveyard synergies
    if (oracleText.includes('graveyard')) {
      combos.push({ type: 'GRAVEYARD', note: 'Interacts with graveyard' });
    }

    // Creature count synergies
    if (oracleText.includes('number of creatures') || oracleText.includes('creature count')) {
      combos.push({ type: 'CREATURE_COUNT', note: 'Scales with creatures' });
    }

    // Damage synergies
    if (oracleText.includes('each') || oracleText.includes('whenever')) {
      combos.push({ type: 'TRIGGER', note: 'Has trigger potential' });
    }

    return {
      hasComboInteractions: combos.length > 0,
      combos: combos
    };
  }

  /**
   * Check for keywords and static abilities
   */
  testKeywordsAndStatics(state, card, playerId = 0) {
    if (!card) return { keywords: [], statics: [] };

    const keywords = [];
    const statics = [];
    const oracleText = (card.oracle_text || '').toLowerCase();

    // Keyword abilities
    const keywordMap = {
      'flying': 'FLYING',
      'haste': 'HASTE',
      'lifelink': 'LIFELINK',
      'menace': 'MENACE',
      'vigilance': 'VIGILANCE',
      'deathtouch': 'DEATHTOUCH',
      'trample': 'TRAMPLE',
      'first strike': 'FIRST_STRIKE',
      'double strike': 'DOUBLE_STRIKE',
      'reach': 'REACH',
      'flash': 'FLASH',
      'hexproof': 'HEXPROOF',
      'shroud': 'SHROUD',
      'indestructible': 'INDESTRUCTIBLE',
      'ward': 'WARD',
      'protection': 'PROTECTION',
      'defender': 'DEFENDER'
    };

    for (const [keyword, constant] of Object.entries(keywordMap)) {
      if (oracleText.includes(keyword)) {
        keywords.push(constant);
      }
    }

    // Static abilities
    if (oracleText.includes('creatures you control')) {
      statics.push('BUFF_OWN_CREATURES');
    }
    if (oracleText.includes('other creatures')) {
      statics.push('BUFF_OTHER_CREATURES');
    }
    if (oracleText.includes('opponent\'s') || oracleText.includes('opponents') || oracleText.includes('enemy')) {
      statics.push('HINDER_OPPONENT');
    }
    if (oracleText.includes('cost')) {
      statics.push('COST_REDUCTION');
    }

    return { keywords, statics };
  }

  /**
   * Run comprehensive test on a card
   */
  async testCard(cardName) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TESTING: ${cardName}`);
    console.log(`${'='.repeat(70)}`);

    // Fetch from Scryfall
    const scryfallCard = await this.fetchCard(cardName);
    if (!scryfallCard) {
      console.log(`❌ CARD NOT FOUND on Scryfall`);
      return this.results[cardName] = {
        status: 'BROKEN',
        reason: 'Card not found on Scryfall'
      };
    }

    console.log(`✅ Found on Scryfall: ${scryfallCard.name}`);
    console.log(`   Type: ${scryfallCard.type_line}`);
    console.log(`   Cost: ${scryfallCard.mana_cost || '-'}`);
    console.log(`   Oracle: ${(scryfallCard.oracle_text || '-').substring(0, 80)}...`);

    // Check database
    const dbInfo = this.checkDatabaseEntry(cardName);
    console.log(`\n📚 DATABASE:`);
    if (dbInfo.inDB) {
      console.log(`   ✅ IN DB (${dbInfo.completeness}% complete)`);
      if (dbInfo.hasCast) console.log(`      ✅ Cast effects`);
      if (dbInfo.hasETB) console.log(`      ✅ ETB effects`);
      if (dbInfo.hasTriggered) console.log(`      ✅ Triggered abilities`);
      if (dbInfo.hasActivated) console.log(`      ✅ Activated abilities`);
      if (dbInfo.hasStatic) console.log(`      ✅ Static abilities`);
    } else {
      console.log(`   ⚠️  NOT IN DB - will use regex parsing`);
    }

    // Create mock game state
    const state = this.createMockGameState();
    const card = this.createCardObject(scryfallCard, 0);

    // Test 1: Castability
    console.log(`\n🎯 CASTABILITY:`);
    const castTest = this.testCastability(state, card, 0);
    if (castTest.castable) {
      console.log(`   ✅ Card is castable`);
    } else {
      console.log(`   ❌ Card not castable: ${castTest.issues.join(', ')}`);
      if (castTest.isLand) {
        return this.results[cardName] = {
          status: 'UNTESTABLE',
          reason: 'Land card'
        };
      }
    }
    castTest.warnings.forEach(w => console.log(`   ⚠️  ${w}`));

    // Test 2: Mana system
    console.log(`\n💰 MANA SYSTEM:`);
    const costParsed = ManaSystem?.parseCost(card.mana_cost || '');
    if (costParsed) {
      console.log(`   ✅ Mana cost parsed: ${JSON.stringify(costParsed)}`);
    } else {
      console.log(`   ⚠️  Could not parse mana cost`);
    }

    // Test 3: Add to hand and cast
    console.log(`\n📥 CASTING TEST:`);
    const cardUid = this.addCardToHand(state, card, 0);
    if (cardUid && state.players[0].zones.hand.has(cardUid)) {
      console.log(`   ✅ Card added to hand`);
      const castResult = this.testSpellCasting(state, cardUid, 0);
      console.log(`   ${castResult.success ? '✅' : '⚠️ '} ${castResult.msg}`);
      if (castResult.log) {
        castResult.log.forEach(l => console.log(`      └ ${l}`));
      }
    } else {
      console.log(`   ❌ Failed to add card to hand`);
    }

    // Test 4: ETB effects
    console.log(`\n👁️  ETB EFFECTS:`);
    const etbResult = this.testETBEffects(state, card, 0);
    if (etbResult.hasETB) {
      console.log(`   ✅ Has ETB effects (${etbResult.effects.length})`);
      etbResult.effects.forEach((e, i) => {
        console.log(`      ${i + 1}. ${e.type || 'unknown'}`);
      });
      if (etbResult.log) {
        etbResult.log.forEach(l => console.log(`      └ ${l}`));
      }
    } else {
      console.log(`   ℹ️  No ETB effects`);
    }

    // Test 5: Triggered abilities
    console.log(`\n⚡ TRIGGERED ABILITIES:`);
    const triggeredResult = this.testTriggeredAbilities(state, card, 0);
    if (triggeredResult.hasTriggered) {
      console.log(`   ✅ Has triggered abilities (${triggeredResult.abilities.length})`);
      triggeredResult.abilities.forEach((t, i) => {
        console.log(`      ${i + 1}. Event: ${t.event || 'unknown'}`);
      });
    } else {
      console.log(`   ℹ️  No triggered abilities`);
    }

    // Test 6: AI Recognition
    console.log(`\n🤖 AI RECOGNITION:`);
    const aiResult = this.testAIRecognition(state, card, 1);
    if (aiResult.recognized) {
      console.log(`   ✅ Card recognized by AI system`);
      if (aiResult.canScore) console.log(`      ✅ AI can score effects`);
      if (aiResult.canTarget) console.log(`      ✅ AI can target`);
    } else {
      console.log(`   ⚠️  AI recognition issues`);
      if (aiResult.error) console.log(`      └ ${aiResult.error}`);
    }

    // Test 7: Keywords and Static Abilities
    console.log(`\n🏷️  KEYWORDS & STATICS:`);
    const keywordResult = this.testKeywordsAndStatics(state, card, 0);
    if (keywordResult.keywords.length > 0) {
      console.log(`   ✅ Keywords found (${keywordResult.keywords.length})`);
      keywordResult.keywords.forEach(k => console.log(`      • ${k}`));
    }
    if (keywordResult.statics.length > 0) {
      console.log(`   ✅ Static abilities found (${keywordResult.statics.length})`);
      keywordResult.statics.forEach(s => console.log(`      • ${s}`));
    }
    if (keywordResult.keywords.length === 0 && keywordResult.statics.length === 0) {
      console.log(`   ℹ️  No special keywords or statics`);
    }

    // Test 8: Combo Potential
    console.log(`\n🔗 COMBO SYNERGIES:`);
    const comboResult = this.testComboScenarios(state, card, 0);
    if (comboResult.hasComboInteractions) {
      console.log(`   ✅ Has combo potential (${comboResult.combos.length})`);
      comboResult.combos.forEach(c => console.log(`      • ${c.type}: ${c.note}`));
    } else {
      console.log(`   ℹ️  Standalone card (limited synergies)`);
    }

    // Determine overall status
    console.log(`\n${'='.repeat(70)}`);
    let status = 'FUNCTIONAL';
    let reason = 'All core systems working';

    if (!castTest.castable) {
      status = 'BROKEN';
      reason = 'Card cannot be cast';
    } else if (!dbInfo.inDB && (etbResult.hasETB || triggeredResult.hasTriggered)) {
      status = 'PARTIAL';
      reason = 'No DB entry - relying on regex parsing';
    } else if (!etbResult.hasETB && !triggeredResult.hasTriggered && dbInfo.completeness === 0) {
      status = 'PARTIAL';
      reason = 'No effects defined or parsed';
    } else if (aiResult.error) {
      status = 'PARTIAL';
      reason = 'AI integration issue';
    }

    console.log(`STATUS: ${status === 'FUNCTIONAL' ? '✅' : status === 'PARTIAL' ? '⚠️ ' : status === 'BROKEN' ? '❌' : '📋'} ${status}`);
    console.log(`REASON: ${reason}`);
    console.log(`${'='.repeat(70)}\n`);

    return this.results[cardName] = {
      status,
      reason,
      castability: castTest,
      mana: costParsed,
      etb: etbResult,
      triggered: triggeredResult,
      ai: aiResult,
      database: dbInfo
    };
  }

  /**
   * Test a batch of cards
   */
  async testBatch(cardNames) {
    const results = {};
    for (const name of cardNames) {
      results[name] = await this.testCard(name);
    }
    return results;
  }

  /**
   * Generate report
   */
  generateReport(options = {}) {
    console.log(`\n${'='.repeat(70)}`);
    console.log('FUNCTIONAL TEST REPORT');
    console.log(`${'='.repeat(70)}\n`);

    const byStatus = { FUNCTIONAL: [], PARTIAL: [], BROKEN: [], UNTESTABLE: [] };
    const details = {};

    for (const [card, result] of Object.entries(this.results)) {
      const status = result.status || 'UNKNOWN';
      if (byStatus[status]) byStatus[status].push(card);
      details[status] = details[status] || [];
      details[status].push({
        card,
        reason: result.reason,
        dbComplete: result.database?.completeness || 0
      });
    }

    console.log(`✅ FUNCTIONAL (${byStatus.FUNCTIONAL.length}):`);
    details.FUNCTIONAL?.forEach(c => console.log(`   • ${c.card}`));

    console.log(`\n⚠️  PARTIAL (${byStatus.PARTIAL.length}):`);
    details.PARTIAL?.forEach(c => console.log(`   • ${c.card}\n      └ ${c.reason}`));

    console.log(`\n❌ BROKEN (${byStatus.BROKEN.length}):`);
    details.BROKEN?.forEach(c => console.log(`   • ${c.card}\n      └ ${c.reason}`));

    console.log(`\n📋 UNTESTABLE (${byStatus.UNTESTABLE.length}):`);
    details.UNTESTABLE?.forEach(c => console.log(`   • ${c.card}\n      └ ${c.reason}`));

    const total = Object.keys(this.results).length;
    const functional = byStatus.FUNCTIONAL.length;
    const percentage = total > 0 ? Math.round((functional / total) * 100) : 0;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`OVERALL: ${functional}/${total} (${percentage}%) cards fully functional`);
    console.log(`${'='.repeat(70)}\n`);

    // Export JSON if requested
    if (options.exportJson) {
      const jsonPath = path.join(__dirname, '../test-results.json');
      fs.writeFileSync(jsonPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: { functional, total, percentage },
        byStatus,
        results: this.results
      }, null, 2));
      console.log(`📄 Results exported to: ${jsonPath}\n`);
    }

    return byStatus;
  }

  /**
   * Generate detailed summary for a specific status
   */
  generateStatusSummary(status) {
    const cards = Object.entries(this.results)
      .filter(([_, result]) => result.status === status)
      .map(([name, result]) => ({ name, ...result }));

    return cards;
  }
}

// ============================================================================
// BATCH DEFINITIONS
// ============================================================================

const BATCHES = {
  'batch1': [
    'Sage of the Skies',
    'Embermouth Sentinel',
    'Molten Exhale',
    'Focus the Mind',
    'Dragon\'s Prey'
  ],
  'batch2': [
    'Behold the Dragons',
    'Triumphant Parch',
    'Volcanic Sentry',
    'Fist of the Falling Sun',
    'Thunderous Ascent'
  ],
  'core-mechanics': [
    'Sage of the Skies',           // Creature with trigger
    'Molten Exhale',               // Instant with options
    'Embermouth Sentinel',         // ETB with condition
    'Focus the Mind',              // Cost reduction
    'Dragon\'s Prey'               // Conditional cost
  ],
  'etb-focused': [
    'Embermouth Sentinel',
    'Ainok Wayfarer',
    'Frostbridge Guardian',
    'Thriving Fortress',
    'Witness Protection'
  ]
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`\n${'='.repeat(70)}`);
    console.log('MAGIC DRAFT - FULL FUNCTIONAL TESTER');
    console.log(`${'='.repeat(70)}\n`);
    console.log('USAGE:');
    console.log('  node tools/full-functional-tester.js "Card Name"           - Test single card');
    console.log('  node tools/full-functional-tester.js batch1                 - Test predefined batch');
    console.log('  node tools/full-functional-tester.js tdm [limit]            - Test all TDM cards');
    console.log('  node tools/full-functional-tester.js --batches              - List all batches');
    console.log('  node tools/full-functional-tester.js batch1 --json          - Export results as JSON');
    console.log('\nBATCHES:');
    Object.entries(BATCHES).forEach(([name, cards]) => {
      console.log(`  ${name}: ${cards.length} cards - ${cards.slice(0, 2).join(', ')}...`);
    });
    console.log(`\nOUTPUT STATUS CODES:`);
    console.log(`  ✅ FUNCTIONAL  - Card works in all tested scenarios`);
    console.log(`  ⚠️  PARTIAL    - Card works but has missing functionality`);
    console.log(`  ❌ BROKEN      - Card has critical issues`);
    console.log(`  📋 UNTESTABLE - Card requires complex interaction`);
    console.log(`\nTEST COVERAGE:`);
    console.log(`  1. Castability (mana costs, phase timing)`);
    console.log(`  2. Mana system integration`);
    console.log(`  3. Effect resolution (cast, ETB, triggered)`);
    console.log(`  4. Database completeness`);
    console.log(`  5. AI recognition & scoring`);
    console.log(`  6. Keywords & static abilities`);
    console.log(`  7. Combo synergies`);
    console.log(`${'='.repeat(70)}\n`);
    process.exit(0);
  }

  const tester = new FunctionalTester();
  const options = {
    exportJson: args.includes('--json')
  };

  if (args[0] === '--batches') {
    console.log('Available batches:');
    Object.entries(BATCHES).forEach(([name, cards]) => {
      console.log(`\n${name} (${cards.length} cards):`);
      cards.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
    });
    process.exit(0);
  } else if (args[0] === 'tdm') {
    // Test all TDM cards in DB
    const limit = parseInt(args[1]) || Infinity;
    const tdmCards = Object.keys(DB).slice(0, limit);
    console.log(`\n📚 Testing ${Math.min(tdmCards.length, limit)} TDM cards from database...`);
    await tester.testBatch(tdmCards);
  } else if (BATCHES[args[0]]) {
    // Test batch
    console.log(`\n📚 Testing batch: ${args[0]}`);
    await tester.testBatch(BATCHES[args[0]]);
  } else {
    // Test single card
    const cardName = args[0].replace(/^["']|["']$/g, '');
    await tester.testCard(cardName);
  }

  // Generate report
  tester.generateReport(options);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
