const aiRouter = require('../ai/router');
const voiceEngine = require('../voice');
const { imageReader, imageGenerator } = require('../media');
const conversation = require('./conversation');
const reports = require('./reports');
const { agreementsService, fleetService, dataStoreService, syncEngine } = require('../supabase/services');

/**
 * JARVIS Brain - The central orchestrator.
 *
 * Customer recognition: checks phone against agreements for existing customers.
 * Admin recognition: checks phone against bot_data_store admin list (5 admins).
 * Format: *bold headers* + ```monospace data```
 */
class JarvisBrain {
  constructor() {
    this.conversation = conversation;
    this.name = 'JARVIS';
  }

  async process(msg) {
    const { phone, body, type, media, name } = msg;

    // ─── Identify user: admin or customer? ────────────
    const isAdmin = syncEngine.isAdmin(phone);
    const isBoss = msg.isBoss || false;
    const existingCustomer = syncEngine.lookupCustomer(phone);
    const customerHistory = existingCustomer ? await agreementsService.getCustomerHistory(phone) : null;

    this.conversation.addMessage(phone, 'user', body || `[${type}]`, { name });

    if (existingCustomer) {
      this.conversation.setContext(phone, 'isExistingCustomer', true);
      this.conversation.setContext(phone, 'customerName', existingCustomer.customer_name);
      if (customerHistory) {
        this.conversation.setContext(phone, 'totalRentals', customerHistory.totalRentals);
        this.conversation.setContext(phone, 'activeRentals', customerHistory.activeRentals.length);
      }
    }

    const response = { text: null, voice: null, image: null, actions: [] };

    try {
      if (type === 'ptt' && media) {
        await this._handleVoice(msg, response, isAdmin, existingCustomer);
      } else if ((type === 'image' || type === 'sticker') && media) {
        await this._handleImage(msg, response, isAdmin);
      } else if (type === 'document' && media) {
        response.text = '*Document Received*\n```What would you like me to do with this file?```';
      } else {
        await this._handleText(msg, response, isAdmin, isBoss, existingCustomer, customerHistory);
      }

      if (response.text) {
        this.conversation.addMessage(phone, 'assistant', response.text);
      }
    } catch (err) {
      console.error(`[JARVIS] Error processing message from ${phone}:`, err.message);
      response.text = isAdmin
        ? `*Error:*\n\`\`\`${err.message}\`\`\``
        : 'Maaf, ada masalah teknikal. Sila hubungi kami terus.';
    }

    return response;
  }

  // ─── Text Handler ──────────────────────────────────────

  async _handleText(msg, response, isAdmin, isBoss, existingCustomer, customerHistory) {
    const { phone, body, name } = msg;
    const history = this.conversation.getHistory(phone);
    const conv = this.conversation.getOrCreate(phone);

    const command = this._parseCommand(body, isAdmin);
    if (command) return this._handleCommand(command, msg, response, isAdmin);

    if (this._isImageGenRequest(body)) {
      return this._handleImageGeneration(body, response);
    }

    const personalContext = this._buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory);

    const aiResult = await aiRouter.route(body, history, {
      isAdmin,
      systemPrompt: personalContext,
    });

    response.text = aiResult.content;
    response.tier = aiResult.tier;

