require('dotenv').config();

const config = {
  // Runtime mode: 'jetson' or 'laptop'
  mode: process.env.RUNTIME_MODE || 'laptop',

  // Supabase
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
  },

  // Kimi K2 (cloud API - complex tasks)
  // Get key: https://platform.moonshot.ai
  // Models: kimi-k2.5 (best), kimi-k2-0905-preview (fast), kimi-k2-thinking (reasoning)
  kimi: {
    apiKey: process.env.KIMI_API_KEY,
    apiUrl: process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1',
    model: process.env.KIMI_MODEL || 'kimi-k2.5',
    thinkingModel: process.env.KIMI_THINKING_MODEL || 'kimi-k2-thinking',
  },

  // Groq (fast cloud AI - free tier)
  // Get key: https://console.groq.com
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    apiUrl: process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },

  // Cloud provider selection: 'kimi' or 'groq'
  cloudProvider: process.env.CLOUD_PROVIDER || 'kimi',

  // Google Gemini (fallback cloud AI)
  // Get key: https://aistudio.google.com/apikey
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  },

  // Local AI (Ollama on Jetson - simple tasks)
  localAI: {
    url: process.env.LOCAL_AI_URL || 'http://localhost:11434',
    model: process.env.LOCAL_AI_MODEL || 'llama3.1:8b',
  },

  // Whisper (local STT)
  whisper: {
    url: process.env.LOCAL_WHISPER_URL || 'http://localhost:8080',
  },

  // TTS
  tts: {
    localUrl: process.env.LOCAL_TTS_URL || 'http://localhost:5500',
    edgeVoice: process.env.EDGE_TTS_VOICE || 'ms-MY-YasminNeural',
  },

  // WhatsApp
  whatsapp: {
    sessionName: process.env.WHATSAPP_SESSION_NAME || 'jrv-jarvis',
  },

  // SIP/Phone
  sip: {
    server: process.env.SIP_SERVER,
    username: process.env.SIP_USERNAME,
    password: process.env.SIP_PASSWORD,
    callerId: process.env.SIP_CALLER_ID,
    enabled: !!process.env.SIP_SERVER,
  },

  // Admin
  admin: {
    bossPhone: process.env.BOSS_PHONE,
    bossName: process.env.BOSS_NAME || 'Boss',
    adminPhones: (process.env.ADMIN_PHONES || '').split(',').filter(Boolean),
  },

  // Cloudinary (media storage)
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || 'jrv_voice',
    enabled: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
  },

  // Web Search (gives JARVIS internet access)
  // Tavily: https://tavily.com — 1000 free/month, best for AI agents
  // Brave: https://brave.com/search/api — 2000 free/month
  search: {
    tavilyKey: process.env.TAVILY_API_KEY || null,
    braveKey: process.env.BRAVE_API_KEY || null,
  },

  // Paths
  paths: {
    cache: './cache',
    recordings: './recordings',
    generated: './generated',
    tmp: './tmp',
  },
};

// Validate required config
const missing = [];
if (!config.supabase.url) missing.push('SUPABASE_URL');
if (!config.supabase.key) missing.push('SUPABASE_KEY');
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// Warn about optional but recommended keys
if (!config.kimi.apiKey || config.kimi.apiKey === 'placeholder') {
  console.warn('[Config] KIMI_API_KEY not set. Cloud AI will use Gemini fallback or local only.');
}
if (!config.gemini.apiKey) {
  console.warn('[Config] GEMINI_API_KEY not set. No Gemini fallback available.');
}
if (!config.cloudinary.enabled) {
  console.warn('[Config] Cloudinary not configured. Media will be stored locally only.');
}

module.exports = config;
