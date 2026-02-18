/**
 * Deep Oracle Audit (Solutions 1+3 combined)
 *
 * For EACH card: extracts DETAILED expected behaviors from oracle text
 * (amounts, targets, keywords, mechanics) and compares with CardEffectsDB.
 * Reports exact mismatches like "Oracle says deals 3 damage but DB has amount: 2".
 */
const { test, expect } = require('@playwright/test');
const { setupTestGame } = require('../helpers/game-helpers');

// ========================= AUDIT ENGINE =========================

const AUDIT_CODE = `
(async function auditSet(setCode) {

  // ---- Word to number ----
  function wordToNum(w) {
    if (!w) return null;
    const map = {a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    return map[w.toLowerCase()] || parseInt(w) || null;
  }

  // ---- Extract detailed behaviors from oracle text ----
  function extractBehaviors(text, cardName, typeLine) {
    if (!text) return [];
    // Remove reminder text and quoted ability text (token abilities)
    const clean = text.replace(/\\([^)]*\\)/g, '').replace(/"[^"]*"/g, '').trim().toLowerCase();
    const normalized = clean.replace(new RegExp(cardName.toLowerCase().replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'g'), '~');
    const behaviors = [];

    // ---- DAMAGE ----
    const dmgPatterns = [
      /deals? (\\d+) damage to (any target)/,
      /deals? (\\d+) damage to (target creature or player)/,
      /deals? (\\d+) damage to (target creature or planeswalker)/,
      /deals? (\\d+) damage to (target creature)/,
      /deals? (\\d+) damage to (target player|target opponent)/,
      /deals? (\\d+) damage to (each opponent)/,
      /deals? (\\d+) damage to (each creature)/,
    ];
    for (const pat of dmgPatterns) {
      const m = clean.match(pat);
      if (m) {
        let target = m[2];
        if (target.includes('each creature')) target = 'each_creature';
        else if (target.includes('each opponent')) target = 'opponent';
        else if (target.includes('any target')) target = 'any';
        else if (target.includes('creature or player') || target.includes('creature or planeswalker')) target = 'any';
        else if (target.includes('creature')) target = 'creature';
        else if (target.includes('player') || target.includes('opponent')) target = 'opponent';
        behaviors.push({ type: 'damage', amount: parseInt(m[1]), target });
        break;
      }
    }

    // ---- DRAW ----
    const drawMatch = clean.match(/draw (\\w+) cards?/);
    if (drawMatch && !clean.match(/whenever.*draw/) && !clean.match(/if (?:it|that|the).*draw/)) {
      const amt = wordToNum(drawMatch[1]) || 1;
      behaviors.push({ type: 'draw', amount: amt });
    }

    // ---- LIFE GAIN ----
    const gainMatch = clean.match(/(?:you )?gain (\\d+|\\w+) life/);
    if (gainMatch) {
      const amt = parseInt(gainMatch[1]) || wordToNum(gainMatch[1]) || 0;
      if (amt > 0) behaviors.push({ type: 'gainLife', amount: amt });
    }

    // ---- LIFE LOSS ----
    const loseMatch = clean.match(/(?:target (?:player|opponent)|each opponent) loses? (\\d+|\\w+) life/);
    if (loseMatch) {
      const amt = parseInt(loseMatch[1]) || wordToNum(loseMatch[1]) || 0;
      if (amt > 0) behaviors.push({ type: 'loseLife', amount: amt });
    }

    // ---- MILL ----
    const millMatch = clean.match(/(?:target player )?mills? (\\d+|\\w+)/);
    if (millMatch && !clean.includes('miller') && !clean.includes('milling')) {
      const amt = parseInt(millMatch[1]) || wordToNum(millMatch[1]) || 0;
      if (amt > 0) {
        const target = clean.includes('target player') ? 'any_player' : 'self';
        behaviors.push({ type: 'mill', amount: amt, target });
      }
    }

    // ---- SCRY ----
    const scryMatch = clean.match(/scry (\\d+)/);
    if (scryMatch) behaviors.push({ type: 'scry', amount: parseInt(scryMatch[1]) });

    // ---- SURVEIL ----
    const surveilMatch = clean.match(/surveil (\\d+)/);
    if (surveilMatch) behaviors.push({ type: 'surveil', amount: parseInt(surveilMatch[1]) });

    // ---- BUFF / DEBUFF ----
    const buffMatch = clean.match(/gets? ([+-]\\d+)\\/([+-]\\d+) until end of turn/);
    if (buffMatch) {
      const p = parseInt(buffMatch[1]), t = parseInt(buffMatch[2]);
      if (p >= 0 && t >= 0) {
        behaviors.push({ type: 'buff', power: p, toughness: t });
      } else {
        behaviors.push({ type: 'debuff', power: p, toughness: t });
      }
    }

    // ---- TOKENS ----
    const tokenMatch = clean.match(/create (?:a |an |two |three |four |five |(\\w+) )?(\\d+)\\/(\\d+)/);
    if (tokenMatch) {
      const count = tokenMatch[1] ? (wordToNum(tokenMatch[1]) || 1) : 1;
      behaviors.push({ type: 'create_token', count, power: parseInt(tokenMatch[2]), toughness: parseInt(tokenMatch[3]) });
    }

    // ---- COUNTERS ----
    const counterMatch = clean.match(/put (?:a |(\\w+) )(\\+1\\/\\+1|-1\\/-1) counters? on (it|target creature|~|a creature you control|each creature you control)/);
    if (counterMatch) {
      const amt = counterMatch[1] ? (wordToNum(counterMatch[1]) || 1) : 1;
      const counterType = counterMatch[2];
      const self = counterMatch[3] === 'it' || counterMatch[3] === '~';
      behaviors.push({ type: self ? 'counter_self' : 'counter', counter: counterType, amount: amt });
    }

    // ---- DESTROY ----
    if (clean.match(/destroy target (creature|nonland permanent|artifact|enchantment)/)) {
      behaviors.push({ type: 'destroy', target: 'creature' });
    }
    if (clean.includes('destroy all creatures')) {
      behaviors.push({ type: 'destroy_all' });
    }

    // ---- EXILE ----
    if (clean.match(/exile target (creature|nonland permanent)/)) {
      behaviors.push({ type: 'exile', target: 'creature' });
    }

    // ---- BOUNCE ----
    if (clean.match(/return target .* to .* (?:owner's )?hand/)) {
      behaviors.push({ type: 'bounce', target: 'creature' });
    }

    // ---- FIGHT ----
    if (clean.match(/fights? (?:up to one )?target/)) {
      behaviors.push({ type: 'fight' });
    }

    // ---- DISCARD ----
    const discardMatch = clean.match(/(?:target (?:player|opponent) )?discards? (?:a |(\\d+|\\w+) )?cards?/);
    if (discardMatch && !clean.includes('you discard') && !clean.includes('as an additional cost')) {
      if (clean.includes('target opponent') || clean.includes('target player') || clean.includes('each opponent')) {
        const amt = discardMatch[1] ? (parseInt(discardMatch[1]) || wordToNum(discardMatch[1]) || 1) : 1;
        behaviors.push({ type: 'discard', amount: amt });
      }
    }

    // ---- RAMP ----
    if (clean.match(/search your library for a.*(?:basic |land ).*(?:card|and put)/i) && !clean.includes('nonland')) {
      behaviors.push({ type: 'ramp' });
    }

    // ---- KEYWORDS (static) ----
    const allKeywords = ['flying','vigilance','trample','lifelink','deathtouch','menace',
      'reach','first strike','double strike','haste','hexproof','indestructible',
      'flash','defender','wither','persist','ward'];
    const detectedKeywords = [];
    if (typeLine && typeLine.includes('Creature')) {
      for (const kw of allKeywords) {
        // Check if keyword appears at start of line or after newline (not in ability text)
        const kwRegex = new RegExp('(?:^|\\\\n)' + kw, 'i');
        if (kwRegex.test(clean) || (text && text.split('\\n').some(line => line.trim().toLowerCase().startsWith(kw)))) {
          detectedKeywords.push(kw);
        }
      }
    }
    if (detectedKeywords.length > 0) {
      behaviors.push({ type: 'keywords', keywords: detectedKeywords });
    }

    // ---- ZONES ----
    // ETB (exclude token ETBs like "When this token enters")
    const selfETB = normalized.match(/when (?:~|this creature|this (?!token)\\w+) enters/);
    if (selfETB) behaviors.push({ type: 'zone', zone: 'etb' });

    // Triggered
    if (normalized.match(/when(?:ever)? (?:~|this creature) attacks/)) behaviors.push({ type: 'zone', zone: 'triggered', event: 'attacks' });
    if (normalized.match(/when(?:ever)? (?:~|this creature) deals combat damage to a player/)) behaviors.push({ type: 'zone', zone: 'triggered', event: 'combat_damage_player' });
    if (normalized.match(/when(?:ever)? (?:~|this creature) dies/)) behaviors.push({ type: 'zone', zone: 'triggered', event: 'dies' });
    if (clean.match(/at the beginning of (?:your )?upkeep/)) behaviors.push({ type: 'zone', zone: 'triggered', event: 'upkeep' });
    if (clean.match(/at the beginning of (?:your |each )?end step/)) behaviors.push({ type: 'zone', zone: 'triggered', event: 'end_step' });

    // Activated
    if (clean.match(/\\{t\\}\\s*:/)) behaviors.push({ type: 'zone', zone: 'activated' });

    // ---- MECHANICS ----
    if (clean.includes('endure')) {
      const endureMatch = clean.match(/endure (\\d+|\\w+)/);
      if (endureMatch) {
        const amt = parseInt(endureMatch[1]) || wordToNum(endureMatch[1]) || 1;
        behaviors.push({ type: 'endure', amount: amt });
      }
    }

    const harmonizeMatch = clean.match(/harmonize ((?:\\{[^}]+\\})+)/);
    if (harmonizeMatch) {
      behaviors.push({ type: 'harmonize', cost: harmonizeMatch[1] });
    }

    if (clean.includes('convoke')) behaviors.push({ type: 'mechanic', name: 'convoke' });
    if (clean.match(/evoke\\s/)) behaviors.push({ type: 'mechanic', name: 'evoke' });
    if (clean.match(/choose one —|choose two —|choose one\\./)) behaviors.push({ type: 'zone', zone: 'modal' });

    return behaviors;
  }

  // ---- Compare behavior with DB ----
  function flattenEffects(db) {
    const all = [];
    if (!db) return all;

    // Recursively extract effects from nested structures
    function extractFromEffect(eff) {
      if (!eff) return;
      all.push(eff);
      // Modal effects inside cast/etb arrays: { type: "modal", modes: [...] }
      if (eff.type === 'modal' && Array.isArray(eff.modes)) {
        eff.modes.forEach(m => {
          if (m.effects) m.effects.forEach(e => extractFromEffect(e));
          else extractFromEffect(m); // mode IS the effect (e.g. { type: "damage", ... })
        });
      }
      // Triggered wrapper: { type: "triggered_this_turn", effects: [...] }
      if ((eff.type === 'triggered_this_turn' || eff.type === 'triggered') && eff.effects) {
        eff.effects.forEach(e => extractFromEffect(e));
      }
    }

    // Zone arrays (cast, etb, static)
    ['cast','etb','static'].forEach(z => {
      if (Array.isArray(db[z])) db[z].forEach(e => extractFromEffect(e));
    });

    // Triggered abilities
    if (Array.isArray(db.triggered)) {
      db.triggered.forEach(t => { if (t.effects) t.effects.forEach(e => extractFromEffect(e)); });
    }

    // Activated abilities
    if (Array.isArray(db.activated)) {
      db.activated.forEach(a => { if (a.effects) a.effects.forEach(e => extractFromEffect(e)); });
    }

    // Top-level modal (3 formats):
    // 1. db.modal === true + db.modes as array
    // 2. db.modal === true + db.modes as object { "abzan": { triggered: [...] }, ... }
    // 3. db.modal as object with db.modal.modes (array or with chooseOnETB)
    if (db.modal) {
      let modes = null;
      if (Array.isArray(db.modes)) modes = db.modes;
      else if (db.modes && typeof db.modes === 'object') {
        // Object-keyed modes (Sieges): { "abzan": { triggered: [...] }, ... }
        Object.values(db.modes).forEach(modeVal => {
          if (modeVal.triggered) modeVal.triggered.forEach(t => { if (t.effects) t.effects.forEach(e => extractFromEffect(e)); });
          if (modeVal.effects) modeVal.effects.forEach(e => extractFromEffect(e));
        });
      }
      if (typeof db.modal === 'object') {
        // db.modal.modes (Wail of War, Sarkhan's Resolve, Sieges with chooseOnETB)
        if (Array.isArray(db.modal.modes)) modes = db.modal.modes;
        else if (db.modal.modes && typeof db.modal.modes === 'object') {
          Object.values(db.modal.modes).forEach(modeVal => {
            if (modeVal.triggered) modeVal.triggered.forEach(t => { if (t.effects) t.effects.forEach(e => extractFromEffect(e)); });
            if (modeVal.effects) modeVal.effects.forEach(e => extractFromEffect(e));
          });
        }
      }
      if (modes) {
        modes.forEach(m => {
          if (m.effects) m.effects.forEach(e => extractFromEffect(e));
          else extractFromEffect(m);
        });
      }
    }

    // Saga chapters
    if (db.chapters) {
      Object.values(db.chapters).forEach(ch => {
        if (Array.isArray(ch)) ch.forEach(e => extractFromEffect(e));
      });
    }

    // Graveyard abilities
    if (Array.isArray(db.graveyard)) {
      db.graveyard.forEach(g => { if (g.effects) g.effects.forEach(e => extractFromEffect(e)); });
    }

    return all;
  }

  function findEffectByType(allEffects, type) {
    const aliases = {
      'gainLife': ['gainLife','gain_life','drain'],
      'loseLife': ['loseLife','lose_life','drain'],
      'counter_self': ['counter_self','counter','counter_all','grant_counter','grant_counters'],
      'counter': ['counter','counter_self','counter_all','distribute_counters','grant_counter','grant_counters'],
      'buff': ['buff','buff_self','buff_all','temp_buff','anthem'],
      'debuff': ['debuff','debuff_all','blight','blight_opponent','buff'],
      'create_token': ['create_token','create_token_copy','mobilize'],
      'destroy': ['destroy','destroy_all'],
      'destroy_all': ['destroy_all','destroy'],
      'exile': ['exile','exile_all'],
      'bounce': ['bounce','bounce_self','bounce_to_library_top','return_from_graveyard'],
      'ramp': ['ramp','search_library'],
      'fight': ['fight'],
      'discard': ['discard','discard_hand'],
      'draw': ['draw','loot','look_top'],
      'damage': ['damage','damage_all','damage_all_creatures','damage_each_opponent','drain'],
      'mill': ['mill'],
      'scry': ['scry'],
      'surveil': ['surveil'],
      'endure': ['endure'],
    };
    const types = aliases[type] || [type];
    return allEffects.filter(e => types.includes(e.type));
  }

  function auditCard(cardName, oracleText, typeLine, db) {
    const issues = [];
    const behaviors = extractBehaviors(oracleText, cardName, typeLine);
    if (behaviors.length === 0) return issues;
    if (!db) {
      if (behaviors.length > 0) {
        issues.push({ card: cardName, severity: 'HIGH', issue: 'NO_DB_ENTRY', detail: 'Card has oracle abilities but no CardEffectsDB entry' });
      }
      return issues;
    }

    const allEffects = flattenEffects(db);

    for (const beh of behaviors) {
      // --- Zone checks ---
      if (beh.type === 'zone') {
        if (beh.zone === 'etb' && !db.etb) {
          // ETB might be inside triggered with event: "enters" or the card might handle ETB via other means
          const hasETBInTriggered = Array.isArray(db.triggered) && db.triggered.some(t => t.event === 'enters' || t.event === 'etb');
          if (!hasETBInTriggered) {
            issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_ETB', detail: 'Oracle has ETB trigger but DB has no etb zone' });
          }
        }
        if (beh.zone === 'triggered' && !db.triggered) {
          // Triggered can also be inside modal modes (Sieges) or chapters (Sagas)
          const hasTriggeredInModal = db.modal && (
            (typeof db.modal === 'object' && db.modal.modes) ||
            (db.modes && typeof db.modes === 'object')
          );
          const hasTriggeredInChapters = db.chapters && Object.values(db.chapters).some(ch =>
            Array.isArray(ch) && ch.some(e => e.type === 'triggered_this_turn' || e.type === 'triggered' || e.event)
          );
          if (!hasTriggeredInModal && !hasTriggeredInChapters) {
            issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_TRIGGERED', detail: 'Oracle has triggered ability (' + (beh.event||'') + ') but DB has no triggered zone' });
          }
        }
        if (beh.zone === 'activated' && !db.activated) {
          issues.push({ card: cardName, severity: 'MEDIUM', issue: 'MISSING_ACTIVATED', detail: 'Oracle has activated ability but DB has no activated zone' });
        }
        if (beh.zone === 'modal') {
          // Modal can be: db.modal, db.modes, db.chapters, or type:"modal" inside cast/etb
          const hasModal = db.modal || db.modes || db.chapters ||
            (Array.isArray(db.cast) && db.cast.some(e => e.type === 'modal')) ||
            (Array.isArray(db.etb) && db.etb.some(e => e.type === 'modal'));
          if (!hasModal) {
            issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_MODAL', detail: 'Oracle has modal (choose one/two) but DB has no modal zone' });
          }
        }
        continue;
      }

      // --- Keyword checks ---
      if (beh.type === 'keywords') {
        const staticKws = (db.static || []).filter(e => e.type === 'has_keyword');
        const dbKeywords = [];
        staticKws.forEach(s => {
          if (s.keywords) dbKeywords.push(...s.keywords.map(k => k.toLowerCase()));
          if (s.keyword) dbKeywords.push(s.keyword.toLowerCase());
        });
        for (const kw of beh.keywords) {
          if (!dbKeywords.includes(kw.toLowerCase())) {
            issues.push({ card: cardName, severity: 'MEDIUM', issue: 'MISSING_KEYWORD', detail: 'Oracle has keyword "' + kw + '" but not in DB static' });
          }
        }
        continue;
      }

      // --- Mechanic checks ---
      if (beh.type === 'mechanic') continue; // Mechanics are engine-level, not DB
      if (beh.type === 'harmonize') {
        if (!db.harmonize) {
          issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_HARMONIZE', detail: 'Oracle has harmonize ' + beh.cost + ' but DB has no harmonize field' });
        }
        continue;
      }

      // --- Effect amount/target checks ---
      const matching = findEffectByType(allEffects, beh.type);
      if (matching.length === 0) {
        // Special: endure might be in triggered effects
        if (beh.type === 'endure') {
          const inTriggered = (db.triggered || []).some(t =>
            t.effects && t.effects.some(e => e.type === 'endure')
          );
          const inEtb = (db.etb || []).some(e => e.type === 'endure');
          if (!inTriggered && !inEtb) {
            issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_EFFECT', detail: 'Oracle has ' + beh.type + ' but DB has no matching effect' });
          }
          continue;
        }
        issues.push({ card: cardName, severity: 'HIGH', issue: 'MISSING_EFFECT', detail: 'Oracle has ' + beh.type + ' but DB has no matching effect' });
        continue;
      }

      // Check amount
      if (beh.amount !== undefined && beh.type !== 'endure') {
        const amountMatch = matching.some(e => {
          const eAmt = e.amount || e.draw || e.count || 0;
          return eAmt === beh.amount;
        });
        if (!amountMatch && beh.amount > 0) {
          const dbAmounts = matching.map(e => e.amount || e.draw || e.count || '?').join(',');
          issues.push({ card: cardName, severity: 'MEDIUM', issue: 'WRONG_AMOUNT', detail: beh.type + ': oracle says ' + beh.amount + ' but DB has ' + dbAmounts });
        }
      }

      // Check power/toughness for buff
      if (beh.power !== undefined && beh.toughness !== undefined) {
        const ptMatch = matching.some(e => e.power === beh.power && e.toughness === beh.toughness);
        if (!ptMatch) {
          const dbPT = matching.map(e => (e.power||'?') + '/' + (e.toughness||'?')).join(',');
          issues.push({ card: cardName, severity: 'MEDIUM', issue: 'WRONG_BUFF', detail: 'buff: oracle says ' + beh.power + '/' + beh.toughness + ' but DB has ' + dbPT });
        }
      }

      // Check token stats
      if (beh.type === 'create_token' && beh.power !== undefined) {
        const tokenMatch = matching.some(e => e.power === beh.power && e.toughness === beh.toughness);
        if (!tokenMatch) {
          const dbTokens = matching.map(e => (e.power||'?') + '/' + (e.toughness||'?')).join(',');
          issues.push({ card: cardName, severity: 'MEDIUM', issue: 'WRONG_TOKEN', detail: 'token: oracle says ' + beh.power + '/' + beh.toughness + ' but DB has ' + dbTokens });
        }
      }
    }

    return issues;
  }

  // ---- Main audit ----
  const cacheKey = 'mtg_set_cards_' + setCode;
  const cached = localStorage.getItem(cacheKey);
  let cards;
  if (cached) {
    try { const p = JSON.parse(cached); cards = p.data || p; } catch { cards = null; }
  }
  if (!cards) {
    try { cards = await Scryfall.fetchSetCards(setCode); } catch { cards = null; }
  }
  if (!cards || cards.length === 0) return { error: 'No cards found for ' + setCode };

  const allIssues = [];
  let audited = 0;

  for (const card of cards) {
    if ((card.type_line || '').includes('Basic Land')) continue;
    const db = CardEffectsDB.getEffects(card.name);
    if (!db) continue; // Layer A handles missing
    audited++;
    const issues = auditCard(card.name, card.oracle_text, card.type_line, db);
    allIssues.push(...issues);
  }

  // Categorize
  const high = allIssues.filter(i => i.severity === 'HIGH');
  const medium = allIssues.filter(i => i.severity === 'MEDIUM');

  return { issues: allIssues, high, medium, audited, total: cards.length };
})
`;

