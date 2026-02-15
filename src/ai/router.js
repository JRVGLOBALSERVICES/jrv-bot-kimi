const kimiClient = require('./kimi-client');
const localClient = require('./local-client');
const syncEngine = require('../supabase/services/sync');

/**
 * AI Router - Decides whether to use local (Jetson) or cloud (Kimi K2).
 *
 * Tier 1 (Local - FREE):  Simple chat, FAQ, car availability, pricing
 * Tier 2 (Cloud - Paid):  Reports, analytics, fraud detection, code gen, site design
 *
 * Falls back to cloud if local AI is unavailable.
 */

// Keywords that trigger cloud (Kimi K2) routing
const CLOUD_TRIGGERS = [
  // Reports & analytics
  'report', 'analysis', 'analytics', 'earnings', 'revenue', 'profit', 'financial',
  'forecast', 'predict', 'trend', 'compare', 'summary report',
  // Complex tasks
  'generate code', 'create website', 'design site', 'build page', 'html', 'css',
  'fraud', 'suspicious', 'investigate', 'audit',
  // Deep reasoning
  'why', 'explain in detail', 'recommend strategy', 'business plan',
  'optimize', 'suggest improvements',
  // Creative
  'write email', 'draft letter', 'compose', 'create proposal', 'marketing',
  'image', 'generate image', 'create picture',
];

// Keywords that stay local
const LOCAL_TRIGGERS = [
  'available', 'car', 'price', 'rate', 'book', 'rent',
  'deposit', 'location', 'deliver', 'pickup', 'return',
  'hi', 'hello', 'thanks', 'bye', 'help', 'info',
  'faq', 'question', 'how much', 'which car',
];

class AIRouter {
  constructor() {
    this.localAvailable = false;
    this.kimiAvailable = false;
    this.stats = { local: 0, cloud: 0, fallback: 0 };
  }

  async init() {
    this.localAvailable = await localClient.isAvailable();
    this.kimiAvailable = await kimiClient.isAvailable();
    console.log(`[AI Router] Local: ${this.localAvailable ? 'OK' : 'OFFLINE'} | Kimi K2: ${this.kimiAvailable ? 'OK' : 'OFFLINE'}`);
  }

  classify(message) {
    const lower = message.toLowerCase();

    // Check cloud triggers first (more specific)
    for (const trigger of CLOUD_TRIGGERS) {
      if (lower.includes(trigger)) return 'cloud';
    }

    // Message length heuristic: long messages often need deeper reasoning
    if (message.length > 500) return 'cloud';

    // Default to local for everything else
    return 'local';
  }

  async route(userMessage, conversationHistory = [], options = {}) {
    const {
      forceCloud = false,
      forceLocal = false,
      isAdmin = false,
      systemPrompt = null,
    } = options;

    // Build context from synced data
    const context = syncEngine.buildContextSummary();
    const fullSystemPrompt = this._buildSystemPrompt(context, isAdmin, systemPrompt);

    // Determine tier
    let tier = forceCloud ? 'cloud' : forceLocal ? 'local' : this.classify(userMessage);

    // Admin complex queries always go to cloud
    if (isAdmin && tier === 'local' && userMessage.length > 200) {
      tier = 'cloud';
    }

    // Build message array
    const messages = [
      ...conversationHistory.slice(-10), // Last 10 messages for context
      { role: 'user', content: userMessage },
    ];

    // Route to appropriate engine
    try {
      if (tier === 'local' && this.localAvailable) {
        this.stats.local++;
        const result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'local' };
      }

      if (this.kimiAvailable) {
        this.stats.cloud++;
        const result = await kimiClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'cloud' };
      }

      // Both unavailable — try local as last resort
      if (this.localAvailable) {
        this.stats.fallback++;
        const result = await localClient.chat(messages, { systemPrompt: fullSystemPrompt });
        return { ...result, tier: 'fallback-local' };
      }

      throw new Error('No AI engines available');
    } catch (err) {
      // Fallback chain: if preferred tier fails, try the other
      console.error(`[AI Router] ${tier} failed:`, err.message);

      if (tier === 'local' && this.kimiAvailable) {
        this.stats.fallback++;
        const result = await kimiClient.chat(messages, { systemPrompt: fullSystemPrompt });
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

  _buildSystemPrompt(context, isAdmin, customPrompt) {
    const base = `You are JARVIS, the AI assistant for JRV Car Rental in Malaysia.
You are helpful, professional, and speak in Malay or English depending on the customer's language.
You have access to live business data. Use it to answer accurately.

${isAdmin ? 'The user is an ADMIN. You can share sensitive data like earnings, customer details, and reports.' : 'The user is a CUSTOMER. Never share other customers\' details, internal pricing notes, or admin information.'}

${context}`;

    return customPrompt ? `${base}\n\n${customPrompt}` : base;
  }

  getStats() {
    return this.stats;
  }
}

module.exports = new AIRouter();
