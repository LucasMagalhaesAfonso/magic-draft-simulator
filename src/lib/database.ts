import type { Card, CardRow, CardEffectEntry } from './types';
export { rowToCard } from './database-utils';

// ============================================
// Environment Detection
// ============================================

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ============================================
// Tauri SQLite backend (lazy import to avoid errors in browser)
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tauriDb: any = null;

async function getTauriDb() {
  if (_tauriDb) return _tauriDb;
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  _tauriDb = await Database.load('sqlite:magic_draft.db');
  return _tauriDb;
}

// ============================================
// Browser IndexedDB backend (lazy import)
// ============================================

async function getBrowserDb() {
  return import('./database-browser');
}

// ============================================
// Card Queries
// ============================================

export async function getCardsBySet(setCode: string): Promise<Card[]> {
  if (!isTauri()) {
    const { browserGetCardsBySet } = await getBrowserDb();
    return browserGetCardsBySet(setCode);
  }
  const { rowToCard } = await import('./database-utils');
  const db = await getTauriDb();
  const rows = await db.select(
    "SELECT * FROM cards WHERE set_code = $1 AND name NOT LIKE 'A-%' ORDER BY CAST(collector_number AS INTEGER)",
    [setCode.toLowerCase()]
  ) as CardRow[];
  return rows.map(rowToCard);
}

export async function getCardByName(name: string): Promise<Card | null> {
  if (!isTauri()) {
    const { browserGetCardByName } = await getBrowserDb();
    return browserGetCardByName(name);
  }
  const { rowToCard } = await import('./database-utils');
  const db = await getTauriDb();
  const rows = await db.select(
    'SELECT * FROM cards WHERE name = $1 LIMIT 1',
    [name]
  ) as CardRow[];
  return rows.length > 0 ? rowToCard(rows[0]) : null;
}

export async function searchCards(query: string, limit = 50): Promise<Card[]> {
  if (!isTauri()) {
    const { browserSearchCards } = await getBrowserDb();
    return browserSearchCards(query, limit);
  }
  const { rowToCard } = await import('./database-utils');
  const db = await getTauriDb();
  const rows = await db.select(
    'SELECT * FROM cards WHERE name LIKE $1 ORDER BY name LIMIT $2',
    [`%${query}%`, limit]
  ) as CardRow[];
  return rows.map(rowToCard);
}

export async function getSetList(): Promise<{ set_code: string; set_name: string; card_count: number }[]> {
  if (!isTauri()) {
    const { browserGetSetList } = await getBrowserDb();
    return browserGetSetList();
  }
  const db = await getTauriDb();
  return db.select(
    'SELECT set_code, MAX(set_name) as set_name, COUNT(*) as card_count FROM cards GROUP BY set_code ORDER BY set_name'
  );
}

export async function getCardCount(): Promise<number> {
  if (!isTauri()) {
    const { browserGetCardCount } = await getBrowserDb();
    return browserGetCardCount();
  }
  const db = await getTauriDb();
  const result = await db.select('SELECT COUNT(*) as count FROM cards') as { count: number }[];
  return result[0]?.count || 0;
}

// ============================================
// Card Effects
// ============================================

export async function getCardEffects(cardName: string): Promise<CardEffectEntry | null> {
  if (!isTauri()) {
    const { browserGetCardEffects } = await getBrowserDb();
    return browserGetCardEffects(cardName);
  }
  const db = await getTauriDb();
  const rows = await db.select(
    'SELECT effects_json FROM card_effects WHERE card_name = $1',
    [cardName]
  ) as { effects_json: string }[];
  if (rows.length === 0) return null;
  try { return JSON.parse(rows[0].effects_json); } catch { return null; }
}

