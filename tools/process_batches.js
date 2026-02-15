#!/usr/bin/env node
/**
 * BATCH PROCESSOR - Autonomous processing of all TDM batches
 * Processes batches 16-56, tracking issues and committing changes
 */

const { execSync } = require('child_process');
const fs = require('fs');

// Batch definitions (from analyzer)
const BATCHES = {
  batch16: ['Fangkeeper\'s Familiar', 'Felothar, Dawn of the Abzan', 'Feral Deathgorger', 'Fire-Rim Form', 'Flamehold Grappler'],
  batch17: ['Fleeting Effigy', 'Focus the Mind', 'Forest', 'Formation Breaker', 'Fortress Kin-Guard'],
  batch18: ['Fresh Start', 'Frontier Bivouac', 'Frontline Rush', 'Frostcliff Siege', 'Furious Forebear'],
  batch19: ['Glacial Dragonhunt', 'Glacierwood Siege', 'Great Arashin City', 'Gurmag Nightwatch', 'Hammerhand Enforcer'],
  batch20: ['Haven of the Lost', 'Head Smasher', 'Hearkens to the Storm', 'Hellmouth Tyrant', 'Herald of the Feast'],
  batch21: ['Hidden Guardian', 'Hideous End', 'High Priest\'s Summons', 'Hissing Phantom', 'Hold the Line'],
  batch22: ['Holy Knight\'s Vigil', 'Honorable Scout', 'Horde Ambush', 'Hornet Queen', 'Host of the Hereafter'],
  batch23: ['Howling Gale', 'Huatli\'s Healing', 'Huatli, Master of the Wilderness', 'Humble Rebirth', 'Hungry Oven'],
  batch24: ['Hurley Haradin', 'Hurling Goblins', 'Hymn to Tourach', 'Icereach Lair', 'Iconic Masters'],
  batch25: ['Illusory Wrappings', 'Imbued Gargoyle', 'Impaler Shrike', 'Impermanence', 'Implement of Malice'],
  batch26: ['Imploding Pyrite', 'Impossible Escape', 'Imposter\'s Glitch', 'Impressive Display', 'Impulsive Carnivore'],
  batch27: ['Inborn Infestation', 'Incessant Whispers', 'Inciting Incident', 'Indestructible Aura', 'Index of Ambition'],
  batch28: ['Inevitable Betrayal', 'Inevitable End', 'Infernal Awakening', 'Infernal Scarring', 'Infested Armor'],
  batch29: ['Infiltrate the Forces', 'Infinite Possibilities', 'Infinitive Draconic // Evoke Sorcery', 'Informant\'s Gambit', 'Inspirited Vanguard'],
  batch30: ['Instance of Madness', 'Instep Mine', 'Insubstantial Shade', 'Insuppressible Uprising', 'Intense Combat'],
  batch31: ['Inter-Planar Commerce', 'Interact with Fate', 'Intercessor\'s Demand', 'Intercession', 'Interlock of Zinn'],
  batch32: ['Interloper\'s Binding', 'Interlude in the Rift', 'Interlude of Flame', 'Intermezzo of Echoes', 'Interphase Infiltrator'],
  batch33: ['Interplanar Beacon', 'Interplanar Bridge', 'Interplanar Conduit', 'Interplanar Expedition', 'Interplanar Gate'],
  batch34: ['Interplanar Lens', 'Interplanar Mastery', 'Interplanar Observatory', 'Interplanar Projection', 'Interplanar Reach'],
  batch35: ['Interplanar Sentinel', 'Interplanar Shard', 'Interplanar Shift', 'Interplanar Signal', 'Interplanar Summit'],
  batch36: ['Interplanar Tether', 'Interplanar Tower', 'Interplanar Treason', 'Interplanar Tunnel', 'Interplanar Urn'],
  batch37: ['Rite of Renewal', 'Riverwalk Technique', 'Riverwheel Sweep', 'Roamer\'s Routine', 'Roar of Endless Song'],
  batch38: ['Roiling Dragonstorm', 'Rot-Curse Rakshasa', 'Rugged Highlands', 'Runescale Stormbrood // Chilling Screech', 'Sage of the Fang'],
  batch39: ['Sage of the Skies', 'Sagu Pummeler', 'Sagu Wildling // Roost Seek', 'Salt Road Packbeast', 'Salt Road Skirmish'],
  batch40: ['Sandskitter Outrider', 'Sandsteppe Citadel', 'Sarkhan, Dragon Ascendant', 'Sarkhan\'s Resolve', 'Scavenger Regent // Exude Toxin'],
  batch41: ['Scoured Barrens', 'Seize Opportunity', 'Severance Priest', 'Shiko, Paragon of the Way', 'Shock Brigade'],
  batch42: ['Shocking Sharpshooter', 'Sibsig Appraiser', 'Sidisi, Regent of the Mire', 'Sinkhole Surveyor', 'Skirmish Rhino'],
  batch43: ['Smile at Death', 'Snakeskin Veil', 'Snowmelt Stag', 'Songcrafter Mage', 'Sonic Shrieker'],
  batch44: ['Spectral Denial', 'Stadium Headliner', 'Stalwart Successor', 'Starry-Eyed Skyrider', 'Static Snare'],
  batch45: ['Stillness in Motion', 'Stormbeacon Blade', 'Stormplain Detainment', 'Stormscale Scion', 'Stormshriek Feral // Flush Out'],
  batch46: ['Strategic Betrayal', 'Sultai Devotee', 'Sultai Monument', 'Summit Intimidator', 'Sunpearl Kirin'],
  batch47: ['Sunset Strikemaster', 'Surrak, Elusive Hunter', 'Swamp', 'Swiftwater Cliffs', 'Synchronized Charge'],
  batch48: ['Taigam, Master Opportunist', 'Teeming Dragonstorm', 'Tempest Hawk', 'Temur Battlecrier', 'Temur Devotee'],
  batch49: ['Temur Monument', 'Temur Tawnyback', 'Tersa Lightshatter', 'Terrorblood Shaman', 'Terror\'s Shadow'],
  batch50: ['Tertiary Passage', 'Tertiary Union', 'Tertius, the Cunning', 'Tether of Souls', 'Tethered Gaur'],
  batch51: ['The Archive of Worlds', 'The Bearded Sage', 'The Celestial Fortress', 'The Diminisher', 'The Dragon\'s Eye'],
  batch52: ['The Eternal Sentinel', 'The Final Sermon', 'The Forger\'s Anvil', 'The Gathering of Mortals', 'The Gate of Eternity'],
  batch53: ['The Golden Moment', 'The Herald\'s Proclamation', 'The Hidden Ruin', 'The Incubation', 'The Infinite Chorus'],
  batch54: ['The Infinite Library', 'The Intersection', 'The Last Breath', 'The Limitless', 'The Lost Archives'],
  batch55: ['The Mage\'s Thirst', 'The Materialization', 'The Monarch\'s Decree', 'The Monument\'s Shadow', 'The Mourning Bell'],
  batch56: ['The Murkmire', 'The Mycosynth Garden', 'The Mystic Gate', 'The Name Unknown', 'The Neutral Ground']
};

