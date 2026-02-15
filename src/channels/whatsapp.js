const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const fs = require('fs');
const path = require('path');

/**
 * WhatsApp Channel - Handles all WhatsApp messaging.
 * Receives: text, voice notes, images, documents, locations
 * Sends: text, voice notes, images, documents, locations, media from URLs
 */
class WhatsAppChannel {
  constructor() {
    this.client = null;
    this.ready = false;
    this.onMessage = null; // Callback: (msg) => {}
    this.onReady = null;
    // LID → phone mapping cache (WhatsApp LIDs are opaque identifiers)
    this._lidCache = new Map();
  }

  async init(onMessage) {
    this.onMessage = onMessage;

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: config.whatsapp.sessionName }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
      },
    });

    this.client.on('qr', (qr) => {
      console.log('[WhatsApp] Scan this QR code:');
      qrcode.generate(qr, { small: true });
      this._reportStatus('waiting_for_qr', { qr });
    });

    this.client.on('ready', () => {
      this.ready = true;
      console.log('[WhatsApp] Connected and ready!');
      this._reportStatus('connected');
      if (this.onReady) this.onReady();
    });

    this.client.on('message', async (msg) => {
      if (!this.onMessage) return;

      try {
        const parsed = await this._parseMessage(msg);
        await this.onMessage(parsed);
      } catch (err) {
        console.error('[WhatsApp] Message processing error:', err.message);
      }
    });

    this.client.on('disconnected', (reason) => {
      this.ready = false;
      console.warn('[WhatsApp] Disconnected:', reason);
      this._reportStatus('disconnected', { reason });
    });

    await this.client.initialize();
  }

  async _parseMessage(msg) {
    const contact = await msg.getContact();
    const chat = await msg.getChat();
    const isGroup = msg.from.endsWith('@g.us');

    // Extract real phone number — handle LID format (@lid) used by newer WhatsApp.
    // LIDs are opaque identifiers that DON'T correspond to phone numbers.
    // We must resolve the real phone from contact properties.
    const isLid = msg.from.endsWith('@lid');
    const lidId = isLid ? msg.from.replace('@lid', '') : null;
    let phone = msg.from.replace('@c.us', '').replace('@g.us', '').replace('@lid', '');

    if (isLid) {
      let resolved = false;

      // 1. Check LID cache first
      if (this._lidCache.has(lidId)) {
        phone = this._lidCache.get(lidId);
        resolved = true;
      }

      // 2. Try contact.number (whatsapp-web.js userid field)
      if (!resolved && contact.number) {
        phone = contact.number.replace(/\D/g, '');
        this._lidCache.set(lidId, phone);
        resolved = true;
        console.log(`[WhatsApp] LID resolved via contact.number: ${lidId} → ${phone}`);
      }

      // 3. Try contact.id.user
      if (!resolved && contact.id?.user && !contact.id.user.includes('@')) {
        const idUser = contact.id.user.replace(/\D/g, '');
        // Only use if it looks like a phone number (starts with country code)
        if (idUser.length >= 10 && /^[1-9]/.test(idUser)) {
          phone = idUser;
          this._lidCache.set(lidId, phone);
          resolved = true;
          console.log(`[WhatsApp] LID resolved via contact.id.user: ${lidId} → ${phone}`);
        }
      }

      // 4. Try getNumberId() API call
      if (!resolved) {
        try {
          const numberId = await this.client.getNumberId(contact.id._serialized);
          if (numberId?.user) {
            phone = numberId.user.replace(/\D/g, '');
            this._lidCache.set(lidId, phone);
            resolved = true;
            console.log(`[WhatsApp] LID resolved via getNumberId: ${lidId} → ${phone}`);
          }
        } catch (e) {
          // getNumberId may not work for all contacts
        }
      }

      if (!resolved) {
        console.warn(`[WhatsApp] Could not resolve LID ${lidId} to phone number. Admin detection may fail.`);
      }
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const bossPhone = (config.admin.bossPhone || '').replace(/\D/g, '');

    const isAdmin = config.admin.adminPhones.some(p => {
      const cp = p.replace(/\D/g, '');
      return cp && cleanPhone && (cp.includes(cleanPhone) || cleanPhone.includes(cp));
    }) || (bossPhone && cleanPhone && (bossPhone.includes(cleanPhone) || cleanPhone.includes(bossPhone)));

    const isBoss = bossPhone && cleanPhone && (bossPhone === cleanPhone || bossPhone.includes(cleanPhone) || cleanPhone.includes(bossPhone));

    if (isLid) {
      console.log(`[WhatsApp] Phone: ${phone}, isAdmin: ${isAdmin}, isBoss: ${isBoss}, LID: ${lidId}`);
    }

    const parsed = {
      id: msg.id._serialized,
      from: msg.from,
      phone,
      name: contact.pushname || contact.name || phone,
      body: msg.body || '',
      type: msg.type, // 'chat', 'ptt' (voice), 'image', 'document', 'video', 'sticker', 'location'
      isGroup,
      groupName: isGroup ? chat.name : null,
      isAdmin,
      isBoss,
      timestamp: msg.timestamp,
      hasMedia: msg.hasMedia,
      media: null,
      location: null,
      reply: async (text) => this.sendText(msg.from, text),
      replyWithVoice: async (audioPath) => this.sendVoice(msg.from, audioPath),
      replyWithImage: async (imagePath, caption) => this.sendImage(msg.from, imagePath, caption),
    };

    // Parse location if present
    if (msg.type === 'location' || msg.type === 'live_location') {
      parsed.location = {
        latitude: msg.location?.latitude || null,
        longitude: msg.location?.longitude || null,
        description: msg.location?.description || '',
        name: msg.body || '',
        address: msg.location?.address || '',
      };
    }

    // Download media if present
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          parsed.media = {
            mimetype: media.mimetype,
            data: Buffer.from(media.data, 'base64'),
            filename: media.filename,
          };
        }
      } catch (err) {
        console.warn('[WhatsApp] Media download failed:', err.message);
      }
    }

    return parsed;
  }

  // ─── Send Methods ─────────────────────────────────────

  async sendText(to, text) {
    if (!this.ready) throw new Error('WhatsApp not connected');
    await this.client.sendMessage(to, text);
  }

  async sendVoice(to, audioPath) {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const media = MessageMedia.fromFilePath(audioPath);
    await this.client.sendMessage(to, media, { sendAudioAsVoice: true });
  }

  async sendImage(to, imagePath, caption = '') {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const media = MessageMedia.fromFilePath(imagePath);
    await this.client.sendMessage(to, media, { caption });
  }

  async sendDocument(to, filePath, filename) {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const media = MessageMedia.fromFilePath(filePath);
    await this.client.sendMessage(to, media, {
      sendMediaAsDocument: true,
      filename: filename || path.basename(filePath),
    });
  }

  /**
   * Send a location pin to a chat.
   * @param {string} to - Chat ID
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {string} description - Location description
   */
  async sendLocation(to, lat, lng, description = '') {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const Location = require('whatsapp-web.js').Location;
    const loc = new Location(lat, lng, description);
    await this.client.sendMessage(to, loc);
  }

  /**
   * Send media from a URL (e.g., Cloudinary).
   * Downloads the URL content and sends as WhatsApp media.
   * @param {string} to - Chat ID
   * @param {string} url - Media URL
   * @param {string} caption - Optional caption
   * @param {boolean} asDocument - Send as document instead of inline
   */
  async sendMediaFromUrl(to, url, caption = '', asDocument = false) {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
    await this.client.sendMessage(to, media, {
      caption,
      sendMediaAsDocument: asDocument,
    });
  }

  /**
   * Send media from a Buffer directly.
   * @param {string} to - Chat ID
   * @param {Buffer} buffer - Media data
   * @param {string} mimetype - MIME type (e.g., 'image/jpeg')
   * @param {string} filename - Filename
   * @param {string} caption - Optional caption
   */
  async sendMediaBuffer(to, buffer, mimetype, filename, caption = '') {
    if (!this.ready) throw new Error('WhatsApp not connected');
    const b64 = buffer.toString('base64');
    const media = new MessageMedia(mimetype, b64, filename);
    await this.client.sendMessage(to, media, { caption });
  }

  async sendToAdmin(text) {
    if (config.admin.bossPhone) {
      await this.sendText(`${config.admin.bossPhone}@c.us`, text);
    }
  }

  /**
   * Forward media buffer to superadmin.
   * @param {Buffer} buffer - Media data
   * @param {string} mimetype - MIME type
   * @param {string} filename - Filename
   * @param {string} caption - Caption with context
   */
  async forwardMediaToAdmin(buffer, mimetype, filename, caption = '') {
    const superadminChatId = `${config.admin.adminPhones[0] || config.admin.bossPhone}@c.us`;
    if (!this.ready) {
      console.log(`[WhatsApp] Would forward media to admin: ${filename} - ${caption.slice(0, 100)}`);
      return;
    }
    const b64 = buffer.toString('base64');
    const media = new MessageMedia(mimetype, b64, filename);
    await this.client.sendMessage(superadminChatId, media, { caption });
  }

  /**
   * Report WhatsApp connection status to Supabase for the dashboard.
   */
  async _reportStatus(status, extras = {}) {
    try {
      const supabase = require('../supabase/client');
      await supabase.from('bot_data_store').upsert({
        key: 'whatsapp_status',
        value: { status, ...extras, timestamp: new Date().toISOString() },
        created_by: 'jarvis',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    } catch (err) {
      // Non-critical — don't crash WhatsApp for status report failure
    }
  }

  /**
   * Force re-link WhatsApp — destroys current session and re-initializes.
   * This triggers a new QR code which gets written to Supabase for the dashboard.
   */
  async relink() {
    console.log('[WhatsApp] Force re-link requested. Destroying session...');
    this.ready = false;
    this._reportStatus('relinking');

    // Destroy current client
    if (this.client) {
      try {
        await this.client.logout();
      } catch (e) {
        console.warn('[WhatsApp] Logout failed (may already be disconnected):', e.message);
      }
      try {
        await this.client.destroy();
      } catch (e) {
        console.warn('[WhatsApp] Destroy failed:', e.message);
      }
      this.client = null;
    }

    // Delete stored session so a fresh QR is generated
    const sessionDir = `.wwebjs_auth/session-${config.whatsapp.sessionName}`;
    const fs = require('fs');
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log('[WhatsApp] Deleted old session data.');
    }

    // Re-initialize — this will generate a new QR code
    console.log('[WhatsApp] Re-initializing for new QR code...');
    await this.init(this.onMessage);
  }

  isConnected() {
    return this.ready;
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy();
      this.ready = false;
    }
  }
}

module.exports = new WhatsAppChannel();
