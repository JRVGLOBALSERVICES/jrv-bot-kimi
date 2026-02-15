/**
 * Conversation Manager - Tracks conversation state per user.
 * Supports multi-language detection: Malay, English, Chinese, Tamil.
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
