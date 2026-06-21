// llm-effect-generator.ts — Ollama-powered card effect generation

const SCHEMA_PROMPT = `Convert a Magic: The Gathering card to a JSON effect descriptor for a game engine.
Return ONLY a single-line JSON object. No explanation, no markdown, just JSON.

Valid effect types for arrays (cast/etb/triggered[].effects/activated[].effects):
{"type":"damage","amount":N,"target":"any"|"creature"|"player"}
{"type":"draw","amount":N}
{"type":"scry","amount":N}
{"type":"surveil","amount":N}
{"type":"mill","amount":N}
{"type":"gain_life","amount":N}
{"type":"lose_life","amount":N,"target":"self"}
{"type":"drain","amount":N,"target":"any"}
{"type":"destroy","target":"creature"|"artifact"|"enchantment"|"nonland_permanent"|"permanent"}
{"type":"exile","target":"creature"|"permanent"|"graveyard_card"}
{"type":"bounce","target":"creature"|"permanent"}
{"type":"counter_spell"}
{"type":"counter","counter":"+1/+1","amount":N,"target":"creature"|"all_own_creatures"}
{"type":"buff","power":N,"toughness":N,"target":"creature"|"all_own_creatures","duration":"end_of_turn"}
{"type":"create_token","power":N,"toughness":N,"name":"NAME","count":N}
{"type":"ramp"}
{"type":"discard","target":"opponent"|"all","amount":N}
{"type":"fight","target":"creature"}
{"type":"tap","target":"creature"}
{"type":"grant","keywords":["flying"|"trample"|"haste"|"deathtouch"|"lifelink"|"indestructible"],"target":"creature","duration":"end_of_turn"}
{"type":"damage_all_creatures","amount":N}
{"type":"damage_each_opponent","amount":N}
{"type":"add_mana","color":"W"|"U"|"B"|"R"|"G"|"any","amount":N}
{"type":"counter_all","counter":"+1/+1","amount":N,"target":"own_creatures"}
{"type":"sacrifice","target":"creature"|"permanent"}
{"type":"modal","modes":[]}

Trigger objects for "triggered" array:
{"event":"attacks","self":true,"effects":[...]}
{"event":"dies","self":true,"effects":[...]}
{"event":"upkeep","effects":[...]}
{"event":"end_step","effects":[...]}
{"event":"combat_damage_player","self":true,"effects":[...]}
{"event":"any_creature_dies","effects":[...]}
{"event":"enters_or_attacks","effects":[...]}

Top-level JSON keys (only include non-empty): cast, etb, triggered, activated, static

Examples:
Input: "Lightning Bolt" | Instant | "Lightning Bolt deals 3 damage to any target."
Output: {"cast":[{"type":"damage","amount":3,"target":"any"}]}

Input: "Llanowar Elves" | Creature - Elf Druid | "{T}: Add {G}."
Output: {"activated":[{"cost":"{T}","effects":[{"type":"add_mana","color":"G","amount":1}]}]}

Input: "Banisher Priest" | Creature - Human Cleric | "When Banisher Priest enters the battlefield, exile target creature an opponent controls until Banisher Priest leaves the battlefield."
Output: {"etb":[{"type":"exile","target":"creature"}]}

Input: "Skullclamp" | Artifact - Equipment | "Equipped creature gets -1/+0. Whenever equipped creature dies, draw two cards."
Output: {"triggered":[{"event":"dies","self":false,"effects":[{"type":"draw","amount":2}]}]}

Input: "Glorybringer" | Creature - Dragon | "Flying, haste. You may exert Glorybringer as it attacks. When you do, it deals 4 damage to target non-Dragon creature an opponent controls."
Output: {"static":[{"type":"has_keyword","keywords":["flying","haste"]}],"triggered":[{"event":"attacks","self":true,"effects":[{"type":"damage","amount":4,"target":"creature"}]}]}

Now convert:
Input: "CARDNAME" | TYPELINE | "ORACLE"
Output:`;

export interface LlmEffectResult {
  cardName: string;
  entry: Record<string, any> | null;
  error?: string;
}

function extractJson(text: string): Record<string, any> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const validKeys = ['cast', 'etb', 'triggered', 'activated', 'static', 'additional_costs'];
    if (typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).some(k => validKeys.includes(k))) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function generateEffectWithLlm(
  card: { name: string; oracle_text?: string; type_line?: string; keywords?: string[] },
  ollamaUrl: string,
  ollamaModel: string
): Promise<LlmEffectResult> {
  if (!card.oracle_text?.trim()) {
    return { cardName: card.name, entry: null, error: 'No oracle text' };
  }

  const cleanOracle = card.oracle_text.replace(/\([^)]+\)/g, '').trim();
  const prompt = SCHEMA_PROMPT
    .replace('CARDNAME', card.name)
    .replace('TYPELINE', card.type_line || '')
    .replace('ORACLE', cleanOracle);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.1, top_p: 0.9 },
      }),
    });

    if (!response.ok) {
      return { cardName: card.name, entry: null, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const text: string = data?.message?.content || data?.choices?.[0]?.message?.content || '';
    const entry = extractJson(text);

    return { cardName: card.name, entry, error: entry ? undefined : 'Could not parse JSON from response' };
  } catch (e: any) {
    return { cardName: card.name, entry: null, error: e?.message || 'Network error' };
  }
}

export async function batchGenerateEffects(
  cards: Array<{ name: string; oracle_text?: string; type_line?: string; keywords?: string[] }>,
  ollamaUrl: string,
  ollamaModel: string,
  onProgress: (done: number, total: number, last: LlmEffectResult) => void,
  abortSignal?: { aborted: boolean }
): Promise<LlmEffectResult[]> {
  const results: LlmEffectResult[] = [];
  for (let i = 0; i < cards.length; i++) {
    if (abortSignal?.aborted) break;
    const result = await generateEffectWithLlm(cards[i], ollamaUrl, ollamaModel);
    results.push(result);
    onProgress(i + 1, cards.length, result);
  }
  return results;
}
