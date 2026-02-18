/**
 * Browser-compatible database layer using IndexedDB.
 * Used as fallback when running outside Tauri (e.g. Chrome via Vite dev server).
 */
import type { Card, CardRow, CardEffectEntry } from './types';
import { rowToCard } from './database-utils';

const DB_NAME = 'magic_draft';
const DB_VERSION = 1;

let idb: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cards')) {
        const store = db.createObjectStore('cards', { keyPath: 'id' });
        store.createIndex('set_code', 'set_code', { unique: false });
        store.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('card_effects')) {
        db.createObjectStore('card_effects', { keyPath: 'card_name' });
      }
      if (!db.objectStoreNames.contains('decks')) {
        db.createObjectStore('decks', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('user_prefs')) {
        db.createObjectStore('user_prefs', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => {
      idb = (e.target as IDBOpenDBRequest).result;
      resolve(idb);
    };
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(store: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = query !== undefined ? store.getAll(query) : store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store: IDBObjectStore, value: unknown): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbCount(store: IDBObjectStore | IDBIndex): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ============================================
// Card Queries
// ============================================

export async function browserGetCardsBySet(setCode: string): Promise<Card[]> {
  const db = await openDb();
  const transaction = db.transaction('cards', 'readonly');
  const index = transaction.objectStore('cards').index('set_code');
  const rows = await idbGetAll<CardRow>(index, IDBKeyRange.only(setCode.toLowerCase()));
  rows.sort((a, b) => parseInt(a.collector_number || '0') - parseInt(b.collector_number || '0'));
  return rows.map(rowToCard);
}

export async function browserGetCardByName(name: string): Promise<Card | null> {
  const db = await openDb();
  const transaction = db.transaction('cards', 'readonly');
  const index = transaction.objectStore('cards').index('name');
  const rows = await idbGetAll<CardRow>(index, IDBKeyRange.only(name));
  return rows.length > 0 ? rowToCard(rows[0]) : null;
}

export async function browserSearchCards(query: string, limit = 50): Promise<Card[]> {
  const db = await openDb();
  const transaction = db.transaction('cards', 'readonly');
  const store = transaction.objectStore('cards');
  const results: CardRow[] = [];
  const lower = query.toLowerCase();
  return new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (!cursor || results.length >= limit) {
        resolve(results.map(rowToCard));
        return;
      }
      const row = cursor.value as CardRow;
      if (row.name.toLowerCase().includes(lower)) results.push(row);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function browserGetSetList(): Promise<{ set_code: string; set_name: string; card_count: number }[]> {
  const db = await openDb();
  const transaction = db.transaction('cards', 'readonly');
  const store = transaction.objectStore('cards');
  const allRows = await idbGetAll<CardRow>(store);
  const sets = new Map<string, { set_code: string; set_name: string; card_count: number }>();
  for (const row of allRows) {
    const code = row.set_code;
    if (sets.has(code)) {
      sets.get(code)!.card_count++;
    } else {
      sets.set(code, { set_code: code, set_name: row.set_name || code, card_count: 1 });
    }
  }
  return Array.from(sets.values()).sort((a, b) => a.set_name.localeCompare(b.set_name));
}

export async function browserGetCardCount(): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction('cards', 'readonly');
  return idbCount(transaction.objectStore('cards'));
}

// ============================================
// Card Effects
// ============================================

export async function browserGetCardEffects(cardName: string): Promise<CardEffectEntry | null> {
  const db = await openDb();
  const transaction = db.transaction('card_effects', 'readonly');
  const row = await idbGet<{ card_name: string; effects_json: string }>(
    transaction.objectStore('card_effects'), cardName
  );
  if (!row) return null;
  try { return JSON.parse(row.effects_json); } catch { return null; }
}

export async function browserUpsertCardEffects(cardName: string, effects: CardEffectEntry): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction('card_effects', 'readwrite');
  await idbPut(transaction.objectStore('card_effects'), { card_name: cardName, effects_json: JSON.stringify(effects) });
}

// ============================================
// User Preferences
// ============================================

export async function browserGetPref(key: string, defaultValue = ''): Promise<string> {
  const db = await openDb();
  const transaction = db.transaction('user_prefs', 'readonly');
  const row = await idbGet<{ key: string; value: string }>(transaction.objectStore('user_prefs'), key);
  return row ? row.value : defaultValue;
}

export async function browserSetPref(key: string, value: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction('user_prefs', 'readwrite');
  await idbPut(transaction.objectStore('user_prefs'), { key, value });
}

// ============================================
// Bulk Import
// ============================================

export async function browserBulkInsertCards(
  rows: CardRow[],
  onProgress?: (inserted: number, total: number) => void
): Promise<void> {
  const db = await openDb();
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const transaction = db.transaction('cards', 'readwrite');
    const store = transaction.objectStore('cards');
    for (const row of batch) store.put(row);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    if (onProgress) onProgress(Math.min(i + BATCH, rows.length), rows.length);
  }
}

// ============================================
// Decks
// ============================================

export async function browserGetDecks(): Promise<{ id: number; name: string; set_code: string; created_at: string }[]> {
  const db = await openDb();
  const transaction = db.transaction('decks', 'readonly');
  return idbGetAll(transaction.objectStore('decks'));
}

export async function browserSaveDeck(name: string, cards: Card[], sideboard: Card[], setCode: string): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction('decks', 'readwrite');
  const store = transaction.objectStore('decks');
  return new Promise((resolve, reject) => {
    const req = store.add({
      name, set_code: setCode,
      cards_json: JSON.stringify(cards.map(c => c.id)),
      sideboard_json: JSON.stringify(sideboard.map(c => c.id)),
      created_at: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}
