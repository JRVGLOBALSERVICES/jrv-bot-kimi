/**
 * Intent Reader - Runs on EVERY message before JARVIS responds.
 *
 * From bot_data_store intent_reader config:
 * - Classify every inbound message
 * - Determine priority (LOW/MEDIUM/HIGH/CRITICAL)
 * - Escalate HIGH/CRITICAL to superadmin Vir (+60138845477)
 * - Route to appropriate handler
 *
 * Categories:
 *   BOOKING_INQUIRY  - Wants to rent a car
 *   PRICING_INQUIRY  - Asking about rates
 *   RETURN_INQUIRY   - About returning car
 *   EXTENSION_INQUIRY - Wants to extend rental
 *   PAYMENT          - Payment related (sending proof, asking how to pay)
 *   COMPLAINT        - Issue or complaint
 *   GREETING         - Hi/hello/general chat
 *   ADMIN_COMMAND    - Admin slash commands
 *   REPORT_REQUEST   - Asking for reports
 *   DOCUMENT_SUBMIT  - Sending IC/license/documents
 *   MEDIA            - Sending image/voice/video
 *   EMERGENCY        - Accident, breakdown, urgent
 *   CANCELLATION     - Wants to cancel booking
 *   DELIVERY         - Delivery/pickup location questions
 *   GENERAL          - Everything else
 */

const INTENTS = {
  BOOKING_INQUIRY: 'booking_inquiry',
  PRICING_INQUIRY: 'pricing_inquiry',
  RETURN_INQUIRY: 'return_inquiry',
  EXTENSION_INQUIRY: 'extension_inquiry',
  PAYMENT: 'payment',
  COMPLAINT: 'complaint',
  GREETING: 'greeting',
  ADMIN_COMMAND: 'admin_command',
  REPORT_REQUEST: 'report_request',
  DOCUMENT_SUBMIT: 'document_submit',
  MEDIA: 'media',
  EMERGENCY: 'emergency',
  CANCELLATION: 'cancellation',
  DELIVERY: 'delivery',
  GENERAL: 'general',
};

const PRIORITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

// Intent detection patterns (multi-language: EN, MS, ZH, TA)
const INTENT_PATTERNS = {
  [INTENTS.EMERGENCY]: {
    patterns: [
      /accident|kemalangan|事故|விபத்து/i,
      /breakdown|rosak|terkandas|抛锚/i,
      /emergency|kecemasan|urgent|segera|紧急/i,
      /police|polis|hospital/i,
      /stolen|dicuri|被偷/i,
    ],
    priority: PRIORITY.CRITICAL,
  },
  [INTENTS.COMPLAINT]: {
    patterns: [
      /complain|aduan|keluhan|投诉|புகார்/i,
      /not happy|tak puas|不满意/i,
      /problem with|masalah dengan/i,
      /terrible|teruk|horrible/i,
      /refund|pulang balik duit|退款/i,
      /cheat|tipu|scam/i,
    ],
    priority: PRIORITY.HIGH,
  },
  [INTENTS.CANCELLATION]: {
    patterns: [
      /cancel|batal|pembatalan|取消/i,
      /don'?t want|tak nak|tak jadi/i,
      /cancel\s*(my|the)?\s*(booking|rental|reservation)/i,
      /nak batal/i,
    ],
    priority: PRIORITY.HIGH,
  },
  [INTENTS.PAYMENT]: {
    patterns: [
      /pay|bayar|payment|pembayaran|付款|支付/i,
      /transfer|bank\s*in|已转账/i,
      /receipt|resit|收据/i,
      /qr\s*code/i,
      /maybank|bank/i,
      /proof\s*of\s*payment|bukti\s*bayar/i,
      /dah bayar|sudah bayar|已付款/i,
    ],
    priority: PRIORITY.MEDIUM,
  },
  [INTENTS.EXTENSION_INQUIRY]: {
    patterns: [
      /extend|sambung|lanjut|延长|延期/i,
      /tambah hari|extra day/i,
      /nak sambung|want to extend/i,
      /perpanjang/i,
    ],
    priority: PRIORITY.MEDIUM,
  },
  [INTENTS.RETURN_INQUIRY]: {
    patterns: [
      /return|pulang|hantar balik|归还|返还/i,
      /drop\s*off|nak hantar/i,
      /where to return|kat mana nak pulang/i,
      /return.*car|pulang.*kereta/i,
    ],
    priority: PRIORITY.MEDIUM,
  },
  [INTENTS.BOOKING_INQUIRY]: {
    patterns: [
      /book|tempah|nak sewa|rent|rental|want.*car|租车|租用/i,
      /available|ada kereta|ada tak|有没有车/i,
      /sewa\s*kereta/i,
      /nak kereta|need.*car/i,
      /reservation|booking/i,
    ],
    priority: PRIORITY.MEDIUM,
  },
  [INTENTS.PRICING_INQUIRY]: {
    patterns: [
      /price|harga|berapa|how much|rate|kadar|多少钱|价格/i,
      /cost|kos|budget/i,
      /cheap|murah|affordable|便宜/i,
      /discount|diskaun|promo|折扣/i,
      /per\s*day|sehari|daily/i,
      /weekly|mingguan|monthly|bulanan/i,
    ],
    priority: PRIORITY.LOW,
  },
  [INTENTS.DELIVERY]: {
    patterns: [
      /deliver|hantar|penghantaran|配送|送车/i,
      /pickup|ambil|pengambilan|取车/i,
      /location|lokasi|tempat|kat mana|地点/i,
      /klia|seremban|sendayan|nilai|melaka|kl|kuala lumpur/i,
    ],
    priority: PRIORITY.LOW,
  },
  [INTENTS.DOCUMENT_SUBMIT]: {
    patterns: [
      /ic|identity card|kad pengenalan|身份证/i,
      /license|lesen|driving|驾照/i,
      /passport|pasport|护照/i,
      /utility bill|bil/i,
      /document|dokumen|文件/i,
    ],
    priority: PRIORITY.LOW,
  },
  [INTENTS.ADMIN_COMMAND]: {
    patterns: [
      /^\//,
    ],
    priority: PRIORITY.LOW,
  },
  [INTENTS.REPORT_REQUEST]: {
    patterns: [
      /report|laporan|报告/i,
      /summary|ringkasan|总结/i,
      /fleet\s*report|fleet\s*status/i,
      /earnings|pendapatan|收入/i,
    ],
    priority: PRIORITY.LOW,
  },
  [INTENTS.GREETING]: {
    patterns: [
      /^(hi|hello|hey|assalamualaikum|salam|hai|helo|yo|你好|வணக்கம்)\s*[!.]?\s*$/i,
      /^(good\s*(morning|afternoon|evening)|selamat\s*(pagi|tengahari|petang|malam))\s*[!.]?\s*$/i,
      /^(thanks|thank you|terima kasih|tq|谢谢|நன்றி)\s*[!.]?\s*$/i,
    ],
    priority: PRIORITY.LOW,
  },
};

