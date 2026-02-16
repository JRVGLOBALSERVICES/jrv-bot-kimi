const aiRouter = require('../ai/router');
const voiceEngine = require('../voice');
const { imageReader, cloudinary } = require('../media');
const conversation = require('./conversation');
const reports = require('./reports');
const intentReader = require('./intent-reader');
const { INTENTS, PRIORITY } = require('./intent-reader');
const policies = require('./policies');
const notifications = require('./notifications');
const customerFlows = require('./customer-flows');
const bookingFlow = require('./booking-flow');
const reminders = require('./reminders');
const adminTools = require('./admin-tools');
const jarvisVoice = require('../voice/jarvis-voice');
const locationService = require('../utils/location');
const customerProfiles = require('./customer-profiles');
const workflows = require('./workflows');
const { agreementsService, fleetService, syncEngine } = require('../supabase/services');
const { validateFleetStatus, colorName } = require('../utils/validators');

/**
 * JARVIS Brain - The central orchestrator.
 *
 * Operational rules (from bot_data_store jarvis_operational_rules_complete):
 * 1. Intent reader runs on EVERY message
 * 2. HIGH/CRITICAL -> escalate to superadmin Vir
 * 3. ALL customer interactions -> forward to Vir
 * 4. Car plates HIDDEN from customers, shown to admins only
 * 5. Voice notes ONLY to admins, customers get text-only
 * 6. Match customer language (Malay/English/Chinese/Tamil)
 * 7. >5 bookings = regular customer, priority treatment
 * 8. Query bot_data_store before answering operational questions
 * 9. Format: *bold headers* + ``` data blocks ```
 * 10. No corporate BS -- get straight to data
 *
 * New features:
 * - Booking creation workflow (guided step-by-step)
 * - Reminder system (natural language scheduling)
 * - Admin power tools (boss-only: /tool commands)
 * - Voice calling (JARVIS voice messages)
 * - Response caching for common queries
 */
class JarvisBrain {
  constructor() {
    this.conversation = conversation;
    this.name = 'JARVIS';
  }

  async process(msg) {
    const { phone, body, type, media, name } = msg;

    // --- 0. Check if bot is paused by dashboard ---
    const isAdmin = syncEngine.isAdmin(phone) || policies.isAdmin(phone);
    const isBoss = adminTools.isBoss(phone) || msg.isBoss || false;

    if (syncEngine.isPaused() && !isAdmin) {
      return { text: 'Maaf, kami sedang tidak aktif buat seketika. Sila hubungi +60126565477 secara terus. / Sorry, we are temporarily offline. Please contact +60126565477 directly.' };
    }

    // --- 1. Identify user ---
    const existingCustomer = syncEngine.lookupCustomer(phone);
    const customerHistory = existingCustomer
      ? await agreementsService.getCustomerHistory(phone).catch(err => { console.warn('[JARVIS] Customer history lookup failed:', err.message); return null; })
      : null;

    // Track conversation
    this.conversation.addMessage(phone, 'user', body || `[${type}]`, { name });

    // Passive profile learning — records every interaction
    const lang = this.conversation.getContext(phone)?.language || null;
    customerProfiles.recordInteraction(phone, {
      name: name || (existingCustomer ? existingCustomer.customer_name : null),
      language: lang,
      messageLength: (body || '').length,
      isVoice: type === 'voice' || type === 'ptt',
    });

    if (existingCustomer) {
      this.conversation.setContext(phone, 'isExistingCustomer', true);
      this.conversation.setContext(phone, 'customerName', existingCustomer.customer_name);
      if (customerHistory) {
        this.conversation.setContext(phone, 'totalRentals', customerHistory.totalRentals);
        this.conversation.setContext(phone, 'activeRentals', customerHistory.activeRentals.length);
        this.conversation.setContext(phone, 'isRegular', customerHistory.totalRentals >= 5);
      }
    }

    // --- 2. Intent classification (EVERY message) ---
    const classification = intentReader.classify(body, type, isAdmin);
    this.conversation.setIntent(phone, classification.intent);

    console.log(`[JARVIS] ${isAdmin ? (isBoss ? 'BOSS' : 'ADMIN') : 'CUSTOMER'} ${name}(${phone}) -> ${classification.intent} [${classification.priority}]`);

    // --- 3. Escalation check ---
    if (!isAdmin && intentReader.shouldEscalate(classification)) {
      notifications.onEscalation(phone, name, body, classification).catch(err =>
        console.error('[JARVIS] Escalation failed:', err.message)
      );
    }

    // --- 4. Process message ---
    const response = { text: null, voice: null, image: null, actions: [], intent: classification.intent };

    try {
      // Check if in active booking flow
      if (body && bookingFlow.isActive(phone)) {
        const flowResult = bookingFlow.process(phone, body, name);
        if (flowResult) {
          response.text = flowResult;
          this.conversation.addMessage(phone, 'assistant', response.text);
          if (!isAdmin) {
            notifications.onJarvisResponse(phone, name, body, response.text, classification).catch(err => console.warn('[JARVIS] Booking flow notification failed:', err.message));
          }
          return response;
        }
      }

      if (type === 'ptt' && media) {
        await this._handleVoice(msg, response, isAdmin, existingCustomer);
      } else if ((type === 'location' || type === 'live_location') && msg.location) {
        await this._handleLocation(msg, response, isAdmin, classification);
      } else if ((type === 'image' || type === 'sticker') && media) {
        await this._handleImage(msg, response, isAdmin, classification);
      } else if ((type === 'document' || type === 'video') && media) {
        await this._handleDocument(msg, response, isAdmin, classification);
      } else {
        await this._handleText(msg, response, isAdmin, isBoss, existingCustomer, customerHistory, classification);
      }

      if (response.text) {
        this.conversation.addMessage(phone, 'assistant', response.text);
      }

      // --- 5. Forward ALL customer interactions to Vir ---
      if (!isAdmin && response.text) {
        notifications.onJarvisResponse(phone, name, body, response.text, classification).catch(err =>
          console.error('[JARVIS] Notification failed:', err.message)
        );
      }

    } catch (err) {
      console.error(`[JARVIS] Error processing from ${phone}:`, err?.message || err);
      response.text = isAdmin
        ? `*Error:*\n\`\`\`${(err?.message || 'Unknown error').slice(0, 500)}\`\`\`\n\nBot is still running. Try a /command or rephrase your question.`
        : 'Maaf, ada masalah teknikal. Sila hubungi +60126565477.\n\nSorry, technical issue. Please contact +60126565477.';
    }

    // --- 6. Log message to Supabase for dashboard ---
    this._logMessage(phone, name, body || `[${type}]`, response.text, classification, isAdmin).catch(err => console.warn('[JARVIS] Message log to Supabase failed:', err.message));

    return response;
  }

