/**
 * JARVIS Memory & Dynamic Rules System
 *
 * Gives JARVIS a persistent brain — boss can teach rules, store memories,
 * and update knowledge via WhatsApp chat. No code changes needed.
 *
 * Storage: Supabase bot_data_store with key prefixes:
 *   "memory:<id>"  — Facts, preferences, notes JARVIS should remember
 *   "rule:<id>"    — Dynamic operational rules added via chat
 *
 * Memory types:
 *   fact     — Business facts ("airport pickup is RM80")
 *   pref     — Preferences ("RJ prefers English reports")
 *   note     — Contextual notes ("Customer Ali always pays late")
 *   skill    — How to do things ("When asked about insurance, explain excess")
 *
 * Rule types:
 *   always   — Always do this ("always ask for IC before confirming")
 *   never    — Never do this ("never give discount without boss approval")
 *   when     — Conditional ("when customer asks about Proton X50, mention it's popular")
 *   override — Override a hardcoded policy ("deposit is now RM200 for foreigners")
 */

const { dataStoreService } = require('../supabase/services');

class JarvisMemory {
  constructor() {
    this._memories = [];   // Loaded from DB
    this._rules = [];      // Loaded from DB
    this._loaded = false;
  }

  // ─── Init (load from Supabase) ────────────────────────

  async load() {
    try {
      const [memData, ruleData] = await Promise.all([
        dataStoreService.getByKeyPrefix('memory:'),
        dataStoreService.getByKeyPrefix('rule:'),
      ]);

      this._memories = (memData || []).map(entry => ({
        id: entry.key.replace('memory:', ''),
        ...((typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value) || {}),
      }));

      this._rules = (ruleData || []).map(entry => ({
        id: entry.key.replace('rule:', ''),
        ...((typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value) || {}),
      }));

      this._loaded = true;
      console.log(`[Memory] Loaded ${this._memories.length} memories, ${this._rules.length} rules`);
    } catch (err) {
      console.error('[Memory] Failed to load:', err.message);
      this._loaded = true; // Don't block even if load fails
    }
  }

  // ─── Memory CRUD ──────────────────────────────────────

  async saveMemory(content, type = 'fact', tags = [], createdBy = 'boss') {
    const id = this._generateId();
    const memory = {
      content,
      type,
      tags,
      createdBy,
      createdAt: new Date().toISOString(),
      active: true,
    };

    await dataStoreService.setValue(`memory:${id}`, memory);
    this._memories.push({ id, ...memory });

    console.log(`[Memory] Saved: ${id} — "${content.slice(0, 80)}"`);
    return { id, ...memory };
  }

  async deleteMemory(id) {
    const idx = this._memories.findIndex(m => m.id === id);
    if (idx === -1) return false;

    // Soft delete — mark inactive
    this._memories[idx].active = false;
    await dataStoreService.setValue(`memory:${id}`, this._memories[idx]);
    this._memories.splice(idx, 1);

    console.log(`[Memory] Deleted: ${id}`);
    return true;
  }

  searchMemories(query) {
    if (!query) return this._memories.filter(m => m.active !== false);

    const lower = query.toLowerCase();
    return this._memories.filter(m =>
      m.active !== false && (
        (m.content || '').toLowerCase().includes(lower) ||
        (m.tags || []).some(t => t.toLowerCase().includes(lower)) ||
        (m.type || '').toLowerCase().includes(lower)
      )
    );
  }

  listMemories(type = null) {
    let list = this._memories.filter(m => m.active !== false);
    if (type) list = list.filter(m => m.type === type);
    return list;
  }

  // ─── Rules CRUD ───────────────────────────────────────

  async addRule(content, type = 'always', priority = 'normal', createdBy = 'boss') {
    const id = this._generateId();
    const rule = {
      content,
      type,
      priority,
      createdBy,
      createdAt: new Date().toISOString(),
      active: true,
    };

    await dataStoreService.setValue(`rule:${id}`, rule);
    this._rules.push({ id, ...rule });

    console.log(`[Memory] Rule added: ${id} — "${content.slice(0, 80)}"`);
    return { id, ...rule };
  }

  async updateRule(id, content) {
    const rule = this._rules.find(r => r.id === id);
    if (!rule) return null;

    rule.content = content;
    rule.updatedAt = new Date().toISOString();
    await dataStoreService.setValue(`rule:${id}`, rule);

    console.log(`[Memory] Rule updated: ${id}`);
    return rule;
  }

  async deleteRule(id) {
    const idx = this._rules.findIndex(r => r.id === id);
    if (idx === -1) return false;

    this._rules[idx].active = false;
    await dataStoreService.setValue(`rule:${id}`, this._rules[idx]);
    this._rules.splice(idx, 1);

    console.log(`[Memory] Rule deleted: ${id}`);
    return true;
  }

  listRules(type = null) {
    let list = this._rules.filter(r => r.active !== false);
    if (type) list = list.filter(r => r.type === type);
    return list;
  }

  searchRules(query) {
    if (!query) return this.listRules();

    const lower = query.toLowerCase();
    return this._rules.filter(r =>
      r.active !== false && (
        (r.content || '').toLowerCase().includes(lower) ||
        (r.type || '').toLowerCase().includes(lower)
      )
    );
  }

  // ─── Build context for AI system prompt ───────────────

  buildMemoryContext() {
    const activeMemories = this._memories.filter(m => m.active !== false);
    const activeRules = this._rules.filter(r => r.active !== false);

    if (activeMemories.length === 0 && activeRules.length === 0) return '';

    const parts = [];

    if (activeRules.length > 0) {
      parts.push('=== DYNAMIC RULES (added by boss, MUST follow) ===');
      const highPriority = activeRules.filter(r => r.priority === 'high');
      const normalRules = activeRules.filter(r => r.priority !== 'high');

      if (highPriority.length > 0) {
        parts.push('HIGH PRIORITY:');
        highPriority.forEach(r => parts.push(`  [${r.type.toUpperCase()}] ${r.content}`));
      }
      normalRules.forEach(r => parts.push(`  [${r.type.toUpperCase()}] ${r.content}`));
      parts.push('');
    }

    if (activeMemories.length > 0) {
      parts.push('=== JARVIS MEMORY (things you were told to remember) ===');
      const byType = {};
      for (const m of activeMemories) {
        const t = m.type || 'fact';
        if (!byType[t]) byType[t] = [];
        byType[t].push(m);
      }

      for (const [type, memories] of Object.entries(byType)) {
        parts.push(`${type.toUpperCase()}S:`);
        memories.forEach(m => {
          const tags = (m.tags || []).length > 0 ? ` [${m.tags.join(', ')}]` : '';
          parts.push(`  - ${m.content}${tags}`);
        });
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  // ─── Helpers ──────────────────────────────────────────

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  getStats() {
    return {
      memories: this._memories.filter(m => m.active !== false).length,
      rules: this._rules.filter(r => r.active !== false).length,
      loaded: this._loaded,
    };
  }
}

module.exports = new JarvisMemory();
