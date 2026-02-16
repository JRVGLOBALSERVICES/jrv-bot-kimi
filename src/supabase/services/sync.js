const fleetService = require('./fleet-service');
const agreementsService = require('./agreements-service');
const dataStoreService = require('./data-store-service');
const { validateFleetStatus, getPlate } = require('../../utils/validators');
const { formatMYT } = require('../../utils/time');
const config = require('../../config');

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
    this.controlInterval = null;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
    this.controlIntervalMs = 30 * 1000; // 30 seconds
    this._lastControlTimestamp = null;
    this._paused = false;
    this._onCommand = null; // callback for control commands
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

      // Reload JARVIS memory & rules (non-blocking)
      try { require('../../brain/memory').load(); } catch (e) { /* non-critical */ }

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

  /**
   * Write bot heartbeat to Supabase so the dashboard knows we're alive.
   */
  async writeHeartbeat(extras = {}) {
    try {
      const supabase = require('../client');
      await supabase.from('bot_data_store').upsert({
        key: 'bot_status',
        value: {
          online: true,
          mode: config.mode,
          cloudProvider: config.cloudProvider,
          kimiModel: config.kimi.model,
          groqModel: config.groq.model,
          cars: this.cache.cars.length,
          agreements: this.cache.agreements.length,
          lastSync: this.cache.lastSync?.toISOString(),
          paused: this._paused,
          ...extras,
        },
        created_by: 'jarvis',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch (err) {
      // Heartbeat failure is non-critical
      console.warn('[Sync] Heartbeat write failed:', err.message);
    }
  }

  /**
   * Poll for control commands from the dashboard.
   * On first poll after boot, records the current timestamp to avoid
   * re-executing stale commands. Also clears kill/restart commands
   * after execution to prevent restart loops.
   */
  async pollControl() {
    try {
      const supabase = require('../client');
      const { data } = await supabase
        .from('bot_data_store')
        .select('value, updated_at')
        .eq('key', 'bot_control')
        .single();

      if (!data?.value) return;

      const { command, timestamp } = data.value;
      if (!timestamp) return;

      // On first poll after boot, just record the timestamp — don't execute.
      // This prevents stale commands from triggering on restart.
      if (this._lastControlTimestamp === null) {
        this._lastControlTimestamp = timestamp;
        console.log(`[Sync] Ignoring stale command on boot: ${command} (ts: ${timestamp})`);
        return;
      }

      // Already processed this command
      if (timestamp === this._lastControlTimestamp) return;

      // Safety: ignore commands older than 60 seconds
      const commandAge = Date.now() - timestamp;
      if (commandAge > 60000) {
        this._lastControlTimestamp = timestamp;
        console.log(`[Sync] Ignoring old command: ${command} (${Math.round(commandAge / 1000)}s old)`);
        return;
      }

      this._lastControlTimestamp = timestamp;
      console.log(`[Sync] Dashboard command received: ${command}`);

      switch (command) {
        case 'kill':
          console.log('[Sync] KILL command received from dashboard. Shutting down...');
          await this.writeHeartbeat({ online: false, shutdownReason: 'dashboard_kill' });
          await this._clearControl(supabase);
          process.exit(0);
          break;

        case 'restart':
          console.log('[Sync] RESTART command received from dashboard.');
          await this.writeHeartbeat({ online: false, shutdownReason: 'dashboard_restart' });
          await this._clearControl(supabase);
          process.exit(1); // Exit with error so process manager restarts
          break;

        case 'pause':
          this._paused = true;
          console.log('[Sync] PAUSE command — bot will ignore customer messages.');
          await this.writeHeartbeat();
          break;

        case 'resume':
          this._paused = false;
          console.log('[Sync] RESUME command — bot is active again.');
          await this.writeHeartbeat();
          break;

        case 'relink':
          console.log('[Sync] RELINK command — forcing WhatsApp re-authentication...');
          await this._clearControl(supabase);
          // The onCommand callback in index.js handles the actual relink
          break;
      }

      if (this._onCommand) this._onCommand(command);
    } catch (err) {
      // Control polling failure is non-critical
    }
  }

  /**
   * Clear the control command after execution (prevents restart loops).
   */
  async _clearControl(supabase) {
    try {
      await supabase.from('bot_data_store').upsert({
        key: 'bot_control',
        value: { command: null, timestamp: null, cleared: Date.now() },
        created_by: 'jarvis',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch (err) {
      // Non-critical
    }
  }

  /**
   * Poll for config changes from dashboard (model switching etc).
   */
  async pollConfig() {
    try {
      const supabase = require('../client');
      const { data } = await supabase
        .from('bot_data_store')
        .select('value')
        .eq('key', 'bot_config')
        .single();

      if (!data?.value) return;
      const cfg = data.value;

      // Apply model changes
      if (cfg.cloudProvider && cfg.cloudProvider !== config.cloudProvider) {
        console.log(`[Sync] Cloud provider changed: ${config.cloudProvider} → ${cfg.cloudProvider}`);
        config.cloudProvider = cfg.cloudProvider;
      }
      if (cfg.kimiModel && cfg.kimiModel !== config.kimi.model) {
        console.log(`[Sync] Kimi model changed: ${config.kimi.model} → ${cfg.kimiModel}`);
        config.kimi.model = cfg.kimiModel;
      }
      if (cfg.groqModel && cfg.groqModel !== config.groq.model) {
        console.log(`[Sync] Groq model changed: ${config.groq.model} → ${cfg.groqModel}`);
        config.groq.model = cfg.groqModel;
      }
      if (cfg.localModel && cfg.localModel !== config.localAI.model) {
        console.log(`[Sync] Local model changed: ${config.localAI.model} → ${cfg.localModel}`);
        config.localAI.model = cfg.localModel;
      }
      if (cfg.geminiModel && cfg.geminiModel !== config.gemini.model) {
        console.log(`[Sync] Gemini model changed: ${config.gemini.model} → ${cfg.geminiModel}`);
        config.gemini.model = cfg.geminiModel;
      }
    } catch (err) {
      // Config polling failure is non-critical
    }
  }

  /**
   * Set callback for control commands.
   */
  onCommand(callback) {
    this._onCommand = callback;
  }

  /**
   * Check if bot is paused by dashboard.
   */
  isPaused() {
    return this._paused;
  }

  start() {
    console.log('[Sync] Starting auto-sync every 5 minutes...');
    this.sync().then(() => this.writeHeartbeat());
    this.syncInterval = setInterval(() => {
      this.sync().then(() => this.writeHeartbeat());
    }, this.intervalMs);

    // Control polling every 30 seconds
    this.pollControl();
    this.pollConfig();
    this.controlInterval = setInterval(() => {
      this.pollControl();
      this.pollConfig();
    }, this.controlIntervalMs);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.controlInterval) {
      clearInterval(this.controlInterval);
      this.controlInterval = null;
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
