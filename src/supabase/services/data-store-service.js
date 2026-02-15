const supabase = require('../client');
const { dataStore } = require('../schemas');

class DataStoreService {
  // ─── Generic getters ──────────────────────────────────

  async getByCategory(category) {
    const { data, error } = await supabase
      .from(dataStore.TABLE)
      .select(dataStore.FIELDS.CONFIG)
      .eq('category', category)
      .eq('is_active', true);
    if (error) throw error;
    return data;
  }

  async getByKey(category, key) {
    const { data, error } = await supabase
      .from(dataStore.TABLE)
      .select(dataStore.FIELDS.CONFIG)
      .eq('category', category)
      .eq('key', key)
      .eq('is_active', true)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ? data.value : null;
  }

  async setValue(category, key, value, description = '') {
    // Upsert: update if exists, insert if not
    const existing = await this.getByKey(category, key);
    if (existing !== null) {
      const { error } = await supabase
        .from(dataStore.TABLE)
        .update({ value, description, updated_at: new Date().toISOString() })
        .eq('category', category)
        .eq('key', key);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from(dataStore.TABLE)
        .insert({ category, key, value, description, is_active: true });
      if (error) throw error;
    }
  }

  // ─── Specific getters ────────────────────────────────

  async getPricing() {
    return this.getByCategory(dataStore.CATEGORIES.PRICING);
  }

  async getDeliveryZones() {
    return this.getByCategory(dataStore.CATEGORIES.DELIVERY_ZONES);
  }

  async getFAQ() {
    return this.getByCategory(dataStore.CATEGORIES.FAQ);
  }

  async getTestimonials() {
    return this.getByCategory(dataStore.CATEGORIES.TESTIMONIALS);
  }

  async getAdminConfig() {
    return this.getByCategory(dataStore.CATEGORIES.ADMIN);
  }

  async getBotConfig() {
    return this.getByCategory(dataStore.CATEGORIES.CONFIG);
  }

  async getTemplates() {
    return this.getByCategory(dataStore.CATEGORIES.TEMPLATES);
  }

  async getTemplate(templateKey) {
    return this.getByKey(dataStore.CATEGORIES.TEMPLATES, templateKey);
  }

  // ─── Logging ──────────────────────────────────────────

  async log(key, value) {
    const { error } = await supabase
      .from(dataStore.TABLE)
      .insert({
        category: dataStore.CATEGORIES.LOGS,
        key,
        value,
        is_active: true,
      });
    if (error) throw error;
  }

  // ─── Build context for AI ─────────────────────────────

  async getFullContext() {
    const [pricing, zones, faq, testimonials, config] = await Promise.all([
      this.getPricing(),
      this.getDeliveryZones(),
      this.getFAQ(),
      this.getTestimonials(),
      this.getBotConfig(),
    ]);

    return { pricing, zones, faq, testimonials, config };
  }
}

module.exports = new DataStoreService();
