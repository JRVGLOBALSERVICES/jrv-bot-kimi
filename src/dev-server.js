/**
 * Dev Server - Run JARVIS on your laptop for testing.
 * Provides a web UI to simulate WhatsApp messages.
 *
 * Run: npm run dev
 * Open: http://localhost:3000
 */
const express = require('express');
const config = require('./config');
const { syncEngine } = require('./supabase/services');
const aiRouter = require('./ai/router');
const jarvis = require('./brain/jarvis');
const reports = require('./brain/reports');
const policies = require('./brain/policies');
const notifications = require('./brain/notifications');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ─── Chat endpoint (simulates WhatsApp) ──────────────

app.post('/api/chat', async (req, res) => {
  const { phone, message, name, isAdmin } = req.body;

  const msg = {
    id: `dev_${Date.now()}`,
    from: `${phone}@c.us`,
    phone: phone || '60123456789',
    name: name || 'Dev User',
    body: message,
    type: 'chat',
    isGroup: false,
    isAdmin: isAdmin || false,
    isBoss: false,
    timestamp: Date.now(),
    hasMedia: false,
    media: null,
    reply: async () => {},
    replyWithVoice: async () => {},
    replyWithImage: async () => {},
  };

  const response = await jarvis.process(msg);
  res.json(response);
});

// ─── Report endpoints ────────────────────────────────

app.get('/api/report/daily', async (req, res) => {
  const report = await reports.dailySummary();
  res.json({ text: report });
});

app.get('/api/report/fleet', async (req, res) => {
  const report = await reports.fleetReport();
  res.json({ text: report });
});

app.get('/api/report/earnings', async (req, res) => {
  const report = await reports.earningsReport();
  res.json({ text: report });
});

// New report endpoints (6 formats from bot_data_store)
app.get('/api/report/sorted-time', async (req, res) => {
  const report = await reports.sortedByTime();
  res.json({ text: report });
});

app.get('/api/report/sorted-contact', async (req, res) => {
  const report = await reports.sortedByContact();
  res.json({ text: report });
});

app.get('/api/report/sorted-timeslot', async (req, res) => {
  const report = await reports.sortedByTimeslot();
  res.json({ text: report });
});

app.get('/api/report/followup', async (req, res) => {
  const report = await reports.followUpReport();
  res.json({ text: report });
});

app.get('/api/report/available', async (req, res) => {
  const report = await reports.availableReport();
  res.json({ text: report });
});

app.get('/api/report/summary', async (req, res) => {
  const report = await reports.summaryReport();
  res.json({ text: report });
});

// ─── Data endpoints ──────────────────────────────────

app.get('/api/cache', (req, res) => {
  const cache = syncEngine.getCache();
  res.json({
    lastSync: cache.lastSync,
    cars: cache.cars.length,
    agreements: cache.agreements.length,
    customers: cache.customers.length,
    mismatches: cache.mismatches,
  });
});

app.get('/api/status', async (req, res) => {
  res.json({
    mode: config.mode,
    ai: aiRouter.getStats(),
    conversations: jarvis.conversation.getStats(),
    sync: {
      lastSync: syncEngine.getCache().lastSync,
      cars: syncEngine.getCache().cars.length,
    },
  });
});

app.get('/api/pricing', (req, res) => {
  res.json(policies.pricing);
});

app.get('/api/admins', (req, res) => {
  res.json(policies.admins);
});

