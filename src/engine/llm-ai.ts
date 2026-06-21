// @ts-nocheck
// llm-ai.ts — LLM AI backend: supports Ollama (local, free) and Anthropic Claude API

import { serializeStateForLlm } from './game-state-serializer';

export type AiDifficulty = 'easy' | 'medium' | 'hard' | 'extreme';
export type AiProvider = 'ollama' | 'anthropic';

export interface LlmTurnDecision {
  mainPlayUids: string[];
  attackerUids: string[];
  reasoning: string;
}

// ── Anthropic ────────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL_HARD    = 'claude-haiku-4-5-20251001';
const ANTHROPIC_MODEL_EXTREME = 'claude-sonnet-4-6';

async function callAnthropic(prompt: string, apiKey: string, model: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) { console.warn('[LLM] Anthropic error:', res.status); return null; }
    const data = await res.json();
    return data?.content?.[0]?.text ?? null;
  } catch (e) {
    console.warn('[LLM] Anthropic fetch error:', e);
    return null;
  }
}

// ── Ollama ───────────────────────────────────────────────────────────────────

async function callOllama(prompt: string, baseUrl: string, model: string): Promise<string | null> {
  // Normalize base URL (remove trailing slash)
  const base = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.2 }, // low temp for more deterministic play
      }),
    });
    if (!res.ok) { console.warn('[LLM] Ollama error:', res.status); return null; }
    const data = await res.json();
    return data?.message?.content ?? null;
  } catch (e) {
    console.warn('[LLM] Ollama fetch error:', e);
    return null;
  }
}

// ── Shared ───────────────────────────────────────────────────────────────────

function parseJsonFromText(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export interface LlmConfig {
  provider: AiProvider;
  difficulty: 'hard' | 'extreme';
  // Anthropic
  anthropicApiKey?: string;
  // Ollama
  ollamaUrl?: string;
  ollamaModel?: string;
}

export async function getLlmTurnDecision(
  state: any,
  playerId: number,
  config: LlmConfig,
): Promise<LlmTurnDecision | null> {
  let prompt: string;
  let actionMap: ReturnType<typeof serializeStateForLlm>['actionMap'];
  try {
    const result = serializeStateForLlm(state, playerId);
    prompt = result.prompt;
    actionMap = result.actionMap;
  } catch (e) {
    console.warn('[LLM] serialization error:', e);
    return null;
  }

  let responseText: string | null = null;

  if (config.provider === 'anthropic') {
    if (!config.anthropicApiKey) return null;
    const model = config.difficulty === 'extreme' ? ANTHROPIC_MODEL_EXTREME : ANTHROPIC_MODEL_HARD;
    responseText = await callAnthropic(prompt, config.anthropicApiKey, model);
  } else {
    const url = config.ollamaUrl || 'http://localhost:11434';
    const model = config.ollamaModel || 'llama3.1';
    responseText = await callOllama(prompt, url, model);
  }

  if (!responseText) return null;

  const parsed = parseJsonFromText(responseText);
  if (!parsed) {
    console.warn('[LLM] could not parse JSON:', responseText.slice(0, 200));
    return null;
  }

  const mainPlayUids: string[] = [];
  for (const idx of (Array.isArray(parsed.main_action_indices) ? parsed.main_action_indices : [])) {
    const action = actionMap.mainActions[idx];
    if (!action) continue;
    if (action.type === 'pass') break;
    if (action.uid) mainPlayUids.push(action.uid);
  }

  const attackerUids: string[] = [];
  for (const idx of (Array.isArray(parsed.attacker_indices) ? parsed.attacker_indices : [])) {
    const atk = actionMap.attackers[idx];
    if (atk) attackerUids.push(atk.uid);
  }

  return {
    mainPlayUids,
    attackerUids,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}

// ── Connection test ───────────────────────────────────────────────────────────

export async function testAnthropicKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey.trim()) return { ok: false, error: 'Chave vazia' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL_HARD, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401) return { ok: false, error: 'Chave inválida (401)' };
    if (res.status === 403) return { ok: false, error: 'Sem permissão (403)' };
    if (!res.ok) return { ok: false, error: `Erro ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Erro de rede' };
  }
}

export async function testOllama(baseUrl: string, model: string): Promise<{ ok: boolean; error?: string }> {
  const base = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  try {
    // First check if Ollama is running at all
    const ping = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!ping.ok) return { ok: false, error: `Ollama não responde em ${base}` };
    const tags = await ping.json();
    const models: string[] = (tags.models || []).map((m: any) => m.name as string);
    if (models.length === 0) return { ok: false, error: 'Nenhum modelo instalado. Rode: ollama pull ' + (model || 'llama3.1') };
    const modelBase = (model || 'llama3.1').split(':')[0];
    const found = models.some(m => m.startsWith(modelBase));
    if (!found) return { ok: false, error: `Modelo "${model}" não encontrado. Modelos disponíveis: ${models.slice(0, 3).join(', ')}` };
    return { ok: true };
  } catch (e: any) {
    if (e?.name === 'TimeoutError') return { ok: false, error: `Timeout — Ollama não está rodando em ${base}` };
    return { ok: false, error: `Ollama não encontrado em ${base}. Instale em ollama.com` };
  }
}

// Keep old export name for backward compat with SettingsScreen
export const testApiKey = testAnthropicKey;