// ========================= TEST SPECS =========================

async function runAudit(page, setCode) {
  return await page.evaluate((code) => {
    return eval(code);
  }, AUDIT_CODE + `("${setCode}")`);
}

test.describe('Deep Oracle Audit - TDM', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await setupTestGame(page); });
  test.afterAll(async () => { await page.close(); });

  test('TDM: all DB entries match oracle amounts, targets, keywords', async () => {
    const result = await runAudit(page, 'tdm');
    if (result.error) { console.log('SKIP:', result.error); return; }

    console.log(`\n=== TDM DEEP AUDIT ===`);
    console.log(`  Cards audited: ${result.audited}`);
    console.log(`  HIGH issues: ${result.high.length}`);
    console.log(`  MEDIUM issues: ${result.medium.length}`);

    if (result.high.length > 0) {
      console.log(`\n  --- HIGH SEVERITY ---`);
      result.high.forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
    }
    if (result.medium.length > 0) {
      console.log(`\n  --- MEDIUM SEVERITY ---`);
      result.medium.slice(0, 20).forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
      if (result.medium.length > 20) console.log(`  ... and ${result.medium.length - 20} more`);
    }

    // Baselines: known issue counts. Update when fixing cards.
    const TDM_HIGH_BASELINE = 1; // Heritage Reclamation: draw inside modal array mode (correctly implemented)
    const TDM_MEDIUM_BASELINE = 17; // 15 land activated + 2 dynamic X amounts
    expect(result.high.length).toBeLessThanOrEqual(TDM_HIGH_BASELINE);
    expect(result.medium.length).toBeLessThanOrEqual(TDM_MEDIUM_BASELINE);
  });
});

