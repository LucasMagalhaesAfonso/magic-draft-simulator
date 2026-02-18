// vfx-bridge.ts — Decouples engine from UI VFX layer
// The UI (useGameEngine.ts) injects the VFX function at startup.
// Engine files call vfxPlay() without knowing about React.

type VfxFn = (type: string, targetUid?: string) => void;

let _vfxPlay: VfxFn | null = null;

export function setVfxBridge(fn: VfxFn): void {
  _vfxPlay = fn;
}

export function vfxPlay(type: string, targetUid?: string): void {
  if (_vfxPlay) _vfxPlay(type, targetUid);
}
