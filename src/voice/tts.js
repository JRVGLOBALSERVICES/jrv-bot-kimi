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
        throw new Error('Text-to-speech failed: no engines available\nFix: pip install edge-tts');
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
    const voice = jarvisVoice.getVoice(language);
    const pitch = jarvisVoice.getPitch();
    const isWin = process.platform === 'win32';

    // Write text to file to avoid all shell escaping issues
    const textPath = path.join(this.outputDir, `tts_input_${Date.now()}.txt`);
    fs.writeFileSync(textPath, text, 'utf8');

    const pyPitch = pitch && pitch !== '0%' ? `, pitch="${pitch}"` : '';
    const pyRate = speed !== 1.0 ? `, rate="${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%"` : '';
    const pyScript = `
import edge_tts, asyncio, sys

async def main():
    with open(r"${textPath.replace(/\\/g, '\\\\')}", "r", encoding="utf-8") as f:
        text = f.read()
    communicate = edge_tts.Communicate(text, "${voice}"${pyRate}${pyPitch})
    await communicate.save(r"${outputPath.replace(/\\/g, '\\\\')}")
    print("OK")

asyncio.run(main())
`.trim();
    const pyPath = path.join(this.outputDir, `tts_${Date.now()}.py`);
    fs.writeFileSync(pyPath, pyScript);

    // Find Python: try multiple common paths
    const pyCmds = isWin
      ? ['python', 'python3', 'py', 'py -3']
      : ['python3', 'python'];

    let lastErr = null;
    for (const pyCmd of pyCmds) {
      try {
        console.log(`[TTS] Running: ${pyCmd} "${pyPath}"`);
        execSync(`${pyCmd} "${pyPath}"`, {
          timeout: 30000,
          stdio: 'pipe',
          encoding: 'utf-8',
          // Inherit full user PATH on Windows so PM2 can find Python
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });

        // Clean up temp files
        try { fs.unlinkSync(pyPath); } catch {}
        try { fs.unlinkSync(textPath); } catch {}

        // Verify output file exists
        if (!fs.existsSync(outputPath)) {
          throw new Error('Edge TTS produced no output file');
        }

        const stats = fs.statSync(outputPath);
        console.log(`[TTS] Generated ${stats.size} bytes with ${pyCmd}: ${outputPath}`);

        return {
          filePath: outputPath,
          duration: this._estimateDuration(text, speed),
          engine: 'edge-tts',
          voice,
        };
      } catch (err) {
        lastErr = err.stderr || err.message;
        console.warn(`[TTS] ${pyCmd} failed: ${String(lastErr).slice(0, 200)}`);
      }
    }

    // All Python commands failed — try edge-tts CLI as last resort
    try {
      const safeText = text.replace(/['"]/g, '').replace(/\n/g, ' ').replace(/[`$\\]/g, '');
      const rateStr = speed !== 1.0 ? `--rate=${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '';
      const pitchStr = pitch && pitch !== '0%' ? `--pitch=${pitch}` : '';
      const cmd = `edge-tts --voice "${voice}" ${rateStr} ${pitchStr} --text "${safeText}" --write-media "${outputPath}"`.replace(/\s{2,}/g, ' ');
      execSync(cmd, { timeout: 30000, stdio: 'pipe' });
    } catch (cliErr) {
      // Clean up
      try { fs.unlinkSync(pyPath); } catch {}
      try { fs.unlinkSync(textPath); } catch {}
      throw new Error(`Edge TTS failed.\nPython: ${String(lastErr).slice(0, 200)}\nCLI: ${cliErr.message.slice(0, 200)}`);
    }

    try { fs.unlinkSync(pyPath); } catch {}
    try { fs.unlinkSync(textPath); } catch {}

    if (!fs.existsSync(outputPath)) {
      throw new Error('Edge TTS produced no output file');
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
    // Check Piper local server
    try {
      const res = await fetch(`${this.localUrl}/api/voices`);
      if (res.ok) return true;
    } catch {}

    // Check edge-tts Python module
    const pyCmds = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];
    for (const py of pyCmds) {
      try {
        execSync(`${py} -c "import edge_tts"`, { stdio: 'pipe', timeout: 5000 });
        return true;
      } catch {}
    }

    // Check edge-tts CLI
    try {
      const findCmd = process.platform === 'win32' ? 'where' : 'which';
      execSync(`${findCmd} edge-tts`, { stdio: 'pipe' });
      return true;
    } catch {}

    return false;
  }
}

module.exports = new TTSEngine();
