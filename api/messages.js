/**
 * GET /api/messages — Recent message log from bot.
 * Reads from bot_data_store key 'message_log'.
 * Query params:
 *   ?limit=50     — max messages to return (default 50)
 *   ?phone=60...  — filter by phone number
 *   ?role=admin   — filter by role (admin/customer)
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();
    const limit = Math.min(parseInt(req.query?.limit) || 50, 200);
    const phoneFilter = req.query?.phone || null;
    const roleFilter = req.query?.role || null;

    const { data, error } = await supabase
      .from('bot_data_store')
      .select('value, updated_at')
      .eq('key', 'message_log')
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    let messages = Array.isArray(data?.value) ? data.value : [];

    // Apply filters
    if (phoneFilter) {
      messages = messages.filter(m => m.phone && m.phone.includes(phoneFilter));
    }
    if (roleFilter) {
      messages = messages.filter(m => m.role === roleFilter);
    }

    // Apply limit
    messages = messages.slice(0, limit);

    res.json({
      total: messages.length,
      lastUpdate: data?.updated_at || null,
      messages,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
