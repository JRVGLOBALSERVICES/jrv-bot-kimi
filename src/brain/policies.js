/**
 * Business Policies - All pricing, delivery, payment, and document policies.
 * Source: bot_data_store (all_pricing_updated_v2, delivery zones, operational rules)
 *
 * This module loads from bot_data_store cache at startup.
 * Hardcoded fallbacks from actual bot_data_store data for when DB is unavailable.
 */

// ─── Pricing (from all_pricing_updated_v2) ─────────────────────

const PRICING = {
  economy: {
    models: ['Perodua Axia', 'Perodua Bezza', 'Proton Saga'],
    daily: 80,
    threeDays: 210,
    weekly: 450,
    monthly: 1400,
    deposit: 0,
  },
  compact: {
    models: ['Perodua Myvi', 'Proton Iriz', 'Honda City'],
    daily: 100,
    threeDays: 270,
    weekly: 580,
    monthly: 1700,
    deposit: 0,
  },
  suv: {
    models: ['Perodua Ativa', 'Proton X50', 'Proton X70'],
    daily: 150,
    threeDays: 400,
    weekly: 850,
    monthly: 2500,
    deposit: 0,
  },
  premium: {
    models: ['Honda HRV', 'Toyota Vios', 'Honda Civic'],
    daily: 180,
    threeDays: 480,
    weekly: 1000,
    monthly: 3000,
    deposit: 0,
  },
  mpv: {
    models: ['Perodua Alza', 'Toyota Avanza', 'Toyota Innova'],
    daily: 160,
    threeDays: 430,
    weekly: 900,
    monthly: 2700,
    deposit: 0,
  },
};

// ─── Delivery Zones (from bot_data_store) ────────────────────

const DELIVERY_ZONES = {
  free: {
    areas: ['Seremban', 'Senawang', 'Sendayan'],
    fee: 0,
    label: 'FREE delivery',
  },
  zone1: {
    areas: ['Port Dickson', 'PD', 'Nilai'],
    fee: 50,
    label: 'RM50 delivery',
  },
  zone2: {
    areas: ['KLIA', 'KLIA2', 'klia'],
    fee: 70,
    label: 'RM70 delivery',
  },
  zone3: {
    areas: ['KL', 'Kuala Lumpur', 'Melaka', 'Malacca'],
    fee: 150,
    label: 'RM150 delivery',
  },
};

// ─── Payment Methods (from bot_data_store) ───────────────────

const PAYMENT = {
  methods: ['Cash', 'Bank Transfer (Maybank)', 'QR Code'],
  bank: {
    name: 'Maybank',
    account: '555135160390',
    holder: 'JRV GLOBAL SERVICES',
  },
  qrCodeImage: null, // Loaded from bot_data_store at runtime
  instructions: 'Please transfer to Maybank 555135160390 (JRV GLOBAL SERVICES) and send proof of payment.',
};

// ─── Deposit Policy ──────────────────────────────────────────

const DEPOSIT = {
  required: ['student', 'foreigner', 'p_license'],
  amount: 150,
  regular: 0, // No deposit for regular customers
  note: 'Deposit RM150 required for students, foreigners, and P license holders. Refundable upon return.',
};

// ─── Document Requirements ───────────────────────────────────

const DOCUMENTS = {
  local: ['IC (MyKad)', 'Driving License', 'Utility Bill (as proof of address)'],
  foreigner: ['Passport', 'International Driving Permit (IDP)', 'Valid Visa'],
  note_local: 'Malaysian customers: Please provide IC, driving license, and a utility bill.',
  note_foreigner: 'Foreign customers: Please provide passport, IDP, and valid visa.',
};

// ─── Cancellation Policy ─────────────────────────────────────

const CANCELLATION = {
  freeCancellation: '24 hours before pickup',
  lateCancellation: 'RM50 fee if cancelled within 24 hours',
  noShow: 'Full day charge if no show',
  note: 'No refund on cancellations.',
};

// ─── Extension Policy ────────────────────────────────────────

const EXTENSION = {
  sameRate: true,
  mustNotifyBefore: '24 hours before current end date',
  lateReturn: 'RM50 per hour for first 3 hours, then full day rate',
  note: 'Extensions at same rate. Must notify 24h before. Late returns: RM50/hr (first 3hrs), then full day.',
};

// ─── Fuel Policy ─────────────────────────────────────────────

const FUEL = {
  policy: 'same-to-same',
  note: 'Return with same fuel level as pickup. Short on fuel = RM10 per bar charged.',
  perBarCharge: 10,
};

// ─── Cleanliness Policy ──────────────────────────────────────

const CLEANLINESS = {
  fee: 50,
  note: 'Car must be returned clean. Excessive dirt = RM50 cleaning fee.',
};

// ─── Insurance Policy ────────────────────────────────────────

