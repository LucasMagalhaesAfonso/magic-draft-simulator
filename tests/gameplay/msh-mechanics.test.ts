// MSH Mechanics — Sadistic Slash (Mayhem) + Cruel Alliance (Teamwork)
// Each test uses TestGame for direct engine-level assertions.

import { describe, it, expect } from 'vitest';
import { TestGame } from '../helpers/game-helper';
import * as GameState from '../../src/engine/game-state';

// ═══════════════════════════════════════════════════════════════════════
// 1. Sadistic Slash — debuff -5/-5
// ═══════════════════════════════════════════════════════════════════════

describe('Sadistic Slash > debuff', () => {
  it('deals -5/-5 to target creature when cast from hand', () => {
    const g = new TestGame();

    // Opponent has a 6/6 creature
    const target = g.addToBattlefield(1, {
      name: 'Big Bear',
      type_line: 'Creature — Bear',
      power: '6',
      toughness: '6',
      cmc: 5,
    });

    // Cast Sadistic Slash from hand for {3}{B}
    const { result, card } = g.castFromHand(0, {
      name: 'Sadistic Slash',
      type_line: 'Instant',
      mana_cost: '{3}{B}',
      cmc: 4,
      colors: ['B'],
    }, [{ uid: target._uid, player: 1 }]);

    expect(result.success, `castSpell failed: ${result.msg}`).toBe(true);

    // Debuff is applied as _tempPowerMod / _tempToughnessMod
    const bf = g.battlefield(1);
    const bear = bf.find((c: any) => c.name === 'Big Bear');
    // If bear died (<=0 toughness), it leaves the BF — check GY instead
    if (bear) {
      const eff = (bear._tempPowerMod || 0) + (bear._tempToughnessMod || 0);
      expect(eff, 'debuff mods should be -10 total (-5/-5)').toBe(-10);
    } else {
      const gy = g.graveyard(1);
      expect(gy.some((c: any) => c.name === 'Big Bear'), 'Bear should be dead (went to GY)').toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Sadistic Slash — Mayhem: cast from GY if discarded this turn
// ═══════════════════════════════════════════════════════════════════════

describe('Sadistic Slash > Mayhem', () => {
  it('can be cast from graveyard via Mayhem if discarded this turn', () => {
    const g = new TestGame();

    // Put Sadistic Slash in GY, mark discarded this turn
    const slashDef = {
      name: 'Sadistic Slash',
      type_line: 'Instant',
      mana_cost: '{3}{B}',
      cmc: 4,
      colors: ['B'],
    };
    const gyCard = g.addToGraveyard(0, slashDef);
    gyCard._discardedOnTurn = g.state.turn;

    // Opponent has a creature to target
    const target = g.addToBattlefield(1, {
      name: 'Goblin',
      type_line: 'Creature — Goblin',
      power: '2',
      toughness: '2',
      cmc: 1,
    });

    // Set mana for mayhem cost {1}{B}
    g.setMana(0, { C: 1, B: 1 });

    // Cast from GY by uid
    const result = g.cast(0, gyCard._uid, [{ uid: target._uid, player: 1 }]);

    expect(result.success, `Mayhem cast failed: ${result.msg}`).toBe(true);

    // Card should be gone from GY (it was cast)
    const gy = g.graveyard(0);
    expect(gy.some((c: any) => c.name === 'Sadistic Slash'), 'Sadistic Slash should have left GY').toBe(false);

    // Goblin took damage / debuff
    const bf = g.battlefield(1);
    const goblin = bf.find((c: any) => c.name === 'Goblin');
    if (goblin) {
      const netToughness = 2 + (goblin._tempToughnessMod || 0);
      expect(netToughness, 'Goblin toughness should be -3 after -5/-5').toBeLessThanOrEqual(0);
    } else {
      const gy1 = g.graveyard(1);
      expect(gy1.some((c: any) => c.name === 'Goblin'), 'Goblin should have died').toBe(true);
    }
  });

  it('CANNOT be cast from graveyard via Mayhem if NOT discarded this turn', () => {
    const g = new TestGame();

    // Put Sadistic Slash in GY WITHOUT marking discarded this turn
    const slashDef = {
      name: 'Sadistic Slash',
      type_line: 'Instant',
      mana_cost: '{3}{B}',
      cmc: 4,
      colors: ['B'],
    };
    const gyCard = g.addToGraveyard(0, slashDef);
    // Intentionally NOT setting _discardedOnTurn

    const target = g.addToBattlefield(1, {
      name: 'Goblin',
      type_line: 'Creature — Goblin',
      power: '2',
      toughness: '2',
      cmc: 1,
    });

    g.setMana(0, { C: 1, B: 1 });

    const result = g.cast(0, gyCard._uid, [{ uid: target._uid, player: 1 }]);

    // Should fail — card not in hand and Mayhem not valid
    expect(result.success, 'Should NOT allow cast from GY without discard this turn').toBe(false);

    // Card should still be in GY
    const gy = g.graveyard(0);
    expect(gy.some((c: any) => c.name === 'Sadistic Slash'), 'Sadistic Slash should remain in GY').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Cruel Alliance — exile MV≤3 without teamwork
// ═══════════════════════════════════════════════════════════════════════

describe('Cruel Alliance > no teamwork', () => {
  it('exiles opponent creature with MV ≤ 3', () => {
    const g = new TestGame();

    const smallCreature = g.addToBattlefield(1, {
      name: 'Tiny Spider',
      type_line: 'Creature — Spider',
      power: '1',
      toughness: '2',
      cmc: 2, // MV = 2 ≤ 3
    });

    // No untapped creatures for player 0 (teamwork not available)
    const { result } = g.castFromHand(0, {
      name: 'Cruel Alliance',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      cmc: 3,
      colors: ['B'],
    });

    expect(result.success, `castSpell failed: ${result.msg}`).toBe(true);

    // MV≤3 creature should be exiled
    const bf = g.battlefield(1);
    expect(bf.some((c: any) => c.name === 'Tiny Spider'), 'Tiny Spider should be exiled (not on BF)').toBe(false);

    const exile = g.state.players[1].zones.exile.cards;
    expect(exile.some((c: any) => c.name === 'Tiny Spider'), 'Tiny Spider should be in exile').toBe(true);
  });

  it('CANNOT exile MV > 3 creature without teamwork', () => {
    const g = new TestGame();

    const bigCreature = g.addToBattlefield(1, {
      name: 'Big Dragon',
      type_line: 'Creature — Dragon',
      power: '5',
      toughness: '5',
      cmc: 6, // MV = 6 > 3
    });

    // No untapped creatures for player 0 (teamwork not available)
    const { result } = g.castFromHand(0, {
      name: 'Cruel Alliance',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      cmc: 3,
      colors: ['B'],
    });

    expect(result.success, `castSpell returned error: ${result.msg}`).toBe(true);

    // MV>3 creature should NOT be exiled (no valid targets)
    const bf = g.battlefield(1);
    expect(bf.some((c: any) => c.name === 'Big Dragon'), 'Big Dragon should still be on BF (no valid exile target)').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Cruel Alliance — exile any + gain 3 life WITH teamwork
// ═══════════════════════════════════════════════════════════════════════

describe('Cruel Alliance > with teamwork', () => {
  it('exiles any creature and gains 3 life when teamwork is paid', () => {
    const g = new TestGame();

    // Player 0 has a 3/3 untapped creature to pay teamwork (power >= 2)
    const ally = g.addToBattlefield(0, {
      name: 'Powerful Ally',
      type_line: 'Creature — Human',
      power: '3',
      toughness: '3',
      cmc: 2,
    });
    ally._tapped = false;

    // Opponent has a MV=6 creature that would be INELIGIBLE without teamwork
    const bigCreature = g.addToBattlefield(1, {
      name: 'Big Dragon',
      type_line: 'Creature — Dragon',
      power: '5',
      toughness: '5',
      cmc: 6,
    });

    const lifeBefore = g.life(0);

    const { result } = g.castFromHand(0, {
      name: 'Cruel Alliance',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      cmc: 3,
      colors: ['B'],
    });

    expect(result.success, `castSpell failed: ${result.msg}`).toBe(true);

    // Teamwork should have been paid (Powerful Ally gets tapped)
    const allyOnBf = g.battlefield(0).find((c: any) => c.name === 'Powerful Ally');
    expect(allyOnBf?._tapped, 'Powerful Ally should be tapped (teamwork cost paid)').toBe(true);

    // Big Dragon should be exiled (teamwork unlocks all targets)
    const bf = g.battlefield(1);
    expect(bf.some((c: any) => c.name === 'Big Dragon'), 'Big Dragon should be exiled').toBe(false);

    const exile = g.state.players[1].zones.exile.cards;
    expect(exile.some((c: any) => c.name === 'Big Dragon'), 'Big Dragon should be in exile zone').toBe(true);

    // Gain 3 life
    expect(g.life(0), 'Player 0 should have gained 3 life').toBe(lifeBefore + 3);
  });

  it('does NOT pay teamwork if no creatures have total power >= 2', () => {
    const g = new TestGame();

    // Player 0 has a 1/1 creature (power 1 < required 2)
    const weakAlly = g.addToBattlefield(0, {
      name: 'Tiny Soldier',
      type_line: 'Creature — Human Soldier',
      power: '1',
      toughness: '1',
      cmc: 1,
    });

    // Opponent has a MV≤3 creature (always valid) + MV>3 dragon
    const smallCreature = g.addToBattlefield(1, {
      name: 'Tiny Spider',
      type_line: 'Creature — Spider',
      power: '1',
      toughness: '2',
      cmc: 2,
    });

    const lifeBefore = g.life(0);

    const { result } = g.castFromHand(0, {
      name: 'Cruel Alliance',
      type_line: 'Sorcery',
      mana_cost: '{2}{B}',
      cmc: 3,
      colors: ['B'],
    });

    expect(result.success, `castSpell failed: ${result.msg}`).toBe(true);

    // Tiny Soldier should NOT be tapped (teamwork not triggered)
    const soldierOnBf = g.battlefield(0).find((c: any) => c.name === 'Tiny Soldier');
    expect(soldierOnBf?._tapped, 'Tiny Soldier should NOT be tapped').toBe(false);

    // Life should NOT have increased (no teamwork bonus)
    expect(g.life(0), 'No life gained without teamwork').toBe(lifeBefore);
  });
});
