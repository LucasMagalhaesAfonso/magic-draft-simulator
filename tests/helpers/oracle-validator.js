/**
 * Oracle Text Validation Rules
 * Maps oracle text patterns to expected CardEffectsDB entries.
 * Used by Layer D tests to verify DB completeness.
 */

const ORACLE_RULES = [
  // === Damage ===
  { pattern: /deals? (\d+|X) damage/i, expectEffect: 'damage', label: 'damage' },
  { pattern: /deals? damage equal to/i, expectEffect: 'damage', label: 'damage-equal' },

  // === Destroy/Remove ===
  { pattern: /destroy target(?! player)/i, expectEffect: 'destroy', label: 'destroy-target' },
  { pattern: /destroy all/i, expectEffect: 'destroy_all', label: 'destroy-all' },
  { pattern: /exile target/i, expectEffect: 'exile', label: 'exile-target' },
  { pattern: /exile all/i, expectEffect: 'exile_all', label: 'exile-all' },
  { pattern: /return target .* to .* (owner's |its owner's )?hand/i, expectEffect: 'bounce', label: 'bounce' },

  // === Draw/Card Advantage ===
  { pattern: /draw (\w+) cards?/i, expectEffect: 'draw', label: 'draw' },
  { pattern: /scry (\d+)/i, expectEffect: 'scry', label: 'scry' },
  { pattern: /surveil (\d+)/i, expectEffect: 'surveil', label: 'surveil' },
  { pattern: /mills? (\d+|\w+)/i, expectEffect: 'mill', label: 'mill' },

  // === Life ===
  { pattern: /gains? (\d+|\w+) life/i, expectEffect: 'gainLife', label: 'gain-life' },
  { pattern: /loses? (\d+|\w+) life/i, expectEffect: 'loseLife', label: 'lose-life' },

  // === Counters ===
  { pattern: /put .*\+1\/\+1 counter.* on (?:it|target|~|a creature you)/i, expectEffect: 'counter_self', label: '+1/+1 counter' },
  { pattern: /put .*-1\/-1 counter/i, expectEffect: 'blight', label: '-1/-1 counter' },
  { pattern: /stun counter/i, expectEffect: 'stun', label: 'stun counter' },

  // === Tokens ===
  { pattern: /creates? .*\d+.*\d+\/\d+.*token/i, expectEffect: 'create_token', label: 'create-token' },

  // === Ramp ===
  { pattern: /search your library for a.*land/i, expectEffect: 'ramp', label: 'ramp' },

  // === Buff ===
  { pattern: /gets? [+-]\d+\/[+-]\d+ until end of turn/i, expectEffect: 'buff', label: 'buff' },
  { pattern: /creatures? you control get [+-]\d+\/[+-]\d+/i, expectEffect: 'buff_all', label: 'buff-all' },

  // === Fight ===
  { pattern: /fights? target/i, expectEffect: 'fight', label: 'fight' },

  // === Tap ===
  { pattern: /tap target (creature|permanent)/i, expectEffect: 'tap', label: 'tap' },
  { pattern: /untap target/i, expectEffect: 'untap', label: 'untap' },

  // === Discard ===
  { pattern: /discards? (\w+) cards?/i, expectEffect: 'discard', label: 'discard' },

  // === ETB Zone ===
  { pattern: /when (~|this creature|it|this|[A-Z][a-z]+) enters/i, expectZone: 'etb', label: 'ETB trigger' },

  // === Triggered Ability Zones ===
  { pattern: /whenever (~|this creature|it|[A-Z][a-z]+) attacks/i, expectZone: 'triggered', expectEvent: 'attacks', label: 'attacks trigger' },
  { pattern: /whenever (~|this creature|it|[A-Z][a-z]+) deals combat damage to a player/i, expectZone: 'triggered', expectEvent: 'combat_damage_player', label: 'combat damage trigger' },
  { pattern: /whenever (~|this creature|a creature you control) dies/i, expectZone: 'triggered', expectEvent: 'dies', label: 'dies trigger' },
  { pattern: /whenever another creature( you control)? dies/i, expectZone: 'triggered', expectEvent: 'any_creature_dies', label: 'other dies trigger' },
  { pattern: /at the beginning of (your )?upkeep/i, expectZone: 'triggered', expectEvent: 'upkeep', label: 'upkeep trigger' },
  { pattern: /at the beginning of combat/i, expectZone: 'triggered', expectEvent: 'combat_begin', label: 'combat begin trigger' },
  { pattern: /whenever you gain life/i, expectZone: 'triggered', expectEvent: 'gain_life', label: 'gain life trigger' },
  { pattern: /at the beginning of (your )?end step/i, expectZone: 'triggered', expectEvent: 'end_step', label: 'end step trigger' },
  { pattern: /whenever .* becomes tapped/i, expectZone: 'triggered', expectEvent: 'becomes_tapped', label: 'becomes tapped trigger' },

  // === Activated Abilities ===
  { pattern: /\{[WUBRG0-9C]+\}.*,?\s*\{T\}\s*:/i, expectZone: 'activated', label: 'activated (mana+tap)' },
  { pattern: /\{T\}\s*:/i, expectZone: 'activated', label: 'activated (tap only)' },

  // === Special Mechanics ===
  { pattern: /\bmobilize\b/i, expectZone: 'triggered', label: 'mobilize' },
  { pattern: /\brendure\b/i, expectEffect: 'endure', label: 'endure' },
  { pattern: /\bevoke\b/i, expectMechanic: 'evoke', label: 'evoke' },
  { pattern: /\bchampion an?\b/i, expectMechanic: 'champion', label: 'champion' },
  { pattern: /\bconvoke\b/i, expectMechanic: 'convoke', label: 'convoke' },
  { pattern: /\brenew\b/i, expectZone: 'graveyard', label: 'renew' },
  { pattern: /\bhideaway\b/i, expectMechanic: 'hideaway', label: 'hideaway' },
  { pattern: /\bclash\b/i, expectEffect: 'clash', label: 'clash' },
  { pattern: /\btransform\b/i, expectMechanic: 'transform', label: 'transform' },
  { pattern: /choose one|choose two/i, expectZone: 'modal', label: 'modal' },
];

