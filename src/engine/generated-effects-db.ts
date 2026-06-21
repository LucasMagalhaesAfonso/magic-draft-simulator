// generated-effects-db.ts — Auto-parsed card effects, persisted across sessions

import { CardEffectsDB } from './card-effects';
import { addEffectEntry } from './cards';
import { parseOracleText } from './oracle-parser';
import { classifyCards, markGenerated } from './effect-coverage';
import { generateEffectWithLlm } from './llm-effect-generator';

const LS_KEY = 'mtg_generated_effects_v1';

// false = "parsed but found nothing" sentinel — avoids re-parsing every frame
const _cache: Record<string, any> = {};
let _injected = false;

function _loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) Object.assign(_cache, JSON.parse(raw));
  } catch { /* ignore */ }
}

function _saveToStorage(): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_cache)); } catch { /* ignore */ }
}

function _inject(key: string, entry: Record<string, any>): void {
  CardEffectsDB[key] = entry;
  addEffectEntry(key, entry as any);
}

/**
 * Call once at app start.
 * Loads persisted generated effects and injects them into both CardEffectsDB
 * and the live effectsCache (via addEffectEntry).
 */
export function injectGeneratedEffects(): void {
  if (_injected) return;
  _injected = true;
  _loadFromStorage();
  for (const [key, entry] of Object.entries(_cache)) {
    if (entry) _inject(key, entry);
  }
}

/**
 * Lazily parse a single card's oracle text.
 * Safe to call in hot paths — returns immediately if already processed.
 */
export function autoParseCard(card: {
  name: string;
  oracle_text?: string;
  type_line?: string;
  keywords?: string[];
}): void {
  if (!card?.name) return;
  const key = card.name.toLowerCase();
  if (CardEffectsDB[key] || key in _cache) return;

  const entry = parseOracleText(card);
  _cache[key] = entry || false;
  if (entry) {
    _inject(key, entry);
    _saveToStorage();
  }
}

/**
 * Batch-process an entire set of cards.
 * Call after importing a set from Scryfall.
 * Returns the number of cards that got generated effects.
 */
export function processSetCards(
  cards: Array<{ name: string; oracle_text?: string; type_line?: string; keywords?: string[] }>,
  setCode = 'unknown'
): number {
  let count = 0;
  for (const card of cards) {
    const key = card.name.toLowerCase();
    if (CardEffectsDB[key] || key in _cache) continue;
    const entry = parseOracleText(card);
    _cache[key] = entry || false;
    if (entry) {
      _inject(key, entry);
      count++;
    }
  }
  _saveToStorage();
  console.log(`[oracle-parser] Generated effects for ${count}/${cards.length} cards in ${setCode}`);
  // Classify coverage after parsing
  classifyCards(setCode, cards);
  return count;
}

/** Stats for Settings UI */
export function getGeneratedEffectsStats(): { total: number; withEffects: number } {
  const entries = Object.values(_cache);
  return {
    total: entries.length,
    withEffects: entries.filter(Boolean).length,
  };
}

/**
 * Run Ollama LLM on cards that the rule-based parser couldn't handle.
 * Call from Settings UI with user-triggered action.
 */
export async function generateLlmEffectsForSet(
  cards: Array<{ name: string; oracle_text?: string; type_line?: string; keywords?: string[] }>,
  ollamaUrl: string,
  ollamaModel: string,
  onProgress: (done: number, total: number, cardName: string) => void,
  abortRef: { aborted: boolean }
): Promise<number> {
  const uncovered = cards.filter(c => {
    const key = c.name.toLowerCase();
    return !CardEffectsDB[key] && !(_cache[key]) && c.oracle_text;
  });

  let generated = 0;
  for (let i = 0; i < uncovered.length; i++) {
    if (abortRef.aborted) break;
    const card = uncovered[i];
    onProgress(i, uncovered.length, card.name);
    const result = await generateEffectWithLlm(card, ollamaUrl, ollamaModel);
    const key = card.name.toLowerCase();
    if (result.entry) {
      _cache[key] = result.entry;
      _inject(key, result.entry);
      markGenerated(card.name);
      generated++;
    } else {
      _cache[key] = false;
    }
    if (i % 10 === 0) _saveToStorage();
  }
  _saveToStorage();
  onProgress(uncovered.length, uncovered.length, '');
  return generated;
}
