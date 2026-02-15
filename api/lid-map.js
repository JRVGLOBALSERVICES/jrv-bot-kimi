/**
 * GET  /api/lid-map — List all LID→phone mappings.
 * POST /api/lid-map — Add/update a mapping: { lid, phone }
 * DELETE /api/lid-map — Remove a mapping: { lid }
 *
 * LID mappings let the bot recognize WhatsApp users who send messages
 * from opaque @lid identifiers (instead of @c.us phone-based IDs).
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

const LID_MAP_KEY = 'lid_phone_map';

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    if (req.method === 'GET') {
      const { data } = await supabase
        .from('bot_data_store')
        .select('value, updated_at')
        .eq('key', LID_MAP_KEY)
        .single();

      const map = (data?.value && typeof data.value === 'object') ? data.value : {};
      return res.json({
        mappings: Object.entries(map).map(([lid, phone]) => ({ lid, phone })),
        total: Object.keys(map).length,
        updatedAt: data?.updated_at || null,
      });
    }

    if (req.method === 'POST') {
      const { lid, phone } = req.body || {};
      if (!lid || !phone) {
        return res.status(400).json({ error: 'Both lid and phone are required' });
      }

      const cleanLid = lid.trim().replace('@lid', '');
      const cleanPhone = phone.trim().replace(/\D/g, '');

      if (cleanPhone.length < 10) {
        return res.status(400).json({ error: 'Phone number too short (need 10+ digits)' });
      }

      // Read existing
      const { data } = await supabase
        .from('bot_data_store')
        .select('value')
        .eq('key', LID_MAP_KEY)
        .single();

      const map = (data?.value && typeof data.value === 'object') ? { ...data.value } : {};
      map[cleanLid] = cleanPhone;

      const { error } = await supabase.from('bot_data_store').upsert({
        key: LID_MAP_KEY,
        value: map,
        created_by: 'dashboard',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      if (error) throw error;

      return res.json({ success: true, lid: cleanLid, phone: cleanPhone, total: Object.keys(map).length });
    }

    if (req.method === 'DELETE') {
      const { lid } = req.body || {};
      if (!lid) {
        return res.status(400).json({ error: 'lid is required' });
      }

      const cleanLid = lid.trim().replace('@lid', '');

      const { data } = await supabase
        .from('bot_data_store')
        .select('value')
        .eq('key', LID_MAP_KEY)
        .single();

      const map = (data?.value && typeof data.value === 'object') ? { ...data.value } : {};
      delete map[cleanLid];

      const { error } = await supabase.from('bot_data_store').upsert({
        key: LID_MAP_KEY,
        value: map,
        created_by: 'dashboard',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

      if (error) throw error;

      return res.json({ success: true, deleted: cleanLid, total: Object.keys(map).length });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
