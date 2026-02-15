const supabase = require('../client');
const { cars } = require('../schemas');
const { filterValidCars, VALID_CAR_STATUSES } = require('../../utils/validators');
const { daysFromNowMYT } = require('../../utils/time');

class FleetService {
  // ─── Car Queries ──────────────────────────────────────

  async getAllCars() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.ALL)
      .in('status', VALID_CAR_STATUSES) // Only available, rented, maintenance
      .order('make');
    if (error) throw error;
    return data;
  }

  async getAvailableCars() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.AVAILABILITY)
      .eq('status', cars.STATUS.AVAILABLE)
      .order('daily_rate');
    if (error) throw error;
    return data;
  }

  async getCarByPlate(plate) {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.ALL)
      .ilike('car_plate', plate)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async getCarsByCategory(category) {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.SUMMARY)
      .eq('category', category)
      .in('status', VALID_CAR_STATUSES)
      .order('daily_rate');
    if (error) throw error;
    return data;
  }

  async searchCars(query) {
    const q = `%${query}%`;
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.SUMMARY)
      .in('status', VALID_CAR_STATUSES)
      .or(`car_plate.ilike.${q},make.ilike.${q},model.ilike.${q},color.ilike.${q}`);
    if (error) throw error;
    return data;
  }

  async getPricing() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.PRICING)
      .eq('status', cars.STATUS.AVAILABLE)
      .order('daily_rate');
    if (error) throw error;
    return data;
  }

  // ─── Maintenance Tracking ─────────────────────────────

  async getMaintenanceStatus() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.MAINTENANCE)
      .in('status', VALID_CAR_STATUSES)
      .order('next_service_due');
    if (error) throw error;
    return data;
  }

  async getExpiringDocuments(daysAhead = 30) {
    const cutoffStr = daysFromNowMYT(daysAhead);

    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.MAINTENANCE)
      .in('status', VALID_CAR_STATUSES)
      .or(`insurance_expiry.lte.${cutoffStr},roadtax_expiry.lte.${cutoffStr},inspection_expiry.lte.${cutoffStr}`);
    if (error) throw error;
    return data;
  }

  async updateCarStatus(carId, status) {
    if (!VALID_CAR_STATUSES.includes(status)) {
      throw new Error(`Invalid car status: ${status}. Valid: ${VALID_CAR_STATUSES.join(', ')}`);
    }
    const { data, error } = await supabase
      .from(cars.TABLE)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', carId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ─── Fleet Stats (uses validated status) ──────────────

  async getFleetStats() {
    const allCars = await this.getAllCars();
    return {
      total: allCars.length,
      available: allCars.filter(c => c.status === cars.STATUS.AVAILABLE).length,
      rented: allCars.filter(c => c.status === cars.STATUS.RENTED).length,
      maintenance: allCars.filter(c => c.status === cars.STATUS.MAINTENANCE).length,
      byCategory: allCars.reduce((acc, c) => {
        acc[c.category] = (acc[c.category] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  // ─── Catalog Queries (uses cars table — no separate catalog table) ──

  async getCatalog() {
    return this.getAllCars();
  }

  async getCatalogByCategory(category) {
    return this.getCarsByCategory(category);
  }
}

module.exports = new FleetService();
