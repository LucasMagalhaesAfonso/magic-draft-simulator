// seventeen-lands.ts — 17lands card ratings integration
//
// Loads bundled ratings from public/data/17lands-{set}.json (shipped with the app).
// Provides BREAD-compatible scores based on drawn_improvement_win_rate (DIWR).
//
// Score formula:
//   score = 5.0 + (DIWR × 150), clamped to [0.5, 11.0]
//   +0.033 DIWR → 10.0 (bomb)
//   +0.020 DIWR → 8.0  (strong rare)
//   +0.010 DIWR → 6.5  (solid pick)
//    0.000 DIWR → 5.0  (average)
//   -0.010 DIWR → 3.5  (below average)
//   -0.020 DIWR → 2.0  (unplayable)

export interface LandsRating {
  name: string;
  avg_pick: number;
  game_count: number;
  win_rate: number;
  drawn_win_rate: number;
  drawn_improvement_win_rate: number;
  play_rate: number;
}

type RatingsMap = Record<string, LandsRating>; // lowercase name → rating

const _ratings: Record<string, RatingsMap> = {};
const _loadedSets = new Set<string>();
let _preloadPromise: Promise<void> | null = null;

async function _loadSet(setCode: string): Promise<void> {
  const key = setCode.toLowerCase();
  if (_loadedSets.has(key)) return;
  _loadedSets.add(key); // mark immediately to prevent duplicate fetches

  try {
    const url = `/data/17lands-${key}.json`;
    const res = await fetch(url);
    if (!res.ok) return; // file not present — skip silently
    const data: LandsRating[] = await res.json();

    const map: RatingsMap = {};
    for (const card of data) {
      if (card.name) map[card.name.toLowerCase()] = card;
    }
    _ratings[key] = map;
    console.log(`[17lands] Loaded ${data.length} ratings for ${setCode.toUpperCase()}`);
  } catch {
    // Silently skip if file missing or malformed
  }
}

/** Preload ratings for all supported sets. Safe to call multiple times. */
export async function preloadRatings(): Promise<void> {
  if (_preloadPromise) return _preloadPromise;
  _preloadPromise = Promise.all(['tdm', 'ltr'].map(_loadSet)).then(() => {});
  return _preloadPromise;
}

/** Get raw rating entry for a card. Searches all loaded sets. */
export function getRating(cardName: string): LandsRating | null {
  const nameLower = (cardName || '').toLowerCase();
  for (const map of Object.values(_ratings)) {
    if (map[nameLower]) return map[nameLower];
  }
  return null;
}

/**
 * Convert 17lands data to a BREAD-compatible score (0-10 scale).
 * Returns null if no data or game_count < 100 (insufficient sample).
 */
export function getLandsScore(cardName: string): number | null {
  const rating = getRating(cardName);
  if (!rating || rating.game_count < 100) return null;

  const diwr = rating.drawn_improvement_win_rate;
  const raw = 5.0 + diwr * 150;
  return Math.max(0.5, Math.min(11.0, raw));
}

/**
 * Trust factor [0, 1] — how much to weight 17lands vs BREAD.
 * Scales linearly from 0 at 100 games to 1.0 at 500+ games.
 */
export function getLandsTrust(cardName: string): number {
  const rating = getRating(cardName);
  if (!rating || rating.game_count < 100) return 0;
  return Math.min(1.0, (rating.game_count - 100) / 400);
}

/**
 * Blend a BREAD score with the 17lands score for the given card.
 * Max blend weight is 65% 17lands when trust = 1.0.
 * Falls back to pure BREAD if no 17lands data.
 */
export function blendWithLands(cardName: string, breadScore: number): number {
  const landsScore = getLandsScore(cardName);
  if (landsScore === null) return breadScore;
  const trust = getLandsTrust(cardName);
  const landsWeight = trust * 0.65;
  return breadScore * (1 - landsWeight) + landsScore * landsWeight;
}

// ── Gameplay metrics (drawn_win_rate, play_rate) ─────────────────────────────
// Average DWR across sets is ~0.594 (skewed by good players using 17lands).
// We use this as the baseline so the bonus distinguishes above/below average.
const BASELINE_DWR = 0.594;

/**
 * Returns a gameplay bonus/penalty based on how the card performs in ACTUAL GAMES
 * when drawn, compared to the set average. Range: [-5, +5].
 *
 * Source: 17lands drawn_win_rate — aggregated from thousands of human games.
 *
 * Examples (TDM):
 *   Dragonbroods' Relic  DWR 0.673 → +2.4 bonus (overperforms)
 *   Piercing Exhale      DWR 0.630 → +1.1 bonus
 *   Jeskai Devotee       DWR 0.547 → -1.4 penalty (underperforms in games)
 *
 * Returns null if no data or insufficient sample (< 100 games).
 */
export function getGameplayBonus(cardName: string): number | null {
  const rating = getRating(cardName);
  if (!rating || rating.game_count < 100 || rating.drawn_win_rate === 0) return null;
  const bonus = (rating.drawn_win_rate - BASELINE_DWR) * 20;
  return Math.max(-5, Math.min(5, bonus));
}

/**
 * Returns the play rate (0–1) — how often the card is played when drawn.
 * Low play_rate (<0.5) indicates a situational card that humans often hold.
 * Returns null if no data.
 */
export function getPlayRate(cardName: string): number | null {
  const rating = getRating(cardName);
  if (!rating || rating.game_count < 100) return null;
  return rating.play_rate;
}

/** Returns whether 17lands data is loaded for at least one set. */
export function hasRatingsData(): boolean {
  return Object.keys(_ratings).length > 0;
}

/** Stats summary for UI display. */
export function getRatingsStats(): { sets: string[]; totalCards: number } {
  const sets = Object.keys(_ratings);
  const totalCards = sets.reduce((n, k) => n + Object.keys(_ratings[k]).length, 0);
  return { sets, totalCards };
}
