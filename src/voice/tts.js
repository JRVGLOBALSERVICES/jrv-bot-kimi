const config = require('../config');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Text-to-Speech Engine
 *
 * Priority chain:
 * 1. Piper TTS (local on Jetson) — fast, offline, customizable voice
 * 2. Edge TTS (free Microsoft TTS) — good quality, needs internet
 */
class TTSEngine {
  constructor() {
    this.localUrl = config.tts.localUrl;
    this.edgeVoice = config.tts.edgeVoice;
    this.outputDir = config.paths.generated;
  }

  /**
   * Convert text to speech audio file.
   * @param {string} text - Text to speak
   * @param {object} options
   * @param {string} options.voice - Voice name/id
   * @param {string} options.language - 'ms' or 'en'
   * @param {number} options.speed - Speech rate (0.5 to 2.0)
   * @returns {{ filePath: string, duration: number, engine: string }}
   */
  async speak(text, options = {}) {
    const { language = 'ms', speed = 1.0 } = options;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const outputPath = path.join(this.outputDir, `tts_${Date.now()}.mp3`);

    try {
      // Try Piper TTS (local) first
      const result = await this._piperLocal(text, outputPath, language, speed);
      return result;
    } catch (localErr) {
      console.warn('[TTS] Local Piper failed:', localErr.message);
      try {
        // Fallback to Edge TTS
        const result = await this._edgeTTS(text, outputPath, language, speed);
        return result;
      } catch (edgeErr) {
        console.error('[TTS] All TTS engines failed:', edgeErr.message);
        throw new Error('Text-to-speech failed: no engines available');
      }
    }
  }

  async _piperLocal(text, outputPath, language, speed) {
    // Piper TTS server (local HTTP API)
    const voice = language === 'ms' ? 'ms_MY-osman-medium' : 'en_US-amy-medium';

    const response = await fetch(`${this.localUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice,
        speed,
        output_format: 'mp3',
      }),
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
    // Edge TTS via command line (edge-tts npm or Python package)
    const voice = language === 'ms' ? 'ms-MY-YasminNeural' : 'en-US-JennyNeural';
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
    };
  }

  _estimateDuration(text, speed) {
    // Rough estimate: ~150 words per minute at speed 1.0
    const words = text.split(/\s+/).length;
    return Math.ceil((words / 150) * 60 / speed);
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.localUrl}/api/voices`);
      return res.ok;
    } catch {
      // Check if edge-tts CLI exists
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
