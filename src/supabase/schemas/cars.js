/**
 * Schema: cars table
 * Every vehicle in JRV fleet with full details.
 *
 * Columns:
 *   id (int8)               - Primary key
 *   car_plate (text)        - e.g. "WA1234B"
 *   make (text)             - e.g. "Perodua"
 *   model (text)            - e.g. "Axia"
 *   year (int4)             - e.g. 2023
 *   color (text)            - e.g. "White"
 *   variant (text)          - e.g. "1.0 SE AT"
 *   transmission (text)     - "Auto" or "Manual"
 *   fuel_type (text)        - "Petrol", "Diesel", "Hybrid"
 *   seats (int4)            - Number of seats
 *   status (text)           - "available", "rented", "maintenance", "reserved"
 *   category (text)         - "economy", "standard", "premium", "suv", "mpv"
 *   daily_rate (numeric)    - Base daily rental price (RM)
 *   weekly_rate (numeric)   - Weekly rate
 *   monthly_rate (numeric)  - Monthly rate
 *   deposit (numeric)       - Security deposit required
 *   mileage (int4)          - Current odometer reading
 *   last_service_date (date)
 *   next_service_due (date)
 *   insurance_expiry (date)
 *   roadtax_expiry (date)
 *   inspection_expiry (date)
 *   location (text)         - Current location / branch
 *   features (jsonb)        - Array of features: ["dashcam", "bluetooth", "reverse camera"]
 *   images (jsonb)          - Array of image URLs
 *   notes (text)            - Admin notes
 *   is_active (bool)        - Soft delete flag
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 */

const TABLE = 'cars';

const FIELDS = {
  ALL: '*',
  SUMMARY: 'id, car_plate, make, model, year, color, status, category, daily_rate, transmission, fuel_type, seats, images',
  PRICING: 'id, car_plate, make, model, daily_rate, weekly_rate, monthly_rate, deposit, category',
  MAINTENANCE: 'id, car_plate, make, model, last_service_date, next_service_due, insurance_expiry, roadtax_expiry, inspection_expiry, mileage',
  AVAILABILITY: 'id, car_plate, make, model, status, location, category, daily_rate',
};

const STATUS = {
  AVAILABLE: 'available',
  RENTED: 'rented',
  MAINTENANCE: 'maintenance',
  RESERVED: 'reserved',
};

module.exports = { TABLE, FIELDS, STATUS };
