// port-game-state.js
// Transforms legacy game-state.js into TypeScript (game-state.ts)
// Run: node tools/port-game-state.js

const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../legacy-pure-js/js/game/game-state.js');
const dstPath = path.join(__dirname, '../src/engine/game-state.ts');

const src = fs.readFileSync(srcPath, 'utf8');

const output = [];

// Header
output.push('// @ts-nocheck');
output.push('// game-state.ts — Ported from legacy game-state.js');
output.push('// DO NOT add type annotations — ts-nocheck handles this file');
output.push('');
output.push("import * as Cards from './cards';");
output.push("import * as Mana from './mana';");
output.push("import * as Stack from './stack';");
output.push("import * as GameAI from './game-ai';");
output.push("import * as CombatSim from './combat-sim';");
output.push('');
output.push("export const PHASES = ['untap', 'upkeep', 'draw', 'main1', 'combat_begin', 'combat_attackers', 'combat_blockers', 'combat_damage', 'combat_end', 'main2', 'end', 'cleanup'];");
output.push('export const STARTING_LIFE = 20;');
output.push('export const MAX_HAND_SIZE = 7;');
output.push('');

function applyTransforms(line) {
  // Replace module references
  line = line.replace(/\bCardEngine\./g, 'Cards.');
  line = line.replace(/\bManaSystem\./g, 'Mana.');
  line = line.replace(/\bGameStack\./g, 'Stack.');
  line = line.replace(/\bCombatSystem\./g, 'CombatSim.');

  // Replace this.PHASES, this.STARTING_LIFE, this.MAX_HAND_SIZE
  line = line.replace(/\bthis\.PHASES\b/g, 'PHASES');
  line = line.replace(/\bthis\.STARTING_LIFE\b/g, 'STARTING_LIFE');
  line = line.replace(/\bthis\.MAX_HAND_SIZE\b/g, 'MAX_HAND_SIZE');

  // Replace all this.methodName( with methodName(
  const methodNames = [
    '_resolveSimpleEffect', '_checkTriggerCondition', '_checkEffectCondition',
    'fireTrigger', 'castSpell', 'creatureDies', 'sacrifice', 'advancePhase',
    '_processPhase', '_endOfTurnCleanup', '_checkWinner', '_createPlayer',
    '_registerTriggersForBattlefield', '_registerCardTriggers', '_unregisterCardTriggers',
    '_aiMulliganDecision', '_aiChooseTargetsForEffects', 'mulligan', 'keepHand',
    'startGame', '_updateDynamicStaticAbilities', '_updateDynamicPower',
    '_updateVividCreatures', '_applyStaticOnETB', 'playLand', '_processHideaway',
    '_checkHideawayCondition', 'activateHideaway', 'tapLandForMana',
    'calculateAffinityDiscount', 'getAttackingCreatureDiscount', 'returnTemporaryExiles',
    '_smartActivateManaAbilities', '_pickMostNeededColor', '_canUseAbility',
    '_getAbilityManaProduction', 'autoTapForSpell', '_findBestHybridCombo',
    'previewAutoTap', 'activateLoyaltyAbility', '_checkPlaneswalkerDeath',
    'damagePlaneswalker', '_applyAuraEffects', '_removeAuraEffects',
    'equipCreature', '_applyEquipmentEffects', '_removeEquipmentEffects',
    'transformCreature', '_advanceSagaChapter', 'activateCycling',
    'getPlayableCards', 'hasAffordableAbilities', 'getHarmonizableCards',
    'castHarmonize', 'submitExileChoice', '_hasValidTargetsForCard',
    '_effectRequiresTargets', '_hasValidTargetsForEffect', '_oracleTextRequiresTargets',
    '_hasValidTargetsFromOracle', '_processStateBasedActions', 'resolveTriggerCost',
    'getEffectiveCmcWithReduction', '_processSuspendedSpells', '_performBlight',
    '_setupBlightChoice', '_setupHandExileChoice', 'resolveHandExileChoice',
    'resolveManaChoice', 'resolveUnlessPay', 'resolveEndureChoice',
    'resolveMillLandChoice', 'resolveBlightChoice', 'resolveBuffChoice',
    'resolveMultiBuffChoice'
  ];

  for (const name of methodNames) {
    const re = new RegExp(`\\bthis\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`, 'g');
    line = line.replace(re, `${name}(`);
  }

  // Remove VFX/UIGame calls
  // Pattern 1: if (typeof VFX !== 'undefined') VFX.xxx(...);
  line = line.replace(/if\s*\(typeof\s+VFX[^;]*;/g, '// TODO: VFX callback');
  // Pattern 2: VFX.xxx(...);
  line = line.replace(/\bVFX\.[a-zA-Z_]+\([^)]*\);?/g, '// TODO: VFX callback');
  // Pattern 3: UIGame.xxx(...);
  line = line.replace(/\bUIGame\.[a-zA-Z_]+\([^)]*\);?/g, '// TODO: UIGame callback');

  return line;
}

