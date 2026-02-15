const config = require('../config');
const { execSync } = require('child_process');
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

    let result;
    try {
      result = await this._piperLocal(text, outputPath, language, voiceSpeed);
    } catch (localErr) {
      console.warn('[TTS] Local Piper failed:', localErr.message);
      try {
        result = await this._edgeTTS(text, outputPath, language, voiceSpeed);
      } catch (edgeErr) {
        console.error('[TTS] All TTS engines failed:', edgeErr.message);
        throw new Error('Text-to-speech failed: no engines available');
      }
    }

    // Upload to Cloudinary if available
    if (cloudinary.isAvailable()) {
      try {
        const upload = await cloudinary.uploadVoice(outputPath);
        result.cloudUrl = upload.secureUrl;
        result.publicId = upload.publicId;
        console.log(`[TTS] Uploaded to Cloudinary: ${upload.secureUrl}`);
        // Clean up local file after successful upload
        try { fs.unlinkSync(outputPath); } catch {}
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

  async _edgeTTS(text, outputPath, language, speed) {
    // Use JARVIS voice profile for voice selection
    const voice = jarvisVoice.getVoice(language);
    const rateStr = speed !== 1.0 ? `--rate=${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '';
    const isWin = process.platform === 'win32';
    const suppress = isWin ? ' 2>NUL' : ' 2>/dev/null';
    const safeText = text.replace(/"/g, '\\"').replace(/\n/g, ' ');

    try {
      execSync(
        `edge-tts --voice "${voice}" ${rateStr} --text "${safeText}" --write-media "${outputPath}"${suppress}`,
        { timeout: 30000, stdio: 'pipe' }
      );
    } catch {
      // Try Python edge-tts as fallback
      const pyCmd = isWin ? 'python' : 'python3';
      const pyScript = `
import edge_tts, asyncio
async def main():
    communicate = edge_tts.Communicate("${safeText}", "${voice}")
    await communicate.save(r"${outputPath}")
asyncio.run(main())
      `.trim();
      const pyPath = path.join(this.outputDir, 'tts_temp.py');
      fs.writeFileSync(pyPath, pyScript);
      try {
        execSync(`${pyCmd} "${pyPath}"`, { timeout: 30000, stdio: 'pipe' });
      } finally {
        if (fs.existsSync(pyPath)) fs.unlinkSync(pyPath);
      }
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('Edge TTS produced no output. Install with: pip install edge-tts');
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
        const findCmd = process.platform === 'win32' ? 'where' : 'which';
        execSync(`${findCmd} edge-tts`, { stdio: 'pipe' });
        return true;
      } catch {
        try {
          const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
          execSync(`${pyCmd} -c "import edge_tts"`, { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      }
    }
  }
}

module.exports = new TTSEngine();
