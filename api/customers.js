/**
 * GET /api/customers — Customer list with rental stats.
 * Query params: ?search=name_or_phone&limit=50
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();
    const search = (req.query.search || '').trim();
    const limit = parseInt(req.query.limit) || 50;

    let query = supabase
      .from('agreements')
      .select('customer_name, mobile, total_price, date_start, date_end, status, plate_number, car_type')
      .not('status', 'in', '("Deleted")')
      .order('date_start', { ascending: false })
      .limit(500);

    const { data: agreements, error } = await query;
    if (error) throw error;

    // Group by customer
    const customerMap = {};
    for (const a of (agreements || [])) {
      const key = a.customer_name || a.mobile || 'Unknown';
      if (!customerMap[key]) {
        customerMap[key] = {
          name: a.customer_name,
          phone: a.mobile,
          totalRentals: 0,
          totalSpent: 0,
          activeRentals: [],
          lastRental: null,
        };
      }
      const c = customerMap[key];
      c.totalRentals++;
      c.totalSpent += parseFloat(a.total_price) || 0;

      const isActive = a.status && !['Completed', 'Cancelled', 'Deleted'].includes(a.status);
      if (isActive) {
        c.activeRentals.push({
          plate_number: a.plate_number,
          car_type: a.car_type,
          date_start: a.date_start,
          date_end: a.date_end,
          status: a.status,
        });
      }

      if (!c.lastRental || a.date_start > c.lastRental) {
        c.lastRental = a.date_start;
      }
    }

    let customers = Object.values(customerMap)
      .sort((a, b) => (b.lastRental || '').localeCompare(a.lastRental || ''));

    // Filter by search
    if (search) {
      const lower = search.toLowerCase();
      customers = customers.filter(c =>
        (c.name || '').toLowerCase().includes(lower) ||
        (c.phone || '').includes(lower)
      );
    }

    res.json({
      total: customers.length,
      customers: customers.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
