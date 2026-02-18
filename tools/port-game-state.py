#!/usr/bin/env python3
"""Port legacy game-state.js to TypeScript game-state.ts"""
import re

src_path = 'C:/Users/lucas/OneDrive/Área de Trabalho/magic_draft/legacy-pure-js/js/game/game-state.js'
dst_path = 'C:/Users/lucas/OneDrive/Área de Trabalho/magic_draft/src/engine/game-state.ts'

with open(src_path, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
print(f'Source: {len(lines)} lines')

output = []

# Header
output.append('// @ts-nocheck')
output.append('// game-state.ts — Ported from legacy game-state.js')
output.append('// DO NOT add type annotations — ts-nocheck handles this file')
output.append('')
output.append("import * as Cards from './cards';")
output.append("import * as Mana from './mana';")
output.append("import * as CombatSim from './combat-sim';")
output.append("import * as CardUtils from './card-utils';")
output.append('')

in_gamestate_obj = False
brace_depth = 0
found_gamestate = False

for i, line in enumerate(lines):
    # Skip original header/variable declaration, replace with exports
    stripped = line.strip()

    # Detect GameState object start
    if not found_gamestate and ('const GameState' in line or 'var GameState' in line or 'let GameState' in line) and '=' in line and '{' in line:
        found_gamestate = True
        in_gamestate_obj = True
        brace_depth = line.count('{') - line.count('}')
        # Skip this line - we'll handle methods individually
        output.append('// ─── GameState methods (converted to exported functions) ───')
        continue

    if in_gamestate_obj:
        # Count braces to track when we exit the object
        brace_depth += line.count('{') - line.count('}')

        if brace_depth <= 0:
            # End of GameState object
            in_gamestate_obj = False
            output.append('// ─── End of GameState object ───')
            continue

        # Convert method definitions: "  methodName(args) {" -> "export function methodName(args) {"
        method_match = re.match(r'^(\s+)(\w+)\s*\(([^)]*)\)\s*\{', line)
        if method_match and brace_depth == 1 + line.count('{') - line.count('}'):
            indent = method_match.group(1)
            method_name = method_match.group(2)
            args = method_match.group(3)
            rest = line[line.index('{'):]

            # Replace this.X -> X (for GameState methods calling each other)
            new_line = f'export function {method_name}({args}) {rest}'
            output.append(new_line)
            continue

        # Replace this. references to GameState methods - they become direct calls
        line = re.sub(r'\bthis\.(?!_uid|_zone|_tapped|_powerMod|_toughnessMod|_counters|_damage|_summoningSick|_attacking|_blocking|_triggers|_tempKeywords|_champion|_evoked|_attachedTo|_attachments|_isSaga|_sagaChapter|_sagaMaxChapter|_loyaltyUsedThisTurn|_regenerateShield|_stun|power|toughness|cmc|mana_cost|name|type_line|oracle_text|colors|color_identity|rarity|id)', '', line)

        # Remove VFX and UIGame calls
        line = re.sub(r'\bVFX\.\w+\([^;]*\);?', '// VFX removed', line)
        line = re.sub(r'\bUIGame\.\w+\([^;]*\);?', '// UIGame removed', line)

        output.append(line)
    else:
        # Outside GameState object - keep as-is but do some replacements
        # Replace CardEngine. -> Cards.
        line = line.replace('CardEngine.', 'Cards.')
        # Replace ManaSystem. -> Mana.
        line = line.replace('ManaSystem.', 'Mana.')
        # Replace CombatSystem. -> CombatSim.
        line = line.replace('CombatSystem.', 'CombatSim.')

        # Remove VFX and UIGame
        line = re.sub(r'\bVFX\.\w+\([^;]*\);?', '// VFX removed', line)
        line = re.sub(r'\bUIGame\.\w+\([^;]*\);?', '// UIGame removed', line)

        output.append(line)

result = '\n'.join(output)
with open(dst_path, 'w', encoding='utf-8') as f:
    f.write(result)

out_lines = len(output)
print(f'Output: {out_lines} lines -> {dst_path}')
print('Done!')
