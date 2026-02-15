/**
 * JARVIS Voice Profile - Iron Man-style AI voice for TTS.
 *
 * Voice profiles for different TTS engines:
 * 1. Edge TTS: Uses Microsoft Azure Neural voices
 *    - JARVIS style: en-US-GuyNeural (deep, confident male voice)
 *    - Malay: ms-MY-OsmanNeural (male, clear)
 * 2. Piper TTS (local): Custom voice models
 * 3. ElevenLabs (premium): Clone custom JARVIS voice
 *
 * The Iron Man JARVIS voice characteristics:
 * - Male, British-accented, calm and confident
 * - Slightly formal but warm
 * - Clear enunciation, measured pace
 * - Professional assistant tone
 */

const VOICE_PROFILES = {
  // Default JARVIS voice (Iron Man style)
  jarvis: {
    name: 'JARVIS',
    edgeTTS: {
      en: 'en-GB-RyanNeural',      // British male - closest to JARVIS
      ms: 'ms-MY-OsmanNeural',     // Malay male
      zh: 'zh-CN-YunxiNeural',     // Chinese male
      ta: 'ta-IN-ValluvarNeural',   // Tamil male
    },
    speed: 0.95,  // Slightly slower for gravitas
    pitch: '-5%', // Slightly deeper
    style: 'professional',
    intro: 'At your service, sir.',
  },

  // Female assistant voice
  friday: {
    name: 'FRIDAY',
    edgeTTS: {
      en: 'en-US-JennyNeural',
      ms: 'ms-MY-YasminNeural',
      zh: 'zh-CN-XiaoxiaoNeural',
      ta: 'ta-IN-PallaviNeural',
    },
    speed: 1.0,
    pitch: '0%',
    style: 'friendly',
    intro: 'Hello! How can I help?',
  },

  // Casual/friendly voice
  casual: {
    name: 'Casual',
    edgeTTS: {
      en: 'en-US-DavisNeural',
      ms: 'ms-MY-OsmanNeural',
      zh: 'zh-CN-YunjianNeural',
      ta: 'ta-IN-ValluvarNeural',
    },
    speed: 1.05,
    pitch: '0%',
    style: 'casual',
    intro: 'Hey! What\'s up?',
  },
};

class JarvisVoice {
  constructor() {
    this.activeProfile = 'jarvis';
    this.profiles = VOICE_PROFILES;
  }

  /**
   * Get the current voice profile.
   */
  getProfile() {
    return this.profiles[this.activeProfile] || this.profiles.jarvis;
  }

  /**
   * Switch voice profile.
   */
  setProfile(name) {
    if (this.profiles[name]) {
      this.activeProfile = name;
      return true;
    }
    return false;
  }

  /**
   * Get Edge TTS voice name for a language.
   */
  getVoice(language = 'en') {
    const profile = this.getProfile();
    const lang = this._mapLanguage(language);
    return profile.edgeTTS[lang] || profile.edgeTTS.en;
  }

  /**
   * Get speed setting.
   */
  getSpeed() {
    return this.getProfile().speed;
  }

  /**
   * Get pitch setting for SSML.
   */
  getPitch() {
    return this.getProfile().pitch;
  }

  /**
   * Build Edge TTS command with JARVIS voice settings.
   */
  buildEdgeCommand(text, outputPath, language = 'en') {
    const voice = this.getVoice(language);
    const speed = this.getSpeed();
    const rateStr = speed !== 1.0 ? `--rate=${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%` : '';

    // Escape text for shell
    const safeText = text.replace(/"/g, '\\"').replace(/\n/g, ' ');

    return `edge-tts --voice "${voice}" ${rateStr} --text "${safeText}" --write-media "${outputPath}" 2>/dev/null`;
  }

  /**
   * Add JARVIS-style prefix to response for voice.
   */
  formatForVoice(text, isGreeting = false) {
    const profile = this.getProfile();

    if (isGreeting && profile.intro) {
      return `${profile.intro} ${text}`;
    }

    // Clean markdown formatting for natural speech
    return text
      .replace(/\*([^*]+)\*/g, '$1')         // Remove bold
      .replace(/```[\s\S]*?```/g, '')         // Remove code blocks
      .replace(/`([^`]+)`/g, '$1')            // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links → text only
      .replace(/#{1,6}\s/g, '')                // Remove headers
      .replace(/\n{2,}/g, '. ')               // Double newlines → period
      .replace(/\n/g, '. ')                   // Single newlines → period
      .replace(/\.\s*\./g, '.')               // Remove double periods
      .trim()
      .slice(0, 500); // Limit for TTS
  }

  /**
   * Available voices list.
   */
  listProfiles() {
    return Object.entries(this.profiles).map(([key, p]) => ({
      id: key,
      name: p.name,
      style: p.style,
      active: key === this.activeProfile,
    }));
  }

  _mapLanguage(lang) {
    if (!lang) return 'en';
    const l = lang.toLowerCase();
    if (l.startsWith('ms') || l.startsWith('my') || l === 'malay') return 'ms';
    if (l.startsWith('zh') || l === 'chinese') return 'zh';
    if (l.startsWith('ta') || l === 'tamil') return 'ta';
    return 'en';
  }
}

module.exports = new JarvisVoice();
