const { fleetService, agreementsService, dataStoreService } = require('../supabase/services');
const { validateFleetStatus, getEndDate, getStartDate } = require('../utils/validators');
const { formatMYT, todayMYT, daysBetween, nowMYT } = require('../utils/time');
const policies = require('./policies');

/**
 * Report Generator
 * DB columns: agreements use plate_number, mobile, date_start, date_end, total_price, car_type
 * Cars use plate_number, body_type, daily_price, _carName (enriched from catalog)
 */
class ReportGenerator {
  async sortedByTime() {
    const agreements = await agreementsService.getActiveAgreements();
    const today = todayMYT();

    let report = `*📋 Report 1: Sorted by Time*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    if (agreements.length === 0) {
      report += `\`\`\`No active bookings\`\`\``;
      return report;
    }

    const sorted = [...agreements].sort((a, b) => new Date(getEndDate(a) || 0) - new Date(getEndDate(b) || 0));

    report += `\`\`\`\n`;
    for (const a of sorted) {
      const endDate = (getEndDate(a) || '').slice(0, 10);
      const startDate = (getStartDate(a) || '').slice(0, 10);
      const daysLeft = daysBetween(today, endDate);
      const status = daysLeft < 0 ? '🚨 OVERDUE' : daysLeft <= 2 ? '⚠️ EXPIRING' : '✅';
      report += `${a.plate_number} | ${a.customer_name}\n`;
      report += `  ${startDate} → ${endDate} (${daysLeft}d) ${status}\n`;
      if (a.mobile) report += `  📱 ${a.mobile}\n`;
      report += `\n`;
    }
    report += `\`\`\``;
    report += `\nTotal: ${agreements.length} active`;

