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
  // Models: kimi-k2-0905-preview, kimi-k2.5, kimi-k2-thinking
  kimi: {
    apiKey: process.env.KIMI_API_KEY,
    apiUrl: process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1',
    model: process.env.KIMI_MODEL || 'kimi-k2-0905-preview',
    thinkingModel: process.env.KIMI_THINKING_MODEL || 'kimi-k2-thinking',
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
if (!config.kimi.apiKey) missing.push('KIMI_API_KEY');
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

module.exports = config;