function countBraces(line) {
  let open = 0, close = 0;
  let inStr = false, strChar = '';
  let escaped = false;
  let inTempl = 0; // template literal depth
  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inStr && strChar !== '`') {
      if (ch === strChar) inStr = false;
      continue;
    }
    if (inStr && strChar === '`') {
      if (ch === '`') inStr = false;
      // Don't count braces inside template literals unless in ${...}
      // Simplified: just skip
      continue;
    }
    if (!inStr) {
      if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
      if (ch === '`') { inStr = true; strChar = ch; continue; }
      if (ch === '/') {
        // Check for line comment
        if (ci + 1 < line.length && line[ci + 1] === '/') break; // rest is comment
        // Skip regex detection (complex) - just continue
      }
      if (ch === '{') open++;
      if (ch === '}') close++;
    }
  }
  return { open, close };
}

const methodNames = [
  'create', '_aiMulliganDecision', '_aiChooseTargetsForEffects', 'mulligan', 'keepHand',
  'startGame', '_registerTriggersForBattlefield', '_registerCardTriggers', '_unregisterCardTriggers',
  'fireTrigger', '_checkTriggerCondition', '_checkEffectCondition', '_resolveSimpleEffect',
  '_processSuspendedSpells', '_performBlight', '_setupBlightChoice', '_setupHandExileChoice',
  'resolveHandExileChoice', 'resolveManaChoice', 'resolveUnlessPay', 'resolveEndureChoice',
  'resolveMillLandChoice', 'resolveBlightChoice', 'resolveBuffChoice', 'resolveMultiBuffChoice',
  '_createPlayer', 'advancePhase', '_processPhase', 'playLand', '_processHideaway',
  '_checkHideawayCondition', 'activateHideaway', 'tapLandForMana', 'calculateAffinityDiscount',
  'getAttackingCreatureDiscount', 'returnTemporaryExiles', 'castSpell', '_smartActivateManaAbilities',
  '_pickMostNeededColor', '_canUseAbility', '_getAbilityManaProduction', 'autoTapForSpell',
  '_findBestHybridCombo', 'previewAutoTap', '_updateVividCreatures', '_updateDynamicPower',
  '_updateDynamicStaticAbilities', '_applyStaticOnETB', '_endOfTurnCleanup', '_checkWinner',
  'activateLoyaltyAbility', '_checkPlaneswalkerDeath', 'damagePlaneswalker', '_applyAuraEffects',
  '_removeAuraEffects', 'equipCreature', '_applyEquipmentEffects', '_removeEquipmentEffects',
  'creatureDies', 'transformCreature', 'sacrifice', '_advanceSagaChapter', 'activateCycling',
  'getPlayableCards', 'hasAffordableAbilities', 'getHarmonizableCards', 'castHarmonize',
  'submitExileChoice', '_hasValidTargetsForCard', '_effectRequiresTargets', '_hasValidTargetsForEffect',
  '_oracleTextRequiresTargets', '_hasValidTargetsFromOracle', '_processStateBasedActions',
  'resolveTriggerCost', 'getEffectiveCmcWithReduction'
];

function detectMethodStart(line, relDepth) {
  if (relDepth !== 0) return null;
  const trimmed = line.trim();
  for (const name of methodNames) {
    if (trimmed.startsWith(name + '(') || trimmed.startsWith('async ' + name + '(')) {
      return name;
    }
    // Also match with comment before: "// === Comment ===\n  methodName("
    // No, trim handles leading spaces
  }
  return null;
}

const allLines = src.split('\n');
let relDepth = 0;
let methods = [];
let currentM = null;

for (let li = 1; li < allLines.length; li++) {
  const rawLine = allLines[li];
  const bc = countBraces(rawLine);

  if (currentM === null) {
    const mName = detectMethodStart(rawLine, relDepth);
    if (mName) {
      currentM = { name: mName, lines: [] };
      currentM.lines.push(rawLine);
      relDepth += bc.open - bc.close;
    } else {
      relDepth += bc.open - bc.close;
      if (relDepth < 0) break;
    }
  } else {
    currentM.lines.push(rawLine);
    relDepth += bc.open - bc.close;
    if (relDepth === 0) {
      methods.push({ ...currentM });
      currentM = null;
    }
  }
}

console.log(`Found ${methods.length} methods`);

for (const method of methods) {
  const lines = method.lines;
  let firstLine = lines[0].trim();

  let funcName = method.name;
  if (funcName === 'create') funcName = 'createGame';

  if (firstLine.startsWith('async ')) {
    firstLine = firstLine.replace(/^async (\w+)\(/, `export async function ${funcName}(`);
  } else {
    firstLine = firstLine.replace(/^(\w+)\(/, `export function ${funcName}(`);
  }

  firstLine = applyTransforms(firstLine);
  output.push(firstLine);

  for (let li = 1; li < lines.length - 1; li++) {
    output.push(applyTransforms(lines[li]));
  }

  const lastLine = lines[lines.length - 1];
  const lastTrimmed = lastLine.trim();
  if (lastTrimmed === '},' || lastTrimmed === '}') {
    output.push('}');
  } else {
    output.push(applyTransforms(lastLine));
  }

  output.push('');
}

const result = output.join('\n');
fs.writeFileSync(dstPath, result);
console.log(`Written ${result.split('\\n').length} lines to ${dstPath}`);
