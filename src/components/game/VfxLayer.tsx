// VfxLayer.tsx — Sprite-based visual effects overlay
// Mirrors the legacy vfx.js system with React state

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
  | 'attackBlood';

export interface VfxEvent {
  id: number;
  type: VfxEventType;
  // Target element's data-uid, or player id ('p0'/'p1')
  targetUid?: string;
  // Fallback position
  x?: number;
  y?: number;
}

// ── Sprite mapping ────────────────────────────────────────────────────────────

const SPRITE_MAP: Record<VfxEventType, string[]> = {
  damage:        ['blood_splat_1.png', 'blood_splat_2.png', 'blood_splat_3.png'],
  playerDamage:  ['blood_splat_4.png', 'blood_splat_5.png', 'blood_splat_8.png'],
  heal:          ['water_splash.png', 'teal_impact.png'],
  death:         ['death_1.png', 'death_2.png', 'death_3.png'],
  spellCast:     ['fx_1.png', 'fx_2.png', 'fx_3.png'],
  buff:          ['purple_wisp.png', 'purple_alt_1.png'],
  exile:         ['dark_vortex.png', 'dark_swirl.png'],
  bounce:        ['water_arc.png', 'water_burst.png'],
  destroy:       ['dark_explosion.png', 'dark_burst.png'],
  mill:          ['dark_ghost.png', 'dark_8.png'],
  ramp:          ['fire_spirit.png'],
  boardWipe:     ['dark_explosion.png', 'flame_10.png'],
  counterSpell:  ['blue_lightning_big.png', 'blue_bolt_sm.png'],
  attackFire:    ['attack_fire_bolt.png', 'attack_fire_swoosh.png'],
  attackWater:   ['attack_water_jet.png', 'attack_water_splash.png', 'attack_water_wave.png'],
  attackIce:     ['attack_crystal.png'],
  attackDark:    ['attack_pink_flame.png'],
  attackGreen:   ['attack_green_slash.png'],
  attackLightning: ['attack_lightning_bolt.png'],
  attackGold:    ['purple_alt_2.png', 'fx_4.png'],
  attackBlood:   ['attack_red_claw.png'],
};

function pickSprite(type: VfxEventType): string {
  const list = SPRITE_MAP[type] || SPRITE_MAP.damage;
  return list[Math.floor(Math.random() * list.length)];
}

// ── VFX Manager (singleton) ───────────────────────────────────────────────────

interface VfxEntry {
  id: number;
  sprite: string;
  x: number;
  y: number;
  size: number;
  duration: number;
}

type Listener = (entries: VfxEntry[]) => void;

let _nextId = 1;
let _entries: VfxEntry[] = [];
const _listeners = new Set<Listener>();

function _notify() {
  _listeners.forEach(fn => fn([..._entries]));
}

export const VfxManager = {
  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },

  play(_type: VfxEventType, _targetUid?: string, _fallbackX?: number, _fallbackY?: number) {
    // VFX disabled
  },
};

// ── VfxLayer Component ────────────────────────────────────────────────────────

export function VfxLayer() {
  const entriesRef = useRef<VfxEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return VfxManager.subscribe(newEntries => {
      entriesRef.current = newEntries;
      // Directly mutate DOM for performance (VFX doesn't need React reconciliation)
      const container = containerRef.current;
      if (!container) return;

      // Remove old sprites not in current list
      const ids = new Set(newEntries.map(e => e.id));
      container.querySelectorAll<HTMLImageElement>('.vfx-sprite').forEach(el => {
        if (!ids.has(Number(el.dataset.vfxId))) el.remove();
      });

      // Add new sprites
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
        img.style.cssText = `
          position: absolute;
          left: ${entry.x - entry.size / 2}px;
          top: ${entry.y - entry.size / 2}px;
          width: ${entry.size}px;
          height: ${entry.size}px;
          pointer-events: none;
          animation: vfxPop ${entry.duration}ms ease-out forwards;
          mix-blend-mode: screen;
          z-index: 500;
        `;
        container.appendChild(img);
      }
    });
  }, []);

  return (
    <div
      ref={containerRef}
      className="vfx-layer"
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none',
        zIndex: 500,
        overflow: 'hidden',
      }}
    />
  );
}
