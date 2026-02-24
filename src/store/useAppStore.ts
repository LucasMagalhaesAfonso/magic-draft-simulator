import { create } from 'zustand';
import type { Screen, Card, DeckList } from '../lib/types';

export type ThemeId = 'spark' | 'nyx' | 'phyrexian' | 'kamigawa' | 'obscura';
export type PlaymatId = 'default' | 'forest' | 'ocean' | 'mountain' | 'plains' | 'swamp' | 'nyx' | 'custom';

const PLAYMAT_KEY = 'mtg_draft_playmat';
const PLAYMAT_ART_KEY = 'mtg_draft_playmat_art';
const PLAYMAT_POS_KEY = 'mtg_draft_playmat_pos';
const PLAYMAT_SIZE_KEY = 'mtg_draft_playmat_size';
const LAND_ARTS_KEY = 'mtg_draft_land_arts';
const SLEEVE_ART_KEY = 'mtg_draft_sleeve_art';

function loadPlaymat(): PlaymatId { return (localStorage.getItem(PLAYMAT_KEY) as PlaymatId) || 'default'; }
function loadPlaymatArt(): string { return localStorage.getItem(PLAYMAT_ART_KEY) || ''; }
function loadPlaymatPosition(): string { return localStorage.getItem(PLAYMAT_POS_KEY) || '50% 50%'; }
function loadPlaymatSize(): number { return parseInt(localStorage.getItem(PLAYMAT_SIZE_KEY) || '0') || 0; }
function loadLandArts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAND_ARTS_KEY) || '{}'); }
  catch { return {}; }
}
function loadSleeveArt(): string { return localStorage.getItem(SLEEVE_ART_KEY) || ''; }

const THEME_KEY = 'mtg_draft_theme';

function loadTheme(): ThemeId {
  return (localStorage.getItem(THEME_KEY) as ThemeId) || 'spark';
}

function applyThemeClass(theme: ThemeId) {
  document.body.className = document.body.className
    .replace(/\btheme-\S+/g, '')
    .trim();
  document.body.classList.add(`theme-${theme}`);
  localStorage.setItem(THEME_KEY, theme);
}

// Apply on load
applyThemeClass(loadTheme());

interface AppState {
  // Navigation
  screen: Screen;
  setScreen: (screen: Screen) => void;

  // Selected set for draft
  selectedSet: string;
  setSelectedSet: (set: string) => void;

  // Draft result
  draftPool: Card[];
  setDraftPool: (pool: Card[]) => void;
  aiDraftPool: Card[];
  setAiDraftPool: (pool: Card[]) => void;

  // Sealed packs (for reveal screen)
  sealedPacks: Card[][] | null;
  setSealedPacks: (packs: Card[][] | null) => void;

  // Built deck
  deck: DeckList | null;
  setDeck: (deck: DeckList | null) => void;

  // Database status
  dbReady: boolean;
  setDbReady: (ready: boolean) => void;
  totalCards: number;
  setTotalCards: (count: number) => void;

  // Sync status
  syncing: boolean;
  syncMessage: string;
  setSyncing: (syncing: boolean, message?: string) => void;

  // Theme
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;

  // Playmat
  playmat: PlaymatId;
  playmatArt: string;
  playmatPosition: string;
  playmatSize: number;
  setPlaymat: (playmat: PlaymatId, artUrl?: string) => void;
  setPlaymatPosition: (pos: string) => void;
  setPlaymatSize: (size: number) => void;

  // Land arts: color (W/U/B/R/G) -> selected art URL
  landArts: Record<string, string>;
  setLandArt: (color: string, artUrl: string) => void;
  resetLandArts: () => void;

  // Sleeve / card back art
  sleeveArt: string;
  setSleeveArt: (artUrl: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'home',
  setScreen: (screen) => set({ screen }),

  selectedSet: 'tdm',
  setSelectedSet: (selectedSet) => set({ selectedSet }),

  draftPool: [],
  setDraftPool: (draftPool) => set({ draftPool }),
  aiDraftPool: [],
  setAiDraftPool: (aiDraftPool) => set({ aiDraftPool }),

  sealedPacks: null,
  setSealedPacks: (sealedPacks) => set({ sealedPacks }),

  deck: null,
  setDeck: (deck) => set({ deck }),

  dbReady: false,
  setDbReady: (dbReady) => set({ dbReady }),
  totalCards: 0,
  setTotalCards: (totalCards) => set({ totalCards }),

  syncing: false,
  syncMessage: '',
  setSyncing: (syncing, message = '') => set({ syncing, syncMessage: message }),

  theme: loadTheme(),
  setTheme: (theme) => {
    applyThemeClass(theme);
    set({ theme });
  },

  playmat: loadPlaymat(),
  playmatArt: loadPlaymatArt(),
  playmatPosition: loadPlaymatPosition(),
  setPlaymat: (playmat, artUrl = '') => {
    localStorage.setItem(PLAYMAT_KEY, playmat);
    if (artUrl) localStorage.setItem(PLAYMAT_ART_KEY, artUrl);
    else localStorage.removeItem(PLAYMAT_ART_KEY);
    set({ playmat, playmatArt: artUrl });
  },
  playmatSize: loadPlaymatSize(),
  setPlaymatPosition: (pos) => {
    localStorage.setItem(PLAYMAT_POS_KEY, pos);
    set({ playmatPosition: pos });
  },
  setPlaymatSize: (size) => {
    localStorage.setItem(PLAYMAT_SIZE_KEY, String(size));
    set({ playmatSize: size });
  },

  landArts: loadLandArts(),
  setLandArt: (color, artUrl) => {
    const next = { ...get().landArts, [color]: artUrl };
    localStorage.setItem(LAND_ARTS_KEY, JSON.stringify(next));
    set({ landArts: next });
  },
  resetLandArts: () => {
    localStorage.removeItem(LAND_ARTS_KEY);
    set({ landArts: {} });
  },

  sleeveArt: loadSleeveArt(),
  setSleeveArt: (artUrl) => {
    if (artUrl) localStorage.setItem(SLEEVE_ART_KEY, artUrl);
    else localStorage.removeItem(SLEEVE_ART_KEY);
    set({ sleeveArt: artUrl });
  },
}));
