const { fleetService, agreementsService, dataStoreService } = require('../supabase/services');
const { validateFleetStatus } = require('../utils/validators');
const { formatMYT, todayMYT, daysBetween, nowMYT } = require('../utils/time');
const policies = require('./policies');

/**
 * Report Generator - All 6 report formats from bot_data_store.
 *
 * Report 1: Sorted by Time (chronological rental timeline)
 * Report 2: Sorted by Contact (grouped by customer)
 * Report 3: Sorted by Timeslot (pickups/returns today)
 * Report 4: Follow-up Report (expiring, overdue, pending payment)
 * Report 5: Available Cars Report (what's free today)
 * Report 6: Summary Report (daily overview)
 *
 * Format: *bold headers* + ```monospace data```
 * Dates: Malaysia Time (MYT = UTC+8)
 */
class ReportGenerator {
  /**
   * Report 1: Sorted by Time
   * All active bookings sorted chronologically by end date.
   */
  async sortedByTime() {
    const agreements = await agreementsService.getActiveAgreements();
    const today = todayMYT();

    let report = `*📋 Report 1: Sorted by Time*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    if (agreements.length === 0) {
      report += `\`\`\`No active bookings\`\`\``;
      return report;
    }

    // Sort by end date ascending
    const sorted = [...agreements].sort((a, b) => new Date(a.end_date) - new Date(b.end_date));

    report += `\`\`\`\n`;
    for (const a of sorted) {
      const daysLeft = daysBetween(today, a.end_date);
      const status = daysLeft < 0 ? '🚨 OVERDUE' : daysLeft <= 2 ? '⚠️ EXPIRING' : '✅';
      report += `${a.car_plate} | ${a.customer_name}\n`;
      report += `  ${a.start_date} → ${a.end_date} (${daysLeft}d) ${status}\n`;
      if (a.customer_phone) report += `  📱 ${a.customer_phone}\n`;
      report += `\n`;
    }
    report += `\`\`\``;
    report += `\nTotal: ${agreements.length} active`;

