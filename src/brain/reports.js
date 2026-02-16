const { fleetService, agreementsService, dataStoreService } = require('../supabase/services');
const { validateFleetStatus, getEndDate, getStartDate } = require('../utils/validators');
const { formatMYT, todayMYT, daysBetween, nowMYT } = require('../utils/time');
const policies = require('./policies');

/**
 * Report Generator — Matches OpenClaw jrv-bot report format.
 *
 * Report 1: Expiring by Models (grouped alphabetically by car_type)
 * Report 2: Expiring with Contacts (flat list + WhatsApp links)
 * Report 3: Expiring by Time Slot (today/tomorrow/this week/next week/later)
 * Report 4: Follow-up Required (overdue + expiring + pending)
 * Report 5: Available Cars (grouped by model+year, deduplicated)
 * Report 6: Summary/Totals (fleet stats, availability rate, composition)
 *
 * DB columns: agreements use plate_number, mobile, date_start, date_end, total_price, car_type
 * Cars use plate_number, body_type, daily_price, _carName (enriched from catalog)
 */
class ReportGenerator {

  // ─── Report 1: Expiring by Models ─────────────────────
  async sortedByTime() {
    const agreements = await agreementsService.getActiveAgreements();
    const today = todayMYT();

    let report = `*📋 REPORT 1: EXPIRING BY MODELS*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    if (agreements.length === 0) {
      report += `No active bookings`;
      return report;
    }

    // Group by car model/type, sorted alphabetically
    const byModel = {};
    for (const a of agreements) {
      const model = a.car_type || 'Unknown';
      if (!byModel[model]) byModel[model] = [];
      const endDate = (getEndDate(a) || '').slice(0, 10);
      const daysLeft = daysBetween(today, endDate);
      byModel[model].push({
        plate: a.plate_number,
        customer: a.customer_name || 'N/A',
        returnDate: endDate,
        daysLeft,
      });
    }

    // Sort each group by return date (soonest first)
    for (const entries of Object.values(byModel)) {
      entries.sort((a, b) => new Date(a.returnDate) - new Date(b.returnDate));
    }

    for (const [model, entries] of Object.entries(byModel).sort((a, b) => a[0].localeCompare(b[0]))) {
      report += `*${model}:*\n`;
      for (const e of entries) {
        const icon = e.daysLeft < 0 ? '🚨' : e.daysLeft <= 1 ? '⚠️' : '✅';
        report += `  ${icon} ${e.plate} | ${e.customer} | Return: ${e.returnDate} (${e.daysLeft}d)\n`;
      }
      report += `\n`;
    }

    report += `Total Active: ${agreements.length}`;
    return report;
  }

  // ─── Report 2: Expiring with Contacts ─────────────────
  async sortedByContact() {
    const agreements = await agreementsService.getActiveAgreements();
    const today = todayMYT();

    let report = `*📱 REPORT 2: EXPIRING WITH CONTACTS*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    if (agreements.length === 0) {
      report += `No active bookings`;
      return report;
    }

    // Sort by end date (soonest first)
    const sorted = [...agreements].sort((a, b) => new Date(getEndDate(a) || 0) - new Date(getEndDate(b) || 0));

    for (const a of sorted) {
      const endDate = (getEndDate(a) || '').slice(0, 10);
      const daysLeft = daysBetween(today, endDate);
      const icon = daysLeft < 0 ? '🚨 OVERDUE' : daysLeft <= 1 ? '⚠️' : '';
      const phone = a.mobile || 'N/A';
      const waLink = a.mobile ? `wa.me/${a.mobile.replace(/\D/g, '')}` : '';

      report += `${a.car_type || 'N/A'} (${a.plate_number}) | ${endDate} (${daysLeft}d) ${icon}\n`;
      report += `  👤 ${a.customer_name || 'N/A'}\n`;
      report += `  📱 ${phone}${waLink ? ` | ${waLink}` : ''}\n\n`;
    }

    report += `Total: ${agreements.length}`;
    return report;
  }

