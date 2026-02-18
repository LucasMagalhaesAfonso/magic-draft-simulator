const db = require('./js/data/card-effects.js').CardEffectsDB;

// Items MÉDIA do relatório
const effects = ['bounce_to_library', 'damage_each_opponent', 'optional_discard_draw'];
const targets = ['colored_permanent', 'creature_power2_or_less', 'creature_power_3_or_less', 'creatures_and_planeswalkers', 'distribute_creatures', 'divided', 'opponent_spell', 'other_own_creature', 'spell_or_permanent'];
const conditions = ['three_counter_types'];

const usedBy = {
  effects: {},
  targets: {},
  conditions: {}
};

// Scan all cards
for (const [name, data] of Object.entries(db)) {
  // Check effects
  const allEffects = [
    ...(data.cast || []),
    ...(data.etb || []),
    ...(data.triggered?.map(t => t.effects || []).flat() || []),
    ...(data.activated?.map(a => a.effects || []).flat() || []),
    ...(data.graveyard?.map(g => g.effects || []).flat() || [])
  ];

  for (const effect of allEffects) {
    if (effects.includes(effect.type)) {
      if (!usedBy.effects[effect.type]) usedBy.effects[effect.type] = [];
      usedBy.effects[effect.type].push(name);
    }

    if (targets.includes(effect.target)) {
      if (!usedBy.targets[effect.target]) usedBy.targets[effect.target] = [];
      usedBy.targets[effect.target].push(name);
    }

    if (conditions.includes(effect.condition)) {
      if (!usedBy.conditions[effect.condition]) usedBy.conditions[effect.condition] = [];
      usedBy.conditions[effect.condition].push(name);
    }
  }
}

console.log('\n========== ANALISE DE USO (TDM) ==========\n');

console.log('EFFECTS:');
for (const eff of effects) {
  if (usedBy.effects[eff]) {
    console.log(`  [USADO] ${eff} -> ${usedBy.effects[eff].join(', ')}`);
  } else {
    console.log(`  [NAO USADO] ${eff}`);
  }
}

console.log('\nTARGETS:');
for (const tgt of targets) {
  if (usedBy.targets[tgt]) {
    console.log(`  [USADO] ${tgt} -> ${usedBy.targets[tgt].join(', ')}`);
  } else {
    console.log(`  [NAO USADO] ${tgt}`);
  }
}

console.log('\nCONDITIONS:');
for (const cond of conditions) {
  if (usedBy.conditions[cond]) {
    console.log(`  [USADO] ${cond} -> ${usedBy.conditions[cond].join(', ')}`);
  } else {
    console.log(`  [NAO USADO] ${cond}`);
  }
}

console.log('\n========================================\n');
