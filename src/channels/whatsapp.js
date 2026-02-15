const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');
const fs = require('fs');
const path = require('path');

/**
 * WhatsApp Channel - Handles all WhatsApp messaging.
 * Receives: text, voice notes, images, documents
 * Sends: text, voice notes, images, documents
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
    });

    this.client.on('ready', () => {
      this.ready = true;
      console.log('[WhatsApp] Connected and ready!');
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
      type: msg.type, // 'chat', 'ptt' (voice), 'image', 'document', 'video', 'sticker'
      isGroup,
      groupName: isGroup ? chat.name : null,
      isAdmin,
      isBoss: phone === config.admin.bossPhone,
      timestamp: msg.timestamp,
      hasMedia: msg.hasMedia,
      media: null,
      reply: async (text) => this.sendText(msg.from, text),
      replyWithVoice: async (audioPath) => this.sendVoice(msg.from, audioPath),
      replyWithImage: async (imagePath, caption) => this.sendImage(msg.from, imagePath, caption),
    };

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

  async sendToAdmin(text) {
    if (config.admin.bossPhone) {
      await this.sendText(`${config.admin.bossPhone}@c.us`, text);
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
