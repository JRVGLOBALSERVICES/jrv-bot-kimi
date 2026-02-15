const fleetService = require('./fleet-service');
const agreementsService = require('./agreements-service');
const dataStoreService = require('./data-store-service');
const { validateFleetStatus, getPlate } = require('../../utils/validators');
const { formatMYT } = require('../../utils/time');

/**
 * SyncEngine - Periodically syncs Supabase data to local cache.
 * Cross-validates car status with agreements on every sync.
 */
class SyncEngine {
  constructor() {
    this.cache = {
      cars: [],
      validatedCars: [],
      catalog: [],
      agreements: [],
      customers: [],
      pricing: [],
      zones: [],
      faq: [],
      templates: [],
      config: [],
      adminConfig: [],
      mismatches: [],
      lastSync: null,
    };
    this.syncInterval = null;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
  }

  async sync() {
    try {
      // Load catalog first (for make/model enrichment)
      await fleetService.loadCatalog();

      const [cars, agreements, customers, context, adminConfig] = await Promise.all([
        fleetService.getAllCars(),
        agreementsService.getActiveAgreements(),
        agreementsService.getUniqueCustomers(),
        dataStoreService.getFullContext(),
        dataStoreService.getAdminConfig(),
      ]);

      // Cross-validate car status with agreements
      const { validated, mismatches } = validateFleetStatus(cars, agreements);

      if (mismatches.length > 0) {
        console.warn(`[Sync] ⚠ ${mismatches.length} status mismatches detected:`);
        mismatches.forEach(m => console.warn(`  ${m.plate || m.carLabel}: ${m.dbStatus} → ${m.actualStatus} (${m.reason})`));
      }

      this.cache = {
        cars,
        validatedCars: validated,
        catalog: [],
        agreements,
        customers,
        pricing: context.pricing,
        zones: context.zones,
        faq: context.faq,
        config: context.config,
        templates: context.testimonials,
        adminConfig,
        mismatches,
        lastSync: new Date(),
      };

      console.log(`[Sync] OK - ${cars.length} cars, ${agreements.length} active bookings, ${customers.length} customers, ${mismatches.length} mismatches`);
      return true;
    } catch (err) {
      console.error('[Sync] Failed:', err.message);
      return false;
    }
  }

  start() {
    console.log('[Sync] Starting auto-sync every 5 minutes...');
    this.sync();
    this.syncInterval = setInterval(() => this.sync(), this.intervalMs);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    console.log('[Sync] Stopped.');
  }

  getCache() {
    return this.cache;
  }

  getAdminPhones() {
    const admins = this.cache.adminConfig || [];
    const phones = [];
    for (const entry of admins) {
      if (entry.value && entry.value.phone) {
        phones.push(entry.value.phone.replace(/\D/g, ''));
      }
      if (entry.value && Array.isArray(entry.value)) {
        for (const admin of entry.value) {
          if (admin.phone) phones.push(admin.phone.replace(/\D/g, ''));
        }
      }
    }
    return phones;
  }

  lookupCustomer(phone) {
    const clean = phone.replace(/\D/g, '');
    for (const c of this.cache.customers) {
      const cPhone = (c.mobile || '').replace(/\D/g, '');
      if (cPhone && (cPhone.includes(clean) || clean.includes(cPhone))) {
        return c;
      }
    }
    return null;
  }

  isAdmin(phone) {
    const clean = phone.replace(/\D/g, '');
    return this.getAdminPhones().some(p => p.includes(clean) || clean.includes(p));
  }

  buildContextSummary() {
    const c = this.cache;
    if (!c.lastSync) return 'Data not yet synced.';

    const validated = c.validatedCars || c.cars;
    const available = validated.filter(car => (car._validatedStatus || car.status) === 'available');
    const rented = validated.filter(car => (car._validatedStatus || car.status) === 'rented');
    const maintenance = validated.filter(car => (car._validatedStatus || car.status) === 'maintenance');

    const lines = [
      `=== JRV Car Rental - Live Data (synced ${formatMYT(c.lastSync, 'datetime')}) ===`,
      '',
      `Fleet: ${validated.length} cars (${available.length} available, ${rented.length} rented, ${maintenance.length} maintenance)`,
      `Active bookings: ${c.agreements.length}`,
      `Unique customers: ${c.customers.length}`,
      '',
      '--- Available Cars ---',
      ...available.map(car =>
        `  ${car.plate_number} - ${car._carName || car.body_type || ''} ${car.year || ''} RM${car.daily_price}/day`
      ),
      '',
      '--- Active Bookings ---',
      ...c.agreements.map(a =>
        `  ${a.customer_name} - ${a.plate_number} ${a.car_type || ''} (${(a.date_start || '').slice(0, 10)} to ${(a.date_end || '').slice(0, 10)}) [${a.status}]`
      ),
      '',
      '--- Pricing ---',
      ...c.pricing.map(p => `  ${p.key}: ${JSON.stringify(p.value)}`),
      '',
      '--- Delivery Zones ---',
      ...c.zones.map(z => `  ${z.key}: ${JSON.stringify(z.value)}`),
      '',
      '--- FAQ ---',
      ...c.faq.map(f => `  Q: ${f.key} → A: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`),
    ];

    if (c.mismatches.length > 0) {
      lines.push('', '--- STATUS MISMATCHES (need attention) ---');
      c.mismatches.forEach(m => lines.push(`  ⚠ ${m.plate || m.carLabel}: DB="${m.dbStatus}" actual="${m.actualStatus}" — ${m.reason}`));
    }

    return lines.join('\n');
  }
}

module.exports = new SyncEngine();
