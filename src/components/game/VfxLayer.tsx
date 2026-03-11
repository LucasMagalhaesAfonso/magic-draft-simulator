// VfxLayer.tsx — Sprite-based visual effects overlay

import { useEffect, useRef } from 'react';
import './VfxLayer.css';

// ── VFX event types ───────────────────────────────────────────────────────────

export type VfxEventType =
  | 'damage'
  | 'playerDamage'
  | 'heal'
  | 'death'
  | 'spellCast'
  | 'buff'
  | 'exile'
  | 'bounce'
  | 'destroy'
  | 'mill'
  | 'ramp'
  | 'boardWipe'
  | 'counterSpell'
  | 'attackFire'
  | 'attackWater'
  | 'attackIce'
  | 'attackDark'
  | 'attackGreen'
  | 'attackLightning'
  | 'attackGold'
  | 'attackBlood'
  | 'landEtb'
  | 'creatureEtb';

export interface VfxEvent {
  id: number;
  type: VfxEventType;
  targetUid?: string;
  x?: number;
  y?: number;
}

// ── Sprite mapping ────────────────────────────────────────────────────────────

const SPRITE_MAP: Record<VfxEventType, string[]> = {
  damage:        ['slash_ice_1.png', 'slash_ice_2.png', 'slash_ice_3.png', 'slash_ice_6.png', 'slash_ice_8.png', 'slash_ice_10.png', 'slash_ice_11.png', 'attack_red_claw.png'],
  playerDamage:  ['blood_splat_1.png', 'blood_splat_5.png', 'blood_splat_6.png', 'blood_splat_9.png', 'blood_splat_10.png'],
  heal:          ['water_splash.png', 'teal_impact.png', 'water_geyser.png', 'teal_vortex.png'],
  death:         ['death_2.png', 'death_3.png'],
  spellCast:     ['fx_1.png', 'fx_2.png', 'fx_3.png', 'fx_4.png', 'elem_1.png', 'elem_2.png'],
  buff:          ['purple_wisp.png', 'purple_alt_1.png', 'purple_orb.png', 'purple_spiral.png'],
  exile:         ['dark_vortex.png', 'dark_swirl.png', 'purple_pillar.png', 'dark_9.png'],
  bounce:        ['water_arc.png', 'water_burst.png', 'water_fountain.png', 'water_slash.png'],
  destroy:       ['dark_explosion.png', 'dark_burst.png', 'fire_sharp.png', 'fire_lava.png'],
  mill:          ['dark_ghost.png', 'dark_8.png', 'dark_projectile.png'],
  ramp:          ['fire_spirit.png', 'elem_5.png', 'elem_6.png'],
  boardWipe:     ['dark_explosion.png', 'flame_10.png', 'fire_dragon.png', 'fire_dark.png', 'flame_1.png'],
  counterSpell:  ['blue_lightning_big.png', 'blue_bolt_sm.png', 'blue_dissipate.png', 'blue_slash.png'],
  attackFire:    ['attack_fire_bolt.png', 'attack_fire_swoosh.png', 'fire_rounded.png', 'fire_swooshy.png'],
  attackWater:   ['attack_water_jet.png', 'attack_water_splash.png', 'attack_water_wave.png', 'water_wave.png'],
  attackIce:     ['attack_crystal.png', 'ice_comet.png', 'ice_whip.png', 'slash_ice_1.png', 'slash_ice_4.png'],
  attackDark:    ['attack_pink_flame.png', 'dark_slash.png', 'purple_flame_sm.png', 'purple_eruption.png'],
  attackGreen:   ['attack_green_slash.png', 'elem_8.png', 'elem_9.png'],
  attackLightning: ['attack_lightning_bolt.png', 'lightning_1.png', 'lightning_2.png', 'lightning_3.png'],
  attackGold:    ['attack_gold_ring.png', 'purple_alt_2.png', 'fx_4.png'],
  attackBlood:   ['attack_red_claw.png', 'blood_splat_11.png', 'blood_splat_12.png'],
  landEtb:       ['elem_11.png', 'elem_8.png', 'fx_4.png'],
  creatureEtb:   ['fx_3.png', 'fx_4.png'],
};

function pickSprite(type: VfxEventType): string {
  const list = SPRITE_MAP[type] || SPRITE_MAP.damage;
  return list[Math.floor(Math.random() * list.length)];
}

// ── Per-type animation config ─────────────────────────────────────────────────

