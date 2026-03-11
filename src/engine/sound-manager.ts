// sound-manager.ts — Game audio system
// Sons definidos um a um junto com o usuário.

export type SfxType =
  | 'card_draw'
  | 'land_tap'
  | 'hit_creature'
  | 'spell_cast'
  | 'creature_death'
  | 'board_wipe'
  | 'counter_spell'
  | 'heal'
  | 'game_win'
  | 'game_lose';

class _SoundManager {
  private _ctx: AudioContext | null = null;
  private _enabled = true;
  private _masterVolume = 0.75;
  private _initialized = false;

  init() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch { /* silently ignore */ }
  }

  private _ctx_(): AudioContext | null {
    if (!this._ctx) return null;
    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._ctx;
  }

  // Todos os sons estão mudos por enquanto — serão definidos um a um
  play(_type: SfxType) {
    // TODO: implementar sons
  }

  setEnabled(enabled: boolean) { this._enabled = enabled; }
  setVolume(volume: number) {
    this._masterVolume = Math.max(0, Math.min(1, volume));
  }
  get enabled() { return this._enabled; }
  get volume()  { return this._masterVolume; }
}

export const SoundManager = new _SoundManager();
