#!/usr/bin/env node
/**
 * AI-Powered Card Validator
 * Uses Claude API to semantically validate card implementations
 *
 * Usage: const validator = require('./ai-validator');
 *        const result = await validator.validateCard('Sage of the Skies');
 */

const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

// Try to load .env file
try {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
} catch (e) {
  // dotenv not installed, no problem
}

// Load CardEffectsDB
const path = require('path');
const fs = require('fs');
const dbPath = path.join(__dirname, '../js/data/card-effects.js');

let CardEffectsDB = {};
try {
  const dbContent = fs.readFileSync(dbPath, 'utf8');
  const match = dbContent.match(/const CardEffectsDB = \{([\s\S]*)\};/);
  if (match) {
    eval('CardEffectsDB = {' + match[1] + '}');
  }
} catch (e) {
  console.error('Error loading CardEffectsDB:', e.message);
}

const apiKey = process.env.ANTHROPIC_API_KEY;

// Client is only created when API key is available
let client = null;
if (apiKey) {
  client = new Anthropic({ apiKey });
}

// Engine capabilities reference
const ENGINE_CAPABILITIES = `
SUPPORTED TRIGGER EVENTS:
- attacks, combat_damage_player, dies, any_creature_dies, other_creature_dies
- upkeep, gain_life, becomes_tapped, second_spell, end_step
- dragon_enters, enters_or_attacks, combat_begin, other_creature_enters
- creature_etb, landfall, leaves_battlefield, creature_dies_with_counters

SUPPORTED EFFECT TYPES (70+):
- damage, destroy, exile, draw, gainLife, loseLife, buff, bounce
- scry, surveil, mill, ramp, create_token, destroy_all, exile_all
- counter (+1/+1, -1/-1), discard, fight, tap, untap, drain, prevent_damage
- loot, search_library, create_token_copy, gain_control, anthem
- copy_spell, extra_combat, clash, evoke, persist, regenerate
- become_creature, stun, wither, threaten, harmonize, channel

SUPPORTED TRIGGER CONDITIONS:
- if_beheld_dragon, if_discarded_nonland, if_exiled
- control_creature_with_counter, control_faerie/kithkin/treefolk/dragon
- main_phase, dealt_damage_this_turn, faeries_you_control
- cast_noncreature, card_left_graveyard, seven_cards_in_gy
- creature_died, toughness_10+, cast_creature_and_noncreature
- 3+_attacking, opponent_lost_life, have_dragon, attacked_this_turn

KNOWN ISSUES TO DETECT:
1. Trigger timing bugs: "When you cast CARDNAME, if..." = cast trigger with condition (NOT second_spell)
2. Missing abilities: Oracle text has multiple paragraphs but DB has few effects
3. Graveyard abilities: "Renew", "exile from graveyard" = needs db.graveyard array
4. Optional effects: "may", "up to" in oracle = optional: true in DB
5. Target bugs: Multiple "target" keywords without target_index markers
6. Multi-effect spells: Cast/ETB with 2+ effects but only 1 in DB
`;

/**
 * Validate card using AI semantic analysis
 * @param {string} cardName - Card name to validate
 * @returns {Promise<Object>} Validation result with issues and fixes
 */
