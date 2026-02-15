const { fleetService, agreementsService, dataStoreService } = require('../supabase/services');
const { validateFleetStatus } = require('../utils/validators');
const { formatMYT, todayMYT, daysBetween, nowMYT } = require('../utils/time');

/**
 * Report Generator - Builds formatted reports using templates from bot_data_store.
 *
 * Format rules:
 * - Bold headers: *Header*
 * - Monospace data: ```data```
 * - WhatsApp markdown compatible
 */
class ReportGenerator {
  /**
   * Generate validated fleet report.
   * Cross-references cars with agreements to show true status.
   */
  async fleetReport() {
    const [cars, activeAgreements, templates] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
      dataStoreService.getTemplates(),
    ]);

    // Cross-validate: ensure car status matches reality
    const { validated, mismatches } = validateFleetStatus(cars, activeAgreements);

    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
    const rented = validated.filter(c => (c._validatedStatus || c.status) === 'rented');
    const maintenance = validated.filter(c => (c._validatedStatus || c.status) === 'maintenance');
    const overdue = validated.filter(c => c._overdue);

    let report = `*🚗 JRV Fleet Report*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;
    report += `\`\`\`Total: ${validated.length} cars\n`;
    report += `Available: ${available.length}\n`;
    report += `Rented: ${rented.length}\n`;
    report += `Maintenance: ${maintenance.length}\n`;
    if (overdue.length) report += `⚠ Overdue returns: ${overdue.length}\n`;
    report += `\`\`\`\n`;

    if (available.length > 0) {
      report += `\n*Available Cars:*\n\`\`\`\n`;
      for (const car of available) {
        report += `${car.car_plate} ${car.make} ${car.model} RM${car.daily_rate}/day\n`;
      }
      report += `\`\`\``;
    }

    if (overdue.length > 0) {
      report += `\n\n*⚠ Overdue Returns:*\n\`\`\`\n`;
      for (const car of overdue) {
        const agreement = activeAgreements.find(a => a.car_plate?.toUpperCase() === car.car_plate?.toUpperCase());
        if (agreement) {
          const daysLate = daysBetween(agreement.end_date, todayMYT());
          report += `${car.car_plate} - ${agreement.customer_name} (${daysLate} days overdue)\n`;
        }
      }
      report += `\`\`\``;
    }

    if (mismatches.length > 0) {
      report += `\n\n*⚠ Status Mismatches:*\n\`\`\`\n`;
      for (const m of mismatches) {
        report += `${m.plate}: DB says "${m.dbStatus}" but should be "${m.actualStatus}"\n`;
        report += `  Reason: ${m.reason}\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

  /**
   * Generate earnings report.
   */
  async earningsReport() {
    const [todayEarnings, monthEarnings] = await Promise.all([
      agreementsService.getTodayEarnings(),
      agreementsService.getMonthEarnings(),
    ]);

    let report = `*💰 JRV Earnings Report*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    report += `*Today:*\n\`\`\`\n`;
    report += `Bookings: ${todayEarnings.count}\n`;
    report += `Revenue: RM${todayEarnings.total.toFixed(2)}\n`;
    report += `Collected: RM${todayEarnings.collected.toFixed(2)}\n`;
    report += `Pending: RM${todayEarnings.pending.toFixed(2)}\n`;
    report += `\`\`\`\n`;

    report += `\n*This Month:*\n\`\`\`\n`;
    report += `Bookings: ${monthEarnings.count}\n`;
    report += `Revenue: RM${monthEarnings.total.toFixed(2)}\n`;
    report += `Collected: RM${monthEarnings.collected.toFixed(2)}\n`;
    report += `Pending: RM${monthEarnings.pending.toFixed(2)}\n`;
    report += `\`\`\``;

    return report;
  }

  /**
   * Generate full daily summary for admin.
   */
  async dailySummary() {
    const [fleetStats, agreementStats, overdue, expiring, topCustomers] = await Promise.all([
      fleetService.getFleetStats(),
      agreementsService.getStats(),
      agreementsService.getOverdueAgreements(),
      agreementsService.getExpiringAgreements(),
      agreementsService.getTopCustomers(5),
    ]);

    let report = `*📊 JRV Daily Summary*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    report += `*Fleet:*\n\`\`\`\n`;
    report += `Total: ${fleetStats.total} | Available: ${fleetStats.available}\n`;
    report += `Rented: ${fleetStats.rented} | Maintenance: ${fleetStats.maintenance}\n`;
    report += `\`\`\`\n`;

    report += `\n*Bookings:*\n\`\`\`\n`;
    report += `Active: ${agreementStats.activeCount}\n`;
    report += `Expiring in 3 days: ${agreementStats.expiringCount}\n`;
    report += `Overdue: ${agreementStats.overdueCount}\n`;
    report += `\`\`\`\n`;

    report += `\n*Revenue:*\n\`\`\`\n`;
    report += `Month revenue: RM${agreementStats.monthRevenue.toFixed(2)}\n`;
    report += `Collected: RM${agreementStats.monthCollected.toFixed(2)}\n`;
    report += `Customers: ${agreementStats.totalCustomers}\n`;
    report += `\`\`\``;

    if (expiring.length > 0) {
      report += `\n\n*⏰ Expiring Soon:*\n\`\`\`\n`;
      for (const a of expiring) {
        report += `${a.car_plate} - ${a.customer_name} (ends ${a.end_date})\n`;
      }
      report += `\`\`\``;
    }

    if (overdue.length > 0) {
      report += `\n\n*🚨 Overdue:*\n\`\`\`\n`;
      for (const a of overdue) {
        const days = daysBetween(a.end_date, todayMYT());
        report += `${a.car_plate} - ${a.customer_name} (${days}d overdue)\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

  /**
   * Apply a template from bot_data_store.
   */
  async applyTemplate(templateKey, data = {}) {
    const template = await dataStoreService.getTemplate(templateKey);
    if (!template) return null;

    let text = typeof template === 'string' ? template : template.text || JSON.stringify(template);

    // Replace placeholders: {{key}} → data[key]
    for (const [key, value] of Object.entries(data)) {
      text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    return text;
  }
}

module.exports = new ReportGenerator();
