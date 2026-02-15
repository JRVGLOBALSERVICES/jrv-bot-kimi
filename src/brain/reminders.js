/**
 * Reminder System - Cron-like scheduling for JARVIS.
 *
 * Features:
 * - One-time reminders (e.g., "remind me in 2 hours to call customer")
 * - Recurring reminders (e.g., "every Monday send fleet report")
 * - Natural language parsing for time (supports EN/MS)
 * - Persists to memory (optionally to Supabase bot_data_store)
 * - Integrated with notification system for delivery via WhatsApp
 */

const { todayMYT, formatMYT } = require('../utils/time');
const notifications = require('./notifications');

class ReminderManager {
  constructor() {
    this.reminders = [];
    this.nextId = 1;
    this.checkInterval = null;
    this.whatsapp = null;
  }

  init(whatsappChannel) {
    this.whatsapp = whatsappChannel;
  }

  start() {
    if (this.checkInterval) return;
    // Check reminders every 30 seconds
    this.checkInterval = setInterval(() => this._checkDue(), 30 * 1000);
    console.log('[Reminders] Started reminder checker');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Create a new reminder.
   * @param {object} opts
   * @param {string} opts.text - Reminder message
   * @param {string} opts.phone - Who to remind (phone number)
   * @param {string} opts.name - Person's name
   * @param {Date|string} opts.dueAt - When to fire
   * @param {string} opts.repeat - null | 'daily' | 'weekly' | 'monthly' | 'hourly'
   * @param {string} opts.createdBy - Phone of creator
   * @returns {object} The created reminder
   */
  create({ text, phone, name, dueAt, repeat = null, createdBy }) {
    const reminder = {
      id: this.nextId++,
      text,
      phone: phone || createdBy,
      name: name || 'Unknown',
      dueAt: new Date(dueAt),
      repeat,
      createdBy,
      createdAt: new Date(),
      fired: false,
      fireCount: 0,
    };
    this.reminders.push(reminder);
    console.log(`[Reminders] Created #${reminder.id}: "${text}" due ${reminder.dueAt.toISOString()}`);
    return reminder;
  }

  /**
   * Parse natural language time and create reminder.
   * Supports: "in 2 hours", "tomorrow at 9am", "in 30 minutes", "every day at 8am"
   */
  createFromText(text, phone, name) {
    const parsed = this._parseTime(text);
    if (!parsed) {
      return { error: 'Could not parse time from message. Try: "remind me in 2 hours to...", "remind me tomorrow at 9am to..."' };
    }

    const reminderText = this._extractReminderText(text);
    return this.create({
      text: reminderText || text,
      phone,
      name,
      dueAt: parsed.dueAt,
      repeat: parsed.repeat,
      createdBy: phone,
    });
  }

  /**
   * List reminders for a phone number.
   */
  listForPhone(phone) {
    return this.reminders.filter(r => r.phone === phone || r.createdBy === phone);
  }

  /**
   * List all active reminders.
   */
  listAll() {
    return this.reminders.filter(r => !r.fired || r.repeat);
  }

  /**
   * Delete a reminder by ID.
   */
  delete(id, phone) {
    const idx = this.reminders.findIndex(r => r.id === id && (r.phone === phone || r.createdBy === phone));
    if (idx === -1) return false;
    this.reminders.splice(idx, 1);
    return true;
  }

  /**
   * Delete all reminders for a phone.
   */
  deleteAll(phone) {
    const before = this.reminders.length;
    this.reminders = this.reminders.filter(r => r.phone !== phone && r.createdBy !== phone);
    return before - this.reminders.length;
  }

  /**
   * Format reminders as WhatsApp text.
   */
  formatList(reminders) {
    if (reminders.length === 0) {
      return '*Reminders*\n```No active reminders```';
    }

    let text = `*Active Reminders (${reminders.length})*\n\`\`\`\n`;
    for (const r of reminders) {
      const dueStr = r.dueAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
      text += `#${r.id} [${r.repeat || 'once'}] ${dueStr}\n`;
      text += `  ${r.text.slice(0, 80)}\n`;
    }
    text += `\`\`\``;
    return text;
  }

  // ─── Internal ──────────────────────────────────────────

  async _checkDue() {
    const now = new Date();

    for (const reminder of this.reminders) {
      if (reminder.fired && !reminder.repeat) continue;
      if (now < reminder.dueAt) continue;

      // Fire the reminder
      await this._fire(reminder);

      if (reminder.repeat) {
        // Schedule next occurrence
        reminder.dueAt = this._nextOccurrence(reminder.dueAt, reminder.repeat);
        reminder.fireCount++;
      } else {
        reminder.fired = true;
      }
    }

    // Cleanup old fired non-repeating reminders (older than 1 day)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    this.reminders = this.reminders.filter(r =>
      !r.fired || r.repeat || r.dueAt > oneDayAgo
    );
  }

