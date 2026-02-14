#!/usr/bin/env node
/**
 * Static Card Validator
 * Fast, code-level checks without AI or browser
 *
 * Usage: const validator = require('./static-validator');
 *        const issues = validator.validate(scryfallCard, dbEntry);
 */

/**
 * Perform static validation checks
 * @param {Object} scryfallCard - Card from Scryfall API
 * @param {Object} dbEntry - Entry from CardEffectsDB
 * @returns {Array} Array of issues found
 */
function validate(scryfallCard, dbEntry) {
  const issues = [];
  const oracle = (scryfallCard.oracle_text || '').toLowerCase();
  const typeLine = (scryfallCard.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  const isInstant = typeLine.includes('instant');
  const isSorcery = typeLine.includes('sorcery');

  if (!dbEntry) {
    issues.push({
      severity: 'critical',
      type: 'missing_entry',
      location: 'database',
      description: 'Card has no entry in CardEffectsDB'
    });
    return issues;
  }

  // Check 1: ETB abilities
  if (isCreature && oracle.includes('enters')) {
    if (!dbEntry.etb || dbEntry.etb.length === 0) {
      issues.push({
        severity: 'critical',
        type: 'missing_ability',
        location: 'etb',
        description: 'Creature enters the battlefield but has no ETB effects defined'
      });
    }
  }

  // Check 2: Cast effects for instants/sorceries
  if ((isInstant || isSorcery) && oracle && !oracle.match(/^(you may )?discard/i)) {
    if (!dbEntry.cast || dbEntry.cast.length === 0) {
      issues.push({
        severity: 'critical',
        type: 'missing_ability',
        location: 'cast',
        description: 'Instant/Sorcery has no cast effects defined'
      });
    }
  }

  // Check 3: Triggered abilities
  const triggerKeywords = ['whenever', 'when ', 'each time'];
  const hasTrigger = triggerKeywords.some(kw => oracle.includes(kw));
  if (hasTrigger) {
    if (!dbEntry.triggered || dbEntry.triggered.length === 0) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'triggered',
        description: 'Card has triggered ability ("when", "whenever") but none defined in DB'
      });
    }
  }

  // Check 4: "May" effects (should be optional)
  if (oracle.includes(' may ')) {
    const hasOptional = checkForOptionalFlag(dbEntry);
    if (!hasOptional) {
      issues.push({
        severity: 'major',
        type: 'missing_optional',
        location: 'cast|etb|triggered',
        description: 'Card has optional effects ("may") but optional: true flag not set'
      });
    }
  }

  // Check 5: Graveyard abilities
  if (oracle.includes('from your graveyard') || oracle.includes('from the graveyard') || oracle.includes('renew')) {
    if (!dbEntry.graveyard || dbEntry.graveyard.length === 0) {
      if (!dbEntry.activated?.some(a => a.zone === 'graveyard')) {
        issues.push({
          severity: 'critical',
          type: 'missing_ability',
          location: 'graveyard',
          description: 'Card has graveyard ability but no graveyard array or zone: "graveyard" activated ability'
        });
      }
    }
  }

  // Check 6: Multiple "target" keywords
  const targetMatches = (oracle.match(/\btarget\b/g) || []).length;
  if (targetMatches > 1) {
    const hasIndexed = dbEntry.cast?.some(e => e.target_index !== undefined) ||
                       dbEntry.etb?.some(e => e.target_index !== undefined);
    if (!hasIndexed) {
      issues.push({
        severity: 'major',
        type: 'wrong_target',
        location: 'cast|etb',
        description: `Card has ${targetMatches} target keywords but effects lack target_index markers`
      });
    }
  }

  // Check 7: Keywords in static
  const keywordPatterns = {
    flying: /\bflying\b/i,
    flash: /\bflash\b/i,
    menace: /\bmenace\b/i,
    reach: /\breach\b/i,
    trample: /\btrample\b/i,
    haste: /\bhaste\b/i,
    deathtouch: /\bdeathtouch\b/i,
    vigilance: /\bvigilance\b/i,
    lifelink: /\blifelink\b/i,
    indestructible: /\bindestructible\b/i,
    hexproof: /\bhexproof\b/i,
    shroud: /\bshroud\b/i,
    ward: /\bward/i,
    defender: /\bdefender\b/i,
    'first strike': /\bfirst\s+strike\b/i,
    'double strike': /\bdouble\s+strike\b/i
  };

  const foundKeywords = Object.entries(keywordPatterns)
    .filter(([_, pattern]) => pattern.test(typeLine) || pattern.test(oracle))
    .map(([kw]) => kw);

  if (foundKeywords.length > 0) {
    const hasStaticKeywords = dbEntry.static?.some(s =>
      s.type === 'has_keyword' && s.keywords
    );
    if (!hasStaticKeywords) {
      issues.push({
        severity: 'major',
        type: 'keyword_missing',
        location: 'static',
        description: `Found keywords (${foundKeywords.join(', ')}) but no static has_keyword entry`
      });
    }
  }

  // Check 8: Multi-paragraph oracle (multiple abilities)
  const paragraphs = oracle.split('\n').filter(p => p.trim().length > 0);
  const effectCount = (dbEntry.cast?.length || 0) +
                      (dbEntry.etb?.length || 0) +
                      (dbEntry.triggered?.length || 0) +
                      (dbEntry.activated?.length || 0);

  if (paragraphs.length > 3 && effectCount < 2) {
    issues.push({
      severity: 'major',
      type: 'missing_ability',
      location: 'multiple',
      description: `Oracle has ${paragraphs.length} abilities but DB has only ${effectCount} effects`
    });
  }

  // Check 9: "Choose one" without modal
  if (oracle.includes('choose one') || oracle.includes('choose two')) {
    const hasModal = dbEntry.cast?.some(e => e.type === 'modal') ||
                     dbEntry.etb?.some(e => e.type === 'modal');
    if (!hasModal) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'cast|etb',
        description: 'Card has "choose" effect but no modal type effect'
      });
    }
  }

  // Check 10: Fight mechanic
  if (oracle.includes('fight')) {
    const hasFight = dbEntry.cast?.some(e => e.type === 'fight' || e.type === 'fight_with') ||
                     dbEntry.etb?.some(e => e.type === 'fight' || e.type === 'fight_with');
    if (!hasFight) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'cast|etb',
        description: 'Card has "fight" mechanic but no fight effect defined'
      });
    }
  }

  // Check 11: Transform/DFC
  if (scryfallCard.card_faces?.length > 1) {
    if (!dbEntry.transform && !dbEntry.graveyard) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'transform',
        description: 'Double-faced card but no transform condition defined'
      });
    }
  }

  // Check 12: Equipment enters unattached
  if (typeLine.includes('equipment')) {
    if (oracle.includes('enters') && !oracle.includes('attached to')) {
      if (dbEntry.etb?.some(e => e.type === 'attach' || e.type === 'equip')) {
        issues.push({
          severity: 'minor',
          type: 'wrong_ability',
          location: 'etb',
          description: 'Equipment should not auto-attach on ETB; it enters unattached'
        });
      }
    }
  }

  // Check 13: Sacrifice costs
  if (oracle.includes('sacrifice') && !oracle.includes('the ability costs')) {
    const hasSacrifice = dbEntry.additional_costs?.some(c => c.type === 'sacrifice') ||
                         dbEntry.cast?.some(e => e.type === 'sacrifice') ||
                         dbEntry.activated?.some(a => a.cost?.sacrifice);
    if (!hasSacrifice) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'cast|activated',
        description: 'Card has sacrifice effect but no sacrifice cost or effect defined'
      });
    }
  }

  // Check 14: Evoke mechanic
  if (oracle.includes('evoke')) {
    if (!dbEntry.cast?.some(e => e.type === 'evoke') && !dbEntry.additional_costs?.some(c => c.type === 'evoke')) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'cast|additional_costs',
        description: 'Card has evoke mechanic but not configured in DB'
      });
    }
  }

  // Check 15: Channel (graveyard mode)
  if (oracle.includes('channel')) {
    if (!dbEntry.graveyard || dbEntry.graveyard.length === 0) {
      issues.push({
        severity: 'major',
        type: 'missing_ability',
        location: 'graveyard',
        description: 'Card has channel ability but no graveyard config'
      });
    }
  }

  return issues;
}

