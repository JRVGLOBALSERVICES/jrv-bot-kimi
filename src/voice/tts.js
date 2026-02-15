const config = require('../config');
const fs = require('fs');
const path = require('path');
const jarvisVoice = require('./jarvis-voice');
const fileSafety = require('../utils/file-safety');
const cloudinary = require('../media/cloudinary');

/**
 * Text-to-Speech Engine with JARVIS Voice Profile
 *
 * Priority chain:
 * 1. Piper TTS (local on Jetson) — fast, offline, customizable
 * 2. msedge-tts (Node.js) — same Microsoft voices, NO Python needed
 *
 * Voice profiles defined in jarvis-voice.js:
 *   - jarvis: British male, slightly deep, calm (Iron Man style)
 *   - friday: Female assistant
 *   - casual: Friendly male
 */
class TTSEngine {
  constructor() {
    this.localUrl = config.tts.localUrl;
    this.edgeVoice = config.tts.edgeVoice;
    this.outputDir = config.paths.generated;
  }

  /**
   * Convert text to speech audio file.
   * Uses JARVIS voice profile by default.
   */
  async speak(text, options = {}) {
    const { language = 'en', speed = null } = options;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const outputPath = path.join(this.outputDir, `tts_${Date.now()}.mp3`);
    const voiceSpeed = speed || jarvisVoice.getSpeed();

    let result;
    try {
      result = await this._piperLocal(text, outputPath, language, voiceSpeed);
    } catch (localErr) {
      console.warn('[TTS] Local Piper failed:', localErr.message);
      try {
        result = await this._edgeTTSNode(text, outputPath, language, voiceSpeed);
      } catch (edgeErr) {
        console.error('[TTS] Edge TTS (Node) failed:', edgeErr.message);
        throw new Error(`Text-to-speech failed: ${edgeErr.message}`);
      }
    }

    // Upload to Cloudinary if available (keep local file for WhatsApp sending)
    if (cloudinary.isAvailable()) {
      try {
        const upload = await cloudinary.uploadVoice(outputPath);
        result.cloudUrl = upload.secureUrl;
        result.publicId = upload.publicId;
        console.log(`[TTS] Uploaded to Cloudinary: ${upload.secureUrl}`);
        // NOTE: Do NOT delete local file — WhatsApp needs it to send as voice note
      } catch (err) {
        console.warn('[TTS] Cloudinary upload failed, keeping local:', err.message);
      }
    }

    return result;
  }

  async _piperLocal(text, outputPath, language, speed) {
    const voice = language === 'ms' ? 'ms_MY-osman-medium' : 'en_US-amy-medium';

    const response = await fetch(`${this.localUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed, output_format: 'mp3' }),
    });

    if (!response.ok) {
      throw new Error(`Piper error ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fileSafety.safeWrite(outputPath, buffer);

    return {
      filePath: outputPath,
      duration: this._estimateDuration(text, speed),
      engine: 'piper-local',
    };
  }

  /**
   * Edge TTS via msedge-tts Node.js package.
   * No Python needed — pure JavaScript, same Microsoft voices.
   */
  async _edgeTTSNode(text, outputPath, language, speed) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

    const voice = jarvisVoice.getVoice(language);
    const pitch = jarvisVoice.getPitch();

    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    // Build rate string: e.g. "-5%" for speed 0.95
    const rateStr = speed !== 1.0 ? `${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '+0%';
    const pitchStr = pitch || '+0Hz';

    console.log(`[TTS] Edge TTS (Node.js): voice=${voice} rate=${rateStr} pitch=${pitchStr}`);

    const readable = tts.toStream(text, { rate: rateStr, pitch: pitchStr });

    // Collect audio chunks and write to file
    const chunks = [];
    await new Promise((resolve, reject) => {
      readable.on('data', (chunk) => {
        // msedge-tts emits objects with 'audio' buffer property
        if (chunk.audio) {
          chunks.push(chunk.audio);
        } else if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      });
      readable.on('end', resolve);
      readable.on('error', reject);
      // Timeout after 30 seconds
      setTimeout(() => reject(new Error('Edge TTS timed out')), 30000);
    });

    if (chunks.length === 0) {
      throw new Error('Edge TTS returned no audio data');
    }

    const audioBuffer = Buffer.concat(chunks);
    fs.writeFileSync(outputPath, audioBuffer);

    const stats = fs.statSync(outputPath);
    console.log(`[TTS] Generated ${stats.size} bytes: ${outputPath}`);

    return {
      filePath: outputPath,
      duration: this._estimateDuration(text, speed),
      engine: 'edge-tts-node',
      voice,
    };
  }

  _estimateDuration(text, speed) {
    const words = text.split(/\s+/).length;
    return Math.ceil((words / 150) * 60 / speed);
  }

  async isAvailable() {
    // Check Piper local server
    try {
      const res = await fetch(`${this.localUrl}/api/voices`);
      if (res.ok) return true;
    } catch {}

    // msedge-tts is always available (npm package)
    try {
      require('msedge-tts');
      return true;
    } catch {}

    return false;
  }
}

module.exports = new TTSEngine();
