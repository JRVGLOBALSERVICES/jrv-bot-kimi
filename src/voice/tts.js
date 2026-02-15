const config = require('../config');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const jarvisVoice = require('./jarvis-voice');

/**
 * Text-to-Speech Engine with JARVIS Voice Profile
 *
 * Priority chain:
 * 1. Piper TTS (local on Jetson) — fast, offline, customizable
 * 2. Edge TTS (free Microsoft TTS) — Iron Man JARVIS voice (en-GB-RyanNeural)
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

    try {
      const result = await this._piperLocal(text, outputPath, language, voiceSpeed);
      return result;
    } catch (localErr) {
      console.warn('[TTS] Local Piper failed:', localErr.message);
      try {
        const result = await this._edgeTTS(text, outputPath, language, voiceSpeed);
        return result;
      } catch (edgeErr) {
        console.error('[TTS] All TTS engines failed:', edgeErr.message);
        throw new Error('Text-to-speech failed: no engines available');
      }
    }
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
    fs.writeFileSync(outputPath, buffer);

    return {
      filePath: outputPath,
      duration: this._estimateDuration(text, speed),
      engine: 'piper-local',
    };
  }

  async _edgeTTS(text, outputPath, language, speed) {
    // Use JARVIS voice profile for voice selection
    const voice = jarvisVoice.getVoice(language);
    const rateStr = speed !== 1.0 ? `--rate=${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '';

    try {
      execSync(
        `edge-tts --voice "${voice}" ${rateStr} --text "${text.replace(/"/g, '\\"')}" --write-media "${outputPath}" 2>/dev/null`,
        { timeout: 30000 }
      );
    } catch {
      // Try Python edge-tts as fallback
      const pyScript = `
import edge_tts, asyncio
async def main():
    communicate = edge_tts.Communicate("${text.replace(/"/g, '\\"')}", "${voice}")
    await communicate.save("${outputPath}")
asyncio.run(main())
      `.trim();
      const pyPath = path.join(this.outputDir, 'tts_temp.py');
      fs.writeFileSync(pyPath, pyScript);
      execSync(`python3 "${pyPath}" 2>/dev/null`, { timeout: 30000 });
      fs.unlinkSync(pyPath);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('Edge TTS produced no output');
    }

    return {
      filePath: outputPath,
      duration: this._estimateDuration(text, speed),
      engine: 'edge-tts',
      voice,
    };
  }

  _estimateDuration(text, speed) {
    const words = text.split(/\s+/).length;
    return Math.ceil((words / 150) * 60 / speed);
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.localUrl}/api/voices`);
      return res.ok;
    } catch {
      try {
        execSync('which edge-tts 2>/dev/null || which python3 2>/dev/null');
        return true;
      } catch {
        return false;
      }
    }
  }
}

module.exports = new TTSEngine();
