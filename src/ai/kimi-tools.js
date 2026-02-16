/**
 * Kimi K2 Tool Definitions - Function calling tools for JARVIS.
 *
 * These tools let Kimi K2 query live data from Supabase
 * during conversation, so it can give accurate answers.
 */

const { fleetService, agreementsService, dataStoreService, syncEngine } = require('../supabase/services');
const policies = require('../brain/policies');
const { todayMYT, daysBetween } = require('../utils/time');
const { colorName } = require('../utils/validators');

// ─── Tool Definitions (OpenAI function format) ──────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_available_cars',
      description: 'Get list of currently available cars for rental. Returns car models, categories, and daily rates. Do NOT include car plates when responding to customers.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by category: economy, compact, suv, premium, mpv. Leave empty for all.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing',
      description: 'Get rental pricing for all car categories. Returns daily, 3-day, weekly, and monthly rates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_delivery_fee',
      description: 'Get delivery fee for a specific location.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Delivery location name (e.g., KLIA, KL, Seremban, Nilai)' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_customer',
      description: 'Look up a customer by phone number. Returns their rental history and active bookings.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Customer phone number' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_bookings',
      description: 'Get all currently active rental bookings.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_expiring_rentals',
      description: 'Get rentals expiring within N days.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Number of days ahead to check (default 3)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overdue_rentals',
      description: 'Get all overdue rentals (past end date but not returned).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fleet_status',
      description: 'Get fleet overview: total cars, available, rented, maintenance counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_cars',
      description: 'Search for cars by make, model, color, or plate number.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_info',
      description: 'Get payment methods, bank details, and instructions.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_delivery_by_coordinates',
      description: 'Calculate delivery fee from GPS coordinates. Use when customer shares location.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude' },
          longitude: { type: 'number', description: 'Longitude' },
        },
        required: ['latitude', 'longitude'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_jrv_location',
      description: 'Get JRV Car Rental office location (Google Maps link).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_policies',
      description: 'Get specific business policy information.',
      parameters: {
        type: 'object',
        properties: {
          policy: {
            type: 'string',
            description: 'Policy type: deposit, cancellation, extension, fuel, cleanliness, insurance, documents',
          },
        },
        required: ['policy'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_stats',
      description: 'Get bot system info: current AI model, provider, API stats, uptime, performance. Use when asked about model, engine, speed, stats, or system.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reports',
      description: 'Generate daily business reports. Can generate one or multiple reports at once. Report types: 1=Sorted by Time, 2=Contact List, 3=Today Timeslots, 4=Follow-up Required, 5=Available Cars, 6=Daily Summary, fleet=Fleet Status, earnings=Revenue. Use "all" or "1,2,3,4,5,6" to get all daily reports.',
      parameters: {
        type: 'object',
        properties: {
          reports: {
            type: 'string',
            description: 'Comma-separated report numbers or names. Examples: "all", "1,2,3,4,5,6", "6", "fleet,earnings", "4,5"',
          },
        },
        required: ['reports'],
      },
    },
  },
];

// ─── Tool Executor ───────────────────────────────────────
// isAdmin context is passed through to control sensitive data exposure.

