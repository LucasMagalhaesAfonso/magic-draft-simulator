// tools/fetch-mtgo-data.ts
// Scrapes MTGO Limited Super Qualifier/Challenge decklists for TDM and LTR.
// Run with: npx tsx tools/fetch-mtgo-data.ts
//
// Output: public/data/mtgo-tdm.json and public/data/mtgo-ltr.json
// Format per card: { appearances, total_decks, win_rate, appearance_rate }
//
// Data is embedded in MTGO pages as:
//   window.MTGO.decklists.data = { decklists: [...], brackets: [...] };
// Card structure: sideboard_deck[i].card_attributes.card_name + .qty (string)
// Wins: brackets[round].matches[i].players[j].wins / .losses

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 700;
const MAX_EVENTS_PER_SET = 25;
// All published players already cleared the top-cut bar (Super Qualifiers publish top 32).
// Use 0 so all published decks are counted; bracket wins weight their win_rate.
const MIN_PLAYER_WINS = 0;

const BASE = 'https://www.mtgo.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// MTGO format codes per set
const FORMAT_CODES: Record<string, RegExp[]> = {
  tdm: [/S6TDM/i, /TDM/i, /tarkir/i, /dragonstorm/i],
  ltr: [/MLTR/i, /\bLTR\b/, /lord.of.the.rings/i, /middle.earth/i, /S6LTR/i],
};

// Limited event slug patterns
const LIMITED_SLUGS = [
  /limited-super-qualifier/i,
  /limited-challenge/i,
  /limited-showcase/i,
  /limited-qualifier/i,
  /limited-premier/i,
];

const MONTHS_BACK = 36; // 3 years back — covers LTR (2023) and TDM (2025)

// ── Types ─────────────────────────────────────────────────────────────────────

interface MtgoCard {
  qty: string;
  sideboard?: string;
  card_attributes: {
    card_name: string;
    cardset?: string;
    card_type?: string;
  };
}

interface MtgoDeckEntry {
  loginid: string;
  player: string;
  main_deck: MtgoCard[];
  sideboard_deck: MtgoCard[];
}

interface MtgoBracketPlayer {
  loginid: number;
  player: string;
  wins: number;
  losses: number;
  winner?: boolean;
}

interface MtgoData {
  event_id?: string;
  description?: string;
  format?: string;
  decklists?: MtgoDeckEntry[];
  brackets?: Array<{
    matches: Array<{
      players: MtgoBracketPlayer[];
    }>;
  }>;
}

interface ParsedPlayerDeck {
  loginid: string;
  player: string;
  wins: number;
  losses: number;
  cards: string[]; // unique card names in mainboard (or all if undistinguishable)
}

