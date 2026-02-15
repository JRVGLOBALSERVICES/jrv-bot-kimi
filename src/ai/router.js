const kimiClient = require('./kimi-client');
const localClient = require('./local-client');
const { TOOLS, executeTool } = require('./kimi-tools');
const syncEngine = require('../supabase/services/sync');
const policies = require('../brain/policies');

/**
 * AI Router - Decides whether to use local (Ollama) or cloud (Kimi K2).
 *
 * Tier 1 (Local - FREE):  Simple chat, FAQ, greetings
 * Tier 2 (Cloud - Kimi):  Complex queries with tool calling for live data
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
];

class AIRouter {
  constructor() {
    this.localAvailable = false;
    this.kimiAvailable = false;
    this.stats = { local: 0, cloud: 0, fallback: 0, toolCalls: 0 };
  }

  async init() {
    this.localAvailable = await localClient.isAvailable();
    this.kimiAvailable = await kimiClient.isAvailable();
    console.log(`[AI Router] Local: ${this.localAvailable ? 'OK' : 'OFFLINE'} | Kimi K2: ${this.kimiAvailable ? 'OK' : 'OFFLINE'}`);
    if (!this.kimiAvailable) {
      console.warn('[AI Router] Kimi K2 unavailable. Set KIMI_API_KEY in .env');
      console.warn('[AI Router]   Get key: https://platform.moonshot.ai');
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
    } = options;

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
      if ((tier === 'cloud' || !this.localAvailable) && this.kimiAvailable) {
        this.stats.cloud++;
        const result = await kimiClient.chatWithTools(
          messages, TOOLS,
          async (name, args) => { this.stats.toolCalls++; return executeTool(name, args); },
          { systemPrompt: fullSystemPrompt }
        );
        return { ...result, tier: 'cloud' };
      }

      if (this.localAvailable) {
        this.stats.local++;
        const result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: tier === 'cloud' ? 'fallback-local' : 'local' };
      }

      throw new Error('No AI engines available. Set KIMI_API_KEY or install Ollama.');
    } catch (err) {
      console.error(`[AI Router] ${tier} failed:`, err.message);
      if (tier === 'local' && this.kimiAvailable) {
        this.stats.fallback++;
        const result = await kimiClient.chatWithTools(messages, TOOLS, executeTool, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'fallback-cloud' };
      }
      if (tier === 'cloud' && this.localAvailable) {
        this.stats.fallback++;
        const result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'fallback-local' };
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
    return { ...this.stats, kimiStats: kimiClient.getStats() };
  }
}

module.exports = new AIRouter();
