// tools/parse-arena-log.ts
// Parses MTGA draft log and extracts pick statistics.
// Requires detailed logging enabled in Arena (Settings → Account → Detailed Logs).
//
// Usage:
//   npx tsx tools/parse-arena-log.ts [logPath]
//   npx tsx tools/parse-arena-log.ts  (auto-detects Arena log location)
//
// Output: public/data/arena-picks-{set}.json per set found in the log.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PickEvent {
  draftId: string;
  packNumber: number;
  pickNumber: number;
  available: number[];  // Arena grpIds in this pack
  picked: number;       // Arena grpId the player chose
}

interface CardPickStats {
  picks: number;
  seen: number;
  pick_rate: number;
}

// ── Arena log file locations ──────────────────────────────────────────────────

function findArenaLog(explicit?: string): string | null {
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    // Windows
    join(os.homedir(), 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log'),
    join(os.homedir(), 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'output_log.txt'),
    // macOS
    join(os.homedir(), 'Library', 'Logs', 'Wizards Of The Coast', 'MTGA', 'Player.log'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ── Arena ID → card name map (fetched from Scryfall) ─────────────────────────

async function fetchArenaIdMap(sets: string[]): Promise<Map<number, { name: string; set: string }>> {
  const map = new Map<number, { name: string; set: string }>();

  for (const setCode of sets) {
    console.log(`  Fetching Arena IDs for ${setCode.toUpperCase()} from Scryfall...`);
    let url: string | null =
      `https://api.scryfall.com/cards/search?q=set:${setCode}+game:arena&unique=cards`;

    while (url) {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'magic-draft-simulator/1.0' },
      });
      if (!res.ok) { console.warn(`  Scryfall error ${res.status} for ${setCode}`); break; }
      const data: any = await res.json();

      for (const card of data.data || []) {
        if (card.arena_id && card.name) {
          map.set(card.arena_id, { name: card.name, set: setCode.toLowerCase() });
        }
        // DFC: card_faces each have their own arena representation but same grpId
        if (card.card_faces) {
          for (const face of card.card_faces) {
            if (face.arena_id && face.name) {
              map.set(face.arena_id, { name: card.name, set: setCode.toLowerCase() });
            }
          }
        }
      }

      url = data.has_more ? data.next_page : null;
      if (url) await new Promise(r => setTimeout(r, 150)); // rate limit
    }

    console.log(`  ${setCode.toUpperCase()}: ${[...map.values()].filter(v => v.set === setCode.toLowerCase()).length} cards mapped`);
  }

  return map;
}

// ── Log parser ────────────────────────────────────────────────────────────────

function parseLog(logContent: string): PickEvent[] {
  const picks: PickEvent[] = [];

  // Track pack contents keyed by draftId+pack+pick
  const packMap = new Map<string, number[]>();

  // We process line by line looking for JSON blobs after known prefixes
  const lines = logContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // ── Pack contents ── (what cards were available)
    // Format A: Draft.Notify with DraftPack/DraftStatus payload
    if (line.includes('Draft.Notify') || line.includes('Draft.DraftStatus') || line.includes('Draft.DraftPack')) {
      // Collect the JSON blob (may span multiple lines)
      let json = '';
      let j = i;
      while (j < lines.length) {
        json += lines[j];
        try {
          const obj = JSON.parse(json.replace(/^.*?Draft\.Notify\s*-->\s*/, '').trim());
          _processDraftNotify(obj, packMap);
          break;
        } catch {
          // Not valid JSON yet, keep accumulating
        }
        j++;
        if (j - i > 20) break; // bail after 20 lines
      }
    }

    // ── Player pick ──
    if (line.includes('Draft.MakePick') || line.includes('-->') && lines[i + 1]?.includes('packNumber')) {
      let json = '';
      let j = i;
      while (j < lines.length) {
        json += lines[j];
        try {
          const cleaned = json.replace(/^.*?Draft\.MakePick\s*/, '').trim();
          const obj = JSON.parse(cleaned);
          const ev = _processMakePick(obj, packMap);
          if (ev) picks.push(ev);
          break;
        } catch {
          // Keep accumulating
        }
        j++;
        if (j - i > 20) break;
      }
    }

    // Also try single-line JSON blobs starting with { that contain draft events
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        _processDraftNotify(obj, packMap);
        const ev = _processMakePick(obj, packMap);
        if (ev) picks.push(ev);
      } catch { /* not valid JSON */ }
    }

    i++;
  }

  return picks;
}

function _processDraftNotify(obj: any, packMap: Map<string, number[]>): void {
  const payload = obj?.payload ?? obj;
  const type: string = obj?.type ?? payload?.type ?? '';

  // DraftPack format (older): payload.CardsInPack = [{grpId:N}]
  if (type.includes('DraftPack') && Array.isArray(payload?.CardsInPack)) {
    const draftId = payload.draftId ?? 'unknown';
    const pack = (payload.SelfPack ?? 1) - 1;
    const pick = payload.SelfPick ?? 0;
    const available = payload.CardsInPack.map((c: any) => c.grpId ?? c).filter(Number.isInteger);
    packMap.set(`${draftId}:${pack}:${pick}`, available);
    return;
  }

  // DraftStatus format (newer): payload.cardIds = [N, N, ...]
  if ((type.includes('DraftStatus') || type.includes('DraftPick')) && Array.isArray(payload?.cardIds)) {
    const draftId = payload.draftId ?? 'unknown';
    const pack = payload.packNumber ?? 0;
    const pick = payload.pickNumber ?? 0;
    const available = payload.cardIds.filter(Number.isInteger);
    packMap.set(`${draftId}:${pack}:${pick}`, available);
    return;
  }

  // Sometimes the object itself IS the payload
  if (Array.isArray(obj?.cardIds)) {
    const draftId = obj.draftId ?? 'unknown';
    packMap.set(`${draftId}:${obj.packNumber ?? 0}:${obj.pickNumber ?? 0}`, obj.cardIds);
  }
}

