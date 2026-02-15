/**
 * GET /api/reports — Generate reports from Supabase data.
 * Query params: ?type=summary|fleet|expiring|overdue|earnings
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();
    const type = (req.query.type || 'summary').toLowerCase();
    const today = new Date().toISOString().split('T')[0];

    // Fetch all agreements
    const { data: agreements, error: agErr } = await supabase
      .from('agreements')
      .select('*')
      .not('status', 'in', '("Deleted")')
      .order('date_end', { ascending: true })
      .limit(500);
    if (agErr) throw agErr;

    // Fetch fleet
    const { data: cars, error: carErr } = await supabase
      .from('cars')
      .select('id, plate_number, status, body_type, daily_price, color, year, catalog_id')
      .order('plate_number');
    if (carErr) throw carErr;

    // Catalog
    const { data: catalog } = await supabase.from('car_catalog').select('id, make, model, variant, year');
    const catalogMap = {};
    if (catalog) catalog.forEach(c => { catalogMap[c.id] = c; });

    const enrichCar = (car) => {
      const cat = car.catalog_id ? catalogMap[car.catalog_id] : null;
      return cat ? `${cat.make} ${cat.model}` : car.body_type || '';
    };

    const active = (agreements || []).filter(a =>
      a.status && !['Completed', 'Cancelled', 'Deleted'].includes(a.status)
    );

    let report = '';

    switch (type) {
      case 'summary': {
        const available = (cars || []).filter(c => c.status === 'available');
        const rented = (cars || []).filter(c => c.status === 'rented');
        const maintenance = (cars || []).filter(c => c.status === 'maintenance');

        const expiring = active.filter(a => {
          const end = (a.date_end || '').slice(0, 10);
          const days = daysBetween(today, end);
          return days >= 0 && days <= 3;
        });

        const overdue = active.filter(a => {
          const end = (a.date_end || '').slice(0, 10);
          return daysBetween(today, end) < 0;
        });

        report = `=== DAILY SUMMARY (${today}) ===\n\n`;
        report += `Fleet: ${(cars||[]).length} cars\n`;
        report += `  Available: ${available.length}\n`;
        report += `  Rented: ${rented.length}\n`;
        report += `  Maintenance: ${maintenance.length}\n\n`;
        report += `Bookings: ${active.length} active\n`;
        report += `  Expiring (3d): ${expiring.length}\n`;
        report += `  Overdue: ${overdue.length}\n\n`;

        if (expiring.length > 0) {
          report += `--- Expiring Soon ---\n`;
          expiring.forEach(a => {
            const end = (a.date_end || '').slice(0, 10);
            const days = daysBetween(today, end);
            report += `  ${a.plate_number} | ${a.customer_name} | ends ${end} (${days}d)\n`;
          });
          report += '\n';
        }

        if (overdue.length > 0) {
          report += `--- OVERDUE ---\n`;
          overdue.forEach(a => {
            const end = (a.date_end || '').slice(0, 10);
            const days = Math.abs(daysBetween(today, end));
            report += `  ${a.plate_number} | ${a.customer_name} | was due ${end} (${days}d overdue)\n`;
          });
        }
        break;
      }

      case 'fleet': {
        report = `=== FLEET REPORT (${today}) ===\n\n`;
        const statusGroups = {};
        for (const car of (cars || [])) {
          const s = car.status || 'unknown';
          if (!statusGroups[s]) statusGroups[s] = [];
          statusGroups[s].push(car);
        }
        for (const [status, group] of Object.entries(statusGroups)) {
          report += `--- ${status.toUpperCase()} (${group.length}) ---\n`;
          group.forEach(c => {
            report += `  ${c.plate_number} | ${enrichCar(c)} | RM${c.daily_price || '—'}/day\n`;
          });
          report += '\n';
        }
        break;
      }

      case 'by-time': {
        report = `=== BOOKINGS BY END DATE ===\n\n`;
        const sorted = [...active].sort((a, b) => (a.date_end || '').localeCompare(b.date_end || ''));
        sorted.forEach(a => {
          const end = (a.date_end || '').slice(0, 10);
          const days = daysBetween(today, end);
          const tag = days < 0 ? 'OVERDUE' : days <= 2 ? 'EXPIRING' : '';
          report += `  ${end} | ${a.plate_number} | ${a.customer_name} | ${a.mobile || ''} ${tag ? '⚠ ' + tag : ''}\n`;
        });
        break;
      }

      case 'by-contact': {
        report = `=== BOOKINGS BY CUSTOMER ===\n\n`;
        const grouped = {};
        active.forEach(a => {
          const key = a.customer_name || 'Unknown';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(a);
        });
        for (const [name, bookings] of Object.entries(grouped)) {
          report += `${name} (${bookings.length} active):\n`;
          bookings.forEach(a => {
            report += `  ${a.plate_number} | ${(a.date_start||'').slice(0,10)} → ${(a.date_end||'').slice(0,10)} | RM${a.total_price || '—'}\n`;
          });
          report += '\n';
        }
        break;
      }

      case 'available': {
        const available = (cars || []).filter(c => c.status === 'available');
        report = `=== AVAILABLE CARS (${available.length}) ===\n\n`;
        available.forEach(c => {
          report += `  ${c.plate_number} | ${enrichCar(c)} | RM${c.daily_price || '—'}/day\n`;
        });
        break;
      }

      default:
        report = 'Unknown report type. Use: summary, fleet, by-time, by-contact, available';
    }

    res.json({ type, report, generated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}