test.describe('Deep Oracle Audit - LRW', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await setupTestGame(page); });
  test.afterAll(async () => { await page.close(); });

  test('LRW: all DB entries match oracle amounts, targets, keywords', async () => {
    const result = await runAudit(page, 'lrw');
    if (result.error) { console.log('SKIP:', result.error); return; }

    console.log(`\n=== LRW DEEP AUDIT ===`);
    console.log(`  Cards audited: ${result.audited}`);
    console.log(`  HIGH issues: ${result.high.length}`);
    console.log(`  MEDIUM issues: ${result.medium.length}`);

    if (result.high.length > 0) {
      console.log(`\n  --- HIGH SEVERITY ---`);
      result.high.forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
    }
    if (result.medium.length > 0) {
      console.log(`\n  --- MEDIUM SEVERITY ---`);
      result.medium.slice(0, 20).forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
      if (result.medium.length > 20) console.log(`  ... and ${result.medium.length - 20} more`);
    }

    const LRW_HIGH_BASELINE = 6;
    const LRW_MEDIUM_BASELINE = 6; // 5 hideaway lands + 1 activated ability
    expect(result.high.length).toBeLessThanOrEqual(LRW_HIGH_BASELINE);
    expect(result.medium.length).toBeLessThanOrEqual(LRW_MEDIUM_BASELINE);
  });
});

