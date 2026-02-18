# TDM (Tarkir Dragonstorm) Test Coverage Summary

This document lists all TDM cards tested across the three test files, with details on what abilities/effects are verified.

## Test Files Overview

1. **tdm.spec.js** (110 cards) - Focused integration tests with detailed test descriptions
2. **tdm-scenarios.spec.js** (234 cards/scenarios) - Complex multi-ability scenario tests
3. **tdm-all-cards.spec.js** (244 cards) - Database validation tests (checks DB entries exist and have correct structure)

---

## Cards Tested in tdm.spec.js (110 cards)

### Instants & Sorceries

**Aggressive Negotiations**
- reveal + exile + counter

**Auroral Procession**
- return from graveyard

**Bewildering Blizzard**
- draw 3 + debuff all

**Caustic Exhale**
- debuff -3/-3

**Channeled Dragonfire**
- 2 damage to any target

**Coordinated Maneuver**
- modal: damage or destroy enchantment

**Cruel Truths**
- surveil 2, draw 2, lose 2 life

**Death Begets Life**
- destroy all + draw X

**Defibrillating Current**
- 4 damage + gain 2 life

**Desperate Measures**
- buff +1/-1 + draw on death trigger

**Dispelling Exhale**
- counter spell

**Dragonclaw Strike**
- double power buff + optional fight

**Duty Beyond Death**
- sacrifice cost + indestructible + counters

**Focus the Mind**
- draw 3, discard 1 (loot)

**Frontline Rush**
- modal: tokens or buff X

**Glacial Dragonhunt**
- draw 1 + conditional 3 damage

**Heritage Reclamation**
- modal: destroy artifact/enchantment + exile GY/draw

**Kin-Tree Severance**
- exile permanent mv3+

**Knockout Maneuver**
- counter + fight

**Lie in Wait**
- return from GY + damage X

**Lightfoot Technique**
- +1/+1 counter + flying+indestructible

**Mammoth Bellow**
- create 5/5 Elephant

**Molten Exhale**
- 4 damage to creature

**Osseous Exhale**
- 5 damage to attacker/blocker + conditional life

**Overwhelming Surge**
- modal: 3 damage or destroy artifact

**Perennation**
- return permanent from GY with hexproof+indestructible

**Piercing Exhale**
- one-sided fight + conditional surveil

**Rally the Monastery**
- modal: tokens / buff all / destroy power 4+

**Rebellious Strike**
- buff +3/+0 + draw 1

**Rite of Renewal**
- return 2 permanents from GY to hand

**Riverwalk Technique**
- modal: bounce to library or counter noncreature

**Riverwheel Sweep**
- tap + stun 3 + exile top play

**Salt Road Skirmish**
- destroy + create haste warriors

### Creatures with ETB

**Abzan Monument**
- ETB ramp + activated sacrifice

**Ainok Wayfarer**
- ETB mill 3 + return land

**Arashin Sunshield**
- ETB exile GY + activated tap

**Armament Dragon**
- ETB distribute +1/+1 counters

**Constrictor Sage**
- ETB tap + stun counter

**Disruptive Stormbrood**
- ETB destroy artifact/enchantment

**Dragonologist**
- ETB look top 6

**Dusyut Earthcarver**
- ETB endure 3

**Equilibrium Adept**
- ETB exile top play

**Flamehold Grappler**
- first strike + ETB copy next spell

**Fortress Kin-Guard**
- ETB endure 1

**Kin-Tree Nurturer**
- lifelink + ETB endure 1

**Lasyd Prowler**
- ETB mill X (lands controlled)

**Lotuslight Dancers**
- lifelink + ETB search to GY

**Magmatic Hellkite**
- flying + ETB destroy nonbasic land

**Marang River Regent**
- flying + ETB bounce 2

**Mardu Siegebreaker**
- deathtouch+haste + ETB exile + attack copy

**Naga Fleshcrafter**
- ETB clone

**Nightblade Brigade**
- deathtouch + attack token + ETB surveil

**Reigning Victor**
- mobilize + ETB buff with indestructible

**Sandskitter Outrider**
- menace + ETB endure 2

**Shiko, Paragon of the Way**
- flying+vigilance + ETB exile GY cast

### Creatures with Triggers

**Adorned Crocodile**
- dies trigger + GY counter ability

**Aegis Sculptor**
- flying + ward + upkeep trigger

**Ambling Stormshell**
- ward + attacks trigger: stun self + draw 3

**Anafenza, Unyielding Lineage**
- other creature dies trigger

