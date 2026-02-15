/**
 * POST /api/control — Kill switch and bot control.
 * Writes commands to bot_data_store that the bot polls.
 *
 * GET  /api/control — Read current bot status and last command.
 * POST /api/control — Send command: { command: 'kill' | 'restart' | 'pause' | 'resume' }
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

const CONTROL_KEY = 'bot_control';
const STATUS_KEY = 'bot_status';

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    if (req.method === 'GET') {
      // Read current status and last command
      const { data: controlRow } = await supabase
        .from('bot_data_store')
        .select('value, updated_at')
        .eq('key', CONTROL_KEY)
        .single();

      const { data: statusRow } = await supabase
        .from('bot_data_store')
        .select('value, updated_at')
        .eq('key', STATUS_KEY)
        .single();

      return res.json({
        lastCommand: controlRow?.value || null,
        lastCommandAt: controlRow?.updated_at || null,
        botStatus: statusRow?.value || null,
        botStatusAt: statusRow?.updated_at || null,
      });
    }

    if (req.method === 'POST') {
      const { command } = req.body || {};
      const validCommands = ['kill', 'restart', 'pause', 'resume'];

      if (!validCommands.includes(command)) {
        return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
      }

      const value = {
        command,
        timestamp: new Date().toISOString(),
        source: 'dashboard',
      };

      // Upsert to bot_data_store
      const { error } = await supabase
        .from('bot_data_store')
        .upsert({
          key: CONTROL_KEY,
          value,
          created_by: 'dashboard',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      if (error) throw error;

      return res.json({ success: true, command, timestamp: value.timestamp });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