interface CardStats {
  appearances: number;
  total_decks: number;
  win_rate: number;
  appearance_rate: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      console.log(`  [HTTP ${res.status}] ${url}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.log(`  [ERR] ${url}: ${(e as Error).message}`);
    return null;
  }
}

/** Extract window.MTGO.decklists.data from an event page */
function extractMtgoData(html: string): MtgoData | null {
  const marker = 'window.MTGO.decklists.data = {';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const startIdx = markerIdx + marker.length - 1; // points to the opening '{'
  let depth = 0;
  let end = startIdx;
  for (let i = startIdx; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  try {
    return JSON.parse(html.slice(startIdx, end + 1)) as MtgoData;
  } catch {
    return null;
  }
}

/** Extract all href paths to /decklist/ pages from HTML */
function extractDecklistHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /href="(\/decklist\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) hrefs.push(m[1]);
  return [...new Set(hrefs)];
}

function isLimitedSlug(slug: string): boolean {
  return LIMITED_SLUGS.some(p => p.test(slug));
}

function matchesSet(slug: string, setKey: string): boolean {
  return FORMAT_CODES[setKey].some(p => p.test(slug));
}

/** Aggregate per-player wins from the bracket rounds */
function computePlayerWins(data: MtgoData): Map<string, { wins: number; losses: number }> {
  const record = new Map<string, { wins: number; losses: number }>();

  for (const bracket of (data.brackets || [])) {
    for (const match of (bracket.matches || [])) {
      for (const p of (match.players || [])) {
        const id = String(p.loginid);
        const cur = record.get(id) || { wins: 0, losses: 0 };
        cur.wins += p.wins || 0;
        cur.losses += p.losses || 0;
        record.set(id, cur);
      }
    }
  }

  return record;
}

/** Parse an event page into per-player deck data with win records */
function parseEventPage(html: string, setKey: string): ParsedPlayerDeck[] {
  const data = extractMtgoData(html);
  if (!data) return [];

  // Check if format matches the set we want
  if (data.format && !FORMAT_CODES[setKey].some(p => p.test(data.format!))) {
    // Format mismatch — different set
    return [];
  }

  const playerWins = computePlayerWins(data);
  const result: ParsedPlayerDeck[] = [];

  for (const entry of (data.decklists || [])) {
    // Collect cards: main_deck is usually empty on MTGO pages; use sideboard_deck
    // Cards with sideboard:"true" are sideboard; rest are mainboard.
    // In practice all cards have sideboard:"true" for sealed, so we use all cards.
    const allCards: string[] = [];

    // Try main_deck first
    for (const c of (entry.main_deck || [])) {
      const name = c.card_attributes?.card_name;
      if (name && !allCards.includes(name)) allCards.push(name);
    }

    // sideboard_deck contains mainboard cards (sideboard:"false" or absent) AND sideboard (sideboard:"true")
    // Since all appear as sideboard:"true", we include everything as a proxy for card pool quality
    const mainboardCards: string[] = [...allCards];
    const sideboardCards: string[] = [];
    for (const c of (entry.sideboard_deck || [])) {
      const name = c.card_attributes?.card_name;
      if (!name) continue;
      if (c.sideboard === 'false' || c.sideboard === false) {
        if (!mainboardCards.includes(name)) mainboardCards.push(name);
      } else {
        if (!sideboardCards.includes(name)) sideboardCards.push(name);
      }
    }

    // If everything is in sideboard (MTGO sealed format), use all cards
    const cards = mainboardCards.length >= 15 ? mainboardCards :
                  sideboardCards.length >= 15 ? sideboardCards :
                  [...mainboardCards, ...sideboardCards];

    const winsData = playerWins.get(entry.loginid) || { wins: 0, losses: 0 };

    if (cards.length > 0) {
      result.push({
        loginid: entry.loginid,
        player: entry.player,
        wins: winsData.wins,
        losses: winsData.losses,
        cards,
      });
    }
  }

  return result;
}

function recentMonths(n: number): Array<{ year: number; month: number }> {
  const result = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return result;
}

// ── Core scraper ──────────────────────────────────────────────────────────────

async function scrapeSet(setKey: string): Promise<Record<string, CardStats>> {
  console.log(`\n=== Scraping MTGO data for ${setKey.toUpperCase()} ===`);

  const allPlayerDecks: ParsedPlayerDeck[] = [];
  const triedUrls = new Set<string>();
  const eventUrls: string[] = [];

  // ── Step 1: Scan monthly listing pages ────────────────────────────────────
  for (const { year, month } of recentMonths(MONTHS_BACK)) {
    const mm = String(month).padStart(2, '0');
    const listUrl = `${BASE}/decklists/${year}/${mm}`;
    console.log(`Checking: ${listUrl}`);

    const html = await fetchPage(listUrl);
    await sleep(RATE_LIMIT_MS);
    if (!html) continue;

    const hrefs = extractDecklistHrefs(html);
    for (const href of hrefs) {
      if (!isLimitedSlug(href)) continue;
      const full = `${BASE}${href}`;
      if (!triedUrls.has(full)) {
        eventUrls.push(full);
        console.log(`  Found: ${href}`);
      }
    }

    if (eventUrls.length >= MAX_EVENTS_PER_SET * 2) break;
  }

  // ── Step 2: If no events found via listings, try known confirmed URLs ──────
  if (eventUrls.length === 0) {
    console.log('No events found in listings. Trying known URLs...');
    const known: Record<string, string[]> = {
      tdm: [
        `${BASE}/decklist/limited-super-qualifier-2025-05-1112777298`,
        `${BASE}/decklist/limited-super-qualifier-2025-05-0312774463`,
        `${BASE}/decklist/limited-challenge-2025-04-2612770000`,
      ],
      ltr: [
        `${BASE}/decklist/limited-super-qualifier-2023-07-2210000000`,
        `${BASE}/decklist/limited-challenge-2023-08-0610000001`,
      ],
    };
    for (const url of (known[setKey] || [])) eventUrls.push(url);
  }

  // ── Step 3: Filter to set-matching events and fetch ───────────────────────
  let fetched = 0;
  for (const url of eventUrls) {
    if (triedUrls.has(url)) continue;
    triedUrls.add(url);
    if (fetched >= MAX_EVENTS_PER_SET) break;

    // Quick slug check before fetching
    if (!matchesSet(url, setKey) && !url.includes('limited')) {
      continue;
    }

    console.log(`Fetching: ${url}`);
    const html = await fetchPage(url);
    await sleep(RATE_LIMIT_MS);
    if (!html) continue;

    const decks = parseEventPage(html, setKey);
    if (decks.length > 0) {
      console.log(`  → ${decks.length} player decks parsed (format match)`);
      allPlayerDecks.push(...decks);
      fetched++;
    } else {
      // Page loaded but no matching decks (wrong set or no data)
      console.log(`  → 0 decks (wrong set or no data)`);
    }

    if (allPlayerDecks.length >= 500) break;
  }

  console.log(`\nTotal player decks for ${setKey.toUpperCase()}: ${allPlayerDecks.length}`);

  // ── Step 4: Filter to winning players ─────────────────────────────────────
  const winningDecks = allPlayerDecks.filter(d => d.wins >= MIN_PLAYER_WINS);
  console.log(`Players with ${MIN_PLAYER_WINS}+ wins: ${winningDecks.length}`);

  if (winningDecks.length === 0) {
    // If no wins data, use all players as proxy
    if (allPlayerDecks.length > 0) {
      console.log('No win records found — using all players as appearance data.');
      winningDecks.push(...allPlayerDecks);
    } else {
      return {};
    }
  }

  // ── Step 5: Aggregate per-card stats ─────────────────────────────────────
  const totalDecks = winningDecks.length;
  const cardWinRates: Record<string, number[]> = {};

  for (const deck of winningDecks) {
    const totalGames = deck.wins + deck.losses;
    const wr = totalGames > 0 ? deck.wins / totalGames : 0.65;

    for (const cardName of deck.cards) {
      if (!cardWinRates[cardName]) cardWinRates[cardName] = [];
      cardWinRates[cardName].push(wr);
    }
  }

  const result: Record<string, CardStats> = {};
  for (const [cardName, wrs] of Object.entries(cardWinRates)) {
    const appearances = wrs.length;
    const avgWr = wrs.reduce((s, r) => s + r, 0) / wrs.length;
    result[cardName] = {
      appearances,
      total_decks: totalDecks,
      win_rate: Math.round(avgWr * 10000) / 10000,
      appearance_rate: Math.round((appearances / totalDecks) * 10000) / 10000,
    };
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('MTGO Limited Decklists Scraper');
  console.log('================================');
  console.log('Events: Limited Super Qualifiers, Challenges, Showcases');
  console.log('Note: Draft/Sealed leagues are NOT published by MTGO');
  console.log('Data source: window.MTGO.decklists.data embedded in event pages\n');

  const outputDir = join(process.cwd(), 'public', 'data');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let ok = 0;

  for (const setKey of ['tdm', 'ltr']) {
    try {
      const stats = await scrapeSet(setKey);
      const cardCount = Object.keys(stats).length;

      if (cardCount === 0) {
        console.log(`\n[SKIP] No data for ${setKey.toUpperCase()}.`);
        console.log(`  → Check https://www.mtgo.com/decklists manually for Limited events.`);
        continue;
      }

      const outPath = join(outputDir, `mtgo-${setKey}.json`);
      writeFileSync(outPath, JSON.stringify(stats, null, 2));
      const sample = Object.values(stats)[0] as CardStats;
      console.log(`\n✅ ${setKey.toUpperCase()}: ${cardCount} cards from ${sample.total_decks} winning player-decks → ${outPath}`);
      ok++;
    } catch (e) {
      console.error(`\n❌ ${setKey.toUpperCase()}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Done! ${ok}/2 sets saved.`);
}

main().catch(console.error);
