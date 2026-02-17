const localClient = require('./local-client');

/**
 * ═══════════════════════════════════════════════════════════════
 *  OPENCLAW ENGINE — Self-built multi-provider AI routing
 * ═══════════════════════════════════════════════════════════════
 *
 *   Provider (kimi, groq)
 *     └─ Key Pool [key1, key2, key3]  ← round-robin
 *         └─ Model Chain [primary → fallback]
 *   Ollama = unlimited local backbone, NEVER rate limited
 *
 *   Execution:
 *     1. For each provider → rotate keys → try models → failover
 *     2. On 429 → cooldown THAT key, try next key (not whole provider)
 *     3. On error → mark key failure, try next provider
 *     4. Ollama always last resort
 *
 *   Self-healing:
 *     - Per-key circuit breakers (5 fails → 60s pause)
 *     - Per-key rate-limit cooldowns (30s → 60s → 120s → 5min)
 *     - Background health checks every 5 min
 *     - Keys auto-recover after cooldown
 *
 *   Multi-key in .env:
 *     KIMI_API_KEY=key1,key2,key3
 *     GROQ_API_KEY=key1,key2
 *     Single key still works (backward compatible)
 * ═══════════════════════════════════════════════════════════════
 */

// ─── CONSTANTS ────────────────────────────────────────────────

const REQUEST_TIMEOUT = 60000;  // Cloud API call (Kimi/Groq can be slow on free tier)
const TOOL_TIMEOUT = 45000;    // Tool execution (Supabase queries, 6 parallel reports ~5s)
const MAX_TOOL_ROUNDS = 5;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000, 4000];

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60000;     // 60s
const COOLDOWN_BASE_MS = 30000;             // 30s initial
const COOLDOWN_MAX_MS = 300000;             // 5 min max
const BILLING_COOLDOWN_MS = 3600000;        // 1h for billing errors

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;

// ─── PER-KEY STATE ────────────────────────────────────────────

class KeyState {
  constructor(key) {
    this.key = key;
    this.failures = 0;
    this.circuitOpen = false;
    this.circuitOpenedAt = 0;
    this.cooldownUntil = 0;
    this.cooldownCount = 0;
    this.disabled = false;
    this.calls = 0;
    this.tokens = 0;
    this.errors = 0;
    this.lastUsed = 0;
  }

  get isAvailable() {
    if (this.disabled) {
      if (Date.now() > this.cooldownUntil) { this.disabled = false; }
      else return false;
    }
    if (this.circuitOpen) {
      if (Date.now() > this.circuitOpenedAt + CIRCUIT_BREAKER_RESET_MS) {
        this.circuitOpen = false;
        this.failures = 0;
        return true;
      }
      return false;
    }
    if (Date.now() < this.cooldownUntil) return false;
    return true;
  }

  onSuccess(tokens = 0) {
    this.failures = 0;
    this.circuitOpen = false;
    this.cooldownCount = 0;
    this.calls++;
    this.tokens += tokens;
    this.lastUsed = Date.now();
  }

  onFailure() {
    this.failures++;
    this.errors++;
    if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
    }
  }

  onRateLimit() {
    this.cooldownCount++;
    const ms = Math.min(COOLDOWN_BASE_MS * Math.pow(2, this.cooldownCount - 1), COOLDOWN_MAX_MS);
    this.cooldownUntil = Date.now() + ms;
    this.errors++;
  }

  onBillingError() {
    this.disabled = true;
    this.cooldownUntil = Date.now() + BILLING_COOLDOWN_MS;
    this.errors++;
  }

  reset() {
    this.failures = 0;
    this.circuitOpen = false;
    this.cooldownUntil = 0;
    this.cooldownCount = 0;
    this.disabled = false;
  }
}

// ─── UNIFIED HTTP (OpenAI-compatible) ─────────────────────────

