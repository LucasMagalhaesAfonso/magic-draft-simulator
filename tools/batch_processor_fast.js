#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');

const BATCHES = {
  batch21: ['Host of the Hereafter', 'Humbling Elder', 'Hundred-Battle Veteran', 'Iceridge Serpent', 'Inevitable Defeat'],
  batch22: ['Inspirited Vanguard', 'Iridescent Tiger', 'Island', 'Jade-Cast Sentinel', 'Jeskai Brushmaster'],
  batch23: ['Jeskai Devotee', 'Jeskai Monument', 'Jeskai Revelation', 'Jeskai Shrinekeeper', 'Jungle Hollow'],
  batch24: ['Karakyk Guardian', 'Kheru Goldkeeper', 'Kin-Tree Nurturer', 'Kin-Tree Severance', 'Kishla Skimmer'],
  batch25: ['Kishla Trawlers', 'Kishla Village', 'Knockout Maneuver', 'Kotis, the Fangkeeper', 'Krotiq Nestguard'],
  batch26: ['Krumar Initiate', 'Lasyd Prowler', 'Lie in Wait', 'Lightfoot Technique', 'Lotuslight Dancers'],
  batch27: ['Loxodon Battle Priest', 'Maelstrom of the Spirit Dragon', 'Magmatic Hellkite', 'Mammoth Bellow', 'Marang River Regent // Coil and Catch'],
  batch28: ['Mardu Devotee', 'Mardu Monument', 'Mardu Siegebreaker', 'Marshal of the Lost', 'Meticulous Artisan'],
  batch29: ['Mistrise Village', 'Molten Exhale', 'Monastery Messenger', 'Mountain', 'Mox Jasper'],
  batch30: ['Mystic Monastery', 'Naga Fleshcrafter', 'Narset, Jeskai Waymaster', 'Narset\'s Rebuke', 'Nature\'s Rhythm'],
  batch31: ['Neriv, Heart of the Storm', 'New Way Forward', 'Nightblade Brigade', 'Nomad Outpost', 'Opulent Palace'],
  batch32: ['Osseous Exhale', 'Overwhelming Surge', 'Perennation', 'Piercing Exhale', 'Plains'],
  batch33: ['Poised Practitioner', 'Purging Stormbrood // Absorb Essence', 'Qarsi Revenant', 'Rainveil Rejuvenator', 'Rakshasa\'s Bargain'],
  batch34: ['Rally the Monastery', 'Rebellious Strike', 'Rediscover the Way', 'Reigning Victor', 'Reputable Merchant'],
  batch35: ['Rescue Leopard', 'Reverberating Summons', 'Revival of the Ancestors', 'Riling Dawnbreaker // Signaling Roar', 'Ringing Strike Mastery'],
  batch36: ['Rite of Renewal', 'Riverwalk Technique', 'Riverwheel Sweep', 'Roamer\'s Routine', 'Roar of Endless Song'],
  batch37: ['Roiling Dragonstorm', 'Rot-Curse Rakshasa', 'Rugged Highlands', 'Runescale Stormbrood // Chilling Screech', 'Sage of the Fang'],
  batch38: ['Sage of the Skies', 'Sagu Pummeler', 'Sagu Wildling // Roost Seek', 'Salt Road Packbeast', 'Salt Road Skirmish'],
  batch39: ['Sandskitter Outrider', 'Sandsteppe Citadel', 'Sarkhan, Dragon Ascendant', 'Sarkhan\'s Resolve', 'Scavenger Regent // Exude Toxin'],
  batch40: ['Scoured Barrens', 'Seize Opportunity', 'Severance Priest', 'Shiko, Paragon of the Way', 'Shock Brigade'],
  batch41: ['Shocking Sharpshooter', 'Sibsig Appraiser', 'Sidisi, Regent of the Mire', 'Sinkhole Surveyor', 'Skirmish Rhino'],
  batch42: ['Smile at Death', 'Snakeskin Veil', 'Snowmelt Stag', 'Songcrafter Mage', 'Sonic Shrieker'],
  batch43: ['Spectral Denial', 'Stadium Headliner', 'Stalwart Successor', 'Starry-Eyed Skyrider', 'Static Snare'],
  batch44: ['Stillness in Motion', 'Stormbeacon Blade', 'Stormplain Detainment', 'Stormscale Scion', 'Stormshriek Feral // Flush Out'],
  batch45: ['Strategic Betrayal', 'Sultai Devotee', 'Sultai Monument', 'Summit Intimidator', 'Sunpearl Kirin'],
  batch46: ['Sunset Strikemaster', 'Surrak, Elusive Hunter', 'Swamp', 'Swiftwater Cliffs', 'Synchronized Charge'],
  batch47: ['Taigam, Master Opportunist', 'Teeming Dragonstorm', 'Tempest Hawk', 'Temur Battlecrier', 'Temur Devotee'],
  batch48: ['Temur Monument', 'Temur Tawnyback', 'Tersa Lightshatter', 'Teval, Arbiter of Virtue', 'The Sibsig Ceremony'],
  batch49: ['Thornwood Falls', 'Thunder of Unity', 'Trade Route Envoy', 'Tranquil Cove', 'Traveling Botanist'],
  batch50: ['Twin Bolt', 'Twinmaw Stormbrood // Charring Bite', 'Ugin, Eye of the Storms', 'Unburied Earthcarver', 'Underfoot Underdogs'],
  batch51: ['Undergrowth Leopard', 'Unending Whisper', 'United Battlefront', 'Unrooted Ancestor', 'Unsparing Boltcaster'],
  batch52: ['Ureni\'s Rebuff', 'Ureni, the Song Unending', 'Venerated Stormsinger', 'Veteran Ice Climber', 'Voice of Victory'],
  batch53: ['Wail of War', 'Warden of the Grove', 'War Effort', 'Watcher of the Wayside', 'Wayspeaker Bodyguard'],
  batch54: ['Whirlwing Stormbrood // Dynamic Soar', 'Wild Ride', 'Windcrag Siege', 'Wind-Scarred Crag', 'Wingblade Disciple'],
  batch55: ['Wingspan Stride', 'Winternight Stories', 'Worthy Cost', 'Yathan Roadwatcher', 'Yathan Tombguard']
};

let results = [];

for (let i = 21; i <= 55; i++) {
  const batchKey = `batch${i}`;
  try {
    const output = execSync(`node tools/full-stack-analyzer.js ${batchKey} 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000
    });

    const match = output.match(/✅ Complete: (\d+)\/(\d+)/);
    const complete = match ? parseInt(match[1]) : 0;
    const total = match ? parseInt(match[2]) : 5;

    const status = complete === total ? 'PASS' : 'ISSUES';
    console.log(`Batch ${i}: ${complete}/5 - ${status}`);
    results.push({ batch: i, status, complete, total });
  } catch (e) {
    console.log(`Batch ${i}: ERROR`);
    results.push({ batch: i, status: 'ERROR', complete: 0, total: 5 });
  }
}

console.log('\n✅ SUMMARY:');
const passed = results.filter(r => r.status === 'PASS').length;
const issues = results.filter(r => r.status === 'ISSUES').length;
const errors = results.filter(r => r.status === 'ERROR').length;

console.log(`Passed: ${passed}/35`);
console.log(`With issues: ${issues}/35`);
console.log(`Errors: ${errors}/35`);
