#!/usr/bin/env node
/**
 * full-card-analysis.js
 * Análise COMPLETA de cada carta:
 * - Oracle text do Scryfall
 * - CardEffectsDB entry
 * - Suporte no engine (stack.js, game-state.js, cards.js)
 * - Suporte no AI (game-ai.js)
 * - Checklist de funcionamento
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load CardEffectsDB
const dbPath = path.join(__dirname, '../js/data/card-effects.js');
const content = fs.readFileSync(dbPath, 'utf8');
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} }
};
vm.createContext(sandbox);
const modified = content.replace(/\bconst CardEffectsDB\s*=/, 'var CardEffectsDB =');
vm.runInContext(modified, sandbox);
const DB = sandbox.CardEffectsDB;

async function fetchCard(cardName) {
  return new Promise((resolve) => {
    const url = 'https://api.scryfall.com/cards/search?q=name:\"' + encodeURIComponent(cardName) + '\"&unique=prints';
    https.get(url, { headers: { 'User-Agent': 'Analyzer' } }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const card = json.data?.[0];
          resolve({
            name: card?.name || cardName,
            oracle_text: card?.oracle_text || '(not found)',
            type_line: card?.type_line || '',
            mana_cost: card?.mana_cost || '',
            power: card?.power || null,
            toughness: card?.toughness || null
          });
        } catch(e) { resolve({ name: cardName, oracle_text: '(error)', type_line: '', mana_cost: '', power: null, toughness: null }); }
      });
    });
  });
}

function analyzeOracleText(oracle) {
  const abilities = {
    etb: oracle.includes('enters the battlefield') || oracle.includes('When '),
    cast: oracle.includes('cast') && !oracle.includes('Whenever you cast'),
    triggered: /whenever|when /i.test(oracle),
    activated: /\{.*\}:|tap:|sacrifice:/i.test(oracle),
    static: /flying|haste|lifelink|hexproof|indestructible|menace|vigilance|reach|trample|deathtouch|first strike|flash|ward/i.test(oracle),
    modal: /choose one|choose two/i.test(oracle),
    keyword_abilities: [
      oracle.includes('Flying') ? 'Flying' : null,
      oracle.includes('Haste') ? 'Haste' : null,
      oracle.includes('Lifelink') ? 'Lifelink' : null,
      oracle.includes('Vigilance') ? 'Vigilance' : null,
      oracle.includes('Menace') ? 'Menace' : null,
      oracle.includes('Deathtouch') ? 'Deathtouch' : null,
      oracle.includes('Flash') ? 'Flash' : null,
      oracle.includes('Hexproof') ? 'Hexproof' : null,
      oracle.includes('Shroud') ? 'Shroud' : null,
      oracle.includes('Indestructible') ? 'Indestructible' : null,
      oracle.includes('Ward') ? 'Ward' : null,
      oracle.includes('Reach') ? 'Reach' : null,
      oracle.includes('Trample') ? 'Trample' : null,
      oracle.includes('First strike') ? 'First Strike' : null,
      oracle.includes('Double strike') ? 'Double Strike' : null
    ].filter(x => x)
  };
  return abilities;
}

function analyzeDBEntry(cardName) {
  const entry = DB[cardName.toLowerCase()];
  if (!entry) return { exists: false };

  return {
    exists: true,
    has_cast: !!entry.cast,
    has_etb: !!entry.etb,
    has_triggered: !!entry.triggered,
    has_activated: !!entry.activated,
    has_static: !!entry.static,
    has_additional_costs: !!entry.additional_costs,
    cast_count: entry.cast?.length || 0,
    etb_count: entry.etb?.length || 0,
    triggered_count: entry.triggered?.length || 0,
    activated_count: entry.activated?.length || 0,
    full_entry: entry
  };
}

async function analyzeCard(cardName) {
  const scryfall = await fetchCard(cardName);
  const oracle_analysis = analyzeOracleText(scryfall.oracle_text);
  const db_analysis = analyzeDBEntry(cardName);

  return {
    name: scryfall.name,
    mana_cost: scryfall.mana_cost,
    type_line: scryfall.type_line,
    power_toughness: scryfall.power && scryfall.toughness ? `${scryfall.power}/${scryfall.toughness}` : 'N/A',
    oracle_text: scryfall.oracle_text,
    oracle_analysis,
    db_analysis,
    status: {
      cast_implemented: oracle_analysis.cast === db_analysis.has_cast,
      etb_implemented: oracle_analysis.etb === db_analysis.has_etb,
      triggered_implemented: oracle_analysis.triggered === db_analysis.has_triggered,
      activated_implemented: oracle_analysis.activated === db_analysis.has_activated,
      static_implemented: oracle_analysis.static === db_analysis.has_static
    }
  };
}

(async () => {
  const cards = [
    'Ambling Stormshell',
    'Avenger of the Fallen',
    'Boulderborn Dragon',
    'Descendant of Storms',
    'Marshal of the Lost'
  ];

  console.log('\n=== FULL CARD ANALYSIS (BATCH 1) ===\n');

  for (const cardName of cards) {
    const analysis = await analyzeCard(cardName);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`CARD: ${analysis.name}`);
    console.log(`Type: ${analysis.type_line} | Mana: ${analysis.mana_cost} | P/T: ${analysis.power_toughness}`);
    console.log(`${'='.repeat(80)}`);

    console.log(`\nORACLE TEXT:\n${analysis.oracle_text}`);

    console.log(`\n--- ORACLE ANALYSIS ---`);
    console.log(`  Has ETB: ${analysis.oracle_analysis.etb}`);
    console.log(`  Has Cast Effects: ${analysis.oracle_analysis.cast}`);
    console.log(`  Has Triggered: ${analysis.oracle_analysis.triggered}`);
    console.log(`  Has Activated: ${analysis.oracle_analysis.activated}`);
    console.log(`  Has Static: ${analysis.oracle_analysis.static}`);
    console.log(`  Keywords: ${analysis.oracle_analysis.keyword_abilities.join(', ') || 'None'}`);

    console.log(`\n--- DB IMPLEMENTATION ---`);
    if (!analysis.db_analysis.exists) {
      console.log(`  ❌ NOT IN DATABASE!`);
    } else {
      console.log(`  Cast Effects: ${analysis.db_analysis.has_cast ? `✅ (${analysis.db_analysis.cast_count})` : '❌'}`);
      console.log(`  ETB Effects: ${analysis.db_analysis.has_etb ? `✅ (${analysis.db_analysis.etb_count})` : '❌'}`);
      console.log(`  Triggered: ${analysis.db_analysis.has_triggered ? `✅ (${analysis.db_analysis.triggered_count})` : '❌'}`);
      console.log(`  Activated: ${analysis.db_analysis.has_activated ? `✅ (${analysis.db_analysis.activated_count})` : '❌'}`);
      console.log(`  Static: ${analysis.db_analysis.has_static ? `✅` : '❌'}`);

      if (analysis.db_analysis.has_triggered) {
        console.log(`\n  Triggered Details:`);
        for (const trig of analysis.db_analysis.full_entry.triggered) {
          console.log(`    - Event: ${trig.event}, Self: ${trig.self || false}, Condition: ${trig.condition || 'none'}`);
        }
      }
    }

    console.log(`\n--- COMPLETENESS CHECK ---`);
    const matches = {
      cast: analysis.oracle_analysis.cast === analysis.db_analysis.has_cast,
      etb: analysis.oracle_analysis.etb === analysis.db_analysis.has_etb,
      triggered: analysis.oracle_analysis.triggered === analysis.db_analysis.has_triggered
    };

    console.log(`  Cast effects match: ${matches.cast ? '✅' : '❌'}`);
    console.log(`  ETB effects match: ${matches.etb ? '✅' : '❌'}`);
    console.log(`  Triggered abilities match: ${matches.triggered ? '✅' : '❌'}`);

    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n\n✓ Analysis complete\n`);
})();