    return report;
  }

  /**
   * Report 2: Sorted by Contact
   * Bookings grouped by customer (phone number).
   */
  async sortedByContact() {
    const agreements = await agreementsService.getActiveAgreements();

    let report = `*📱 Report 2: Sorted by Contact*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    if (agreements.length === 0) {
      report += `\`\`\`No active bookings\`\`\``;
      return report;
    }

    // Group by customer phone
    const grouped = {};
    for (const a of agreements) {
      const key = a.customer_phone || a.customer_name;
      if (!grouped[key]) grouped[key] = { name: a.customer_name, phone: a.customer_phone, bookings: [] };
      grouped[key].bookings.push(a);
    }

    report += `\`\`\`\n`;
    for (const [key, customer] of Object.entries(grouped)) {
      report += `👤 ${customer.name}\n`;
      report += `   📱 ${customer.phone || 'N/A'}\n`;
      for (const b of customer.bookings) {
        report += `   ${b.car_plate} | ${b.start_date} → ${b.end_date}\n`;
      }
      report += `\n`;
    }
    report += `\`\`\``;
    report += `\n${Object.keys(grouped).length} customers, ${agreements.length} bookings`;

    return report;
  }

  /**
   * Report 3: Sorted by Timeslot
   * Today's pickups and returns.
   */
  async sortedByTimeslot() {
    const today = todayMYT();
    const allAgreements = await agreementsService.getActiveAgreements();
    const allAgreementsAll = await agreementsService.getAllAgreements();

    // Filter for today's pickups and returns
    const pickupsToday = allAgreementsAll.filter(a =>
      a.start_date && a.start_date.startsWith(today) && ['New', 'Extended'].includes(a.status)
    );
    const returnsToday = allAgreements.filter(a =>
      a.end_date && a.end_date.startsWith(today)
    );

    let report = `*🕐 Report 3: Today's Timeslots*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    report += `*Pickups Today (${pickupsToday.length}):*\n`;
    if (pickupsToday.length > 0) {
      report += `\`\`\`\n`;
      for (const a of pickupsToday) {
        report += `${a.car_plate} → ${a.customer_name}\n`;
        report += `  📱 ${a.customer_phone || 'N/A'}\n`;
      }
      report += `\`\`\`\n`;
    } else {
      report += `\`\`\`No pickups today\`\`\`\n`;
    }

    report += `\n*Returns Today (${returnsToday.length}):*\n`;
    if (returnsToday.length > 0) {
      report += `\`\`\`\n`;
      for (const a of returnsToday) {
        report += `${a.car_plate} ← ${a.customer_name}\n`;
        report += `  📱 ${a.customer_phone || 'N/A'}\n`;
      }
      report += `\`\`\``;
    } else {
      report += `\`\`\`No returns today\`\`\``;
    }

    return report;
  }

  /**
   * Report 4: Follow-up Report
   * Expiring rentals, overdue returns, pending payments.
   */
  async followUpReport() {
    const [expiring, overdue] = await Promise.all([
      agreementsService.getExpiringAgreements(3),
      agreementsService.getOverdueAgreements(),
    ]);

    let report = `*📞 Report 4: Follow-up Required*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    // Overdue (urgent)
    report += `*🚨 OVERDUE (${overdue.length}):*\n`;
    if (overdue.length > 0) {
      report += `\`\`\`\n`;
      for (const a of overdue) {
        const daysLate = daysBetween(a.end_date, todayMYT());
        report += `${a.car_plate} | ${a.customer_name} (${daysLate}d late)\n`;
        report += `  📱 ${a.customer_phone || 'N/A'}\n`;
        report += `  Due: ${a.end_date}\n`;
      }
      report += `\`\`\`\n`;
    } else {
      report += `\`\`\`None - all good!\`\`\`\n`;
    }

    // Expiring soon
    report += `\n*⚠️ EXPIRING IN 3 DAYS (${expiring.length}):*\n`;
    if (expiring.length > 0) {
      report += `\`\`\`\n`;
      for (const a of expiring) {
        const daysLeft = daysBetween(todayMYT(), a.end_date);
        report += `${a.car_plate} | ${a.customer_name} (${daysLeft}d left)\n`;
        report += `  📱 ${a.customer_phone || 'N/A'}\n`;
        report += `  Ends: ${a.end_date}\n`;
      }
      report += `\`\`\``;
    } else {
      report += `\`\`\`None expiring soon\`\`\``;
    }

    report += `\n\n*Action:* Contact these customers to confirm extend/return.`;
    return report;
  }

  /**
   * Report 5: Available Cars Report
   * What's available right now (cross-validated with agreements).
   */
  async availableReport() {
    const [cars, activeAgreements] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);

    const { validated, mismatches } = validateFleetStatus(cars, activeAgreements);
    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');

    let report = `*🚗 Report 5: Available Cars*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    if (available.length === 0) {
      report += `\`\`\`No cars available\`\`\``;
      return report;
    }

    // Group by category
    const grouped = {};
    for (const car of available) {
      const cat = car.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(car);
    }

    for (const [cat, cars] of Object.entries(grouped)) {
      const pricing = policies.getCategoryPricing(cat);
      report += `*${cat.charAt(0).toUpperCase() + cat.slice(1)}:*\n\`\`\`\n`;
      for (const car of cars) {
        report += `${car.car_plate} | ${car.make} ${car.model}`;
        if (car.color) report += ` (${car.color})`;
        report += ` | RM${car.daily_rate}/day\n`;
      }
      report += `\`\`\`\n`;
    }

    report += `\nTotal available: ${available.length}/${validated.length}`;

    if (mismatches.length > 0) {
      report += `\n\n*⚠️ Mismatches (${mismatches.length}):*\n\`\`\`\n`;
      for (const m of mismatches) {
        report += `${m.plate}: ${m.dbStatus} → ${m.actualStatus}\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

  /**
   * Report 6: Summary Report (full daily overview).
   */
  async summaryReport() {
    const [fleetStats, agreementStats, overdue, expiring, topCustomers, cars, activeAgreements] = await Promise.all([
      fleetService.getFleetStats(),
      agreementsService.getStats(),
      agreementsService.getOverdueAgreements(),
      agreementsService.getExpiringAgreements(3),
      agreementsService.getTopCustomers(5),
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);

    const { mismatches } = validateFleetStatus(cars, activeAgreements);

    let report = `*📊 Report 6: Daily Summary*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    // Fleet
    report += `*Fleet:*\n\`\`\`\n`;
    report += `Total: ${fleetStats.total} | Available: ${fleetStats.available}\n`;
    report += `Rented: ${fleetStats.rented} | Maintenance: ${fleetStats.maintenance}\n`;
    report += `\`\`\`\n`;

    // Bookings
    report += `\n*Bookings:*\n\`\`\`\n`;
    report += `Active: ${agreementStats.activeCount}\n`;
    report += `Expiring (3d): ${agreementStats.expiringCount}\n`;
    report += `Overdue: ${agreementStats.overdueCount}\n`;
    report += `\`\`\`\n`;

    // Revenue
    report += `\n*Revenue (This Month):*\n\`\`\`\n`;
    report += `Total: RM${agreementStats.monthRevenue.toFixed(2)}\n`;
    report += `Collected: RM${agreementStats.monthCollected.toFixed(2)}\n`;
    report += `Pending: RM${(agreementStats.monthRevenue - agreementStats.monthCollected).toFixed(2)}\n`;
    report += `Customers: ${agreementStats.totalCustomers}\n`;
    report += `\`\`\``;

    // Alerts
    if (overdue.length > 0) {
      report += `\n\n*🚨 Overdue (${overdue.length}):*\n\`\`\`\n`;
      for (const a of overdue) {
        const days = daysBetween(a.end_date, todayMYT());
        report += `${a.car_plate} - ${a.customer_name} (${days}d)\n`;
      }
      report += `\`\`\``;
    }

    if (expiring.length > 0) {
      report += `\n\n*⚠️ Expiring (${expiring.length}):*\n\`\`\`\n`;
      for (const a of expiring) {
        report += `${a.car_plate} - ${a.customer_name} (${a.end_date})\n`;
      }
      report += `\`\`\``;
    }

    if (mismatches.length > 0) {
      report += `\n\n*⚠️ Status Mismatches (${mismatches.length}):*\n\`\`\`\n`;
      for (const m of mismatches) {
        report += `${m.plate}: ${m.dbStatus} → ${m.actualStatus}\n`;
      }
      report += `\`\`\``;
    }

    // Top customers
    if (topCustomers.length > 0) {
      report += `\n\n*Top Customers:*\n\`\`\`\n`;
      for (const c of topCustomers.slice(0, 5)) {
        report += `${c.name} (${c.rentals}x) RM${c.totalSpent.toFixed(0)}\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

  // ─── Legacy report methods (backwards compatible) ──────────

  /**
   * Fleet report with cross-validation.
   */
  async fleetReport() {
    const [cars, activeAgreements] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);

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
          report += `${car.car_plate} - ${agreement.customer_name} (${daysLate}d overdue)\n`;
        }
      }
      report += `\`\`\``;
    }

    if (mismatches.length > 0) {
      report += `\n\n*⚠ Status Mismatches:*\n\`\`\`\n`;
      for (const m of mismatches) {
        report += `${m.plate}: "${m.dbStatus}" → "${m.actualStatus}"\n`;
        report += `  ${m.reason}\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

  /**
   * Earnings report.
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
   * Daily summary (alias for summaryReport).
   */
  async dailySummary() {
    return this.summaryReport();
  }
}

module.exports = new ReportGenerator();
