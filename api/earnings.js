/**
 * GET /api/earnings — Revenue summary (today, this month, all time).
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.slice(0, 7) + '-01';

    // All non-deleted/cancelled agreements
    const { data: agreements, error } = await supabase
      .from('agreements')
      .select('id, customer_name, total_price, date_start, date_end, status, plate_number')
      .not('status', 'in', '("Deleted","Cancelled")')
      .order('date_start', { ascending: false })
      .limit(500);

    if (error) throw error;

    let todayEarnings = 0;
    let monthEarnings = 0;
    let totalEarnings = 0;
    let totalBookings = 0;

    for (const a of (agreements || [])) {
      const price = parseFloat(a.total_price) || 0;
      const start = (a.date_start || '').slice(0, 10);

      totalEarnings += price;
      totalBookings++;

      if (start === today) todayEarnings += price;
      if (start >= monthStart) monthEarnings += price;
    }

    // Unique customers
    const uniqueCustomers = new Set((agreements || []).map(a => a.customer_name)).size;

    res.json({
      today: todayEarnings,
      month: monthEarnings,
      total: totalEarnings,
      totalBookings,
      uniqueCustomers,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
