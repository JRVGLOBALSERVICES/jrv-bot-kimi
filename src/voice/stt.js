const config = require('../config');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Speech-to-Text Engine
 *
 * Priority chain:
 * 1. Local Whisper (faster-whisper on Jetson) — FREE, fast
 * 2. Kimi K2 audio transcription (cloud) — fallback
 */
class STTEngine {
  constructor() {
    this.whisperUrl = config.whisper.url;
    this.tmpDir = config.paths.tmp;
  }

  /**
   * Transcribe audio buffer or file path to text.
   * @param {Buffer|string} audio - Audio buffer or file path
   * @param {string} language - Language hint ('ms' for Malay, 'en' for English)
   * @returns {{ text: string, language: string, duration: number }}
   */
  async transcribe(audio, language = 'auto') {
    // Ensure tmp directory exists
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }

    let audioPath;
    let cleanup = false;

    if (Buffer.isBuffer(audio)) {
      // Write buffer to temp file
      audioPath = path.join(this.tmpDir, `stt_${Date.now()}.ogg`);
      fs.writeFileSync(audioPath, audio);
      cleanup = true;
    } else {
      audioPath = audio;
    }

    // Convert to WAV if needed (Whisper prefers WAV 16kHz mono)
    const wavPath = audioPath.replace(/\.[^.]+$/, '.wav');
    if (audioPath !== wavPath) {
      try {
        const suppress = process.platform === 'win32' ? ' 2>NUL' : ' 2>/dev/null';
        execSync(`ffmpeg -i "${audioPath}" -ar 16000 -ac 1 -f wav "${wavPath}" -y${suppress}`, { stdio: 'pipe' });
        if (cleanup) fs.unlinkSync(audioPath);
        audioPath = wavPath;
        cleanup = true;
      } catch {
        // If ffmpeg fails, try with original format
        console.warn('[STT] ffmpeg not available — using original audio format');
      }
    }

    try {
      // Try local Whisper first
      const result = await this._whisperLocal(audioPath, language);
      return result;
    } catch (localErr) {
      console.warn('[STT] Local Whisper failed:', localErr.message);
      try {
        // Fallback to Kimi K2 audio endpoint
        const result = await this._kimiTranscribe(audioPath, language);
        return result;
      } catch (cloudErr) {
        console.error('[STT] All engines failed:', cloudErr.message);
        throw new Error('Speech-to-text failed: no engines available');
      }
    } finally {
      if (cleanup && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }

  async _whisperLocal(audioPath, language) {
    const formData = new FormData();
    const audioBuffer = fs.readFileSync(audioPath);
    formData.append('file', new Blob([audioBuffer]), path.basename(audioPath));
    if (language !== 'auto') {
      formData.append('language', language);
    }

    const response = await fetch(`${this.whisperUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Whisper error ${response.status}`);
    }

    const data = await response.json();
    return {
      text: data.text || '',
      language: data.language || language,
      duration: data.duration || 0,
      engine: 'whisper-local',
    };
  }

  async _kimiTranscribe(audioPath, language) {
    // Kimi K2 doesn't have a native audio endpoint yet.
    // Could integrate Groq Whisper (free) or OpenAI Whisper API.
    throw new Error(
      'Cloud transcription not configured. ' +
      'Voice notes require a local Whisper server at ' + this.whisperUrl + '. ' +
      'Install: pip install faster-whisper, then run a compatible server.'
    );
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.whisperUrl}/v1/models`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

module.exports = new STTEngine();