class IntentReader {
  /**
   * Classify a message and return intent + priority.
   * This MUST run on EVERY inbound message.
   *
   * @param {string} text - Message text
   * @param {string} type - Message type (chat, ptt, image, document, etc.)
   * @param {boolean} isAdmin - Whether sender is admin
   * @returns {{ intent: string, priority: string, confidence: number, triggers: string[] }}
   */
  classify(text, type = 'chat', isAdmin = false) {
    // Media messages
    if (type === 'ptt') {
      return { intent: INTENTS.MEDIA, priority: PRIORITY.LOW, confidence: 1.0, triggers: ['voice_note'] };
    }
    if (type === 'image' || type === 'sticker') {
      return { intent: INTENTS.MEDIA, priority: PRIORITY.LOW, confidence: 1.0, triggers: ['image'] };
    }
    if (type === 'document') {
      return { intent: INTENTS.DOCUMENT_SUBMIT, priority: PRIORITY.MEDIUM, confidence: 0.8, triggers: ['document'] };
    }

    if (!text) {
      return { intent: INTENTS.GENERAL, priority: PRIORITY.LOW, confidence: 0, triggers: [] };
    }

    // Admin commands
    if (text.startsWith('/') && isAdmin) {
      return { intent: INTENTS.ADMIN_COMMAND, priority: PRIORITY.LOW, confidence: 1.0, triggers: [text.split(' ')[0]] };
    }

    // Check each intent pattern
    let bestIntent = INTENTS.GENERAL;
    let bestPriority = PRIORITY.LOW;
    let bestConfidence = 0;
    const triggers = [];

    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
      if (intent === INTENTS.ADMIN_COMMAND) continue; // Already handled

      let matchCount = 0;
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          matchCount++;
          triggers.push(pattern.source.slice(0, 30));
        }
      }

      if (matchCount > 0) {
        const confidence = Math.min(matchCount / config.patterns.length + 0.3, 1.0);
        // Priority-weighted: higher priority intents win ties
        const priorityWeight = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
        const currentWeight = priorityWeight[config.priority] * confidence;
        const bestWeight = priorityWeight[bestPriority] * bestConfidence;

        if (currentWeight > bestWeight) {
          bestIntent = intent;
          bestPriority = config.priority;
          bestConfidence = confidence;
        }
      }
    }

    return {
      intent: bestIntent,
      priority: bestPriority,
      confidence: bestConfidence,
      triggers: triggers.slice(0, 5),
    };
  }

  /**
   * Check if this message should be escalated to superadmin Vir.
   */
  shouldEscalate(classification) {
    return classification.priority === PRIORITY.HIGH || classification.priority === PRIORITY.CRITICAL;
  }

  /**
   * Format escalation message for superadmin.
   */
  formatEscalation(phone, name, text, classification) {
    const icon = classification.priority === PRIORITY.CRITICAL ? '🚨' : '⚠️';
    return `${icon} *${classification.priority} ALERT*\n` +
      `\`\`\`\n` +
      `From: ${name} (${phone})\n` +
      `Intent: ${classification.intent}\n` +
      `Message: ${text?.slice(0, 200) || '[media]'}\n` +
      `\`\`\``;
  }

  /**
   * Format customer update notification for superadmin.
   * Sent on ALL customer interactions (not just escalations).
   */
  formatCustomerUpdate(phone, name, text, classification, isExisting) {
    const customerType = isExisting ? 'Returning' : 'New';
    return `*Customer Update*\n` +
      `\`\`\`\n` +
      `${customerType}: ${name} (${phone})\n` +
      `Intent: ${classification.intent} [${classification.priority}]\n` +
      `Msg: ${text?.slice(0, 150) || '[media]'}\n` +
      `\`\`\``;
  }
}

module.exports = new IntentReader();
module.exports.INTENTS = INTENTS;
module.exports.PRIORITY = PRIORITY;
