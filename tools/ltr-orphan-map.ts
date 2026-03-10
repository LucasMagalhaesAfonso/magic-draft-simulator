/**
 * Maps orphan types/targets to LTR cards
 */
import { CardEffectsDB } from '../src/engine/card-effects';
import * as fs from 'fs';
import * as path from 'path';

const jsonPath = path.resolve(import.meta.dirname, '../legacy-pure-js/js/data/scryfall-ltr.json');
const ltrData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
const ltrNames = new Set<string>();
for (const c of ltrData.cards) {
  const nm = c.card_faces ? c.card_faces[0].name.toLowerCase() : c.name.split(' // ')[0].toLowerCase();
  ltrNames.add(nm);
}

function findInObj(obj: any, key: string, val: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (obj[key] === val) return true;
  for (const v of Object.values(obj)) {
    if (findInObj(v as any, key, val)) return true;
  }
  return false;
}

const orphanTypes = ['destroy_all','mill_land_choice','conditional_flash','mark_exile_on_death','bounce_to_library','loses_abilities','aura_prevent_untap','static_ability','strategic_betrayal','remove_abilities','swampcycling','opponents_cant_gain_life','return_to_battlefield_tapped','power_toughness_star','extra_token','exile_until_leaves','enters_tapped_with_counters','transform','grant_all_type','put_from_hand','opponents_lands_no_nonmana_abilities','conditional_hexproof_indestructible','goad','move_counters_to_self','move_counters_from_self','islandcycling','sacrifice_or_pay','aura_cant_attack_block','exile_self_unless_pay_life','damage_all_creatures','note_creature_type_buff'];
const orphanTargets = ['opponent_hand_nonland','creatures_and_enchantments','artifacts_creatures_planeswalkers','colorless_nonland','any_card','noncreature_nonland','instant_or_sorcery_in_gy','blocker','own_legendary_creature','equipped_creature','another_creature','historic','creature_in_graveyard','opponent_creature_or_artifact','blockers','creature_lesser_power','own_permanent','target_controller','own_creature_vs_opponent','artifact_or_creature','artifact_or_enchantment_or_flyer','nontoken_creature','opponent_creature_to_another','artifact_or_land','each_player_creature','enchanted_creature','creature_with_power_X','self_controller'];

console.log('LTR cards in set:', ltrNames.size);

let ltrDbCount = 0;
for (const name of Object.keys(CardEffectsDB)) {
  if (ltrNames.has(name.split(' // ')[0])) ltrDbCount++;
}
console.log('LTR cards in DB:', ltrDbCount);

console.log('\n=== LTR ORPHAN TYPES ===');
let typeIssues = 0;
for (const t of orphanTypes) {
  const cards: string[] = [];
  for (const [name, def] of Object.entries(CardEffectsDB)) {
    if (!ltrNames.has(name.split(' // ')[0])) continue;
    if (findInObj(def, 'type', t)) cards.push(name);
  }
  if (cards.length > 0) {
    console.log(`  ${t}: ${cards.join(' | ')}`);
    typeIssues += cards.length;
  }
}

console.log('\n=== LTR ORPHAN TARGETS ===');
let targetIssues = 0;
for (const t of orphanTargets) {
  const cards: string[] = [];
  for (const [name, def] of Object.entries(CardEffectsDB)) {
    if (!ltrNames.has(name.split(' // ')[0])) continue;
    if (findInObj(def, 'target', t)) cards.push(name);
  }
  if (cards.length > 0) {
    console.log(`  ${t}: ${cards.join(' | ')}`);
    targetIssues += cards.length;
  }
}

console.log(`\nTotal: ${typeIssues} type issues + ${targetIssues} target issues`);
