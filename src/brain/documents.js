/**
 * JARVIS Document Generator — Creates Formatted Business Documents
 *
 * Generates documents JARVIS can send via WhatsApp:
 *   - Invoices / receipts
 *   - Rental agreements (summary)
 *   - Quotations
 *   - Payment reminders
 *   - Custom letters / notices
 *
 * All output as WhatsApp-formatted text (no PDF generation needed).
 * Templates stored in Supabase for admin customization.
 *
 * Usage:
 *   Boss: "Generate invoice for Ali, Proton X50, 5 days at RM120/day"
 *   JARVIS → calls create_document tool → returns formatted document
 *
 * Storage: Templates in "doc_template:" prefix
 */

const { dataStoreService } = require('../supabase/services');
const { todayMYT, formatMYT } = require('../utils/time');

class DocumentGenerator {
  constructor() {
    this._templates = {};
    this._counter = 0; // Document number counter
    this._loaded = false;
  }

  async load() {
    try {
      // Load custom templates from DB
      const data = await dataStoreService.getByKeyPrefix('doc_template:');
      for (const entry of data || []) {
        const type = entry.key.replace('doc_template:', '');
        this._templates[type] = typeof entry.value === 'string'
          ? JSON.parse(entry.value) : entry.value;
      }

      // Load counter
      const counter = await dataStoreService.getByKey('doc_counter');
      this._counter = (typeof counter === 'number' ? counter : 0);

      this._loaded = true;
      console.log(`[Docs] Loaded ${Object.keys(this._templates).length} templates, counter: ${this._counter}`);
    } catch (err) {
      console.error('[Docs] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Generate a document. Returns WhatsApp-formatted text.
   */
  async generate(type, data) {
    this._counter++;
    const docNum = `JRV-${String(this._counter).padStart(5, '0')}`;

    // Save counter
    try { await dataStoreService.setValue('doc_counter', this._counter); } catch (e) { /* non-critical */ }

    switch (type) {
      case 'invoice': return this._invoice(docNum, data);
      case 'receipt': return this._receipt(docNum, data);
      case 'quotation': return this._quotation(docNum, data);
      case 'agreement': return this._agreement(docNum, data);
      case 'payment_reminder': return this._paymentReminder(data);
      case 'notice': return this._notice(data);
      case 'custom': return this._custom(docNum, data);
      default: return { error: `Unknown document type: ${type}. Available: invoice, receipt, quotation, agreement, payment_reminder, notice, custom` };
    }
  }

  /**
   * Save a custom template.
   */
  async saveTemplate(type, template) {
    this._templates[type] = template;
    await dataStoreService.setValue(`doc_template:${type}`, template);
    console.log(`[Docs] Template saved: ${type}`);
    return { type, saved: true };
  }

  /**
   * List available templates.
   */
  listTemplates() {
    return {
      builtin: ['invoice', 'receipt', 'quotation', 'agreement', 'payment_reminder', 'notice', 'custom'],
      custom: Object.keys(this._templates),
    };
  }

  // ─── Built-in Generators ──────────────────────────────

  _invoice(docNum, d) {
    const today = todayMYT();
    const days = d.days || 1;
    const rate = d.rate || d.dailyRate || 0;
    const subtotal = days * rate;
    const delivery = d.deliveryFee || 0;
    const deposit = d.deposit || 0;
    const total = subtotal + delivery;

    return {
      type: 'invoice',
      docNumber: docNum,
      content: [
        `*🧾 INVOICE — ${docNum}*`,
        `Date: ${today}`,
        '',
        `*Customer:* ${d.customerName || 'N/A'}`,
        `*Phone:* ${d.phone || 'N/A'}`,
        '',
        `*Car:* ${d.carName || d.car || 'N/A'}`,
        `*Period:* ${d.startDate || today} — ${d.endDate || 'TBD'}`,
        `*Duration:* ${days} day${days > 1 ? 's' : ''}`,
        '',
        '```',
        `Rental (${days}d × RM${rate})    RM ${subtotal.toFixed(2)}`,
        delivery > 0 ? `Delivery fee            RM ${delivery.toFixed(2)}` : null,
        `─────────────────────────────`,
        `TOTAL                   RM ${total.toFixed(2)}`,
        deposit > 0 ? `Deposit (refundable)    RM ${deposit.toFixed(2)}` : null,
        '```',
        '',
        '*Payment:*',
        'Maybank: 1122-5988-3838 (JRV GLOBAL SERVICES)',
        'Or scan QR / cash on delivery',
        '',
        `_JRV Car Rental • Seremban_`,
        `_WhatsApp: +60126565477_`,
      ].filter(Boolean).join('\n'),
    };
  }

  _receipt(docNum, d) {
    const today = todayMYT();
    return {
      type: 'receipt',
      docNumber: docNum,
      content: [
        `*✅ PAYMENT RECEIPT — ${docNum}*`,
        `Date: ${today}`,
        '',
        `*Customer:* ${d.customerName || 'N/A'}`,
        `*Amount:* RM ${(d.amount || 0).toFixed(2)}`,
        `*Method:* ${d.paymentMethod || 'Bank Transfer'}`,
        `*For:* ${d.description || 'Car rental'}`,
        d.reference ? `*Ref:* ${d.reference}` : null,
        '',
        `Thank you for your payment!`,
        '',
        `_JRV Car Rental • Seremban_`,
      ].filter(Boolean).join('\n'),
    };
  }

  _quotation(docNum, d) {
    const today = todayMYT();
    const items = d.items || [{ desc: `${d.carName || 'Car'} rental`, days: d.days || 1, rate: d.rate || 0 }];

    let total = 0;
    const lines = items.map(item => {
      const lineTotal = (item.days || 1) * (item.rate || 0);
      total += lineTotal;
      return `${item.desc} (${item.days}d × RM${item.rate})  RM ${lineTotal.toFixed(2)}`;
    });

    if (d.deliveryFee) {
      total += d.deliveryFee;
      lines.push(`Delivery fee                 RM ${d.deliveryFee.toFixed(2)}`);
    }

    return {
      type: 'quotation',
      docNumber: docNum,
      content: [
        `*📋 QUOTATION — ${docNum}*`,
        `Date: ${today}`,
        `Valid for: ${d.validDays || 7} days`,
        '',
        `*Customer:* ${d.customerName || 'N/A'}`,
        '',
        '```',
        ...lines,
        `─────────────────────────────`,
        `TOTAL              RM ${total.toFixed(2)}`,
        '```',
        '',
        d.notes ? `*Notes:* ${d.notes}` : null,
        '',
        `_Prices subject to availability._`,
        `_JRV Car Rental • +60126565477_`,
      ].filter(Boolean).join('\n'),
    };
  }

  _agreement(docNum, d) {
    const today = todayMYT();
    return {
      type: 'agreement',
      docNumber: docNum,
      content: [
        `*📄 RENTAL AGREEMENT SUMMARY — ${docNum}*`,
        `Date: ${today}`,
        '',
        `*Renter:* ${d.customerName || 'N/A'}`,
        `*IC/Passport:* ${d.icNumber || 'On file'}`,
        `*Phone:* ${d.phone || 'N/A'}`,
        '',
        `*Vehicle:* ${d.carName || 'N/A'}`,
        `*Plate:* ${d.plate || 'N/A'}`,
        `*Period:* ${d.startDate || today} — ${d.endDate || 'TBD'}`,
        `*Rate:* RM${d.rate || 0}/day`,
        `*Total:* RM ${(d.total || 0).toFixed(2)}`,
        `*Deposit:* RM ${(d.deposit || 0).toFixed(2)}`,
        '',
        '*Terms:*',
        '• Fuel: Return at same level as received',
        '• Mileage: Unlimited within Peninsular Malaysia',
        '• Insurance: Basic coverage included',
        '• Late return: RM50 per additional day',
        '• Cancellation: Free 24hrs before, 50% after',
        '',
        `_Full terms at office. Contact: +60126565477_`,
      ].join('\n'),
    };
  }

  _paymentReminder(d) {
    return {
      type: 'payment_reminder',
      content: [
        `Assalamualaikum ${d.customerName || ''} 🙏`,
        '',
        `This is a gentle reminder regarding your car rental payment.`,
        '',
        d.amount ? `*Outstanding:* RM ${d.amount.toFixed(2)}` : null,
        d.dueDate ? `*Due:* ${d.dueDate}` : null,
        d.carName ? `*Car:* ${d.carName}` : null,
        '',
        '*Payment methods:*',
        'Maybank: 1122-5988-3838',
        '(JRV GLOBAL SERVICES)',
        '',
        'Please send payment proof after transfer. Thank you!',
        '',
        `_JRV Car Rental • +60126565477_`,
      ].filter(Boolean).join('\n'),
    };
  }

  _notice(d) {
    return {
      type: 'notice',
      content: [
        `*📢 ${(d.title || 'Notice').toUpperCase()}*`,
        '',
        d.body || d.content || '',
        '',
        d.action ? `*Action required:* ${d.action}` : null,
        d.deadline ? `*Deadline:* ${d.deadline}` : null,
        '',
        `_JRV Car Rental • Seremban_`,
      ].filter(Boolean).join('\n'),
    };
  }

  _custom(docNum, d) {
    // Check for custom template
    if (d.template && this._templates[d.template]) {
      let content = this._templates[d.template].body || '';
      // Simple variable substitution
      for (const [key, val] of Object.entries(d)) {
        content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
      }
      content = content.replace(/\{\{docNumber\}\}/g, docNum);
      content = content.replace(/\{\{date\}\}/g, todayMYT());
      return { type: 'custom', docNumber: docNum, content };
    }

    // Freeform document
    return {
      type: 'custom',
      docNumber: docNum,
      content: [
        d.title ? `*${d.title}* — ${docNum}` : `*Document ${docNum}*`,
        `Date: ${todayMYT()}`,
        '',
        d.body || d.content || '(No content provided)',
        '',
        `_JRV Car Rental • Seremban_`,
      ].join('\n'),
    };
  }

  getStats() {
    return {
      documentsGenerated: this._counter,
      customTemplates: Object.keys(this._templates).length,
    };
  }
}

module.exports = new DocumentGenerator();