  // --- Text Handler ---

  async _handleText(msg, response, isAdmin, isBoss, existingCustomer, customerHistory, classification) {
    const { phone, body, name } = msg;
    const history = this.conversation.getHistory(phone);
    const conv = this.conversation.getOrCreate(phone);
    const lang = conv.language || 'en';

    // --- Admin commands ---
    const command = this._parseCommand(body, isAdmin, isBoss);
    if (command) return this._handleCommand(command, msg, response, isAdmin, isBoss);

    // --- Reminder detection ---
    if (/remind\s*(me|us)?\s/i.test(body)) {
      const result = reminders.createFromText(body, phone, name);
      if (result.error) {
        response.text = `*Reminder*\n\`\`\`${result.error}\`\`\``;
      } else {
        const dueStr = result.dueAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
        response.text = `*Reminder Set*\n\`\`\`\n#${result.id}: ${result.text}\nDue: ${dueStr}\n${result.repeat ? `Repeats: ${result.repeat}` : 'One-time'}\n\`\`\``;
      }
      return;
    }

    // --- Voice note request (admin only, needs special handling) ---
    if (isAdmin && /send\s*(me\s*)?(a\s*)?voice|voice\s*note|voice\s*msg|speak\s*to\s*me|can\s*you\s*speak|talk\s*to\s*me/i.test(body) && !/transcri/i.test(body)) {
      const ttsOk = await voiceEngine.getStatus().then(s => s.tts).catch(err => { console.warn('[JARVIS] TTS status check failed:', err.message); return false; });
      if (!ttsOk) {
        response.text = '*Voice not available.*\n```\nTTS engine not installed.\nInstall with: pip install edge-tts\nThen restart the bot.\n```';
        return;
      }
      try {
        const voiceText = jarvisVoice.formatForVoice('At your service. All systems operational. What would you like me to report on?');
        const voiceResult = await voiceEngine.speak(voiceText, { language: conv.language || 'en' });
        const fs = require('fs');
        if (voiceResult.filePath && fs.existsSync(voiceResult.filePath)) {
          response.voice = voiceResult.filePath;
        } else {
          response.text = '*Voice generation failed — file not created.*\n```\nTry: pip install edge-tts\n```';
        }
      } catch (err) {
        response.text = `*Voice Error:* \`\`\`${err.message}\n\nFix: pip install edge-tts\`\`\``;
      }
      return;
    }

    // --- Booking start detection ---
    // Admin/boss: only start booking with explicit "/book" command, not casual mentions
    // Customers: start on direct booking phrases at start of message
    if (!bookingFlow.isActive(phone)) {
      const isExplicitBookCmd = /^\/(book|tempah|sewa)/i.test(body);
      const isCustomerBookIntent = !isAdmin && /^(book|tempah|nak sewa|i want to (book|rent))/i.test(body);
      if (isExplicitBookCmd || isCustomerBookIntent) {
        response.text = await bookingFlow.start(phone, name || existingCustomer?.customer_name, isAdmin);
        return;
      }
    }

    // --- Admin report shortcut: natural language → direct reports ---
    // "get me reports", "show reports", "daily report", "report for today"
    // These bypass the AI entirely — reports.js output is already formatted.
    // Sending through AI causes it to rewrite/summarize the formatted output.
    if (isAdmin) {
      const reportMatch = this._matchNaturalReport(body);
      if (reportMatch) {
        try {
          if (reportMatch === 'all') {
            const allReports = await Promise.all([
              reports.sortedByTime(),
              reports.sortedByContact(),
              reports.sortedByTimeslot(),
              reports.followUpReport(),
              reports.availableReport(),
              reports.summaryReport(),
            ]);
            response.text = allReports.join('\n\n───────────────\n\n');
          } else if (reportMatch === 'fleet') {
            response.text = await reports.fleetReport();
          } else if (reportMatch === 'earnings') {
            response.text = await reports.earningsReport();
          } else {
            response.text = await reports.dailySummary();
          }
        } catch (err) {
          response.text = `*Report Error:*\n\`\`\`${err.message}\`\`\``;
        }
        return;
      }
    }

    // --- Admin data shortcuts: structured queries bypass AI ---
    // Common admin questions that have a direct answer from the database.
    // These go straight to data → formatted output. No AI, no hallucination.
    if (isAdmin) {
      const dataResult = await this._matchAdminDataQuery(body);
      if (dataResult) {
        response.text = dataResult;
        return;
      }
    }

    // --- Admin/Boss: AI-first with tools (agent mode) ---
    // Admin messages always go to AI with full tool access.
    // The AI reads the question, decides if it needs data, calls tools, then answers.
    // No regex short-circuiting — the AI thinks first.
    if (isAdmin) {
      const personalContext = this._buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory, classification);
      let aiResult;
      try {
        aiResult = await aiRouter.route(body, history, {
          isAdmin,
          systemPrompt: personalContext,
          intent: classification.intent,
          forceTools: true,  // Always give AI access to tools
        });
      } catch (err) {
        console.error('[JARVIS] Admin AI route failed:', err.message);
        aiResult = { content: `*Error:*\n\`\`\`${err.message}\`\`\``, tier: 'error' };
      }
      response.text = aiResult?.content || '*No response from AI engine. Try again or use a /command.*';
      response.tier = aiResult?.tier || 'error';

      // Voice notes for admin reports
      if (body.toLowerCase().includes('report') && response.text) {
        try {
          const voiceText = jarvisVoice.formatForVoice(response.text);
          const voiceResult = await voiceEngine.speak(voiceText, { language: conv.language || 'en' });
          if (voiceResult?.filePath) response.voice = voiceResult.filePath;
        } catch (err) {
          console.warn('[JARVIS] Voice generation failed:', err.message);
        }
      }
      return;
    }