const INSURANCE = {
  included: true,
  excess: 'RM3,000 for sedans, RM5,000 for SUV/MPV',
  note: 'Basic insurance included. Excess applies for accidents. Report immediately.',
};

// ─── Admin Info (from bot_data_store) ────────────────────────

const ADMINS = {
  list: [
    {
      name: 'Rj', phone: '60138606455', role: 'Papa/Creator', isBoss: true,
      title: 'Sir',
      relationship: 'Creator & Boss — built JARVIS from scratch. The Tony Stark of JRV.',
      style: 'Direct, no BS. Wants data fast. Tech-savvy. English mainly.',
    },
    {
      name: 'Vir', phone: '60138845477', role: 'Uncle/Superadmin', isSuperadmin: true,
      title: 'Vir Uncle',
      relationship: 'Operations lead — handles fleet management and customer handovers.',
      style: 'Malay/English mix. Practical, operations-focused.',
    },
    {
      name: 'Amisha', phone: '60162783080', role: 'Sister',
      title: 'Amisha',
      relationship: 'Customer coordination and booking management.',
      style: 'Friendly, efficient. Bilingual English/Malay.',
    },
    {
      name: 'Suriyati', phone: '60146635913', role: 'Mum',
      title: 'Mum',
      relationship: 'Matriarch. Manages finances and business oversight.',
      style: 'Prefers Malay. Clear, simple updates. No tech jargon.',
    },
    {
      name: 'Kakku', phone: '601170193138', role: 'TATA',
      title: 'Kakku',
      relationship: 'Family elder. Business oversight.',
      style: 'Simple, clear communication.',
    },
  ],
  superadmin: { name: 'Vir', phone: '60138845477' },
  businessNumber: '60126565477',
};

// ─── Operational Rules (34 rules from jarvis_operational_rules_complete) ──

const OPERATIONAL_RULES = [
  'JARVIS must query bot_data_store first before answering any operational question',
  'All prices MUST come from bot_data_store, never make up prices',
  'Car plates are HIDDEN from customers — show model names only',
  'Car plates are VISIBLE to admins only',
  'Format: *bold headers* + ``` data blocks ```',
  'Be concise. No corporate BS — get straight to data',
  'Match customer language (Malay/English/Chinese/Tamil)',
  'Customer with >5 bookings = regular customer, give priority treatment',
  'Always greet returning customers by name',
  'New customers: welcome warmly, collect name and requirements',
  'Voice notes: ONLY to admins, customers get text-only replies',
  'Escalate HIGH/CRITICAL intents to superadmin Vir immediately',
  'ALL customer interactions must be forwarded to superadmin Vir',
  'When customer asks for available cars, show only cars with NO active agreements',
  'Cross-validate car status with agreements before showing availability',
  'Expiring rentals: contact customer 2 days before end date',
  'Overdue returns: alert admins immediately, contact customer',
  'Payment proof received: forward to superadmin for verification',
  'Never share admin phone numbers with customers',
  'Never share other customer details with anyone',
  'Always show delivery fees when customer asks about delivery',
  'Student/foreigner/P license: always mention RM150 deposit requirement',
  'Insurance excess info: share only when asked or during accident',
  'Late return penalty: inform customer clearly before rental starts',
  'Fuel policy: always mention same-to-same fuel level rule',
  'Cleaning fee: mention only if asked or at return time',
  'Cancellation: mention free 24h cancellation when booking',
  'Extension: customer must notify 24h before end date',
  'Documents: remind customer what to bring before pickup',
  'Reports: use exact formats from bot_data_store report templates',
  'Dates: always display in Malaysia Time (MYT = UTC+8)',
  'Amounts: always prefix with RM (e.g., RM80/day)',
  'Phone format: +60XXXXXXXXX',
  'JARVIS business number: +60126565477',
];

class Policies {
  constructor() {
    this.pricing = PRICING;
    this.deliveryZones = DELIVERY_ZONES;
    this.payment = PAYMENT;
    this.deposit = DEPOSIT;
    this.documents = DOCUMENTS;
    this.cancellation = CANCELLATION;
    this.extension = EXTENSION;
    this.fuel = FUEL;
    this.cleanliness = CLEANLINESS;
    this.insurance = INSURANCE;
    this.admins = ADMINS;
    this.rules = OPERATIONAL_RULES;
  }

  /**
   * Update policies from bot_data_store data (called during sync).
   */
  updateFromStore(storeData) {
    if (!storeData || !Array.isArray(storeData)) return;

    for (const entry of storeData) {
      if (!entry.key || !entry.value) continue;

      // Update pricing if found
      if (entry.key === 'all_pricing_updated_v2' || entry.key === 'pricing') {
        try {
          const pricingData = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
          if (pricingData) Object.assign(this.pricing, pricingData);
        } catch (e) { /* keep defaults */ }
      }

      // Update delivery zones
      if (entry.key === 'delivery_zones' || (entry.key && entry.key.startsWith('delivery_zone'))) {
        try {
          const zoneData = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
          if (zoneData) Object.assign(this.deliveryZones, zoneData);
        } catch (e) { /* keep defaults */ }
      }
    }
  }

