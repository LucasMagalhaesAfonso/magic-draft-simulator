// tools/export-ai-model.ts
// Downloads the global AI brain from Firestore and saves to public/data/ai-brain-prebuilt.json
// Run automatically by GitHub Actions before every tagged release build.
// Run manually: npx tsx tools/export-ai-model.ts
//
// Requires env vars (same ones already in GitHub Secrets):
//   VITE_FIREBASE_PROJECT_ID
//   VITE_FIREBASE_API_KEY

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID;
const API_KEY    = process.env.VITE_FIREBASE_API_KEY;

if (!PROJECT_ID || !API_KEY) {
  console.error('❌ Missing VITE_FIREBASE_PROJECT_ID or VITE_FIREBASE_API_KEY env vars');
  process.exit(1);
}

// ── Firestore REST API ────────────────────────────────────────────────────────

function parseValue(v: any): any {
  if (!v || typeof v !== 'object') return null;
  if ('doubleValue'  in v) return Number(v.doubleValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue'   in v) return (v.arrayValue?.values ?? []).map(parseValue);
  if ('mapValue'     in v) {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v.mapValue?.fields ?? {})) out[k] = parseValue(val);
    return out;
  }
  return null;
}

function parseDoc(doc: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc.fields ?? {})) out[k] = parseValue(v);
  return out;
}

async function fetchGlobalBrain(): Promise<{
  weights: number[][];
  shapes:  number[][];
  gamesCount: number;
} | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ai_brain/global?key=${API_KEY}`;
  const res = await fetch(url);

  if (res.status === 404) {
    console.warn('⚠️  No global brain in Firestore yet — skipping prebuilt model.');
    return null;
  }
  if (!res.ok) throw new Error(`Firestore API error: ${res.status} ${await res.text()}`);

  const doc = await res.json();
  const data = parseDoc(doc);

  if (!Array.isArray(data.weights) || !Array.isArray(data.shapes)) {
    console.warn('⚠️  Firestore brain doc has unexpected shape — skipping.');
    return null;
  }

  return {
    weights:    data.weights as number[][],
    shapes:     data.shapes  as number[][],
    gamesCount: Number(data.gamesCount) || 0,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching global AI brain from Firestore...');

  const brain = await fetchGlobalBrain();
  if (!brain) {
    // Not an error — just no data yet. Create an empty placeholder so the app doesn't fail.
    console.log('No prebuilt model to bundle — app will train from scratch.');
    return;
  }

  // Convert Firestore format → prebuilt format used by ai-brain.ts
  const prebuilt = {
    version:         3,
    gamesPlayed:     brain.gamesCount,
    exportedAt:      new Date().toISOString(),
    weights: brain.weights.map((data, i) => ({
      shape: brain.shapes[i] ?? [],
      data,
    })),
  };

  const outDir  = join(process.cwd(), 'public', 'data');
  const outPath = join(outDir, 'ai-brain-prebuilt.json');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(prebuilt));

  const sizekb = Math.round(JSON.stringify(prebuilt).length / 1024);
  console.log(`✅ Saved prebuilt model: ${brain.gamesCount} games, ${prebuilt.weights.length} layers, ${sizekb} KB → ${outPath}`);
}

main().catch(e => {
  // Non-fatal: if Firestore is down or creds are wrong, build continues without prebuilt model
  console.error('⚠️  export-ai-model failed (non-fatal):', e.message);
  process.exit(0);
});
