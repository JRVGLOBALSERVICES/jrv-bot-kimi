/**
 * GET /api/fleet — Fleet status overview.
 * Returns cars grouped by status with counts.
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    const { data: cars, error } = await supabase
      .from('cars')
      .select('id, plate_number, status, body_type, daily_price, color, year')
      .order('plate_number');

    if (error) throw error;

    const { data: catalog } = await supabase.from('car_catalog').select('id, make, model, variant, year');
    const catalogMap = {};
    if (catalog) catalog.forEach(c => { catalogMap[c.id] = c; });

    const enriched = cars.map(car => {
      const cat = car.catalog_id ? catalogMap[car.catalog_id] : null;
      return {
        ...car,
        car_name: cat ? `${cat.make} ${cat.model}${cat.variant ? ' ' + cat.variant : ''}` : car.body_type || '',
      };
    });

    const available = enriched.filter(c => c.status === 'available');
    const rented = enriched.filter(c => c.status === 'rented');
    const maintenance = enriched.filter(c => c.status === 'maintenance');

    res.json({
      total: cars.length,
      available: available.length,
      rented: rented.length,
      maintenance: maintenance.length,
      cars: enriched,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