// ─── Dev Web UI ──────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>JARVIS Dev Console</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', monospace; background: #0a0a0a; color: #00ff41; padding: 20px; }
    h1 { color: #00ff41; margin-bottom: 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    #chat { height: 500px; overflow-y: auto; border: 1px solid #00ff41; padding: 15px; margin-bottom: 15px; background: #0d0d0d; }
    .msg { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
    .msg.user { color: #00bfff; border-left: 3px solid #00bfff; padding-left: 10px; }
    .msg.bot { color: #00ff41; border-left: 3px solid #00ff41; padding-left: 10px; }
    .msg.system { color: #888; font-style: italic; }
    .input-row { display: flex; gap: 10px; }
    input { flex: 1; padding: 10px; background: #1a1a1a; color: #00ff41; border: 1px solid #00ff41; font-family: inherit; font-size: 14px; }
    button { padding: 10px 20px; background: #00ff41; color: #0a0a0a; border: none; cursor: pointer; font-family: inherit; font-weight: bold; }
    button:hover { background: #00cc33; }
    .controls { margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap; }
    .controls button { background: #1a1a1a; color: #00ff41; border: 1px solid #00ff41; font-size: 12px; padding: 5px 10px; }
    .controls button:hover { background: #00ff41; color: #0a0a0a; }
    .meta { color: #555; font-size: 11px; }
    pre { white-space: pre-wrap; }
    .phone-row { margin-bottom: 10px; display: flex; gap: 10px; align-items: center; }
    .phone-row input { max-width: 200px; }
    .phone-row label { font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>// JARVIS Dev Console</h1>
    <div class="phone-row">
      <label>Phone:</label>
      <input id="phone" value="60123456789" placeholder="+60...">
      <label>Name:</label>
      <input id="userName" value="Dev User" placeholder="Name">
      <label><input type="checkbox" id="adminMode" checked> Admin</label>
    </div>
    <div class="controls">
      <button onclick="send('/help')">Help</button>
      <button onclick="send('/cars')">Fleet</button>
      <button onclick="send('/available')">Available</button>
      <button onclick="send('/bookings')">Bookings</button>
      <button onclick="send('/pricing')">Pricing</button>
      <button onclick="send('/report')">Summary</button>
      <button onclick="send('/report1')">By Time</button>
      <button onclick="send('/report2')">By Contact</button>
      <button onclick="send('/report3')">Timeslots</button>
      <button onclick="send('/report4')">Follow-up</button>
      <button onclick="send('/report5')">Available</button>
      <button onclick="send('/report6')">Full Summary</button>
      <button onclick="send('/earnings')">Earnings</button>
      <button onclick="send('/expiring')">Expiring</button>
      <button onclick="send('/overdue')">Overdue</button>
      <button onclick="send('/status')">Status</button>
    </div>
    <div id="chat"></div>
    <div class="input-row">
      <input id="input" placeholder="Type a message or command..." onkeypress="if(event.key==='Enter')send()">
      <button onclick="send()">Send</button>
    </div>
  </div>
  <script>
    const chat = document.getElementById('chat');
    const input = document.getElementById('input');

    function addMsg(text, type) {
      const div = document.createElement('div');
      div.className = 'msg ' + type;
      div.innerHTML = '<pre>' + text + '</pre>';
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    }

    async function send(msg) {
      const text = msg || input.value.trim();
      if (!text) return;
      input.value = '';
      addMsg('You: ' + text, 'user');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: document.getElementById('phone').value,
            message: text,
            name: document.getElementById('userName').value,
            isAdmin: document.getElementById('adminMode').checked,
          }),
        });
        const data = await res.json();
        if (data.text) addMsg('JARVIS: ' + data.text, 'bot');
        if (data.intent) addMsg('[intent: ' + data.intent + (data.tier ? ' | tier: ' + data.tier : '') + ']', 'system');
      } catch (err) {
        addMsg('Error: ' + err.message, 'system');
      }
    }

    addMsg('JARVIS Dev Console ready. Type a message or use the buttons above.', 'system');
    addMsg('Tip: Uncheck "Admin" to test customer view (no plates, no admin data).', 'system');
  </script>
</body>
</html>`);
});

// ─── Boot ────────────────────────────────────────────

async function start() {
  console.log('[Dev Server] Starting in laptop mode...');

  // Start sync
  syncEngine.start();
  await new Promise(r => setTimeout(r, 2000));

  // Init AI
  await aiRouter.init();

  // Init notifications (no WhatsApp in dev mode - logs to console)
  notifications.init(null);
  console.log('[Dev Server] Notifications: console-only mode (no WhatsApp)');

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[Dev Server] JARVIS running at http://localhost:${PORT}`);
    console.log('[Dev Server] Open in browser to test chat');
    console.log('[Dev Server] Admin phone numbers:', policies.admins.list.map(a => `${a.name}(${a.phone})`).join(', '));
  });
}

start().catch(err => {
  console.error('[Dev Server] Fatal:', err);
  process.exit(1);
});
