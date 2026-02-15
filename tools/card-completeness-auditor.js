#!/usr/bin/env node
/**
 * CARD COMPLETENESS AUDITOR - Agente para análise 100% de cartas
 *
 * USO:
 *   node tools/card-completeness-auditor.js "Card Name" [card2] [card3]...
 *
 * EXEMPLO:
 *   node tools/card-completeness-auditor.js "Ambling Stormshell" "Sage of the Skies"
 *
 * SAÍDA:
 *   - Relatório completo de cada carta
 *   - Checklist de implementação
 *   - Lista de bugs/gaps encontrados
 *   - Sugestões de fix
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const dbContent = fs.readFileSync(dbPath, 'utf8');
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(sandbox);
const modified = dbContent.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB =');
vm.runInContext(modified, sandbox);
const DB = sandbox.CardEffectsDB;

// Load game-state.js to check for trigger support
const gsPath = path.join(__dirname, '../js/game/game-state.js');
const gsContent = fs.readFileSync(gsPath, 'utf8');

// Load stack.js to check for effect support
const stackPath = path.join(__dirname, '../js/game/stack.js');
const stackContent = fs.readFileSync(stackPath, 'utf8');

// Load cards.js to check for parser support
const cardsPath = path.join(__dirname, '../js/game/cards.js');
const cardsContent = fs.readFileSync(cardsPath, 'utf8');

class CardAuditor {
  async fetchScryfall(cardName) {
    return new Promise((resolve) => {
      const url = 'https://api.scryfall.com/cards/search?q=name:"' +
                  encodeURIComponent(cardName) + '"&unique=prints';
      https.get(url, { headers: { 'User-Agent': 'CardAuditor/1.0' } }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const card = json.data?.[0];
            resolve({
              found: !!card,
              name: card?.name || cardName,
              oracle_text: card?.oracle_text || '',
              type_line: card?.type_line || '',
              mana_cost: card?.mana_cost || '',
              power: card?.power || null,
              toughness: card?.toughness || null,
              keywords: card?.keywords || []
            });
          } catch(e) {
            resolve({ found: false, name: cardName, oracle_text: '', type_line: '', mana_cost: '', power: null, toughness: null, keywords: [] });
          }
        });
      }).on('error', () => {
        resolve({ found: false, name: cardName, oracle_text: '', type_line: '', mana_cost: '', power: null, toughness: null, keywords: [] });
      });
    });
  }

  parseOracleAbilities(oracle) {
    return {
      has_etb: /when.*enters|when .*enters the battlefield/i.test(oracle),
      has_cast: /you may cast|cast.*spell/i.test(oracle) && !/whenever you cast/i.test(oracle),
      has_triggered: /whenever|when /i.test(oracle),
      has_activated: /\{[^}]*\}:\s*\w|tap:|sacrifice:/i.test(oracle),
      has_static: /flying|haste|lifelink|hexproof|shroud|indestructible|menace|vigilance|reach|trample|deathtouch|first strike|double strike|flash|ward/i.test(oracle),
      triggered_events: this.extractTriggeredEvents(oracle),
      keywords: this.extractKeywords(oracle)
    };
  }

  extractTriggeredEvents(oracle) {
    const events = [];
    if (/whenever.*attacks/i.test(oracle)) events.push('attacks');
    if (/whenever.*deals combat damage/i.test(oracle)) events.push('combat_damage_player');
    if (/whenever.*dies/i.test(oracle)) events.push('dies');
    if (/whenever.*cast.*second spell/i.test(oracle)) events.push('second_spell');
    if (/whenever.*cast/i.test(oracle) && !/second spell/i.test(oracle)) events.push('cast_spell');
    if (/whenever.*enters/i.test(oracle)) events.push('enters_or_etb');
    if (/whenever.*becomes tapped/i.test(oracle)) events.push('becomes_tapped');
    if (/whenever.*end of (turn|step)/i.test(oracle)) events.push('end_step');
    if (/whenever.*upkeep/i.test(oracle)) events.push('upkeep');
    return events;
  }

  extractKeywords(oracle) {
    const keywords = [];
    const kwList = ['flying', 'haste', 'lifelink', 'hexproof', 'shroud', 'indestructible',
                    'menace', 'vigilance', 'reach', 'trample', 'deathtouch', 'first strike',
                    'double strike', 'flash', 'ward', 'defender'];
    for (const kw of kwList) {
      if (new RegExp(kw, 'i').test(oracle)) keywords.push(kw);
    }
    return keywords;
  }

  checkDBEntry(cardName) {
    const entry = DB[cardName.toLowerCase()];
    return {
      exists: !!entry,
      has_cast: !!entry?.cast,
      has_etb: !!entry?.etb,
      has_triggered: !!entry?.triggered,
      has_activated: !!entry?.activated,
      has_static: !!entry?.static,
      cast_count: entry?.cast?.length || 0,
      etb_count: entry?.etb?.length || 0,
      triggered_count: entry?.triggered?.length || 0,
      activated_count: entry?.activated?.length || 0,
      triggered_details: entry?.triggered || [],
      entry: entry || {}
    };
  }

  checkEngineSupport(abilities, dbEntry) {
    const checks = {
      triggered_events_supported: true,
      effect_types_supported: true,
      warnings: []
    };

    // Check each triggered event
    for (const event of abilities.triggered_events) {
      if (!gsContent.includes(`trigger.event === '${event}'`)) {
        checks.warnings.push(`⚠️  Event '${event}' may not be supported in game-state.js`);
      }
    }

    // Check effect types in DB
    if (dbEntry.has_triggered) {
      for (const trig of dbEntry.triggered_details) {
        for (const effect of trig.effects || []) {
          if (!stackContent.includes(`case '${effect.type}':`)) {
            checks.warnings.push(`⚠️  Effect type '${effect.type}' may not be in stack.js`);
          }
        }
      }
    }

    return checks;
  }

  generateReport(scryfall, oracle_analysis, db_check, engine_check) {
    const report = {
      card_name: scryfall.name,
      mana_cost: scryfall.mana_cost,
      type_line: scryfall.type_line,
      power_toughness: `${scryfall.power}/${scryfall.toughness}`,

      oracle_summary: {
        has_etb: oracle_analysis.has_etb,
        has_cast: oracle_analysis.has_cast,
        has_triggered: oracle_analysis.has_triggered,
        has_activated: oracle_analysis.has_activated,
        has_static: oracle_analysis.has_static,
        triggered_events: oracle_analysis.triggered_events,
        keywords: oracle_analysis.keywords
      },

      db_implementation: {
        in_database: db_check.exists,
        cast_implemented: db_check.has_cast,
        etb_implemented: db_check.has_etb,
        triggered_implemented: db_check.has_triggered,
        activated_implemented: db_check.has_activated,
        static_implemented: db_check.has_static
      },

      completeness: {
        cast_match: oracle_analysis.has_cast === db_check.has_cast,
        etb_match: oracle_analysis.has_etb === db_check.has_etb,
        triggered_match: oracle_analysis.has_triggered === db_check.has_triggered,
        activated_match: oracle_analysis.has_activated === db_check.has_activated,
        static_match: oracle_analysis.has_static === db_check.has_static
      },

      engine_support: engine_check.warnings,

      missing: this.identifyMissing(oracle_analysis, db_check),

      overall_status: this.calculateStatus(oracle_analysis, db_check, engine_check)
    };

    return report;
  }

  identifyMissing(oracle, db) {
    const missing = [];
    if (oracle.has_etb && !db.has_etb) missing.push('ETB effects');
    if (oracle.has_cast && !db.has_cast) missing.push('Cast effects');
    if (oracle.has_triggered && !db.has_triggered) missing.push('Triggered abilities');
    if (oracle.has_activated && !db.has_activated) missing.push('Activated abilities');
    if (oracle.has_static && !db.has_static) missing.push('Static effects');
    return missing;
  }

  calculateStatus(oracle, db, engine) {
    if (!db.exists) return '❌ NOT IN DATABASE';

    const missing = this.identifyMissing(oracle, db);
    if (missing.length === 0 && engine.warnings.length === 0) return '✅ COMPLETE & VERIFIED';
    if (missing.length > 0) return `⚠️  INCOMPLETE (missing: ${missing.join(', ')})`;
    if (engine.warnings.length > 0) return `⚠️  POTENTIAL ENGINE ISSUES`;

    return '✅ OK';
  }
}

async function auditCard(cardName) {
  const auditor = new CardAuditor();

  console.log(`\n${'='.repeat(100)}`);
  console.log(`AUDITING: ${cardName}`);
  console.log(`${'='.repeat(100)}\n`);

  // 1. Fetch from Scryfall
  console.log(`[1/4] Fetching from Scryfall...`);
  const scryfall = await auditor.fetchScryfall(cardName);
  if (!scryfall.found) {
    console.log(`❌ Card not found on Scryfall\n`);
    return null;
  }
  console.log(`✅ Found: ${scryfall.name}`);
  console.log(`    Type: ${scryfall.type_line}`);
  console.log(`    Mana: ${scryfall.mana_cost}`);
  console.log(`\n    Oracle Text:\n    ${scryfall.oracle_text.split('\n').join('\n    ')}\n`);

  // 2. Parse Oracle
  console.log(`[2/4] Parsing oracle abilities...`);
  const oracle_analysis = auditor.parseOracleAbilities(scryfall.oracle_text);
  console.log(`✅ Analyzed: ${JSON.stringify(oracle_analysis, null, 2).split('\n').slice(0, 10).join('\n')}`);

  // 3. Check Database
  console.log(`\n[3/4] Checking CardEffectsDB...`);
  const db_check = auditor.checkDBEntry(cardName);
  if (db_check.exists) {
    console.log(`✅ Found in database`);
    console.log(`    Cast: ${db_check.has_cast ? '✅' : '❌'} | ETB: ${db_check.has_etb ? '✅' : '❌'} | Triggered: ${db_check.has_triggered ? '✅' : '❌'}`);
  } else {
    console.log(`❌ NOT in database`);
  }

  // 4. Check Engine Support
  console.log(`\n[4/4] Checking engine support...`);
  const engine_check = auditor.checkEngineSupport(oracle_analysis, db_check);
  if (engine_check.warnings.length === 0) {
    console.log(`✅ All abilities supported`);
  } else {
    for (const warn of engine_check.warnings) {
      console.log(warn);
    }
  }

  // Generate report
  const report = auditor.generateReport(scryfall, oracle_analysis, db_check, engine_check);

  console.log(`\n${'='.repeat(100)}`);
  console.log(`AUDIT REPORT`);
  console.log(`${'='.repeat(100)}\n`);
  console.log(`Overall Status: ${report.overall_status}\n`);

  if (report.missing.length > 0) {
    console.log(`⚠️  MISSING IMPLEMENTATIONS:`);
    for (const m of report.missing) {
      console.log(`   - ${m}`);
    }
    console.log('');
  }

  if (report.engine_support.length > 0) {
    console.log(`⚠️  ENGINE CONCERNS:`);
    for (const warn of report.engine_support) {
      console.log(`   ${warn}`);
    }
    console.log('');
  }

  console.log(`CHECKLIST:`);
  console.log(`  Cast Effects: Oracle=${report.oracle_summary.has_cast} | DB=${report.db_implementation.cast_implemented} | Match=${report.completeness.cast_match ? '✅' : '❌'}`);
  console.log(`  ETB Effects: Oracle=${report.oracle_summary.has_etb} | DB=${report.db_implementation.etb_implemented} | Match=${report.completeness.etb_match ? '✅' : '❌'}`);
  console.log(`  Triggered: Oracle=${report.oracle_summary.has_triggered} | DB=${report.db_implementation.triggered_implemented} | Match=${report.completeness.triggered_match ? '✅' : '❌'}`);
  console.log(`  Activated: Oracle=${report.oracle_summary.has_activated} | DB=${report.db_implementation.activated_implemented} | Match=${report.completeness.activated_match ? '✅' : '❌'}`);
  console.log(`  Static: Oracle=${report.oracle_summary.has_static} | DB=${report.db_implementation.static_implemented} | Match=${report.completeness.static_match ? '✅' : '❌'}`);

  if (report.oracle_summary.triggered_events.length > 0) {
    console.log(`\n  Triggered Events Found: ${report.oracle_summary.triggered_events.join(', ')}`);
    if (db_check.triggered_details.length > 0) {
      console.log(`  Triggered in DB:`);
      for (const trig of db_check.triggered_details) {
        console.log(`    - Event: ${trig.event}, Self: ${trig.self || false}, Condition: ${trig.condition || 'none'}`);
      }
    }
  }

  console.log('\n');
  return report;
}

// Main
async function main() {
  const cards = process.argv.slice(2);
  if (cards.length === 0) {
    console.log(`\nUSAGE: node card-completeness-auditor.js "Card Name" [card2] [card3]...`);
    console.log(`\nEXAMPLE:`);
    console.log(`  node card-completeness-auditor.js "Ambling Stormshell" "Sage of the Skies"`);
    console.log('\n');
    process.exit(1);
  }

  for (const card of cards) {
    await auditCard(card);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`✓ Audit complete\n`);
}

main().catch(console.error);
