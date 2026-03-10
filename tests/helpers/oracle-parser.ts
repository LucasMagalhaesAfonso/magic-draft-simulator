// Oracle Parser — Reads oracle text and produces structured TestDescriptor[]
// Each descriptor describes one testable behavior of a card

export interface TestDescriptor {
  /** Human-readable test name */
  name: string;
  /** Test category */
  category: 'keyword' | 'etb' | 'cast' | 'triggered' | 'activated' | 'static' | 'equip' | 'token' | 'counter';
  /** What to assert */
  assertion: AssertionSpec;
  /** Additional context for code generation */
  context?: Record<string, any>;
}

export interface AssertionSpec {
  type: string;
  [key: string]: any;
}

const KEYWORDS = [
  'Flying', 'Trample', 'Haste', 'Vigilance', 'Reach', 'Deathtouch',
  'First Strike', 'Double Strike', 'Lifelink', 'Menace', 'Flash',
  'Hexproof', 'Indestructible', 'Defender', 'Ward', 'Prowess',
  'Convoke', 'Changeling', 'Shroud', 'Protection', 'Intimidate',
];

export function parseOracleText(
  cardName: string,
  oracleText: string,
  typeLine: string,
  keywords: string[] = [],
  power?: string,
  toughness?: string,
  manaCost?: string,
): TestDescriptor[] {
  const descs: TestDescriptor[] = [];
  if (!oracleText && keywords.length === 0) return descs;

  const isCreature = typeLine.includes('Creature');
  const isEquipment = typeLine.includes('Equipment');
  const isInstant = typeLine.includes('Instant');
  const isSorcery = typeLine.includes('Sorcery');
  const isEnchantment = typeLine.includes('Enchantment');
  const isArtifact = typeLine.includes('Artifact');
  const isLand = typeLine.includes('Land');
  const isSaga = typeLine.includes('Saga');

  // Normalize card name references in oracle text
  const normalized = oracleText.replace(new RegExp(escapeRegex(cardName), 'gi'), '~');

  // ─── Keywords ───
  for (const kw of keywords) {
    if (KEYWORDS.some(k => k.toLowerCase() === kw.toLowerCase())) {
      descs.push({
        name: `has ${kw}`,
        category: 'keyword',
        assertion: { type: 'has_keyword', keyword: kw },
      });
    }
  }

  // Detect keywords from oracle text first line
  const firstLine = oracleText.split('\n')[0];
  for (const kw of KEYWORDS) {
    if (firstLine.startsWith(kw) && !keywords.some(k => k.toLowerCase() === kw.toLowerCase())) {
      descs.push({
        name: `has ${kw} (from text)`,
        category: 'keyword',
        assertion: { type: 'has_keyword', keyword: kw },
      });
    }
  }

  // ─── Equipment buff ───
  const equipBuff = oracleText.match(/[Ee]quipped creature gets? \+(\d+)\/\+(\d+)/);
  if (equipBuff) {
    descs.push({
      name: `gives +${equipBuff[1]}/+${equipBuff[2]} to equipped creature`,
      category: 'equip',
      assertion: { type: 'equip_buff', power: +equipBuff[1], toughness: +equipBuff[2] },
    });
  }

  // ─── Equip cost ───
  const equipCost = oracleText.match(/[Ee]quip (?:(?:—|—)\s*)?\{(\d+)\}/);
  if (equipCost) {
    descs.push({
      name: `equip cost is {${equipCost[1]}}`,
      category: 'equip',
      assertion: { type: 'equip_cost', cost: +equipCost[1] },
    });
  }

  // ─── Equip discount ───
  const equipDiscount = oracleText.match(/[Ee]quip (\w+) \{(\d+)\}/);
  if (equipDiscount && equipCost) {
    descs.push({
      name: `equip ${equipDiscount[1]} for {${equipDiscount[2]}}`,
      category: 'equip',
      assertion: { type: 'equip_type_cost', creatureType: equipDiscount[1], cost: +equipDiscount[2] },
    });
  }

  // ─── ETB draw ───
  const etbDraw = oracleText.match(/(?:enters|enters the battlefield).*?draw (\w+) cards?/i);
  if (etbDraw) {
    const n = wordToNum(etbDraw[1]);
    if (n) descs.push({
      name: `ETB draws ${n} card${n > 1 ? 's' : ''}`,
      category: 'etb',
      assertion: { type: 'etb_draw', amount: n },
    });
  }

  // ─── ETB damage ───
  const etbDmg = oracleText.match(/(?:enters|enters the battlefield).*?deals? (\d+) damage/i);
  if (etbDmg) {
    descs.push({
      name: `ETB deals ${etbDmg[1]} damage`,
      category: 'etb',
      assertion: { type: 'etb_damage', amount: +etbDmg[1] },
    });
  }

  // ─── ETB create token ───
  const etbToken = oracleText.match(/(?:enters|enters the battlefield).*?[Cc]reate.*?(\d+)\/(\d+)/);
  if (etbToken) {
    descs.push({
      name: `ETB creates ${etbToken[1]}/${etbToken[2]} token`,
      category: 'etb',
      assertion: { type: 'etb_token', power: +etbToken[1], toughness: +etbToken[2] },
    });
  }

  // ─── Destroy target (spell or any ability) ───
  const destroyTarget = oracleText.match(/[Dd]estroy target (creature|permanent|artifact|enchantment|planeswalker|nonland permanent)/);
  if (destroyTarget) {
    descs.push({
      name: `destroys target ${destroyTarget[1]}`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'destroy_target', targetType: destroyTarget[1] },
    });
  }

  // ─── Exile target ───
  // Exclude graveyard exile: "exile target X card from a graveyard" or "exile target enchantment, ... from an opponent's graveyard"
  const hasGraveyardExile = /exile target .+? from (?:a |an |your |an opponent's )?graveyard/i.test(oracleText);
  const exileTarget = !hasGraveyardExile ? oracleText.match(/[Ee]xile target (creature|permanent|artifact|enchantment|nonland permanent|artifact or creature)(?! card)/) : null;
  if (exileTarget) {
    descs.push({
      name: `exiles target ${exileTarget[1]}`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'exile_target', targetType: exileTarget[1] },
    });
  }

  // ─── Damage spell ───
  const dmgSpell = oracleText.match(/deals? (\d+) damage to (?:target |any target|any )?(creature|player|opponent|planeswalker|creature or player|any target|each opponent)?/i);
  if (dmgSpell && (isInstant || isSorcery) && !etbDmg) {
    descs.push({
      name: `deals ${dmgSpell[1]} damage`,
      category: 'cast',
      assertion: { type: 'damage_spell', amount: +dmgSpell[1], target: dmgSpell[2] || 'any' },
    });
  }

  // ─── Damage to each opponent (triggered/activated) ───
  const dmgEachOpp = oracleText.match(/deals? (\d+) damage to each opponent/i);
  if (dmgEachOpp && !isInstant && !isSorcery) {
    descs.push({
      name: `deals ${dmgEachOpp[1]} damage to each opponent`,
      category: 'triggered',
      assertion: { type: 'damage_each_opponent', amount: +dmgEachOpp[1] },
    });
  }

  // ─── Create token (general) ───
  const createToken = oracleText.match(/[Cc]reate (?:a |an |two |three |(\w+) )?(?:tapped )?(?:and attacking )?(\d+)\/(\d+)\s+(\w+)\s+(\w+)\s+creature tokens?/);
  if (createToken && !etbToken) {
    const qty = createToken[1] ? wordToNum(createToken[1]) || 1 : 1;
    descs.push({
      name: `creates ${qty > 1 ? qty + ' ' : ''}${createToken[4]} ${createToken[2]}/${createToken[3]} token${qty > 1 ? 's' : ''}`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'create_token', power: +createToken[2], toughness: +createToken[3], quantity: qty },
    });
  }

  // ─── Create Treasure token ───
  if (/[Cc]reate a Treasure token/i.test(oracleText)) {
    descs.push({
      name: `creates Treasure token`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'db_json_contains', field: 'create_token', search: 'treasure' },
    });
  }

  // ─── Create Food token ───
  if (/[Cc]reate a Food token/i.test(oracleText)) {
    descs.push({
      name: `creates Food token`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'db_json_contains', field: 'create_token', search: 'food' },
    });
  }

  // ─── When attacks ───
  if (/[Ww]henever (?:this creature|equipped creature|~|(?:a|another) creature you control|.+? you control) attacks?/i.test(normalized)) {
    descs.push({
      name: `has attacks trigger`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'attacks' },
    });
  }

  // ─── When becomes blocked ───
  if (/[Ww]henever .+? becomes? blocked/i.test(normalized)) {
    descs.push({
      name: `has becomes blocked trigger`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'becomes_blocked' },
    });
  }

  // ─── When deals combat damage to player ───
  if (/[Ww]henever .+? deals combat damage to a player/i.test(normalized)) {
    descs.push({
      name: `has combat damage trigger`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'combat_damage_player' },
    });
  }

  // ─── When dies (only for creatures) ───
  if (isCreature) {
    const hasGrantedDies = /gains? "[Ww]hen this creature dies/i.test(oracleText);
    if (!hasGrantedDies) {
      if (/[Ww]hen(?:ever)? (?:this creature|~) dies/i.test(normalized)) {
        descs.push({
          name: `has dies trigger`,
          category: 'triggered',
          assertion: { type: 'has_trigger', event: 'dies' },
        });
      } else if (/[Ww]hen(?:ever)? (?:a|another|one or more) creatures? (?:you control |your opponents control )?dies?/i.test(normalized)) {
        descs.push({
          name: `has creature dies trigger`,
          category: 'triggered',
          assertion: { type: 'has_trigger', event: 'other_creature_dies' },
        });
      }
    }
  }

  // ─── When creature/permanent enters ───
  if (/[Ww]hen(?:ever)? (?:~|.*?) (?:or another|another) (?:\w+ )?(?:creature|permanent|Human|Treefolk|Halfling) (?:you control )?enters/i.test(normalized)) {
    descs.push({
      name: `has enters trigger`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'enters_battlefield' },
    });
  }

  // ─── Whenever you cast [type] spell ───
  const castTrigger = oracleText.match(/[Ww]henever you cast (?:a |an )?(instant or sorcery|instant|sorcery|historic|legendary|creature|noncreature) spell/i);
  if (castTrigger) {
    descs.push({
      name: `triggers on casting ${castTrigger[1]} spell`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'cast_spell' },
    });
  }

  // ─── Whenever you scry ───
  if (/[Ww]henever you scry/i.test(oracleText)) {
    descs.push({
      name: `triggers on scry`,
      category: 'triggered',
      assertion: { type: 'todo' },
    });
  }

  // ─── At the beginning of [phase] ───
  const beginPhase = oracleText.match(/[Aa]t the beginning of (?:your |each )?(upkeep|end step|combat|draw step|precombat main phase)/i);
  if (beginPhase) {
    descs.push({
      name: `has ${beginPhase[1]} trigger`,
      category: 'triggered',
      assertion: { type: 'has_phase_trigger', phase: beginPhase[1].toLowerCase() },
    });
  }

  // ─── Landfall ───
  if (/[Ll]andfall/i.test(oracleText) || /[Ww]henever a land (?:you control )?enters/i.test(oracleText)) {
    descs.push({
      name: `has landfall trigger`,
      category: 'triggered',
      assertion: { type: 'has_trigger', event: 'landfall' },
    });
  }

  // ─── The Ring tempts you ───
  if (/[Tt]he [Rr]ing tempts you/i.test(oracleText)) {
    descs.push({
      name: `the Ring tempts you`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'db_json_contains', field: 'ring_tempts', search: 'ring' },
    });
  }

  // ─── Amass ───
  const amass = oracleText.match(/[Aa]mass (?:Orcs? )?(\w+)/i);
  if (amass) {
    const n = wordToNum(amass[1]);
    descs.push({
      name: `amass ${n || amass[1]}`,
      category: isSaga ? 'activated' : (isInstant || isSorcery ? 'cast' : 'triggered'),
      assertion: { type: 'db_json_contains', field: 'amass', search: 'amass' },
    });
  }

  // ─── +1/+1 counters ───
  if (/\+1\/\+1 counter/i.test(oracleText)) {
    descs.push({
      name: `involves +1/+1 counters`,
      category: 'counter',
      assertion: { type: 'uses_counters', counterType: '+1/+1' },
    });
  }

  // ─── Lord/anthem ───
  const anthem = oracleText.match(/(?:other )?(?:\w+ )?creatures you control (?:get|have) \+(\d+)\/\+(\d+)/i);
  if (anthem) {
    descs.push({
      name: `anthem +${anthem[1]}/+${anthem[2]}`,
      category: 'static',
      assertion: { type: 'anthem', power: +anthem[1], toughness: +anthem[2] },
    });
  }

  // ─── Type-specific static keyword grants ───
  const typeKeywordGrant = oracleText.match(/(\w+) you control have (\w[\w\s]*?)(?:\.|$)/im);
  if (typeKeywordGrant) {
    const kw = typeKeywordGrant[2].trim();
    if (KEYWORDS.some(k => k.toLowerCase() === kw.toLowerCase())) {
      descs.push({
        name: `grants ${kw} to ${typeKeywordGrant[1]}`,
        category: 'static',
        assertion: { type: 'todo' },
      });
    }
  }

  // ─── Scry ───
  const scry = oracleText.match(/[Ss]cry (\d+)/);
  if (scry) {
    descs.push({
      name: `scry ${scry[1]}`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'scry', amount: +scry[1] },
    });
  }

  // ─── Surveil ───
  const surveil = oracleText.match(/[Ss]urveil (\d+)/);
  if (surveil) {
    descs.push({
      name: `surveil ${surveil[1]}`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'surveil', amount: +surveil[1] },
    });
  }

  // ─── Draw cards (non-ETB) ───
  if (!etbDraw) {
    const drawMatch = oracleText.match(/[Dd]raw (\w+) cards?/);
    if (drawMatch) {
      const n = wordToNum(drawMatch[1]);
      if (n) descs.push({
        name: `draws ${n} card${n > 1 ? 's' : ''}`,
        category: isInstant || isSorcery ? 'cast' : 'triggered',
        assertion: { type: 'draw', amount: n },
      });
    }
  }

  // ─── Draw a card (single) ───
  if (!etbDraw && /[Dd]raw a card/i.test(oracleText) && !oracleText.match(/draw \w+ cards/i)) {
    descs.push({
      name: `draws a card`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'draw', amount: 1 },
    });
  }

  // ─── Discard ───
  const discard = oracleText.match(/discard (\w+) cards?/i);
  if (discard) {
    const n = wordToNum(discard[1]);
    if (n) descs.push({
      name: `discard ${n} card${n > 1 ? 's' : ''}`,
      category: isInstant || isSorcery ? 'cast' : 'triggered',
      assertion: { type: 'db_json_contains', field: 'discard', search: 'discard' },
    });
  }

  // ─── Loot (draw then discard) ───
  if (/[Dd]raw a card, then discard a card/i.test(oracleText)) {
    descs.push({
      name: `loots (draw then discard)`,
      category: 'activated',
      assertion: { type: 'db_json_contains', field: 'loot', search: 'loot' },
    });
  }

  // ─── Gain life ───
  const gainLife = oracleText.match(/[Gg]ain (\d+) life/);
  if (gainLife) {
    descs.push({
      name: `gains ${gainLife[1]} life`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'gain_life', amount: +gainLife[1] },
    });
  }

  // ─── Lose life / damage to opponent ───
  const loseLife = oracleText.match(/(?:opponent|each opponent|target player) loses? (\d+) life/i);
  if (loseLife) {
    descs.push({
      name: `opponent loses ${loseLife[1]} life`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'lose_life', amount: +loseLife[1] },
    });
  }

  // ─── Buff + keyword grant combo ───
  const buffAndGrant = oracleText.match(/gets? \+(\d+)\/\+(\d+) and gains? (\w[\w\s]*?) until/i);
  if (buffAndGrant && (isInstant || isSorcery)) {
    descs.push({
      name: `gives +${buffAndGrant[1]}/+${buffAndGrant[2]} and ${buffAndGrant[3].trim()}`,
      category: 'cast',
      assertion: { type: 'buff', power: +buffAndGrant[1], toughness: +buffAndGrant[2] },
    });
  }

  // ─── Buff spell (simple) ───
  if (!buffAndGrant) {
    const buffSpell = oracleText.match(/(?:target|each) creature (?:you control )?gets? \+(\d+)\/\+(\d+)/);
    if (buffSpell && (isInstant || isSorcery)) {
      descs.push({
        name: `gives +${buffSpell[1]}/+${buffSpell[2]}`,
        category: 'cast',
        assertion: { type: 'buff', power: +buffSpell[1], toughness: +buffSpell[2] },
      });
    }
  }

  // ─── Base power/toughness change ───
  const basePT = oracleText.match(/has base power and toughness (\d+)\/(\d+)/i);
  if (basePT) {
    descs.push({
      name: `sets base P/T to ${basePT[1]}/${basePT[2]}`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'db_json_contains', field: 'base_pt', search: 'base' },
    });
  }

  // ─── Mill ───
  const mill = oracleText.match(/[Mm]ill (\w+)/i);
  if (mill) {
    const n = wordToNum(mill[1]);
    if (n) descs.push({
      name: `mill ${n}`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'mill', amount: n },
    });
  }

  // ─── Counter spell ───
  if (/[Cc]ounter target spell/i.test(oracleText)) {
    descs.push({
      name: `counters target spell`,
      category: 'cast',
      assertion: { type: 'counter_spell' },
    });
  }

  // ─── Bounce ───
  const bounce = oracleText.match(/[Rr]eturn target (creature|permanent|nonland permanent) to its owner's hand/);
  if (bounce) {
    descs.push({
      name: `bounces target ${bounce[1]}`,
      category: isInstant || isSorcery ? 'cast' : 'etb',
      assertion: { type: 'bounce', targetType: bounce[1] },
    });
  }

  // ─── Tap target ───
  if (/[Tt]ap target (creature|permanent)/i.test(oracleText)) {
    descs.push({
      name: `taps target`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'todo' },
    });
  }

  // ─── Untap ───
  if (/[Uu]ntap (?:target |it|~)/i.test(normalized)) {
    descs.push({
      name: `untaps`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'todo' },
    });
  }

  // ─── Search library (non-land ramp) ───
  if (/[Ss]earch your library/i.test(oracleText) && !/search your library for a basic land/i.test(oracleText)) {
    descs.push({
      name: `searches library`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'db_json_contains', field: 'search', search: 'search' },
    });
  }

  // ─── Ramp (search for basic land) ───
  if (/[Ss]earch your library for a basic land/i.test(oracleText)) {
    descs.push({
      name: `ramps (search for basic land)`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'db_json_contains', field: 'ramp', search: 'ramp' },
    });
  }

  // ─── Fight ───
  if (/fights? (?:target |another |up to one )/i.test(oracleText)) {
    descs.push({
      name: `fight`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'db_json_contains', field: 'fight', search: 'fight' },
    });
  }

  // ─── Sacrifice ───
  if (/[Ss]acrifice (?:a |an |another )?(creature|permanent|artifact|enchantment|land)/i.test(oracleText)) {
    descs.push({
      name: `involves sacrifice`,
      category: 'activated',
      assertion: { type: 'db_json_contains', field: 'sacrifice', search: 'sacrifice' },
    });
  }

  // ─── Activated ability: {N}, {T}: effect ───
  const activated = oracleText.match(/\{([WUBRGC0-9]+)\}(?:,\s*\{([WUBRGC0-9]+)\})*,?\s*\{T\}\s*:\s*(.+?)(?:\.|$)/m);
  if (activated && !isLand) {
    const effectText = activated[3].trim();
    descs.push({
      name: `has activated ability`,
      category: 'activated',
      assertion: { type: 'has_activated', effectHint: effectText.substring(0, 60) },
    });
  }

  // ─── Tap for mana (non-basic land) ───
  // Skip for dual/tri lands and gain-lands — their mana ability is implicit in the engine
  // Only test if the card explicitly has add_mana as a non-trivial ability
  if (/\{T\}: Add/i.test(oracleText) && !typeLine.includes('Basic Land') && !isLand) {
    const addMana = oracleText.match(/\{T\}: Add \{([WUBRGC])\}/);
    if (addMana) {
      descs.push({
        name: `taps for {${addMana[1]}}`,
        category: 'activated',
        assertion: { type: 'db_json_contains', field: 'add_mana', search: 'add_mana' },
      });
    }
  }

  // ─── Enters tapped ───
  if (/enters (?:the battlefield )?tapped/i.test(oracleText)) {
    descs.push({
      name: `enters tapped`,
      category: 'static',
      assertion: { type: 'db_json_contains', field: 'enters_tapped', search: 'enters_tapped' },
    });
  }

  // ─── Protection from ───
  const protection = oracleText.match(/[Pp]rotection from (\w+)/);
  if (protection) {
    descs.push({
      name: `has protection from ${protection[1]}`,
      category: 'keyword',
      assertion: { type: 'todo' },
    });
  }

  // ─── Hexproof grant ("gains hexproof") ───
  if (/gains? hexproof/i.test(oracleText) && (isInstant || isSorcery)) {
    descs.push({
      name: `grants hexproof`,
      category: 'cast',
      assertion: { type: 'db_json_contains', field: 'hexproof', search: 'hexproof' },
    });
  }

  // ─── Indestructible grant ───
  if (/gains? indestructible/i.test(oracleText) && (isInstant || isSorcery)) {
    descs.push({
      name: `grants indestructible`,
      category: 'cast',
      assertion: { type: 'db_json_contains', field: 'indestructible', search: 'indestructible' },
    });
  }

  // ─── Cost reduction ───
  // Many cards have cost reduction in oracle text but it's often not tracked in DB
  // Just generate a TODO comment instead of a failing test
  const costReduction = oracleText.match(/costs? \{(\d+)\} less/i);
  if (costReduction) {
    descs.push({
      name: `costs {${costReduction[1]}} less conditionally`,
      category: 'static',
      assertion: { type: 'todo' },
    });
  }

  // ─── "You may pay N life" ───
  if (/[Yy]ou may pay (\d+) life/i.test(oracleText)) {
    descs.push({
      name: `has pay life option`,
      category: 'triggered',
      assertion: { type: 'db_json_contains', field: 'pay_life', search: 'life' },
    });
  }

  // ─── Look at top of library ───
  if (/[Ll]ook at the top/i.test(oracleText)) {
    descs.push({
      name: `looks at top of library`,
      category: 'activated',
      assertion: { type: 'db_json_contains', field: 'look_top', search: 'look' },
    });
  }

  // ─── "put it into your hand" / "put into your hand" ───
  if (/put (?:it |one pile |that card |them )?into (?:your |its owner's )?hand/i.test(oracleText)) {
    descs.push({
      name: `puts card into hand`,
      category: isInstant || isSorcery ? 'cast' : 'activated',
      assertion: { type: 'db_json_contains', field: 'to_hand', search: 'hand' },
      context: { relaxed: true },
    });
  }

  // ─── Saga chapters ───
  if (isSaga) {
    const chapters = oracleText.match(/[IVX]+ —/g);
    if (chapters) {
      descs.push({
        name: `is a Saga with ${chapters.length} chapters`,
        category: 'static',
        assertion: { type: 'db_has_field', field: 'saga' },
      });
    }
  }

  // If nothing was parsed (besides keywords), add a TODO
  if (descs.length === 0 && oracleText.trim().length > 0) {
    descs.push({
      name: `TODO: needs manual test`,
      category: 'cast',
      assertion: { type: 'todo' },
    });
  }

  return descs;
}

function wordToNum(w: string): number | null {
  const map: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  return map[w.toLowerCase()] ?? (parseInt(w) || null);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
