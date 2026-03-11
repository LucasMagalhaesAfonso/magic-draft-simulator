// vfx-bridge.ts — Decouples engine from UI VFX layer
// The UI (useGameEngine.ts) injects the VFX functions at startup.
// Engine files call vfxPlay() without knowing about React.

type VfxFn        = (type: string, targetUid?: string) => void;
type VfxTextFn    = (text: string, targetUid?: string, color?: string) => void;
// groupKey = attacker UID — same key = same time slot (double/triple block); different key = next slot
type CombatVfxFn  = (fromUid: string, toUid: string, revFrom?: string, revTo?: string, groupKey?: string) => void;

let _vfxPlay:     VfxFn        | null = null;
let _vfxPlayText: VfxTextFn    | null = null;
let _vfxCombat:   CombatVfxFn  | null = null;

export function setVfxBridge(fn: VfxFn): void         { _vfxPlay     = fn; }
export function setVfxTextBridge(fn: VfxTextFn): void { _vfxPlayText = fn; }
export function setCombatVfxBridge(fn: CombatVfxFn): void { _vfxCombat = fn; }

export function vfxPlay(type: string, targetUid?: string): void {
  if (_vfxPlay) _vfxPlay(type, targetUid);
}

export function vfxPlayText(text: string, targetUid?: string, color?: string): void {
  if (_vfxPlayText) _vfxPlayText(text, targetUid, color);
}

/** Called during creature-vs-creature combat. Both strike directions happen simultaneously. */
export function vfxPlayCombat(fromUid: string, toUid: string, revFrom?: string, revTo?: string, groupKey?: string): void {
  if (_vfxCombat) _vfxCombat(fromUid, toUid, revFrom, revTo, groupKey);
}
