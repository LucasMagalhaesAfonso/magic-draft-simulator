import { CardEffectsDB } from '../src/engine/card-effects';
import { readFileSync, readdirSync } from 'fs';

const sets = ['ltr', 'tdm'];

for (const setCode of sets) {
  const jsonPath = `legacy-pure-js/js/data/scryfall-${setCode}.json`;
  try { readFileSync(jsonPath); } catch { continue; }
  const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  const cards = data.cards.filter((c: any) =>
    !c.type_line?.includes('Token') &&
    !c.type_line?.includes('Emblem') &&
    !c.type_line?.includes('Basic Land')
  );

  // Check DB coverage
  const noDb = cards.filter((c: any) => !CardEffectsDB[c.name.toLowerCase()]);
  const withAbilities = noDb.filter((c: any) => {
    const o = (c.oracle_text || '').trim();
    if (!o || o.length < 20) return false;
    // Pure keyword creatures are ok without DB
    const kwOnly = /^(Flying|Trample|Vigilance|Lifelink|Deathtouch|First strike|Double strike|Haste|Reach|Menace|Defender|Hexproof|Ward \d+|Flash|Indestructible)(\n(Flying|Trample|Vigilance|Lifelink|Deathtouch|First strike|Double strike|Haste|Reach|Menace|Defender|Hexproof|Ward \d+|Flash|Indestructible))*$/;
    return !kwOnly.test(o);
  });

  // Check test coverage
  let testDir = `tests/cards/${setCode}`;
  let testFiles: string[] = [];
  try { testFiles = readdirSync(testDir).map(f => f.replace('.test.ts', '')); } catch {}

  const slugify = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const noTest = cards.filter((c: any) => !testFiles.includes(slugify(c.name)));

  console.log(`\n=== ${setCode.toUpperCase()} ===`);
  console.log(`Total cards (non-basic): ${cards.length}`);
  console.log(`DB coverage: ${cards.length - noDb.length}/${cards.length} (${noDb.length} missing)`);
  console.log(`  Vanilla/kw-only (ok): ${noDb.length - withAbilities.length}`);
  console.log(`  With abilities but NO DB entry: ${withAbilities.length}`);
  if (withAbilities.length > 0) {
    for (const c of withAbilities) {
      console.log(`    ❌ ${c.name} — ${(c.oracle_text || '').substring(0, 70).replace(/\n/g, ' | ')}`);
    }
  }
  console.log(`Individual card tests: ${testFiles.length}/${cards.length} (${noTest.length} missing)`);
  if (noTest.length > 0 && noTest.length <= 30) {
    for (const c of noTest) {
      console.log(`    ⚠️  ${c.name}`);
    }
  }
}

console.log('\n=== INTEGRATION LAYERS ===');
console.log('Layer 1: Cast flow (mana → cast → stack → resolve → zones)');
console.log('Layer 2: Combat flow (attackers → blockers → damage)');
console.log('Layer 3: Human interaction (scry, surveil, modal overlays)');
console.log('Layer 4a: Oracle-vs-DB audit (anthem/trigger/keyword presence)');
console.log('Layer 4b: Static effects runtime (anthem/equip P/T verification)');
console.log('Layer 4c: Trigger effects runtime (fire trigger → effect resolves)');

console.log('\n=== GAPS NOT COVERED ===');
console.log('1. Card-specific behavior: Each card\'s UNIQUE effects produce correct results');
console.log('   (e.g., "Gandalf draws 3" not "Gandalf draws 2")');
console.log('2. Multi-card interactions: Two cards on BF interacting correctly');
console.log('3. Edge cases: X-cost spells, adventure cards, additional costs');
console.log('4. AI decision quality: AI plays each card sensibly');
console.log('5. Full game simulation: Start-to-finish game completes without crash');
