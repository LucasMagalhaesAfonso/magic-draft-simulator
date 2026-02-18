import type { CardRow } from './types';
import { bulkInsertCards, getDb } from './database';

const SCRYFALL_BULK_URL = 'https://api.scryfall.com/bulk-data';
const BATCH_SIZE = 500;

interface BulkDataEntry {
  type: string;
  download_uri: string;
  updated_at: string;
}

interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
  layout: string;
  produced_mana?: string[];
  card_faces?: ScryfallCardFace[];
  lang: string;
  games?: string[];
}

interface ScryfallCardFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    art_crop?: string;
  };
}

export type SyncProgress = {
  phase: 'downloading' | 'processing' | 'inserting' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
};

function scryfallToRow(card: ScryfallCard): CardRow | null {
  // Skip non-paper, non-English cards
  if (card.lang !== 'en') return null;
  if (card.games && !card.games.includes('paper')) return null;

  // Handle DFC / split cards
  const frontFace = card.card_faces?.[0];
  const backFace = card.card_faces?.[1];
  const hasMultipleFaces = card.card_faces && card.card_faces.length >= 2;

  const imageUris = card.image_uris || frontFace?.image_uris;

  return {
    id: card.id,
    oracle_id: card.oracle_id || '',
    name: card.name,
    mana_cost: card.mana_cost || frontFace?.mana_cost || null,
    cmc: card.cmc || 0,
    type_line: card.type_line || frontFace?.type_line || '',
    oracle_text: card.oracle_text || frontFace?.oracle_text || null,
    power: card.power || frontFace?.power || null,
    toughness: card.toughness || frontFace?.toughness || null,
    loyalty: card.loyalty || null,
    colors: card.colors ? JSON.stringify(card.colors) : null,
    color_identity: card.color_identity ? JSON.stringify(card.color_identity) : null,
    keywords: card.keywords ? JSON.stringify(card.keywords) : null,
    set_code: card.set,
    set_name: card.set_name || null,
    collector_number: card.collector_number || null,
    rarity: card.rarity || 'common',
    image_small: imageUris?.small || null,
    image_normal: imageUris?.normal || null,
    image_art_crop: imageUris?.art_crop || null,
    layout: card.layout || 'normal',
    produced_mana: card.produced_mana ? JSON.stringify(card.produced_mana) : null,
    back_face_name: hasMultipleFaces ? (backFace?.name || null) : null,
    back_face_mana_cost: hasMultipleFaces ? (backFace?.mana_cost || null) : null,
    back_face_type_line: hasMultipleFaces ? (backFace?.type_line || null) : null,
    back_face_oracle_text: hasMultipleFaces ? (backFace?.oracle_text || null) : null,
    back_face_power: hasMultipleFaces ? (backFace?.power || null) : null,
    back_face_toughness: hasMultipleFaces ? (backFace?.toughness || null) : null,
    back_face_image_normal: hasMultipleFaces ? (backFace?.image_uris?.normal || null) : null,
  };
}

export async function syncAllCards(
  onProgress?: (progress: SyncProgress) => void
): Promise<void> {
  try {
    onProgress?.({ phase: 'downloading', current: 0, total: 0, message: 'Fetching bulk data URL...' });

    // Get bulk data URL
    const bulkRes = await fetch(SCRYFALL_BULK_URL);
    const bulkData = await bulkRes.json();
    const defaultCards = bulkData.data.find((d: BulkDataEntry) => d.type === 'default_cards');

    if (!defaultCards) {
      throw new Error('Could not find default_cards bulk data');
    }

    onProgress?.({ phase: 'downloading', current: 0, total: 0, message: 'Downloading card database (~300MB)...' });

    // Download all cards
    const res = await fetch(defaultCards.download_uri);
    const allCards: ScryfallCard[] = await res.json();

    onProgress?.({ phase: 'processing', current: 0, total: allCards.length, message: `Processing ${allCards.length} cards...` });

    // Convert to rows, filtering out non-paper/non-English
    const rows: CardRow[] = [];
    for (let i = 0; i < allCards.length; i++) {
      const row = scryfallToRow(allCards[i]);
      if (row) rows.push(row);

      if (i % 10000 === 0) {
        onProgress?.({ phase: 'processing', current: i, total: allCards.length, message: `Processing card ${i}/${allCards.length}...` });
      }
    }

    onProgress?.({ phase: 'inserting', current: 0, total: rows.length, message: `Inserting ${rows.length} cards into database...` });

    // Bulk insert in batches
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await bulkInsertCards(batch);
      onProgress?.({ phase: 'inserting', current: i + batch.length, total: rows.length, message: `Inserted ${i + batch.length}/${rows.length} cards...` });
    }

    // Store sync timestamp
    const database = await getDb();
    await database.execute(
      `INSERT OR REPLACE INTO user_prefs (key, value) VALUES ('last_sync', $1)`,
      [new Date().toISOString()]
    );

    onProgress?.({ phase: 'done', current: rows.length, total: rows.length, message: `Done! ${rows.length} cards imported.` });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.({ phase: 'error', current: 0, total: 0, message: `Sync failed: ${msg}` });
    throw error;
  }
}

export async function syncSingleSet(
  setCode: string,
  onProgress?: (progress: SyncProgress) => void
): Promise<void> {
  try {
    onProgress?.({ phase: 'downloading', current: 0, total: 0, message: `Fetching ${setCode.toUpperCase()} from Scryfall...` });

    let allCards: ScryfallCard[] = [];
    let url: string | null = `https://api.scryfall.com/cards/search?q=set:${setCode}&unique=prints`;

    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Scryfall API error: ${res.status}`);
      const data = await res.json();
      allCards = allCards.concat(data.data);
      url = data.has_more ? data.next_page : null;

      // Respect rate limit
      await new Promise(r => setTimeout(r, 100));
    }

    onProgress?.({ phase: 'processing', current: 0, total: allCards.length, message: `Processing ${allCards.length} cards...` });

    const rows: CardRow[] = [];
    for (const card of allCards) {
      const row = scryfallToRow(card);
      if (row) rows.push(row);
    }

    onProgress?.({ phase: 'inserting', current: 0, total: rows.length, message: `Inserting ${rows.length} cards...` });

    await bulkInsertCards(rows, (inserted, total) => {
      onProgress?.({ phase: 'inserting', current: inserted, total, message: `Inserting card ${inserted}/${total}...` });
    });

    onProgress?.({ phase: 'done', current: rows.length, total: rows.length, message: `Done! ${rows.length} cards from ${setCode.toUpperCase()} imported.` });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    onProgress?.({ phase: 'error', current: 0, total: 0, message: `Sync failed: ${msg}` });
    throw error;
  }
}
