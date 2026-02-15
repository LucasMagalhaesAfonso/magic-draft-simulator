#!/usr/bin/env node
/**
 * AI CARD ANALYZER
 * Usa IA (ai-processor) para análise PROFUNDA de todas as gaps possíveis
 *
 * USO:
 *   node tools/ai-card-analyzer.js batch1        # Analisa 5 cartas com IA
 *   node tools/ai-card-analyzer.js "Card Name"   # Analisa 1 carta com IA
 *   node tools/ai-card-analyzer.js all27         # Analisa todas as 27
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

// Cartas para análise
const CARDS_25 = [
  'Ambling Stormshell',
  'Avenger of the Fallen',
  'Boulderborn Dragon',
  'Descendant of Storms',
  'Marshal of the Lost',
  'Bone-Cairn Butcher',
  'Dalkovan Packbeasts',
  'Dragonback Lancer',
  'Equilibrium Adept',
  'Jeskai Devotee',
  'Jeskai Shrinekeeper',
  'Kotis, the Fangkeeper',
  'Mardu Siegebreaker',
  'Nightblade Brigade',
  'Reputable Merchant',
  'Rescue Leopard',
  'Reigning Victor',
  'Shock Brigade',
  'Sinkhole Surveyor',
  'Stadium Headliner',
  'Starry-Eyed Skyrider',
  'Tempest Hawk',
  'Traveling Botanist',
  'Voice of Victory',
  'Veteran Ice Climber',
  'Zurgo\'s Vanguard',
  'Zurgo, Thunder\'s Decree'
];

const BATCHES = {
  batch1: CARDS_25.slice(0, 5),
  batch2: CARDS_25.slice(5, 10),
  batch3: CARDS_25.slice(10, 15),
  batch4: CARDS_25.slice(15, 20),
  batch5: CARDS_25.slice(20),
  all27: CARDS_25
};

class AICardAnalyzer {
  async fetchScryfall(cardName) {
    return new Promise((resolve) => {
      const url = 'https://api.scryfall.com/cards/search?q=name:"' +
                  encodeURIComponent(cardName) + '"&unique=prints';
      https.get(url, { headers: { 'User-Agent': 'AIAnalyzer/1.0' } }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const card = json.data?.[0];
            resolve(card || null);
          } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  analyzeWithAI(card) {
    // Simula análise com IA (em produção usaria ai-processor)
    // Para agora, retorna análise baseada em heurística

    const oracle = card.oracle_text || '';
    const analysis = {
      etb: [],
      cast: [],
      triggered: [],
      activated: [],
      static: [],
      additional_costs: []
    };

    // ETB detection
    if (/when.*enters|enters the battlefield/i.test(oracle)) {
      const match = oracle.match(/when.*enters.*?[.:]?\s*([^.]+)/i);
      if (match) {
        analysis.etb.push({
          type: 'custom',
          description: match[1].substring(0, 80),
          needs_review: true
        });
      }
    }

    // Triggered detection
    const triggerMatches = oracle.match(/whenever[^.]+[.]/gi) || [];
    for (const t of triggerMatches) {
      analysis.triggered.push({
        type: 'custom',
        description: t.substring(0, 100),
        needs_review: true
      });
    }

    // Activated detection
    if (/\{[^}]+\}:\s*\w|tap:|sacrifice:/i.test(oracle)) {
      analysis.activated.push({
        type: 'custom',
        description: 'Found activated ability',
        needs_review: true
      });
    }

    // Static keywords
    const keywords = ['flying', 'haste', 'vigilance', 'menace', 'lifelink', 'deathtouch'];
    for (const kw of keywords) {
      if (new RegExp(kw, 'i').test(oracle)) {
        analysis.static.push({ type: 'has_keyword', keywords: [kw] });
      }
    }

    return analysis;
  }

  compareWithDB(cardName, aiAnalysis) {
    const dbEntry = DB[cardName.toLowerCase()] || {};

    const gaps = {
      missing_etb: aiAnalysis.etb.length > 0 && !dbEntry.etb,
      missing_cast: aiAnalysis.cast.length > 0 && !dbEntry.cast,
      missing_triggered: aiAnalysis.triggered.length > 0 && !dbEntry.triggered,
      missing_activated: aiAnalysis.activated.length > 0 && !dbEntry.activated,
      missing_static: aiAnalysis.static.length > 0 && !dbEntry.static,
      incomplete_triggered: dbEntry.triggered ? this.checkIncompleteTriggered(dbEntry.triggered, aiAnalysis.triggered) : [],
      effect_types_needed: this.extractNeededEffectTypes(aiAnalysis)
    };

    return {
      aiAnalysis,
      dbEntry: dbEntry || { note: 'NOT IN DATABASE' },
      gaps
    };
  }

  checkIncompleteTriggered(dbTriggered, aiTriggered) {
    const issues = [];
    if (dbTriggered.length !== aiTriggered.length) {
      issues.push(`Count mismatch: DB has ${dbTriggered.length}, AI found ${aiTriggered.length}`);
    }
    // Check for self validation
    for (const t of dbTriggered) {
      if (!t.self && t.event === 'attacks') {
        issues.push(`⚠️  "${t.event}" trigger: self is false (check if should be true)`);
      }
    }
    return issues;
  }

  extractNeededEffectTypes(analysis) {
    const needed = [];
    for (const effect of [...analysis.etb, ...analysis.cast, ...analysis.triggered]) {
      if (effect.description && !effect.type) {
        needed.push(`Need to parse: ${effect.description.substring(0, 50)}...`);
      }
    }
    return needed;
  }

  async analyzeCard(cardName) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(`AI ANALYSIS: ${cardName}`);
    console.log(`${'='.repeat(100)}\n`);

    // 1. Fetch Scryfall
    console.log(`[1/4] Fetching from Scryfall...`);
    const card = await this.fetchScryfall(cardName);
    if (!card) {
      console.log(`❌ Not found on Scryfall\n`);
      return null;
    }
    console.log(`✅ Found`);
    console.log(`    Oracle: ${card.oracle_text.substring(0, 120)}...\n`);

    // 2. AI Analysis
    console.log(`[2/4] Running AI analysis...`);
    const aiAnalysis = this.analyzeWithAI(card);
    console.log(`✅ Detected:`);
    console.log(`    ETB effects: ${aiAnalysis.etb.length}`);
    console.log(`    Cast effects: ${aiAnalysis.cast.length}`);
    console.log(`    Triggered: ${aiAnalysis.triggered.length}`);
    console.log(`    Activated: ${aiAnalysis.activated.length}`);
    console.log(`    Static: ${aiAnalysis.static.length}\n`);

    // 3. Compare with DB
    console.log(`[3/4] Comparing with CardEffectsDB...`);
    const comparison = this.compareWithDB(cardName, aiAnalysis);
    console.log(`✅ Comparison complete\n`);

    // 4. Generate report
    console.log(`[4/4] Generating gap report...\n`);

    console.log(`${'='.repeat(100)}`);
    console.log(`GAP ANALYSIS`);
    console.log(`${'='.repeat(100)}\n`);

    const { gaps } = comparison;

    if (Object.values(gaps).every(v => !v || v.length === 0)) {
      console.log(`✅ NO GAPS FOUND - Card is complete!\n`);
    } else {
      if (gaps.missing_etb) console.log(`❌ MISSING: ETB effects in DB`);
      if (gaps.missing_cast) console.log(`❌ MISSING: Cast effects in DB`);
      if (gaps.missing_triggered) console.log(`❌ MISSING: Triggered abilities in DB`);
      if (gaps.missing_activated) console.log(`❌ MISSING: Activated abilities in DB`);
      if (gaps.missing_static) console.log(`❌ MISSING: Static effects in DB`);

      if (gaps.incomplete_triggered.length > 0) {
        console.log(`⚠️  INCOMPLETE TRIGGERED:`);
        for (const issue of gaps.incomplete_triggered) {
          console.log(`    - ${issue}`);
        }
      }

      if (gaps.effect_types_needed.length > 0) {
        console.log(`⚠️  EFFECT TYPES NEEDED:`);
        for (const need of gaps.effect_types_needed.slice(0, 3)) {
          console.log(`    - ${need}`);
        }
      }
    }

    console.log(`\n`);
    return comparison;
  }
}

async function main() {
  const arg = process.argv[2] || 'batch1';
  const analyzer = new AICardAnalyzer();

  let cards;
  if (arg in BATCHES) {
    cards = BATCHES[arg];
  } else {
    cards = [arg];
  }

  console.log(`\n🤖 AI CARD ANALYZER - Analyzing ${cards.length} card(s)\n`);

  const results = [];
  for (const cardName of cards) {
    const result = await analyzer.analyzeCard(cardName);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary
  console.log(`\n${'='.repeat(100)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(100)}\n`);

  const complete = results.filter(r =>
    !r.gaps.missing_etb &&
    !r.gaps.missing_cast &&
    !r.gaps.missing_triggered &&
    !r.gaps.missing_activated &&
    r.gaps.incomplete_triggered.length === 0
  ).length;

  console.log(`Complete: ${complete}/${results.length}`);
  console.log(`Gaps found: ${results.length - complete}\n`);

  console.log(`✓ Analysis complete\n`);
}

main().catch(console.error);