**Attuned Hunter**
- cards leave graveyard trigger

**Avenger of the Fallen**
- deathtouch + attack creates 2 warriors

**Bloomvine Regent**
- dragon enters trigger

**Bone-Cairn Butcher**
- attack tokens + grant deathtouch to tokens

**Boulderborn Dragon**
- attacks trigger: surveil 1

**Cori Mountain Stalwart**
- second spell trigger: damage + life

**Dalkovan Packbeasts**
- vigilance + attack creates 3 warriors

**Delta Bloodflies**
- conditional attacks trigger

**Descendant of Storms**
- attacks trigger: endure 1

**Devoted Duelist**
- haste + second spell trigger

**Dragonback Lancer**
- flying + attack creates 1 warrior

**Eshki Dragonclaw**
- vigilance+trample+ward + combat begin trigger

**Felothar, Dawn of the Abzan**
- enters or attacks trigger

**Furious Forebear**
- creature dies in GY trigger

**Host of the Hereafter**
- creature dies with counters

**Inspirited Vanguard**
- enters or attacks: endure 2

**Jeskai Devotee**
- second spell: buff self

**Jeskai Shrinekeeper**
- combat damage: gain life + draw

**Kheru Goldkeeper**
- cards leave GY: create Treasure

**Kishla Skimmer**
- card leaves GY once per turn: draw

**Kotis, the Fangkeeper**
- indestructible + combat damage trigger

**Marshal of the Lost**
- attacks: buff X

**Narset, Jeskai Waymaster**
- end step: discard hand + draw X

**Poised Practitioner**
- second spell: counter + scry

**Sarkhan, Dragon Ascendant**
- ETB behold + Treasure + dragon trigger

**Shock Brigade**
- menace + attack token (sacrifice at end step)

**Smile at Death**
- upkeep: return 2 creatures from GY

**Taigam, Master Opportunist**
- second spell: copy + exile with suspend

### Activated Abilities

**Abzan Devotee**
- mana ability + GY return

**Agent of Kotis**
- GY activated: +2 counters

**Bearer of Glory**
- first strike + activated buff all

**Krumar Initiate**
- activated endure X

### Enchantments & Sagas

**All-Out Assault**
- static buff all + deathtouch

**Awaken the Honored Dead**
- saga with 3 chapters

**Barrensteppe Siege**
- modal enchantment with Abzan/Mardu

**Call the Spirit Dragons**
- grant indestructible to dragons + upkeep counters

**Dracogenesis**
- cost reduction for dragon spells

### Equipment & Artifacts

**A-Cori-Steel Cutter**
- grant haste + second spell token

**Cori-Steel Cutter**
- grants power/trample/haste + second spell token

**Mox Jasper**
- conditional mana tap ability

### Planeswalkers

**Elspeth, Storm Slayer**
- token doubling + 3 loyalty abilities

### Rare/Mythic Creatures

**Betor, Kin to All**
- flying + end step draw (if toughness 10+)

**Clarion Conqueror**
- flying + prevent activated abilities

**Dragon Sniper**
- vigilance + reach + deathtouch

**Dragonback Assault**
- ETB 3 damage all + landfall dragon token

**Jeskai Revelation**
- 5 effects: bounce+damage+tokens+draw+life

**Neriv, Heart of the Storm**
- flying + double damage

**Qarsi Revenant**
- flying+deathtouch+lifelink + GY ability

**Rot-Curse Rakshasa**
- trample+decayed + GY activated

**Sage of the Skies**
- flying+lifelink + cast with another spell

**Stormscale Scion**
- flying + buff other dragons + storm

---

## Cards Tested in tdm-scenarios.spec.js (234 scenarios)

This file contains deep scenario tests for complex multi-ability cards. Key highlights:

### Multi-Zone Cards (ETB + Triggered + Static + Graveyard)

**Tersa Lightshatter**
- ETB: loot 2 (draw 2, discard 1)
- Attacks trigger (conditional): 7+ cards in GY → exile from GY
- Static: haste

**Thragtusk**
- ETB: gain 5 life
- Leaves battlefield: create 3/3 Beast token

**Reigning Victor**
- ETB: buff + indestructible
- Attacks: create Warrior token

**Reputable Merchant**
- ETB: +1/+1 counter
- Dies: put counter on another creature

**Eshki Dragonclaw**
- Static: vigilance, trample, ward
- Omen cast: ramp 2 forests
- Dragon enters: gain 3 life

**Bloomvine Regent**
- Omen: create Soldier token
- Combat begin: buff another creature