interface VfxTypeConfig {
  anim: string;
  size: number;
  duration: number;
  burst: number;
  scatter: number;
  shake: boolean;
  flash?: 'red' | 'green';
  noRotate?: boolean;
  burstDelay?: number; // ms between each burst sprite (default 55)
  sweepY?: number;     // px to shift each successive sprite downward (claw swipe effect)
  lastBurstSize?: number; // override size for the last burst sprite
  perBurst?: Array<{ rotation?: number; size?: number; noHue?: boolean; delayMs?: number; anim?: string; duration?: number }>; // per-sprite overrides
}

const TYPE_CONFIG: Record<VfxEventType, VfxTypeConfig> = {
  damage:          { anim: 'vfxPop',    size: 100, duration: 380, burst: 8,  scatter: 5,  shake: false, noRotate: true,  burstDelay: 55, sweepY: 9, lastBurstSize: 60 },
  playerDamage:    { anim: 'vfxBurst',  size: 100, duration: 460, burst: 2, scatter: 30, shake: false, flash: 'red' },
  heal:            { anim: 'vfxFloat',  size: 80,  duration: 600, burst: 1, scatter: 12, shake: false, flash: 'green' },
  death:           { anim: 'vfxGrowVisible', size: 105, duration: 600, burst: 2, scatter: 0, shake: false, noRotate: true,
                     perBurst: [
                       { rotation: 0, size: 90,  anim: 'vfxGrowVisible', duration: 600 },          // death_2: pequeno→cresce→some
                       { rotation: 0, size: 100, anim: 'vfxFloat',       duration: 480, delayMs: 280 }, // death_3: flutua enquanto death_2 ainda visível
                     ] },
  spellCast:       { anim: 'vfxPop',    size: 85,  duration: 420, burst: 1, scatter: 0,  shake: false },
  buff:            { anim: 'vfxFloat',  size: 80,  duration: 620, burst: 1, scatter: 14, shake: false },
  exile:           { anim: 'vfxSpin',   size: 95,  duration: 560, burst: 1, scatter: 0,  shake: false },
  bounce:          { anim: 'vfxFloat',  size: 80,  duration: 500, burst: 1, scatter: 10, shake: false },
  destroy:         { anim: 'vfxBurst',  size: 105, duration: 420, burst: 2, scatter: 22, shake: false },
  mill:            { anim: 'vfxFloat',  size: 75,  duration: 450, burst: 1, scatter: 0,  shake: false },
  ramp:            { anim: 'vfxFloat',  size: 75,  duration: 520, burst: 1, scatter: 0,  shake: false },
  boardWipe:       { anim: 'vfxSpin',   size: 200, duration: 750, burst: 5, scatter: 70, shake: true },
  counterSpell:    { anim: 'vfxShock',  size: 110, duration: 460, burst: 2, scatter: 20, shake: false },
  attackFire:      { anim: 'vfxBurst',  size: 110, duration: 380, burst: 1, scatter: 10, shake: false },
  attackWater:     { anim: 'vfxBurst',  size: 110, duration: 380, burst: 1, scatter: 10, shake: false },
  attackIce:       { anim: 'vfxBurst',  size: 105, duration: 380, burst: 1, scatter: 10, shake: false },
  attackDark:      { anim: 'vfxBurst',  size: 105, duration: 380, burst: 1, scatter: 10, shake: false },
  attackGreen:     { anim: 'vfxBurst',  size: 105, duration: 380, burst: 1, scatter: 10, shake: false },
  attackLightning: { anim: 'vfxShock',  size: 110, duration: 360, burst: 1, scatter: 10, shake: false },
  attackGold:      { anim: 'vfxPop',    size: 100, duration: 400, burst: 1, scatter: 10, shake: false },
  attackBlood:     { anim: 'vfxBurst',  size: 105, duration: 380, burst: 1, scatter: 10, shake: false },
  landEtb:         { anim: 'vfxPop',    size: 90,  duration: 550, burst: 3, scatter: 22, shake: false, noRotate: true },
  creatureEtb:     { anim: 'vfxGrow', size: 90, duration: 640, burst: 2, scatter: 0, shake: false, noRotate: true,
                     perBurst: [
                       { rotation: 0,   size: 110, anim: 'vfxGrowVisible', duration: 640 },         // fx_3: visualmente pequeno→cresce até 110px→some
                       { rotation: 0,   size: 95,  anim: 'vfxPop',  duration: 440, noHue: true, delayMs: 300 }, // fx_4: entra no pico do fx_3, fica sozinho no final
                     ] },
};

// ── Combat Strike system ──────────────────────────────────────────────────────

export const TRAVEL_MS = 300; // projectile travel time