    // --- Customer: Quick responses for common intents (speed) ---
    const quickResponse = await this._handleIntentDirect(classification, msg, response, isAdmin, existingCustomer, customerHistory, lang);
    if (quickResponse) return;

    // --- First-time greeting for new customers ---
    if (!existingCustomer && classification.intent === INTENTS.GREETING) {
      response.text = customerFlows.newCustomerWelcome(name, lang);
      return;
    }

    // --- Returning customer greeting ---
    if (existingCustomer && classification.intent === INTENTS.GREETING) {
      response.text = customerFlows.returningCustomerGreeting(
        existingCustomer.customer_name,
        customerHistory?.activeRentals || [],
        customerHistory?.totalRentals || 0,
        lang
      );
      return;
    }

    // --- Customer: AI-powered response with tools ---
    const personalContext = this._buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory, classification);

    let aiResult;
    try {
      aiResult = await aiRouter.route(body, history, {
        isAdmin,
        systemPrompt: personalContext,
        intent: classification.intent,
      });
    } catch (err) {
      console.error('[JARVIS] Customer AI route failed:', err.message);
      aiResult = null;
    }

    response.text = aiResult?.content || 'Terima kasih! Sila hubungi kami di +60126565477 untuk bantuan lanjut.\n\nThank you! Please contact us at +60126565477 for further assistance.';
    response.tier = aiResult?.tier || 'error';
  }

  // --- Intent-based direct responses ---

  async _handleIntentDirect(classification, msg, response, isAdmin, existingCustomer, customerHistory, lang) {
    const { phone, body } = msg;

    switch (classification.intent) {
      case INTENTS.PRICING_INQUIRY:
        response.text = policies.formatPricingForCustomer();
        return true;

      case INTENTS.PAYMENT:
        if (/dah bayar|sudah bayar|已付款|paid|transferred|bank.?in/i.test(body)) {
          response.text = '*Payment Noted*\n```Thank you! Your payment will be verified by our team shortly.```\n\nPlease send proof of payment (screenshot/receipt) if you haven\'t already.';
          notifications.onPaymentProof(phone, msg.name, null).catch(err => console.warn('[JARVIS] Payment proof notification failed:', err.message));
          return true;
        }
        response.text = customerFlows.paymentInstructions(null, lang);
        return true;

      case INTENTS.BOOKING_INQUIRY: {
        // Admin: don't auto-start booking from casual mentions — let AI respond naturally
        // Admin can use /book to explicitly start booking
        if (isAdmin) {
          // Just show available cars as info, don't enter booking flow
          const cache = syncEngine.getCache();
          const validatedCars = cache.validatedCars || cache.cars;
          response.text = customerFlows.formatAvailableCarsForAdmin(validatedCars);
          return true;
        }
        // Customers: start booking flow
        if (!bookingFlow.isActive(phone)) {
          response.text = await bookingFlow.start(phone, msg.name || existingCustomer?.customer_name, isAdmin);
        } else {
          const cache = syncEngine.getCache();
          const validatedCars = cache.validatedCars || cache.cars;
          response.text = customerFlows.formatAvailableCarsForCustomer(validatedCars, lang);
        }
        return true;
      }

      case INTENTS.DELIVERY: {
        const locMatch = body.match(/(?:to|ke|at|di|kat|dari)\s+(\w+(?:\s+\w+)?)/i);
        const loc = locMatch ? locMatch[1] : null;
        const fee = loc ? policies.getDeliveryFee(loc) : null;

        if (fee) {
          response.text = `*Delivery to ${loc}*\n\`\`\`\nFee: ${fee.fee === 0 ? 'FREE' : 'RM' + fee.fee}\n\`\`\``;
        } else {
          response.text = `*Delivery Zones*\n\`\`\`\n`;
          for (const zone of Object.values(policies.deliveryZones)) {
            response.text += `${zone.areas.join('/')}: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}\n`;
          }
          response.text += `\`\`\``;
        }
        response.text += `\n\nShare your location pin for exact delivery fee calculation.`;
        response.text += `\nOur location: ${locationService.jrvLocation()}`;
        return true;
      }

      case INTENTS.EXTENSION_INQUIRY: {
        if (customerHistory && customerHistory.activeRentals.length > 0) {
          response.text = customerFlows.extensionInfo(customerHistory.activeRentals[0], 1, lang);
        } else {
          response.text = `*Extension*\n\`\`\`\n${policies.extension.note}\n\`\`\`\n\nPlease provide your rental details or booking number.`;
        }
        return true;
      }

      case INTENTS.RETURN_INQUIRY: {
        if (customerHistory && customerHistory.activeRentals.length > 0) {
          response.text = customerFlows.returnReminder(customerHistory.activeRentals[0], lang);
        } else {
          response.text = `*Car Return*\n\`\`\`\nReturn Location: Seremban (free)\nOther locations may have delivery fees.\n\`\`\`\n\n${policies.fuel.note}`;
        }
        return true;
      }

      case INTENTS.CANCELLATION: {
        if (customerHistory && customerHistory.activeRentals.length > 0) {
          response.text = customerFlows.cancellationInfo(customerHistory.activeRentals[0], lang);
        } else {
          response.text = `*Cancellation Policy*\n\`\`\`\n${policies.cancellation.note}\n\`\`\``;
        }
        return true;
      }

      case INTENTS.DOCUMENT_SUBMIT: {
        const isForeigner = /foreigner|asing|passport|pasport|护照/i.test(body);
        response.text = customerFlows.documentReminder(isForeigner, lang);
        return true;
      }

      case INTENTS.EMERGENCY: {
        response.text = `*EMERGENCY*\n\`\`\`\n` +
          `Our team has been alerted.\n` +
          `Call us NOW: +${policies.admins.businessNumber}\n` +
          `\`\`\`\n\n` +
          `If accident:\n` +
          `1. Ensure everyone is safe\n` +
          `2. Call police if needed\n` +
          `3. Take photos of damage\n` +
          `4. Contact us immediately`;
        return true;
      }

      default:
        return false;
    }
  }

  // --- Voice Handler ---

  async _handleVoice(msg, response, isAdmin, existingCustomer) {
    const { phone, media } = msg;

    let transcription;
    try {
      transcription = await voiceEngine.listen(media.data);
      console.log(`[JARVIS] Voice from ${phone}: "${transcription.text}"`);
    } catch (err) {
      console.warn('[JARVIS] STT failed:', err.message);
      response.text = isAdmin
        ? `*Voice transcription failed*\n\`\`\`\n${err.message}\nFix: pip install faster-whisper\nOr set GROQ_API_KEY for cloud STT.\n\`\`\``
        : 'Maaf, saya tidak dapat mendengar mesej suara sekarang. Sila taip mesej anda. / Sorry, I can\'t process voice notes right now. Please type your message.';
      return;
    }

    const textMsg = { ...msg, body: transcription.text, type: 'chat' };
    const customerHistory = existingCustomer
      ? await agreementsService.getCustomerHistory(phone).catch(err => { console.warn('[JARVIS] Voice handler customer history lookup failed:', err.message); return null; })
      : null;
    const classification = intentReader.classify(transcription.text, 'chat', isAdmin);

    await this._handleText(textMsg, response, isAdmin, msg.isBoss, existingCustomer, customerHistory, classification);

    // Voice response ONLY for admins
    if (isAdmin) {
      const conv = this.conversation.getOrCreate(phone);
      try {
        const voiceText = jarvisVoice.formatForVoice(response.text);
        const voiceResult = await voiceEngine.speak(voiceText, {
          language: conv.language || transcription.language || 'en',
        });
        response.voice = voiceResult.filePath;
      } catch (err) {
        console.warn('[JARVIS] Voice response failed:', err.message);
      }
    }
  }

  // --- Location Handler ---

  async _handleLocation(msg, response, isAdmin, classification) {
    const { phone, name } = msg;
    const { latitude: lat, longitude: lng } = msg.location;

    if (!lat || !lng) {
      response.text = '*Location*\n```Could not read location data. Please try sharing your location again.```';
      return;
    }

    // Format location response with zone matching + maps links
    response.text = await locationService.formatLocationResponse(lat, lng, name, isAdmin);

    // Forward to admin with location details
    if (!isAdmin) {
      const [geo, zone] = await Promise.all([
        locationService.reverseGeocode(lat, lng),
        Promise.resolve(locationService.matchDeliveryZone(lat, lng)),
      ]);

      notifications.onLocationReceived(phone, name, lat, lng, zone, geo).catch(err =>
        console.error('[JARVIS] Location notification failed:', err.message)
      );
    }
  }

  // --- Image Handler ---

  async _handleImage(msg, response, isAdmin, classification) {
    const { phone, media, body } = msg;
    const prompt = body || 'What do you see in this image? If there is a car plate, read it.';

    const analysis = await imageReader.analyze(media.data, prompt);
    response.text = `*Image Analysis:*\n\`\`\`${analysis.description}\`\`\``;

    const isPayment = /pay|bayar|receipt|resit|transfer|bukti/i.test(body || '') || /receipt|payment|transfer/i.test(analysis.description || '');

    if (isPayment) {
      response.text += `\n\n*Payment proof noted!* Our team will verify shortly.`;
      notifications.onPaymentProof(phone, msg.name, null).catch(err => console.warn('[JARVIS] Image payment proof notification failed:', err.message));
    }

    if (analysis.text) {
      const plate = analysis.text.replace(/[^A-Z0-9]/gi, '').trim();
      if (plate.length >= 4) {
        const car = await fleetService.getCarByPlate(plate);
        if (car) {
          if (isAdmin) {
            response.text += `\n\n*Car Found:*\n\`\`\`${car._carName || car.body_type || ''} ${car.year || ''}\nPlate: ${car.plate_number}\nStatus: ${car.status}\`\`\``;
            const bookings = await agreementsService.getAgreementsByPlate(plate);
            if (bookings.length > 0) {
              const latest = bookings[0];
              response.text += `\n\n*Current Booking:*\n\`\`\`${latest.customer_name}\n${(latest.date_start || '').slice(0, 10)} -> ${(latest.date_end || '').slice(0, 10)}\`\`\``;
            }
          } else {
            response.text += `\n\n*Car:* ${car._carName || car.body_type || ''}`;
          }
        }
      }
    }

    // Forward customer media to admin (upload to Cloudinary + notify)
    if (!isAdmin && media) {
      this._forwardMediaToAdmin(phone, msg.name, media, isPayment ? 'payment_proof' : 'image', body).catch(err =>
        console.error('[JARVIS] Media forward failed:', err.message)
      );
    }
  }

  // --- Document/Video Handler ---

  async _handleDocument(msg, response, isAdmin, classification) {
    const { phone, media, type } = msg;
    const typeLabel = type === 'video' ? 'Video' : 'Document';

    response.text = `*${typeLabel} Received*\n\`\`\`Thank you! Our team will review your ${typeLabel.toLowerCase()}.${type === 'video' ? '' : '\nPlease also check you have submitted all required documents.'}\`\`\``;

    // Forward actual media to admin (not just notification text)
    if (!isAdmin && media) {
      this._forwardMediaToAdmin(phone, msg.name, media, type, msg.body).catch(err =>
        console.error('[JARVIS] Media forward failed:', err.message)
      );
    } else {
      notifications.notifySuperadmin(
        `*${typeLabel} received from ${msg.name} (+${phone})*\n\`\`\`Please review.\`\`\``
      ).catch(err => console.warn('[JARVIS] Document superadmin notification failed:', err.message));
    }
  }

  // --- Media Forwarding ---

  /**
   * Upload customer media to Cloudinary and forward to admin.
   * @param {string} phone - Customer phone
   * @param {string} name - Customer name
   * @param {object} media - { data: Buffer, mimetype, filename }
   * @param {string} mediaType - 'image', 'document', 'video', 'payment_proof'
   * @param {string} caption - Original message caption
   */
  async _forwardMediaToAdmin(phone, name, media, mediaType, caption = '') {
    let cloudUrl = null;

    // Upload to Cloudinary for permanent storage
    if (cloudinary.isAvailable()) {
      try {
        const folder = mediaType === 'payment_proof' ? 'jrv/payments' : `jrv/customers/${phone}`;
        const ext = (media.mimetype || '').split('/')[1] || 'bin';
        const filename = media.filename || `${mediaType}_${Date.now()}.${ext}`;
        const resourceType = mediaType === 'video' ? 'video' : /image|payment/.test(mediaType) ? 'image' : 'raw';

        const upload = await cloudinary.uploadBuffer(media.data, filename, {
          folder,
          resourceType,
          publicId: `${mediaType}_${phone}_${Date.now()}`,
        });
        cloudUrl = upload.secureUrl;
        console.log(`[JARVIS] Customer media uploaded: ${cloudUrl}`);
      } catch (err) {
        console.warn('[JARVIS] Cloudinary upload for forwarding failed:', err.message);
      }
    }

    // Notify admin with media context
    const notifyText = `*Customer Media*\n` +
      '```\n' +
      `From: ${name} (+${phone})\n` +
      `Type: ${mediaType}\n` +
      `${caption ? `Caption: ${caption.slice(0, 150)}\n` : ''}` +
      `${cloudUrl ? `Cloud: ${cloudUrl}\n` : ''}` +
      '```';

    // Forward: try sending actual media buffer, then fall back to text + URL
    notifications.forwardMedia(phone, name, media, mediaType, caption, cloudUrl).catch(err => {
      console.warn('[JARVIS] Media forward via notification failed:', err.message);
      notifications.notifySuperadmin(notifyText).catch(err2 => console.warn('[JARVIS] Media forward fallback notification failed:', err2.message));
    });
  }

  // --- Natural language report detection ---
  // Catches "get me reports", "show reports for today", "daily report", etc.
  // Returns: 'all' | 'fleet' | 'earnings' | 'summary' | null

  _matchNaturalReport(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    // Must mention "report" somewhere
    if (!/report/.test(lower)) return null;

    // Specific report types
    if (/fleet\s*report/i.test(lower)) return 'fleet';
    if (/earning|revenue/i.test(lower)) return 'earnings';

    // "all reports", "all 6 reports", "report 1-6", "reports for today", "daily reports"
    if (/all\s*(6\s*)?report|report\s*1\s*[-–]\s*6|daily\s*report|report.*today|today.*report|get\s*(me\s*)?report|show\s*(me\s*)?report|generate\s*report|pull\s*report|send\s*(me\s*)?report/i.test(lower)) {
      return 'all';
    }

    // Just "report" or "reports" with nothing else complex
    if (/^(get|show|give|pull|send)?\s*(me\s*)?(the\s*)?(daily\s*)?reports?\s*(please|pls|now)?\.?$/i.test(lower)) {
      return 'all';
    }

    return null;
  }

  // --- Admin data query shortcuts ---
  // Common admin questions that map directly to database queries.
  // No AI needed. Returns formatted text or null (falls through to AI).

  async _matchAdminDataQuery(text) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    try {
      // Expiring / due / returning soon
      if (/expir|due today|return.*today|who.*return|coming back|ending today/i.test(lower)) {
        const expiring = await agreementsService.getExpiringAgreements(1);
        if (expiring.length === 0) return '*No rentals expiring today.* ✅';
        let r = `*⚠️ Expiring Today: ${expiring.length} vehicle(s)*\n\n`;
        for (const a of expiring) {
          const phone = a.mobile || 'N/A';
          r += `• ${a.car_type || 'N/A'} (${a.plate_number}) — ${a.customer_name || 'N/A'}\n  📱 ${phone}\n`;
        }
        return r;
      }

      // Overdue
      if (/overdue|late return|past due|haven.*return/i.test(lower)) {
        const overdue = await agreementsService.getOverdueAgreements();
        if (overdue.length === 0) return '*No overdue returns.* ✅';
        let r = `*🚨 Overdue Returns: ${overdue.length}*\n\n`;
        for (const a of overdue) {
          r += `• ${a.car_type || 'N/A'} (${a.plate_number}) — ${a.customer_name || 'N/A'}\n  📱 ${a.mobile || 'N/A'}\n`;
        }
        return r;
      }

      // Available cars
      if (/available|free car|what car.*have|any car|car.*ready|car.*rent/i.test(lower) && !/customer|who|book/i.test(lower)) {
        return await reports.availableReport();
      }

      // Follow up / pending
      if (/follow.?up|need.*contact|pending|who.*call/i.test(lower)) {
        return await reports.followUpReport();
      }

      // Active bookings / how many rented
      if (/active book|how many.*rent|current.*book|total.*rent/i.test(lower)) {
        const agreements = await agreementsService.getActiveAgreements();
        const cars = await fleetService.getAllCars();
        const active = cars.filter(c => c.status !== 'inactive');
        return `*📊 Current Status*\n\nActive Bookings: ${agreements.length}\nFleet Size: ${active.length}\nAvailable: ${active.length - agreements.length}\nUtilization: ${active.length > 0 ? ((agreements.length / active.length) * 100).toFixed(0) : 0}%`;
      }

    } catch (err) {
      console.error('[JARVIS] Data query shortcut failed:', err.message);
      return null; // Fall through to AI
    }

    return null;
  }

  // --- Commands ---

  _parseCommand(text, isAdmin, isBoss) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    // Boss-only tool commands
    if (lower.startsWith('/tool ') && isBoss) {
      const parts = text.slice(6).trim().split(/\s+/);
      return { cmd: 'tool', toolCmd: parts[0], toolArgs: parts.slice(1) };
    }

    // Reminder commands
    if (lower === '/reminders' || lower === '/reminder') return { cmd: 'reminders' };
    if (lower.startsWith('/remind ')) return { cmd: 'remind', text: text.slice(8).trim() };
    if (lower.match(/^\/delete-reminder\s+(\d+)/)) return { cmd: 'delete-reminder', id: parseInt(lower.match(/\d+/)[0]) };

    // Model switching shortcut (boss only)
    if (lower.startsWith('/switch') && isBoss) {
      const arg = text.slice(7).trim();
      const parts = arg ? arg.split(/\s+/) : [];
      return { cmd: 'tool', toolCmd: 'switch', toolArgs: parts };
    }

    // Voice profile
    if (lower.startsWith('/voice ')) return { cmd: 'voice', profile: text.slice(7).trim() };

    // Booking
    if (lower === '/book' || lower === '/booking') return { cmd: 'book' };

    if (lower === '/status' || lower === '/health') return { cmd: 'status' };
    if (lower === '/cars' || lower === '/fleet') return { cmd: 'fleet' };
    if (lower === '/available') return { cmd: 'available' };
    if (lower === '/bookings') return { cmd: 'bookings' };
    if (lower.startsWith('/search ')) return { cmd: 'search', arg: text.slice(8).trim() };
    if (lower === '/pricing' || lower === '/price' || lower === '/harga') return { cmd: 'pricing' };
    if ((lower === '/report' || lower === '/daily') && isAdmin) return { cmd: 'report' };
    if ((lower === '/report1-6' || lower === '/reports' || lower === '/allreports') && isAdmin) return { cmd: 'report-all' };
    if ((lower === '/report1' || lower === '/sorted-time') && isAdmin) return { cmd: 'report1' };
    if ((lower === '/report2' || lower === '/sorted-contact') && isAdmin) return { cmd: 'report2' };
    if ((lower === '/report3' || lower === '/sorted-timeslot') && isAdmin) return { cmd: 'report3' };
    if ((lower === '/report4' || lower === '/followup') && isAdmin) return { cmd: 'report4' };
    if ((lower === '/report5' || lower === '/available-report') && isAdmin) return { cmd: 'report5' };
    if ((lower === '/report6' || lower === '/summary') && isAdmin) return { cmd: 'report6' };
    if (lower === '/earnings' && isAdmin) return { cmd: 'earnings' };
    if (lower === '/fleet-report' && isAdmin) return { cmd: 'fleet-report' };
    if (lower === '/expiring' && isAdmin) return { cmd: 'expiring' };
    if (lower === '/overdue' && isAdmin) return { cmd: 'overdue' };
    if (lower === '/help' || lower === '/commands' || lower === '/cmd') return { cmd: 'help', isAdmin, isBoss };

    // Catch unrecognized slash commands — prevent AI hallucination
    if (lower.startsWith('/') && lower.length > 1) return { cmd: 'unknown', raw: text };

    return null;
  }

  async _handleCommand(command, msg, response, isAdmin, isBoss) {
    switch (command.cmd) {
      // --- Boss-only tools ---
      case 'tool': {
        const result = await adminTools.execute(command.toolCmd, command.toolArgs, msg.phone, msg.name);
        if (result.type === 'site') {
          response.text = `*Site Generated*\n\`\`\`\n${result.description}\n${result.html.length} chars of HTML\n\`\`\`\n\nHTML code is ready. Use /tool export to download.`;
          response.siteHtml = result.html;
        } else {
          response.text = `*Tool: ${command.toolCmd}*\n\`\`\`\n${JSON.stringify(result, null, 2).slice(0, 3000)}\n\`\`\``;
        }
        break;
      }

      // --- Reminders ---
      case 'reminders': {
        const list = isAdmin ? reminders.listAll() : reminders.listForPhone(msg.phone);
        response.text = reminders.formatList(list);
        break;
      }
      case 'remind': {
        const result = reminders.createFromText(command.text, msg.phone, msg.name);
        if (result.error) {
          response.text = `*Reminder Error*\n\`\`\`${result.error}\`\`\``;
        } else {
          const dueStr = result.dueAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
          response.text = `*Reminder #${result.id} Set*\n\`\`\`\n${result.text}\nDue: ${dueStr}\n${result.repeat ? `Repeats: ${result.repeat}` : ''}\n\`\`\``;
        }
        break;
      }
      case 'delete-reminder': {
        const deleted = reminders.delete(command.id, msg.phone);
        response.text = deleted
          ? `*Reminder #${command.id} deleted*`
          : `*Reminder #${command.id} not found*`;
        break;
      }

      // --- Voice profile ---
      case 'voice': {
        if (!isAdmin) { response.text = 'Admin only.'; break; }
        if (command.profile === 'list') {
          const profiles = jarvisVoice.listProfiles();
          response.text = `*Voice Profiles*\n\`\`\`\n${profiles.map(p => `${p.active ? '> ' : '  '}${p.id} (${p.name}) - ${p.style}`).join('\n')}\n\`\`\``;
        } else if (jarvisVoice.setProfile(command.profile)) {
          response.text = `*Voice changed to ${jarvisVoice.getProfile().name}*`;
        } else {
          response.text = `Unknown voice. Available: ${jarvisVoice.listProfiles().map(p => p.id).join(', ')}`;
        }
        break;
      }

      // --- Booking ---
      case 'book': {
        response.text = await bookingFlow.start(msg.phone, msg.name, isAdmin);
        break;
      }

      // --- Existing commands ---
      case 'status': {
        const stats = aiRouter.getStats();
        const convStats = this.conversation.getStats();
        const cache = syncEngine.getCache();
        const schedStats = require('./scheduler').getStats();
        response.text = `*JARVIS Status*\n\`\`\`\n` +
          `AI: Local ${stats.local} | Cloud ${stats.cloud} | Cache ${stats.cacheHits}\n` +
          `Fallback: ${stats.fallback} | Tools: ${stats.toolCalls}\n` +
          `Chats: ${convStats.activeConversations}\n` +
          `Cars: ${cache.cars.length} | Bookings: ${cache.agreements.length}\n` +
          `Reminders: ${schedStats.reminders.active} active\n` +
          `Voice: ${jarvisVoice.getProfile().name}\n` +
          `Last sync: ${cache.lastSync ? cache.lastSync.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : 'never'}\n` +
          `\`\`\``;
        break;
      }
      case 'fleet': {
        response.text = await reports.fleetReport();
        break;
      }
      case 'available': {
        // Fetch fresh data (don't rely on cache which may be empty if sync failed)
        const [avCars, avAgreements] = await Promise.all([
          fleetService.getAllCars(),
          agreementsService.getActiveAgreements(),
        ]);
        const { validated: avValidated } = validateFleetStatus(avCars, avAgreements);
        response.text = isAdmin
          ? customerFlows.formatAvailableCarsForAdmin(avValidated)
          : customerFlows.formatAvailableCarsForCustomer(avValidated);
        break;
      }
      case 'bookings': {
        const active = await agreementsService.getActiveAgreements();
        if (active.length === 0) {
          response.text = '*Active Bookings*\n```No active bookings```';
        } else {
          response.text = `*Active Bookings (${active.length})*\n\`\`\`\n` +
            active.map(a =>
              `${isAdmin ? a.plate_number + ' ' : ''}${a.customer_name}\n  ${(a.date_start || '').slice(0, 10)} -> ${(a.date_end || '').slice(0, 10)} [${a.status}]`
            ).join('\n') +
            `\n\`\`\``;
        }
        break;
      }
      case 'search': {
        const cars = await fleetService.searchCars(command.arg);
        const bookings = await agreementsService.getAgreementsByCustomerName(command.arg);
        const parts = [];
        if (cars.length) {
          parts.push(`*Cars:*\n\`\`\`\n${cars.map(c =>
            isAdmin ? `${c.plate_number} ${c._carName || c.body_type || ''}` : `${c._carName || c.body_type || ''}`
          ).join('\n')}\n\`\`\``);
        }
        if (bookings.length) {
          parts.push(`*Bookings:*\n\`\`\`\n${bookings.map(b =>
            isAdmin ? `${b.customer_name} - ${b.plate_number}` : `${b.customer_name}`
          ).join('\n')}\n\`\`\``);
        }
        response.text = parts.length ? parts.join('\n') : `*Search*\n\`\`\`No results for "${command.arg}"\`\`\``;
        break;
      }
      case 'pricing': {
        response.text = policies.formatPricingForCustomer();
        break;
      }
      case 'report': { response.text = await reports.dailySummary(); break; }
      case 'report-all': {
        // Generate all 6 reports at once
        const allReports = await Promise.all([
          reports.sortedByTime(),
          reports.sortedByContact(),
          reports.sortedByTimeslot(),
          reports.followUpReport(),
          reports.availableReport(),
          reports.summaryReport(),
        ]);
        response.text = allReports.join('\n\n───────────────\n\n');
        break;
      }
      case 'report1': { response.text = await reports.sortedByTime(); break; }
      case 'report2': { response.text = await reports.sortedByContact(); break; }
      case 'report3': { response.text = await reports.sortedByTimeslot(); break; }
      case 'report4': { response.text = await reports.followUpReport(); break; }
      case 'report5': { response.text = await reports.availableReport(); break; }
      case 'report6': { response.text = await reports.summaryReport(); break; }
      case 'fleet-report': { response.text = await reports.fleetReport(); break; }
      case 'earnings': { response.text = await reports.earningsReport(); break; }
      case 'expiring': {
        const expiring = await agreementsService.getExpiringAgreements(3);
        if (expiring.length === 0) {
          response.text = '*Expiring Rentals*\n```None expiring in next 3 days```';
        } else {
          response.text = `*Expiring in 3 Days (${expiring.length})*\n\`\`\`\n` +
            expiring.map(a => `${a.plate_number} - ${a.customer_name} (ends ${(a.date_end || '').slice(0, 10)})\n  Phone: ${a.mobile || 'N/A'}`).join('\n') +
            `\n\`\`\``;
        }
        break;
      }
      case 'overdue': {
        const overdue = await agreementsService.getOverdueAgreements();
        if (overdue.length === 0) {
          response.text = '*Overdue Returns*\n```None overdue - all good!```';
        } else {
          response.text = `*Overdue Returns (${overdue.length})*\n\`\`\`\n` +
            overdue.map(a => `${a.plate_number} - ${a.customer_name}\n  Was due: ${(a.date_end || '').slice(0, 10)}\n  Phone: ${a.mobile || 'N/A'}`).join('\n') +
            `\n\`\`\``;
        }
        break;
      }
      case 'unknown': {
        response.text = `*Unknown command:* \`${command.raw}\`\n\nType /commands to see available commands.`;
        break;
      }
      case 'help': {
        response.text = `*JARVIS Commands*\n\n`;

        response.text += `*General:*\n\`\`\`\n` +
          `/commands    All commands\n` +
          `/cars        Fleet status\n` +
          `/available   Available cars\n` +
          `/bookings    Active bookings\n` +
          `/pricing     Rate card\n` +
          `/book        Start booking\n` +
          `/search <q>  Search cars/customers\n` +
          `/reminders   Your reminders\n` +
          `/remind <t>  Set a reminder\n` +
          `\`\`\`\n`;

        if (command.isAdmin) {
          response.text += `\n*Admin Reports:*\n\`\`\`\n` +
            `/report      Daily summary\n` +
            `/report1-6   ALL 6 reports at once\n` +
            `/report1     Expiring by Models\n` +
            `/report2     Expiring with Contacts\n` +
            `/report3     Expiring by Time Slot\n` +
            `/report4     Follow-up Required\n` +
            `/report5     Available Cars\n` +
            `/report6     Summary/Totals\n` +
            `/fleet-report Fleet validation\n` +
            `/earnings    Revenue report\n` +
            `/expiring    Expiring in 3 days\n` +
            `/overdue     Overdue returns\n` +
            `\`\`\`\n`;

          response.text += `\n*Admin Tools:*\n\`\`\`\n` +
            `/voice list  List voice profiles\n` +
            `/voice <id>  Change voice\n` +
            `/status      System health\n` +
            `\`\`\`\n`;
        }

        if (command.isBoss) {
          response.text += `\n*Boss Memory & Rules:*\n\`\`\`\n` +
            `"Remember: <fact>"   Save to memory\n` +
            `"What do you remember?" List memories\n` +
            `"Forget memory <id>"  Delete memory\n` +
            `"New rule: <rule>"    Add rule\n` +
            `"Show rules"          List rules\n` +
            `"Delete rule <id>"    Remove rule\n` +
            `\`\`\`\n`;

          response.text += `\n*Boss Power Tools:*\n\`\`\`\n` +
            `/tool help         All tools\n` +
            `/tool pc           PC performance\n` +
            `/tool site <desc>  Generate website\n` +
            `/tool broadcast    Message all admins\n` +
            `/tool export       Export data\n` +
            `/tool config       Show config\n` +
            `/tool set <k> <v>  Change setting\n` +
            `/tool query <t>    Query data\n` +
            `/tool system       System info\n` +
            `\`\`\`\n`;

          response.text += `\n*Boss Safety:*\n\`\`\`\n` +
            `/tool backups      List backups\n` +
            `/tool trash        List trashed files\n` +
            `/tool restore <f>  Restore backup\n` +
            `/tool delete <f>   Delete from trash\n` +
            `/tool purge-trash  Empty trash\n` +
            `/tool safety-log   Audit log\n` +
            `\`\`\`\n`;

          response.text += `\n*Boss Reminders:*\n\`\`\`\n` +
            `/tool reminder-all     All reminders\n` +
            `/tool clear-reminders  Clear by phone\n` +
            `\`\`\`\n`;

          response.text += `\n*Boss Media (Cloudinary):*\n\`\`\`\n` +
            `/tool cloud            Storage stats\n` +
            `/tool cloud-voice      List voice notes\n` +
            `/tool cloud-images     List images\n` +
            `/tool cloud-videos     List videos\n` +
            `/tool cloud-delete <id> Delete media\n` +
            `/tool generate-image   AI image\n` +
            `/tool generate-video   Video tools\n` +
            `/tool upload           Upload info\n` +
            `/tool customer-media   Customer files\n` +
            `\`\`\`\n`;

          response.text += `\n*Boss Location:*\n\`\`\`\n` +
            `/tool location         JRV location info\n` +
            `/tool location <lat> <lng>  Lookup coords\n` +
            `/tool delivery <place>      Delivery fee calc\n` +
            `\`\`\`\n`;
        }

        response.text += `\nOr just chat naturally in Malay, English, Chinese, or Tamil!`;
        break;
      }
    }
  }

  // --- Helpers ---

  _buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory, classification) {
    const parts = [];

    parts.push('CONTEXT FOR THIS MESSAGE:');
    parts.push('Answer EXACTLY what was asked. Use tools for live data. Never guess numbers.');
    parts.push('');

    if (isAdmin) {
      const admin = policies.getAdmin(phone);
      if (admin) {
        parts.push(`SPEAKING TO: ${admin.name} — ${admin.role}`);
        parts.push(`Address as: "${admin.title}"`);
        parts.push(`Style: ${admin.style}`);
        if (admin.isBoss) {
          parts.push('This is your CREATOR. Be at your sharpest. He built you and knows how you work.');
        }
      } else {
        parts.push('SPEAKING TO: Unknown admin. Full data access.');
      }
    } else {
      parts.push('SPEAKING TO: CUSTOMER');
      parts.push('NEVER share: car plates, admin phones, other customer data.');
      parts.push('Only share business WhatsApp: +60126565477.');

      if (existingCustomer) {
        parts.push(`RETURNING CUSTOMER: ${existingCustomer.customer_name}`);
        if (customerHistory) {
          parts.push(`History: ${customerHistory.totalRentals} rentals | RM${customerHistory.totalSpent.toFixed(2)} spent`);
          if (customerHistory.activeRentals.length > 0) {
            const active = customerHistory.activeRentals[0];
            parts.push(`ACTIVE RENTAL: ${active.car_type || 'N/A'} until ${(active.date_end || '').slice(0, 10)}`);
          }
          if (customerHistory.totalRentals >= 5) {
            parts.push('VIP: Regular customer. Be extra helpful.');
          }
        }
      } else {
        parts.push('NEW customer. Welcome warmly. Collect name + requirements.');
      }
    }

    if (name) parts.push(`WhatsApp name: "${name}"`);
    if (classification) parts.push(`Detected intent: ${classification.intent}`);

    // Inject customer profile summary (learned from past interactions)
    const profileSummary = customerProfiles.getSummary(phone);
    if (profileSummary) parts.push(`Profile: ${profileSummary}`);

    // Compact live data summary
    const cache = syncEngine.getCache();
    if (cache.lastSync) {
      const validated = cache.validatedCars || cache.cars;
      const avail = validated.filter(c => (c._validatedStatus || c.status) === 'available');
      parts.push('');
      parts.push(`Live fleet: ${validated.length} cars, ${avail.length} available, ${cache.agreements.length} active bookings`);

      if (!isAdmin && avail.length > 0) {
        parts.push('Available cars (NO PLATES for customer):');
        for (const car of avail) {
          parts.push(`  ${car._carName || car.body_type || ''} ${colorName(car.color)} RM${car.daily_price}/day`);
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * Log message interaction to Supabase for the dashboard.
   * Stores last 200 messages in a rotating buffer in bot_data_store.
   */
  async _logMessage(phone, name, inbound, outbound, classification, isAdmin) {
    try {
      const supabase = require('../supabase/client');
      const entry = {
        ts: new Date().toISOString(),
        phone,
        name: name || phone,
        role: isAdmin ? 'admin' : 'customer',
        in: (inbound || '').slice(0, 500),
        out: (outbound || '').slice(0, 500),
        intent: classification?.intent || 'unknown',
        priority: classification?.priority || 'LOW',
      };

      // Read existing log
      const { data } = await supabase
        .from('bot_data_store')
        .select('value')
        .eq('key', 'message_log')
        .single();

      const messages = Array.isArray(data?.value) ? data.value : [];
      messages.unshift(entry); // newest first
      if (messages.length > 200) messages.length = 200; // cap at 200

      await supabase.from('bot_data_store').upsert({
        key: 'message_log',
        value: messages,
        created_by: 'jarvis',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch (err) {
      // Non-critical — don't crash for logging failure
      console.warn('[JARVIS] Message log write failed:', err.message);
    }
  }
}

module.exports = new JarvisBrain();