/**
 * Flatten all effects from all zones of a DB entry into a single array.
 */
function flattenEffects(dbEffects) {
  const all = [];
  if (!dbEffects) return all;

  const zones = ['cast', 'etb', 'static'];
  for (const zone of zones) {
    if (Array.isArray(dbEffects[zone])) {
      all.push(...dbEffects[zone]);
    }
  }

  // Triggered abilities
  if (Array.isArray(dbEffects.triggered)) {
    for (const trigger of dbEffects.triggered) {
      if (trigger.effects) all.push(...trigger.effects);
    }
  } else if (dbEffects.triggered && dbEffects.triggered.effects) {
    all.push(...dbEffects.triggered.effects);
  }

  // Activated abilities
  if (Array.isArray(dbEffects.activated)) {
    for (const ability of dbEffects.activated) {
      if (ability.effects) all.push(...ability.effects);
    }
  }

  // Modal
  if (dbEffects.modal && dbEffects.modal.modes) {
    for (const mode of dbEffects.modal.modes) {
      if (mode.effects) all.push(...mode.effects);
    }
  }

  // Saga chapters
  if (dbEffects.chapters) {
    for (const ch of Object.values(dbEffects.chapters)) {
      if (Array.isArray(ch)) all.push(...ch);
    }
  }

  // Graveyard
  if (dbEffects.graveyard && dbEffects.graveyard.effects) {
    all.push(...dbEffects.graveyard.effects);
  }
  if (Array.isArray(dbEffects.graveyard)) {
    for (const g of dbEffects.graveyard) {
      if (g.effects) all.push(...g.effects);
    }
  }

  return all;
}

/**
 * Validate a card's oracle text against its CardEffectsDB entry.
 * Returns array of warnings (empty = all good).
 */
function validateCard(cardName, oracleText, dbEffects, keywords = []) {
  const warnings = [];
  if (!oracleText) return warnings;

  // Normalize - remove reminder text
  const text = oracleText.replace(/\([^)]*\)/g, '').trim();

  for (const rule of ORACLE_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    // Skip keyword checks if the keyword is already in the card's keywords array
    if (rule.expectMechanic) {
      // Mechanics like evoke, champion are handled by card engine parsers, not DB
      // Only warn if the card has NO DB entry at all
      if (!dbEffects) {
        warnings.push({
          card: cardName,
          rule: rule.label,
          expected: rule.expectMechanic,
          status: 'NO_DB_ENTRY'
        });
      }
      continue;
    }

    // Check expected effect type
    if (rule.expectEffect) {
      const allEffects = flattenEffects(dbEffects);
      const hasEffect = allEffects.some(e => {
        if (e.type === rule.expectEffect) return true;
        // Allow some aliases
        if (rule.expectEffect === 'gainLife' && e.type === 'gain_life') return true;
        if (rule.expectEffect === 'loseLife' && e.type === 'lose_life') return true;
        if (rule.expectEffect === 'blight' && (e.type === 'blight' || e.type === 'blight_opponent')) return true;
        if (rule.expectEffect === 'stun' && e.type === 'stun_counter') return true;
        if (rule.expectEffect === 'buff' && (e.type === 'buff' || e.type === 'buff_self' || e.type === 'temp_buff')) return true;
        if (rule.expectEffect === 'buff_all' && (e.type === 'buff_all' || e.type === 'buff')) return true;
        if (rule.expectEffect === 'endure' && e.type === 'endure') return true;
        return false;
      });

      if (!hasEffect) {
        warnings.push({
          card: cardName,
          rule: rule.label,
          expected: `effect:${rule.expectEffect}`,
          status: 'MISSING_EFFECT'
        });
      }
    }

    // Check expected zone
    if (rule.expectZone) {
      const hasZone = dbEffects && (
        (rule.expectZone === 'etb' && dbEffects.etb) ||
        (rule.expectZone === 'triggered' && dbEffects.triggered) ||
        (rule.expectZone === 'activated' && dbEffects.activated) ||
        (rule.expectZone === 'graveyard' && dbEffects.graveyard) ||
        (rule.expectZone === 'modal' && dbEffects.modal)
      );

      if (!hasZone) {
        warnings.push({
          card: cardName,
          rule: rule.label,
          expected: `zone:${rule.expectZone}`,
          status: 'MISSING_ZONE'
        });
      }
    }
  }

  return warnings;
}

module.exports = { ORACLE_RULES, flattenEffects, validateCard };
