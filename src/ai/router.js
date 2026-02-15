const kimiClient = require('./kimi-client');
const geminiClient = require('./gemini-client');
const localClient = require('./local-client');
const { TOOLS, executeTool } = require('./kimi-tools');
const syncEngine = require('../supabase/services/sync');
const policies = require('../brain/policies');
const responseCache = require('../utils/cache');

/**
 * AI Router - Routes messages to the best available AI engine.
 *
 * Priority chain:
 *   Tier 1 (Local - FREE):  Simple chat, FAQ, greetings (Ollama/Llama)
 *   Tier 2 (Cloud - Kimi):  Complex queries with tool calling for live data
 *   Tier 3 (Cloud - Gemini): Fallback cloud AI when Kimi unavailable
 *
 * Features:
 *   - Response caching for common queries
 *   - Automatic fallback between engines
 *   - Tool calling via Kimi K2
 *   - Stats tracking per engine
 */

const CLOUD_TRIGGERS = [
  'report', 'analysis', 'analytics', 'earnings', 'revenue', 'financial',
  'forecast', 'predict', 'compare', 'summary',
  'generate code', 'create website', 'design', 'build', 'html', 'css',
  'fraud', 'suspicious', 'investigate', 'audit',
  'why', 'explain in detail', 'recommend', 'strategy', 'optimize',
  'write email', 'draft', 'compose', 'proposal', 'marketing',
  'how many', 'total', 'count', 'list all',
  'which car', 'available', 'booking', 'customer',
  'remind', 'schedule', 'call', 'generate', 'site',
];

class AIRouter {
  constructor() {
    this.localAvailable = false;
    this.kimiAvailable = false;
    this.geminiAvailable = false;
    this.stats = { local: 0, cloud: 0, gemini: 0, fallback: 0, toolCalls: 0, cacheHits: 0 };
  }

  async init() {
    // Check all engines in parallel
    const [localOk, kimiOk, geminiOk] = await Promise.all([
      localClient.isAvailable(),
      kimiClient.isAvailable(),
      geminiClient.isAvailable(),
    ]);

    this.localAvailable = localOk;
    this.kimiAvailable = kimiOk;
    this.geminiAvailable = geminiOk;

    console.log(`[AI Router] Local: ${localOk ? 'OK' : 'OFFLINE'} | Kimi K2: ${kimiOk ? 'OK' : 'OFFLINE'} | Gemini: ${geminiOk ? 'OK' : 'OFFLINE'}`);

    if (!kimiOk && !geminiOk) {
      console.warn('[AI Router] No cloud AI available. Set KIMI_API_KEY or GEMINI_API_KEY in .env');
    }
  }

  classify(message) {
    const lower = message.toLowerCase();
    for (const trigger of CLOUD_TRIGGERS) {
      if (lower.includes(trigger)) return 'cloud';
    }
    if (message.length > 300) return 'cloud';
    return 'local';
  }

  async route(userMessage, conversationHistory = [], options = {}) {
    const {
      forceCloud = false,
      forceLocal = false,
      isAdmin = false,
      systemPrompt = null,
      intent = null,
    } = options;

    // Check cache first
    const cachePolicy = responseCache.shouldCache(intent);
    if (cachePolicy.cache && !forceCloud) {
      const cached = responseCache.get(userMessage);
      if (cached) {
        this.stats.cacheHits++;
        return { ...cached, tier: 'cache', cached: true };
      }
    }

    const context = syncEngine.buildContextSummary();
    const policyContext = policies.buildPolicyContext();
    const fullSystemPrompt = this._buildSystemPrompt(context, policyContext, isAdmin, systemPrompt);

    let tier = forceCloud ? 'cloud' : forceLocal ? 'local' : this.classify(userMessage);

    if (isAdmin && tier === 'local' && userMessage.length > 100) {
      tier = 'cloud';
    }

    const messages = [
      ...conversationHistory.slice(-10),
      { role: 'user', content: userMessage },
    ];

    try {
      let result;

      // Try Kimi K2 (primary cloud with tool calling)
      if ((tier === 'cloud' || !this.localAvailable) && this.kimiAvailable) {
        this.stats.cloud++;
        result = await kimiClient.chatWithTools(
          messages, TOOLS,
          async (name, args) => { this.stats.toolCalls++; return executeTool(name, args); },
          { systemPrompt: fullSystemPrompt }
        );
        result = { ...result, tier: 'cloud' };
      }
      // Try Gemini (secondary cloud, no tool calling)
      else if ((tier === 'cloud' || !this.localAvailable) && this.geminiAvailable) {
        this.stats.gemini++;
        result = await geminiClient.chat(messages, { systemPrompt: fullSystemPrompt });
        result = { ...result, tier: 'gemini' };
      }
      // Use local
      else if (this.localAvailable) {
        this.stats.local++;
        result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        result = { ...result, tier: tier === 'cloud' ? 'fallback-local' : 'local' };
      }
      else {
        throw new Error('No AI engines available. Set KIMI_API_KEY, GEMINI_API_KEY, or install Ollama.');
      }

      // Cache the result
      if (cachePolicy.cache && result.content) {
        responseCache.set(userMessage, result, cachePolicy.ttl);
      }

      return result;

    } catch (err) {
      console.error(`[AI Router] ${tier} failed:`, err.message);

      // Fallback chain: Kimi → Gemini → Local
      if (tier !== 'gemini' && this.geminiAvailable) {
        try {
          this.stats.fallback++;
          const result = await geminiClient.chat(messages, { systemPrompt: fullSystemPrompt });
          return { ...result, tier: 'fallback-gemini' };
        } catch (geminiErr) {
          console.error('[AI Router] Gemini fallback failed:', geminiErr.message);
        }
      }

      if (tier !== 'local' && this.localAvailable) {
        this.stats.fallback++;
        const result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'fallback-local' };
      }

      if (tier === 'local' && this.kimiAvailable) {
        this.stats.fallback++;
        const result = await kimiClient.chatWithTools(messages, TOOLS, executeTool, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'fallback-cloud' };
      }

      throw err;
    }
  }

  _buildSystemPrompt(context, policyContext, isAdmin, customPrompt) {
    const parts = [
      'You are JARVIS, AI assistant for JRV Car Rental in Seremban, Malaysia.',
      'Format: *bold headers* + ```monospace data```.',
      'No corporate BS — straight to data.',
      'Match the user\'s language (Malay/English/Chinese/Tamil).',
      'All amounts in RM. All dates in Malaysia Time (MYT).',
      '',
      isAdmin
        ? 'User is ADMIN. Full data access. Show car plates.'
        : 'User is CUSTOMER. NEVER share plates, admin phones, or other customer data.',
      '',
      'You have tools to query live data. USE THEM instead of guessing.',
      'When asked about availability, pricing, bookings — call the relevant tool.',
      '',
      policyContext,
      '',
      context,
    ];
    if (customPrompt) parts.push('', customPrompt);
    return parts.join('\n');
  }

  getStats() {
    return {
      ...this.stats,
      kimiStats: kimiClient.getStats(),
      geminiStats: geminiClient.getStats(),
      cacheStats: responseCache.getStats(),
    };
  }
}

module.exports = new AIRouter();
