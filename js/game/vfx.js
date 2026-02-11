/**
 * VFX System - Visual effects for game actions
 * Uses CSS animations + transparent sprite overlays for damage, spells, death, etc.
 * Sprites processed from img/ folder into img/sprites/ with transparent backgrounds.
 * Uses mix-blend-mode: screen for additive glow on remaining dark pixels.
 */
const VFX = {
  // Individual sprite assets (transparent PNGs)
  SPRITES: {
    // Fire / Red
    fire: [
      'img/sprites/fire_1.png', 'img/sprites/fire_2.png', 'img/sprites/fire_3.png', 'img/sprites/fire_4.png',
      'img/sprites/fire_5.png', 'img/sprites/fire_6.png', 'img/sprites/fire_7.png', 'img/sprites/fire_8.png',
    ],
    fireball: ['img/sprites/elem_1.png', 'img/sprites/elem_3.png'],
    flame: ['img/sprites/flame_1.png', 'img/sprites/flame_2.png', 'img/sprites/flame_3.png'],
    // Lightning / Blue
    lightning: ['img/sprites/lightning_1.png', 'img/sprites/lightning_2.png', 'img/sprites/lightning_3.png'],
    blue: ['img/sprites/blue_lightning_big.png', 'img/sprites/teal_impact.png', 'img/sprites/blue_bolt_sm.png'],
    ice: ['img/sprites/ice_dome.png', 'img/sprites/ice_wave.png', 'img/sprites/ice_comet.png',
          'img/sprites/elem_6.png', 'img/sprites/elem_7.png'],
    water: ['img/sprites/water_burst.png', 'img/sprites/water_splash.png', 'img/sprites/water_fountain.png',
            'img/sprites/water_geyser.png', 'img/sprites/elem_5.png'],
    // Purple / Black
    purple: ['img/sprites/purple_orb.png', 'img/sprites/purple_eruption.png', 'img/sprites/purple_spiral.png'],
    purpleBolt: ['img/sprites/purple_pillar.png', 'img/sprites/purple_wisp.png', 'img/sprites/purple_lightning.png',
                 'img/sprites/fx_1.png'],
    death: ['img/sprites/death_4.png', 'img/sprites/death_2.png', 'img/sprites/dark_ghost.png'],
    // Green
    green: ['img/sprites/elem_12.png', 'img/sprites/elem_13.png', 'img/sprites/elem_14.png'],
    // Gold / White
    gold: ['img/sprites/fx_3.png', 'img/sprites/elem_8.png', 'img/sprites/elem_9.png'],
    // Multi
    impact: ['img/sprites/teal_impact.png', 'img/sprites/blue_bolt_sm.png', 'img/sprites/elem_11.png'],
    // === Attack VFX by element ===
    attackFire: [
      'img/sprites/attack_fire_swoosh.png', 'img/sprites/attack_pink_flame.png',
      'img/sprites/fire_dragon.png', 'img/sprites/fire_sharp.png',
      'img/sprites/fire_lava.png', 'img/sprites/elem_3.png',
    ],
    attackWater: [
      'img/sprites/attack_water_wave.png', 'img/sprites/attack_water_splash.png',
      'img/sprites/attack_water_jet.png', 'img/sprites/water_burst.png',
    ],
    attackIce: [
      'img/sprites/slash_ice_3.png', 'img/sprites/slash_ice_4.png',
      'img/sprites/slash_ice_5.png', 'img/sprites/ice_comet.png',
    ],
    attackDark: [
      'img/sprites/dark_explosion.png', 'img/sprites/dark_slash.png',
      'img/sprites/dark_burst.png', 'img/sprites/dark_vortex.png',
    ],
    attackGreen: [
      'img/sprites/attack_green_slash.png', 'img/sprites/elem_13.png', 'img/sprites/elem_15.png',
    ],
    attackLightning: [
      'img/sprites/attack_lightning_bolt.png', 'img/sprites/lightning_1.png',
      'img/sprites/lightning_2.png', 'img/sprites/blue_lightning_big.png',
    ],
    attackGold: [
      'img/sprites/attack_gold_ring.png', 'img/sprites/attack_crystal.png',
      'img/sprites/fx_3.png',
    ],
    attackBlood: [
      'img/sprites/blood_splat_1.png', 'img/sprites/blood_splat_2.png',
      'img/sprites/blood_splat_3.png', 'img/sprites/blood_splat_5.png',
      'img/sprites/blood_splat_6.png', 'img/sprites/blood_splat_7.png',
    ],
    slashIce: [
      'img/sprites/slash_ice_1.png', 'img/sprites/slash_ice_2.png', 'img/sprites/slash_ice_3.png',
      'img/sprites/slash_ice_4.png', 'img/sprites/slash_ice_5.png', 'img/sprites/slash_ice_6.png',
      'img/sprites/slash_ice_7.png', 'img/sprites/slash_ice_8.png', 'img/sprites/slash_ice_9.png',
      'img/sprites/slash_ice_10.png', 'img/sprites/slash_ice_11.png',
    ],
    attackRedClaw: ['img/sprites/attack_red_claw.png'],
  },

  _container: null,
  _preloaded: false,

  init() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.id = 'vfx-layer';
      document.body.appendChild(this._container);
    }
    // Preload sprites
    if (!this._preloaded) {
      this._preloaded = true;
      for (const arr of Object.values(this.SPRITES)) {
        for (const src of arr) {
          const img = new Image();
          img.src = src;
        }
      }
    }
  },

  _randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  // =================== Card Animations ===================

  animateCard(cardUid, animName, duration = 400) {
    const el = document.querySelector(`[data-uid="${cardUid}"]`);
    if (!el) return;
    el.classList.add(`anim-${animName}`);
    setTimeout(() => el.classList.remove(`anim-${animName}`), duration);
  },

  animateEl(selector, animName, duration = 400) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.add(`anim-${animName}`);
    setTimeout(() => el.classList.remove(`anim-${animName}`), duration);
  },

  // =================== VFX Overlays ===================

  // Show a CSS-only VFX effect
  showEffect(type, x, y, options = {}) {
    this.init();
    const fx = document.createElement('div');
    fx.className = `vfx-effect vfx-${type}`;
    fx.style.left = `${x}px`;
    fx.style.top = `${y}px`;
    if (options.size) {
      fx.style.width = `${options.size}px`;
      fx.style.height = `${options.size}px`;
    }
    this._container.appendChild(fx);
    const dur = options.duration || 600;
    setTimeout(() => fx.remove(), dur);
  },

  // Show a sprite-based VFX effect (transparent PNG with screen blend)
  showSprite(spriteUrl, x, y, options = {}) {
    this.init();
    const size = options.size || 100;
    const dur = options.duration || 600;
    const fx = document.createElement('div');
    fx.className = `vfx-sprite ${options.className || ''}`;
    fx.style.cssText = `
      left: ${x}px; top: ${y}px;
      width: ${size}px; height: ${size}px;
      background-image: url('${spriteUrl}');
      animation-duration: ${dur}ms;
    `;
    this._container.appendChild(fx);
    setTimeout(() => fx.remove(), dur + 50);
  },

  // Show sprite on a card element
  showSpriteOnCard(cardUid, spriteUrl, options = {}) {
    const el = document.querySelector(`[data-uid="${cardUid}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = options.size || Math.max(rect.width, rect.height) * 1.5;
    this.showSprite(spriteUrl, rect.left + rect.width / 2, rect.top + rect.height / 2, { size, ...options });
  },

  // Show sprite on a player info area
  showSpriteOnPlayer(playerId, spriteUrl, options = {}) {
    const selector = playerId === 0 ? '.my-info' : '.opp-info';
    const el = document.querySelector(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.showSprite(spriteUrl, rect.left + rect.width / 2, rect.top + rect.height / 2, options);
  },

  showOnCard(cardUid, type, options = {}) {
    const el = document.querySelector(`[data-uid="${cardUid}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    this.showEffect(type, x, y, { size: Math.max(rect.width, rect.height), ...options });
  },

  showOnPlayer(playerId, type, options = {}) {
    const selector = playerId === 0 ? '.my-info' : '.opp-info';
    const el = document.querySelector(selector);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    this.showEffect(type, rect.left + rect.width / 2, rect.top + rect.height / 2, options);
  },

  // =================== Pre-built VFX sequences ===================

  // Damage dealt to creature - fire burst
  damage(cardUid) {
    this.animateCard(cardUid, 'shake', 400);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.fire), {
      duration: 500, className: 'vfx-burst'
    });
  },

  // Creature dies - death skull + fade
  death(cardUid) {
    this.animateCard(cardUid, 'death', 700);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.death), {
      duration: 700, size: 140, className: 'vfx-death-skull'
    });
  },

  // Spell cast - lightning impact at center
  spellCast(cardName) {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    this.showSprite(this._randomFrom(this.SPRITES.lightning), x, y, {
      duration: 600, size: 160, className: 'vfx-cast'
    });
  },

  // Card drawn
  cardDraw(playerId) {
    const selector = playerId === 0 ? '.my-hand' : '.opp-info';
    this.animateEl(selector, 'draw-pulse', 300);
  },

  // Attack animation
  attack(cardUid) {
    this.animateCard(cardUid, 'attack-lunge', 350);
  },

  // Buff applied - green glow + sparkle
  buff(cardUid) {
    this.animateCard(cardUid, 'buff-glow', 500);
    this.showEffect('buff-sparkle', 0, 0, { duration: 500 });
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.green), {
      duration: 500, className: 'vfx-buff-sprite'
    });
  },

  // Heal / life gain - gold energy
  heal(playerId) {
    this.showOnPlayer(playerId, 'heal-glow', { duration: 500, size: 60 });
    this.showSpriteOnPlayer(playerId, this._randomFrom(this.SPRITES.gold), {
      duration: 600, size: 80, className: 'vfx-heal-sprite'
    });
  },

  // Counter added
  counterAdded(cardUid) {
    this.animateCard(cardUid, 'counter-pop', 400);
  },

  // Trigger fires - orange pulse
  triggerFire(cardUid) {
    this.animateCard(cardUid, 'trigger-pulse', 500);
  },

  // ETB effect - appear + impact
  enterBattlefield(cardUid) {
    this.animateCard(cardUid, 'etb-appear', 400);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.impact), {
      duration: 400, className: 'vfx-etb-sprite'
    });
  },

  // Phase transition flash
  phaseTransition() {
    const strip = document.querySelector('.phase-strip');
    if (strip) {
      strip.classList.add('anim-phase-flash');
      setTimeout(() => strip.classList.remove('anim-phase-flash'), 300);
    }
  },

  // Exile effect - purple vortex
  exile(cardUid) {
    this.animateCard(cardUid, 'exile-vanish', 500);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.purple), {
      duration: 500, className: 'vfx-exile-sprite'
    });
  },

  // Bounce to hand - water splash
  bounce(cardUid) {
    this.animateCard(cardUid, 'bounce-up', 400);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.blue), {
      duration: 400, className: 'vfx-bounce-sprite'
    });
  },

  // Destroy effect - purple bolt
  destroy(cardUid) {
    this.animateCard(cardUid, 'shake', 400);
    this.showSpriteOnCard(cardUid, this._randomFrom(this.SPRITES.purpleBolt), {
      duration: 500, className: 'vfx-destroy-sprite'
    });
  },

  // Counter spell - ice dome
  counterSpell(x, y) {
    this.showSprite(this._randomFrom(this.SPRITES.ice), x || window.innerWidth / 2, y || window.innerHeight / 2, {
      duration: 600, size: 140, className: 'vfx-counter-spell'
    });
  },

  // Ramp / search land - green portal
  ramp(playerId) {
    this.showSpriteOnPlayer(playerId, this._randomFrom(this.SPRITES.green), {
      duration: 600, size: 80, className: 'vfx-ramp-sprite'
    });
  },

  // Mill effect
  mill(playerId) {
    this.showSpriteOnPlayer(playerId, this._randomFrom(this.SPRITES.purpleBolt), {
      duration: 500, size: 70, className: 'vfx-mill-sprite'
    });
  },

  // Board wipe - big fire explosion
  boardWipe() {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    this.showSprite(this._randomFrom(this.SPRITES.fireball), x, y, {
      duration: 800, size: 300, className: 'vfx-board-wipe'
    });
  },

  // Player takes damage
  playerDamage(playerId) {
    const bar = playerId === 0 ? '.my-info' : '.opp-info';
    this.animateEl(bar, 'shake', 300);
    this.showSpriteOnPlayer(playerId, this._randomFrom(this.SPRITES.fire), {
      duration: 400, size: 60, className: 'vfx-player-hit'
    });
  },

  // =================== Element Detection ===================

  /**
   * Detect the visual element of a card based on colors, keywords, and oracle text.
   * Returns: 'fire', 'water', 'ice', 'dark', 'green', 'lightning', 'gold', 'blood'
   */
  getCardElement(card) {
    if (!card) return 'blood';
    const text = ((card.oracle_text || '') + ' ' + (card.name || '') + ' ' + (card.type_line || '')).toLowerCase();
    const colors = card.colors || card.color_identity || [];

    // Keyword/text-based detection (highest priority - matches card theme)
    if (/dragon|fire|burn|flame|blaze|inferno|lava|magma|scorch|ember|volcanic/.test(text)) return 'fire';
    if (/ice|frost|frozen|glacial|blizzard|cold|winter|snow/.test(text)) return 'ice';
    if (/water|ocean|sea|wave|flood|tide|rain|river|aqua/.test(text)) return 'water';
    if (/lightning|thunder|storm|bolt|shock|electric|spark/.test(text)) return 'lightning';
    if (/death|skull|zombie|skeleton|decay|rot|necrotic|wither|grave|undead|vampire|demon/.test(text)) return 'dark';
    if (/angel|holy|divine|radiant|celestial|light|sun|dawn|glory/.test(text)) return 'gold';
    if (/forest|nature|beast|wolf|bear|vine|root|tree|growth|wild/.test(text)) return 'green';
    if (/blood|gore|pain|wound|slash|claw|fang|predator|hunt/.test(text)) return 'blood';

    // Color-based fallback
    if (colors.includes('R')) return 'fire';
    if (colors.includes('U')) return Math.random() > 0.5 ? 'water' : 'ice';
    if (colors.includes('B')) return 'dark';
    if (colors.includes('G')) return 'green';
    if (colors.includes('W')) return 'gold';

    // Colorless/artifact creatures
    return 'blood';
  },

  // =================== Element-aware Attack VFX ===================

  /**
   * Show element-themed attack VFX on a target.
   * Used for combat damage: shows on the blocker or on the player being hit.
   */
  elementAttack(attackerUid, attackerCard, targetUid) {
    const element = this.getCardElement(attackerCard);
    this.animateCard(attackerUid, 'attack-lunge', 350);

    // Pick sprite set based on element
    const spriteMap = {
      fire: this.SPRITES.attackFire,
      water: this.SPRITES.attackWater,
      ice: this.SPRITES.attackIce,
      dark: this.SPRITES.attackDark,
      green: this.SPRITES.attackGreen,
      lightning: this.SPRITES.attackLightning,
      gold: this.SPRITES.attackGold,
      blood: this.SPRITES.attackBlood,
    };
    const sprites = spriteMap[element] || this.SPRITES.attackBlood;
    const sprite = this._randomFrom(sprites);

    // Show the attack effect on the target (blocker or self-area for unblocked)
    if (targetUid) {
      this.showSpriteOnCard(targetUid, sprite, {
        duration: 550, className: `vfx-attack-hit vfx-element-${element}`
      });
    }
  },

  /**
   * Show element-themed attack on player (unblocked damage).
   */
  elementAttackPlayer(attackerUid, attackerCard, playerId) {
    const element = this.getCardElement(attackerCard);
    this.animateCard(attackerUid, 'attack-lunge', 350);

    const spriteMap = {
      fire: this.SPRITES.attackFire,
      water: this.SPRITES.attackWater,
      ice: this.SPRITES.attackIce,
      dark: this.SPRITES.attackDark,
      green: this.SPRITES.attackGreen,
      lightning: this.SPRITES.attackLightning,
      gold: this.SPRITES.attackGold,
      blood: this.SPRITES.attackBlood,
    };
    const sprites = spriteMap[element] || this.SPRITES.attackBlood;
    const sprite = this._randomFrom(sprites);

    this.showSpriteOnPlayer(playerId, sprite, {
      duration: 500, size: 80, className: `vfx-attack-hit vfx-element-${element}`
    });
  },

  /**
   * Animated sprite-sheet slash effect (plays frames sequentially).
   * Used for ice claw slash or similar multi-frame attacks.
   */
  slashAnimation(cardUid, frames, options = {}) {
    const el = document.querySelector(`[data-uid="${cardUid}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const size = options.size || Math.max(rect.width, rect.height) * 1.8;
    const frameTime = options.frameTime || 60;

    this.init();
    const fx = document.createElement('div');
    fx.className = 'vfx-sprite vfx-slash-frame';
    fx.style.cssText = `
      left: ${cx}px; top: ${cy}px;
      width: ${size}px; height: ${size}px;
      background-image: url('${frames[0]}');
    `;
    this._container.appendChild(fx);

    let i = 0;
    const interval = setInterval(() => {
      i++;
      if (i >= frames.length) {
        clearInterval(interval);
        fx.style.opacity = '0';
        setTimeout(() => fx.remove(), 150);
        return;
      }
      fx.style.backgroundImage = `url('${frames[i]}')`;
    }, frameTime);
  }
};