async function apiCall(baseUrl, apiKey, model, messages, opts = {}) {
  const { temperature = 0.6, maxTokens = 4096, tools = null } = opts;

  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 429) {
      const t = await res.text().catch(() => '');
      const e = new Error(`429: ${t.slice(0, 150)}`); e.code = 429; throw e;
    }
    if (res.status === 402) {
      const e = new Error('Billing/quota exceeded'); e.code = 402; throw e;
    }
    if (res.status === 401 || res.status === 403) {
      const e = new Error('Auth failed'); e.code = res.status; throw e;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => 'unknown');
      const e = new Error(`API ${res.status}: ${t.slice(0, 200)}`); e.code = res.status; throw e;
    }

    const data = await res.json();
    return parseResponse(data, model);
  } finally {
    clearTimeout(timer);
  }
}

function parseResponse(data, fallbackModel) {
  if (!data) return { content: null, error: 'Empty response' };
  if (data.error) return { content: null, error: data.error.message || JSON.stringify(data.error).slice(0, 200) };
  if (!data.choices?.length) return { content: null, error: 'No choices' };

  const msg = data.choices[0]?.message;
  if (!msg) return { content: null, error: 'No message' };

  const result = { content: msg.content || '', usage: data.usage || null, model: data.model || fallbackModel };
  if (msg.tool_calls?.length) result.toolCalls = msg.tool_calls;
  return result;
}

function isRetryable(err) {
  if (err.name === 'AbortError') return true;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket|502|503|504/i.test(err.message || '');
}

// ═══════════════════════════════════════════════════════════════
//  ENGINE
// ═══════════════════════════════════════════════════════════════

class OpenClawEngine {
  constructor() {
    this.providers = [];
    this.localClient = localClient;
    this.localAvailable = false;
    this._healthTimer = null;
    this._lastUsed = null;
    this.stats = {
      total: 0, cloud: 0, local: 0,
      rotations: 0, keyRotations: 0,
      healthChecks: 0, recoveries: 0,
    };
  }

  // ─── INIT ──────────────────────────────────────────────────

  async init() {
    const config = require('../config');
    this.providers = [];

    // Kimi
    const kimiKeys = this._parseKeys(config.kimi.apiKey);
    if (kimiKeys.length) {
      this.providers.push({
        id: 'kimi', name: 'Kimi K2.5', type: 'cloud',
        baseUrl: config.kimi.apiUrl || 'https://api.moonshot.ai/v1',
        keys: kimiKeys.map(k => new KeyState(k)),
        keyIndex: 0,
        models: [
          { id: config.kimi.model || 'kimi-k2.5', tools: true },
          { id: 'kimi-k2-0905-preview', tools: true },
        ],
        supportsTools: true,
      });
    }

    // Groq
    const groqKeys = this._parseKeys(config.groq.apiKey);
    if (groqKeys.length) {
      this.providers.push({
        id: 'groq', name: 'Groq Llama', type: 'cloud',
        baseUrl: config.groq.apiUrl || 'https://api.groq.com/openai/v1',
        keys: groqKeys.map(k => new KeyState(k)),
        keyIndex: 0,
        models: [
          { id: config.groq.model || 'llama-3.3-70b-versatile', tools: true },
          { id: 'llama-3.1-8b-instant', tools: true },
        ],
        supportsTools: true,
      });
    }

    // Ollama
    try { this.localAvailable = await localClient.isAvailable(); } catch { this.localAvailable = false; }

    // Health timer
    this._healthTimer = setInterval(() => this._healthCheck(), HEALTH_CHECK_INTERVAL);

    // Log
    const lines = this.providers.map(p => {
      const avail = p.keys.filter(k => k.isAvailable).length;
      return `${p.name}: ${avail}/${p.keys.length} keys, ${p.models.length} models`;
    });
    lines.push(`Ollama: ${this.localAvailable ? 'OK' : 'offline (will try anyway)'}`);
    console.log(`[OpenClaw] ${lines.join(' | ')}`);

    return this;
  }

  _parseKeys(val) {
    if (!val || val === 'placeholder') return [];
    return val.split(',').map(k => k.trim()).filter(Boolean);
  }