// Tracks when the last combat animation finishes (epoch ms)
let _combatAnimEndMs = 0;

// Card position cache: captured synchronously during combat (before React DOM update)
interface CachedCardPos { x: number; y: number; w: number; h: number; imgSrc: string; }
const _cardPosCache = new Map<string, CachedCardPos>();

interface CombatStrike {
  id: number;
  fromX: number; fromY: number;
  toX: number;   toY: number;
  onHit: () => void;
}

type StrikeListener = (strikes: CombatStrike[]) => void;

let _strikes: CombatStrike[] = [];
const _strikeListeners = new Set<StrikeListener>();
function _notifyStrikes() { _strikeListeners.forEach(fn => fn([..._strikes])); }

// ── VFX Manager (singleton) ───────────────────────────────────────────────────

interface VfxEntry {
  id: number;
  sprite: string;
  x: number;
  y: number;
  size: number;
  duration: number;
  anim: string;
  rotation: number;
  delay: number;
  hue?: string; // full CSS filter string for colorization (e.g. "hue-rotate(180deg) saturate(2)")
}

interface TextEntry {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
}

type SpriteListener = (entries: VfxEntry[]) => void;
type TextListener   = (entries: TextEntry[]) => void;

let _nextId = 1;
let _entries:     VfxEntry[]  = [];
let _textEntries: TextEntry[] = [];
let _enabled = true; // disabled during self-play to avoid page shake/sounds
const _spriteListeners = new Set<SpriteListener>();
const _textListeners   = new Set<TextListener>();

function _notifySprites() { _spriteListeners.forEach(fn => fn([..._entries])); }
function _notifyText()    { _textListeners.forEach(fn => fn([..._textEntries])); }

function _resolvePos(targetUid?: string, fallbackX?: number, fallbackY?: number) {
  let x = fallbackX ?? window.innerWidth / 2;
  let y = fallbackY ?? window.innerHeight / 2;
  if (targetUid) {
    const el = document.querySelector(`[data-uid="${targetUid}"]`);
    if (el) {
      const rect = el.getBoundingClientRect();
      x = rect.left + rect.width  / 2;
      y = rect.top  + rect.height / 2;
    } else if (targetUid === 'p0' || targetUid === 'p1') {
      const lifeEl = document.querySelector(`[data-player-id="${targetUid}"]`);
      if (lifeEl) {
        const rect = lifeEl.getBoundingClientRect();
        x = rect.left + rect.width  / 2;
        y = rect.top  + rect.height / 2;
      } else {
        x = window.innerWidth  * 0.08;
        y = targetUid === 'p0' ? window.innerHeight * 0.93 : window.innerHeight * 0.05;
      }
    }
  }
  return { x, y };
}

function _triggerShake() {
  // Only shake when actually inside a game — never fall back to body/settings
  const el = document.querySelector<HTMLElement>('.game-screen');
  if (!el) return;
  el.classList.remove('vfx-shake');
  void el.offsetHeight;
  el.classList.add('vfx-shake');
  setTimeout(() => el.classList.remove('vfx-shake'), 500);
}

function _triggerFlash(color: 'red' | 'green') {
  const el = document.getElementById('vfx-flash-overlay');
  if (!el) return;
  el.className = '';
  void el.offsetHeight;
  el.className = `vfx-flash-${color}`;
}

