/**
 * Proactive Scheduler - Auto-runs tasks on a schedule.
 *
 * Tasks:
 * 1. Contact expiring customers (2 days before end)
 * 2. Alert admins about overdue returns
 * 3. Send daily summary report to superadmin
 * 4. Cleanup expired conversations
 * 5. Re-sync data periodically
 */

const { agreementsService } = require('../supabase/services');
const { daysBetween, todayMYT, formatMYT } = require('../utils/time');
const notifications = require('./notifications');
const customerFlows = require('./customer-flows');
const conversation = require('./conversation');
const reports = require('./reports');

class Scheduler {
  constructor() {
    this.tasks = [];
    this.running = false;
    this.whatsapp = null;
  }

  init(whatsappChannel) {
    this.whatsapp = whatsappChannel;
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log('[Scheduler] Starting proactive tasks...');

    // Expiry check: every 4 hours
    this.tasks.push(setInterval(() => this._checkExpiringRentals(), 4 * 60 * 60 * 1000));

    // Overdue check: every 2 hours
    this.tasks.push(setInterval(() => this._checkOverdueReturns(), 2 * 60 * 60 * 1000));

    // Daily report: every day at 8am MYT (check every hour)
    this.tasks.push(setInterval(() => this._dailyReportCheck(), 60 * 60 * 1000));

    // Conversation cleanup: every 15 minutes
    this.tasks.push(setInterval(() => conversation.cleanup(), 15 * 60 * 1000));

    // Initial run after 30 seconds
    setTimeout(() => {
      this._checkExpiringRentals().catch(e => console.error('[Scheduler] Expiry check failed:', e.message));
      this._checkOverdueReturns().catch(e => console.error('[Scheduler] Overdue check failed:', e.message));
    }, 30000);
  }

  stop() {
    this.running = false;
    this.tasks.forEach(t => clearInterval(t));
    this.tasks = [];
    console.log('[Scheduler] Stopped.');
  }

  /**
   * Check for rentals expiring in 2 days and notify customers + admins.
   */
  async _checkExpiringRentals() {
    try {
      const expiring = await agreementsService.getExpiringAgreements(2);
      if (expiring.length === 0) return;

      console.log(`[Scheduler] ${expiring.length} rentals expiring in 2 days`);

      for (const agreement of expiring) {
        const daysLeft = daysBetween(todayMYT(), agreement.end_date);

        // Notify customer directly (if WhatsApp available)
        if (this.whatsapp && this.whatsapp.isConnected && this.whatsapp.isConnected() && agreement.customer_phone) {
          const msg = customerFlows.expiringRentalMessage(agreement, daysLeft, 'en');
          try {
            await this.whatsapp.sendText(`${agreement.customer_phone}@c.us`, msg);
            console.log(`[Scheduler] Sent expiry reminder to ${agreement.customer_name}`);
          } catch (err) {
            console.warn(`[Scheduler] Failed to contact ${agreement.customer_name}:`, err.message);
          }
        }

        // Notify superadmin
        await notifications.onExpiringRental(agreement, daysLeft);
      }
    } catch (err) {
      console.error('[Scheduler] Expiry check error:', err.message);
    }
  }

  /**
   * Check for overdue returns and alert admins.
   */
  async _checkOverdueReturns() {
    try {
      const overdue = await agreementsService.getOverdueAgreements();
      if (overdue.length === 0) return;

      console.log(`[Scheduler] ${overdue.length} overdue returns detected`);

      for (const agreement of overdue) {
        await notifications.onOverdueReturn(agreement);
      }
    } catch (err) {
      console.error('[Scheduler] Overdue check error:', err.message);
    }
  }

  /**
   * Send daily report at 8am MYT.
   */
  async _dailyReportCheck() {
    const now = new Date();
    const mytHour = (now.getUTCHours() + 8) % 24;

    // Only send between 8:00-8:59 MYT
    if (mytHour !== 8) return;

    // Check if already sent today
    const today = todayMYT();
    if (this._lastDailyReport === today) return;
    this._lastDailyReport = today;

    try {
      console.log('[Scheduler] Sending daily report...');
      const report = await reports.summaryReport();
      await notifications.notifySuperadmin(`*☀️ Good Morning Report*\n${report}`);
    } catch (err) {
      console.error('[Scheduler] Daily report failed:', err.message);
    }
  }
}

module.exports = new Scheduler();