  // ─── KEY ROTATION ──────────────────────────────────────────

  _nextKey(provider) {
    for (let i = 0; i < provider.keys.length; i++) {
      const idx = (provider.keyIndex + i) % provider.keys.length;
      if (provider.keys[idx].isAvailable) {
        provider.keyIndex = (idx + 1) % provider.keys.length;
        return provider.keys[idx];
      }
    }
    return null;
  }

  _availableKeys(provider) {
    return provider.keys.filter(k => k.isAvailable);
  }

  // ─── MAIN EXECUTE ──────────────────────────────────────────
  //
  // Drop-in replacement for providers.execute().
  // Tries every provider with key rotation, then local.

  async execute(messages, opts = {}) {
    const { systemPrompt, tools, toolExecutor, isAdmin = false } = opts;
    const needsTools = !!(tools?.length);
    this.stats.total++;

    // Build provider order (respect config.cloudProvider preference)
    const config = require('../config');
    const preferred = config.cloudProvider || 'kimi';
    const sorted = [...this.providers].sort((a, b) => {
      if (a.id === preferred) return -1;
      if (b.id === preferred) return 1;
      return 0;
    });

    // Filter: if tools needed, only providers that support them
    const cloud = needsTools ? sorted.filter(p => p.supportsTools) : sorted;
    let lastError = null;

    // ── TRY EACH CLOUD PROVIDER ──
    for (const provider of cloud) {
      // Try primary model, then fallback models
      for (const model of provider.models) {
        if (needsTools && !model.tools) continue;

        try {
          let result;
          if (needsTools && tools && toolExecutor) {
            result = await this._chatWithTools(provider, model.id, messages, tools, toolExecutor, { systemPrompt });
          } else {
            result = await this._chat(provider, model.id, messages, { systemPrompt });
          }

          if (result?.content) {
            this.stats.cloud++;
            this._lastUsed = { provider: provider.id, model: model.id };
            return {
              ...result,
              tier: provider === cloud[0] && model === provider.models[0] ? 'primary' : 'fallback',
              provider: provider.name,
              providerId: provider.id,
            };
          }

          // Empty content, try next model
          this.stats.rotations++;
        } catch (err) {
          lastError = err;
          this.stats.rotations++;
          console.error(`[OpenClaw] ${provider.name}/${model.id}: ${err.message}`);
          continue;
        }
      }
    }

    // ── TRY OLLAMA ──
    try {
      const result = await localClient.chat(messages, { systemPrompt });
      if (result?.content) {
        this.stats.local++;
        this._lastUsed = { provider: 'ollama', model: localClient.model };
        return { ...result, tier: 'local', provider: 'Ollama Local', providerId: 'ollama' };
      }
    } catch (err) {
      lastError = err;
      console.error(`[OpenClaw] Ollama: ${err.message}`);
    }

    // ── ABSOLUTE LAST RESORT: cloud WITHOUT tools ──
    if (needsTools) {
      for (const provider of sorted) {
        try {
          const model = provider.models[0]?.id;
          if (!model) continue;
          const result = await this._chat(provider, model, messages, { systemPrompt });
          if (result?.content) {
            this.stats.cloud++;
            return { ...result, tier: 'emergency-no-tools', provider: provider.name, providerId: provider.id };
          }
        } catch { continue; }
      }
    }

    return null;
  }

  // ─── CLOUD CHAT (with per-key rotation) ────────────────────
  //
  // The key innovation: on 429, we cooldown THAT key and try
  // the NEXT key. Not the whole provider. This is how OpenClaw
  // survives rate limits with multiple keys.