/**
 * Check if entry has optional flag somewhere
 */
function checkForOptionalFlag(dbEntry) {
  const checkArray = (arr) => arr?.some(e => e.optional === true) || false;

  return checkArray(dbEntry.cast) ||
         checkArray(dbEntry.etb) ||
         checkArray(dbEntry.triggered) ||
         checkArray(dbEntry.activated) ||
         (dbEntry.additional_costs?.some(c => c.optional === true) || false);
}

/**
 * Format issues for console output
 */
function formatIssues(issues) {
  if (issues.length === 0) {
    return '✅ No static validation issues found.';
  }

  let output = `\n⚠️  STATIC VALIDATION: ${issues.length} issue(s)\n`;
  output += `${'─'.repeat(60)}\n`;

  const critical = issues.filter(i => i.severity === 'critical');
  const major = issues.filter(i => i.severity === 'major');
  const minor = issues.filter(i => i.severity === 'minor');

  if (critical.length > 0) {
    output += `\n🔴 CRITICAL (${critical.length}):\n`;
    critical.forEach(issue => {
      output += `  • ${issue.description}\n`;
      output += `    Location: ${issue.location} | Type: ${issue.type}\n`;
    });
  }

  if (major.length > 0) {
    output += `\n🟠 MAJOR (${major.length}):\n`;
    major.forEach(issue => {
      output += `  • ${issue.description}\n`;
      output += `    Location: ${issue.location} | Type: ${issue.type}\n`;
    });
  }

  if (minor.length > 0) {
    output += `\n🟡 MINOR (${minor.length}):\n`;
    minor.forEach(issue => {
      output += `  • ${issue.description}\n`;
    });
  }

  return output;
}

module.exports = {
  validate,
  formatIssues
};