**Riling Dawnbreaker**
- Other creature dies: endure 2 (doesn't trigger on own death)

**Anafenza, Unyielding Lineage**
- Upkeep: surveil
- Activated (conditional): create Zombie Druid if card left GY this turn

### Equipment with Triggers

**Stormbeacon Blade**
- Grant: +3/+0
- Equipped attacks trigger (conditional): 3+ attackers → draw

**Herd Heirloom**
- Combat damage trigger (conditional): has combat_draw keyword
- Triggered: gain life + draw

### Static Buff Cards

**All-Out Assault**
- Static: buff all own creatures +1/+1 + deathtouch
- ETB: extra_combat

### Complex Modal Cards

**Mardu Siegebreaker**
- Static: deathtouch, haste
- ETB: exile opponent creature

**Lasyd Prowler**
- ETB: mill X (lands controlled)
- Graveyard activated: distribute +1/+1 counters

### Cost Reduction & Conditions

**Highspire Bell-Ringer**
- Second spell costs 1 less (cost reduction static)

**Token Doubling** (tested with Elspeth, Storm Slayer)
- Doubles create_token effects

### Effect Conditions Tested
- if_beheld_dragon
- control_creature_with_counter
- dealt_damage_this_turn
- seven_cards_in_gy
- cast_creature_and_noncreature
- 3+_attacking

### Trigger Conditions Tested
- seven_cards_in_gy
- cast_creature_and_noncreature
- 3+_attacking
- combat_draw keyword required
- control_creature_with_counter

### Sagas (Runtime)
- Awaken the Honored Dead (3 chapters)
- Revival of the Ancestors
- Roar of Endless Song
- Thunder of Unity
- Rediscover the Way

### Sieges (Modal Enchantments, Runtime)
- Frostcliff Siege (Jeskai/Temur modes)
- Glacierwood Siege (Temur/Sultai modes)
- Hollowmurk Siege (Sultai/Abzan modes)
- Windcrag Siege (Abzan/Mardu modes)
- Barrensteppe Siege (Mardu/Jeskai modes)

### Planeswalkers (Runtime)
- Elspeth, Storm Slayer (3 loyalty abilities + token doubling)
- Ugin, Eye of the Storms (2 loyalty abilities)
- Sarkhan, Dragon Ascendant (ETB behold + dragon trigger + 2 loyalty)
- Narset, Jeskai Waymaster (end step trigger)
- Taigam, Master Opportunist (second spell trigger)

### Legendary Creatures (Runtime)
- Kotis, the Fangkeeper (indestructible + combat damage trigger)
- Surrak, Elusive Hunter
- Teval, Arbiter of Virtue
- Felothar, Dawn of the Abzan
- Sidisi, Regent of the Mire
- Host of the Hereafter

### Special Mechanics Tested

**Graveyard Activation (Renew)**
- Agent of Kotis
- Sage of the Fang
- Adorned Crocodile
- Qarsi Revenant
- Abzan Devotee

**Modal Spells**
- Wail of War
- Heritage Reclamation (3 modes)
- Rally the Monastery (3 modes)
- Seize Opportunity
- Coordinated Maneuver
- Frontline Rush
- Overwhelming Surge
- Riverwalk Technique

**Second Spell Triggers**
- Poised Practitioner (counter + scry)
- Jeskai Devotee (buff self)
- Devoted Duelist
- Cori Mountain Stalwart (damage + life)
- Wayspeaker Bodyguard (tap opponent creature)

**Harmonize Mechanic**
- Multiple cards tested for harmonize cost detection and casting

---

## Cards Tested in tdm-all-cards.spec.js (244 cards)

This file validates that ALL TDM cards have correct database entries. Tests check:

1. **DB entry exists** in CardEffectsDB
2. **Effect structure** is valid (spell/ETB/triggered/activated/static arrays)
3. **Keywords** are present in static abilities
4. **Modal structure** for modal spells
5. **Saga chapters** numbered correctly
6. **Triggered zones** (battlefield/graveyard/cast)
7. **Harmonize costs** defined

### Additional Cards Only in All-Cards File

- Breaching Dragonstorm
- Corroding Dragonstorm
- Dirgur Island Dragon
- Dragonstorm Forecaster
- Dragonstorm Globe
- Dragonfire Blade
- Effortless Master
- Embermouth Sentinel
- Encroaching Dragonstorm
- Fire-Rim Form
- Fleeting Effigy
- Formation Breaker
- Fresh Start
- Gurmag Nightwatch
- Gurmag Rakshasa
- Hardened Tactician
- Hundred-Battle Veteran
- Iceridge Serpent
- Inevitable Defeat
- Jade-Cast Sentinel
- Jeskai Monument
- Karakyk Guardian
- Kishla Trawlers
- Krotiq Nestguard
- Loxodon Battle Priest
- Maelstrom of the Spirit Dragon
- Mardu Devotee
- Mardu Monument
- Meticulous Artisan
- Monastery Messenger
- New Way Forward
- Rainveil Rejuvenator
- Rescue Leopard
- Reverberating Summons
- Riling Dawnbreaker
- Ringing Strike Mastery
- Roiling Dragonstorm
- Runescale Stormbrood
- Sage of the Fang
- Sagu Pummeler
- Sagu Wildling
- Salt Road Packbeast
- Scavenger Regent
- Seize Opportunity
- Severance Priest
- Shocking Sharpshooter
- Sibsig Appraiser
- Sinkhole Surveyor
- Snakeskin Veil
- Snowmelt Stag
- Songcrafter Mage
- Spectral Denial
- Stadium Headliner
- Stalwart Successor
- Starry-Eyed Skyrider
- Static Snare
- Stillness in Motion
- Stormbeacon Blade
- Stormplain Detainment
- Stormshriek Feral
- Strategic Betrayal
- Sultai Devotee
- Sultai Monument
- Summit Intimidator
- Sunpearl Kirin
- Sunset Strikemaster
- Teeming Dragonstorm
- Temur Battlecrier
- Temur Devotee
- Temur Monument
- Temur Tawnyback
- The Sibsig Ceremony
- Thunder of Unity
- Trade Route Envoy
- Traveling Botanist
- Twin Bolt
- Twinmaw Stormbrood
- Unburied Earthcarver
- Underfoot Underdogs
- Undergrowth Leopard
- Unending Whisper
- United Battlefront
- Unrooted Ancestor
- Unsparing Boltcaster
- Ureni, the Song Unending
- Venerated Stormsinger
- Veteran Ice Climber
- Voice of Victory
- Wail of War
- Warden of the Grove
- Watcher of the Wayside
- Wayspeaker Bodyguard
- Whirlwing Stormbrood
- Wild Ride
- Wingblade Disciple
- Wingspan Stride
- Winternight Stories
- Worthy Cost
- Yathan Roadwatcher
- Yathan Tombguard

### Lands Tested

**Duals (Gain Life)**
- 10 dual lands with enters_tapped + gainLife 1

**Tri-Lands**
- 5 tri-lands with enters_tapped

**Utility Lands**
- Cori Mountain Monastery
- Dalkovan Encampment
- Great Arashin City
- Kishla Village
- Mistrise Village

**Other**
- Evolving Wilds

---

## Summary Statistics

- **Total unique TDM cards tested**: ~250+ cards
- **Cards with detailed ability tests** (tdm.spec.js): 110
- **Cards with scenario tests** (tdm-scenarios.spec.js): 234
- **Cards with DB validation** (tdm-all-cards.spec.js): 244

### Mechanics Coverage

✅ **Fully Tested**:
- ETB effects (40+ cards)
- Triggered abilities (50+ cards)
- Activated abilities (30+ cards)
- Static abilities (40+ cards)
- Modal spells (15+ cards)
- Sagas (5+ cards)
- Sieges (5+ cards)
- Planeswalkers (5 cards)
- Graveyard abilities (Renew) (10+ cards)
- Second spell triggers (Flurry) (10+ cards)
- Attack token creation (Mobilize) (10+ cards)
- Endure mechanic (10+ cards)
- Keywords (flying, deathtouch, ward, etc.)
- Harmonize mechanic (10+ cards)
- Behold mechanic (5+ cards)

✅ **Special Systems Tested**:
- Cost reduction
- Token doubling
- Effect conditions
- Trigger conditions
- Combat damage triggers
- Dies triggers
- Cards leaving graveyard triggers
- Equipment triggers
- Clone effects
- Extra combat
- Buff/debuff stacking
- Counter distribution
- Modal choose-one/choose-two

---

## Files Analyzed

1. `C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft\tests\cards\tdm.spec.js` (110 cards, 1957 lines)
2. `C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft\tests\cards\tdm-scenarios.spec.js` (234 scenarios, 6421 lines)
3. `C:\Users\lucas\OneDrive\Área de Trabalho\magic_draft\tests\cards\tdm-all-cards.spec.js` (244 cards, 5643 lines)

**Total test code**: 14,021 lines covering TDM cards
