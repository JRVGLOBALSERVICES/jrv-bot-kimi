/**
 * Conversation Manager - Tracks conversation state per user.
 * Stores message history, context, and preferences.
 */
class ConversationManager {
  constructor() {
    // Map of phone → conversation state
    this.conversations = new Map();
    this.maxHistory = 20; // Keep last 20 messages per user
    this.ttl = 30 * 60 * 1000; // 30 minutes conversation timeout
  }

  getOrCreate(phone) {
    if (!this.conversations.has(phone)) {
      this.conversations.set(phone, {
        phone,
        messages: [],
        context: {},
        language: null, // Auto-detect
        lastActivity: Date.now(),
        intent: null,
        awaitingResponse: null,
      });
    }

    const conv = this.conversations.get(phone);
    conv.lastActivity = Date.now();
    return conv;
  }

  addMessage(phone, role, content, metadata = {}) {
    const conv = this.getOrCreate(phone);
    conv.messages.push({
      role,
      content,
      timestamp: Date.now(),
      ...metadata,
    });

    // Trim old messages
    if (conv.messages.length > this.maxHistory) {
      conv.messages = conv.messages.slice(-this.maxHistory);
    }

    // Detect language from user messages
    if (role === 'user' && !conv.language) {
      conv.language = this._detectLanguage(content);
    }
  }

  getHistory(phone) {
    const conv = this.conversations.get(phone);
    if (!conv) return [];
    return conv.messages.map(m => ({ role: m.role, content: m.content }));
  }

  setContext(phone, key, value) {
    const conv = this.getOrCreate(phone);
    conv.context[key] = value;
  }

  getContext(phone) {
    const conv = this.conversations.get(phone);
    return conv ? conv.context : {};
  }

  setIntent(phone, intent) {
    const conv = this.getOrCreate(phone);
    conv.intent = intent;
  }

  setAwaiting(phone, awaiting) {
    const conv = this.getOrCreate(phone);
    conv.awaitingResponse = awaiting;
  }

  clear(phone) {
    this.conversations.delete(phone);
  }

  // Clean up expired conversations
  cleanup() {
    const now = Date.now();
    for (const [phone, conv] of this.conversations) {
      if (now - conv.lastActivity > this.ttl) {
        this.conversations.delete(phone);
      }
    }
  }

  _detectLanguage(text) {
    // Simple heuristic: Malay if common Malay words present
    const malayWords = ['saya', 'nak', 'boleh', 'ada', 'kereta', 'berapa', 'hari', 'untuk', 'harga', 'terima kasih', 'minta', 'tolong'];
    const lower = text.toLowerCase();
    const malayCount = malayWords.filter(w => lower.includes(w)).length;
    return malayCount >= 2 ? 'ms' : 'en';
  }

  getStats() {
    return {
      activeConversations: this.conversations.size,
      conversations: Array.from(this.conversations.entries()).map(([phone, conv]) => ({
        phone,
        messages: conv.messages.length,
        language: conv.language,
        lastActivity: new Date(conv.lastActivity).toISOString(),
      })),
    };
  }
}

module.exports = new ConversationManager();