async function executeTool(name, args, { isAdmin = false } = {}) {
  switch (name) {
    case 'get_available_cars': {
      const { validateFleetStatus } = require('../utils/validators');
      const [cars, agreements] = await Promise.all([
        fleetService.getAllCars(),
        agreementsService.getActiveAgreements(),
      ]);
      const { validated } = validateFleetStatus(cars, agreements);
      let available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
      if (args.category) {
        available = available.filter(c => (c.body_type || '').toLowerCase() === args.category.toLowerCase());
      }
      return available.map(c => {
        const result = {
          car_name: c._carName || c.body_type || '',
          color: colorName(c.color),
          year: c.year,
          body_type: c.body_type,
          daily_price: c.daily_price,
        };
        if (isAdmin) result.plate_number = c.plate_number;
        return result;
      });
    }

    case 'get_pricing':
      return policies.pricing;

    case 'get_delivery_fee': {
      const fee = policies.getDeliveryFee(args.location);
      if (fee) return fee;
      return { error: `Unknown location: ${args.location}`, zones: policies.deliveryZones };
    }

    case 'lookup_customer': {
      // Only admins can look up other customers
      if (!isAdmin) return { error: 'Customer lookup is only available to admin users.' };
      const history = await agreementsService.getCustomerHistory(args.phone);
      if (!history) return { found: false, message: 'No customer found with this phone number' };
      return {
        found: true,
        name: history.name,
        totalRentals: history.totalRentals,
        totalSpent: history.totalSpent,
        isRegular: history.totalRentals >= 5,
        activeRentals: history.activeRentals.map(a => ({
          car_type: a.car_type || '',
          plate_number: a.plate_number,
          date_start: a.date_start,
          date_end: a.date_end,
          status: a.status,
        })),
      };
    }

    case 'get_active_bookings': {
      // Only admins can see all bookings
      if (!isAdmin) return { error: 'Active bookings list is only available to admin users.' };
      const active = await agreementsService.getActiveAgreements();
      return active.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_start: a.date_start,
        date_end: a.date_end,
        status: a.status,
        days_left: daysBetween(todayMYT(), (a.date_end || '').slice(0, 10)),
      }));
    }

    case 'get_expiring_rentals': {
      if (!isAdmin) return { error: 'Expiring rentals list is only available to admin users.' };
      const expiring = await agreementsService.getExpiringAgreements(args.days || 3);
      return expiring.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_end: a.date_end,
        days_left: daysBetween(todayMYT(), (a.date_end || '').slice(0, 10)),
      }));
    }

    case 'get_overdue_rentals': {
      if (!isAdmin) return { error: 'Overdue rentals list is only available to admin users.' };
      const overdue = await agreementsService.getOverdueAgreements();
      return overdue.map(a => ({
        customer_name: a.customer_name,
        mobile: a.mobile,
        plate_number: a.plate_number,
        date_end: a.date_end,
        days_overdue: daysBetween((a.date_end || '').slice(0, 10), todayMYT()),
      }));
    }

    case 'get_fleet_status': {
      const stats = await fleetService.getFleetStats();
      return stats;
    }

    case 'search_cars': {
      const results = await fleetService.searchCars(args.query);
      return results.map(c => {
        const result = {
          car_name: c._carName || c.body_type || '',
          color: colorName(c.color),
          status: c.status,
          daily_price: c.daily_price,
        };
        if (isAdmin) result.plate_number = c.plate_number;
        return result;
      });
    }

    case 'get_payment_info':
      return {
        methods: policies.payment.methods,
        bank: policies.payment.bank,
        instructions: policies.payment.instructions,
      };

    case 'get_policies': {
      const p = args.policy?.toLowerCase();
      const map = {
        deposit: policies.deposit,
        cancellation: policies.cancellation,
        extension: policies.extension,
        fuel: policies.fuel,
        cleanliness: policies.cleanliness,
        insurance: policies.insurance,
        documents: policies.documents,
      };
      return map[p] || { error: `Unknown policy: ${p}`, available: Object.keys(map) };
    }

    case 'get_delivery_by_coordinates': {
      const locationService = require('../utils/location');
      const zone = locationService.matchDeliveryZone(args.latitude, args.longitude);
      const geo = await locationService.reverseGeocode(args.latitude, args.longitude);
      return {
        address: geo.fullAddress || 'Unknown',
        area: geo.area || 'Unknown',
        zone: zone.zone,
        fee: zone.fee,
        distanceKm: zone.distanceKm,
        label: zone.label,
        mapsLink: locationService.mapsLink(args.latitude, args.longitude),
        directionsToJrv: locationService.directionsToJrv(args.latitude, args.longitude),
      };
    }

    case 'get_jrv_location': {
      const locationService = require('../utils/location');
      return {
        name: 'JRV Car Rental',
        branches: [
          '195, Jalan S2 B14, Seremban 2, 70300 Seremban, Negeri Sembilan',
          'Lot 12071, Jalan Sungai Ujong, Taman Ast, 70200 Seremban, Negeri Sembilan',
        ],
        mapsLink: locationService.jrvLocation(),
        website: 'https://jrvservices.co',
      };
    }

    case 'get_reports': {
      if (!isAdmin) return { error: 'Reports are only available to admin users.' };
      const reports = require('../brain/reports');
      const requested = (args.reports || 'all').toLowerCase();
      const reportMap = {
        '1': () => reports.sortedByTime(),
        '2': () => reports.sortedByContact(),
        '3': () => reports.sortedByTimeslot(),
        '4': () => reports.followUpReport(),
        '5': () => reports.availableReport(),
        '6': () => reports.summaryReport(),
        'fleet': () => reports.fleetReport(),
        'earnings': () => reports.earningsReport(),
      };

      let keys;
      if (requested === 'all' || requested === 'daily') {
        keys = ['1', '2', '3', '4', '5', '6'];
      } else {
        keys = requested.split(/[,\s]+/).map(k => k.trim()).filter(Boolean);
      }

      const results = [];
      for (const key of keys) {
        const gen = reportMap[key];
        if (gen) {
          results.push(await gen());
        } else {
          results.push(`Unknown report: ${key}`);
        }
      }
      return results.join('\n\n---\n\n');
    }

    case 'get_system_stats': {
      const aiRouter = require('./router');
      const cfg = require('../config');
      const stats = aiRouter.getStats();
      const os = require('os');
      return {
        cloudProvider: cfg.cloudProvider,
        activeModel: cfg.cloudProvider === 'groq' ? cfg.groq.model : cfg.kimi.model,
        kimi: { model: cfg.kimi.model, available: !!cfg.kimi.apiKey, calls: stats.kimiStats?.calls || 0, tokens: stats.kimiStats?.tokens || 0 },
        groq: { model: cfg.groq.model, available: !!cfg.groq.apiKey, calls: stats.groqStats?.calls || 0, tokens: stats.groqStats?.tokens || 0 },
        ollama: { model: cfg.localAI.model, available: aiRouter.localAvailable },
        totalToolCalls: stats.toolCalls,
        cacheHits: stats.cacheHits,
        uptime: `${Math.round(os.uptime() / 3600)}h`,
        memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        switchCmd: '/switch <kimi|groq> [model]',
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

module.exports = { TOOLS, executeTool };
