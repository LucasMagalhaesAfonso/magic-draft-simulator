/**
 * AI Card Processor
 * Processes Magic cards using AI when regex parsing fails
 * Results are cached permanently in localStorage and can be exported
 */

const AIProcessor = {
  STORAGE_KEY: 'mtg_ai_processed_cards',
  API_KEY_STORAGE: 'mtg_ai_api_key',
  API_PROVIDER_STORAGE: 'mtg_ai_provider',

  // Get API configuration
  getConfig() {
    return {
      apiKey: localStorage.getItem(this.API_KEY_STORAGE) || '',
      provider: localStorage.getItem(this.API_PROVIDER_STORAGE) || 'anthropic'
    };
  },

  // Save API configuration
  setConfig(apiKey, provider = 'anthropic') {
    localStorage.setItem(this.API_KEY_STORAGE, apiKey);
    localStorage.setItem(this.API_PROVIDER_STORAGE, provider);
  },

  // Check if API is configured
  isConfigured() {
    const config = this.getConfig();
    return config.apiKey && config.apiKey.length > 10;
  },

  // Get all cached processed cards
  getCachedCards() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      console.error('Error loading cached cards:', e);
      return {};
    }
  },

  // Save a processed card to cache
  saveToCache(cardName, effects) {
    const cache = this.getCachedCards();
    cache[cardName.toLowerCase()] = {
      ...effects,
      _processedAt: new Date().toISOString(),
      _source: 'ai'
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(cache));
  },

  // Get effects for a specific card from cache
  getFromCache(cardName) {
    const cache = this.getCachedCards();
    return cache[cardName.toLowerCase()] || null;
  },

  // Check if card is in cache
  isInCache(cardName) {
    const cache = this.getCachedCards();
    return cardName.toLowerCase() in cache;
  },

  // Export cached cards as JS code (to paste into card-effects.js)
  exportAsCode() {
    const cache = this.getCachedCards();
    let code = '// AI-Generated Card Effects - Copy to card-effects.js\n\n';

    for (const [name, effects] of Object.entries(cache)) {
      const cleanEffects = { ...effects };
      delete cleanEffects._processedAt;
      delete cleanEffects._source;

      code += `  "${name}": ${JSON.stringify(cleanEffects, null, 2).replace(/\n/g, '\n  ')},\n\n`;
    }

    return code;
  },

  // Clear cache
  clearCache() {
    localStorage.removeItem(this.STORAGE_KEY);
  },

  // Process a card using AI
  async processCard(card) {
    const config = this.getConfig();

    if (!config.apiKey) {
      console.warn('AI API not configured');
      return null;
    }

    const prompt = this._buildPrompt(card);

    try {
      let result;
      if (config.provider === 'anthropic') {
        result = await this._callAnthropic(prompt, config.apiKey);
      } else if (config.provider === 'openai') {
        result = await this._callOpenAI(prompt, config.apiKey);
      } else {
        throw new Error('Unknown provider: ' + config.provider);
      }

      if (result) {
        this.saveToCache(card.name, result);
        console.log(`AI processed card: ${card.name}`, result);
      }

      return result;
    } catch (error) {
      console.error('AI processing error:', error);
      return null;
    }
  },

  // Build the prompt for the AI
  _buildPrompt(card) {
    return `Analyze this Magic: The Gathering card and extract its effects as structured JSON.

Card Name: ${card.name}
Type: ${card.type_line}
Mana Cost: ${card.mana_cost}
Oracle Text: ${card.oracle_text}
${card.power ? `Power/Toughness: ${card.power}/${card.toughness}` : ''}
Keywords: ${(card.keywords || []).join(', ')}

Return a JSON object with these fields (omit empty arrays):
{
  "etb": [...],           // Effects when THIS card enters the battlefield
  "cast": [...],          // Effects when casting (for instants/sorceries)
  "triggered": [...],     // Triggered abilities (when X happens)
  "activated": [...],     // Activated abilities ({cost}: effect)
  "static": [...],        // Static/continuous effects
  "additional_costs": [...] // Extra costs to cast
}

=== EFFECT TYPES ===
- damage: {type: "damage", amount: N, target: "creature|player|any|each_opponent"}
- damage_each_opponent: {type: "damage_each_opponent", amount: N}
- destroy: {type: "destroy", target: "creature|permanent|artifact|enchantment|nonland_permanent"}
- destroy_all: {type: "destroy_all", target: "creatures"}
- exile: {type: "exile", target: "creature|permanent|graveyard_card"}
- draw: {type: "draw", amount: N}
- discard: {type: "discard", amount: N, target: "self|opponent"}
- gainLife: {type: "gainLife", amount: N}
- loseLife: {type: "loseLife", amount: N, target: "opponent"}
- buff: {type: "buff", power: N, toughness: N, target: "creature|self", duration: "permanent|end_of_turn"}
- buff_self: {type: "buff_self", power: N, toughness: N}
- counter_self: {type: "counter_self", counter: "+1/+1", amount: N}
- counter: {type: "counter", counter: "+1/+1|-1/-1", amount: N, target: "creature"}
- counter_all: {type: "counter_all", counter: "+1/+1", amount: N}
- create_token: {type: "create_token", power: N, toughness: N, count: N, name: "...", keywords: [...], attacking: true|false}
- add_mana: {type: "add_mana", color: "W|U|B|R|G|C"}
- scry: {type: "scry", amount: N}
- surveil: {type: "surveil", amount: N}
- mill: {type: "mill", amount: N, target: "self|opponent"}
- bounce: {type: "bounce", target: "creature|permanent"}
- tap: {type: "tap", target: "creature"}
- untap: {type: "untap", target: "self|creature"}
- untap_self: {type: "untap_self"}
- sacrifice: {type: "sacrifice", target: "creature|permanent"}
- fight: {type: "fight", target: "creature"}
- ramp: {type: "ramp", landType: "basic|any", tapped: true|false}
- prevent_damage: {type: "prevent_damage", amount: N}
- endure: {type: "endure", amount: N}
- stun_counter_self: {type: "stun_counter_self", amount: N}
- peek_top_land: {type: "peek_top_land"} (look at top card, if land put in hand)
- drain: {type: "loseLife", amount: N, target: "opponent"} + {type: "gainLife", amount: N}

=== TRIGGERED ABILITIES ===
Use these event names EXACTLY:
{event: "EVENT", self: true|false, effects: [...]}

Supported events:
- "attacks" (self:true) — When this creature attacks
- "becomes_tapped" (self:true) — Whenever this creature becomes tapped
- "combat_damage_player" (self:true) — When this creature deals combat damage to a player
- "dies" (self:true) — When this creature dies
- "any_creature_dies" (controller:true) — Whenever a creature you control dies
- "other_creature_dies" (controller:true) — Whenever another creature you control dies
- "upkeep" (self:true) — At the beginning of your upkeep
- "end_step" (self:true) — At the beginning of your end step / At end of turn
- "gain_life" (self:true) — Whenever you gain life
- "second_spell" (self:true) — Whenever you cast your second spell each turn (Flurry)
- "enters_or_attacks" (self:true) — Whenever this creature enters or attacks
- "dragon_enters" (controller:true) — Whenever a Dragon enters under your control

For tokens that enter attacking (Mobilize mechanic): use attacking: true in create_token.
For Endure mechanic: use {type: "endure", amount: N}.
For "look at top card, if land put in hand": use {type: "peek_top_land"}.
For Behold (reveal card type from hand): note as condition but still parse the effects.

=== ACTIVATED ABILITIES ===
{cost: {mana: N, tap: true|false, sacrifice: "creature", discard: N, life: N}, effects: [...]}

=== ADDITIONAL COSTS ===
{type: "sacrifice|discard|pay_life|tap_creature", target: "creature|card", amount: N}

IMPORTANT: Return ONLY the JSON object, no markdown or explanation. Use the exact type names shown above.`;
  },

  // Call Anthropic API
  async _callAnthropic(prompt, apiKey) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Parse JSON from response
    try {
      return JSON.parse(text);
    } catch (e) {
      // Try to extract JSON from text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Could not parse AI response as JSON');
    }
  },

  // Call OpenAI API
  async _callOpenAI(prompt, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    // Parse JSON from response
    try {
      return JSON.parse(text);
    } catch (e) {
      // Try to extract JSON from text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Could not parse AI response as JSON');
    }
  },

  // Show configuration modal
  showConfigModal() {
    const config = this.getConfig();
    const existingModal = document.getElementById('ai-config-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'ai-config-modal';
    modal.className = 'ai-config-overlay';
    modal.innerHTML = `
      <div class="ai-config-modal">
        <h3>Configurar IA para Cartas</h3>
        <p class="ai-config-desc">Configure uma API para processar cartas automaticamente quando o parser não conseguir.</p>

        <div class="ai-config-field">
          <label>Provedor</label>
          <select id="ai-provider">
            <option value="anthropic" ${config.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
            <option value="openai" ${config.provider === 'openai' ? 'selected' : ''}>OpenAI (GPT)</option>
          </select>
        </div>

        <div class="ai-config-field">
          <label>API Key</label>
          <input type="password" id="ai-api-key" value="${config.apiKey}" placeholder="sk-..." />
        </div>

        <div class="ai-config-stats">
          <span>Cartas processadas: ${Object.keys(this.getCachedCards()).length}</span>
        </div>

        <div class="ai-config-actions">
          <button class="btn btn-secondary btn-sm" onclick="AIProcessor.hideConfigModal()">Cancelar</button>
          <button class="btn btn-secondary btn-sm" onclick="AIProcessor.exportAndDownload()">Exportar</button>
          <button class="btn btn-primary btn-sm" onclick="AIProcessor.saveConfigFromModal()">Salvar</button>
        </div>
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.1)">
          <button class="btn btn-primary btn-sm" style="width:100%" onclick="AIProcessor.hideConfigModal();AIProcessor.processCurrentCards();">
            Processar Cartas do Jogo Atual
          </button>
          <p style="font-size:0.6rem;color:rgba(255,255,255,0.4);margin-top:4px">Processa com IA todas as cartas que nao estao no cache</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  },

  hideConfigModal() {
    const modal = document.getElementById('ai-config-modal');
    if (modal) modal.remove();
  },

  saveConfigFromModal() {
    const apiKey = document.getElementById('ai-api-key').value;
    const provider = document.getElementById('ai-provider').value;
    this.setConfig(apiKey, provider);
    this.hideConfigModal();
    console.log('AI config saved');
  },

  exportAndDownload() {
    const code = this.exportAsCode();
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'card-effects-export.js';
    a.click();
    URL.revokeObjectURL(url);
  },

  // Batch process all cards from the current game/draft
  async processCurrentCards() {
    if (!this.isConfigured()) {
      alert('Configure uma API key primeiro!');
      return;
    }

    // Gather cards from UIGame (current game) or DraftState (current draft)
    let cards = [];
    if (typeof UIGame !== 'undefined' && UIGame.gameState) {
      const gs = UIGame.gameState;
      for (const p of gs.players) {
        cards.push(...p.zones.hand.getAll());
        cards.push(...p.zones.battlefield.getAll());
        cards.push(...p.zones.graveyard.getAll());
        cards.push(...p.zones.library.cards);
      }
    } else if (typeof DraftState !== 'undefined' && DraftState.pool) {
      cards = [...DraftState.pool];
    }

    // Dedupe by name, skip tokens and basics
    const seen = new Set();
    const unique = [];
    for (const c of cards) {
      const name = (c.name || '').toLowerCase();
      if (!name || seen.has(name) || c._isToken) continue;
      if (CardEngine.isBasicLand(c)) continue;
      // Skip if already in CardEffectsDB or AI cache
      if (typeof CardEffectsDB !== 'undefined' && CardEffectsDB.hasEffects(c.name)) continue;
      if (this.isInCache(c.name)) continue;
      seen.add(name);
      unique.push(c);
    }

    if (unique.length === 0) {
      this._updateProgress('Todas as cartas ja estao processadas!', 0, 0);
      return;
    }

    this._showProgressUI(unique.length);
    let processed = 0;
    let errors = 0;

    for (const card of unique) {
      try {
        this._updateProgress(`Processando: ${card.name}...`, processed, unique.length);
        await this.processCard(card);
        processed++;
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.error(`Erro processando ${card.name}:`, e);
        errors++;
      }
    }

    this._updateProgress(`Pronto! ${processed} cartas processadas${errors ? `, ${errors} erros` : ''}.`, unique.length, unique.length);
    setTimeout(() => this._hideProgressUI(), 3000);
  },

  _showProgressUI(total) {
    let el = document.getElementById('ai-progress-bar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ai-progress-bar';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(13,17,23,0.95);padding:8px 16px;display:flex;align-items:center;gap:12px;font-size:0.75rem;color:#e0e0e0;';
      el.innerHTML = `
        <span id="ai-progress-text" style="flex:1"></span>
        <div style="flex:2;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden">
          <div id="ai-progress-fill" style="height:100%;background:#e94560;border-radius:3px;width:0%;transition:width 0.3s"></div>
        </div>
        <span id="ai-progress-count" style="min-width:60px;text-align:right"></span>
      `;
      document.body.appendChild(el);
    }
  },

  _updateProgress(text, current, total) {
    const textEl = document.getElementById('ai-progress-text');
    const fillEl = document.getElementById('ai-progress-fill');
    const countEl = document.getElementById('ai-progress-count');
    if (textEl) textEl.textContent = text;
    if (fillEl) fillEl.style.width = total > 0 ? `${(current / total * 100).toFixed(0)}%` : '0%';
    if (countEl) countEl.textContent = total > 0 ? `${current}/${total}` : '';
  },

  _hideProgressUI() {
    const el = document.getElementById('ai-progress-bar');
    if (el) el.remove();
  }
};