  // ─── Report 3: Expiring by Time Slot ──────────────────
  async sortedByTimeslot() {
    const agreements = await agreementsService.getActiveAgreements();
    const today = todayMYT();

    let report = `*🕐 REPORT 3: EXPIRING BY TIME SLOT*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    if (agreements.length === 0) {
      report += `No active bookings`;
      return report;
    }

    const slots = {
      'TODAY (0-1 days)': [],
      'TOMORROW (1-2 days)': [],
      'THIS WEEK (2-7 days)': [],
      'NEXT WEEK (7-14 days)': [],
      'LATER (14+ days)': [],
    };

    for (const a of agreements) {
      const endDate = (getEndDate(a) || '').slice(0, 10);
      const daysLeft = daysBetween(today, endDate);

      const entry = {
        model: a.car_type || 'N/A',
        plate: a.plate_number,
        customer: a.customer_name || 'N/A',
        phone: a.mobile || 'N/A',
        daysLeft,
      };

      if (daysLeft < 0) slots['TODAY (0-1 days)'].push(entry); // overdue counts as today
      else if (daysLeft <= 1) slots['TODAY (0-1 days)'].push(entry);
      else if (daysLeft <= 2) slots['TOMORROW (1-2 days)'].push(entry);
      else if (daysLeft <= 7) slots['THIS WEEK (2-7 days)'].push(entry);
      else if (daysLeft <= 14) slots['NEXT WEEK (7-14 days)'].push(entry);
      else slots['LATER (14+ days)'].push(entry);
    }

    for (const [slot, entries] of Object.entries(slots)) {
      report += `*${slot}: ${entries.length} vehicle(s)*\n`;
      if (entries.length > 0) {
        for (const e of entries) {
          report += `  • ${e.model} (${e.plate}) - ${e.customer}\n`;
          report += `    📱 ${e.phone}\n`;
        }
      }
      report += `\n`;
    }

    return report;
  }

  // ─── Report 4: Follow-up Required ─────────────────────
  async followUpReport() {
    const [expiring, overdue, allAgreements] = await Promise.all([
      agreementsService.getExpiringAgreements(3),
      agreementsService.getOverdueAgreements(),
      agreementsService.getAllAgreements(),
    ]);

    const today = todayMYT();

    // Pending status bookings (need follow-up)
    const pending = allAgreements.filter(a =>
      a.status && /pending|awaiting/i.test(a.status)
    );

    let report = `*📞 REPORT 4: FOLLOW-UP REQUIRED*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    // Overdue section
    report += `*🚨 OVERDUE (${overdue.length}):*\n`;
    if (overdue.length > 0) {
      for (const a of overdue) {
        const endDate = (getEndDate(a) || '').slice(0, 10);
        const daysLate = daysBetween(endDate, today);
        report += `  • ${a.customer_name || 'N/A'} - ${a.car_type || 'N/A'} (${a.plate_number})\n`;
        report += `    ${daysLate}d overdue | Due: ${endDate} | 📱 ${a.mobile || 'N/A'}\n`;
      }
    } else {
      report += `  None - all good! ✅\n`;
    }

    // Expiring section
    report += `\n*⚠️ EXPIRING IN 3 DAYS (${expiring.length}):*\n`;
    if (expiring.length > 0) {
      for (const a of expiring) {
        const endDate = (getEndDate(a) || '').slice(0, 10);
        const daysLeft = daysBetween(today, endDate);
        report += `  • ${a.customer_name || 'N/A'} - ${a.car_type || 'N/A'} (${a.plate_number})\n`;
        report += `    ${daysLeft}d left | Ends: ${endDate} | 📱 ${a.mobile || 'N/A'}\n`;
      }
    } else {
      report += `  None expiring soon ✅\n`;
    }

    // Pending section
    if (pending.length > 0) {
      report += `\n*📋 PENDING (${pending.length}):*\n`;
      for (const a of pending) {
        report += `  • ${a.customer_name || 'N/A'} - ${a.car_type || 'N/A'} (${a.plate_number}) [${a.status}]\n`;
      }
    }

    report += `\n*Action:* Contact these customers to confirm extend/return.`;
    return report;
  }

  // ─── Report 5: Available Cars ─────────────────────────
  async availableReport() {
    const [cars, activeAgreements] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);

    const { validated, mismatches } = validateFleetStatus(cars, activeAgreements);
    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
    const activeCars = validated.filter(c => c.status !== 'inactive');

    let report = `*🚗 REPORT 5: AVAILABLE CARS*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    if (available.length === 0) {
      report += `No cars available`;
      return report;
    }

    // Group by model (carName/body_type + year) — deduplicated view
    const byModel = {};
    for (const car of available) {
      const name = car._carName || car.body_type || 'Unknown';
      const key = `${name}${car.year ? ' (' + car.year + ')' : ''}`;
      if (!byModel[key]) byModel[key] = [];
      byModel[key].push(car);
    }

    for (const [model, modelCars] of Object.entries(byModel).sort((a, b) => a[0].localeCompare(b[0]))) {
      report += `*${model}: ${modelCars.length} unit(s)*\n`;
      report += `  ${modelCars.map(c => c.plate_number).join(', ')}\n`;
      report += `  RM${modelCars[0].daily_price}/day\n\n`;
    }

    report += `Total Available: ${available.length}/${activeCars.length}`;

    if (mismatches.length > 0) {
      report += `\n\n*⚠️ Status Mismatches (${mismatches.length}):*\n`;
      for (const m of mismatches) {
        report += `  ${m.plate}: ${m.dbStatus} → ${m.actualStatus}\n`;
      }
    }

    return report;
  }

  // ─── Report 6: Summary/Totals ─────────────────────────
  async summaryReport() {
    const [cars, activeAgreements, overdue, expiringToday] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
      agreementsService.getOverdueAgreements(),
      agreementsService.getExpiringAgreements(1),
    ]);

    const { validated } = validateFleetStatus(cars, activeAgreements);
    const activeCars = validated.filter(c => c.status !== 'inactive');
    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
    const today = todayMYT();

    let report = `*📊 REPORT 6: SUMMARY/TOTALS*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    report += `Fleet Size: ${activeCars.length} active vehicles\n`;
    report += `Currently Rented: ${activeAgreements.length}\n`;
    report += `Available: ${available.length}\n`;
    const rate = activeCars.length > 0 ? ((available.length / activeCars.length) * 100).toFixed(1) : '0.0';
    report += `Availability Rate: ${rate}%\n`;

