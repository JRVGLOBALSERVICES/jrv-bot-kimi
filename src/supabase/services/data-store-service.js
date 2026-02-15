const supabase = require('../client');
const { dataStore } = require('../schemas');

/**
 * DataStoreService - Queries bot_data_store table.
 *
 * Actual columns: id, key, value, created_by, created_at, updated_at
 * NO 'category' or 'is_active' or 'description' columns.
 * Categories are encoded in the key prefix (e.g., "car_prices:summary").
 */
class DataStoreService {
  // ─── Generic getters ──────────────────────────────────

  /**
   * Get all entries, optionally filtered by key prefix.
   */
  async getAll() {
    const { data, error } = await supabase
      .from(dataStore.TABLE)
      .select(dataStore.FIELDS.CONFIG);
    if (error) throw error;
    return data || [];
  }

  /**
   * Get entries matching a key prefix (e.g., "car_prices:" for pricing).
   */
  async getByKeyPrefix(prefix) {
    const { data, error } = await supabase
      .from(dataStore.TABLE)
      .select(dataStore.FIELDS.CONFIG)
      .ilike('key', `${prefix}%`);
    if (error) throw error;
    return data || [];
  }

  /**
   * Get a single entry by exact key.
   */
  async getByKey(key) {
    const { data, error } = await supabase
      .from(dataStore.TABLE)
      .select(dataStore.FIELDS.CONFIG)
      .eq('key', key)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data ? data.value : null;
  }

  /**
   * Set a value by key (upsert).
   */
  async setValue(key, value) {
    const existing = await this.getByKey(key);
    if (existing !== null) {
      const { error } = await supabase
        .from(dataStore.TABLE)
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from(dataStore.TABLE)
        .insert({ key, value });
      if (error) throw error;
    }
  }

  // ─── Specific getters (by key prefix) ─────────────────

  async getPricing() {
    return this.getByKeyPrefix('car_prices:');
  }

  async getDeliveryZones() {
    return this.getByKeyPrefix('delivery_zone');
  }

  async getFAQ() {
    return this.getByKeyPrefix('faq');
  }

  async getTestimonials() {
    return this.getByKeyPrefix('testimonial');
  }

  async getAdminConfig() {
    return this.getByKeyPrefix('admin_name:');
  }

  async getBotConfig() {
    return this.getByKeyPrefix('config');
  }

  async getTemplates() {
    return this.getByKeyPrefix('template');
  }

  async getTemplate(templateKey) {
    return this.getByKey(`template:${templateKey}`);
  }

  // ─── Logging ──────────────────────────────────────────

  async log(key, value) {
    const { error } = await supabase
      .from(dataStore.TABLE)
      .insert({ key, value });
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
