// tools/fetch-17lands.ts
// Downloads 17lands card ratings for TDM and LTR and saves to public/data/
// Run with: npx tsx tools/fetch-17lands.ts

import { writeFileSync } from 'fs';
import { join } from 'path';

const SETS = ['TDM', 'LTR'];
const BASE_URL = 'https://www.17lands.com/card_ratings/data';

interface LandsCard {
  name: string;
  color: string;
  rarity: string;
  avg_pick: number;
  game_count: number;
  win_rate: number;
  drawn_win_rate: number;
  drawn_improvement_win_rate: number;
  play_rate: number;
}

async function fetchSet(setCode: string): Promise<LandsCard[]> {
  const url = `${BASE_URL}?expansion=${setCode}&format=PremierDraft`;
  console.log(`Fetching ${url}...`);

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; magic-draft-simulator/1.0)',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for ${setCode}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`Unexpected response format for ${setCode}`);

  return data.map((card: any) => ({
    name: card.name || '',
    color: card.color || '',
    rarity: card.rarity || '',
    avg_pick: Number(card.avg_pick) || 0,
    game_count: Number(card.game_count) || 0,
    win_rate: Number(card.win_rate) || 0,
    drawn_win_rate: Number(card.drawn_win_rate) || 0,
    drawn_improvement_win_rate: Number(card.drawn_improvement_win_rate) || 0,
    play_rate: Number(card.play_rate) || 0,
  })).filter(c => !!c.name);
}

async function main() {
  console.log('17lands Card Ratings Fetcher\n');
  let ok = 0;

  for (const setCode of SETS) {
    try {
      const cards = await fetchSet(setCode);
      const outPath = join(process.cwd(), 'public', 'data', `17lands-${setCode.toLowerCase()}.json`);
      writeFileSync(outPath, JSON.stringify(cards, null, 2));
      const avgGames = Math.round(cards.reduce((s, c) => s + c.game_count, 0) / cards.length);
      console.log(`✅ ${setCode}: ${cards.length} cards (avg ${avgGames} games each) → ${outPath}`);
      ok++;
    } catch (e) {
      console.error(`❌ ${setCode}: ${(e as Error).message}`);
    }
  }

  console.log(`\nDone! ${ok}/${SETS.length} sets fetched.`);
  if (ok > 0) console.log('Run "npm run build" to bundle the data with the app.');
}

main().catch(console.error);
