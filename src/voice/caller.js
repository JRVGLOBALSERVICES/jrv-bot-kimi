/**
 * Voice Caller - WhatsApp and SIP calling for JARVIS.
 *
 * Capabilities:
 * 1. WhatsApp voice calls (via whatsapp-web.js - limited support)
 * 2. SIP/VoIP calls (for normal phone lines via SIP provider)
 * 3. Call scheduling (ring customer at specific time)
 *
 * Note: WhatsApp Web API has limited call support.
 * For full calling, a SIP provider (e.g., Twilio, Vonage) is needed.
 */

const config = require('../config');
const jarvisVoice = require('./jarvis-voice');
const tts = require('./tts');
const notifications = require('../brain/notifications');

class VoiceCaller {
  constructor() {
    this.whatsapp = null;
    this.callLog = [];
    this.scheduledCalls = [];
    this.checkInterval = null;
  }

  init(whatsappChannel) {
    this.whatsapp = whatsappChannel;
  }

  start() {
    if (this.checkInterval) return;
    // Check scheduled calls every minute
    this.checkInterval = setInterval(() => this._checkScheduled(), 60 * 1000);
    console.log('[Caller] Voice caller ready');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Send voice message via WhatsApp (voice note, not call).
   * This is the most reliable way to send audio via WhatsApp Web.
   */
  async sendVoiceMessage(phone, text, language = 'en') {
    try {
      // Generate TTS audio
      const voice = jarvisVoice.getVoice(language);
      const cleanText = jarvisVoice.formatForVoice(text);
      const audioResult = await tts.speak(cleanText, {
        language,
        speed: jarvisVoice.getSpeed(),
      });

      if (this.whatsapp && this.whatsapp.isConnected && this.whatsapp.isConnected()) {
        // Send as voice note
        const chatId = `${phone}@c.us`;
        const fs = require('fs');
        const audioBuffer = fs.readFileSync(audioResult.filePath);

        // whatsapp-web.js sendMessage with media
        const { MessageMedia } = require('whatsapp-web.js');
        const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'));
        await this.whatsapp.sendMessage(chatId, media, { sendAudioAsVoice: true });

        this._log(phone, 'voice_message', 'sent', cleanText);

        // Cleanup temp file
        try { fs.unlinkSync(audioResult.filePath); } catch {}

        return { success: true, type: 'voice_message', phone };
      }

      // Dev mode - just log
      console.log(`[Caller] Voice message to ${phone}: "${cleanText.slice(0, 100)}..."`);
      this._log(phone, 'voice_message', 'logged', cleanText);
      return { success: true, type: 'voice_message_logged', phone };

    } catch (err) {
      console.error(`[Caller] Voice message to ${phone} failed:`, err.message);
      this._log(phone, 'voice_message', 'failed', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Schedule a call/voice message for later.
   */
  scheduleCall(phone, text, dueAt, language = 'en', createdBy = null) {
    const call = {
      id: this.scheduledCalls.length + 1,
      phone,
      text,
      dueAt: new Date(dueAt),
      language,
      createdBy,
      status: 'scheduled',
    };
    this.scheduledCalls.push(call);
    console.log(`[Caller] Scheduled call #${call.id} to ${phone} at ${call.dueAt.toISOString()}`);
    return call;
  }

  /**
   * Auto-call customers with expiring rentals.
   */
  async callExpiringCustomer(agreement, daysLeft) {
    const phone = agreement.customer_phone;
    if (!phone) return;

    const text = daysLeft <= 1
      ? `Hello ${agreement.customer_name}. This is JARVIS from JRV Car Rental. ` +
        `Your rental ends tomorrow. Please arrange to return the car or contact us to extend. ` +
        `Call us at plus 60 1 2 6 5 6 5 4 7 7. Thank you.`
      : `Hello ${agreement.customer_name}. This is JARVIS from JRV Car Rental. ` +
        `Your rental ends in ${daysLeft} days on ${agreement.end_date}. ` +
        `Would you like to extend? Please let us know. Thank you.`;

    return this.sendVoiceMessage(phone, text, 'en');
  }

  /**
   * Get call log.
   */
  getLog(limit = 20) {
    return this.callLog.slice(-limit);
  }

  /**
   * Get scheduled calls.
   */
  getScheduled() {
    return this.scheduledCalls.filter(c => c.status === 'scheduled');
  }

  // ─── Internal ──────────────────────────────────────────

  async _checkScheduled() {
    const now = new Date();

    for (const call of this.scheduledCalls) {
      if (call.status !== 'scheduled') continue;
      if (now < call.dueAt) continue;

      call.status = 'executing';
      try {
        await this.sendVoiceMessage(call.phone, call.text, call.language);
        call.status = 'completed';
      } catch (err) {
        call.status = 'failed';
        console.error(`[Caller] Scheduled call #${call.id} failed:`, err.message);
      }
    }
  }

  _log(phone, type, status, detail) {
    this.callLog.push({
      phone,
      type,
      status,
      detail: detail?.slice(0, 200),
      timestamp: new Date(),
    });

    // Keep last 100 entries
    if (this.callLog.length > 100) {
      this.callLog = this.callLog.slice(-100);
    }
  }
}

module.exports = new VoiceCaller();