  async _chat(provider, modelId, messages, opts = {}) {
    const { systemPrompt, tools = null } = opts;

    const fullMsgs = [];
    if (systemPrompt) fullMsgs.push({ role: 'system', content: systemPrompt });
    fullMsgs.push(...messages);

    // Get all available keys, or ALL keys as last resort
    let keys = this._availableKeys(provider);
    if (keys.length === 0) keys = [...provider.keys]; // Try anyway — circuit breaker may have just reset

    for (const ks of keys) {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await apiCall(provider.baseUrl, ks.key, modelId, fullMsgs, { tools });

          if (result.error && !result.content) throw new Error(result.error);

          ks.onSuccess(result.usage?.total_tokens || 0);
          return result;

        } catch (err) {
          // 429 = rate limit → cooldown THIS key, try NEXT key
          if (err.code === 429) {
            ks.onRateLimit();
            this.stats.keyRotations++;
            console.warn(`[OpenClaw] ${provider.name} key #${provider.keys.indexOf(ks) + 1} rate limited → cooling ${Math.round((ks.cooldownUntil - Date.now()) / 1000)}s`);
            break; // next key
          }

          // 402 = billing → disable key long-term
          if (err.code === 402) {
            ks.onBillingError();
            console.warn(`[OpenClaw] ${provider.name} key #${provider.keys.indexOf(ks) + 1} billing error → disabled 1h`);
            break;
          }

          // 401/403 = auth → disable key permanently
          if (err.code === 401 || err.code === 403) {
            ks.disabled = true;
            console.error(`[OpenClaw] ${provider.name} key #${provider.keys.indexOf(ks) + 1} auth failed → disabled`);
            break;
          }

          ks.onFailure();

          // Retryable → retry same key
          if (attempt < MAX_RETRIES && isRetryable(err)) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 4000));
            continue;
          }

          break; // next key
        }
      }
    }

    throw new Error(`${provider.name}: all ${provider.keys.length} keys exhausted`);
  }

  // ─── TOOL LOOP (unified for all providers) ─────────────────
  //
  // One tool loop for Kimi AND Groq. No duplicate code.
  //
  // Key fixes (from live debugging):
  //   - tool_call_id: generate stable IDs if provider omits them
  //   - timeout: 45s (reports query Supabase, 6 reports can take 30s+)
  //   - mid-loop failure: strip tool messages and retry text-only
  //   - key rotation: _chat() already rotates keys per call
  //   - diagnostics: log actual error, not generic message

  async _chatWithTools(provider, modelId, messages, tools, toolExecutor, opts = {}) {
    const { systemPrompt } = opts;
    let currentMsgs = [...messages];
    let round = 0;
    let toolCallCounter = 0;

    while (round < MAX_TOOL_ROUNDS) {
      let result;
      try {
        result = await this._chat(provider, modelId, currentMsgs, {
          systemPrompt: round === 0 ? systemPrompt : undefined,
          tools,
        });
      } catch (err) {
        console.error(`[OpenClaw] Tool loop round ${round} chat failed: ${err.message}`);

        // Mid-loop failure — try to salvage
        if (round > 0) {
          // Strip tool messages and try text-only with just user messages
          // (avoids tool_call_id mismatch when switching providers)
          const textOnlyMsgs = currentMsgs.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls));

          // Try same provider text-only
          try { return await this._chat(provider, modelId, textOnlyMsgs, { systemPrompt }); } catch (e2) {
            console.error(`[OpenClaw] Text-only fallback same provider failed: ${e2.message}`);
          }

          // Try OTHER providers text-only
          for (const alt of this.providers) {
            if (alt.id === provider.id) continue;
            try {
              const m = alt.models[0]?.id;
              if (m) return await this._chat(alt, m, textOnlyMsgs, { systemPrompt });
            } catch { continue; }
          }

          // Absolute last resort: return a useful error, not generic
          console.error(`[OpenClaw] ALL tool-loop recovery failed. Original error: ${err.message}`);
          return {
            content: 'I had trouble processing your request — the data service timed out. Please try again in a moment, or use a specific command like /report1 instead of all reports at once.',
            error: err.message,
          };
        }
        throw err;
      }

      if (!result.toolCalls) return result;

      // ─── Execute tool calls ───
      // Ensure every tool_call has a stable ID (some providers omit it)
      const normalizedToolCalls = result.toolCalls.map(tc => ({
        ...tc,
        id: tc.id || `call_${++toolCallCounter}_${Date.now()}`,
      }));

      currentMsgs.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: normalizedToolCalls,
      });

      for (const tc of normalizedToolCalls) {
        let toolResult;
        const name = tc.function?.name || 'unknown';
        try {
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }

          toolResult = await Promise.race([
            toolExecutor(name, args),
            new Promise((_, rej) => setTimeout(() => rej(new Error(`Tool ${name} timed out after ${TOOL_TIMEOUT / 1000}s`)), TOOL_TIMEOUT)),
          ]);
        } catch (err) {
          console.error(`[OpenClaw] Tool "${name}" failed: ${err.message}`);
          toolResult = `[TOOL ERROR: ${name} failed — ${err.message}. Do NOT guess or invent data. Tell the user the tool failed.]`;
        }

        currentMsgs.push({
          role: 'tool',
          tool_call_id: tc.id,  // Always matches — we normalized above
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult || { error: 'no result' }),
        });
      }

      round++;
    }

    // Exceeded rounds — final text response
    const textOnlyMsgs = currentMsgs.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls));
    try { return await this._chat(provider, modelId, textOnlyMsgs, { systemPrompt }); } catch {}
    return { content: 'I processed your request but hit complexity limits. Please try a simpler question.' };
  }

  // ─── HEALTH CHECK ──────────────────────────────────────────

  async _healthCheck() {
    this.stats.healthChecks++;

    for (const provider of this.providers) {
      for (const ks of provider.keys) {
        if (ks.isAvailable) continue; // Already good

        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 5000);
          const res = await fetch(`${provider.baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${ks.key}` },
            signal: ctrl.signal,
          });
          clearTimeout(t);

          if (res.ok) {
            const wasDead = ks.circuitOpen || ks.disabled;
            ks.reset();
            if (wasDead) {
              this.stats.recoveries++;
              console.log(`[OpenClaw] ${provider.name} key #${provider.keys.indexOf(ks) + 1} recovered!`);
            }
          }
        } catch { /* still dead */ }
      }
    }

    try { this.localAvailable = await localClient.isAvailable(); } catch { this.localAvailable = false; }
  }

  // ─── COMPAT API (matches old providers.js) ─────────────────

  getProvider(opts = {}) {
    const config = require('../config');
    const preferred = config.cloudProvider || 'kimi';
    const sorted = [...this.providers].sort((a, b) => {
      if (a.id === preferred) return -1;
      if (b.id === preferred) return 1;
      return 0;
    });

    for (const p of sorted) {
      if (this._nextKey(p)) {
        // Undo the advance
        p.keyIndex = (p.keyIndex - 1 + p.keys.length) % p.keys.length;
        return { id: p.id, name: p.name, type: p.type, configured: true, healthy: true, supportsTools: p.supportsTools };
      }
    }

    return { id: 'ollama', name: 'Ollama Local', type: 'local', configured: true, healthy: this.localAvailable, supportsTools: false };
  }

  getStatus() {
    return {
      engine: 'OpenClaw',
      providers: this.providers.map(p => ({
        id: p.id, name: p.name,
        keys: p.keys.map((k, i) => ({
          index: i + 1,
          available: k.isAvailable,
          circuitOpen: k.circuitOpen,
          disabled: k.disabled,
          cooldown: k.cooldownUntil > Date.now() ? Math.round((k.cooldownUntil - Date.now()) / 1000) + 's' : null,
          calls: k.calls, tokens: k.tokens, errors: k.errors,
        })),
        models: p.models.map(m => m.id),
        supportsTools: p.supportsTools,
      })),
      local: { available: this.localAvailable, model: localClient.model },
      lastUsed: this._lastUsed,
      stats: { ...this.stats },
    };
  }

  async recheckAll() {
    await this._healthCheck();
    return this.getStatus();
  }

  destroy() {
    if (this._healthTimer) { clearInterval(this._healthTimer); this._healthTimer = null; }
  }
}

module.exports = new OpenClawEngine();
