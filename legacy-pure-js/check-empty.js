const db = require('./js/data/card-effects.js');

const empty = [];
const onlyOptional = [];

for (const [name, data] of Object.entries(db.CardEffectsDB)) {
  const hasContent = data.cast || data.etb || data.triggered || data.static || data.activated || data.graveyard || data.modal;

  if (!hasContent) {
    if (data.optional === true) {
      onlyOptional.push(name);
    } else {
      empty.push(name);
    }
  }
}

console.log('\n========== EMPTY IMPLEMENTATIONS ==========');
console.log(`Total: ${empty.length + onlyOptional.length} cards\n`);

if (empty.length > 0) {
  console.log(`COMPLETELY EMPTY (${empty.length}):`);
  empty.forEach(c => console.log(`  - ${c}`));
  console.log('');
}

if (onlyOptional.length > 0) {
  console.log(`ONLY 'optional: true' (${onlyOptional.length}):`);
  onlyOptional.forEach(c => console.log(`  - ${c}`));
}
