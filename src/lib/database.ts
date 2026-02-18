import Database from '@tauri-apps/plugin-sql';
import type { Card, CardRow, Color, Rarity, CardFace, CardEffectEntry } from './types';

let db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:magic_draft.db');
  }
  return db;
}

// ============================================
// Card Row → Card Object Conversion
// ============================================

function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

export function rowToCard(row: CardRow): Card {
  const card: Card = {
    id: row.id,
    oracle_id: row.oracle_id || '',
    name: row.name,
    mana_cost: row.mana_cost || '',
    cmc: row.cmc || 0,
    type_line: row.type_line || '',
    oracle_text: row.oracle_text || '',
    power: row.power || undefined,
    toughness: row.toughness || undefined,
    loyalty: row.loyalty || undefined,
    colors: parseJsonArray<Color>(row.colors),
    color_identity: parseJsonArray<Color>(row.color_identity),
    keywords: parseJsonArray<string>(row.keywords),
    set_code: row.set_code,
    set_name: row.set_name || '',
    collector_number: row.collector_number || '',
    rarity: (row.rarity || 'common') as Rarity,
    image_small: row.image_small || '',
    image_normal: row.image_normal || '',
    image_art_crop: row.image_art_crop || '',
    layout: row.layout || 'normal',
    produced_mana: parseJsonArray<Color>(row.produced_mana),
  };

  if (row.back_face_name) {
    card.back_face = {
      name: row.back_face_name,
      mana_cost: row.back_face_mana_cost || '',
      type_line: row.back_face_type_line || '',
      oracle_text: row.back_face_oracle_text || '',
      power: row.back_face_power || undefined,
      toughness: row.back_face_toughness || undefined,
      image_normal: row.back_face_image_normal || undefined,
    } as CardFace;
  }

  return card;
}

// ============================================
// Card Queries
// ============================================

export async function getCardsBySet(setCode: string): Promise<Card[]> {
  const database = await getDb();
  const rows = await database.select<CardRow[]>(
    'SELECT * FROM cards WHERE set_code = $1 ORDER BY CAST(collector_number AS INTEGER)',
    [setCode.toLowerCase()]
  );
  return rows.map(rowToCard);
}

export async function getCardByName(name: string): Promise<Card | null> {
  const database = await getDb();
  const rows = await database.select<CardRow[]>(
    'SELECT * FROM cards WHERE name = $1 LIMIT 1',
    [name]
  );
  return rows.length > 0 ? rowToCard(rows[0]) : null;
}

export async function searchCards(query: string, limit = 50): Promise<Card[]> {
  const database = await getDb();
  const rows = await database.select<CardRow[]>(
    'SELECT * FROM cards WHERE name LIKE $1 ORDER BY name LIMIT $2',
    [`%${query}%`, limit]
  );
  return rows.map(rowToCard);
}

export async function getSetList(): Promise<{ set_code: string; set_name: string; card_count: number }[]> {
  const database = await getDb();
  return database.select(
    'SELECT set_code, MAX(set_name) as set_name, COUNT(*) as card_count FROM cards GROUP BY set_code ORDER BY set_name'
  );
}

export async function getCardCount(): Promise<number> {
  const database = await getDb();
  const result = await database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM cards');
  return result[0]?.count || 0;
}

// ============================================
// Card Effects
// ============================================

export async function getCardEffects(cardName: string): Promise<CardEffectEntry | null> {
  const database = await getDb();
  const rows = await database.select<{ effects_json: string }[]>(
    'SELECT effects_json FROM card_effects WHERE card_name = $1',
    [cardName]
  );
  if (rows.length === 0) return null;
  try { return JSON.parse(rows[0].effects_json); } catch { return null; }
}

export async function upsertCardEffects(cardName: string, effects: CardEffectEntry): Promise<void> {
  const database = await getDb();
  await database.execute(
    `INSERT INTO card_effects (card_name, effects_json) VALUES ($1, $2)
     ON CONFLICT(card_name) DO UPDATE SET effects_json = $2`,
    [cardName, JSON.stringify(effects)]
  );
}

// ============================================
// Decks
// ============================================

export async function saveDeck(name: string, cards: Card[], sideboard: Card[], setCode: string): Promise<number> {
  const database = await getDb();
  const result = await database.execute(
    `INSERT INTO decks (name, set_code, cards_json, sideboard_json) VALUES ($1, $2, $3, $4)`,
    [name, setCode, JSON.stringify(cards.map(c => c.id)), JSON.stringify(sideboard.map(c => c.id))]
  );
  return result.lastInsertId ?? 0;
}

export async function getDecks(): Promise<{ id: number; name: string; set_code: string; created_at: string }[]> {
  const database = await getDb();
  return database.select('SELECT id, name, set_code, created_at FROM decks ORDER BY created_at DESC');
}

// ============================================
// User Preferences
// ============================================

export async function getPref(key: string, defaultValue = ''): Promise<string> {
  const database = await getDb();
  const rows = await database.select<{ value: string }[]>(
    'SELECT value FROM user_prefs WHERE key = $1',
    [key]
  );
  return rows.length > 0 ? rows[0].value : defaultValue;
}

export async function setPref(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.execute(
    `INSERT INTO user_prefs (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

// ============================================
// Bulk Import (used by Scryfall sync)
// ============================================

export async function bulkInsertCards(
  cards: CardRow[],
  onProgress?: (inserted: number, total: number) => void
): Promise<void> {
  const database = await getDb();

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    try {
      await database.execute(
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
      // Continue with next card instead of aborting
      continue;
    }

    if (onProgress && (i % 10 === 0 || i === cards.length - 1)) {
      onProgress(i + 1, cards.length);
    }
  }
}