export async function upsertCardEffects(cardName: string, effects: CardEffectEntry): Promise<void> {
  if (!isTauri()) {
    const { browserUpsertCardEffects } = await getBrowserDb();
    return browserUpsertCardEffects(cardName, effects);
  }
  const db = await getTauriDb();
  await db.execute(
    `INSERT INTO card_effects (card_name, effects_json) VALUES ($1, $2)
     ON CONFLICT(card_name) DO UPDATE SET effects_json = $2`,
    [cardName, JSON.stringify(effects)]
  );
}

// ============================================
// Decks
// ============================================

export async function saveDeck(name: string, cards: Card[], sideboard: Card[], setCode: string): Promise<number> {
  if (!isTauri()) {
    const { browserSaveDeck } = await getBrowserDb();
    return browserSaveDeck(name, cards, sideboard, setCode);
  }
  const db = await getTauriDb();
  const result = await db.execute(
    `INSERT INTO decks (name, set_code, cards_json, sideboard_json) VALUES ($1, $2, $3, $4)`,
    [name, setCode, JSON.stringify(cards.map(c => c.id)), JSON.stringify(sideboard.map(c => c.id))]
  );
  return result.lastInsertId ?? 0;
}

export async function getDecks(): Promise<{ id: number; name: string; set_code: string; created_at: string }[]> {
  if (!isTauri()) {
    const { browserGetDecks } = await getBrowserDb();
    return browserGetDecks();
  }
  const db = await getTauriDb();
  return db.select('SELECT id, name, set_code, created_at FROM decks ORDER BY created_at DESC');
}

// ============================================
// User Preferences
// ============================================

export async function getPref(key: string, defaultValue = ''): Promise<string> {
  if (!isTauri()) {
    const { browserGetPref } = await getBrowserDb();
    return browserGetPref(key, defaultValue);
  }
  const db = await getTauriDb();
  const rows = await db.select(
    'SELECT value FROM user_prefs WHERE key = $1',
    [key]
  ) as { value: string }[];
  return rows.length > 0 ? rows[0].value : defaultValue;
}

export async function setPref(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    const { browserSetPref } = await getBrowserDb();
    return browserSetPref(key, value);
  }
  const db = await getTauriDb();
  await db.execute(
    `INSERT INTO user_prefs (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

// ============================================
// Bulk Import
// ============================================

export async function bulkInsertCards(
  cards: CardRow[],
  onProgress?: (inserted: number, total: number) => void
): Promise<void> {
  if (!isTauri()) {
    const { browserBulkInsertCards } = await getBrowserDb();
    return browserBulkInsertCards(cards, onProgress);
  }
  const db = await getTauriDb();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    try {
      await db.execute(
        `INSERT OR REPLACE INTO cards (
          id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
          power, toughness, loyalty, colors, color_identity, keywords,
          set_code, set_name, collector_number, rarity,
          image_small, image_normal, image_art_crop, layout, produced_mana,
          back_face_name, back_face_mana_cost, back_face_type_line,
          back_face_oracle_text, back_face_power, back_face_toughness, back_face_image_normal
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [
          card.id, card.oracle_id || '', card.name, card.mana_cost || null, card.cmc || 0,
          card.type_line || '', card.oracle_text || null, card.power || null,
          card.toughness || null, card.loyalty || null,
          card.colors || null, card.color_identity || null, card.keywords || null,
          card.set_code, card.set_name || null, card.collector_number || null,
          card.rarity || 'common',
          card.image_small || null, card.image_normal || null, card.image_art_crop || null,
          card.layout || 'normal', card.produced_mana || null,
          card.back_face_name || null, card.back_face_mana_cost || null,
          card.back_face_type_line || null, card.back_face_oracle_text || null,
          card.back_face_power || null, card.back_face_toughness || null,
          card.back_face_image_normal || null
        ]
      );
    } catch (e) {
      console.error(`Failed to insert card "${card.name}" (${card.id}):`, e);
      continue;
    }
    if (onProgress && (i % 10 === 0 || i === cards.length - 1)) {
      onProgress(i + 1, cards.length);
    }
  }
}