  async _fire(reminder) {
    const msg = `*Reminder*\n\`\`\`\n${reminder.text}\n\`\`\`\n` +
      `${reminder.repeat ? `(Repeats ${reminder.repeat})` : ''}`;

    console.log(`[Reminders] Firing #${reminder.id}: "${reminder.text}" → ${reminder.phone}`);

    // Send via WhatsApp if available
    if (this.whatsapp && this.whatsapp.isConnected && this.whatsapp.isConnected()) {
      try {
        await this.whatsapp.sendText(`${reminder.phone}@c.us`, msg);
      } catch (err) {
        console.error(`[Reminders] Failed to send #${reminder.id}:`, err.message);
      }
    } else {
      // Log to console in dev mode
      console.log(`[Reminders → ${reminder.name}] ${reminder.text}`);
    }

    // Also notify superadmin if reminder was created by a customer
    const policies = require('./policies');
    if (!policies.isAdmin(reminder.createdBy)) {
      notifications.notifySuperadmin(
        `*Reminder fired for ${reminder.name} (+${reminder.phone})*\n\`\`\`${reminder.text}\`\`\``
      ).catch(() => {});
    }
  }

  _nextOccurrence(current, repeat) {
    const next = new Date(current);
    switch (repeat) {
      case 'hourly': next.setHours(next.getHours() + 1); break;
      case 'daily': next.setDate(next.getDate() + 1); break;
      case 'weekly': next.setDate(next.getDate() + 7); break;
      case 'monthly': next.setMonth(next.getMonth() + 1); break;
      default: next.setDate(next.getDate() + 1); break;
    }
    return next;
  }

  _parseTime(text) {
    const lower = text.toLowerCase();
    const now = new Date();
    // Convert to MYT
    const mytOffset = 8 * 60 * 60 * 1000;

    // "in X minutes/hours/days"
    const inMatch = lower.match(/in\s+(\d+)\s*(min(?:ute)?s?|hour?s?|jam|day?s?|hari|week?s?|minggu)/);
    if (inMatch) {
      const amount = parseInt(inMatch[1]);
      const unit = inMatch[2];
      const dueAt = new Date(now);

      if (/min/.test(unit)) dueAt.setMinutes(dueAt.getMinutes() + amount);
      else if (/hour|jam/.test(unit)) dueAt.setHours(dueAt.getHours() + amount);
      else if (/day|hari/.test(unit)) dueAt.setDate(dueAt.getDate() + amount);
      else if (/week|minggu/.test(unit)) dueAt.setDate(dueAt.getDate() + amount * 7);

      return { dueAt, repeat: null };
    }

    // "tomorrow at Xam/pm"
    const tomorrowMatch = lower.match(/tomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (tomorrowMatch) {
      let hour = parseInt(tomorrowMatch[1]);
      const min = parseInt(tomorrowMatch[2] || '0');
      const ampm = tomorrowMatch[3];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      const dueAt = new Date(now);
      dueAt.setDate(dueAt.getDate() + 1);
      dueAt.setHours(hour, min, 0, 0);
      return { dueAt, repeat: null };
    }

    // "every day/daily at Xam"
    const everyMatch = lower.match(/every\s*(day|daily|hour|hourly|week|weekly|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (everyMatch) {
      const freq = everyMatch[1];
      let repeat = 'daily';
      if (/hour/.test(freq)) repeat = 'hourly';
      else if (/week|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(freq)) repeat = 'weekly';

      // Try to parse time
      const timeMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
      const dueAt = new Date(now);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1]);
        const min = parseInt(timeMatch[2] || '0');
        const ampm = timeMatch[3];
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        dueAt.setHours(hour, min, 0, 0);
        if (dueAt <= now) {
          // Next occurrence
          if (repeat === 'hourly') dueAt.setHours(dueAt.getHours() + 1);
          else dueAt.setDate(dueAt.getDate() + 1);
        }
      }

      return { dueAt, repeat };
    }

    // "at Xam/pm today"
    const atMatch = lower.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (atMatch) {
      let hour = parseInt(atMatch[1]);
      const min = parseInt(atMatch[2] || '0');
      const ampm = atMatch[3];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;

      const dueAt = new Date(now);
      dueAt.setHours(hour, min, 0, 0);
      if (dueAt <= now) dueAt.setDate(dueAt.getDate() + 1);
      return { dueAt, repeat: null };
    }

    return null;
  }

  _extractReminderText(text) {
    // Remove time-related parts and "remind me" prefix
    return text
      .replace(/remind\s*(?:me)?\s*/i, '')
      .replace(/in\s+\d+\s*(?:min(?:ute)?s?|hours?|jam|days?|hari|weeks?|minggu)\s*/i, '')
      .replace(/tomorrow\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*/i, '')
      .replace(/every\s*(?:day|daily|hour|hourly|week|weekly)\s*/i, '')
      .replace(/at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*/i, '')
      .replace(/^to\s+/i, '')
      .trim() || text;
  }

  getStats() {
    return {
      total: this.reminders.length,
      active: this.reminders.filter(r => !r.fired || r.repeat).length,
      recurring: this.reminders.filter(r => r.repeat).length,
    };
  }
}

module.exports = new ReminderManager();
