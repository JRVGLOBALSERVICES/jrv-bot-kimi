/**
 * GET /api/pricing — Pricing and delivery zones from bot_data_store.
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    const { data, error } = await supabase
      .from('bot_data_store')
      .select('key, value')
      .or('key.like.%pricing%,key.like.%delivery%,key.eq.all_pricing_updated_v2,key.eq.delivery_zones');

    if (error) throw error;

    let pricing = null;
    let deliveryZones = null;

    for (const row of (data || [])) {
      if (row.key === 'all_pricing_updated_v2' || row.key.includes('pricing')) {
        pricing = row.value;
      }
      if (row.key === 'delivery_zones' || row.key.includes('delivery')) {
        deliveryZones = row.value;
      }
    }

    res.json({ pricing, deliveryZones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
