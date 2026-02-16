/**
 * JARVIS Customer Profiles — Learns About People Over Time
 *
 * Builds persistent personality/preference profiles from interactions.
 * Unlike conversation context (TTL 30min), profiles are permanent.
 *
 * Auto-learns:
 *   - Language preference (detected from messages)
 *   - Communication style (formal/casual)
 *   - Preferred car types (from booking history)
 *   - Payment behavior (on-time, late, preferred method)
 *   - Interaction count and last seen
 *   - Notes added by admin ("VIP", "always late", "student")
 *
 * Manual notes:
 *   Admin: "Note about 60123456789: VIP customer, always wants SUV"
 *   → Stored as admin note in profile
 *
 * Storage: Supabase bot_data_store with key prefix "profile:"
 */

const { dataStoreService } = require('../supabase/services');

class CustomerProfiles {
  constructor() {
    this._profiles = new Map(); // phone → profile
    this._loaded = false;
    this._dirty = new Set();    // phones with unsaved changes
    this._saveTimer = null;
  }

  async load() {
    try {
      const data = await dataStoreService.getByKeyPrefix('profile:');
      for (const entry of data || []) {
        const phone = entry.key.replace('profile:', '');
        const profile = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        this._profiles.set(phone, profile);
      }
      this._loaded = true;
      console.log(`[Profiles] Loaded ${this._profiles.size} customer profiles`);

      // Auto-save dirty profiles every 2 minutes
      this._saveTimer = setInterval(() => this._saveDirty(), 2 * 60 * 1000);
    } catch (err) {
      console.error('[Profiles] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Get or create a profile for a phone number.
   */
  get(phone) {
    if (!this._profiles.has(phone)) {
      this._profiles.set(phone, this._newProfile(phone));
    }
    return this._profiles.get(phone);
  }

  /**
   * Record an interaction — called on every message.
   * Learns passively from the conversation.
   */
  recordInteraction(phone, { name, language, messageLength, isVoice = false }) {
    const profile = this.get(phone);

    // Update basics
    profile.lastSeen = new Date().toISOString();
    profile.interactions = (profile.interactions || 0) + 1;
    if (name && name !== 'Unknown') profile.name = name;

    // Track language preference (weighted average)
    if (language) {
      if (!profile.languages) profile.languages = {};
      profile.languages[language] = (profile.languages[language] || 0) + 1;
      profile.preferredLang = Object.entries(profile.languages)
        .sort(([, a], [, b]) => b - a)[0][0];
    }

    // Track communication style
    if (messageLength) {
      if (!profile.avgMessageLength) profile.avgMessageLength = messageLength;
      else profile.avgMessageLength = Math.round(
        (profile.avgMessageLength * 0.8) + (messageLength * 0.2)
      );
    }

    // Track voice preference
    if (isVoice) {
      profile.voiceMessages = (profile.voiceMessages || 0) + 1;
    }

    this._dirty.add(phone);
  }

  /**
   * Record a booking preference — called when bookings are made.
   */
  recordBooking(phone, { carType, duration, paymentMethod }) {
    const profile = this.get(phone);

    if (!profile.bookingHistory) profile.bookingHistory = [];
    profile.bookingHistory.push({
      carType,
      duration,
      paymentMethod,
      date: new Date().toISOString(),
    });

    // Keep last 20 bookings
    if (profile.bookingHistory.length > 20) {
      profile.bookingHistory = profile.bookingHistory.slice(-20);
    }

    // Update preferred car type (most booked)
    const carCounts = {};
    for (const b of profile.bookingHistory) {
      if (b.carType) carCounts[b.carType] = (carCounts[b.carType] || 0) + 1;
    }
    if (Object.keys(carCounts).length > 0) {
      profile.preferredCarType = Object.entries(carCounts)
        .sort(([, a], [, b]) => b - a)[0][0];
    }

    profile.totalBookings = (profile.totalBookings || 0) + 1;
    this._dirty.add(phone);
  }

  /**
   * Add an admin note to a customer's profile.
   */
  async addNote(phone, note, addedBy = 'admin') {
    const profile = this.get(phone);

    if (!profile.adminNotes) profile.adminNotes = [];
    profile.adminNotes.push({
      text: note,
      addedBy,
      addedAt: new Date().toISOString(),
    });

    // Keep last 20 notes
    if (profile.adminNotes.length > 20) {
      profile.adminNotes = profile.adminNotes.slice(-20);
    }

    this._dirty.add(phone);
    await this._saveProfile(phone);

    console.log(`[Profiles] Note added for ${phone}: "${note.slice(0, 50)}"`);
    return profile;
  }

  /**
   * Set a tag/label on a profile (VIP, student, corporate, blacklisted, etc.).
   */
  async setTag(phone, tag) {
    const profile = this.get(phone);
    if (!profile.tags) profile.tags = [];
    if (!profile.tags.includes(tag)) {
      profile.tags.push(tag);
    }
    this._dirty.add(phone);
    await this._saveProfile(phone);
    return profile;
  }

  /**
   * Remove a tag from a profile.
   */
  async removeTag(phone, tag) {
    const profile = this.get(phone);
    if (!profile.tags) return profile;
    profile.tags = profile.tags.filter(t => t !== tag);
    this._dirty.add(phone);
    await this._saveProfile(phone);
    return profile;
  }

  /**
   * Get a customer summary for the AI system prompt.
   * Returns only relevant info, not the full profile.
   */
  getSummary(phone) {
    if (!this._profiles.has(phone)) return null;

    const p = this._profiles.get(phone);
    const parts = [];

    if (p.name) parts.push(`Name: ${p.name}`);
    if (p.tags?.length) parts.push(`Tags: ${p.tags.join(', ')}`);
    if (p.preferredLang) parts.push(`Language: ${p.preferredLang}`);
    if (p.preferredCarType) parts.push(`Prefers: ${p.preferredCarType}`);
    if (p.totalBookings) parts.push(`Bookings: ${p.totalBookings}`);
    if (p.interactions > 5) parts.push(`Interactions: ${p.interactions}`);

    // Latest admin notes
    if (p.adminNotes?.length) {
      const latest = p.adminNotes.slice(-3);
      parts.push('Notes: ' + latest.map(n => n.text).join('; '));
    }

    return parts.length > 0 ? parts.join(' | ') : null;
  }

  /**
   * Search profiles by name, phone, or tag.
   */
  search(query) {
    const lower = query.toLowerCase();
    const results = [];

    for (const [phone, profile] of this._profiles) {
      if (
        phone.includes(lower) ||
        (profile.name || '').toLowerCase().includes(lower) ||
        (profile.tags || []).some(t => t.toLowerCase().includes(lower)) ||
        (profile.adminNotes || []).some(n => n.text.toLowerCase().includes(lower))
      ) {
        results.push({ phone, ...profile });
      }
    }

    return results;
  }

  /**
   * Delete a customer profile.
   */
  async delete(phone) {
    if (!this._profiles.has(phone)) return false;
    this._profiles.delete(phone);
    this._dirty.delete(phone);
    // Soft-delete in DB
    await dataStoreService.setValue(`profile:${phone}`, { deleted: true, deletedAt: new Date().toISOString() });
    return true;
  }

  // ─── Persistence ──────────────────────────────────────

  async _saveProfile(phone) {
    const profile = this._profiles.get(phone);
    if (!profile) return;
    await dataStoreService.setValue(`profile:${phone}`, profile);
    this._dirty.delete(phone);
  }

  async _saveDirty() {
    if (this._dirty.size === 0) return;

    const phones = [...this._dirty];
    this._dirty.clear();

    for (const phone of phones) {
      try {
        await this._saveProfile(phone);
      } catch (err) {
        console.error(`[Profiles] Failed to save ${phone}:`, err.message);
        this._dirty.add(phone); // Retry next cycle
      }
    }

    if (phones.length > 0) {
      console.log(`[Profiles] Auto-saved ${phones.length} profiles`);
    }
  }

  _newProfile(phone) {
    return {
      phone,
      name: null,
      interactions: 0,
      languages: {},
      preferredLang: null,
      preferredCarType: null,
      totalBookings: 0,
      bookingHistory: [],
      adminNotes: [],
      tags: [],
      voiceMessages: 0,
      avgMessageLength: 0,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
  }

  getStats() {
    return {
      totalProfiles: this._profiles.size,
      withNotes: [...this._profiles.values()].filter(p => p.adminNotes?.length > 0).length,
      withTags: [...this._profiles.values()].filter(p => p.tags?.length > 0).length,
    };
  }

  async shutdown() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    await this._saveDirty();
  }
}

module.exports = new CustomerProfiles();