    return report;
  }

  async sortedByContact() {
    const agreements = await agreementsService.getActiveAgreements();

    let report = `*📱 Report 2: Sorted by Contact*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    if (agreements.length === 0) {
      report += `\`\`\`No active bookings\`\`\``;
      return report;
    }

    const grouped = {};
    for (const a of agreements) {
      const key = a.mobile || a.customer_name;
      if (!grouped[key]) grouped[key] = { name: a.customer_name, phone: a.mobile, bookings: [] };
      grouped[key].bookings.push(a);
    }

    report += `\`\`\`\n`;
    for (const [key, customer] of Object.entries(grouped)) {
      report += `👤 ${customer.name}\n`;
      report += `   📱 ${customer.phone || 'N/A'}\n`;
      for (const b of customer.bookings) {
        report += `   ${b.plate_number} | ${(getStartDate(b) || '').slice(0, 10)} → ${(getEndDate(b) || '').slice(0, 10)}\n`;
      }
      report += `\n`;
    }
    report += `\`\`\``;
    report += `\n${Object.keys(grouped).length} customers, ${agreements.length} bookings`;

    return report;
  }

  async sortedByTimeslot() {
    const today = todayMYT();
    const allAgreements = await agreementsService.getActiveAgreements();
    const allAgreementsAll = await agreementsService.getAllAgreements();

    const pickupsToday = allAgreementsAll.filter(a =>
      a.date_start && a.date_start.startsWith(today) && ['New', 'Editted', 'Extended'].includes(a.status)
    );
    const returnsToday = allAgreements.filter(a =>
      a.date_end && a.date_end.startsWith(today)
    );

    let report = `*🕐 Report 3: Today's Timeslots*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    report += `*Pickups Today (${pickupsToday.length}):*\n`;
    if (pickupsToday.length > 0) {
      report += `\`\`\`\n`;
      for (const a of pickupsToday) {
        report += `${a.plate_number} → ${a.customer_name}\n`;
        report += `  📱 ${a.mobile || 'N/A'}\n`;
      }
      report += `\`\`\`\n`;
    } else {
      report += `\`\`\`No pickups today\`\`\`\n`;
    }

    report += `\n*Returns Today (${returnsToday.length}):*\n`;
    if (returnsToday.length > 0) {
      report += `\`\`\`\n`;
      for (const a of returnsToday) {
        report += `${a.plate_number} ← ${a.customer_name}\n`;
        report += `  📱 ${a.mobile || 'N/A'}\n`;
      }
      report += `\`\`\``;
    } else {
      report += `\`\`\`No returns today\`\`\``;
    }

    return report;
  }

  async followUpReport() {
    const [expiring, overdue] = await Promise.all([
      agreementsService.getExpiringAgreements(3),
      agreementsService.getOverdueAgreements(),
    ]);

    let report = `*📞 Report 4: Follow-up Required*\n`;
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;

    report += `*🚨 OVERDUE (${overdue.length}):*\n`;
    if (overdue.length > 0) {
      report += `\`\`\`\n`;
      for (const a of overdue) {
        const endDate = (getEndDate(a) || '').slice(0, 10);
        const daysLate = daysBetween(endDate, todayMYT());
        report += `${a.plate_number} | ${a.customer_name} (${daysLate}d late)\n`;
        report += `  📱 ${a.mobile || 'N/A'}\n`;
        report += `  Due: ${endDate}\n`;
      }
      report += `\`\`\`\n`;
    } else {
      report += `\`\`\`None - all good!\`\`\`\n`;
    }

    report += `\n*⚠️ EXPIRING IN 3 DAYS (${expiring.length}):*\n`;
    if (expiring.length > 0) {
      report += `\`\`\`\n`;
      for (const a of expiring) {
        const endDate = (getEndDate(a) || '').slice(0, 10);
        const daysLeft = daysBetween(todayMYT(), endDate);
        report += `${a.plate_number} | ${a.customer_name} (${daysLeft}d left)\n`;
        report += `  📱 ${a.mobile || 'N/A'}\n`;
        report += `  Ends: ${endDate}\n`;
      }
      report += `\`\`\``;
    } else {
      report += `\`\`\`None expiring soon\`\`\``;
    }

    report += `\n\n*Action:* Contact these customers to confirm extend/return.`;
    return report;
  }

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

    const grouped = {};
    for (const car of available) {
      const cat = car.body_type || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(car);
    }

    for (const [cat, catCars] of Object.entries(grouped)) {
      report += `*${cat}:*\n\`\`\`\n`;
      for (const car of catCars) {
        report += `${car.plate_number} | ${car._carName || car.body_type || ''}`;
        report += ` | RM${car.daily_price}/day\n`;
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

    report += `*Fleet:*\n\`\`\`\n`;
    report += `Total: ${fleetStats.total} | Available: ${fleetStats.available}\n`;
    report += `Rented: ${fleetStats.rented} | Maintenance: ${fleetStats.maintenance}\n`;
    report += `\`\`\`\n`;

    report += `\n*Bookings:*\n\`\`\`\n`;
    report += `Active: ${agreementStats.activeCount}\n`;
    report += `Expiring (3d): ${agreementStats.expiringCount}\n`;
    report += `Overdue: ${agreementStats.overdueCount}\n`;
    report += `\`\`\`\n`;

    report += `\n*Revenue (This Month):*\n\`\`\`\n`;
    report += `Total: RM${agreementStats.monthRevenue.toFixed(2)}\n`;
    report += `Collected: RM${agreementStats.monthCollected.toFixed(2)}\n`;
    report += `Pending: RM${(agreementStats.monthRevenue - agreementStats.monthCollected).toFixed(2)}\n`;
    report += `Customers: ${agreementStats.totalCustomers}\n`;
    report += `\`\`\``;

    if (overdue.length > 0) {
      report += `\n\n*🚨 Overdue (${overdue.length}):*\n\`\`\`\n`;
      for (const a of overdue) {
        const endDate = (getEndDate(a) || '').slice(0, 10);
        const days = daysBetween(endDate, todayMYT());
        report += `${a.plate_number} - ${a.customer_name} (${days}d)\n`;
      }
      report += `\`\`\``;
    }

    if (expiring.length > 0) {
      report += `\n\n*⚠️ Expiring (${expiring.length}):*\n\`\`\`\n`;
      for (const a of expiring) {
        report += `${a.plate_number} - ${a.customer_name} (${(getEndDate(a) || '').slice(0, 10)})\n`;
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

    if (topCustomers.length > 0) {
      report += `\n\n*Top Customers:*\n\`\`\`\n`;
      for (const c of topCustomers.slice(0, 5)) {
        report += `${c.name} (${c.rentals}x) RM${c.totalSpent.toFixed(0)}\n`;
      }
      report += `\`\`\``;
    }

    return report;
  }

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
    report += `*${formatMYT(new Date(), 'full')}*\n\n`;
    report += `\`\`\`Total: ${validated.length} cars\n`;
    report += `Available: ${available.length}\n`;
    report += `Rented: ${rented.length}\n`;
    report += `Maintenance: ${maintenance.length}\n`;
    if (overdueList.length) report += `⚠ Overdue returns: ${overdueList.length}\n`;
    report += `\`\`\`\n`;

    if (available.length > 0) {
      report += `\n*Available Cars:*\n\`\`\`\n`;
      for (const car of available) {
        report += `${car.plate_number} ${car._carName || car.body_type || ''} RM${car.daily_price}/day\n`;
      }
      report += `\`\`\``;
    }

    if (overdueList.length > 0) {
      report += `\n\n*⚠ Overdue Returns:*\n\`\`\`\n`;
      for (const car of overdueList) {
        const agreement = activeAgreements.find(a => a.plate_number?.toUpperCase() === car.plate_number?.toUpperCase());
        if (agreement) {
          const endDate = (getEndDate(agreement) || '').slice(0, 10);
          const daysLate = daysBetween(endDate, todayMYT());
          report += `${car.plate_number} - ${agreement.customer_name} (${daysLate}d overdue)\n`;
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

  async dailySummary() {
    return this.summaryReport();
  }
}

module.exports = new ReportGenerator();
