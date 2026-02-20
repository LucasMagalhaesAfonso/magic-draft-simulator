// token-images.ts — Scryfall token image fetcher with localStorage cache

const CACHE_KEY = 'token_image_cache_v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry { url: string; ts: number; }

const memCache = new Map<string, string>();
let storageLoaded = false;

function loadStorage() {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const data: Record<string, CacheEntry> = JSON.parse(raw);
    const now = Date.now();
    for (const [k, v] of Object.entries(data)) {
      if (now - v.ts < CACHE_TTL) memCache.set(k, v.url);
    }
  } catch {}
}

function saveToStorage(key: string, url: string) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const data: Record<string, CacheEntry> = raw ? JSON.parse(raw) : {};
    data[key] = { url, ts: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {}
}

// Sync lookup (returns null if not yet fetched)
export function getTokenImageUrl(name: string): string | null {
  loadStorage();
  return memCache.get(name.toLowerCase()) || null;
}

const inFlight = new Map<string, Promise<string | null>>();

// Async fetch + cache. Safe to call multiple times (deduplicates in-flight requests).
export function preloadTokenImage(
  name: string,
  colors: string[] = [],
  preferredSet?: string,
): Promise<string | null> {
  loadStorage();
  const key = name.toLowerCase();

  if (memCache.has(key)) return Promise.resolve(memCache.get(key)!);
  if (inFlight.has(key)) return inFlight.get(key)!;

  const promise = (async (): Promise<string | null> => {
    try {
      const q = encodeURIComponent(`!"${name}" type:token`);
      const resp = await fetch(
        `https://api.scryfall.com/cards/search?q=${q}&order=released&unique=prints`,
      );
      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data.data?.length) return null;

      let best = data.data[0];

      // Prefer matching set (e.g. "tdm" for Tarkir Dragonstorm tokens)
      if (preferredSet) {
        const m = data.data.find((c: any) => c.set === preferredSet.toLowerCase());
        if (m) best = m;
      }

      // Then prefer color match
      if (colors.length > 0) {
        const m = data.data.find(
          (c: any) =>
            Array.isArray(c.colors) &&
            c.colors.length === colors.length &&
            colors.every((col: string) => c.colors.includes(col)),
        );
        if (m) best = m;
      }

      // Use normal image — shows the full token card (border, art, name, type)
      // art_crop is landscape and looks bad in the portrait card frame
      const url: string | null = best?.image_uris?.normal || null;

      if (url) {
        memCache.set(key, url);
        saveToStorage(key, url);
      }
      return url;
    } catch {
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