    if (isAdmin && body.toLowerCase().includes('report')) {
      try {
        const voiceResult = await voiceEngine.speak(
          this._summarizeForVoice(aiResult.content),
          { language: conv.language || 'en' }
        );
        response.voice = voiceResult.filePath;
      } catch (err) {
        console.warn('[JARVIS] Voice generation failed:', err.message);
      }
    }
  }

  // ─── Voice Handler ─────────────────────────────────────

  async _handleVoice(msg, response, isAdmin, existingCustomer) {
    const { phone, media } = msg;

    const transcription = await voiceEngine.listen(media.data);
    console.log(`[JARVIS] Voice from ${phone}: "${transcription.text}"`);

    const textMsg = { ...msg, body: transcription.text, type: 'chat' };
    const customerHistory = existingCustomer ? await agreementsService.getCustomerHistory(phone) : null;
    await this._handleText(textMsg, response, isAdmin, msg.isBoss, existingCustomer, customerHistory);

    const conv = this.conversation.getOrCreate(phone);
    try {
      const voiceResult = await voiceEngine.speak(
        this._summarizeForVoice(response.text),
        { language: conv.language || transcription.language || 'en' }
      );
      response.voice = voiceResult.filePath;
    } catch (err) {
      console.warn('[JARVIS] Voice response failed:', err.message);
    }
  }

  // ─── Image Handler ─────────────────────────────────────

  async _handleImage(msg, response, isAdmin) {
    const { phone, media, body } = msg;
    const prompt = body || 'What do you see in this image? If there is a car plate, read it.';

    const analysis = await imageReader.analyze(media.data, prompt);
    response.text = `*Image Analysis:*\n\`\`\`${analysis.description}\`\`\``;

    if (analysis.text) {
      const plate = analysis.text.replace(/[^A-Z0-9]/gi, '').trim();
      if (plate.length >= 4) {
        const car = await fleetService.getCarByPlate(plate);
        if (car) {
          response.text += `\n\n*Car Found:*\n\`\`\`${car.make} ${car.model} ${car.year || ''}\nPlate: ${car.car_plate}\nStatus: ${car.status}\`\`\``;
          if (isAdmin) {
            const bookings = await agreementsService.getAgreementsByPlate(plate);
            if (bookings.length > 0) {
              const latest = bookings[0];
              response.text += `\n\n*Current Booking:*\n\`\`\`${latest.customer_name}\n${latest.start_date} → ${latest.end_date}\`\`\``;
            }
          }
        }
      }
    }
  }

  // ─── Image Generation ──────────────────────────────────

  async _handleImageGeneration(prompt, response) {
    response.text = '*Generating image...*\n```Please wait```';
    try {
      const cleanPrompt = prompt.replace(/^(generate|create|make|draw)\s*(an?|the)?\s*(image|picture|photo)\s*(of|about|for)?\s*/i, '');
      const result = await imageGenerator.generate(cleanPrompt);
      response.image = result.filePath;
      response.text = `*Image Generated*\n\`\`\`Engine: ${result.engine}\`\`\``;
    } catch (err) {
      response.text = `*Image Generation Failed*\n\`\`\`${err.message}\`\`\``;
    }
  }

  // ─── Commands ──────────────────────────────────────────

  _parseCommand(text, isAdmin) {
    if (!text) return null;
    const lower = text.toLowerCase().trim();

    if (lower === '/status' || lower === '/health') return { cmd: 'status' };
    if (lower === '/cars' || lower === '/fleet') return { cmd: 'fleet' };
    if (lower === '/bookings') return { cmd: 'bookings' };
    if (lower.startsWith('/search ')) return { cmd: 'search', arg: text.slice(8).trim() };
    if ((lower === '/report' || lower === '/daily') && isAdmin) return { cmd: 'report' };
    if (lower === '/earnings' && isAdmin) return { cmd: 'earnings' };
    if (lower === '/fleet-report' && isAdmin) return { cmd: 'fleet-report' };
    if (lower === '/help') return { cmd: 'help' };

    return null;
  }

  async _handleCommand(command, msg, response, isAdmin) {
    switch (command.cmd) {
      case 'status': {
        const stats = aiRouter.getStats();
        const convStats = this.conversation.getStats();
        response.text = `*JARVIS Status*\n\`\`\`\n` +
          `AI Queries: Local ${stats.local} | Cloud ${stats.cloud} | Fallback ${stats.fallback}\n` +
          `Active Chats: ${convStats.activeConversations}\n` +
          `\`\`\``;
        break;
      }
      case 'fleet': {
        const stats = await fleetService.getFleetStats();
        response.text = `*Fleet Overview*\n\`\`\`\n` +
          `Total: ${stats.total} cars\n` +
          `Available: ${stats.available}\n` +
          `Rented: ${stats.rented}\n` +
          `Maintenance: ${stats.maintenance}\n` +
          `\`\`\``;
        break;
      }
      case 'bookings': {
        const active = await agreementsService.getActiveAgreements();
        if (active.length === 0) {
          response.text = '*Active Bookings*\n```No active bookings```';
        } else {
          response.text = `*Active Bookings (${active.length})*\n\`\`\`\n` +
            active.map(a => `${a.car_plate} ${a.customer_name}\n  ${a.start_date} → ${a.end_date}`).join('\n') +
            `\n\`\`\``;
        }
        break;
      }
      case 'search': {
        const cars = await fleetService.searchCars(command.arg);
        const bookings = await agreementsService.getAgreementsByCustomerName(command.arg);
        const parts = [];
        if (cars.length) parts.push(`*Cars:*\n\`\`\`\n${cars.map(c => `${c.car_plate} ${c.make} ${c.model}`).join('\n')}\n\`\`\``);
        if (bookings.length) parts.push(`*Bookings:*\n\`\`\`\n${bookings.map(b => `${b.customer_name} - ${b.car_plate}`).join('\n')}\n\`\`\``);
        response.text = parts.length ? parts.join('\n') : `*Search*\n\`\`\`No results for "${command.arg}"\`\`\``;
        break;
      }
      case 'report': {
        response.text = await reports.dailySummary();
        break;
      }
      case 'fleet-report': {
        response.text = await reports.fleetReport();
        break;
      }
      case 'earnings': {
        response.text = await reports.earningsReport();
        break;
      }
      case 'help': {
        response.text = `*JARVIS Commands*\n\`\`\`\n` +
          `/cars — Fleet status\n` +
          `/bookings — Active bookings\n` +
          `/search <query> — Search cars/customers\n` +
          `\`\`\`\n` +
          (isAdmin ? `*Admin Commands:*\n\`\`\`\n` +
            `/report — Daily summary\n` +
            `/fleet-report — Fleet with validation\n` +
            `/earnings — Revenue report\n` +
            `/status — System health\n` +
            `\`\`\`\n` : '') +
          `\nOr just chat naturally — text, voice, and images!`;
        break;
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────

  _isImageGenRequest(text) {
    if (!text) return false;
    return /^(generate|create|make|draw)\s+(an?\s+)?(image|picture|photo)/i.test(text.toLowerCase());
  }

  _buildPersonalContext(phone, name, isAdmin, existingCustomer, customerHistory) {
    const parts = [];

    if (isAdmin) {
      parts.push('The user is an ADMIN. You can share sensitive data like earnings, customer details, and reports.');
      parts.push('Format responses with *bold headers* and ```monospace for data```.');
    } else {
      parts.push('The user is a CUSTOMER. Never share other customers\' details, internal notes, or admin data.');
      parts.push('Be friendly and use *bold* for headers and ```mono``` for pricing/details.');
    }

    if (existingCustomer) {
      parts.push(`This is a RETURNING customer: ${existingCustomer.customer_name}.`);
      if (customerHistory) {
        parts.push(`They have ${customerHistory.totalRentals} total rentals, spent RM${customerHistory.totalSpent.toFixed(2)}.`);
        if (customerHistory.activeRentals.length > 0) {
          const active = customerHistory.activeRentals[0];
          parts.push(`They have an ACTIVE rental: ${active.car_plate} (${active.car_description || ''}) ending ${active.end_date}.`);
        }
      }
    } else if (!isAdmin) {
      parts.push('This is a NEW customer. Welcome them warmly. Collect their name if possible.');
    }

    if (name) parts.push(`Their WhatsApp name is "${name}".`);

    return parts.join('\n');
  }

  _summarizeForVoice(text) {
    if (!text) return '';
    return text
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, '. ')
      .slice(0, 500);
  }
}

module.exports = new JarvisBrain();
