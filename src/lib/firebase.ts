// Firebase configuration
// Fill in your Firebase project config here (or use .env variables)
// To get these values: Firebase Console → Project Settings → Your apps → Web app → Config

import { initializeApp, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';

// ── Config ────────────────────────────────────────────────────────────────────
// Replace these with your actual Firebase config values
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'YOUR_API_KEY',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'YOUR_AUTH_DOMAIN',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'YOUR_PROJECT_ID',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'YOUR_STORAGE_BUCKET',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_SENDER_ID',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || 'YOUR_APP_ID',
};

// ── Initialization ────────────────────────────────────────────────────────────
let app: FirebaseApp;
try {
  app = initializeApp(firebaseConfig);
} catch (e: any) {
  // Already initialized (HMR)
  if (e.code === 'app/duplicate-app') {
    app = getApp();
  } else {
    throw e;
  }
}

export const auth = getAuth(app!);
export const db = getFirestore(app!);

// ── Auth helpers ──────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(msg)), ms)
    ),
  ]);
}

export async function registerUser(email: string, password: string, displayName: string): Promise<User> {
  const cred = await withTimeout(
    createUserWithEmailAndPassword(auth, email, password),
    10000, 'Tempo esgotado. Verifique sua conexão.'
  );
  await updateProfile(cred.user, { displayName });
  // Create user doc in Firestore — non-blocking so it never hangs the UI
  setDoc(doc(db, 'users', cred.user.uid), {
    displayName,
    email,
    createdAt: serverTimestamp(),
  }).catch(() => {});
  return cred.user;
}

export async function loginUser(email: string, password: string): Promise<User> {
  const cred = await withTimeout(
    signInWithEmailAndPassword(auth, email, password),
    10000, 'Tempo esgotado. Verifique sua conexão.'
  );
  return cred.user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export async function resetPassword(email: string): Promise<void> {
  await withTimeout(
    sendPasswordResetEmail(auth, email),
    10000, 'Tempo esgotado. Verifique sua conexão.'
  );
}

export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// ── Deck storage ──────────────────────────────────────────────────────────────
export interface SavedDeck {
  id: string;
  name: string;
  set: string;
  mainboard: any[];
  lands: Record<string, number>;
  createdAt: any;
}

export async function saveDeck(uid: string, deck: Omit<SavedDeck, 'id'>): Promise<string> {
  const ref = doc(collection(db, 'users', uid, 'savedDecks'));
  await setDoc(ref, { ...deck, createdAt: serverTimestamp() });
  return ref.id;
}

export async function loadDecks(uid: string): Promise<SavedDeck[]> {
  const snap = await getDocs(collection(db, 'users', uid, 'savedDecks'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as SavedDeck));
}

export async function deleteDeck(uid: string, deckId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'savedDecks', deckId));
}

// ── Settings storage ──────────────────────────────────────────────────────────
export async function saveSettings(uid: string, settings: Record<string, any>): Promise<void> {
  await setDoc(doc(db, 'users', uid, 'settings', 'preferences'), settings, { merge: true });
}

export async function loadSettings(uid: string): Promise<Record<string, any> | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'preferences'));
  return snap.exists() ? snap.data() : null;
}

// ── AI Brain (federated learning) ─────────────────────────────────────────────

export interface GlobalBrainData {
  weights: number[][];
  shapes: number[][];
  gamesCount: number;
}

// Firestore doesn't support nested arrays, so we serialize weights/shapes as JSON strings.
interface GlobalBrainDoc {
  weightsJson: string;  // JSON.stringify(number[][])
  shapesJson: string;   // JSON.stringify(number[][])
  gamesCount: number;
}

/**
 * Upload local model weights to Firestore, merged via FedAvg into the global model.
 * Uses a transaction to safely merge concurrent contributions.
 */
export async function uploadBrainContribution(
  weights: number[][],
  shapes: number[][]
): Promise<void> {
  const globalRef = doc(db, 'ai_brain', 'global');
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(globalRef);
    if (!snap.exists()) {
      const payload: GlobalBrainDoc = { weightsJson: JSON.stringify(weights), shapesJson: JSON.stringify(shapes), gamesCount: 1 };
      transaction.set(globalRef, { ...payload, lastUpdated: serverTimestamp() });
      return;
    }
    const raw = snap.data() as Partial<GlobalBrainDoc> & { lastUpdated: any };
    const globalCount = raw.gamesCount || 1;
    const globalWeights: number[][] = raw.weightsJson ? JSON.parse(raw.weightsJson) : weights;
    // FedAvg: weighted average of global and new contribution
    const merged = weights.map((layerW, li) => {
      const globalW = globalWeights[li] || layerW;
      return layerW.map((w, j) => (globalW[j] * globalCount + w) / (globalCount + 1));
    });
    transaction.update(globalRef, {
      weightsJson: JSON.stringify(merged),
      shapesJson: JSON.stringify(shapes),
      gamesCount: globalCount + 1,
      lastUpdated: serverTimestamp(),
    });
  });
}

export async function downloadGlobalBrain(): Promise<GlobalBrainData | null> {
  try {
    const snap = await getDoc(doc(db, 'ai_brain', 'global'));
    if (!snap.exists()) return null;
    const raw = snap.data() as Partial<GlobalBrainDoc>;
    // Support both new format (weightsJson) and old format (weights)
    const legacy = snap.data() as any;
    const weights: number[][] = raw.weightsJson ? JSON.parse(raw.weightsJson) : (legacy.weights ?? []);
    const shapes: number[][] = raw.shapesJson ? JSON.parse(raw.shapesJson) : (legacy.shapes ?? []);
    return { weights, shapes, gamesCount: raw.gamesCount || 0 };
  } catch {
    return null;
  }
}
