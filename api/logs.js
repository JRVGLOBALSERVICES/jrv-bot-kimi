/**
 * GET /api/logs — Recent bot activity from bot_data_store.
 * Shows recent status changes, control commands, and config updates.
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    // Fetch all bot-related entries ordered by most recent
    const { data, error } = await supabase
      .from('bot_data_store')
      .select('key, value, updated_at, created_by')
      .or('key.eq.bot_status,key.eq.whatsapp_status,key.eq.bot_control,key.eq.bot_config,key.like.bot_log:%')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Parse into activity entries
    const activities = (data || []).map(row => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
    }));

    // Also get the latest heartbeat age
    const statusRow = activities.find(a => a.key === 'bot_status');
    const whatsappRow = activities.find(a => a.key === 'whatsapp_status');
    const controlRow = activities.find(a => a.key === 'bot_control');
    const configRow = activities.find(a => a.key === 'bot_config');

    res.json({
      activities,
      status: {
        bot: statusRow ? { ...statusRow.value, lastUpdate: statusRow.updatedAt } : null,
        whatsapp: whatsappRow ? { ...whatsappRow.value, lastUpdate: whatsappRow.updatedAt } : null,
        lastControl: controlRow ? { ...controlRow.value, lastUpdate: controlRow.updatedAt } : null,
        config: configRow ? { ...configRow.value, lastUpdate: configRow.updatedAt } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
