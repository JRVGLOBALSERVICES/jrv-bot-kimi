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
    const phone = msg.from.replace('@c.us', '').replace('@g.us', '');
    const isGroup = msg.from.endsWith('@g.us');
    const isAdmin = config.admin.adminPhones.includes(phone) || phone === config.admin.bossPhone;

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
      isBoss: phone === config.admin.bossPhone,
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
