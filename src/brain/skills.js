/**
 * JARVIS Skill Scripts — Teachable Multi-Step Procedures
 *
 * Boss teaches JARVIS HOW to do things, not just facts.
 * Unlike memories (static knowledge), skills are executable procedures:
 *
 *   Boss: "Learn skill: accident_report — When customer reports accident:
 *          1. Ask for location and photos
 *          2. Ask if anyone is injured
 *          3. Get the plate number and check which car
 *          4. Notify boss immediately with all details
 *          5. Tell customer we will handle insurance claim"
 *
 *   JARVIS stores this as a skill and follows the steps when triggered.
 *
 * Storage: Supabase bot_data_store with key prefix "skill:"
 *
 * Skill format:
 *   {
 *     name: "accident_report",
 *     trigger: "customer reports accident",
 *     steps: ["Ask for location and photos", ...],
 *     context: "When customer reports accident",
 *     tags: ["emergency", "insurance"],
 *     createdBy: "boss",
 *     version: 1,
 *     enabled: true
 *   }
 */

const { dataStoreService } = require('../supabase/services');

class SkillManager {
  constructor() {
    this._skills = [];
    this._loaded = false;
  }

  async load() {
    try {
      const data = await dataStoreService.getByKeyPrefix('skill:');
      this._skills = (data || []).map(entry => ({
        id: entry.key.replace('skill:', ''),
        ...(typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value),
      }));
      this._loaded = true;
      console.log(`[Skills] Loaded ${this._skills.length} skills`);
    } catch (err) {
      console.error('[Skills] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Create or update a skill.
   */
  async save(name, { trigger, steps, context, tags = [], createdBy = 'boss' }) {
    const id = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = this._skills.find(s => s.id === id);

    const skill = {
      name,
      trigger: trigger || `When ${name.replace(/_/g, ' ')} is needed`,
      steps: Array.isArray(steps) ? steps : [steps],
      context: context || '',
      tags,
      createdBy,
      version: existing ? (existing.version || 0) + 1 : 1,
      enabled: true,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dataStoreService.setValue(`skill:${id}`, skill);

    if (existing) {
      Object.assign(existing, skill);
    } else {
      this._skills.push({ id, ...skill });
    }

    console.log(`[Skills] Saved: ${id} (v${skill.version}) — ${steps.length} steps`);
    return { id, ...skill };
  }

  /**
   * Find skills relevant to a query/situation.
   */
  find(query) {
    if (!query) return this._skills.filter(s => s.enabled);

    const lower = query.toLowerCase();
    return this._skills.filter(s =>
      s.enabled && (
        (s.name || '').toLowerCase().includes(lower) ||
        (s.trigger || '').toLowerCase().includes(lower) ||
        (s.context || '').toLowerCase().includes(lower) ||
        (s.tags || []).some(t => t.toLowerCase().includes(lower)) ||
        (s.steps || []).some(step => step.toLowerCase().includes(lower))
      )
    );
  }

  /**
   * Get a skill by ID.
   */
  get(id) {
    return this._skills.find(s => s.id === id && s.enabled) || null;
  }

  /**
   * Delete (disable) a skill.
   */
  async delete(id) {
    const skill = this._skills.find(s => s.id === id);
    if (!skill) return false;

    skill.enabled = false;
    await dataStoreService.setValue(`skill:${id}`, skill);
    console.log(`[Skills] Disabled: ${id}`);
    return true;
  }

  /**
   * List all active skills.
   */
  list() {
    return this._skills.filter(s => s.enabled);
  }

  /**
   * Build context string for AI system prompt — tells JARVIS what it knows how to do.
   */
  buildSkillContext() {
    const active = this.list();
    if (active.length === 0) return '';

    const parts = ['=== LEARNED SKILLS (follow these procedures when triggered) ==='];
    for (const skill of active) {
      parts.push(`\n[SKILL: ${skill.name}]`);
      if (skill.trigger) parts.push(`  Trigger: ${skill.trigger}`);
      skill.steps.forEach((step, i) => parts.push(`  ${i + 1}. ${step}`));
    }
    parts.push('');
    return parts.join('\n');
  }

  getStats() {
    return {
      total: this._skills.length,
      enabled: this._skills.filter(s => s.enabled).length,
    };
  }
}

module.exports = new SkillManager();
