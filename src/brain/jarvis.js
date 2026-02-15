const aiRouter = require('../ai/router');
const voiceEngine = require('../voice');
const { imageReader } = require('../media');
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
const { agreementsService, fleetService, syncEngine } = require('../supabase/services');

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
 * 9. Format: *bold headers* + ```monospace data```
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

    // --- 1. Identify user ---
    const isAdmin = syncEngine.isAdmin(phone) || policies.isAdmin(phone);
    const isBoss = adminTools.isBoss(phone) || msg.isBoss || false;
    const existingCustomer = syncEngine.lookupCustomer(phone);
    const customerHistory = existingCustomer
      ? await agreementsService.getCustomerHistory(phone).catch(() => null)
      : null;

    // Track conversation
    this.conversation.addMessage(phone, 'user', body || `[${type}]`, { name });

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
            notifications.onJarvisResponse(phone, name, body, response.text, classification).catch(() => {});
          }
          return response;
        }
      }

      if (type === 'ptt' && media) {
        await this._handleVoice(msg, response, isAdmin, existingCustomer);
      } else if ((type === 'image' || type === 'sticker') && media) {
        await this._handleImage(msg, response, isAdmin, classification);
      } else if (type === 'document' && media) {
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
      console.error(`[JARVIS] Error processing from ${phone}:`, err.message);
      response.text = isAdmin
        ? `*Error:*\n\`\`\`${err.message}\`\`\``
        : 'Maaf, ada masalah teknikal. Sila hubungi +60126565477.';
    }

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

    // --- Booking start detection ---
    if (/^(book|tempah|nak sewa|i want to (book|rent))/i.test(body) && !bookingFlow.isActive(phone)) {
      response.text = bookingFlow.start(phone, name || existingCustomer?.customer_name, isAdmin);
      return;
    }

    // --- Intent-based quick responses ---
    const quickResponse = await this._handleIntentDirect(classification, msg, response, isAdmin, existingCustomer, customerHistory, lang);
    if (quickResponse) return;

    // --- First-time greeting for new customers ---
    if (!isAdmin && !existingCustomer && classification.intent === INTENTS.GREETING) {
      response.text = customerFlows.newCustomerWelcome(name, lang);
      return;
    }

    // --- Returning customer greeting ---
    if (!isAdmin && existingCustomer && classification.intent === INTENTS.GREETING) {
      response.text = customerFlows.returningCustomerGreeting(
        existingCustomer.customer_name,
        customerHistory?.activeRentals || [],
        customerHistory?.totalRentals || 0,
        lang
      );
      return;
    }

    // --- AI-powered response ---
    const personalContext = this._buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory, classification);

    const aiResult = await aiRouter.route(body, history, {
      isAdmin,
      systemPrompt: personalContext,
      intent: classification.intent,
    });

    response.text = aiResult.content;
    response.tier = aiResult.tier;

    // Voice notes ONLY for admins
    if (isAdmin && body.toLowerCase().includes('report')) {
      try {
        const voiceText = jarvisVoice.formatForVoice(aiResult.content);
        const voiceResult = await voiceEngine.speak(voiceText, { language: conv.language || 'en' });
        response.voice = voiceResult.filePath;
      } catch (err) {
        console.warn('[JARVIS] Voice generation failed:', err.message);
      }
    }
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
          notifications.onPaymentProof(phone, msg.name, null).catch(() => {});
          return true;
        }
        response.text = customerFlows.paymentInstructions(null, lang);
        return true;

      case INTENTS.BOOKING_INQUIRY: {
        // Start booking flow instead of just showing cars
        if (!bookingFlow.isActive(phone)) {
          response.text = bookingFlow.start(phone, msg.name || existingCustomer?.customer_name, isAdmin);
        } else {
          const cache = syncEngine.getCache();
          const validatedCars = cache.validatedCars || cache.cars;
          response.text = isAdmin
            ? customerFlows.formatAvailableCarsForAdmin(validatedCars)
            : customerFlows.formatAvailableCarsForCustomer(validatedCars, lang);
        }
        return true;
      }

      case INTENTS.DELIVERY: {
        const locMatch = body.match(/(?:to|ke|at|di|kat|dari)\s+(\w+(?:\s+\w+)?)/i);
        const location = locMatch ? locMatch[1] : null;
        const fee = location ? policies.getDeliveryFee(location) : null;

        if (fee) {
          response.text = `*Delivery to ${location}*\n\`\`\`\nFee: ${fee.fee === 0 ? 'FREE' : 'RM' + fee.fee}\n\`\`\``;
        } else {
          response.text = `*Delivery Zones*\n\`\`\`\n`;
          for (const zone of Object.values(policies.deliveryZones)) {
            response.text += `${zone.areas.join('/')}: ${zone.fee === 0 ? 'FREE' : 'RM' + zone.fee}\n`;
          }
          response.text += `\`\`\``;
        }
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

    const transcription = await voiceEngine.listen(media.data);
    console.log(`[JARVIS] Voice from ${phone}: "${transcription.text}"`);

    const textMsg = { ...msg, body: transcription.text, type: 'chat' };
    const customerHistory = existingCustomer
      ? await agreementsService.getCustomerHistory(phone).catch(() => null)
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

  // --- Image Handler ---

  async _handleImage(msg, response, isAdmin, classification) {
    const { phone, media, body } = msg;
    const prompt = body || 'What do you see in this image? If there is a car plate, read it.';

    const analysis = await imageReader.analyze(media.data, prompt);
    response.text = `*Image Analysis:*\n\`\`\`${analysis.description}\`\`\``;

    if (/pay|bayar|receipt|resit|transfer|bukti/i.test(body || '') || /receipt|payment|transfer/i.test(analysis.description || '')) {
      response.text += `\n\n*Payment proof noted!* Our team will verify shortly.`;
      notifications.onPaymentProof(phone, msg.name, null).catch(() => {});
    }

    if (analysis.text) {
      const plate = analysis.text.replace(/[^A-Z0-9]/gi, '').trim();
      if (plate.length >= 4) {
        const car = await fleetService.getCarByPlate(plate);
        if (car) {
          if (isAdmin) {
            response.text += `\n\n*Car Found:*\n\`\`\`${car.make} ${car.model} ${car.year || ''}\nPlate: ${car.car_plate}\nStatus: ${car.status}\`\`\``;
            const bookings = await agreementsService.getAgreementsByPlate(plate);
            if (bookings.length > 0) {
              const latest = bookings[0];
              response.text += `\n\n*Current Booking:*\n\`\`\`${latest.customer_name}\n${latest.start_date} -> ${latest.end_date}\`\`\``;
            }
          } else {
            response.text += `\n\n*Car:* ${car.make} ${car.model}`;
          }
        }
      }
    }
  }

  // --- Document Handler ---

  async _handleDocument(msg, response, isAdmin, classification) {
    response.text = `*Document Received*\n\`\`\`Thank you! Our team will review your document.\`\`\``;

    notifications.notifySuperadmin(
      `*Document received from ${msg.name} (+${msg.phone})*\n\`\`\`Please review.\`\`\``
    ).catch(() => {});
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
    if (lower === '/help') return { cmd: 'help', isAdmin, isBoss };

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
        response.text = bookingFlow.start(msg.phone, msg.name, isAdmin);
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
        const cache = syncEngine.getCache();
        const validatedCars = cache.validatedCars || cache.cars;
        response.text = isAdmin
          ? customerFlows.formatAvailableCarsForAdmin(validatedCars)
          : customerFlows.formatAvailableCarsForCustomer(validatedCars);
        break;
      }
      case 'bookings': {
        const active = await agreementsService.getActiveAgreements();
        if (active.length === 0) {
          response.text = '*Active Bookings*\n```No active bookings```';
        } else {
          response.text = `*Active Bookings (${active.length})*\n\`\`\`\n` +
            active.map(a =>
              `${isAdmin ? a.car_plate + ' ' : ''}${a.customer_name}\n  ${a.start_date} -> ${a.end_date} [${a.status}]`
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
            isAdmin ? `${c.car_plate} ${c.make} ${c.model}` : `${c.make} ${c.model}`
          ).join('\n')}\n\`\`\``);
        }
        if (bookings.length) {
          parts.push(`*Bookings:*\n\`\`\`\n${bookings.map(b =>
            isAdmin ? `${b.customer_name} - ${b.car_plate}` : `${b.customer_name}`
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
            expiring.map(a => `${a.car_plate} - ${a.customer_name} (ends ${a.end_date})\n  Phone: ${a.customer_phone}`).join('\n') +
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
            overdue.map(a => `${a.car_plate} - ${a.customer_name}\n  Was due: ${a.end_date}\n  Phone: ${a.customer_phone}`).join('\n') +
            `\n\`\`\``;
        }
        break;
      }
      case 'help': {
        response.text = `*JARVIS Commands*\n\`\`\`\n` +
          `/cars -- Fleet status\n` +
          `/available -- Available cars\n` +
          `/bookings -- Active bookings\n` +
          `/pricing -- Rate card\n` +
          `/book -- Start booking\n` +
          `/search <query> -- Search\n` +
          `/reminders -- Your reminders\n` +
          `/remind <text> -- Set reminder\n` +
          `\`\`\`\n`;
        if (command.isAdmin) {
          response.text += `\n*Admin Commands:*\n\`\`\`\n` +
            `/report -- Daily summary\n` +
            `/report1-6 -- Specific reports\n` +
            `/fleet-report -- Fleet validation\n` +
            `/earnings -- Revenue\n` +
            `/expiring -- Expiring rentals\n` +
            `/overdue -- Overdue returns\n` +
            `/voice <profile> -- Change voice\n` +
            `/voice list -- List voices\n` +
            `/status -- System health\n` +
            `\`\`\`\n`;
        }
        if (command.isBoss) {
          response.text += `\n*Boss Tools:*\n\`\`\`\n` +
            `/tool help -- All power tools\n` +
            `/tool site <desc> -- Generate site\n` +
            `/tool broadcast <msg> -- Message all\n` +
            `/tool export <type> -- Export data\n` +
            `/tool config -- Show config\n` +
            `/tool system -- System info\n` +
            `\`\`\`\n`;
        }
        response.text += `\nOr chat naturally in Malay, English, Chinese, or Tamil!`;
        break;
      }
    }
  }

  // --- Helpers ---

  _buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory, classification) {
    const parts = [
      'You are JARVIS, AI assistant for JRV Car Rental, Seremban, Malaysia.',
      'Format: *bold headers* + ```monospace data```.',
      'No corporate BS -- get straight to data.',
      'Match the customer\'s language (Malay/English/Chinese/Tamil).',
      `Business WhatsApp: +${policies.admins.businessNumber}`,
      '',
    ];

    parts.push(policies.buildPolicyContext());
    parts.push('');

    if (isAdmin) {
      const admin = policies.getAdmin(phone);
      if (admin) {
        parts.push(`Admin: ${admin.name} (${admin.role}). Full data access.`);
      } else {
        parts.push('The user is an ADMIN. Full data access.');
      }
    } else {
      parts.push('The user is a CUSTOMER.');
      parts.push('NEVER share car plates with customers -- use model names only.');
      parts.push('NEVER share other customer details.');
      parts.push('NEVER share admin phone numbers.');

      if (existingCustomer) {
        parts.push(`RETURNING customer: ${existingCustomer.customer_name}`);
        if (customerHistory) {
          parts.push(`Total rentals: ${customerHistory.totalRentals}${customerHistory.totalRentals >= 5 ? ' (REGULAR - priority treatment)' : ''}`);
          parts.push(`Total spent: RM${customerHistory.totalSpent.toFixed(2)}`);
          if (customerHistory.activeRentals.length > 0) {
            const active = customerHistory.activeRentals[0];
            parts.push(`ACTIVE rental: ${active.car_description || active.car_model || 'N/A'} ending ${active.end_date}`);
          }
        }
      } else {
        parts.push('NEW customer. Welcome warmly. Collect name + requirements.');
      }
    }

    if (name) parts.push(`WhatsApp name: "${name}"`);
    if (classification) parts.push(`Current intent: ${classification.intent} [${classification.priority}]`);

    const cache = syncEngine.getCache();
    if (cache.lastSync) {
      const validated = cache.validatedCars || cache.cars;
      const avail = validated.filter(c => (c._validatedStatus || c.status) === 'available');
      const rented = validated.filter(c => (c._validatedStatus || c.status) === 'rented');
      parts.push('');
      parts.push(`--- LIVE DATA ---`);
      parts.push(`Fleet: ${validated.length} cars (${avail.length} available, ${rented.length} rented)`);
      parts.push(`Active bookings: ${cache.agreements.length}`);

      if (!isAdmin && avail.length > 0) {
        parts.push(`Available cars (NO PLATES to customer):`);
        for (const car of avail) {
          parts.push(`  ${car.make} ${car.model} ${car.color || ''} - RM${car.daily_rate}/day`);
        }
      }
    }

    return parts.join('\n');
  }
}

module.exports = new JarvisBrain();
