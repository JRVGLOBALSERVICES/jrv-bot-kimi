const supabase = require('../client');
const { cars, catalog } = require('../schemas');
const { filterValidCars, VALID_CAR_STATUSES } = require('../../utils/validators');
const { daysFromNowMYT } = require('../../utils/time');

/**
 * Fleet Service
 * DB columns: plate_number, body_type, daily_price, catalog_id
 * make/model come from car_catalog table via catalog_id FK.
 */
class FleetService {
  constructor() {
    // Cache catalog data for make/model lookups
    this._catalogMap = new Map();
  }

  /**
   * Load car_catalog into memory for make/model lookups.
   */
  async loadCatalog() {
    const { data, error } = await supabase
      .from(catalog.TABLE)
      .select(catalog.FIELDS.ALL);
    if (error) throw error;
    this._catalogMap.clear();
    for (const item of data) {
      this._catalogMap.set(item.id, item);
    }
    return data;
  }

  /**
   * Enrich a car row with make/model from catalog.
   */
  enrichCar(car) {
    if (!car) return car;
    const cat = this._catalogMap.get(car.catalog_id);
    if (cat) {
      car._make = cat.make;
      car._model = cat.model;
      car._carName = `${cat.make} ${cat.model}`;
    } else {
      car._make = null;
      car._model = null;
      car._carName = car.body_type || 'Unknown';
    }
    return car;
  }

  /**
   * Enrich an array of car rows.
   */
  enrichCars(carsList) {
    return carsList.map(c => this.enrichCar(c));
  }

  // ─── Car Queries ──────────────────────────────────────

  async getAllCars() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.ALL)
      .in('status', VALID_CAR_STATUSES)
      .order('plate_number');
    if (error) throw error;
    return this.enrichCars(data);
  }

  async getAvailableCars() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.AVAILABILITY)
      .eq('status', cars.STATUS.AVAILABLE)
      .order('daily_price');
    if (error) throw error;
    return this.enrichCars(data);
  }

  async getCarByPlate(plate) {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.ALL)
      .ilike('plate_number', plate)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return this.enrichCar(data);
  }

  async getCarsByCategory(bodyType) {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.SUMMARY)
      .eq('body_type', bodyType)
      .in('status', VALID_CAR_STATUSES)
      .order('daily_price');
    if (error) throw error;
    return this.enrichCars(data);
  }

  async searchCars(query) {
    const q = `%${query}%`;
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.SUMMARY)
      .in('status', VALID_CAR_STATUSES)
      .or(`plate_number.ilike.${q},body_type.ilike.${q}`);
    if (error) throw error;
    return this.enrichCars(data);
  }

  async getPricing() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.PRICING)
      .eq('status', cars.STATUS.AVAILABLE)
      .order('daily_price');
    if (error) throw error;
    return this.enrichCars(data);
  }

  // ─── Maintenance Tracking ─────────────────────────────

  async getMaintenanceStatus() {
    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.MAINTENANCE)
      .in('status', VALID_CAR_STATUSES)
      .order('insurance_expiry');
    if (error) throw error;
    return this.enrichCars(data);
  }

  async getExpiringDocuments(daysAhead = 30) {
    const cutoffStr = daysFromNowMYT(daysAhead);

    const { data, error } = await supabase
      .from(cars.TABLE)
      .select(cars.FIELDS.MAINTENANCE)
      .in('status', VALID_CAR_STATUSES)
      .or(`insurance_expiry.lte.${cutoffStr},roadtax_expiry.lte.${cutoffStr}`);
    if (error) throw error;
    return this.enrichCars(data);
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
    return this.enrichCar(data);
  }

  // ─── Fleet Stats ──────────────────────────────────────

  async getFleetStats() {
    const allCars = await this.getAllCars();
    return {
      total: allCars.length,
      available: allCars.filter(c => c.status === cars.STATUS.AVAILABLE).length,
      rented: allCars.filter(c => c.status === cars.STATUS.RENTED).length,
      maintenance: allCars.filter(c => c.status === cars.STATUS.MAINTENANCE).length,
      byCategory: allCars.reduce((acc, c) => {
        const cat = c.body_type || 'other';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  // ─── Catalog ──────────────────────────────────────────

  async getCatalog() {
    return this.getAllCars();
  }

  async getCatalogByCategory(bodyType) {
    return this.getCarsByCategory(bodyType);
  }
}

module.exports = new FleetService();
