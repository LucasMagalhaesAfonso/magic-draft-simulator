// oracle-parser.ts — Converts MTG oracle text to CardEffectsDB-compatible JSON

export function parseOracleText(card: {
  name: string;
  oracle_text?: string;
  type_line?: string;
  keywords?: string[];
}): Record<string, any> | null {
  // Strip reminder text in parentheses
  const oracle = (card.oracle_text || '').replace(/\([^)]+\)/g, '').trim();
  const typeLine = (card.type_line || '').toLowerCase();
  const kws = (card.keywords || []).map((k: string) => k.toLowerCase());

  const isSpell = /instant|sorcery/.test(typeLine);
  const isLand  = typeLine.includes('land') && !typeLine.includes('creature');

  if (isLand) return null;

  const result: Record<string, any> = {};

  // ── Keywords from Scryfall data ────────────────────────────────────────────
  const supportedKws = [
    'flying', 'trample', 'deathtouch', 'lifelink', 'first strike', 'double strike',
    'vigilance', 'haste', 'menace', 'reach', 'hexproof', 'indestructible', 'prowess',
    'ward', 'flash', 'defender', 'protection', 'infect', 'wither', 'persist', 'undying',
    'exalted', 'convoke', 'delve', 'cascade', 'annihilator', 'bushido', 'shadow',
    'flanking', 'fading', 'vanishing', 'phasing', 'banding',
  ];
  const activeKws = kws.filter(k => supportedKws.some(s => k.includes(s)));
  if (activeKws.length > 0) {
    result.static = [{ type: 'has_keyword', keywords: activeKws }];
  }

  // ── Effect parser ──────────────────────────────────────────────────────────
  function parseEffects(text: string): any[] {
    const effects: any[] = [];
    const t = text.toLowerCase();

    // Damage patterns — ordered from most specific to most general
    const dmgAny     = t.match(/deals?\s+(\d+)\s+damage\s+to\s+any\s+target/);
    const dmgCreat   = t.match(/deals?\s+(\d+)\s+damage\s+to\s+target\s+(creature or planeswalker|creature|player or planeswalker)/);
    const dmgPlayers = t.match(/deals?\s+(\d+)\s+damage\s+to\s+(?:target\s+)?each\s+opponent/);
    const dmgPlayer  = t.match(/deals?\s+(\d+)\s+damage\s+to\s+(?:target\s+)?(?:a\s+)?player/);
    const dmgEach    = t.match(/deals?\s+(\d+)\s+damage\s+to\s+each\s+(?:creature|creature and player)/);
    const dmgSelf    = t.match(/deals?\s+(\d+)\s+damage\s+to\s+(?:you|its controller)/);

    if (dmgAny)          effects.push({ type: 'damage', amount: +dmgAny[1], target: 'any' });
    else if (dmgCreat)   effects.push({ type: 'damage', amount: +dmgCreat[1], target: dmgCreat[1].includes('player') ? 'any' : 'creature' });
    else if (dmgPlayers) effects.push({ type: 'damage_each_opponent', amount: +dmgPlayers[1] });
    else if (dmgPlayer)  effects.push({ type: 'damage', amount: +dmgPlayer[1], target: 'player' });
    else if (dmgEach)    effects.push({ type: 'damage_all_creatures', amount: +dmgEach[1] });
    else if (dmgSelf)    effects.push({ type: 'lose_life', amount: +dmgSelf[1], target: 'self' });

    if (t.match(/(?:this creature|it)\s+fights?\s+target\s+creature/)) {
      effects.push({ type: 'fight', target: 'creature' });
    }

    // Draw
    const drawN = t.match(/draw(?:s)?\s+(a\s+card|\d+\s+cards?)/);
    if (drawN) {
      const raw = drawN[1].trim();
      const n = raw === 'a card' ? 1 : parseInt(raw);
      effects.push({ type: 'draw', amount: isNaN(n) ? 1 : n });
    }

    // Scry / surveil
    const scryN    = t.match(/\bscry\s+(\d+)/);
    const surveilN = t.match(/\bsurveil\s+(\d+)/);
    if (scryN)    effects.push({ type: 'scry',    amount: +scryN[1] });
    if (surveilN) effects.push({ type: 'surveil', amount: +surveilN[1] });

    // Mill
    const millN = t.match(/(?:target player\s+)?mills?\s+(\d+)/);
    if (millN) effects.push({ type: 'mill', amount: +millN[1] });

    // Gain life
    const gainN = t.match(/(?:you\s+)?gain(?:s)?\s+(\d+)\s+life/);
    if (gainN) effects.push({ type: 'gain_life', amount: +gainN[1] });

    // Lose life
    const loseN = t.match(/(?:you\s+)?lose(?:s)?\s+(\d+)\s+life/);
    if (loseN && !gainN) effects.push({ type: 'lose_life', amount: +loseN[1], target: 'self' });

    // Drain (damage + gain life)
    const drainN = t.match(/deals?\s+(\d+)\s+damage.*you\s+gain\s+\1\s+life/);
    if (drainN) effects.push({ type: 'drain', amount: +drainN[1], target: 'any' });

    // Destroy
    const destroyTgt = t.match(/destroy\s+target\s+(artifact or enchantment|creature or planeswalker|nonland permanent|creature|artifact|enchantment|permanent)/);
    if (destroyTgt) {
      const targ = destroyTgt[1];
      const mapped =
        targ.includes('artifact') && targ.includes('enchantment') ? 'artifact_or_enchantment' :
        targ.includes('planeswalker') ? 'creature_or_planeswalker' :
        targ.includes('nonland') ? 'nonland_permanent' :
        targ.includes('artifact') ? 'artifact' :
        targ.includes('enchantment') ? 'enchantment' :
        targ.includes('permanent') ? 'permanent' : 'creature';
      effects.push({ type: 'destroy', target: mapped });
    }
    const destroyAll = t.match(/destroy\s+all\s+(creatures?|artifacts?|enchantments?|nonland permanents?)/);
    if (destroyAll) effects.push({ type: 'destroy_all', target: destroyAll[1].replace(/s$/, '') });

    // Exile
    const exileTgt = t.match(/exile\s+target\s+(card in a graveyard|creature or planeswalker|nonland permanent|creature|artifact|enchantment|permanent)/);
    if (exileTgt) {
      const targ = exileTgt[1].includes('graveyard') ? 'graveyard_card' : exileTgt[1];
      effects.push({ type: 'exile', target: targ });
    }
    const exileAll = t.match(/exile\s+all\s+(creatures?|graveyards?|permanents?)/);
    if (exileAll) effects.push({ type: 'exile_all', target: exileAll[1].replace(/s$/, '') });

    // Bounce
    const bounceM = t.match(/return\s+target\s+(nonland permanent|creature|permanent)\s+(?:card\s+)?to\s+(?:its\s+owner'?s?\s+)?hand/);
    if (bounceM) effects.push({ type: 'bounce', target: bounceM[1] });

    // Counter spell
    const counterM = t.match(/counter\s+target\s+(noncreature spell|creature spell|instant or sorcery spell|spell)/);
    if (counterM) effects.push({ type: 'counter_spell' });

    // +1/+1 counters on target creature
    const ctrPT = t.match(/put\s+(\w+|\d+)\s+\+1\/\+1\s+counters?\s+on\s+(target\s+creature|each creature you control|it|each creature)/);
    if (ctrPT) {
      const raw = ctrPT[1];
      const n = raw === 'a' || raw === 'an' ? 1 : parseInt(raw) || 1;
      const targ = ctrPT[2].includes('each') ? 'all_own_creatures' : 'creature';
      effects.push({ type: 'counter', counter: '+1/+1', amount: n, target: targ });
    }

    // Buff until end of turn
    const buffM = t.match(/gets?\s+\+(\d+)\/\+(\d+)\s+until\s+end\s+of\s+turn/);
    if (buffM) effects.push({ type: 'buff', power: +buffM[1], toughness: +buffM[2], target: 'creature', duration: 'end_of_turn' });

    // Buff all own creatures
    const buffAllM = t.match(/creatures?\s+you\s+control\s+(?:each\s+)?gets?\s+\+(\d+)\/\+(\d+)\s+until\s+end\s+of\s+turn/);
    if (buffAllM) effects.push({ type: 'buff', power: +buffAllM[1], toughness: +buffAllM[2], target: 'all_own_creatures', duration: 'end_of_turn' });

    // Create token
    const tokM = t.match(/creates?\s+(?:(\w+)\s+)?(\d+)\s+(\d+)\/(\d+)\s+([\w\s]+?)\s+(?:creature\s+)?tokens?/);
    if (tokM) {
      effects.push({ type: 'create_token', count: +tokM[2], power: +tokM[3], toughness: +tokM[4], name: tokM[5].trim() });
    }

    // Discard
    const discardM = t.match(/(?:each\s+(?:other\s+)?player\s+)?discards?\s+(\d+|a)\s+cards?/);
    if (discardM) {
      const n = discardM[1] === 'a' ? 1 : +discardM[1];
      const isAll = t.includes('each player') || t.includes('each other player');
      effects.push({ type: 'discard', target: isAll ? 'all' : 'opponent', amount: n });
    }

    // Loot (draw then discard — add loot after draw was already added)
    if (/draw\s+(?:a\s+card|\d+\s+cards?)[,.]\s+then\s+discard\s+(?:a\s+card|\d+\s+cards?)/.test(t)) {
      effects.push({ type: 'loot' });
    }

    // Ramp
    if (/search\s+your\s+library\s+for\s+(?:a\s+)?(?:basic\s+)?land\s+card/.test(t)) {
      effects.push({ type: 'ramp' });
    }

    // Grant keyword until end of turn
    const grantM = t.match(/(?:has|gains?)\s+(lifelink|deathtouch|flying|trample|haste|first strike|double strike|indestructible|hexproof|vigilance|menace|reach)\s+until\s+end\s+of\s+turn/);
    if (grantM) effects.push({ type: 'grant', keywords: [grantM[1]], target: 'creature', duration: 'end_of_turn' });

    // Tap target creature
    if (/tap\s+target\s+creature/.test(t)) effects.push({ type: 'tap', target: 'creature' });

    // Untap target creature
    if (/untap\s+target\s+creature/.test(t)) effects.push({ type: 'untap', target: 'creature' });

    // Untap all creatures
    if (/untap\s+all\s+creatures/.test(t)) effects.push({ type: 'untap_all', target: 'own_creatures' });

    // X damage spells
    const dmgX = t.match(/deals?\s+x\s+damage\s+to\s+(any\s+target|target\s+creature|each\s+(?:creature|opponent))/);
    if (dmgX) effects.push({ type: 'damage', amount: 'X', target: dmgX[1].includes('each opponent') ? 'player' : dmgX[1].includes('creature') ? 'creature' : 'any' });

    // Modal spells — mark so they don't land in "complex" solely for lacking effects
    if (/choose\s+one\b|choose\s+two\b|choose\s+one\s+or\s+both/.test(t)) {
      if (!effects.some(e => e.type === 'modal')) {
        effects.push({ type: 'modal', modes: [] });
      }
    }

    // Damage equal to power
    if (/deals?\s+damage\s+equal\s+to\s+its\s+power/.test(t)) effects.push({ type: 'power_damage', target: 'any' });

    // Each player draws a card
    if (/each\s+player\s+draws\s+a\s+card/.test(t)) {
      if (!effects.some(e => e.type === 'draw')) effects.push({ type: 'draw', amount: 1 });
    }

    // Gains a +1/+1 counter (self)
    if (/gets?\s+a\s+\+1\/\+1\s+counter/.test(t)) {
      if (!effects.some(e => e.type === 'counter')) effects.push({ type: 'counter', counter: '+1/+1', amount: 1, target: 'self' });
    }

    // Add mana (activated ability pattern covered in activated section; handle simple oracle text too)
    const addManaM = t.match(/add\s+(\{[wubrgc]\}|\{[wubrgc]\/[wubrgc]\}|one\s+mana\s+of\s+any\s+color|one\s+mana\s+of\s+any\s+one\s+color)/);
    if (addManaM) {
      const raw = addManaM[1];
      const color = raw.includes('any') ? 'any'
        : raw.includes('w') ? 'W' : raw.includes('u') ? 'U' : raw.includes('b') ? 'B'
        : raw.includes('r') ? 'R' : raw.includes('g') ? 'G' : 'any';
      if (!effects.some(e => e.type === 'add_mana')) effects.push({ type: 'add_mana', color, amount: 1 });
    }

    return effects;
  }

  // ── Split oracle text into logical lines and classify ──────────────────────
  const lines = oracle.split(/\n/).filter(l => l.trim().length > 0);
  const nameLower = card.name.toLowerCase();

  if (isSpell) {
    const effects = parseEffects(oracle);
    if (effects.length > 0) result.cast = effects;
  } else {
    const etbTexts: string[] = [];
    const triggeredEntries: any[] = [];
    const activatedEntries: any[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();

      // ETB trigger: "When/Whenever X enters [the battlefield]"
      if (
        /when(?:ever)?\s+[\w\s,']+\s+enters(?:\s+the\s+battlefield)?/.test(lower) &&
        (lower.includes(nameLower) || lower.includes('this creature') ||
         lower.includes('this permanent') || lower.includes('it enters'))
      ) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        etbTexts.push(effectText);
        continue;
      }

      // Attack trigger
      if (/whenever\s+[\w\s,']+\s+attacks/.test(lower)) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        const effects = parseEffects(effectText);
        if (effects.length > 0) triggeredEntries.push({ event: 'attacks', self: true, effects });
        continue;
      }

      // Death trigger
      if (/when\s+[\w\s,']+\s+dies/.test(lower)) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        const effects = parseEffects(effectText);
        if (effects.length > 0) triggeredEntries.push({ event: 'dies', self: true, effects });
        continue;
      }

      // Upkeep trigger
      if (/at\s+the\s+beginning\s+of\s+your\s+upkeep/.test(lower)) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        const effects = parseEffects(effectText);
        if (effects.length > 0) triggeredEntries.push({ event: 'upkeep', effects });
        continue;
      }

      // End of turn trigger
      if (/at\s+the\s+beginning\s+of\s+(?:your\s+)?end\s+step/.test(lower)) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        const effects = parseEffects(effectText);
        if (effects.length > 0) triggeredEntries.push({ event: 'end_step', effects });
        continue;
      }

      // Damage trigger: "Whenever ~ deals combat damage to a player"
      if (/whenever\s+[\w\s,']+\s+deals\s+combat\s+damage\s+to\s+a\s+player/.test(lower)) {
        const parts = line.split(/,\s+/);
        const effectText = parts.length > 1 ? parts.slice(1).join(', ') : line;
        const effects = parseEffects(effectText);
        if (effects.length > 0) triggeredEntries.push({ event: 'combat_damage_player', self: true, effects });
        continue;
      }

      // Activated ability: "{cost}: effect"  or  "{T}: effect"
      const activatedM = line.match(/^(\{[^}]+\}(?:[,;]\s*\{[^}]+\})*(?:[,;]\s*tap)?)\s*:\s*(.+)$/i);
      if (activatedM) {
        const effects = parseEffects(activatedM[2]);
        if (effects.length > 0) activatedEntries.push({ cost: activatedM[1], effects });
        continue;
      }
    }

    if (etbTexts.length > 0) {
      const etbEffects = parseEffects(etbTexts.join(' '));
      if (etbEffects.length > 0) result.etb = etbEffects;
    }
    if (triggeredEntries.length > 0) result.triggered = triggeredEntries;
    if (activatedEntries.length > 0) result.activated = activatedEntries;
  }

  return Object.keys(result).length > 0 ? result : null;
}
