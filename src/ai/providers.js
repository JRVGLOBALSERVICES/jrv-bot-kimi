const kimiClient = require('./kimi-client');
const groqClient = require('./groq-client');
const localClient = require('./local-client');
const config = require('../config');

/**
 * Unified Provider System — OpenClaw-style failover rotation.
 *
 * Instead of picking one provider and hoping it works,
 * this rotates through ALL configured providers automatically.
 * If Kimi dies → Groq takes over → if Groq dies → Ollama takes over.
 *
 * KEY DESIGN: "configured" = has API key. We ALWAYS try configured providers.
 * We do NOT gate on isAvailable() — that checks /models which often fails
 * even when /chat/completions works fine. Let the actual chat call decide.
 */

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // Re-check status every 5 min

class ProviderSystem {
  constructor() {
    this.providers = [
      { id: 'kimi', client: kimiClient, name: 'Kimi K2.5', type: 'cloud', configured: false, healthy: false, supportsTools: true, priority: 1 },
      { id: 'groq', client: groqClient, name: 'Groq Llama', type: 'cloud', configured: false, healthy: false, supportsTools: true, priority: 2 },
      { id: 'ollama', client: localClient, name: 'Ollama Local', type: 'local', configured: true, healthy: false, supportsTools: false, priority: 3 },
    ];

    this._healthCheckTimer = null;
    this._lastUsedProvider = null;
    this.stats = {
      rotations: 0,
      healthChecks: 0,
      recoveries: 0,
    };
  }

  async init() {
    // Mark which providers are CONFIGURED (have credentials)
    this.providers[0].configured = !!(config.kimi.apiKey && config.kimi.apiKey !== 'placeholder');
    this.providers[1].configured = !!config.groq.apiKey;
    this.providers[2].configured = true; // Ollama is always "configured" (localhost)

    // Health checks — nice to have, not a gate
    const checks = await Promise.allSettled(
      this.providers.map(p => p.configured ? p.client.isAvailable() : Promise.resolve(false))
    );

    for (let i = 0; i < this.providers.length; i++) {
      this.providers[i].healthy = checks[i].status === 'fulfilled' ? checks[i].value : false;
    }

    // Start background health checks
    this._healthCheckTimer = setInterval(() => this._healthCheck(), HEALTH_CHECK_INTERVAL);

    const status = this.providers
      .filter(p => p.configured)
      .map(p => `${p.name}: ${p.healthy ? 'OK' : 'CONFIGURED (health check failed, will try anyway)'}`)
      .join(' | ');
    console.log(`[Providers] ${status}`);

    const unconfigured = this.providers.filter(p => !p.configured).map(p => p.name);
    if (unconfigured.length > 0) {
      console.log(`[Providers] Not configured: ${unconfigured.join(', ')}`);
    }

    return this;
  }

  /**
   * Get the best provider for system prompt display.
   */
  getProvider(opts = {}) {
    const { needsTools = false } = opts;

    let sorted = [...this.providers].filter(p => p.configured);
    if (needsTools) sorted = sorted.filter(p => p.supportsTools);

    if (config.cloudProvider === 'groq') {
      sorted.sort((a, b) => {
        if (a.id === 'groq') return -1;
        if (b.id === 'groq') return 1;
        return a.priority - b.priority;
      });
    } else {
      sorted.sort((a, b) => a.priority - b.priority);
    }

    return sorted[0] || null;
  }

  /**
   * Get ALL configured providers in priority order for rotation.
   *
   * KEY: Healthy providers first, then unhealthy-but-configured.
   * We ALWAYS include configured providers — the actual API call will
   * reveal if they work. isAvailable() checking /models is unreliable.
   */
  _getRotationChain(opts = {}) {
    const { needsTools = false } = opts;

    let pool = this.providers.filter(p => p.configured);
    if (needsTools) {
      pool = pool.filter(p => p.supportsTools);
    }

    // Sort: healthy first, then by priority, then by cloudProvider preference
    if (config.cloudProvider === 'groq') {
      pool.sort((a, b) => {
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        if (a.id === 'groq') return -1;
        if (b.id === 'groq') return 1;
        return a.priority - b.priority;
      });
    } else {
      pool.sort((a, b) => {
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        return a.priority - b.priority;
      });
    }

    return pool;
  }