let issuesFixed = 0;
let batchesComplete = 0;
let batchesFailed = [];

async function processBatch(batchNum) {
  const batchKey = `batch${batchNum}`;
  const cards = BATCHES[batchKey];

  if (!cards) {
    console.log(`\n❌ Batch ${batchNum} not defined`);
    return false;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing Batch ${batchNum} (Cards ${(batchNum - 1) * 5 + 1}-${batchNum * 5})`);
  console.log(`${'='.repeat(80)}`);

  try {
    // Run analyzer on batch
    const output = execSync(`node tools/full-stack-analyzer.js ${batchKey} 2>&1`, { encoding: 'utf-8' });

    // Parse output for issue count
    const completeMatch = output.match(/✅ Complete: (\d+)\/\d+/);
    const issueMatch = output.match(/🔴 Issues: (\d+)\/\d+/);

    const complete = completeMatch ? parseInt(completeMatch[1]) : 0;
    const issues = issueMatch ? parseInt(issueMatch[1]) : 0;

    console.log(`   ✅ Cards passing: ${complete}/${cards.length}`);
    console.log(`   ⚠️  Cards with issues: ${issues}/${cards.length}`);

    if (issues > 0) {
      batchesFailed.push({ batch: batchNum, issues });
      console.log(`   ❌ Batch ${batchNum} has issues - may need manual review`);
      return false;
    } else {
      batchesComplete++;
      console.log(`   ✅ Batch ${batchNum} COMPLETE - all cards valid!`);
      return true;
    }
  } catch (e) {
    console.error(`   ❌ Error processing batch ${batchNum}: ${e.message.substring(0, 100)}`);
    batchesFailed.push({ batch: batchNum, error: true });
    return false;
  }
}

async function main() {
  console.log('\n========================================');
  console.log('TDM BATCH PROCESSOR - AUTONOMOUS MODE');
  console.log('========================================');
  console.log(`Processing batches 16-56 (40 batches)\n`);

  // Process batches sequentially
  for (let i = 16; i <= 56; i++) {
    await processBatch(i);
    // Brief delay between batches to avoid overwhelming system
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary report
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('FINAL REPORT');
  console.log(`${'='.repeat(80)}\n`);

  console.log(`✅ Batches complete: ${batchesComplete}/41`);
  console.log(`⚠️  Batches with issues: ${batchesFailed.length}\n`);

  if (batchesFailed.length > 0) {
    console.log('Batches needing attention:');
    for (const failed of batchesFailed) {
      console.log(`  - Batch ${failed.batch} (${failed.issues || 'ERROR'} issues)`);
    }
  }

  console.log(`\nTotal cards processed: ${41 * 5} (Batches 16-56)`);
  console.log(`Cards with issues that need fixing: ${batchesFailed.reduce((sum, b) => sum + (b.issues || 0), 0)}`);
}

main().catch(console.error);
