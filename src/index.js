const config = require('./config');
const { syncEngine } = require('./supabase/services');
const aiRouter = require('./ai/router');
const providers = require('./ai/providers');
const jarvis = require('./brain/jarvis');
const conversation = require('./brain/conversation');
const whatsapp = require('./channels/whatsapp');
const phone = require('./channels/phone');
const { display, camera, gpio } = require('./hardware');
const fs = require('fs');
const fileSafety = require('./utils/file-safety');

/**
 * JARVIS — JRV Car Rental AI Assistant
 *
 * OpenClaw-style architecture:
 * - Provider rotation with auto-failover (Kimi → Groq → Ollama)
 * - Workspace context injection (.agent/SOUL.md)
 * - Typing indicators (WhatsApp presence)
 * - Session metadata tracking (tokens, provider, response time)
 * - Self-healing health monitor (dead providers auto-recover)
 * - Agent loop: Receive → Typing → Process → Track → Respond
 * - Guaranteed response: JARVIS never goes silent
 */
async function boot() {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     JARVIS v2.0 — OpenClaw Edition     ║');
  console.log('║     JRV Car Rental AI Assistant         ║');
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

  // ─── 1. Start Supabase sync (await first sync to populate cache) ──
  console.log('[Boot] Starting Supabase sync...');
  const syncOk = await Promise.race([
    syncEngine.start(),
    new Promise(resolve => setTimeout(() => { console.warn('[Boot] Supabase sync taking >10s, continuing...'); resolve(false); }, 10000)),
  ]);
  if (!syncOk) console.warn('[Boot] Supabase sync incomplete — cache may be empty for first requests');

  // ─── 2. Initialize AI router (loads providers + SOUL.md) ──
  console.log('[Boot] Initializing AI engines (OpenClaw provider rotation)...');
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
    },
  });

  // ─── 5. Connect WhatsApp ──────────────────────────
  console.log('[Boot] Connecting to WhatsApp...');
  whatsapp.onReady = () => {
    gpio.setStatus('ready');
    display.showStatus({
      Status: 'Online',
      Mode: config.mode,
      AI: 'OpenClaw Provider Rotation',
      WhatsApp: 'Connected',
      Phone: phone.isEnabled() ? 'Enabled' : 'Disabled',
    });

    whatsapp.sendToAdmin('*JARVIS v2.0 Online — OpenClaw Edition*\n```\nProvider rotation: Kimi → Groq → Ollama\nWorkspace: .agent/SOUL.md loaded\nSelf-healing: 5-min health checks\nAll systems operational.\n```');
  };

  await whatsapp.init(async (msg) => {
    // ═══ OpenClaw Agent Loop ═══
    // Receive → Typing → Process → Track → Respond

    const startTime = Date.now();

    // ─── TYPING: Show "typing..." immediately ───
    whatsapp.sendTyping(msg.from).catch(() => {});

    try {
      // ─── PROCESS: Run through JARVIS brain ───
      const response = await jarvis.process(msg);

      // ─── TRACK: Session metadata (OpenClaw pattern) ───
      const responseMs = Date.now() - startTime;
      conversation.trackResponse(msg.phone, {
        provider: response.provider || response.tier,
        model: response.model,
        usage: response.usage,
        responseMs,
      });

      // ─── RESPOND: Clear typing and send ───
      whatsapp.clearTyping(msg.from).catch(() => {});

      if (response.text) {
        await msg.reply(response.text);
      }
      if (response.voice) {
        await msg.replyWithVoice(response.voice);
      }
      if (response.image) {
        await msg.replyWithImage(response.image, '');
      }

      // Log slow responses
      if (responseMs > 10000) {
        console.warn(`[JARVIS] Slow response: ${responseMs}ms for ${msg.phone}`);
      }

    } catch (err) {
      // ─── EMERGENCY: Even if everything fails, respond ───
      whatsapp.clearTyping(msg.from).catch(() => {});
      console.error(`[JARVIS] Fatal message processing error:`, err?.message || err);

      const isAdmin = syncEngine.isAdmin(msg.phone);
      const emergencyText = isAdmin
        ? `*JARVIS Error*\n\`\`\`${(err?.message || 'Unknown error').slice(0, 300)}\`\`\`\n\nBot is running. Try a /command.`
        : 'Maaf, sila hubungi +60126565477.\nSorry, please contact +60126565477.';

      try {
        await msg.reply(emergencyText);
      } catch {
        console.error('[JARVIS] Could not even send emergency response');
      }
    }
  });

  // ─── 6. Handle dashboard commands ───────────────────
  syncEngine.onCommand(async (command) => {
    if (command === 'relink') {
      console.log('[JARVIS] Re-linking WhatsApp...');
      try {
        await whatsapp.relink();
        console.log('[JARVIS] WhatsApp re-link initiated.');
      } catch (err) {
        console.error('[JARVIS] WhatsApp re-link failed:', err.message);
      }
    } else if (command === 'recheck-providers') {
      console.log('[JARVIS] Force re-checking all AI providers...');
      const status = await aiRouter.recheckProviders();
      console.log('[JARVIS] Provider status:', JSON.stringify(status.providers.map(p => `${p.name}: ${p.available ? 'OK' : 'DOWN'}`)));
    }
  });

  // ─── 7. Graceful shutdown ──────────────────────────
  const shutdown = async (signal) => {
    console.log(`\n[JARVIS] Shutting down (${signal})...`);
    gpio.setStatus('error');
    providers.destroy(); // Stop health check timers
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

  // ─── 8. Self-healing: Catch uncaught errors (don't crash) ───
  process.on('uncaughtException', (err) => {
    console.error('[JARVIS] Uncaught exception (NOT crashing):', err?.message || err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[JARVIS] Unhandled rejection (NOT crashing):', reason?.message || reason);
  });
}

boot().catch(err => {
  console.error('[JARVIS] Fatal boot error:', err);
  process.exit(1);
});