  /**
   * Execute a chat request with automatic failover rotation.
   * Tries EVERY configured provider — healthy ones first, then the rest.
   *
   * @param {Array} messages - Chat messages
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {Array} opts.tools - Tool definitions
   * @param {Function} opts.toolExecutor - Tool executor function
   * @param {boolean} opts.isAdmin
   * @returns {Promise<object|null>} - { content, tier, provider, usage, ... } or null
   */
  async execute(messages, opts = {}) {
    const { systemPrompt, tools, toolExecutor, isAdmin = false } = opts;
    const needsTools = !!(tools && tools.length > 0);

    // Get ALL configured providers (healthy first, then rest)
    const chain = this._getRotationChain({ needsTools });

    if (chain.length === 0 && !needsTools) {
      return null; // Literally nothing configured
    }

    let lastError = null;

    // Try each provider in rotation
    for (const provider of chain) {
      try {
        let result;

        if (provider.supportsTools && tools && toolExecutor) {
          result = await provider.client.chatWithTools(
            messages, tools, toolExecutor,
            { systemPrompt, maxRounds: 3 }
          );
        } else {
          result = await provider.client.chat(messages, { systemPrompt });
        }

        // Validate we got actual content
        if (result && result.content) {
          // Mark as healthy since it just worked
          provider.healthy = true;
          this._lastUsedProvider = provider.id;

          return {
            ...result,
            tier: provider === chain[0] ? 'primary' : 'fallback',
            provider: provider.name,
            providerId: provider.id,
          };
        }

        // Empty content — try next
        console.warn(`[Providers] ${provider.name} returned empty content, rotating...`);
        this.stats.rotations++;

      } catch (err) {
        lastError = err;
        this.stats.rotations++;
        provider.healthy = false; // Mark unhealthy (but stays in rotation for next request)
        console.error(`[Providers] ${provider.name} failed: ${err.message}`);
        continue;
      }
    }

    // All tool-capable providers failed — try Ollama without tools as absolute last resort
    if (needsTools) {
      const ollama = this.providers.find(p => p.id === 'ollama' && p.configured);
      if (ollama && !chain.includes(ollama)) {
        try {
          console.log('[Providers] All cloud failed, trying Ollama (no tools)');
          const result = await ollama.client.chat(messages, { systemPrompt });
          if (result?.content) {
            ollama.healthy = true;
            return { ...result, tier: 'emergency-local', provider: 'Ollama', providerId: 'ollama' };
          }
        } catch (err) {
          console.error('[Providers] Ollama last-resort also failed:', err.message);
        }
      }
    }

    return null; // All providers exhausted — router handles emergency response
  }

  /**
   * Background health check — update healthy status.
   * This is informational only — providers aren't gated on health.
   */
  async _healthCheck() {
    this.stats.healthChecks++;

    const checks = await Promise.allSettled(
      this.providers
        .filter(p => p.configured)
        .map(p => p.client.isAvailable())
    );

    const configured = this.providers.filter(p => p.configured);
    for (let i = 0; i < configured.length; i++) {
      const wasHealthy = configured[i].healthy;
      configured[i].healthy = checks[i].status === 'fulfilled' ? checks[i].value : false;

      if (!wasHealthy && configured[i].healthy) {
        this.stats.recoveries++;
        console.log(`[Providers] ${configured[i].name} recovered!`);
      }
    }

    // Also reset circuit breakers on clients that have recovered
    // (The circuit breaker auto-resets after 60s, but this ensures clean state)
  }

  /**
   * Get detailed provider status for /status command.
   */
  getStatus() {
    return {
      providers: this.providers.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        configured: p.configured,
        healthy: p.healthy,
        supportsTools: p.supportsTools,
        stats: p.client.getStats ? p.client.getStats() : {},
      })),
      lastUsed: this._lastUsedProvider,
      ...this.stats,
    };
  }

  /**
   * Force re-check all providers.
   */
  async recheckAll() {
    await this._healthCheck();
    return this.getStatus();
  }

  destroy() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }
}

module.exports = new ProviderSystem();
