import { writeTextFile, readTextFile, BaseDirectory, exists } from '@tauri-apps/plugin-fs';

const RECORDS_FILE = 'game-records.json';
const MAX_RECORDS = 30;
const LS_KEY = 'mtg_game_records_v1';

export interface GameAction {
  turn: number;
  phase: string;
  player: 0 | 1;
  isHuman: boolean;
  description: string;
  cards: string[];
  life: [number, number];
}

export interface GameRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  winner: 'human' | 'ai' | 'draw' | null;
  totalTurns: number;
  actions: GameAction[];
}

class GameRecorder {
  private current: GameRecord | null = null;
  private history: GameRecord[] = [];
  private _loaded = false;
  private _gs: any = null;

  async load(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    try {
      const fileExists = await exists(RECORDS_FILE, { baseDir: BaseDirectory.AppData });
      if (fileExists) {
        const raw = await readTextFile(RECORDS_FILE, { baseDir: BaseDirectory.AppData });
        this.history = JSON.parse(raw);
        return;
      }
    } catch { /* Tauri FS not available in dev mode */ }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.history = JSON.parse(raw);
    } catch { /* ignore */ }
  }

  private async _save(): Promise<void> {
    const trimmed = this.history.slice(-MAX_RECORDS);
    this.history = trimmed;
    const data = JSON.stringify(trimmed);
    try {
      await writeTextFile(RECORDS_FILE, data, { baseDir: BaseDirectory.AppData });
    } catch { /* Tauri FS unavailable */ }
    try { localStorage.setItem(LS_KEY, data); } catch { /* ignore */ }
  }

  startGame(gs: any): void {
    this._gs = gs;
    this.current = {
      id: `game_${Date.now()}`,
      startedAt: new Date().toISOString(),
      endedAt: null,
      winner: null,
      totalTurns: 0,
      actions: [],
    };
  }

  setGs(gs: any): void {
    this._gs = gs;
  }

  record(partial: { player: 0 | 1; isHuman: boolean; phase: string; description: string; cards?: string[] }): void {
    if (!this.current || !this._gs) return;
    const gs = this._gs;
    this.current.actions.push({
      turn: gs.turnCount ?? gs.turn ?? 0,
      phase: partial.phase,
      player: partial.player,
      isHuman: partial.isHuman,
      description: partial.description,
      cards: partial.cards || [],
      life: [
        gs.players?.[0]?.lifeTotal ?? 20,
        gs.players?.[1]?.lifeTotal ?? 20,
      ],
    });
  }

  async endGame(winnerPlayer: number | null, totalTurns: number): Promise<void> {
    if (!this.current) return;
    this.current.endedAt = new Date().toISOString();
    this.current.totalTurns = totalTurns;
    if (winnerPlayer === 0) this.current.winner = 'human';
    else if (winnerPlayer === 1) this.current.winner = 'ai';
    else this.current.winner = 'draw';
    this.history.push({ ...this.current });
    this.current = null;
    await this._save();
  }

  getHistory(): GameRecord[] {
    return [...this.history].reverse();
  }

  getStats() {
    const h = this.history;
    const wins   = h.filter(r => r.winner === 'human').length;
    const losses = h.filter(r => r.winner === 'ai').length;
    const draws  = h.filter(r => r.winner === 'draw').length;
    return { total: h.length, wins, losses, draws };
  }

  exportJson(): string {
    return JSON.stringify(this.history, null, 2);
  }
}

export const gameRecorder = new GameRecorder();
