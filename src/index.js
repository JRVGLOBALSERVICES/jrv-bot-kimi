const config = require('./config');
const { syncEngine } = require('./supabase/services');
const aiRouter = require('./ai/router');
const jarvis = require('./brain/jarvis');
const whatsapp = require('./channels/whatsapp');
const phone = require('./channels/phone');
const { display, camera, gpio } = require('./hardware');
const fs = require('fs');
const fileSafety = require('./utils/file-safety');

/**
 * JARVIS - JRV Car Rental AI Assistant
 * Main entry point. Boots all systems and connects channels.
 */
async function boot() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     JARVIS v1.0 — JRV Car Rental      ║');
  console.log('║     AI Assistant (Kimi K2 + Local)     ║');
  console.log(`║     Mode: ${config.mode.padEnd(29)}║`);
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  // Create required directories
  for (const dir of Object.values(config.paths)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ─── 0. File Safety Protocol ─────────────────────
  console.log('[Boot] File safety protocol active (.backups/ + .trash/)');
  console.log(`[Boot] Safety audit log: ${fileSafety.getLog().length} entries`);

  // ─── 1. Start Supabase sync ────────────────────────
  console.log('[Boot] Starting Supabase sync...');
  syncEngine.start();

  // Wait for initial sync
  await new Promise(resolve => setTimeout(resolve, 3000));

  // ─── 2. Initialize AI router ──────────────────────
  console.log('[Boot] Initializing AI engines...');
  await aiRouter.init();

  // ─── 3. Initialize hardware (Jetson or laptop stubs) ──
  console.log('[Boot] Initializing hardware...');
  await Promise.all([camera.init(), gpio.init()]);
  gpio.setStatus('busy');

  // ─── 4. Initialize phone bridge ───────────────────
  console.log('[Boot] Initializing phone bridge...');
  await phone.init({
    onIncomingCall: async (call) => {
      console.log(`[Phone] Incoming call from ${call.from}`);
      call.answer();
      // Handle voice call through JARVIS
    },
  });

  // ─── 5. Connect WhatsApp ──────────────────────────
  console.log('[Boot] Connecting to WhatsApp...');
  whatsapp.onReady = () => {
    gpio.setStatus('ready');
    display.showStatus({
      Status: 'Online',
      Mode: config.mode,
      AI: 'Kimi K2 + Local',
      WhatsApp: 'Connected',
      Phone: phone.isEnabled() ? 'Enabled' : 'Disabled',
    });

    // Notify boss
    whatsapp.sendToAdmin('*JARVIS Online*\n```System booted successfully. All systems operational.```');
  };

  await whatsapp.init(async (msg) => {
    // Process every incoming WhatsApp message through JARVIS
    const response = await jarvis.process(msg);

    // Send text response
    if (response.text) {
      await msg.reply(response.text);
    }

    // Send voice response
    if (response.voice) {
      await msg.replyWithVoice(response.voice);
    }

    // Send image response
    if (response.image) {
      await msg.replyWithImage(response.image, '');
    }
  });

  // ─── Cleanup on exit ──────────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n[JARVIS] Shutting down (${signal})...`);
    gpio.setStatus('error');
    syncEngine.stop();
    await whatsapp.destroy();
    await phone.destroy();
    await camera.destroy();
    await gpio.destroy();
    console.log('[JARVIS] Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

boot().catch(err => {
  console.error('[JARVIS] Fatal boot error:', err);
  process.exit(1);
});
