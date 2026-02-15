const stt = require('./stt');
const tts = require('./tts');

/**
 * Voice Engine - Unified voice interface.
 * Handles both directions: audio→text and text→audio.
 */
class VoiceEngine {
  constructor() {
    this.stt = stt;
    this.tts = tts;
  }

  /**
   * Process incoming voice note: transcribe then optionally respond with voice.
   * @param {Buffer} audioBuffer - Raw audio from WhatsApp/phone
   * @param {string} language - Language hint
   * @returns {{ text: string, language: string, duration: number }}
   */
  async listen(audioBuffer, language = 'auto') {
    return this.stt.transcribe(audioBuffer, language);
  }

  /**
   * Generate voice response.
   * @param {string} text - Text to speak
   * @param {object} options - TTS options
   * @returns {{ filePath: string, duration: number, engine: string }}
   */
  async speak(text, options = {}) {
    return this.tts.speak(text, options);
  }

  /**
   * Full voice conversation turn: listen → (get AI response) → speak
   * The AI response part is handled externally by the JARVIS brain.
   * This just handles the audio I/O.
   */
  async voiceTurn(audioBuffer, responseText, options = {}) {
    const transcription = await this.listen(audioBuffer);
    const voiceResponse = await this.speak(responseText, options);
    return {
      userSaid: transcription.text,
      responseAudio: voiceResponse.filePath,
      duration: voiceResponse.duration,
    };
  }

  async getStatus() {
    const [sttOk, ttsOk] = await Promise.all([
      this.stt.isAvailable(),
      this.tts.isAvailable(),
    ]);
    return { stt: sttOk, tts: ttsOk };
  }
}

module.exports = new VoiceEngine();
