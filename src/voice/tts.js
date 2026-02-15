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

  async _edgeTTS(text, outputPath, language, speed) {
    // Use JARVIS voice profile for voice selection
    const voice = jarvisVoice.getVoice(language);
    const pitch = jarvisVoice.getPitch();
    const rateStr = speed !== 1.0 ? `--rate=${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '';
    const pitchStr = pitch && pitch !== '0%' ? `--pitch=${pitch}` : '';
    const isWin = process.platform === 'win32';
    // Clean text for shell: remove quotes and newlines
    const safeText = text.replace(/['"]/g, '').replace(/\n/g, ' ').replace(/[`$\\]/g, '');

    let cliError = null;
    try {
      // Try edge-tts CLI directly
      const cmd = `edge-tts --voice "${voice}" ${rateStr} ${pitchStr} --text "${safeText}" --write-media "${outputPath}"`.replace(/\s{2,}/g, ' ');
      console.log(`[TTS] Running: ${cmd.slice(0, 120)}...`);
      execSync(cmd, { timeout: 30000, stdio: 'pipe' });
    } catch (err) {
      cliError = err.stderr ? err.stderr.toString().slice(0, 200) : err.message;
      console.warn(`[TTS] edge-tts CLI failed: ${cliError}`);

      // Fallback: use Python edge_tts module directly
      const pyCmd = isWin ? 'python' : 'python3';
      // Write text to a temp file to avoid shell escaping issues
      const textPath = path.join(this.outputDir, 'tts_input.txt');
      fs.writeFileSync(textPath, text, 'utf8');

      const pyPitch = pitch && pitch !== '0%' ? `, pitch="${pitch}"` : '';
      const pyRate = speed !== 1.0 ? `, rate="${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%"` : '';
      const pyScript = `
import edge_tts, asyncio, sys

async def main():
    with open(r"${textPath}", "r", encoding="utf-8") as f:
        text = f.read()
    communicate = edge_tts.Communicate(text, "${voice}"${pyRate}${pyPitch})
    await communicate.save(r"${outputPath}")
    print("OK", file=sys.stderr)

asyncio.run(main())
`.trim();
      const pyPath = path.join(this.outputDir, 'tts_temp.py');
      fs.writeFileSync(pyPath, pyScript);
      try {
        console.log(`[TTS] Trying Python fallback: ${pyCmd} ${pyPath}`);
        const result = execSync(`${pyCmd} "${pyPath}"`, { timeout: 30000, stdio: 'pipe' });
        console.log(`[TTS] Python edge-tts output: ${result.toString().slice(0, 100)}`);
      } catch (pyErr) {
        const pyErrMsg = pyErr.stderr ? pyErr.stderr.toString().slice(0, 300) : pyErr.message;
        console.error(`[TTS] Python edge-tts also failed: ${pyErrMsg}`);
        throw new Error(`Edge TTS failed. CLI: ${cliError}. Python: ${pyErrMsg}`);
      } finally {
        try { fs.unlinkSync(pyPath); } catch {}
        try { fs.unlinkSync(textPath); } catch {}
      }
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error(`Edge TTS produced no output file at ${outputPath}. CLI error: ${cliError || 'none'}`);
    }

    const stats = fs.statSync(outputPath);
    console.log(`[TTS] Generated ${stats.size} bytes: ${outputPath}`);

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