    // Expiring today
    report += `\nTotal Expiring Today: ${expiringToday.length} car(s)\n`;

    if (overdue.length > 0) {
      report += `🚨 Overdue Returns: ${overdue.length}\n`;
    }

    // Fleet composition by car type
    const carTypes = [...new Set(activeCars.map(c => c._carName || c.body_type).filter(Boolean))];
    if (carTypes.length > 0) {
      report += `\n*Fleet Composition (${carTypes.length} types):*\n`;
      for (const type of carTypes.sort()) {
        const total = activeCars.filter(c => (c._carName || c.body_type) === type).length;
        const rented = activeAgreements.filter(a => {
          const car = activeCars.find(c => c.plate_number?.toUpperCase() === a.plate_number?.toUpperCase());
          return car && (car._carName || car.body_type) === type;
        }).length;
        report += `  ${type}: ${rented}/${total} rented\n`;
      }
    }

    report += `\nStatus: ${overdue.length === 0 ? 'Ready for operations ✅' : '⚠️ Action needed — overdue returns'}`;
    return report;
  }

  // ─── Fleet Report (bonus) ─────────────────────────────
  async fleetReport() {
    const [cars, activeAgreements] = await Promise.all([
      fleetService.getAllCars(),
      agreementsService.getActiveAgreements(),
    ]);

    const { validated, mismatches } = validateFleetStatus(cars, activeAgreements);
    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
    const rented = validated.filter(c => (c._validatedStatus || c.status) === 'rented');
    const maintenance = validated.filter(c => (c._validatedStatus || c.status) === 'maintenance');
    const overdueList = validated.filter(c => c._overdue);

    let report = `*🚗 JRV Fleet Report*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;
    report += `Total: ${validated.length} cars\n`;
    report += `Available: ${available.length}\n`;
    report += `Rented: ${rented.length}\n`;
    report += `Maintenance: ${maintenance.length}\n`;
    if (overdueList.length) report += `⚠ Overdue returns: ${overdueList.length}\n`;

    if (available.length > 0) {
      report += `\n*Available Cars:*\n`;
      for (const car of available) {
        report += `  ${car.plate_number} ${car._carName || car.body_type || ''} RM${car.daily_price}/day\n`;
      }
    }

    if (overdueList.length > 0) {
      report += `\n*⚠ Overdue Returns:*\n`;
      for (const car of overdueList) {
        const agreement = activeAgreements.find(a => a.plate_number?.toUpperCase() === car.plate_number?.toUpperCase());
        if (agreement) {
          const endDate = (getEndDate(agreement) || '').slice(0, 10);
          const daysLate = daysBetween(endDate, todayMYT());
          report += `  ${car.plate_number} - ${agreement.customer_name} (${daysLate}d overdue)\n`;
        }
      }
    }

    if (mismatches.length > 0) {
      report += `\n*⚠ Status Mismatches:*\n`;
      for (const m of mismatches) {
        report += `  ${m.plate}: "${m.dbStatus}" → "${m.actualStatus}"\n`;
        report += `    ${m.reason}\n`;
      }
    }

    return report;
  }

  // ─── Earnings Report (bonus) ──────────────────────────
  async earningsReport() {
    const [todayEarnings, monthEarnings] = await Promise.all([
      agreementsService.getTodayEarnings(),
      agreementsService.getMonthEarnings(),
    ]);

    let report = `*💰 JRV Earnings Report*\n`;
    report += `🕐 ${formatMYT(new Date(), 'full')}\n\n`;

    report += `*Today:*\n`;
    report += `  Bookings: ${todayEarnings.count}\n`;
    report += `  Revenue: RM${todayEarnings.total.toFixed(2)}\n`;
    report += `  Collected: RM${todayEarnings.collected.toFixed(2)}\n`;
    report += `  Pending: RM${todayEarnings.pending.toFixed(2)}\n`;

    report += `\n*This Month:*\n`;
    report += `  Bookings: ${monthEarnings.count}\n`;
    report += `  Revenue: RM${monthEarnings.total.toFixed(2)}\n`;
    report += `  Collected: RM${monthEarnings.collected.toFixed(2)}\n`;
    report += `  Pending: RM${monthEarnings.pending.toFixed(2)}\n`;

    return report;
  }

  async dailySummary() {
    return this.summaryReport();
  }
}

module.exports = new ReportGenerator();