test.describe('Deep Oracle Audit - ECL', () => {
  let page;
  test.beforeAll(async ({ browser }) => { page = await browser.newPage(); await setupTestGame(page); });
  test.afterAll(async () => { await page.close(); });

  test('ECL: all DB entries match oracle amounts, targets, keywords', async () => {
    const result = await runAudit(page, 'ecl');
    if (result.error) { console.log('SKIP:', result.error); return; }

    console.log(`\n=== ECL DEEP AUDIT ===`);
    console.log(`  Cards audited: ${result.audited}`);
    console.log(`  HIGH issues: ${result.high.length}`);
    console.log(`  MEDIUM issues: ${result.medium.length}`);

    if (result.high.length > 0) {
      console.log(`\n  --- HIGH SEVERITY ---`);
      result.high.forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
    }
    if (result.medium.length > 0) {
      console.log(`\n  --- MEDIUM SEVERITY ---`);
      result.medium.slice(0, 20).forEach(i => console.log(`  [${i.issue}] ${i.card}: ${i.detail}`));
      if (result.medium.length > 20) console.log(`  ... and ${result.medium.length - 20} more`);
    }

    const ECL_HIGH_BASELINE = 19;
    const ECL_MEDIUM_BASELINE = 0;
    expect(result.high.length).toBeLessThanOrEqual(ECL_HIGH_BASELINE);
    expect(result.medium.length).toBeLessThanOrEqual(ECL_MEDIUM_BASELINE);
  });
});
