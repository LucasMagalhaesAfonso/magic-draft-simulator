// Auto-generated CardEffectsDB entries for TDM (Tarkir: Dragonstorm)
// Generated: 2026-02-08
// Cards: 134 auto-generated, 137 need manual review
//
// To use: copy desired entries into js/data/card-effects.js
// inside the CardEffectsDB object.

// =================== AUTO-GENERATED (134) ===================

  "anafenza, unyielding lineage": {
    static: [{"type":"has_keyword","keywords":["Flash"]}]
  },

  "arashin sunshield": {
    activated: [{"cost":{"mana":"W","tap":true},"effects":[{"type":"tap","target":"creature"}],"text":"{w}, {t}: tap target creature."}]
  },

  "bearer of glory": {
    activated: [{"cost":{"mana":"4W","tap":false},"effects":[{"type":"buff_self","power":1,"toughness":1}],"text":"{4}{w}: creatures you control get +1/+1 until end of turn."}]
  },

  "dalkovan packbeasts": {
    static: [{"type":"has_keyword","keywords":["Vigilance"]}]
  },

  "dragonback lancer": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "duty beyond death": {
    cast: [{"type":"counter_all","counter":"+1/+1","amount":1}]
    additional_costs: [{"type":"sacrifice","target":"creature"}]
  },

  "lightfoot technique": {
    cast: [{"type":"counter","counter":"+1/+1","amount":1,"target":"creature"}]
  },

  "mardu devotee": {
    etb: [{"type":"scry","amount":2}]
    activated: [{"cost":{"mana":"1","tap":false},"effects":[{"type":"add_mana","color":"R"}],"text":"{1}: add {r}, {w}, or {b}. activate only once each turn."}]
  },

  "osseous exhale": {
    cast: [{"type":"gainLife","amount":2}]
    additional_costs: [{"type":"behold","subtype":"Dragon","optional":false,"alternateCost":0}]
  },

  "poised practitioner": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"counter_self","counter":"+1/+1","amount":1}]}]
  },

  "rebellious strike": {
    cast: [
      {"type":"draw","amount":1},
      {"type":"buff","power":3,"toughness":0,"target":"creature"}
    ]
  },

  "riling dawnbreaker // signaling roar": {
    static: [{"type":"has_keyword","keywords":["Flying","Vigilance"]}]
  },

  "sage of the skies": {
    static: [{"type":"has_keyword","keywords":["Flying","Lifelink"]}]
  },

  "starry-eyed skyrider": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "stormplain detainment": {
    etb: [{"type":"exile","target":"creature"}]
  },

  "sunpearl kirin": {
    static: [{"type":"has_keyword","keywords":["Flying","Flash"]}]
  },

  "teeming dragonstorm": {
    etb: [{"type":"create_token","count":2,"power":2,"toughness":2,"name":"Token"}]
  },

  "tempest hawk": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "aegis sculptor": {
    static: [{"type":"has_keyword","keywords":["Flying","Ward"]}]
  },

  "bewildering blizzard": {
    cast: [{"type":"draw","amount":3}]
  },

  "dirgur island dragon // skimming strike": {
    static: [{"type":"has_keyword","keywords":["Flying","Ward"]}]
  },

  "essence anchor": {
    triggered: [{"event":"upkeep","self":true,"effects":[{"type":"surveil","amount":1}]}]
    activated: [{"cost":{"mana":0,"tap":true},"effects":[{"type":"create_token","count":1,"power":2,"toughness":2,"name":"Token"}],"text":"{t}: create a 2/2 black zombie druid creature token. activate only during your turn and only if a card left your graveyard this turn."}]
  },

  "focus the mind": {
    cast: [{"type":"draw","amount":3}]
  },

  "fresh start": {
    aura: [{"type":"buff","power":-5,"toughness":0}]
    static: [{"type":"has_keyword","keywords":["Flash"]}]
  },

  "highspire bell-ringer": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "humbling elder": {
    static: [{"type":"has_keyword","keywords":["Flash"]}]
  },

  "iceridge serpent": {
    etb: [{"type":"bounce","target":"creature"}]
  },

  "marang river regent // coil and catch": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "roiling dragonstorm": {
    etb: [{"type":"draw","amount":2}]
  },

  "temur devotee": {
    activated: [{"cost":{"mana":"1","tap":false},"effects":[{"type":"add_mana","color":"G"}],"text":"{1}: add {g}, {u}, or {r}. activate only once each turn."}]
    static: [{"type":"has_keyword","keywords":["Defender"]}]
  },

  "wingblade disciple": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"create_token","count":1,"power":1,"toughness":1,"name":"Token"}]}]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "wingspan stride": {
    aura: [{"type":"buff","power":1,"toughness":1}]
  },

  "abzan devotee": {
    activated: [{"cost":{"mana":"1","tap":false},"effects":[{"type":"add_mana","color":"W"}],"text":"{1}: add {w}, {b}, or {g}. activate only once each turn."}]
  },

  "adorned crocodile": {
    triggered: [{"event":"dies","self":true,"effects":[{"type":"create_token","count":1,"power":2,"toughness":2,"name":"Token"}]}]
  },

  "alchemist's assistant": {
    static: [{"type":"has_keyword","keywords":["Lifelink"]}]
  },

  "avenger of the fallen": {
    static: [{"type":"has_keyword","keywords":["Deathtouch"]}]
  },

  "caustic exhale": {
    cast: [{"type":"buff","power":-3,"toughness":-3,"target":"creature"}]
    additional_costs: [{"type":"behold","subtype":"Dragon","optional":true,"alternateCost":1}]
  },

  "corroding dragonstorm": {
    etb: [
      {"type":"gainLife","amount":2},
      {"type":"loseLife","amount":2,"target":"opponent"}
    ]
  },

  "cruel truths": {
    cast: [
      {"type":"draw","amount":2},
      {"type":"surveil","amount":2}
    ]
  },

  "desperate measures": {
    cast: [
      {"type":"draw","amount":2},
      {"type":"buff","power":1,"toughness":-1,"target":"creature"}
    ]
  },

  "dragon's prey": {
    cast: [{"type":"destroy","target":"creature"}]
  },

  "feral deathgorger // dusk sight": {
    static: [{"type":"has_keyword","keywords":["Deathtouch","Flying"]}]
  },

  "kin-tree nurturer": {
    static: [{"type":"has_keyword","keywords":["Lifelink"]}]
  },

  "nightblade brigade": {
    etb: [{"type":"surveil","amount":1}]
    static: [{"type":"has_keyword","keywords":["Deathtouch"]}]
  },

  "qarsi revenant": {
    static: [{"type":"has_keyword","keywords":["Deathtouch","Flying","Lifelink"]}]
  },

  "rot-curse rakshasa": {
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "salt road skirmish": {
    cast: [
      {"type":"destroy","target":"creature"},
      {"type":"create_token","count":2,"power":1,"toughness":1,"name":"red warrior"}
    ]
  },

  "scavenger regent // exude toxin": {
    static: [{"type":"has_keyword","keywords":["Flying","Ward"]}]
  },

  "sinkhole surveyor": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "unrooted ancestor": {
    static: [{"type":"has_keyword","keywords":["Flash"]}]
  },

  "breaching dragonstorm": {
    etb: [{"type":"exile","target":"creature"}]
  },

  "cori-steel cutter": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"create_token","count":1,"power":1,"toughness":1,"name":"Token"}]}]
    equipment: [
      {"type":"buff","power":1,"toughness":1},
      {"type":"equip_cost","cost":1}
    ]
  },

  "devoted duelist": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"damage","amount":1,"target":"opponent"},{"type":"damage_each_opponent","amount":1}]}]
    static: [{"type":"has_keyword","keywords":["Haste"]}]
  },

  "fire-rim form": {
    aura: [
      {"type":"buff","power":2,"toughness":0},
      {"type":"grant_keyword","keyword":"First Strike"}
    ]
    static: [{"type":"has_keyword","keywords":["Flash"]}]
  },

  "fleeting effigy": {
    activated: [{"cost":{"mana":"2R","tap":false},"effects":[{"type":"buff_self","power":2,"toughness":0}],"text":"{2}{r}: this creature gets +2/+0 until end of turn."}]
    static: [{"type":"has_keyword","keywords":["Haste"]}]
  },

  "jeskai devotee": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"buff_self","power":1,"toughness":1}]}]
    activated: [{"cost":{"mana":"1","tap":false},"effects":[{"type":"add_mana","color":"U"}],"text":"{1}: add {u}, {r}, or {w}. activate only once each turn."}]
  },

  "sarkhan, dragon ascendant": {
    additional_costs: [{"type":"behold","subtype":"Dragon","optional":false,"alternateCost":0}]
  },

  "shocking sharpshooter": {
    static: [{"type":"has_keyword","keywords":["Reach"]}]
  },

  "stormshriek feral // flush out": {
    activated: [{"cost":{"mana":"1R","tap":false},"effects":[{"type":"buff_self","power":1,"toughness":0}],"text":"{1}{r}: this creature gets +1/+0 until end of turn."}]
    static: [{"type":"has_keyword","keywords":["Flying","Haste"]}]
  },

  "summit intimidator": {
    static: [{"type":"has_keyword","keywords":["Reach"]}]
  },

  "tersa lightshatter": {
    static: [{"type":"has_keyword","keywords":["Haste"]}]
  },

  "unsparing boltcaster": {
    etb: [{"type":"damage","amount":5,"target":"creature"}]
  },

  "attuned hunter": {
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "bloomvine regent // claim territory": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "champion of dusan": {
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "craterhoof behemoth": {
    static: [{"type":"has_keyword","keywords":["Haste"]}]
  },

  "dragon sniper": {
    static: [{"type":"has_keyword","keywords":["Reach","Vigilance","Deathtouch"]}]
  },

  "dusyut earthcarver": {
    static: [{"type":"has_keyword","keywords":["Reach"]}]
  },

  "herd heirloom": {
    triggered: [{"event":"combat_damage_player","self":true,"effects":[{"type":"draw","amount":1}]}]
    activated: [{"cost":{"mana":0,"tap":true},"effects":[{"type":"draw","amount":1}],"text":"{t}: until end of turn, target creature you control with power 4 or greater gains trample and \"whenever this creature deals combat damage to a player, draw a card.\""}]
  },

  "knockout maneuver": {
    cast: [{"type":"counter","counter":"+1/+1","amount":1,"target":"creature"}]
  },

  "krotiq nestguard": {
    static: [{"type":"has_keyword","keywords":["Defender"]}]
  },

  "sage of the fang": {
    etb: [{"type":"counter","counter":"+1/+1","amount":1,"target":"creature"}]
  },

  "sagu pummeler": {
    static: [{"type":"has_keyword","keywords":["Reach"]}]
  },

  "sagu wildling // roost seek": {
    etb: [{"type":"gainLife","amount":3}]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "snakeskin veil": {
    cast: [{"type":"counter","counter":"+1/+1","amount":1,"target":"creature"}]
  },

  "sultai devotee": {
    activated: [{"cost":{"mana":"1","tap":false},"effects":[{"type":"add_mana","color":"B"}],"text":"{1}: add {b}, {g}, or {u}. activate only once each turn."}]
    static: [{"type":"has_keyword","keywords":["Deathtouch"]}]
  },

  "surrak, elusive hunter": {
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "traveling botanist": {
    triggered: [{"event":"becomes_tapped","self":true,"effects":[{"type":"peek_top_land"}]}]
  },

  "undergrowth leopard": {
    static: [{"type":"has_keyword","keywords":["Vigilance"]}]
  },

  "warden of the grove": {
    triggered: [{"event":"end_step","self":true,"effects":[{"type":"counter_self","counter":"+1/+1","amount":1}]}]
  },

  "armament dragon": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "barrensteppe siege": {
    triggered: [{"event":"end_step","self":true,"effects":[{"type":"counter_self","counter":"+1/+1","amount":1}]}]
  },

  "betor, kin to all": {
    triggered: [{"event":"end_step","self":true,"effects":[{"type":"draw","amount":1}]}]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "cori mountain stalwart": {
    triggered: [{"event":"second_spell","self":true,"effects":[{"type":"gainLife","amount":2},{"type":"damage","amount":2,"target":"opponent"},{"type":"damage_each_opponent","amount":2}]}]
  },

  "disruptive stormbrood // petty revenge": {
    etb: [{"type":"destroy","target":"creature"}]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "eshki dragonclaw": {
    static: [{"type":"has_keyword","keywords":["Vigilance","Trample","Ward"]}]
  },

  "felothar, dawn of the abzan": {
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "inevitable defeat": {
    cast: [
      {"type":"exile","target":"creature"},
      {"type":"gainLife","amount":3},
      {"type":"loseLife","amount":3,"target":"opponent"},
      {"type":"gainLife","amount":3}
    ]
  },

  "jeskai revelation": {
    cast: [
      {"type":"damage","amount":4,"target":"any target"},
      {"type":"draw","amount":2},
      {"type":"gainLife","amount":4},
      {"type":"create_token","count":2,"power":1,"toughness":1,"name":"white monk"}
    ]
  },

  "jeskai shrinekeeper": {
    triggered: [{"event":"combat_damage_player","self":true,"effects":[{"type":"draw","amount":1},{"type":"gainLife","amount":1}]}]
    static: [{"type":"has_keyword","keywords":["Flying","Haste"]}]
  },

  "karakyk guardian": {
    static: [{"type":"has_keyword","keywords":["Flying","Vigilance","Trample"]}]
  },

  "kheru goldkeeper": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "kishla skimmer": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "kotis, the fangkeeper": {
    static: [{"type":"has_keyword","keywords":["Indestructible"]}]
  },

  "lotuslight dancers": {
    static: [{"type":"has_keyword","keywords":["Lifelink"]}]
  },

  "marshal of the lost": {
    static: [{"type":"has_keyword","keywords":["Deathtouch"]}]
  },

  "monastery messenger": {
    static: [{"type":"has_keyword","keywords":["Flying","Vigilance"]}]
  },

  "purging stormbrood // absorb essence": {
    static: [{"type":"has_keyword","keywords":["Flying","Ward"]}]
  },

  "reigning victor": {
    etb: [{"type":"buff","power":1,"toughness":0,"target":"creature"}]
  },

  "reputable merchant": {
    etb: [{"type":"counter","counter":"+1/+1","amount":1,"target":"creature"}]
  },

  "runescale stormbrood // chilling screech": {
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "severance priest": {
    static: [{"type":"has_keyword","keywords":["Deathtouch"]}]
  },

  "shiko, paragon of the way": {
    static: [{"type":"has_keyword","keywords":["Flying","Vigilance"]}]
  },

  "skirmish rhino": {
    etb: [
      {"type":"gainLife","amount":2},
      {"type":"loseLife","amount":2,"target":"opponent"}
    ]
    static: [{"type":"has_keyword","keywords":["Trample"]}]
  },

  "sonic shrieker": {
    etb: [
      {"type":"damage","amount":2,"target":"any target"},
      {"type":"gainLife","amount":2}
    ]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "temur tawnyback": {
    etb: [{"type":"draw","amount":1}]
  },

  "teval, arbiter of virtue": {
    static: [{"type":"has_keyword","keywords":["Flying","Lifelink"]}]
  },

  "twinmaw stormbrood // charring bite": {
    etb: [{"type":"gainLife","amount":5}]
    static: [{"type":"has_keyword","keywords":["Flying"]}]
  },

  "whirlwing stormbrood // dynamic soar": {
    static: [{"type":"has_keyword","keywords":["Flying","Flash"]}]
  },

  "windcrag siege": {
    triggered: [{"event":"upkeep","self":true,"effects":[{"type":"create_token","count":1,"power":1,"toughness":1,"name":"Token"}]}]
  },

  "boulderborn dragon": {
    triggered: [{"event":"attacks","self":true,"effects":[{"type":"surveil","amount":1}]}]
    static: [{"type":"has_keyword","keywords":["Flying","Vigilance"]}]
  },

  "jade-cast sentinel": {
    static: [{"type":"has_keyword","keywords":["Reach"]}]
  },


// =================== NEEDS MANUAL REVIEW (137) ===================
// These cards have oracle text patterns not fully recognized by parsers.

// "ugin, eye of the storms"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When you cast this spell, exile up to one target permanent that's one or more colors. Whenever you cast a colorless spel

// "clarion conqueror"
// Flags: planeswalker
// Oracle: Flying Activated abilities of artifacts, creatures, and planeswalkers can't be activated.
// Partial parse (may be incomplete):
//   "clarion conqueror": {
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "coordinated maneuver"
// Flags: modal (choose one), planeswalker, no effects parsed from non-trivial oracle text
// Oracle: Choose one — • Coordinated Maneuver deals damage equal to the number of creatures you control to target creature or plan

// "descendant of storms"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Whenever this creature attacks, you may pay {1}{W}. If you do, it endures 1. (Put a +1/+1 counter on it or create a 1/1 

// "elspeth, storm slayer"
// Flags: replacement effect, no effects parsed from non-trivial oracle text
// Oracle: If one or more tokens would be created under your control, twice that many of those tokens are created instead. +1: Crea

// "fortress kin-guard"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, it endures 1. (Put a +1/+1 counter on it or create a 1/1 white Spirit creature token.)

// "furious forebear"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Whenever a creature you control dies while this card is in your graveyard, you may pay {1}{W}. If you do, return this ca

// "loxodon battle priest"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: At the beginning of combat on your turn, put a +1/+1 counter on another target creature you control.

// "rally the monastery"
// Flags: modal (choose one)
// Oracle: This spell costs {2} less to cast if you've cast another spell this turn. Choose one — • Create two 1/1 white Monk creat
// Partial parse (may be incomplete):
//   "rally the monastery": {
//     cast: [
//       {"type":"destroy","target":"creature"},
//       {"type":"create_token","count":2,"power":1,"toughness":1,"name":"white monk"}
//     ]
//   }

// "salt road packbeast"
// Flags: dynamic amount (for each)
// Oracle: Affinity for creatures (This spell costs {1} less to cast for each creature you control.) When this creature enters, dra
// Partial parse (may be incomplete):
//   "salt road packbeast": {
//     etb: [{"type":"draw","amount":1}]
//   }

// "smile at death"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: At the beginning of your upkeep, return up to two target creature cards with power 2 or less from your graveyard to the 

// "static snare"
// Flags: dynamic amount (for each)
// Oracle: Flash This spell costs {1} less to cast for each attacking creature. When this enchantment enters, exile target artifact
// Partial parse (may be incomplete):
//   "static snare": {
//     etb: [{"type":"exile","target":"creature"}]
//     static: [{"type":"has_keyword","keywords":["Flash"]}]
//   }

// "stormbeacon blade"
// Flags: conditional (if you control)
// Oracle: Equipped creature gets +3/+0. Whenever equipped creature attacks, draw a card if you control three or more attacking cre
// Partial parse (may be incomplete):
//   "stormbeacon blade": {
//     triggered: [{"event":"attacks","self":true,"effects":[{"type":"draw","amount":1}]}]
//     equipment: [
//       {"type":"buff","power":3,"toughness":0},
//       {"type":"equip_cost","cost":2}
//     ]
//   }

// "united battlefront"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Look at the top seven cards of your library. Put up to two noncreature, nonland permanent cards with mana value 3 or les

// "voice of victory"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice t

// "wayspeaker bodyguard"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, return target nonland permanent card with mana value 2 or less from your graveyard to your ha

// "agent of kotis"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Renew — {3}{U}, Exile this card from your graveyard: Put two +1/+1 counters on target creature. Activate only as a sorce

// "ambling stormshell"
// Flags: replacement effect
// Oracle: Ward {2} Whenever this creature attacks, put three stun counters on it and draw three cards. (If a permanent with a stun
// Partial parse (may be incomplete):
//   "ambling stormshell": {
//     triggered: [{"event":"attacks","self":true,"effects":[{"type":"draw","amount":3}]}]
//     static: [{"type":"has_keyword","keywords":["Ward"]}]
//   }

// "constrictor sage"
// Flags: replacement effect
// Oracle: When this creature enters, tap target creature an opponent controls and put a stun counter on it. (If a permanent with a
// Partial parse (may be incomplete):
//   "constrictor sage": {
//     etb: [{"type":"tap","target":"creature"}]
//   }

// "dispelling exhale"
// Flags: replacement effect
// Oracle: As an additional cost to cast this spell, you may behold a Dragon. (You may choose a Dragon you control or reveal a Drag
// Partial parse (may be incomplete):
//   "dispelling exhale": {
//     additional_costs: [{"type":"behold","subtype":"Dragon","optional":false,"alternateCost":0}]
//   }

// "dragonologist"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, look at the top six cards of your library. You may reveal an instant, sorcery, or Dragon card

// "dragonstorm forecaster"
// Flags: storm, no effects parsed from non-trivial oracle text
// Oracle: {2}, {T}: Search your library for a card named Dragonstorm Globe or Boulderborn Dragon, reveal it, put it into your hand

// "kishla trawlers"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, you may exile a creature card from your graveyard. When you do, return target instant or sorc

// "naga fleshcrafter"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: You may have this creature enter as a copy of any creature on the battlefield. Renew — {2}{U}, Exile this card from your

// "ringing strike mastery"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Enchant creature When this Aura enters, tap enchanted creature. Enchanted creature doesn't untap during its controller's

// "riverwalk technique"
// Flags: modal (choose one), no effects parsed from non-trivial oracle text
// Oracle: Choose one — • The owner of target nonland permanent puts it on their choice of the top or bottom of their library. • Co

// "sibsig appraiser"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, look at the top two cards of your library. Put one of them into your hand and the other into 

// "snowmelt stag"
// Flags: evasion (can't be blocked)
// Oracle: Vigilance During your turn, this creature has base power and toughness 5/2. {5}{U}{U}: This creature can't be blocked th
// Partial parse (may be incomplete):
//   "snowmelt stag": {
//     static: [{"type":"has_keyword","keywords":["Vigilance"]}]
//   }

// "spectral denial"
// Flags: dynamic amount (for each), no effects parsed from non-trivial oracle text
// Oracle: This spell costs {1} less to cast for each creature you control with power 4 or greater. Counter target spell unless its

// "stillness in motion"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: At the beginning of your upkeep, mill three cards. Then if your library has no cards in it, exile this enchantment and p

// "taigam, master opportunist"
// Flags: suspend, no effects parsed from non-trivial oracle text
// Oracle: Flurry — Whenever you cast your second spell each turn, copy it, then exile the spell you cast with four time counters o

// "unending whisper"
// Flags: graveyard cast
// Oracle: Draw a card. Harmonize {5}{U} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature
// Partial parse (may be incomplete):
//   "unending whisper": {
//     cast: [{"type":"draw","amount":1}]
//     harmonize: "{5}{U}"
//   }

// "ureni's rebuff"
// Flags: graveyard cast
// Oracle: Return target creature to its owner's hand. Harmonize {5}{U} (You may cast this card from your graveyard for its harmoni
// Partial parse (may be incomplete):
//   "ureni's rebuff": {
//     cast: [{"type":"bounce","target":"creature"}]
//     harmonize: "{5}{U}"
//   }

// "veteran ice climber"
// Flags: evasion (can't be blocked)
// Oracle: Vigilance This creature can't be blocked. Whenever this creature attacks, up to one target player mills cards equal to t
// Partial parse (may be incomplete):
//   "veteran ice climber": {
//     static: [{"type":"has_keyword","keywords":["Vigilance"]}]
//   }

// "winternight stories"
// Flags: graveyard cast
// Oracle: Draw three cards. Then discard two cards unless you discard a creature card. Harmonize {4}{U} (You may cast this card fr
// Partial parse (may be incomplete):
//   "winternight stories": {
//     cast: [{"type":"draw","amount":3}]
//     harmonize: "{4}{U}"
//   }

// "aggressive negotiations"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Target opponent reveals their hand. You choose a nonland card from it and exile that card. Put a +1/+1 counter on up to 

// "alesha's legacy"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Target creature you control gains deathtouch and indestructible until end of turn. (Damage and effects that say "destroy

// "delta bloodflies"
// Flags: conditional (if you control)
// Oracle: Flying Whenever this creature attacks, if you control a creature with a counter on it, each opponent loses 1 life.
// Partial parse (may be incomplete):
//   "delta bloodflies": {
//     triggered: [{"event":"attacks","self":true,"effects":[{"type":"loseLife","amount":1,"target":"opponent"},{"type":"loseLife","amount":1,"target":"opponent"}]}]
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "gurmag rakshasa"
// Flags: evasion (can't be blocked)
// Oracle: Menace (This creature can't be blocked except by two or more creatures.) When this creature enters, target creature an o
// Partial parse (may be incomplete):
//   "gurmag rakshasa": {
//     static: [{"type":"has_keyword","keywords":["Menace"]}]
//   }

// "hundred-battle veteran"
// Flags: replacement effect, graveyard cast, conditional static, no effects parsed from non-trivial oracle text
// Oracle: As long as there are three or more different kinds of counters among creatures you control, this creature gets +2/+4. Yo

// "krumar initiate"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {X}{B}, {T}, Pay X life: This creature endures X. Activate only as a sorcery. (Put X +1/+1 counters on it or create an X

// "sandskitter outrider"
// Flags: evasion (can't be blocked)
// Oracle: Menace (This creature can't be blocked except by two or more creatures.) When this creature enters, it endures 2. (Put t
// Partial parse (may be incomplete):
//   "sandskitter outrider": {
//     static: [{"type":"has_keyword","keywords":["Menace"]}]
//   }

// "the sibsig ceremony"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Creature spells you cast cost {2} less to cast. Whenever a creature you control enters, if you cast it, destroy that cre

// "sidisi, regent of the mire"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {T}, Sacrifice a creature you control with mana value X other than Sidisi: Return target creature card with mana value X

// "strategic betrayal"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Target opponent exiles a creature they control and their graveyard.

// "unburied earthcarver"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {2}, Sacrifice another creature: Put a +1/+1 counter on this creature.

// "venerated stormsinger"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it a

// "wail of war"
// Flags: modal (choose one), no effects parsed from non-trivial oracle text
// Oracle: Choose one — • Creatures target opponent controls get -1/-1 until end of turn. • Return up to two target creature cards 

// "worthy cost"
// Flags: planeswalker
// Oracle: As an additional cost to cast this spell, sacrifice a creature. Exile target creature or planeswalker.
// Partial parse (may be incomplete):
//   "worthy cost": {
//     cast: [{"type":"exile","target":"creature"}]
//     additional_costs: [{"type":"sacrifice","target":"creature"}]
//   }

// "yathan tombguard"
// Flags: evasion (can't be blocked)
// Oracle: Menace (This creature can't be blocked except by two or more creatures.) Whenever a creature you control with a counter 
// Partial parse (may be incomplete):
//   "yathan tombguard": {
//     static: [{"type":"has_keyword","keywords":["Menace"]}]
//   }

// "channeled dragonfire"
// Flags: graveyard cast
// Oracle: Channeled Dragonfire deals 2 damage to any target. Harmonize {5}{R}{R} (You may cast this card from your graveyard for i
// Partial parse (may be incomplete):
//   "channeled dragonfire": {
//     cast: [{"type":"damage","amount":2,"target":"any target"}]
//     harmonize: "{5}{R}{R}"
//   }

// "dracogenesis"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: You may cast Dragon spells without paying their mana costs.

// "equilibrium adept"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, exile the top card of your library. Until the end of your next turn, you may play that card. 

// "iridescent tiger"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, if you cast it, add {W}{U}{B}{R}{G}.

// "magmatic hellkite"
// Flags: replacement effect
// Oracle: Flying When this creature enters, destroy target nonbasic land an opponent controls. Its controller searches their libra
// Partial parse (may be incomplete):
//   "magmatic hellkite": {
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "meticulous artisan"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.) When this creature enters, 

// "molten exhale"
// Flags: planeswalker
// Oracle: You may cast this spell as though it had flash if you behold a Dragon as an additional cost to cast it. (To behold a Dra
// Partial parse (may be incomplete):
//   "molten exhale": {
//     cast: [{"type":"damage","amount":4,"target":"creature"}]
//     additional_costs: [{"type":"behold","subtype":"Dragon","optional":false,"alternateCost":0}]
//   }

// "narset's rebuke"
// Flags: replacement effect
// Oracle: Narset's Rebuke deals 5 damage to target creature. Add {U}{R}{W}. If that creature would die this turn, exile it instead
// Partial parse (may be incomplete):
//   "narset's rebuke": {
//     cast: [{"type":"damage","amount":5,"target":"creature"}]
//   }

// "overwhelming surge"
// Flags: modal (choose one)
// Oracle: Choose one or both — • Overwhelming Surge deals 3 damage to target creature. • Destroy target noncreature artifact.
// Partial parse (may be incomplete):
//   "overwhelming surge": {
//     cast: [{"type":"damage","amount":3,"target":"creature"}]
//   }

// "rescue leopard"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Whenever this creature becomes tapped, you may discard a card. If you do, draw a card.

// "reverberating summons"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: At the beginning of each combat, if you've cast two or more spells this turn, this enchantment becomes a 3/3 Monk creatu

// "seize opportunity"
// Flags: modal (choose one), no effects parsed from non-trivial oracle text
// Oracle: Choose one — • Exile the top two cards of your library. Until the end of your next turn, you may play those cards. • Up 

// "shock brigade"
// Flags: evasion (can't be blocked)
// Oracle: Menace (This creature can't be blocked except by two or more creatures.) Mobilize 1 (Whenever this creature attacks, cre
// Partial parse (may be incomplete):
//   "shock brigade": {
//     static: [{"type":"has_keyword","keywords":["Menace"]}]
//   }

// "stadium headliner"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it a

// "stormscale scion"
// Flags: dynamic amount (for each), storm
// Oracle: Flying Other Dragons you control get +1/+1. Storm (When you cast this spell, copy it for each spell cast before it this 
// Partial parse (may be incomplete):
//   "stormscale scion": {
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "sunset strikemaster"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {T}: Add {R}. {2}{R}, {T}, Sacrifice this creature: It deals 6 damage to target creature with flying.

// "twin bolt"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Twin Bolt deals 2 damage divided as you choose among one or two targets.

// "underfoot underdogs"
// Flags: evasion (can't be blocked)
// Oracle: When this creature enters, create a 1/1 red Goblin creature token. {1}, {T}: Target creature you control with power 2 or
// Partial parse (may be incomplete):
//   "underfoot underdogs": {
//     etb: [{"type":"create_token","count":1,"power":1,"toughness":1,"name":"Token"}]
//   }

// "war effort"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Creatures you control get +1/+0. Whenever you attack, create a 1/1 red Warrior creature token that's tapped and attackin

// "wild ride"
// Flags: graveyard cast
// Oracle: Target creature gets +3/+0 and gains haste until end of turn. Harmonize {4}{R} (You may cast this card from your graveya
// Partial parse (may be incomplete):
//   "wild ride": {
//     cast: [{"type":"buff","power":3,"toughness":0,"target":"creature"}]
//     harmonize: "{4}{R}"
//   }

// "zurgo's vanguard"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 1 (Whenever this creature attacks, create a tapped and attacking 1/1 red Warrior creature token. Sacrifice it a

// "ainok wayfarer"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, mill three cards. You may put a land card from among them into your hand. If you don't, put a

// "dragonbroods' relic"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {T}, Tap an untapped creature you control: Add one mana of any color. {3}{W}{U}{B}{R}{G}, Sacrifice this artifact: Creat

// "encroaching dragonstorm"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this enchantment enters, search your library for up to two basic land cards, put them onto the battlefield tapped, 

// "formation breaker"
// Flags: conditional static, no effects parsed from non-trivial oracle text
// Oracle: Creatures with power less than this creature's power can't block it. As long as you control a creature with a counter on

// "heritage reclamation"
// Flags: modal (choose one)
// Oracle: Choose one — • Destroy target artifact. • Destroy target enchantment. • Exile up to one target card from a graveyard. Dr
// Partial parse (may be incomplete):
//   "heritage reclamation": {
//     cast: [{"type":"draw","amount":1}]
//   }

// "inspirited vanguard"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Whenever this creature enters or attacks, it endures 2. (Put two +1/+1 counters on it or create a 2/2 white Spirit creat

// "lasyd prowler"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, you may mill cards equal to the number of lands you control. Renew — {1}{G}, Exile this card 

// "nature's rhythm"
// Flags: graveyard cast
// Oracle: Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle. Harmonize 
// Partial parse (may be incomplete):
//   "nature's rhythm": {
//     harmonize: "{X}{G}{G}{G}{G}"
//   }

// "piercing exhale"
// Flags: planeswalker
// Oracle: As an additional cost to cast this spell, you may behold a Dragon. (You may choose a Dragon you control or reveal a Drag
// Partial parse (may be incomplete):
//   "piercing exhale": {
//     cast: [{"type":"surveil","amount":2}]
//     additional_costs: [{"type":"behold","subtype":"Dragon","optional":false,"alternateCost":0}]
//   }

// "rainveil rejuvenator"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, you may mill three cards. (You may put the top three cards of your library into your graveyar

// "rite of renewal"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Return up to two target permanent cards from your graveyard to your hand. Target player shuffles up to four target cards

// "roamer's routine"
// Flags: graveyard cast
// Oracle: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Harmonize {4}{G} (You may c
// Partial parse (may be incomplete):
//   "roamer's routine": {
//     cast: [{"type":"ramp","landType":"basic","tapped":true}]
//     harmonize: "{4}{G}"
//   }

// "sarkhan's resolve"
// Flags: modal (choose one)
// Oracle: Choose one — • Target creature gets +3/+3 until end of turn. • Destroy target creature with flying.
// Partial parse (may be incomplete):
//   "sarkhan's resolve": {
//     cast: [
//       {"type":"destroy","target":"creature"},
//       {"type":"buff","power":3,"toughness":3,"target":"creature"}
//     ]
//   }

// "synchronized charge"
// Flags: graveyard cast
// Oracle: Distribute two +1/+1 counters among one or two target creatures you control. Creatures you control with counters on them
// Partial parse (may be incomplete):
//   "synchronized charge": {
//     harmonize: "{4}{G}"
//   }

// "trade route envoy"
// Flags: conditional (if you control)
// Oracle: When this creature enters, draw a card if you control a creature with a counter on it. If you don't draw a card this way
// Partial parse (may be incomplete):
//   "trade route envoy": {
//     etb: [{"type":"draw","amount":1}]
//   }

// "all-out assault"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Creatures you control get +1/+1 and have deathtouch. When this enchantment enters, if it's your main phase, there is an 

// "auroral procession"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Return target card from your graveyard to your hand.

// "awaken the honored dead"
// Flags: saga (chapters need manual review), no effects parsed from non-trivial oracle text
// Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.) I — Destroy target nonland perm

// "bone-cairn butcher"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice t

// "call the spirit dragons"
// Flags: dynamic amount (for each)
// Oracle: Dragons you control have indestructible. At the beginning of your upkeep, for each color, put a +1/+1 counter on a Drago
// Partial parse (may be incomplete):
//   "call the spirit dragons": {
//     triggered: [{"event":"upkeep","self":true,"effects":[{"type":"counter_self","counter":"+1/+1","amount":1}]}]
//   }

// "death begets life"
// Flags: dynamic amount (for each)
// Oracle: Destroy all creatures and enchantments. Draw a card for each permanent destroyed this way.
// Partial parse (may be incomplete):
//   "death begets life": {
//     cast: [
//       {"type":"destroy_all","target":"creatures"},
//       {"type":"draw","amount":1}
//     ]
//   }

// "defibrillating current"
// Flags: planeswalker
// Oracle: Defibrillating Current deals 4 damage to target creature or planeswalker and you gain 2 life.
// Partial parse (may be incomplete):
//   "defibrillating current": {
//     cast: [
//       {"type":"damage","amount":4,"target":"creature"},
//       {"type":"gainLife","amount":2}
//     ]
//   }

// "dragonback assault"
// Flags: planeswalker
// Oracle: When this enchantment enters, it deals 3 damage to each creature and each planeswalker. Landfall — Whenever a land you c
// Partial parse (may be incomplete):
//   "dragonback assault": {
//     etb: [
//       {"type":"damage","amount":3,"target":"any target"},
//       {"type":"create_token","count":1,"power":4,"toughness":4,"name":"Token"}
//     ]
//   }

// "dragonclaw strike"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Double the power and toughness of target creature you control until end of turn. Then it fights up to one target creatur

// "effortless master"
// Flags: evasion (can't be blocked)
// Oracle: Vigilance Menace (This creature can't be blocked except by two or more creatures.) This creature enters with two +1/+1 c
// Partial parse (may be incomplete):
//   "effortless master": {
//     static: [{"type":"has_keyword","keywords":["Vigilance","Menace"]}]
//   }

// "fangkeeper's familiar"
// Flags: modal (choose one)
// Oracle: Flash When this creature enters, choose one — • You gain 3 life and surveil 3. (Look at the top three cards of your libr
// Partial parse (may be incomplete):
//   "fangkeeper's familiar": {
//     etb: [
//       {"type":"gainLife","amount":3},
//       {"type":"surveil","amount":3}
//     ]
//     static: [{"type":"has_keyword","keywords":["Flash"]}]
//   }

// "flamehold grappler"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: First strike When this creature enters, copy the next spell you cast this turn when you cast it. You may choose new targ

// "frontline rush"
// Flags: modal (choose one)
// Oracle: Choose one — • Create two 1/1 red Goblin creature tokens. • Target creature gets +X/+X until end of turn, where X is the
// Partial parse (may be incomplete):
//   "frontline rush": {
//     cast: [{"type":"create_token","count":2,"power":1,"toughness":1,"name":"red goblin"}]
//   }

// "frostcliff siege"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: As this enchantment enters, choose Jeskai or Temur. • Jeskai — Whenever one or more creatures you control deal combat da

// "glacial dragonhunt"
// Flags: graveyard cast
// Oracle: Draw a card, then you may discard a card. When you discard a nonland card this way, Glacial Dragonhunt deals 3 damage to
// Partial parse (may be incomplete):
//   "glacial dragonhunt": {
//     cast: [
//       {"type":"damage","amount":3,"target":"creature"},
//       {"type":"draw","amount":1}
//     ]
//     harmonize: "{4}{U}{R}"
//   }

// "glacierwood siege"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: As this enchantment enters, choose Temur or Sultai. • Temur — Whenever you cast an instant or sorcery spell, target play

// "gurmag nightwatch"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, look at the top three cards of your library. You may put one of those cards back on top of yo

// "hardened tactician"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: {1}, Sacrifice a token: Draw a card.

// "hollowmurk siege"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: As this enchantment enters, choose Sultai or Abzan. • Sultai — Whenever a counter is put on a creature you control, draw

// "host of the hereafter"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: This creature enters with two +1/+1 counters on it. Whenever this creature or another creature you control dies, if it h

// "jeskai brushmaster"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Double strike Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)

// "kin-tree severance"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Exile target permanent with mana value 3 or greater.

// "lie in wait"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Return target creature card from your graveyard to your hand. Lie in Wait deals damage equal to that card's power to tar

// "mammoth bellow"
// Flags: graveyard cast
// Oracle: Create a 5/5 green Elephant creature token. Harmonize {5}{G}{U}{R} (You may cast this card from your graveyard for its h
// Partial parse (may be incomplete):
//   "mammoth bellow": {
//     cast: [{"type":"create_token","count":1,"power":5,"toughness":5,"name":"green elephant"}]
//     harmonize: "{5}{G}{U}{R}"
//   }

// "mardu siegebreaker"
// Flags: dynamic amount (for each)
// Oracle: Deathtouch, haste When this creature enters, exile up to one other target creature you control until this creature leave
// Partial parse (may be incomplete):
//   "mardu siegebreaker": {
//     static: [{"type":"has_keyword","keywords":["Haste","Deathtouch"]}]
//   }

// "narset, jeskai waymaster"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: At the beginning of your end step, you may discard your hand. If you do, draw cards equal to the number of spells you've

// "neriv, heart of the storm"
// Flags: replacement effect
// Oracle: Flying If a creature you control that entered this turn would deal damage, it deals twice that much damage instead.
// Partial parse (may be incomplete):
//   "neriv, heart of the storm": {
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "new way forward"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: The next time a source of your choice would deal damage to you this turn, prevent that damage. When damage is prevented 

// "perennation"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Return target permanent card from your graveyard to the battlefield with a hexproof counter and an indestructible counte

// "rakshasa's bargain"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Look at the top four cards of your library. Put two of them into your hand and the rest into your graveyard.

// "rediscover the way"
// Flags: saga (chapters need manual review), no effects parsed from non-trivial oracle text
// Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.) I, II — Look at the top three c

// "revival of the ancestors"
// Flags: saga (chapters need manual review), no effects parsed from non-trivial oracle text
// Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.) I — Create three 1/1 white Spir

// "riverwheel sweep"
// Flags: modal (choose one), replacement effect
// Oracle: Tap target creature. Put three stun counters on it. (If a permanent with a stun counter would become untapped, remove on
// Partial parse (may be incomplete):
//   "riverwheel sweep": {
//     cast: [{"type":"tap","target":"creature"}]
//   }

// "roar of endless song"
// Flags: saga (chapters need manual review), no effects parsed from non-trivial oracle text
// Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.) I, II — Create a 5/5 green Elep

// "songcrafter mage"
// Flags: graveyard cast
// Oracle: Flash When this creature enters, target instant or sorcery card in your graveyard gains harmonize until end of turn. Its
// Partial parse (may be incomplete):
//   "songcrafter mage": {
//     static: [{"type":"has_keyword","keywords":["Flash"]}]
//   }

// "stalwart successor"
// Flags: evasion (can't be blocked)
// Oracle: Menace (This creature can't be blocked except by two or more creatures.) Whenever one or more counters are put on a crea
// Partial parse (may be incomplete):
//   "stalwart successor": {
//     static: [{"type":"has_keyword","keywords":["Menace"]}]
//   }

// "temur battlecrier"
// Flags: dynamic amount (for each), no effects parsed from non-trivial oracle text
// Oracle: During your turn, spells you cast cost {1} less to cast for each creature you control with power 4 or greater.

// "thunder of unity"
// Flags: saga (chapters need manual review), no effects parsed from non-trivial oracle text
// Oracle: (As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.) I — You draw two cards and you 

// "ureni, the song unending"
// Flags: protection, planeswalker
// Oracle: Flying, protection from white and from black When Ureni enters, it deals X damage divided as you choose among any number
// Partial parse (may be incomplete):
//   "ureni, the song unending": {
//     static: [{"type":"has_keyword","keywords":["Flying"]}]
//   }

// "yathan roadwatcher"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, if you cast it, mill four cards. When you do, return target creature card with mana value 3 o

// "zurgo, thunder's decree"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Mobilize 2 (Whenever this creature attacks, create two tapped and attacking 1/1 red Warrior creature tokens. Sacrifice t

// "abzan monument"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this artifact enters, search your library for a basic Plains, Swamp, or Forest card, reveal it, put it into your ha

// "dragonfire blade"
// Flags: dynamic amount (for each)
// Oracle: Equipped creature gets +2/+2 and has hexproof from monocolored. Equip {4}. This ability costs {1} less to activate for e
// Partial parse (may be incomplete):
//   "dragonfire blade": {
//     equipment: [
//       {"type":"buff","power":2,"toughness":2},
//       {"type":"equip_cost","cost":4}
//     ]
//   }

// "dragonstorm globe"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: Each Dragon you control enters with an additional +1/+1 counter on it. {T}: Add one mana of any color.

// "embermouth sentinel"
// Flags: replacement effect, conditional (if you control)
// Oracle: When this creature enters, you may search your library for a basic land card, reveal it, then shuffle and put that card 
// Partial parse (may be incomplete):
//   "embermouth sentinel": {
//     etb: [{"type":"ramp","landType":"basic","tapped":true}]
//   }

// "jeskai monument"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this artifact enters, search your library for a basic Island, Mountain, or Plains card, reveal it, put it into your

// "mardu monument"
// Flags: evasion (can't be blocked), no effects parsed from non-trivial oracle text
// Oracle: When this artifact enters, search your library for a basic Mountain, Plains, or Swamp card, reveal it, put it into your 

// "mox jasper"
// Flags: conditional (if you control), no effects parsed from non-trivial oracle text
// Oracle: {T}: Add one mana of any color. Activate only if you control a Dragon.

// "sultai monument"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this artifact enters, search your library for a basic Swamp, Forest, or Island card, reveal it, put it into your ha

// "temur monument"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this artifact enters, search your library for a basic Forest, Island, or Mountain card, reveal it, put it into your

// "watcher of the wayside"
// Flags: no effects parsed from non-trivial oracle text
// Oracle: When this creature enters, target player mills two cards. You gain 2 life. (To mill two cards, a player puts the top two

