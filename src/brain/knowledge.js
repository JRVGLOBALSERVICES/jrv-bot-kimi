/**
 * JARVIS Knowledge Base — Structured FAQ & Documentation
 *
 * Unlike memories (short facts), the KB stores structured articles:
 *   - FAQ entries with question/answer pairs
 *   - Policies/procedures as documents
 *   - Templates for common responses
 *   - How-to guides
 *
 * Admins manage via chat:
 *   "Add KB: insurance — Q: Is insurance included? A: Yes, basic insurance is
 *    included in all rentals. Full coverage costs extra RM15/day."
 *
 * JARVIS auto-references the KB when answering customer questions,
 * reducing the need to call tools or go to the AI for simple FAQs.
 *
 * Storage: Supabase bot_data_store with key prefix "kb:"
 */

const { dataStoreService } = require('../supabase/services');

class KnowledgeBase {
  constructor() {
    this._articles = [];
    this._loaded = false;
  }

  async load() {
    try {
      const data = await dataStoreService.getByKeyPrefix('kb:');
      this._articles = (data || []).map(entry => ({
        id: entry.key.replace('kb:', ''),
        ...(typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value),
      }));
      this._loaded = true;
      console.log(`[KB] Loaded ${this._articles.length} articles`);
    } catch (err) {
      console.error('[KB] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Add or update a knowledge base article.
   */
  async upsert(topic, { question, answer, category = 'general', tags = [], lang = 'en', createdBy = 'boss' }) {
    const id = topic.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = this._articles.find(a => a.id === id);

    const article = {
      topic,
      question: question || '',
      answer,
      category,
      tags,
      lang,
      createdBy,
      version: existing ? (existing.version || 0) + 1 : 1,
      active: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dataStoreService.setValue(`kb:${id}`, article);

    if (existing) {
      Object.assign(existing, { id, ...article });
    } else {
      this._articles.push({ id, ...article });
    }

    console.log(`[KB] Saved: ${id} (${category})`);
    return { id, ...article };
  }

  /**
   * Search the knowledge base for relevant articles.
   * Returns scored results — higher score = better match.
   */
  search(query, options = {}) {
    const { category, lang, limit = 5 } = options;
    if (!query) return this.list(category);

    const words = query.toLowerCase().split(/\s+/);
    const scored = [];

    for (const article of this._articles) {
      if (!article.active) continue;
      if (category && article.category !== category) continue;
      if (lang && article.lang !== lang) continue;

      let score = 0;
      const searchable = [
        article.topic,
        article.question,
        article.answer,
        ...(article.tags || []),
      ].join(' ').toLowerCase();

      for (const word of words) {
        if (word.length < 2) continue;
        // Exact word match in topic = 10 points
        if ((article.topic || '').toLowerCase().includes(word)) score += 10;
        // Question match = 5 points
        if ((article.question || '').toLowerCase().includes(word)) score += 5;
        // Tag match = 8 points
        if ((article.tags || []).some(t => t.toLowerCase().includes(word))) score += 8;
        // Answer match = 2 points
        if ((article.answer || '').toLowerCase().includes(word)) score += 2;
      }

      if (score > 0) {
        scored.push({ ...article, _score: score });
      }
    }

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit);
  }

  /**
   * Get a single article by ID.
   */
  get(id) {
    return this._articles.find(a => a.id === id && a.active) || null;
  }

  /**
   * List articles, optionally filtered.
   */
  list(category = null) {
    let list = this._articles.filter(a => a.active);
    if (category) list = list.filter(a => a.category === category);
    return list;
  }

  /**
   * Delete (deactivate) an article.
   */
  async delete(id) {
    const article = this._articles.find(a => a.id === id);
    if (!article) return false;

    article.active = false;
    await dataStoreService.setValue(`kb:${id}`, article);
    console.log(`[KB] Deleted: ${id}`);
    return true;
  }

  /**
   * Get all unique categories.
   */
  categories() {
    const cats = new Set();
    for (const a of this._articles) {
      if (a.active && a.category) cats.add(a.category);
    }
    return [...cats];
  }

  /**
   * Build context for AI system prompt — auto-inject relevant KB when needed.
   * Only includes article summaries (topic + question), not full answers,
   * to keep the prompt compact. AI uses the kb_search tool for full content.
   */
  buildKBContext() {
    const active = this._articles.filter(a => a.active);
    if (active.length === 0) return '';

    const parts = ['=== KNOWLEDGE BASE (use kb_search tool for full answers) ==='];
    const byCategory = {};
    for (const a of active) {
      const cat = a.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(a);
    }

    for (const [cat, articles] of Object.entries(byCategory)) {
      parts.push(`${cat.toUpperCase()} (${articles.length}):`);
      for (const a of articles) {
        const q = a.question ? ` — "${a.question}"` : '';
        parts.push(`  - ${a.topic}${q}`);
      }
    }
    parts.push('');
    return parts.join('\n');
  }

  getStats() {
    const active = this._articles.filter(a => a.active);
    return {
      total: active.length,
      categories: this.categories(),
    };
  }
}

module.exports = new KnowledgeBase();
