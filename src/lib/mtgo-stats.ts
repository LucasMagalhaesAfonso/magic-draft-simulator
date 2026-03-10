// mtgo-stats.ts — MTGO decklists card ratings integration
//
// Loads aggregated stats from public/data/mtgo-{set}.json (shipped with the app).
// Stats are derived from 3-1+ winning decks scraped from mtgo.com/decklist.
//
// Score formula (getMtgoScore):
//   score = appearance_rate * 10, clamped [0, 10]
//   appearance_rate 1.0 (in all winning decks)  → 10.0 (bomb)
//   appearance_rate 0.7                          → 7.0  (strong)
//   appearance_rate 0.5                          → 5.0  (average)
//   appearance_rate 0.3                          → 3.0  (below average)
//   appearance_rate < 5 appearances              → null (insufficient data)
//
// Trust formula (getMtgoTrust):
//   0 at < 5 appearances, scales linearly to 1.0 at 30+ appearances

export interface MtgoCardStats {
  appearances: number;
  total_decks: number;
  win_rate: number;
  appearance_rate: number;
}

type StatsMap = Record<string, MtgoCardStats>; // lowercase name → stats

const _stats: Record<string, StatsMap> = {}; // set key → card map
const _loadedSets = new Set<string>();
let _preloadPromise: Promise<void> | null = null;

const SUPPORTED_SETS = ['tdm', 'ltr'] as const;

// ── Loading ───────────────────────────────────────────────────────────────────

async function _loadSet(setCode: string): Promise<void> {
  const key = setCode.toLowerCase();
  if (_loadedSets.has(key)) return;
  _loadedSets.add(key); // mark immediately to prevent duplicate fetches

  try {
    const url = `/data/mtgo-${key}.json`;
    const res = await fetch(url);
    if (!res.ok) return; // file not present — skip silently

    const data: Record<string, MtgoCardStats> = await res.json();

    const map: StatsMap = {};
    for (const [name, card] of Object.entries(data)) {
      if (name && typeof name === 'string') {
        map[name.toLowerCase()] = card;
      }
    }

    _stats[key] = map;
    const cardCount = Object.keys(map).length;
    const totalDecks = cardCount > 0 ? Object.values(map)[0].total_decks : 0;
    console.log(
      `[mtgo] Loaded ${cardCount} cards for ${setCode.toUpperCase()} (from ${totalDecks} winning decks)`
    );
  } catch {
    // Silently skip if file missing or malformed
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Preload MTGO stats for all supported sets.
 * Called automatically on module import (non-blocking).
 * Safe to call multiple times.
 */
export async function preloadMtgoStats(): Promise<void> {
  if (_preloadPromise) return _preloadPromise;
  _preloadPromise = Promise.all(SUPPORTED_SETS.map(_loadSet)).then(() => {});
  return _preloadPromise;
}

/** Get raw stats entry for a card. Searches all loaded sets. */
export function getMtgoStats(cardName: string): MtgoCardStats | null {
  const nameLower = (cardName || '').toLowerCase();
  for (const map of Object.values(_stats)) {
    const entry = map[nameLower];
    if (entry) return entry;
  }
  return null;
}

/**
 * Convert MTGO appearance data to a 0–10 score.
 *
 * Formula: score = appearance_rate × 10, clamped [0, 10].
 * appearance_rate = (# of 3+ win decks with this card) / (total 3+ win decks seen).
 *
 * Returns null if no data or fewer than 5 appearances (insufficient sample).
 */
export function getMtgoScore(cardName: string): number | null {
  const stats = getMtgoStats(cardName);
  if (!stats || stats.appearances < 5) return null;

  const raw = stats.appearance_rate * 10;
  return Math.max(0, Math.min(10, raw));
}

/**
 * Trust factor [0, 1] — how much to weight MTGO data vs other signals.
 * Scales linearly from 0 at < 5 appearances to 1.0 at 30+ appearances.
 */
export function getMtgoTrust(cardName: string): number {
  const stats = getMtgoStats(cardName);
  if (!stats || stats.appearances < 5) return 0;
  // Linear scale: 5 → 0.0, 30 → 1.0
  return Math.min(1.0, (stats.appearances - 5) / 25);
}

/**
 * Whether MTGO stats data is loaded for at least one set.
 */
export function hasData(): boolean {
  return Object.keys(_stats).length > 0;
}

/**
 * Summary stats for UI display or debugging.
 */
export function getStats(): { sets: string[]; totalCards: number } {
  const sets = Object.keys(_stats);
  const totalCards = sets.reduce((n, k) => n + Object.keys(_stats[k]).length, 0);
  return { sets, totalCards };
}

// ── Auto-preload on module import ─────────────────────────────────────────────
// Non-blocking: fires and forgets. Components can await preloadMtgoStats() if
// they need the data to be ready before rendering.
preloadMtgoStats();