function _processMakePick(obj: any, packMap: Map<string, number[]>): PickEvent | null {
  const payload = obj?.payload ?? obj;
  const pickedIds: number[] = payload?.cardIds ?? payload?.cardId ? [payload.cardId] : [];
  if (pickedIds.length === 0) return null;

  const draftId = payload.draftId ?? obj.draftId ?? 'unknown';
  const pack = payload.packNumber ?? obj.packNumber ?? 0;
  const pick = payload.pickNumber ?? obj.pickNumber ?? 0;
  const picked = pickedIds[0];
  if (!Number.isInteger(picked)) return null;

  // Look up available cards from pack map
  const available = packMap.get(`${draftId}:${pack}:${pick}`) ?? [];

  return { draftId, packNumber: pack, pickNumber: pick, available, picked };
}

// ── Aggregate picks into per-set statistics ───────────────────────────────────

function aggregatePicks(
  events: PickEvent[],
  idMap: Map<number, { name: string; set: string }>
): Record<string, Record<string, CardPickStats>> {
  // setCode → cardName → { picks, seen }
  const raw: Record<string, Record<string, { picks: number; seen: number }>> = {};

  let matched = 0;
  for (const ev of events) {
    if (ev.available.length === 0) continue;

    // Determine set from the picked card
    const pickedInfo = idMap.get(ev.picked);
    const setCode = pickedInfo?.set;
    if (!setCode) continue;

    if (!raw[setCode]) raw[setCode] = {};

    matched++;

    for (const grpId of ev.available) {
      const info = idMap.get(grpId);
      if (!info || info.set !== setCode) continue;
      const name = info.name;
      if (!raw[setCode][name]) raw[setCode][name] = { picks: 0, seen: 0 };
      raw[setCode][name].seen++;
      if (grpId === ev.picked) raw[setCode][name].picks++;
    }
  }

  console.log(`  Matched ${matched}/${events.length} pick events to known sets`);

  // Convert to final format
  const result: Record<string, Record<string, CardPickStats>> = {};
  for (const [set, cards] of Object.entries(raw)) {
    result[set] = {};
    for (const [name, stats] of Object.entries(cards)) {
      if (stats.seen < 3) continue; // skip cards seen fewer than 3 times
      result[set][name] = {
        picks: stats.picks,
        seen: stats.seen,
        pick_rate: Math.round((stats.picks / stats.seen) * 1000) / 1000,
      };
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🃏 MTGA Draft Log Parser\n');

  const logPath = findArenaLog(process.argv[2]);
  if (!logPath) {
    console.error('❌ Arena log not found. Paths checked:');
    console.error('   • %APPDATA%/../LocalLow/Wizards Of The Coast/MTGA/Player.log');
    console.error('   • Pass explicit path: npx tsx tools/parse-arena-log.ts <path>');
    process.exit(1);
  }

  console.log(`📂 Log: ${logPath}`);
  const logContent = readFileSync(logPath, 'utf-8');
  console.log(`   Size: ${(logContent.length / 1024).toFixed(0)} KB`);

  // Quick check: does the log have any draft events?
  const hasDraft = logContent.includes('Draft.MakePick') || logContent.includes('DraftPack') || logContent.includes('DraftStatus');
  if (!hasDraft) {
    console.error('\n❌ No draft events found in log.');
    console.error('   Make sure "Detailed Logs" is enabled in Arena (Settings → Account).');
    process.exit(1);
  }

  // Step 1: Fetch Arena ID → card name map
  console.log('\n📡 Fetching Arena card IDs from Scryfall...');
  const idMap = await fetchArenaIdMap(['tdm', 'ltr']);
  console.log(`   Total: ${idMap.size} Arena IDs mapped`);

  // Step 2: Parse log
  console.log('\n🔍 Parsing draft events...');
  const events = parseLog(logContent);
  console.log(`   Found ${events.length} pick events`);

  if (events.length === 0) {
    console.warn('\n⚠️  No pick events parsed. The log format may differ from expected.');
    console.warn('   Try enabling detailed logs in Arena and playing a draft first.');
    process.exit(0);
  }

  // Step 3: Aggregate
  console.log('\n📊 Aggregating pick statistics...');
  const stats = aggregatePicks(events, idMap);

  // Step 4: Save
  const outDir = join(process.cwd(), 'public', 'data');
  let saved = 0;
  for (const [setCode, cards] of Object.entries(stats)) {
    const cardCount = Object.keys(cards).length;
    if (cardCount === 0) continue;
    const outPath = join(outDir, `arena-picks-${setCode}.json`);
    writeFileSync(outPath, JSON.stringify(cards, null, 2));
    const avgPickRate = Object.values(cards).reduce((s, c) => s + c.pick_rate, 0) / cardCount;
    console.log(`   ✅ ${setCode.toUpperCase()}: ${cardCount} cards (avg pick rate: ${(avgPickRate * 100).toFixed(1)}%) → ${outPath}`);
    saved++;
  }

  if (saved === 0) {
    console.warn('\n⚠️  No matching draft data found for TDM or LTR sets.');
    console.warn('   Only TDM and LTR drafts are supported currently.');
  } else {
    console.log(`\n✅ Done! Run "npm run build" to bundle the data.`);
  }
}

main().catch(console.error);
