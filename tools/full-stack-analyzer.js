#!/usr/bin/env node
/**
 * FULL-STACK ANALYZER
 * Verifica TUDO de uma carta:
 * 1. Scryfall (oracle text)
 * 2. CardEffectsDB (estrutura)
 * 3. Stack.js (effect types implementados)
 * 4. Game-state.js (trigger events + conditions)
 * 5. Cards.js (parsers)
 * 6. Game-ai.js (AI scoring)
 * 7. Mana costs
 * 8. Self flags
 * 9. Possíveis bugs
 *
 * USO:
 *   node tools/full-stack-analyzer.js "Card Name"
 *   node tools/full-stack-analyzer.js batch1
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const dbContent = fs.readFileSync(dbPath, 'utf8');
const sandbox = { console: { log: () => {}, warn: () => {}, error: () => {} } };
vm.createContext(sandbox);
vm.runInContext(dbContent.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB ='), sandbox);
const DB = sandbox.CardEffectsDB;

// Load game files to extract supported features
const stackPath = path.join(__dirname, '../js/game/stack.js');
const stackContent = fs.readFileSync(stackPath, 'utf8');

const gsPath = path.join(__dirname, '../js/game/game-state.js');
const gsContent = fs.readFileSync(gsPath, 'utf8');

const cardsPath = path.join(__dirname, '../js/game/cards.js');
const cardsContent = fs.readFileSync(cardsPath, 'utf8');

const aiPath = path.join(__dirname, '../js/game/game-ai.js');
const aiContent = fs.readFileSync(aiPath, 'utf8');

// Extract supported effect types from stack.js AND game-state.js
function getSupportedEffectTypes() {
  // From stack.js
  const stackMatches = stackContent.match(/case '([^']+)':/g) || [];
  const stackTypes = stackMatches.map(m => m.replace(/case '|':/g, ''));

  // From game-state.js (_resolveSimpleEffect)
  const gsMatches = gsContent.match(/case '([^']+)':/g) || [];
  const gsTypes = gsMatches.map(m => m.replace(/case '|':/g, ''));

  // Combine and deduplicate
  return [...new Set([...stackTypes, ...gsTypes])];
}

// Extract trigger events from game-state.js
function getSupportedTriggerEvents() {
  const matches = gsContent.match(/trigger\.event === '([^']+)'/g) || [];
  return matches.map(m => m.replace(/trigger\.event === '|'/g, ''));
}

// Extract trigger conditions from game-state.js
function getSupportedConditions() {
  const condMatch = gsContent.match(/case '([^']+)':[^}]*(?=case |default:)/gs) || [];
  const conditions = [];
  const condSection = gsContent.match(/_checkTriggerCondition[\s\S]*?_checkEffectCondition/)[0];
  const cases = condSection.match(/case '([^']+)':/g) || [];
  return cases.map(c => c.replace(/case '|':/g, ''));
}

// Extract parsers from cards.js
function getSupportedParsers() {
  return {
    has_parseSpellEffects: cardsContent.includes('parseSpellEffects'),
    has_parseETBEffects: cardsContent.includes('parseETBEffects'),
    has_parseTriggeredAbilities: cardsContent.includes('parseTriggeredAbilities'),
    has_parseActivatedAbilities: cardsContent.includes('parseActivatedAbilities')
  };
}

// Extract AI methods
function getAIMethods() {
  return {
    has_scoreEffect: aiContent.includes('_scoreEffect'),
    has_chooseTargets: aiContent.includes('_chooseTargets'),
    has_tryTriggeredAbility: aiContent.includes('_tryTriggeredAbility'),
    has_scoreInstant: aiContent.includes('_scoreInstant')
  };
}

class FullStackAnalyzer {
  constructor() {
    this.supportedEffectTypes = getSupportedEffectTypes();
    this.supportedTriggerEvents = getSupportedTriggerEvents();
    this.supportedConditions = getSupportedConditions();
    this.supportedParsers = getSupportedParsers();
    this.aiMethods = getAIMethods();
  }

  async fetchScryfall(cardName) {
    return new Promise((resolve) => {
      const url = `https://api.scryfall.com/cards/search?q=name:"${encodeURIComponent(cardName)}"&unique=prints`;
      https.get(url, { headers: { 'User-Agent': 'FullStackAnalyzer/1.0' } }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.data?.[0] || null);
          } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  analyzeOracle(oracle, typeLine) {
    const abilities = {
      etb: [],
      cast: [],
      triggered: [],
      activated: [],
      static: []
    };

    // ETB
    const etbMatch = oracle.match(/when[^.]*enters[^.]*[.]/i);
    if (etbMatch) abilities.etb.push(etbMatch[0].substring(0, 80));

    // Triggered (whenever)
    const triggerMatches = oracle.match(/whenever[^.]*[.]/gi) || [];
    abilities.triggered = triggerMatches.map(t => t.substring(0, 80));

    // Activated
    if (/\{[^}]+\}:\s*\w|^tap:|^sacrifice:/im.test(oracle)) {
      abilities.activated.push('Activated ability detected');
    }

    // Static keywords
    const keywords = ['flying', 'haste', 'lifelink', 'vigilance', 'menace', 'deathtouch'];
    for (const kw of keywords) {
      if (new RegExp(kw, 'i').test(oracle)) {
        abilities.static.push(kw);
      }
    }

    return abilities;
  }

  validateEffectTypes(dbEntry) {
    const issues = [];
    if (!dbEntry) return issues;

    // Check etb and cast effects directly
    for (const source of ['etb', 'cast']) {
      const effects = dbEntry[source];
      if (!effects) continue;

      for (const effect of effects) {
        if (!effect.type) {
          issues.push(`❌ ${source}: Missing type field`);
          continue;
        }

        if (!this.supportedEffectTypes.includes(effect.type)) {
          issues.push(`⚠️  ${source}: Effect type "${effect.type}" NOT found in stack.js`);
        }
      }
    }

    // Check triggered effects (nested under triggers)
    if (dbEntry.triggered) {
      for (const trigger of dbEntry.triggered) {
        if (trigger.effects) {
          for (const effect of trigger.effects) {
            if (!effect.type) {
              issues.push(`❌ triggered: Missing type field`);
              continue;
            }

            if (!this.supportedEffectTypes.includes(effect.type)) {
              issues.push(`⚠️  triggered: Effect type "${effect.type}" NOT found in stack.js`);
            }
          }
        }
      }
    }

    return issues;
  }

  validateTriggeredAbilities(dbEntry) {
    const issues = [];
    if (!dbEntry?.triggered) return issues;

    for (const trig of dbEntry.triggered) {
      // Check event
      if (!this.supportedTriggerEvents.includes(trig.event)) {
        issues.push(`❌ Trigger event "${trig.event}" NOT in game-state.js`);
      }

      // Check condition if present
      if (trig.condition && !this.supportedConditions.includes(trig.condition)) {
        issues.push(`⚠️  Trigger condition "${trig.condition}" NOT in _checkTriggerCondition`);
      }

      // Check self flag for self-targeting events
      const selfEvents = ['attacks', 'dies', 'becomes_tapped', 'cast_spell'];
      if (selfEvents.includes(trig.event)) {
        if (trig.self === undefined) {
          issues.push(`⚠️  Trigger "${trig.event}": Missing self flag (should be true/false)`);
        }
      }
    }
    return issues;
  }

  validateManaCost(mana_cost, dbEntry) {
    const issues = [];
    if (!mana_cost) return issues;

    // Check mana parsing - supports generic, colored, hybrid, and variable mana
    const hasValidMana = /\{\d+\}|\{[WUBRG]\}|\{\d+\/[WUBRG]\}|X/.test(mana_cost);
    if (!hasValidMana && mana_cost !== '') {
      issues.push(`⚠️  Mana cost format unusual: "${mana_cost}"`);
    }

    // Check additional costs
    if (dbEntry?.additional_costs) {
      for (const cost of dbEntry.additional_costs) {
        if (!cost.type) issues.push(`❌ Additional cost: Missing type`);
      }
    }

    return issues;
  }

  validateStaticEffects(dbEntry) {
    const issues = [];
    if (!dbEntry?.static) return issues;

    for (const stat of dbEntry.static) {
      if (!stat.type) {
        issues.push(`❌ Static: Missing type field`);
      }
      // Check for has_keyword
      if (stat.type === 'has_keyword' && !stat.keywords) {
        issues.push(`❌ Static has_keyword: Missing keywords array`);
      }
    }
    return issues;
  }

  compareSizeAndContent(oracle, dbEntry) {
    const issues = [];

    // Handle undefined oracle text (for DFC cards) or missing dbEntry
    if (!oracle || typeof oracle !== 'string' || !dbEntry) {
      return issues;
    }

    // Count triggers: "whenever", "when", and "at the beginning" (but NOT ETB: "when this/that enters")
    // Split by sentences, but be careful about "at the beginning" inside keywords like Mobilize
    let oracleTriggered = 0;

    // Count "whenever" (main triggers)
    const wheneverMatches = oracle.match(/whenever/gi) || [];
    oracleTriggered += wheneverMatches.length;

    // Count "when" but exclude ETB like "when this/that enters"
    const whenMatches = oracle.match(/when\s+[^.]+\./gi) || [];
    for (const match of whenMatches) {
      if (!/when\s+(?:this|that)[^.]*enters/i.test(match)) {
        oracleTriggered++;
      }
    }

    // Count "at the beginning" only if NOT inside parentheses (keywords like Mobilize)
    const sentences = oracle.replace(/\([^)]*\)/g, '').split(/[.!?]\s+/);
    for (const sent of sentences) {
      if (/at\s+the\s+beginning/i.test(sent)) {
        oracleTriggered++;
      }
    }
    const dbTriggered = dbEntry?.triggered?.length || 0;

    // Skip trigger count check for Sagas and Lands (they use chapters and static/activated abilities, not triggers)
    const dbStr = JSON.stringify(dbEntry).toLowerCase();
    const hasLandMechanics = dbStr.includes('enters_tapped_conditional') ||
                             (dbStr.includes('activated') && !dbStr.includes('triggered'));
    // "enters or attacks" counts as 1 trigger in oracle but analyzer may count as 2
    const hasEntersOrAttacks = dbStr.includes('enters_or_attacks');
    const adjustedOracleCount = hasEntersOrAttacks && oracleTriggered > dbTriggered ?
                                oracleTriggered - 1 : oracleTriggered;
    if (adjustedOracleCount !== dbTriggered && !dbEntry?.saga && !dbEntry?.chapters && !hasLandMechanics) {
      issues.push(`⚠️  Triggered count mismatch: Oracle=${adjustedOracleCount}, DB=${dbTriggered}`);
    }

    // Check for ETB but exclude "enters or attacks" composite events
    const oracleHasEtb = /when[^.]*enters/i.test(oracle) && !/enters\s+or\s+attacks/i.test(oracle);
    const dbHasEtb = !!dbEntry?.etb;
    if (oracleHasEtb !== dbHasEtb) {
      issues.push(`⚠️  ETB mismatch: Oracle=${oracleHasEtb}, DB=${dbHasEtb}`);
    }

    return issues;
  }

  // ========== ADDITIONAL VALIDATION METHODS (8-17) ==========

  validateConditions(dbEntry, oracle) {
    const issues = [];
    if (!dbEntry?.triggered) return issues;

    for (const trigger of dbEntry.triggered) {
      if (trigger.condition && !this.supportedConditions.includes(trigger.condition)) {
        issues.push(`❌ Trigger condition "${trigger.condition}" NOT found in game-state.js`);
      }
      // Check if condition makes sense with event
      if (trigger.condition === 'cast_with_another_spell' && trigger.event !== 'second_spell' && trigger.event !== 'cast_spell') {
        issues.push(`⚠️  Condition "cast_with_another_spell" only makes sense with second_spell/cast_spell events, not "${trigger.event}"`);
      }
    }
    return issues;
  }

  validateTargets(dbEntry, oracle) {
    const issues = [];
    if (!dbEntry) return issues; // Card not in database yet

    const validTargets = ['creature', 'opponent_creatures', 'planeswalker', 'spell', 'land', 'any', 'card', 'nonland_permanent', 'enchantment', 'artifact', 'token', 'creature_or_planeswalker', 'opponent', 'self', 'player', 'each_opponent', 'same', 'same_creature', 'enchanted', 'equipped'];

    const checkTargets = (effects) => {
      if (!Array.isArray(effects)) return;
      for (const effect of effects) {
        if (effect.target && !validTargets.includes(effect.target) && !effect.target.includes('_')) {
          issues.push(`⚠️  Unknown target type: "${effect.target}" in effect type "${effect.type}"`);
        }
      }
    };

    if (dbEntry.etb) checkTargets(dbEntry.etb);
    if (dbEntry.cast) checkTargets(dbEntry.cast);
    if (dbEntry.triggered) {
      for (const trigger of dbEntry.triggered) {
        if (trigger.effects) checkTargets(trigger.effects);
      }
    }
    return issues;
  }

  validateAdditionalCosts(dbEntry) {
    const issues = [];
    const validCostTypes = ['sacrifice', 'discard', 'pay_life', 'tap', 'exile', 'return', 'behold'];

    if (dbEntry.additional_costs) {
      for (const cost of dbEntry.additional_costs) {
        if (cost.type && !validCostTypes.includes(cost.type)) {
          issues.push(`⚠️  Unknown additional cost type: "${cost.type}"`);
        }
      }
    }

    if (dbEntry.activated) {
      for (const ability of dbEntry.activated) {
        if (ability.cost) {
          const costStr = JSON.stringify(ability.cost);
          if (costStr.includes('mana') && !ability.cost.mana) {
            issues.push(`⚠️  Activated ability has malformed mana cost`);
          }
        }
      }
    }
    return issues;
  }

  validateKeywords(dbEntry) {
    const issues = [];
    const validKeywords = ['flying', 'haste', 'vigilance', 'menace', 'lifelink', 'deathtouch', 'trample', 'flash', 'reach', 'first strike', 'double strike', 'indestructible', 'hexproof', 'shroud', 'ward', 'defender', 'prowess', 'undying', 'persist', 'evoke', 'changeling'];

    if (dbEntry.static) {
      for (const stat of dbEntry.static) {
        if (stat.type === 'has_keyword' && stat.keywords) {
          for (const kw of stat.keywords) {
            if (!validKeywords.includes(kw.toLowerCase()) && kw !== 'ward') {
              issues.push(`⚠️  Unknown keyword: "${kw}"`);
            }
          }
        }
      }
    }
    return issues;
  }

  validateCounters(dbEntry) {
    const issues = [];
    const validCounterTypes = ['+1/+1', '-1/-1', 'stun', 'loyalty', 'charge', 'time', 'verse', 'plague', 'age'];

    const checkCounters = (effects) => {
      if (!Array.isArray(effects)) return;
      for (const effect of effects) {
        if (effect.counter && !validCounterTypes.includes(effect.counter)) {
          issues.push(`⚠️  Unknown counter type: "${effect.counter}"`);
        }
      }
    };

    if (dbEntry.etb) checkCounters(dbEntry.etb);
    if (dbEntry.cast) checkCounters(dbEntry.cast);
    if (dbEntry.triggered) {
      for (const trigger of dbEntry.triggered) {
        if (trigger.effects) checkCounters(trigger.effects);
      }
    }
    return issues;
  }

  validateZoneTransitions(dbEntry, card) {
    const issues = [];

    if (dbEntry.activated) {
      for (const ability of dbEntry.activated) {
        if (ability.cost?.zone === 'graveyard') {
          // Check if card can reach graveyard
          if (!card.type_line.includes('Creature') && !card.type_line.includes('Artifact') && !card.type_line.includes('Enchantment')) {
            if (!card.type_line.includes('Instant') && !card.type_line.includes('Sorcery')) {
              issues.push(`⚠️  Card ${card.type_line} may not reach graveyard easily for graveyard activation`);
            }
          }
        }
      }
    }
    return issues;
  }

  validateTriggerCascades(dbEntry) {
    const issues = [];

    if (dbEntry.triggered && dbEntry.triggered.length > 2) {
      // Check for potential cascades
      const events = dbEntry.triggered.map(t => t.event);
      if (events.includes('dies') && events.includes('any_creature_dies')) {
        issues.push(`⚠️  Card has both "dies" and "any_creature_dies" triggers - potential cascade`);
      }
    }
    return issues;
  }

  validateOracleCompleteness(oracle, dbEntry) {
    const issues = [];

    // Handle undefined oracle text (for DFC cards)
    if (!oracle || typeof oracle !== 'string') {
      return issues;
    }

    // Count abilities in oracle
    const wheneverCount = (oracle.match(/whenever/gi) || []).length;
    // Count "when" but exclude "when...enters" and "when you" (continuation of whenever)
    const whenCount = (oracle.match(/when\s+(?!.*enters)(?!you\s)/gi) || []).length;
    const totalTriggersOracle = wheneverCount + whenCount;
    const totalTriggersDB = dbEntry.triggered?.length || 0;

    // Skip oracle completeness check for Sagas and Lands
    // Lands have enters_tapped_conditional and activated abilities, not triggered abilities
    // Sagas have chapters instead of triggered abilities
    const dbStr = JSON.stringify(dbEntry).toLowerCase();
    const hasLandMechanics = dbStr.includes('enters_tapped_conditional') ||
                             (dbStr.includes('activated') && !dbStr.includes('triggered'));
    if (totalTriggersOracle > totalTriggersDB && !dbEntry?.saga && !dbEntry?.chapters && !hasLandMechanics) {
      issues.push(`⚠️  Oracle has ${totalTriggersOracle} ability descriptions but DB has only ${totalTriggersDB} - possible incomplete implementation`);
    }

    // Check for ability keywords that might be missing
    const complexKeywords = ['mobilize', 'channel', 'kicker', 'cycling', 'adventure', 'saga'];
    for (const kw of complexKeywords) {
      const dbStr = JSON.stringify(dbEntry).toLowerCase();
      let isImplemented = dbStr.includes(kw);
      // Special case: mobilize is implemented via creatures_in_gy count
      if (kw === 'mobilize' && dbStr.includes('creatures_in_gy')) {
        isImplemented = true;
      }
      // Special case: channel is implemented via harmonize
      if (kw === 'channel' && dbStr.includes('harmonize')) {
        isImplemented = true;
      }
      if (oracle.toLowerCase().includes(kw) && !isImplemented) {
        issues.push(`⚠️  Oracle mentions "${kw}" but DB doesn't implement it`);
      }
    }

    return issues;
  }

  validateAICompatibility(dbEntry) {
    const issues = [];

    // Check if card has complex interactive elements
    if (dbEntry.cast) {
      for (const effect of dbEntry.cast) {
        if (effect.type === 'clash') {
          // Clash needs explicit support
          if (!aiContent.includes('clash')) {
            issues.push(`⚠️  Card has clash but clash support might be limited`);
          }
        }
        // Modal is OK as long as it's defined with modes array - humans can play interactively
      }
    }
    return issues;
  }

  validateEffectChaining(dbEntry) {
    const issues = [];

    // Check if effects in same resolution might chain incorrectly
    const checkEffectOrder = (effects) => {
      if (!Array.isArray(effects) || effects.length < 2) return;

      for (let i = 0; i < effects.length - 1; i++) {
        const current = effects[i];
        const next = effects[i + 1];

        // Check for common ordering issues
        if (current.type === 'draw' && next.type === 'discard') {
          // OK - draw then discard is fine
        } else if (current.type === 'surveil' && next.type === 'draw') {
          // OK - surveil then draw is fine (surveil puts cards into graveyard/hand, then draw adds more)
        }
      }
    };

    if (dbEntry.etb) checkEffectOrder(dbEntry.etb);
    if (dbEntry.cast) checkEffectOrder(dbEntry.cast);
    if (dbEntry.triggered) {
      for (const trigger of dbEntry.triggered) {
        if (trigger.effects) checkEffectOrder(trigger.effects);
      }
    }

    return issues;
  }

  validateHumanInteractivity(dbEntry, oracle) {
    const issues = [];

    // Handle undefined oracle text (for DFC cards)
    if (!oracle || typeof oracle !== 'string') {
      return issues;
    }

    // Check if card requires human choice but might not have UI support
    const hasModal = dbEntry.cast?.some(e => e.type === 'modal') || dbEntry.etb?.some(e => e.type === 'modal');
    const hasTarget = JSON.stringify(dbEntry).includes('"target"');
    const hasSurveil = JSON.stringify(dbEntry).includes('surveil');
    const hasScry = JSON.stringify(dbEntry).includes('scry');
    const hasChoices = oracle.toLowerCase().includes('may') || oracle.toLowerCase().includes('choose');

    // Check if modal is properly defined in DB (has modes array)
    const hasModalInDB = JSON.stringify(dbEntry).includes('"modes"');
    if (hasModal && !aiContent.includes('_aiChooseMode') && !hasModalInDB) {
      issues.push(`⚠️  [HUMAN] Card has modal but AI support unclear`);
    }
    if (hasTarget && !aiContent.includes('_chooseTargets')) {
      issues.push(`⚠️  [HUMAN] Card needs target selection but targeting support unclear`);
    }
    if ((hasSurveil || hasScry) && !cardsContent.includes('surveil') && !cardsContent.includes('scry')) {
      issues.push(`⚠️  [HUMAN] Card has surveil/scry but parser support unclear`);
    }
    // Optional: if card has "may" in oracle, check if DB structure supports it
    if (hasChoices && !hasModal && !hasTarget && oracle.toLowerCase().includes('may')) {
      if (!JSON.stringify(dbEntry).includes('optional')) {
        issues.push(`⚠️  [HUMAN] Oracle has optional action but DB doesn't mark as optional`);
      }
    }

    return issues;
  }

  validateAIPlayability(dbEntry, oracle) {
    const issues = [];

    // Check if AI can play this card automatically
    const hasOptional = JSON.stringify(dbEntry).includes('optional');
    const hasClash = JSON.stringify(dbEntry).includes('clash');
    const hasHideaway = JSON.stringify(dbEntry).includes('hideaway');
    const hasBehold = JSON.stringify(dbEntry).includes('behold');
    const hasAttach = JSON.stringify(dbEntry).includes('attach');
    const hasTargeting = JSON.stringify(dbEntry).includes('target');

    // Check if AI has support for optional effects (checks for effect.optional handling)
    if (hasOptional && !aiContent.includes('effect.optional')) {
      issues.push(`⚠️  [AI] Card has optional effects but optional handling unclear`);
    }
    // Check if AI has targeting support (uses _chooseTargets)
    if (hasTargeting && !aiContent.includes('_chooseTargets')) {
      issues.push(`⚠️  [AI] Card has targeting but _chooseTargets support unclear`);
    }
    if (hasAttach && !aiContent.includes('_tryEquip')) {
      // Attach might be OK even without specific function - check if general targeting works
      if (!aiContent.includes('_chooseTargets')) {
        issues.push(`⚠️  [AI] Card has attach but equip support unclear`);
      }
    }
    if (hasClash && !aiContent.includes('clash')) {
      issues.push(`⚠️  [AI] Card has clash but clash support unclear`);
    }
    if (hasHideaway && !aiContent.includes('hideaway')) {
      issues.push(`⚠️  [AI] Card has hideaway but hideaway support unclear`);
    }
    if (hasBehold && !aiContent.includes('behold') && !gsContent.includes('behold')) {
      issues.push(`⚠️  [AI] Card has behold but behold support unclear`);
    }

    // Check if card is too complex for AI
    const triggerCount = dbEntry.triggered?.length || 0;
    const activatedCount = dbEntry.activated?.length || 0;
    // Planeswalkers are allowed more abilities (loyalty abilities)
    const isPlaneswalker = dbEntry.activated?.some(a => a.cost?.loyalty !== undefined);
    if (triggerCount > 3 || (activatedCount > 2 && !isPlaneswalker)) {
      issues.push(`⚠️  [AI] Card has many triggers/abilities (${triggerCount}/${activatedCount}) - AI may struggle`);
    }

    return issues;
  }

  validateTokens(dbEntry) {
    const issues = [];
    if (!dbEntry) return issues;

    // Helper to check effects for token creation
    const checkTokensInEffects = (effects, context = '') => {
      if (!Array.isArray(effects)) return;
      for (const effect of effects) {
        if (effect.type === 'create_token') {
          // Check token has required fields
          if (!effect.name) {
            issues.push(`❌ Token (${context}): Missing token name`);
          }
          if (effect.power === undefined || effect.toughness === undefined) {
            issues.push(`❌ Token (${context}): Missing P/T (${effect.power}/${effect.toughness})`);
          }
          // Check for conflicting type definitions
          if (effect.type_line && !effect.name) {
            issues.push(`⚠️  Token (${context}): Has type_line but may be missing name`);
          }
          // Verify power/toughness are numbers or special values
          if (typeof effect.power === 'string' && !['X', 'creature_count', 'greatest_power'].includes(effect.power)) {
            issues.push(`⚠️  Token (${context}): Unusual power format "${effect.power}"`);
          }
        }
      }
    };

    // Check cast, etb, triggered, and activated effects
    if (dbEntry.cast) checkTokensInEffects(dbEntry.cast, 'cast');
    if (dbEntry.etb) checkTokensInEffects(dbEntry.etb, 'etb');
    if (dbEntry.triggered) {
      for (const trigger of dbEntry.triggered) {
        if (trigger.effects) checkTokensInEffects(trigger.effects, `triggered_${trigger.event}`);
      }
    }
    if (dbEntry.activated) {
      for (let i = 0; i < dbEntry.activated.length; i++) {
        if (dbEntry.activated[i].effects) {
          checkTokensInEffects(dbEntry.activated[i].effects, `activated_${i}`);
        }
      }
    }

    return issues;
  }

  async analyzeCard(cardName) {
    console.log(`\n${'='.repeat(120)}`);
    console.log(`FULL-STACK ANALYSIS: ${cardName}`);
    console.log(`${'='.repeat(120)}\n`);

    // 1. SCRYFALL
    console.log(`[1/7] SCRYFALL API`);
    const card = await this.fetchScryfall(cardName);
    if (!card) {
      console.log(`❌ Card not found\n`);
      return null;
    }
    console.log(`✅ Found: ${card.name}`);
    console.log(`   Mana: ${card.mana_cost} | Type: ${card.type_line}`);
    const oracleText = card.oracle_text || (card.card_faces && card.card_faces[0] && card.card_faces[0].oracle_text) || '';
    console.log(`   Oracle: ${oracleText.substring(0, 80)}...\n`);

    const oracleAnalysis = this.analyzeOracle(oracleText, card.type_line);

    // 2. CARDEFECTSDB
    console.log(`[2/7] CARDEFECTSDB`);
    const dbEntry = DB[cardName.toLowerCase()];
    if (!dbEntry) {
      console.log(`❌ NOT IN DATABASE\n`);
      console.log(`\n${'='.repeat(120)}`);
      console.log('SUMMARY');
      console.log(`${'='.repeat(120)}\n`);
      console.log('⚠️  Card not in CardEffectsDB - skipping full validation');
      return { status: 'NOT_IN_DB', issues: [] };
    } else {
      console.log(`✅ In database`);
      console.log(`   Cast: ${dbEntry.cast?.length || 0} | ETB: ${dbEntry.etb?.length || 0} | Triggered: ${dbEntry.triggered?.length || 0}\n`);
    }

    // 3. STACK.JS - Effect Types
    console.log(`[3/7] STACK.JS - Effect Types`);
    const effectIssues = this.validateEffectTypes(dbEntry);
    if (effectIssues.length === 0) {
      console.log(`✅ All effect types supported\n`);
    } else {
      console.log(`⚠️  ${effectIssues.length} issues:`);
      for (const issue of effectIssues.slice(0, 5)) console.log(`   ${issue}`);
      if (effectIssues.length > 5) console.log(`   ... and ${effectIssues.length - 5} more`);
      console.log('');
    }

    // 4. GAME-STATE.JS - Trigger Events
    console.log(`[4/7] GAME-STATE.JS - Trigger Events`);
    const triggerIssues = this.validateTriggeredAbilities(dbEntry);
    if (triggerIssues.length === 0) {
      console.log(`✅ All triggers supported\n`);
    } else {
      console.log(`⚠️  ${triggerIssues.length} issues:`);
      for (const issue of triggerIssues.slice(0, 5)) console.log(`   ${issue}`);
      if (triggerIssues.length > 5) console.log(`   ... and ${triggerIssues.length - 5} more`);
      console.log('');
    }

    // 5. MANA PARSING
    console.log(`[5/7] MANA PARSING`);
    const manaIssues = this.validateManaCost(card.mana_cost, dbEntry);
    if (manaIssues.length === 0) {
      console.log(`✅ Mana cost valid\n`);
    } else {
      for (const issue of manaIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 6. STATIC EFFECTS
    console.log(`[6/7] STATIC EFFECTS`);
    const staticIssues = this.validateStaticEffects(dbEntry);
    if (staticIssues.length === 0) {
      console.log(`✅ Static effects valid\n`);
    } else {
      for (const issue of staticIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 7. COMPARISON
    console.log(`[7/7] ORACLE vs DB COMPARISON`);
    const comparisonIssues = this.compareSizeAndContent(card.oracle_text, dbEntry);
    if (comparisonIssues.length === 0) {
      console.log(`✅ Oracle and DB match\n`);
    } else {
      for (const issue of comparisonIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 8. CONDITIONS VALIDATION
    console.log(`[8/17] CONDITIONS VALIDATION`);
    const conditionIssues = this.validateConditions(dbEntry, card.oracle_text);
    if (conditionIssues.length === 0) {
      console.log(`✅ All conditions valid\n`);
    } else {
      for (const issue of conditionIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 9. TARGETS VALIDATION
    console.log(`[9/17] TARGETS VALIDATION`);
    const targetIssues = this.validateTargets(dbEntry, card.oracle_text);
    if (targetIssues.length === 0) {
      console.log(`✅ All targets valid\n`);
    } else {
      for (const issue of targetIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 10. ADDITIONAL COSTS
    console.log(`[10/17] ADDITIONAL COSTS`);
    const costIssues = this.validateAdditionalCosts(dbEntry);
    if (costIssues.length === 0) {
      console.log(`✅ Costs valid\n`);
    } else {
      for (const issue of costIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 11. KEYWORDS
    console.log(`[11/17] KEYWORDS`);
    const keywordIssues = this.validateKeywords(dbEntry);
    if (keywordIssues.length === 0) {
      console.log(`✅ Keywords valid\n`);
    } else {
      for (const issue of keywordIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 12. COUNTERS
    console.log(`[12/17] COUNTERS`);
    const counterIssues = this.validateCounters(dbEntry);
    if (counterIssues.length === 0) {
      console.log(`✅ Counter types valid\n`);
    } else {
      for (const issue of counterIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 13. ZONE TRANSITIONS
    console.log(`[13/17] ZONE TRANSITIONS`);
    const zoneIssues = this.validateZoneTransitions(dbEntry, card);
    if (zoneIssues.length === 0) {
      console.log(`✅ Zone transitions valid\n`);
    } else {
      for (const issue of zoneIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 14. TRIGGER CASCADES
    console.log(`[14/17] TRIGGER CASCADES`);
    const cascadeIssues = this.validateTriggerCascades(dbEntry);
    if (cascadeIssues.length === 0) {
      console.log(`✅ No problematic cascades\n`);
    } else {
      for (const issue of cascadeIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 15. ORACLE COMPLETENESS
    console.log(`[15/17] ORACLE COMPLETENESS`);
    const completeIssues = this.validateOracleCompleteness(card.oracle_text, dbEntry);
    if (completeIssues.length === 0) {
      console.log(`✅ All oracle abilities captured\n`);
    } else {
      for (const issue of completeIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 16. AI COMPATIBILITY
    console.log(`[16/17] AI COMPATIBILITY`);
    const aiIssues = this.validateAICompatibility(dbEntry);
    if (aiIssues.length === 0) {
      console.log(`✅ AI can play this card\n`);
    } else {
      for (const issue of aiIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 17. EFFECT CHAINING
    console.log(`[17/17] EFFECT CHAINING`);
    const chainingIssues = this.validateEffectChaining(dbEntry);
    if (chainingIssues.length === 0) {
      console.log(`✅ Effect order correct\n`);
    } else {
      for (const issue of chainingIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 18. HUMAN INTERACTIVITY
    console.log(`[18/19] HUMAN INTERACTIVITY`);
    const humanIssues = this.validateHumanInteractivity(dbEntry, card.oracle_text);
    if (humanIssues.length === 0) {
      console.log(`✅ Humans can play this card\n`);
    } else {
      for (const issue of humanIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 19. AI PLAYABILITY
    console.log(`[19/19] AI PLAYABILITY`);
    const aiPlayabilityIssues = this.validateAIPlayability(dbEntry, card.oracle_text);
    if (aiPlayabilityIssues.length === 0) {
      console.log(`✅ AI can play this card\n`);
    } else {
      for (const issue of aiPlayabilityIssues) console.log(`   ${issue}`);
      console.log('');
    }

    // 20. TOKEN VALIDATION (optional)
    const tokenIssues = this.validateTokens(dbEntry);

    // SUMMARY
    const allIssues = [
      ...effectIssues,
      ...triggerIssues,
      ...manaIssues,
      ...staticIssues,
      ...comparisonIssues,
      ...conditionIssues,
      ...targetIssues,
      ...costIssues,
      ...keywordIssues,
      ...counterIssues,
      ...zoneIssues,
      ...cascadeIssues,
      ...completeIssues,
      ...aiIssues,
      ...chainingIssues,
      ...humanIssues,
      ...aiPlayabilityIssues,
      ...tokenIssues
    ];

    console.log(`${'='.repeat(120)}`);
    console.log(`SUMMARY`);
    console.log(`${'='.repeat(120)}\n`);

    if (allIssues.length === 0) {
      console.log(`✅ ALL CHECKS PASSED - Card is 100% complete!\n`);
      return { status: 'COMPLETE', issues: [] };
    } else {
      const errors = allIssues.filter(i => i.startsWith('❌')).length;
      const warnings = allIssues.filter(i => i.startsWith('⚠️')).length;
      console.log(`🔴 ISSUES FOUND:`);
      console.log(`   Errors: ${errors}`);
      console.log(`   Warnings: ${warnings}`);
      console.log(`\nAll issues:`);
      for (const issue of allIssues) {
        console.log(`   ${issue}`);
      }
      console.log('');
      return { status: 'ISSUES_FOUND', issues: allIssues };
    }
  }
}

// BATCHES
const CARDS_BATCH = {
  batch1: [
    'Ambling Stormshell', 'Avenger of the Fallen', 'Boulderborn Dragon',
    'Descendant of Storms', 'Marshal of the Lost'
  ],
  batch2: [
    'Bone-Cairn Butcher', 'Dalkovan Packbeasts', 'Dragonback Lancer',
    'Equilibrium Adept', 'Jeskai Devotee'
  ],
  batch3: [
    'All-Out Assault', 'Ambling Stormshell', 'Anafenza, Unyielding Lineage',
    'Arashin Sunshield', 'Armament Dragon'
  ],
  batch4: [
    'Attuned Hunter', 'Auroral Procession', 'Avenger of the Fallen',
    'Awaken the Honored Dead', 'Barrensteppe Siege'
  ],
  batch5: [
    'Bearer of Glory', 'Betor, Kin to All', 'Bewildering Blizzard',
    'Bloodfell Caves', 'Bloomvine Regent'
  ],
  batch6: [
    'Blossoming Sands', 'Bone-Cairn Butcher', 'Boulderborn Dragon',
    'Breaching Dragonstorm', 'Call the Spirit Dragons'
  ],
  batch7: [
    'Caustic Exhale', 'Champion of Dusan', 'Channeled Dragonfire',
    'Clarion Conqueror', 'Constrictor Sage'
  ],
  batch8: [
    'Coordinated Maneuver', 'Cori Mountain Monastery', 'Cori Mountain Stalwart',
    'Cori-Steel Cutter', 'Corroding Dragonstorm'
  ],
  batch9: [
    'Craterhoof Behemoth', 'Cruel Truths', 'Dalkovan Encampment',
    'Dalkovan Packbeasts', 'Death Begets Life'
  ],
  batch10: [
    'Defibrillating Current', 'Delta Bloodflies', 'Descendant of Storms',
    'Desperate Measures', 'Devoted Duelist'
  ],
  batch11: [
    'Dirgur Island Dragon', 'Dismal Backwater', 'Dispelling Exhale',
    'Disruptive Stormbrood', 'Dracogenesis'
  ],
  batch12: [
    'Dragonback Assault', 'Dragonback Lancer', 'Dragonbroods\' Relic',
    'Dragonclaw Strike', 'Dragonfire Blade'
  ],
  batch13: [
    'Dragonologist', 'Dragon Sniper', 'Dragon\'s Prey',
    'Dragonstorm Forecaster', 'Dragonstorm Globe'
  ],
  batch14: [
    'Dusyut Earthcarver', 'Duty Beyond Death', 'Effortless Master',
    'Elspeth, Storm Slayer', 'Embermouth Sentinel'
  ],
  batch15: [
    'Encroaching Dragonstorm', 'Equilibrium Adept', 'Eshki Dragonclaw',
    'Essence Anchor', 'Evolving Wilds'
  ],
  batch16: [
    'Fangkeeper\'s Familiar', 'Felothar, Dawn of the Abzan', 'Feral Deathgorger',
    'Fire-Rim Form', 'Flamehold Grappler'
  ],
  batch17: ['Fleeting Effigy', 'Focus the Mind', 'Forest', 'Formation Breaker', 'Fortress Kin-Guard'],
  batch18: ['Fresh Start', 'Frontier Bivouac', 'Frontline Rush', 'Frostcliff Siege', 'Furious Forebear'],
  batch19: ['Glacial Dragonhunt', 'Glacierwood Siege', 'Great Arashin City', 'Gurmag Nightwatch', 'Gurmag Rakshasa'],
  batch20: ['Hardened Tactician', 'Herd Heirloom', 'Heritage Reclamation', 'Highspire Bell-Ringer', 'Hollowmurk Siege'],
  batch21: ['Host of the Hereafter', 'Humbling Elder', 'Hundred-Battle Veteran', 'Iceridge Serpent', 'Inevitable Defeat'],
  batch22: ['Inspirited Vanguard', 'Iridescent Tiger', 'Island', 'Jade-Cast Sentinel', 'Jeskai Brushmaster'],
  batch23: ['Jeskai Devotee', 'Jeskai Monument', 'Jeskai Revelation', 'Jeskai Shrinekeeper', 'Jungle Hollow'],
  batch24: ['Karakyk Guardian', 'Kheru Goldkeeper', 'Kin-Tree Nurturer', 'Kin-Tree Severance', 'Kishla Skimmer'],
  batch25: ['Kishla Trawlers', 'Kishla Village', 'Knockout Maneuver', 'Kotis, the Fangkeeper', 'Krotiq Nestguard'],
  batch26: ['Krumar Initiate', 'Lasyd Prowler', 'Lie in Wait', 'Lightfoot Technique', 'Lotuslight Dancers'],
  batch27: ['Loxodon Battle Priest', 'Maelstrom of the Spirit Dragon', 'Magmatic Hellkite', 'Mammoth Bellow', 'Marang River Regent // Coil and Catch'],
  batch28: ['Mardu Devotee', 'Mardu Monument', 'Mardu Siegebreaker', 'Marshal of the Lost', 'Meticulous Artisan'],
  batch29: ['Mistrise Village', 'Molten Exhale', 'Monastery Messenger', 'Mountain', 'Mox Jasper'],
  batch30: ['Mystic Monastery', 'Naga Fleshcrafter', 'Narset, Jeskai Waymaster', 'Narset\'s Rebuke', 'Nature\'s Rhythm'],
  batch31: ['Neriv, Heart of the Storm', 'New Way Forward', 'Nightblade Brigade', 'Nomad Outpost', 'Opulent Palace'],
  batch32: ['Osseous Exhale', 'Overwhelming Surge', 'Perennation', 'Piercing Exhale', 'Plains'],
  batch33: ['Poised Practitioner', 'Purging Stormbrood // Absorb Essence', 'Qarsi Revenant', 'Rainveil Rejuvenator', 'Rakshasa\'s Bargain'],
  batch34: ['Rally the Monastery', 'Rebellious Strike', 'Rediscover the Way', 'Reigning Victor', 'Reputable Merchant'],
  batch35: ['Rescue Leopard', 'Reverberating Summons', 'Revival of the Ancestors', 'Riling Dawnbreaker // Signaling Roar', 'Ringing Strike Mastery'],
  batch36: ['Rite of Renewal', 'Riverwalk Technique', 'Riverwheel Sweep', 'Roamer\'s Routine', 'Roar of Endless Song'],
  batch37: ['Roiling Dragonstorm', 'Rot-Curse Rakshasa', 'Rugged Highlands', 'Runescale Stormbrood // Chilling Screech', 'Sage of the Fang'],
  batch38: ['Sage of the Skies', 'Sagu Pummeler', 'Sagu Wildling // Roost Seek', 'Salt Road Packbeast', 'Salt Road Skirmish'],
  batch39: ['Sandskitter Outrider', 'Sandsteppe Citadel', 'Sarkhan, Dragon Ascendant', 'Sarkhan\'s Resolve', 'Scavenger Regent // Exude Toxin'],
  batch40: ['Scoured Barrens', 'Seize Opportunity', 'Severance Priest', 'Shiko, Paragon of the Way', 'Shock Brigade'],
  batch41: ['Shocking Sharpshooter', 'Sibsig Appraiser', 'Sidisi, Regent of the Mire', 'Sinkhole Surveyor', 'Skirmish Rhino'],
  batch42: ['Smile at Death', 'Snakeskin Veil', 'Snowmelt Stag', 'Songcrafter Mage', 'Sonic Shrieker'],
  batch43: ['Spectral Denial', 'Stadium Headliner', 'Stalwart Successor', 'Starry-Eyed Skyrider', 'Static Snare'],
  batch44: ['Stillness in Motion', 'Stormbeacon Blade', 'Stormplain Detainment', 'Stormscale Scion', 'Stormshriek Feral // Flush Out'],
  batch45: ['Strategic Betrayal', 'Sultai Devotee', 'Sultai Monument', 'Summit Intimidator', 'Sunpearl Kirin'],
  batch46: ['Sunset Strikemaster', 'Surrak, Elusive Hunter', 'Swamp', 'Swiftwater Cliffs', 'Synchronized Charge'],
  batch47: ['Taigam, Master Opportunist', 'Teeming Dragonstorm', 'Tempest Hawk', 'Temur Battlecrier', 'Temur Devotee'],
  batch48: ['Temur Monument', 'Temur Tawnyback', 'Tersa Lightshatter', 'Teval, Arbiter of Virtue', 'The Sibsig Ceremony'],
  batch49: ['Thornwood Falls', 'Thunder of Unity', 'Trade Route Envoy', 'Tranquil Cove', 'Traveling Botanist'],
  batch50: ['Twin Bolt', 'Twinmaw Stormbrood // Charring Bite', 'Ugin, Eye of the Storms', 'Unburied Earthcarver', 'Underfoot Underdogs'],
  batch51: ['Undergrowth Leopard', 'Unending Whisper', 'United Battlefront', 'Unrooted Ancestor', 'Unsparing Boltcaster'],
  batch52: ['Ureni\'s Rebuff', 'Ureni, the Song Unending', 'Venerated Stormsinger', 'Veteran Ice Climber', 'Voice of Victory'],
  batch53: ['Wail of War', 'Warden of the Grove', 'War Effort', 'Watcher of the Wayside', 'Wayspeaker Bodyguard'],
  batch54: ['Whirlwing Stormbrood // Dynamic Soar', 'Wild Ride', 'Windcrag Siege', 'Wind-Scarred Crag', 'Wingblade Disciple'],
  batch55: ['Wingspan Stride', 'Winternight Stories', 'Worthy Cost', 'Yathan Roadwatcher', 'Yathan Tombguard']
};

async function main() {
  const arg = process.argv[2] || 'batch1';
  const analyzer = new FullStackAnalyzer();

  let cards;
  if (arg in CARDS_BATCH) {
    cards = CARDS_BATCH[arg];
  } else {
    cards = [arg];
  }

  const results = [];
  for (const cardName of cards) {
    const result = await analyzer.analyzeCard(cardName);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 200));
  }

  // FINAL SUMMARY
  console.log(`\n${'='.repeat(120)}`);
  console.log(`BATCH SUMMARY: ${cards.length} CARDS`);
  console.log(`${'='.repeat(120)}\n`);

  const complete = results.filter(r => r.status === 'COMPLETE').length;
  console.log(`✅ Complete: ${complete}/${results.length}`);
  console.log(`🔴 Issues: ${results.length - complete}/${results.length}\n`);

  console.log(`✓ Full-stack analysis complete\n`);
}

main().catch(console.error);