export const VfxManager = {
  /** Disable all VFX + shake during self-play to prevent Settings page shake */
  setEnabled(v: boolean) { _enabled = v; },

  /** Called by combat bridge to register when the last animation finishes */
  setCombatAnimEnd(endMs: number) { _combatAnimEndMs = Math.max(_combatAnimEndMs, endMs); },
  /** Returns how many ms of combat animation remain (0 if none) */
  combatAnimRemainingMs() { return Math.max(0, _combatAnimEndMs - Date.now()); },

  /** Capture a card's DOM position + image NOW (before React removes it) */
  cacheCardPos(uid: string) {
    const el = document.querySelector(`[data-uid="${uid}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const img  = el.querySelector('img') as HTMLImageElement | null;
    if (img?.src) _cardPosCache.set(uid, { x: rect.left, y: rect.top, w: rect.width, h: rect.height, imgSrc: img.src });
  },
  getCachedCardPos(uid: string): CachedCardPos | null { return _cardPosCache.get(uid) ?? null; },
  clearCardPosCache() { _cardPosCache.clear(); },

  subscribe(fn: SpriteListener): () => void {
    _spriteListeners.add(fn);
    return () => _spriteListeners.delete(fn);
  },

  subscribeText(fn: TextListener): () => void {
    _textListeners.add(fn);
    return () => _textListeners.delete(fn);
  },

  play(type: VfxEventType, targetUid?: string, fallbackX?: number, fallbackY?: number, hue?: string) {
    if (!_enabled) return;
    const { x, y } = _resolvePos(targetUid, fallbackX, fallbackY);
    const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.damage;

    if (cfg.shake) _triggerShake();
    if (cfg.flash) _triggerFlash(cfg.flash);

    const spriteList = SPRITE_MAP[type] || SPRITE_MAP.damage;
    for (let b = 0; b < cfg.burst; b++) {
      const id = _nextId++;
      // When noRotate: cycle through sprites in order (deterministic), else random
      const sprite   = cfg.noRotate
        ? spriteList[b % spriteList.length]
        : pickSprite(type);
      const ox       = cfg.scatter > 0 ? (Math.random() - 0.5) * cfg.scatter * 2 : 0;
      // sweepY: sprites start above center and move down — claw swipe top→bottom
      const sweepOffset = cfg.sweepY ? (b - (cfg.burst - 1) / 2) * cfg.sweepY : 0;
      const oy       = sweepOffset + (cfg.scatter > 0 ? (Math.random() - 0.5) * cfg.scatter : 0);
      const rotation = cfg.noRotate ? 0 : Math.floor(Math.random() * 360);
      const delay    = b * (cfg.burstDelay ?? 55);
      const pb = cfg.perBurst?.[b];
      const isLast = b === cfg.burst - 1;
      const finalSize     = pb?.size     ?? ((isLast && cfg.lastBurstSize) ? cfg.lastBurstSize : cfg.size);
      const finalRotation = pb?.rotation ?? rotation;
      const finalDelay    = pb?.delayMs  ?? delay;
      const finalHue      = pb?.noHue    ? undefined : hue;
      const finalAnim     = pb?.anim     ?? cfg.anim;
      const finalDuration = pb?.duration ?? cfg.duration;
      const entry: VfxEntry = {
        id, sprite,
        x: x + ox, y: y + oy,
        size:     finalSize,
        duration: finalDuration,
        anim:     finalAnim,
        rotation: finalRotation,
        delay:    finalDelay,
        hue:      finalHue,
      };
      _entries = [..._entries, entry];
      _notifySprites();
      setTimeout(() => {
        _entries = _entries.filter(e => e.id !== id);
        _notifySprites();
      }, finalDelay + finalDuration + 130);
    }
  },

  subscribeStrikes(fn: StrikeListener): () => void {
    _strikeListeners.add(fn);
    return () => _strikeListeners.delete(fn);
  },

  /** Arena-style: projectile travels from (fromX,fromY) to (toX,toY), then calls onHit() */
  playCombatStrike(fromX: number, fromY: number, toX: number, toY: number, onHit: () => void) {
    if (!_enabled) { onHit(); return; }
    const id = _nextId++;
    const strike: CombatStrike = { id, fromX, fromY, toX, toY, onHit };
    _strikes = [..._strikes, strike];
    _notifyStrikes();
    setTimeout(() => {
      onHit();
      _strikes = _strikes.filter(s => s.id !== id);
      _notifyStrikes();
    }, TRAVEL_MS);
  },

  /** Floating damage/effect text (e.g. "-3", "+5 ❤") */
  playText(text: string, targetUid?: string, color = '#ff4a4a', fixedX?: number, fixedY?: number) {
    if (!_enabled) return;
    const { x, y } = fixedX !== undefined ? { x: fixedX, y: fixedY! } : _resolvePos(targetUid);
    const id = _nextId++;
    const entry: TextEntry = { id, text, x, y: y - 10, color };
    _textEntries = [..._textEntries, entry];
    _notifyText();
    setTimeout(() => {
      _textEntries = _textEntries.filter(e => e.id !== id);
      _notifyText();
    }, 950);
  },
};

// ── VfxLayer Component ────────────────────────────────────────────────────────

export function VfxLayer() {
  const spriteContainerRef = useRef<HTMLDivElement>(null);
  const textContainerRef   = useRef<HTMLDivElement>(null);
  const strikeContainerRef = useRef<HTMLDivElement>(null);

  // ── Sprite renderer ──
  useEffect(() => {
    return VfxManager.subscribe(newEntries => {
      const container = spriteContainerRef.current;
      if (!container) return;

      const ids = new Set(newEntries.map(e => e.id));
      container.querySelectorAll<HTMLImageElement>('.vfx-sprite').forEach(el => {
        if (!ids.has(Number(el.dataset.vfxId))) el.remove();
      });

      const existing = new Set(
        Array.from(container.querySelectorAll<HTMLElement>('.vfx-sprite'))
          .map(el => Number(el.dataset.vfxId))
      );
      for (const entry of newEntries) {
        if (existing.has(entry.id)) continue;
        const img = document.createElement('img');
        img.className = 'vfx-sprite';
        img.dataset.vfxId = String(entry.id);
        img.src = `/img/sprites/${entry.sprite}`;
        img.onerror = () => { img.style.display = 'none'; };
        const hueFilter = entry.hue || '';
        img.style.cssText = `
          position: absolute;
          left: ${entry.x - entry.size / 2}px;
          top:  ${entry.y - entry.size / 2}px;
          width:  ${entry.size}px;
          height: ${entry.size}px;
          pointer-events: none;
          animation: ${entry.anim} ${entry.duration}ms ease-out ${entry.delay}ms forwards;
          mix-blend-mode: screen;
          z-index: 500;
          opacity: 0;
          --r: ${entry.rotation}deg;
          ${hueFilter ? `filter: ${hueFilter};` : ''}
        `;
        container.appendChild(img);
      }
    });
  }, []);

  // ── Text float renderer ──
  useEffect(() => {
    return VfxManager.subscribeText(newEntries => {
      const container = textContainerRef.current;
      if (!container) return;

      const ids = new Set(newEntries.map(e => e.id));
      container.querySelectorAll<HTMLElement>('.vfx-text').forEach(el => {
        if (!ids.has(Number(el.dataset.vfxId))) el.remove();
      });

      const existing = new Set(
        Array.from(container.querySelectorAll<HTMLElement>('.vfx-text'))
          .map(el => Number(el.dataset.vfxId))
      );
      for (const entry of newEntries) {
        if (existing.has(entry.id)) continue;
        const div = document.createElement('div');
        div.className = 'vfx-text';
        div.dataset.vfxId = String(entry.id);
        div.textContent = entry.text;
        div.style.cssText = `
          position: absolute;
          left: ${entry.x}px;
          top:  ${entry.y}px;
          transform: translateX(-50%);
          color: ${entry.color};
          font-size: 22px;
          font-weight: 900;
          font-family: 'Segoe UI', sans-serif;
          text-shadow: 0 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6);
          pointer-events: none;
          animation: vfxFloatText 0.88s ease-out forwards;
          z-index: 501;
          white-space: nowrap;
        `;
        container.appendChild(div);
      }
    });
  }, []);

  // ── Combat strike projectile renderer ──
  useEffect(() => {
    return VfxManager.subscribeStrikes(strikes => {
      const container = strikeContainerRef.current;
      if (!container) return;

      const ids = new Set(strikes.map(s => s.id));
      container.querySelectorAll<HTMLElement>('.vfx-strike').forEach(el => {
        if (!ids.has(Number(el.dataset.strikeId))) el.remove();
      });

      const existing = new Set(
        Array.from(container.querySelectorAll<HTMLElement>('.vfx-strike'))
          .map(el => Number(el.dataset.strikeId))
      );
      for (const s of strikes) {
        if (existing.has(s.id)) continue;
        const SIZE = 36;
        const dx = s.fromX - s.toX;
        const dy = s.fromY - s.toY;
        const el = document.createElement('img');
        el.className = 'vfx-strike';
        el.dataset.strikeId = String(s.id);
        el.src = '/img/sprites/attack_red_claw.png';
        el.onerror = () => { el.style.display = 'none'; };
        el.style.cssText = `
          position: fixed;
          left: ${s.toX - SIZE / 2}px;
          top:  ${s.toY - SIZE / 2}px;
          width: ${SIZE}px;
          height: ${SIZE}px;
          pointer-events: none;
          z-index: 600;
          --sx: ${dx}px; --sy: ${dy}px;
          --dur: ${TRAVEL_MS}ms;
          animation: combatTravel var(--dur) ease-in forwards;
          filter: drop-shadow(0 0 6px rgba(255,200,80,0.9));
        `;
        container.appendChild(el);
      }
    });
  }, []);

  return (
    <>
      {/* Flash overlay for playerDamage / heal */}
      <div id="vfx-flash-overlay" />
      {/* Sprite container */}
      <div ref={spriteContainerRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 500, overflow: 'hidden' }} />
      {/* Combat strike projectiles */}
      <div ref={strikeContainerRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 600 }} />
      {/* Floating text container */}
      <div ref={textContainerRef}   style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 601, overflow: 'hidden' }} />
    </>
  );
}
