// token-images.ts — Scryfall token image fetcher with localStorage cache

const CACHE_KEY = 'token_image_cache_v7'; // v7: TDM-first query strategy
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

function cacheKey(name: string, preferredSet?: string): string {
  return preferredSet ? `${name.toLowerCase()}_${preferredSet.toLowerCase()}` : name.toLowerCase();
}

// Sync lookup (returns null if not yet fetched)
export function getTokenImageUrl(name: string, preferredSet?: string): string | null {
  loadStorage();
  // When preferredSet is given, ONLY return set-specific cache — never fall back to wrong-set cache
  if (preferredSet) {
    return memCache.get(cacheKey(name, preferredSet)) || null;
  }
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
  const key = cacheKey(name, preferredSet);

  if (memCache.has(key)) return Promise.resolve(memCache.get(key)!);
  if (inFlight.has(key)) return inFlight.get(key)!;

  const promise = (async (): Promise<string | null> => {
    try {
      let url: string | null = null;

      // Step 1: If preferredSet given, try a set-specific query first (e.g. set:tdm)
      if (preferredSet) {
        const setQ = encodeURIComponent(`set:${preferredSet} type:token name:"${name}"`);
        try {
          const setResp = await fetch(
            `https://api.scryfall.com/cards/search?q=${setQ}&order=released`,
          );
          if (setResp.ok) {
            const setData = await setResp.json();
            if (setData.data?.length) {
              // Pick color match if possible, else first result
              let best = setData.data[0];
              if (colors.length > 0) {
                const m = setData.data.find(
                  (c: any) =>
                    Array.isArray(c.colors) &&
                    c.colors.length === colors.length &&
                    colors.every((col: string) => c.colors.includes(col)),
                );
                if (m) best = m;
              }
              url = best?.image_uris?.normal || null;
            }
          }
        } catch { /* ignore, fall through to generic search */ }
      }

      // Step 2: Fall back to any-set search if no set-specific result found
      if (!url) {
        const q = encodeURIComponent(`!"${name}" type:token`);
        const resp = await fetch(
          `https://api.scryfall.com/cards/search?q=${q}&order=released&unique=prints`,
        );
        if (!resp.ok) return null;

        const data = await resp.json();
        if (!data.data?.length) return null;

        let best = data.data[0];

        if (colors.length > 0) {
          const m = data.data.find(
            (c: any) =>
              Array.isArray(c.colors) &&
              c.colors.length === colors.length &&
              colors.every((col: string) => c.colors.includes(col)),
          );
          if (m) best = m;
        }

        if (preferredSet) {
          // Also check if fallback search accidentally has a set match
          const setMatch = data.data.find((c: any) => c.set === preferredSet.toLowerCase());
          if (setMatch) best = setMatch;
        }

        url = best?.image_uris?.normal || null;
      }

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
