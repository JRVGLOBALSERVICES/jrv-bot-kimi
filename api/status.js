/**
 * GET /api/status — Bot status and WhatsApp connection info.
 * Reads from bot_data_store where the bot writes its heartbeat.
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    // Read bot status (heartbeat written by the bot)
    const { data: statusRow } = await supabase
      .from('bot_data_store')
      .select('value, updated_at')
      .eq('key', 'bot_status')
      .single();

    // Read last control command
    const { data: controlRow } = await supabase
      .from('bot_data_store')
      .select('value, updated_at')
      .eq('key', 'bot_control')
      .single();

    // Read WhatsApp QR/status
    const { data: waRow } = await supabase
      .from('bot_data_store')
      .select('value, updated_at')
      .eq('key', 'whatsapp_status')
      .single();

    const botStatus = statusRow?.value || {};
    const updatedAt = statusRow?.updated_at;
    const isOnline = updatedAt && (Date.now() - new Date(updatedAt).getTime()) < 5 * 60 * 1000;

    res.json({
      online: isOnline,
      lastHeartbeat: updatedAt,
      bot: botStatus,
      whatsapp: waRow?.value || { status: 'unknown' },
      lastCommand: controlRow?.value || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
