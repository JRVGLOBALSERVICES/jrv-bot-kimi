const config = require('../config');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Speech-to-Text Engine
 *
 * Priority chain:
 * 1. Local Whisper server (HTTP API at localhost:8080) — if running
 * 2. faster-whisper subprocess (Python) — direct, no server needed
 * 3. Groq Whisper API (free cloud) — fallback
 */

const WHISPER_MODEL = process.env.WHISPER_MODEL || 'base';

class STTEngine {
  constructor() {
    this.whisperUrl = config.whisper.url;
    this.tmpDir = config.paths.tmp;
    this._fasterWhisperChecked = false;
    this._fasterWhisperOk = false;
  }

  /**
   * Transcribe audio buffer or file path to text.
   * @param {Buffer|string} audio - Audio buffer or file path
   * @param {string} language - Language hint ('ms' for Malay, 'en' for English)
   * @returns {{ text: string, language: string, duration: number }}
   */
  async transcribe(audio, language = 'auto') {
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }

    let audioPath;
    let cleanup = false;

    if (Buffer.isBuffer(audio)) {
      audioPath = path.join(this.tmpDir, `stt_${Date.now()}.ogg`);
      fs.writeFileSync(audioPath, audio);
      cleanup = true;
    } else {
      audioPath = audio;
    }

    // Convert to WAV 16kHz mono (Whisper prefers this)
    const wavPath = audioPath.replace(/\.[^.]+$/, '.wav');
    if (audioPath !== wavPath) {
      try {
        const suppress = process.platform === 'win32' ? ' 2>NUL' : ' 2>/dev/null';
        execSync(`ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y${suppress}`, { stdio: 'pipe' });
        if (cleanup) fs.unlinkSync(audioPath);
        audioPath = wavPath;
        cleanup = true;
      } catch {
        console.warn('[STT] ffmpeg not available — using original audio format');
      }
    }

    try {
      // 1. Try Whisper HTTP server (Jetson / dedicated server)
      const result = await this._whisperServer(audioPath, language);
      return result;
    } catch (serverErr) {
      console.warn('[STT] Whisper server failed:', serverErr.message);
      try {
        // 2. Try faster-whisper via Python subprocess (no server needed)
        const result = await this._whisperSubprocess(audioPath, language);
        return result;
      } catch (subErr) {
        console.warn('[STT] faster-whisper subprocess failed:', subErr.message);
        try {
          // 3. Try Groq Whisper API (free cloud)
          const result = await this._groqWhisper(audioPath, language);
          return result;
        } catch (cloudErr) {
          console.error('[STT] All engines failed:', cloudErr.message);
          throw new Error('Speech-to-text failed: no engines available');
        }
      }
    } finally {
      if (cleanup && fs.existsSync(audioPath)) {
        try { fs.unlinkSync(audioPath); } catch {}
      }
    }
  }

  /**
   * Engine 1: Whisper HTTP server (OpenAI-compatible API)
   */
  async _whisperServer(audioPath, language) {
    const formData = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    formData.append('file', new Blob([audioBuffer]), path.basename(audioPath));
    if (language !== 'auto') {
      formData.append('language', language);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(`${this.whisperUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Whisper server ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      language: data.language || language,
      duration: data.duration || 0,
      engine: 'whisper-server',
    };
  }

  /**
   * Engine 2: faster-whisper via Python subprocess
   * Calls the faster-whisper Python package directly — no server required.
   */
  async _whisperSubprocess(audioPath, language) {
    const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
    const absAudioPath = path.resolve(audioPath);
    const langArg = language !== 'auto' ? `"${language}"` : 'None';

    // Write Python script to temp file (avoids shell escaping issues)
    const pyScript = `
import sys, json
try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper not installed"}))
    sys.exit(1)

try:
    model = WhisperModel("${WHISPER_MODEL}", compute_type="int8", device="cpu")
    segments, info = model.transcribe(r"${absAudioPath.replace(/\\/g, '\\\\')}", language=${langArg})
    text = " ".join([s.text for s in segments]).strip()
    print(json.dumps({"text": text, "language": info.language, "duration": round(info.duration, 2)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`.trim();

    const scriptPath = path.join(this.tmpDir, `stt_whisper_${Date.now()}.py`);
    fs.writeFileSync(scriptPath, pyScript);

    try {
      console.log('[STT] Running faster-whisper subprocess...');
      const stdout = execSync(`${pyCmd} "${scriptPath}"`, {
        timeout: 120000, // 2 minutes (model download + transcription)
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });

      const data = JSON.parse(stdout.trim());
      if (data.error) {
        throw new Error(data.error);
      }

      console.log(`[STT] Transcribed (${data.duration}s): "${data.text.slice(0, 80)}..."`);
      return {
        text: data.text || '',
        language: data.language || language,
        duration: data.duration || 0,
        engine: 'faster-whisper',
      };
    } finally {
      try { fs.unlinkSync(scriptPath); } catch {}
    }
  }

  /**
   * Engine 3: Groq Whisper API (free cloud fallback)
   * Uses Groq's free whisper-large-v3 endpoint.
   * Requires GROQ_API_KEY env var.
   */
  async _groqWhisper(audioPath, language) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      throw new Error('GROQ_API_KEY not set — no cloud STT available');
    }

    const formData = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    formData.append('file', new Blob([audioBuffer]), path.basename(audioPath));
    formData.append('model', 'whisper-large-v3');
    if (language !== 'auto') {
      formData.append('language', language);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`Groq Whisper ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      language: data.language || language,
      duration: data.duration || 0,
      engine: 'groq-whisper',
    };
  }

  /**
   * Check if any STT engine is available.
   */
  async isAvailable() {
    // Check Whisper HTTP server
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.whisperUrl}/v1/models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return true;
    } catch {}

    // Check faster-whisper Python package
    if (!this._fasterWhisperChecked) {
      this._fasterWhisperChecked = true;
      try {
        const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
        execSync(`${pyCmd} -c "from faster_whisper import WhisperModel; print('ok')"`, {
          stdio: 'pipe',
          timeout: 10000,
        });
        this._fasterWhisperOk = true;
      } catch {
        this._fasterWhisperOk = false;
      }
    }
    if (this._fasterWhisperOk) return true;

    // Check Groq API key
    if (process.env.GROQ_API_KEY) return true;

    return false;
  }
}

module.exports = new STTEngine();
