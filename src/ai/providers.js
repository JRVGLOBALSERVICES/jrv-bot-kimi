const kimiClient = require('./kimi-client');
const groqClient = require('./groq-client');
const localClient = require('./local-client');

/**
 * Unified Provider System — OpenClaw-style failover rotation.
 *
 * Instead of picking one provider and hoping it works,
 * this rotates through ALL available providers automatically.
 * If Kimi dies → Groq takes over → if Groq dies → Ollama takes over.
 * When providers recover, they rejoin the rotation.
 *
 * Like OpenClaw: "Profile rotation + fallbacks" with automatic switching on API errors.
 */

const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // Re-check dead providers every 5 min

class ProviderSystem {
  constructor() {
    this.providers = [
      { id: 'kimi', client: kimiClient, name: 'Kimi K2.5', type: 'cloud', available: false, supportsTools: true, priority: 1 },
      { id: 'groq', client: groqClient, name: 'Groq Llama', type: 'cloud', available: false, supportsTools: true, priority: 2 },
      { id: 'ollama', client: localClient, name: 'Ollama Local', type: 'local', available: false, supportsTools: false, priority: 3 },
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
    // Check all providers in parallel
    const checks = await Promise.allSettled(
      this.providers.map(p => p.client.isAvailable())
    );

    for (let i = 0; i < this.providers.length; i++) {
      this.providers[i].available = checks[i].status === 'fulfilled' ? checks[i].value : false;
    }

    // Start background health checks
    this._healthCheckTimer = setInterval(() => this._healthCheck(), HEALTH_CHECK_INTERVAL);

    const status = this.providers.map(p => `${p.name}: ${p.available ? 'OK' : 'OFFLINE'}`).join(' | ');
    console.log(`[Providers] ${status}`);

    return this;
  }

  /**
   * Get the best available provider for a given need.
   * @param {object} opts
   * @param {boolean} opts.needsTools - Whether tool calling is required
   * @param {string} opts.preferredProvider - Force a specific provider ID
   * @param {string} opts.excludeProvider - Skip this provider (for fallback rotation)
   * @returns {{ provider, client, name, type } | null}
   */
  getProvider(opts = {}) {
    const { needsTools = false, preferredProvider = null, excludeProvider = null } = opts;
    const cfg = require('../config');

    // Apply user's preferred cloud provider from config/dashboard
    let sorted = [...this.providers].filter(p => p.available);

    if (excludeProvider) {
      sorted = sorted.filter(p => p.id !== excludeProvider);
    }

    if (needsTools) {
      sorted = sorted.filter(p => p.supportsTools);
    }

    if (preferredProvider) {
      const pref = sorted.find(p => p.id === preferredProvider);
      if (pref) return pref;
    }

    // Respect config.cloudProvider preference
    if (cfg.cloudProvider === 'groq') {
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
   * Get ALL available providers in priority order (for rotation).
   */
  getProviderChain(opts = {}) {
    const { needsTools = false } = opts;
    const cfg = require('../config');

    let chain = this.providers.filter(p => p.available);
    if (needsTools) {
      chain = chain.filter(p => p.supportsTools);
    }

    if (cfg.cloudProvider === 'groq') {
      chain.sort((a, b) => {
        if (a.id === 'groq') return -1;
        if (b.id === 'groq') return 1;
        return a.priority - b.priority;
      });
    } else {
      chain.sort((a, b) => a.priority - b.priority);
    }

    return chain;
  }

  /**
   * Execute a chat request with automatic failover rotation.
   * Tries each provider in order until one succeeds.
   *
   * @param {Array} messages - Chat messages
   * @param {object} opts
   * @param {string} opts.systemPrompt
   * @param {Array} opts.tools - Tool definitions
   * @param {Function} opts.toolExecutor - Tool executor function
   * @param {boolean} opts.isAdmin
   * @returns {Promise<object>} - { content, tier, provider, usage, ... }
   */
  async execute(messages, opts = {}) {
    const { systemPrompt, tools, toolExecutor, isAdmin = false } = opts;
    const needsTools = !!(tools && tools.length > 0);

    const chain = this.getProviderChain({ needsTools });

    if (chain.length === 0) {
      // No providers at all — try local even without tools as last resort
      const localFallback = this.providers.find(p => p.id === 'ollama');
      if (localFallback) {
        try {
          const result = await localFallback.client.chat(messages, { systemPrompt });
          if (result?.content) {
            return { ...result, tier: 'emergency-local', provider: 'Ollama' };
          }
        } catch { /* fall through to emergency */ }
      }
      return null; // Router will handle emergency response
    }

    let lastError = null;

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
          this._lastUsedProvider = provider.id;
          return {
            ...result,
            tier: provider === chain[0] ? 'primary' : 'fallback',
            provider: provider.name,
            providerId: provider.id,
          };
        }

        // Empty content — try next provider
        console.warn(`[Providers] ${provider.name} returned empty content, rotating...`);
        this.stats.rotations++;

      } catch (err) {
        lastError = err;
        console.error(`[Providers] ${provider.name} failed: ${err.message}`);
        this.stats.rotations++;

        // Mark provider as temporarily dead if circuit breaker triggered
        if (err.message.includes('circuit breaker')) {
          provider.available = false;
          console.warn(`[Providers] ${provider.name} marked unavailable (circuit breaker)`);
        }

        // Continue to next provider
        continue;
      }
    }

    // All providers in chain failed — try local without tools as absolute last resort
    if (needsTools) {
      const localFallback = this.providers.find(p => p.id === 'ollama' && p.available);
      if (localFallback) {
        try {
          console.log('[Providers] All cloud providers failed, falling back to Ollama (no tools)');
          const result = await localFallback.client.chat(messages, { systemPrompt });
          if (result?.content) {
            return { ...result, tier: 'emergency-local', provider: 'Ollama' };
          }
        } catch (err) {
          console.error('[Providers] Ollama emergency fallback also failed:', err.message);
        }
      }
    }

    return null; // All providers exhausted
  }

  /**
   * Background health check — re-test dead providers periodically.
   * This is how providers auto-recover after going down.
   */
  async _healthCheck() {
    this.stats.healthChecks++;
    const dead = this.providers.filter(p => !p.available);

    if (dead.length === 0) return; // All healthy, skip

    const checks = await Promise.allSettled(
      dead.map(p => p.client.isAvailable())
    );

    for (let i = 0; i < dead.length; i++) {
      const wasDown = !dead[i].available;
      dead[i].available = checks[i].status === 'fulfilled' ? checks[i].value : false;

      if (wasDown && dead[i].available) {
        this.stats.recoveries++;
        console.log(`[Providers] ${dead[i].name} recovered! Re-joining rotation.`);
      }
    }
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
        available: p.available,
        supportsTools: p.supportsTools,
        stats: p.client.getStats ? p.client.getStats() : {},
      })),
      lastUsed: this._lastUsedProvider,
      ...this.stats,
    };
  }

  /**
   * Force re-check all providers (called from /tool or dashboard).
   */
  async recheckAll() {
    const checks = await Promise.allSettled(
      this.providers.map(p => p.client.isAvailable())
    );

    for (let i = 0; i < this.providers.length; i++) {
      this.providers[i].available = checks[i].status === 'fulfilled' ? checks[i].value : false;
    }

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
