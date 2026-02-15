/**
 * GET /api/bookings — Active bookings, expiring, and overdue.
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();
    const today = new Date().toISOString().split('T')[0];

    // Active agreements (not Deleted/Cancelled, end date >= today)
    const { data: active, error } = await supabase
      .from('agreements')
      .select('id, customer_name, mobile, plate_number, car_type, date_start, date_end, total_price, status')
      .not('status', 'in', '("Deleted","Cancelled")')
      .gte('date_end', today)
      .order('date_end', { ascending: true });

    if (error) throw error;

    // Split into expiring (within 3 days) and overdue
    const expiring = [];
    const overdue = [];
    const normal = [];

    for (const a of (active || [])) {
      const endDate = (a.date_end || '').slice(0, 10);
      const daysLeft = Math.ceil((new Date(endDate) - new Date(today)) / (1000 * 60 * 60 * 24));
      a.days_left = daysLeft;

      if (daysLeft < 0) {
        overdue.push(a);
      } else if (daysLeft <= 3) {
        expiring.push(a);
      } else {
        normal.push(a);
      }
    }

    // Also fetch overdue (end date < today, not completed)
    const { data: overdueAgreements } = await supabase
      .from('agreements')
      .select('id, customer_name, mobile, plate_number, car_type, date_start, date_end, total_price, status')
      .not('status', 'in', '("Deleted","Cancelled","Completed")')
      .lt('date_end', today)
      .order('date_end', { ascending: true })
      .limit(50);

    const allOverdue = [...overdue, ...(overdueAgreements || [])].map(a => {
      const endDate = (a.date_end || '').slice(0, 10);
      a.days_overdue = Math.ceil((new Date(today) - new Date(endDate)) / (1000 * 60 * 60 * 24));
      return a;
    });

    res.json({
      total_active: (active || []).length,
      active: normal,
      expiring,
      overdue: allOverdue,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