async function validateCard(cardName) {
  try {
    // Fetch from Scryfall
    const scryfallCard = await fetchScryfallCard(cardName);
    if (!scryfallCard) {
      return {
        success: false,
        error: `Card not found on Scryfall: ${cardName}`,
        correctness: 0
      };
    }

    // Get DB entry
    const dbKey = cardName.toLowerCase();
    const dbEntry = CardEffectsDB[dbKey] || null;

    // Prepare validation prompt
    const prompt = buildValidationPrompt(scryfallCard, dbEntry, cardName);

    // Call Claude API (only if client is available)
    if (!client) {
      return {
        success: false,
        error: 'ANTHROPIC_API_KEY not configured. Set it in .env file.',
        correctness: 0
      };
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse response
    const content = response.content[0].text;
    const result = parseValidationResponse(content, scryfallCard, dbEntry, cardName);

    return {
      success: true,
      cardName,
      scryfallCard: {
        name: scryfallCard.name,
        type_line: scryfallCard.type_line,
        mana_cost: scryfallCard.mana_cost,
        oracle_text: scryfallCard.oracle_text,
        cmc: scryfallCard.cmc
      },
      dbEntry: dbEntry || {},
      ...result
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      correctness: 0
    };
  }
}

/**
 * Fetch card from Scryfall API
 */
function fetchScryfallCard(cardName) {
  return new Promise((resolve, reject) => {
    const encodedName = encodeURIComponent(cardName);
    const url = `https://api.scryfall.com/cards/search?q=name:"${cardName}"&unique=prints`;

    const options = {
      headers: {
        'User-Agent': 'Magic-Draft-Validator/1.0',
        'Accept': 'application/json'
      }
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const card = json.data?.[0];
          resolve(card || null);
        } catch (e) {
          reject(new Error('Failed to parse Scryfall response'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Build validation prompt for Claude
 */
function buildValidationPrompt(scryfallCard, dbEntry, cardName) {
  return `You are a Magic card game validator. Analyze this card implementation for bugs.

ORACLE TEXT (Scryfall - Source of Truth):
${scryfallCard.oracle_text || '(No oracle text)'}

TYPE: ${scryfallCard.type_line}
MANA COST: ${scryfallCard.mana_cost}
CMC: ${scryfallCard.cmc}

CURRENT DATABASE ENTRY:
${JSON.stringify(dbEntry || {}, null, 2)}

${ENGINE_CAPABILITIES}

VALIDATION CHECKLIST:
1. Are all abilities from oracle text represented in DB?
2. Are trigger events correct? (e.g., "When you cast" = cast trigger, NOT second_spell)
3. Are all conditions properly encoded? (if statements in oracle = condition field in DB)
4. Are optional effects marked with optional: true? ("may" in oracle)
5. Are graveyard abilities in db.graveyard array? ("Renew" or "exile from graveyard")
6. Are multi-target spells marked with target_index? (multiple "target" keywords)
7. Is timing correct? (cast effects vs ETB vs triggered)
8. Are all keywords in static: [{type: "has_keyword", keywords: [...]}]?

RESPONSE FORMAT (JSON):
{
  "correctness": <0-100>,
  "issues": [
    {
      "severity": "critical|major|minor",
      "type": "missing_ability|wrong_timing|wrong_target|wrong_condition|missing_optional|keyword_missing|other",
      "location": "etb|cast|triggered|activated|static|graveyard",
      "description": "What's wrong and why",
      "evidence": "Quote from oracle text that proves this"
    }
  ],
  "fixes": [
    {
      "location": "etb|cast|triggered|etc",
      "current": "Current JSON snippet",
      "suggested": "Corrected JSON snippet",
      "explanation": "Why this fixes the issue"
    }
  ],
  "summary": "Brief analysis (1-2 sentences)"
}

CRITICAL TRIGGER PATTERN DETECTION:
If oracle says "When you cast [THIS CARD], if [CONDITION]":
  → Use event: "cast_spell", self: true, condition: "[CONDITION]"
  → NOT event: "second_spell"

If oracle says "When you cast [OTHER CARD], if [CONDITION]":
  → Use event: "cast_spell", self: false, condition: "[CONDITION]"

Respond ONLY with JSON, no markdown.`;
}

/**
 * Parse Claude's JSON response
 */
function parseValidationResponse(content, scryfallCard, dbEntry, cardName) {
  try {
    // Extract JSON from response (might have markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const analysis = JSON.parse(jsonStr);

    // Calculate severity score impact
    let severityScore = 100;
    (analysis.issues || []).forEach(issue => {
      if (issue.severity === 'critical') severityScore -= 40;
      else if (issue.severity === 'major') severityScore -= 15;
      else if (issue.severity === 'minor') severityScore -= 5;
    });

    return {
      correctness: Math.max(0, analysis.correctness || severityScore),
      issues: analysis.issues || [],
      fixes: analysis.fixes || [],
      summary: analysis.summary || 'Analysis complete.',
      criticalCount: (analysis.issues || []).filter(i => i.severity === 'critical').length,
      majorCount: (analysis.issues || []).filter(i => i.severity === 'major').length,
      minorCount: (analysis.issues || []).filter(i => i.severity === 'minor').length
    };
  } catch (e) {
    // Fallback: return error but continue
    return {
      correctness: 50,
      issues: [
        {
          severity: 'major',
          type: 'other',
          description: `Failed to parse AI validation: ${e.message}`,
          location: 'unknown'
        }
      ],
      fixes: [],
      summary: 'AI validation failed',
      criticalCount: 0,
      majorCount: 1,
      minorCount: 0
    };
  }
}

/**
 * Format validation result for console output
 */
function formatResult(result) {
  if (!result.success) {
    return `❌ VALIDATION FAILED: ${result.error}`;
  }

  const { cardName, correctness, criticalCount, majorCount, minorCount, issues, fixes, summary } = result;

  let output = `\n📊 VALIDATION RESULT: ${cardName}\n`;
  output += `${'═'.repeat(60)}\n`;
  output += `Score: ${correctness}/100 ${getScoreBadge(correctness)}\n`;
  output += `Issues: ${criticalCount} critical, ${majorCount} major, ${minorCount} minor\n\n`;

  if (issues.length === 0) {
    output += `✅ No issues found! Card appears to be correctly implemented.\n`;
  } else {
    output += `Issues:\n`;
    issues.forEach((issue, idx) => {
      const severityEmoji = {
        critical: '🔴',
        major: '🟠',
        minor: '🟡'
      }[issue.severity] || '⚪';

      output += `\n${severityEmoji} ${issue.severity.toUpperCase()}: ${issue.type}\n`;
      output += `   Location: ${issue.location}\n`;
      output += `   ${issue.description}\n`;
      if (issue.evidence) {
        output += `   Evidence: "${issue.evidence}"\n`;
      }
    });
  }

  if (fixes.length > 0) {
    output += `\n🔧 SUGGESTED FIXES:\n`;
    fixes.forEach((fix, idx) => {
      output += `\nFix ${idx + 1}: ${fix.location}\n`;
      output += `   Explanation: ${fix.explanation}\n`;
      output += `   Current: ${fix.current}\n`;
      output += `   Suggested: ${fix.suggested}\n`;
    });
  }

  output += `\n📝 SUMMARY: ${summary}\n`;
  output += `${'═'.repeat(60)}\n`;

  return output;
}

function getScoreBadge(score) {
  if (score >= 90) return '✅';
  if (score >= 70) return '⚠️';
  return '❌';
}

module.exports = {
  validateCard,
  formatResult,
  fetchScryfallCard,
  ENGINE_CAPABILITIES
};
