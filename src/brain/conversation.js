/**
 * Conversation Manager — OpenClaw-style session management.
 *
 * Each conversation is a "session" with metadata:
 * - Message history (last 20)
 * - Language detection (4 languages)
 * - Session metadata: model used, token count, response times
 * - Intent tracking
 * - Provider preference per session
 *
 * Like OpenClaw: "Each conversation is a Session with metadata
 * (model, tokens, thinking level, verbose mode, group activation)"
 */
class ConversationManager {
  constructor() {
    this.conversations = new Map();
    this.maxHistory = 20;
    this.ttl = 30 * 60 * 1000; // 30 minutes
  }

  getOrCreate(phone) {
    if (!this.conversations.has(phone)) {
      this.conversations.set(phone, {
        phone,
        messages: [],
        context: {},
        language: null,
        lastActivity: Date.now(),
        intent: null,
        awaitingResponse: null,
        // ─── OpenClaw-style session metadata ───
        session: {
          totalTokens: 0,
          totalRequests: 0,
          lastProvider: null,
          lastModel: null,
          avgResponseMs: 0,
          createdAt: Date.now(),
        },
      });
    }

    const conv = this.conversations.get(phone);
    conv.lastActivity = Date.now();
    return conv;
  }

  /**
   * Track AI response metadata for this session.
   */
  trackResponse(phone, metadata = {}) {
    const conv = this.getOrCreate(phone);
    const s = conv.session;

    if (metadata.usage) {
      s.totalTokens += (metadata.usage.total_tokens || metadata.usage.prompt_tokens || 0) + (metadata.usage.completion_tokens || 0);
    }
    s.totalRequests++;
    if (metadata.provider) s.lastProvider = metadata.provider;
    if (metadata.model) s.lastModel = metadata.model;
    if (metadata.responseMs) {
      // Running average
      s.avgResponseMs = s.avgResponseMs === 0
        ? metadata.responseMs
        : Math.round((s.avgResponseMs * (s.totalRequests - 1) + metadata.responseMs) / s.totalRequests);
    }
  }

  /**
   * Get session summary for admin /status.
   */
  getSessionSummary(phone) {
    const conv = this.conversations.get(phone);
    if (!conv) return null;
    return {
      language: conv.language,
      intent: conv.intent,
      messages: conv.messages.length,
      ...conv.session,
    };
  }

  addMessage(phone, role, content, metadata = {}) {
    const conv = this.getOrCreate(phone);
    conv.messages.push({
      role,
      content,
      timestamp: Date.now(),
      ...metadata,
    });

    if (conv.messages.length > this.maxHistory) {
      conv.messages = conv.messages.slice(-this.maxHistory);
    }

    // Detect language from user messages
    if (role === 'user' && content) {
      const detected = this._detectLanguage(content);
      if (detected) conv.language = detected;
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

  cleanup() {
    const now = Date.now();
    for (const [phone, conv] of this.conversations) {
      if (now - conv.lastActivity > this.ttl) {
        this.conversations.delete(phone);
      }
    }
  }

  /**
   * Multi-language detection: Malay, English, Chinese (Simplified), Tamil.
   * Returns: 'ms' | 'en' | 'zh' | 'ta' | null
   */
  _detectLanguage(text) {
    if (!text) return null;
    const lower = text.toLowerCase();

    // Chinese detection: presence of CJK characters
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';

    // Tamil detection: presence of Tamil script
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';

    // Malay keywords
    const malayWords = [
      'saya', 'nak', 'boleh', 'ada', 'kereta', 'berapa', 'hari',
      'untuk', 'harga', 'terima kasih', 'minta', 'tolong', 'sewa',
      'bayar', 'pulang', 'ambil', 'hantar', 'sambung', 'batal',
      'sila', 'encik', 'puan', 'cik', 'dah', 'sudah', 'tak',
      'macam mana', 'bila', 'mana', 'ini', 'itu', 'selamat',
      'pagi', 'petang', 'malam', 'baik', 'okey', 'bolehkah',
      'percuma', 'deposit', 'tunai', 'akaun', 'resit', 'lesen',
    ];

    const malayCount = malayWords.filter(w => {
      if (w.length <= 3) {
        return new RegExp(`\\b${w}\\b`, 'i').test(lower);
      }
      return lower.includes(w);
    }).length;

    if (malayCount >= 2) return 'ms';

    return 'en';
  }

  getStats() {
    return {
      activeConversations: this.conversations.size,
      conversations: Array.from(this.conversations.entries()).map(([phone, conv]) => ({
        phone,
        messages: conv.messages.length,
        language: conv.language,
        intent: conv.intent,
        lastActivity: new Date(conv.lastActivity).toISOString(),
      })),
    };
  }
}

module.exports = new ConversationManager();
