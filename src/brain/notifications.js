/**
 * Notification Manager - Handles simultaneous superadmin updates.
 *
 * From bot_data_store rules:
 * - ALL customer interactions must be forwarded to superadmin Vir (+60138845477)
 * - HIGH/CRITICAL intents get immediate escalation alerts
 * - Payment proofs forwarded for verification
 * - Overdue returns trigger admin alerts
 */

const policies = require('./policies');

class NotificationManager {
  constructor() {
    // WhatsApp channel reference (set during init)
    this.whatsapp = null;
    this.superadminPhone = policies.admins.superadmin.phone;
    this.superadminChatId = `${this.superadminPhone}@c.us`;
    this.queue = [];
    this.processing = false;
  }

  /**
   * Initialize with WhatsApp channel.
   */
  init(whatsappChannel) {
    this.whatsapp = whatsappChannel;
  }

  /**
   * Send notification to superadmin Vir.
   * Queues if WhatsApp not ready, sends immediately if available.
   */
  async notifySuperadmin(text) {
    if (!text) return;

    // In dev mode (no WhatsApp), just log
    if (!this.whatsapp || !this.whatsapp.isConnected || !this.whatsapp.isConnected()) {
      console.log(`[Notify → Vir] ${text.replace(/\n/g, ' | ').slice(0, 200)}`);
      this.queue.push({ text, timestamp: Date.now() });
      return;
    }

    try {
      await this.whatsapp.sendText(this.superadminChatId, text);
    } catch (err) {
      console.error('[Notify] Failed to send to superadmin:', err.message);
      this.queue.push({ text, timestamp: Date.now() });
    }
  }

  /**
   * Send to ALL admins.
   */
  async notifyAllAdmins(text) {
    for (const admin of policies.admins.list) {
      const chatId = `${admin.phone}@c.us`;
      if (this.whatsapp && this.whatsapp.isConnected && this.whatsapp.isConnected()) {
        try {
          await this.whatsapp.sendText(chatId, text);
        } catch (err) {
          console.error(`[Notify] Failed to send to ${admin.name}:`, err.message);
        }
      } else {
        console.log(`[Notify → ${admin.name}] ${text.replace(/\n/g, ' | ').slice(0, 150)}`);
      }
    }
  }

  /**
   * Customer interaction update (sent on EVERY customer message).
   */
  async onCustomerMessage(phone, name, text, classification, isExisting, jarvisResponse) {
    const customerType = isExisting ? 'Returning' : 'New';
    const msg = `*Customer ${classification.priority === 'LOW' ? 'Update' : classification.priority + ' Alert'}*\n` +
      `\`\`\`\n` +
      `${customerType}: ${name} (+${phone})\n` +
      `Intent: ${classification.intent}\n` +
      `Msg: ${text?.slice(0, 200) || '[media]'}\n` +
      `\`\`\`\n` +
      `*JARVIS replied:*\n` +
      `\`\`\`\n${jarvisResponse?.slice(0, 300) || '[processing]'}\n\`\`\``;

    await this.notifySuperadmin(msg);
  }

  /**
   * Escalation alert (HIGH/CRITICAL priority).
   */
  async onEscalation(phone, name, text, classification) {
    const icon = classification.priority === 'CRITICAL' ? '🚨' : '⚠️';
    const msg = `${icon} *${classification.priority} ESCALATION*\n` +
      `\`\`\`\n` +
      `From: ${name} (+${phone})\n` +
      `Intent: ${classification.intent}\n` +
      `Message: ${text?.slice(0, 300) || '[media]'}\n` +
      `\`\`\`\n` +
      `Please respond directly to this customer.`;

    // Critical goes to ALL admins, High goes to superadmin
    if (classification.priority === 'CRITICAL') {
      await this.notifyAllAdmins(msg);
    } else {
      await this.notifySuperadmin(msg);
    }
  }

  /**
   * Payment proof received.
   */
  async onPaymentProof(phone, name, amount) {
    const msg = `*💰 Payment Proof Received*\n` +
      `\`\`\`\n` +
      `From: ${name} (+${phone})\n` +
      `${amount ? `Amount: RM${amount}` : 'Amount: Check attachment'}\n` +
      `\`\`\`\n` +
      `Please verify and confirm.`;

    await this.notifySuperadmin(msg);
  }

  /**
   * Overdue return alert.
   */
  async onOverdueReturn(agreement) {
    const msg = `*🚨 OVERDUE RETURN*\n` +
      `\`\`\`\n` +
      `Car: ${agreement.plate_number}\n` +
      `Customer: ${agreement.customer_name}\n` +
      `Phone: ${agreement.mobile || 'N/A'}\n` +
      `Was due: ${(agreement.date_end || '').slice(0, 10)}\n` +
      `\`\`\`\n` +
      `Contact customer immediately.`;

    await this.notifyAllAdmins(msg);
  }

  /**
   * Expiring rental reminder.
   */
  async onExpiringRental(agreement, daysLeft) {
    const msg = `*⏰ Rental Expiring*\n` +
      `\`\`\`\n` +
      `Car: ${agreement.plate_number}\n` +
      `Customer: ${agreement.customer_name}\n` +
      `Ends: ${(agreement.date_end || '').slice(0, 10)} (${daysLeft} days)\n` +
      `\`\`\``;

    await this.notifySuperadmin(msg);
  }

  /**
   * New booking created.
   */
  async onNewBooking(agreement) {
    const msg = `*📋 New Booking*\n` +
      `\`\`\`\n` +
      `Customer: ${agreement.customer_name}\n` +
      `Car: ${agreement.plate_number || agreement.car_type}\n` +
      `Period: ${(agreement.date_start || '').slice(0, 10)} → ${(agreement.date_end || '').slice(0, 10)}\n` +
      `Amount: RM${agreement.total_price || 'TBD'}\n` +
      `\`\`\``;

    await this.notifySuperadmin(msg);
  }

  /**
   * JARVIS response update (sent after JARVIS generates response).
   */
  async onJarvisResponse(phone, name, customerMsg, jarvisReply, classification) {
    // Only forward customer interactions, not admin commands
    if (policies.isAdmin(phone)) return;

    await this.onCustomerMessage(phone, name, customerMsg, classification, true, jarvisReply);
  }

  /**
   * Flush queued notifications (called when WhatsApp reconnects).
   */
  async flushQueue() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const toSend = [...this.queue];
    this.queue = [];

    for (const item of toSend) {
      // Skip notifications older than 1 hour
      if (Date.now() - item.timestamp > 60 * 60 * 1000) continue;
      try {
        await this.notifySuperadmin(item.text);
        await new Promise(r => setTimeout(r, 500)); // Rate limit
      } catch (err) {
        console.error('[Notify] Queue flush error:', err.message);
      }
    }

    this.processing = false;
  }
}

module.exports = new NotificationManager();