  /**
   * Get delivery fee for a location.
   */
  getDeliveryFee(location) {
    if (!location) return null;
    const loc = location.toLowerCase();

    for (const zone of Object.values(this.deliveryZones)) {
      if (zone.areas.some(a => loc.includes(a.toLowerCase()))) {
        return { fee: zone.fee, label: zone.label, areas: zone.areas };
      }
    }
    return null; // Unknown location
  }

  /**
   * Get pricing for a car category.
   */
  getCategoryPricing(category) {
    const cat = category?.toLowerCase();
    return this.pricing[cat] || null;
  }

  /**
   * Check if deposit is required.
   */
  isDepositRequired(customerType) {
    return this.deposit.required.includes(customerType?.toLowerCase());
  }

  /**
   * Check if phone is admin.
   */
  isAdmin(phone) {
    const clean = phone.replace(/\D/g, '');
    return this.admins.list.some(a => clean.includes(a.phone) || a.phone.includes(clean));
  }

  /**
   * Get admin by phone.
   */
  getAdmin(phone) {
    const clean = phone.replace(/\D/g, '');
    return this.admins.list.find(a => clean.includes(a.phone) || a.phone.includes(clean));
  }

  /**
   * Format pricing as WhatsApp text for customers (no plates).
   */
  formatPricingForCustomer() {
    let text = '*JRV Car Rental Rates*\n\n';
    for (const [cat, data] of Object.entries(this.pricing)) {
      text += `*${cat.charAt(0).toUpperCase() + cat.slice(1)}*\n`;
      text += `\`\`\`\n`;
      text += `Models: ${data.models.join(', ')}\n`;
      text += `Daily:   RM${data.daily}\n`;
      text += `3-Day:   RM${data.threeDays}\n`;
      text += `Weekly:  RM${data.weekly}\n`;
      text += `Monthly: RM${data.monthly}\n`;
      text += `\`\`\`\n\n`;
    }
    text += `*Delivery:*\n\`\`\`\n`;
    for (const zone of Object.values(this.deliveryZones)) {
      text += `${zone.areas.join('/')}: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}\n`;
    }
    text += `\`\`\``;
    return text;
  }

  /**
   * Format payment info as WhatsApp text.
   */
  formatPaymentInfo() {
    return `*Payment Methods*\n` +
      `\`\`\`\n` +
      `1. Cash (upon pickup)\n` +
      `2. Bank Transfer:\n` +
      `   ${this.payment.bank.name}\n` +
      `   Acc: ${this.payment.bank.account}\n` +
      `   Name: ${this.payment.bank.holder}\n` +
      `3. QR Code (ask for QR)\n` +
      `\`\`\`\n` +
      `\nPlease send proof of payment after transfer.`;
  }

  /**
   * Format document requirements.
   */
  formatDocumentRequirements(isForeigner = false) {
    const docs = isForeigner ? this.documents.foreigner : this.documents.local;
    const note = isForeigner ? this.documents.note_foreigner : this.documents.note_local;
    return `*Required Documents*\n` +
      `\`\`\`\n${docs.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\`\`\`\n` +
      `\n${note}`;
  }

  /**
   * Build AI system prompt section for policies.
   * @param {boolean} isAdmin - If false, admin phones and sensitive data are stripped.
   */
  buildPolicyContext(isAdmin = false) {
    // Keep compact — only essential data. Do NOT include operational rules
    // (those are already in the router system prompt).
    const lines = [
      'PRICING:',
      ...Object.entries(this.pricing).map(([cat, p]) =>
        `${cat}: RM${p.daily}/day, RM${p.weekly}/week, RM${p.monthly}/month`
      ),
      '',
      'DELIVERY: ' + Object.values(this.deliveryZones).map(z =>
        `${z.areas.join('/')}: ${z.fee === 0 ? 'FREE' : 'RM' + z.fee}`
      ).join(' | '),
      '',
      `PAYMENT: ${this.payment.methods.join(', ')} | Bank: ${this.payment.bank.name} ${this.payment.bank.account}`,
      `DEPOSIT: ${this.deposit.note}`,
      `CANCELLATION: ${this.cancellation.note}`,
      `EXTENSION: ${this.extension.note}`,
      `FUEL: ${this.fuel.note}`,
      `WhatsApp: +${this.admins.businessNumber}`,
    ];

    if (isAdmin) {
      lines.push(`ADMINS: ${this.admins.list.map(a => `${a.name}(${a.phone})`).join(', ')}`);
    }

    return lines.join('\n');
  }
}

module.exports = new Policies();
