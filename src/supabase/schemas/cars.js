/**
 * Schema: cars table
 * Every vehicle in JRV fleet.
 *
 * Actual DB Columns:
 *   id (uuid)               - Primary key
 *   catalog_id (uuid)       - FK to car_catalog (has make, model)
 *   plate_number (text)     - e.g. "VNH 3600"
 *   status (text)           - "available", "rented", "maintenance", "inactive", "website-display-only"
 *   location (text)         - e.g. "Seremban"
 *   body_type (text)        - "Sedan", "Hatchback", "MPV/Van", "SUV", "Sports"
 *   color (text hex)        - e.g. "#000000"
 *   year (text)             - e.g. "2025"
 *   seats (int)
 *   transmission (text)     - "auto", "manual"
 *   fuel_type (text)        - "95", "Diesel"
 *   daily_price (numeric)   - Base daily rental price (RM)
 *   weekly_price (numeric)
 *   monthly_price (numeric)
 *   price_3_days (numeric)
 *   deposit_price (numeric)
 *   weekday_discount_percent (numeric)
 *   primary_image_url (text)
 *   images (text)           - JSON array string of image URLs
 *   notes (text)            - JSON or text
 *   is_active (bool)
 *   insurance_expiry (date)
 *   roadtax_expiry (date)
 *   track_insurance (bool)
 *   current_mileage (int)
 *   next_service_mileage (int)
 *   next_gear_oil_mileage (int)
 *   next_tyre_mileage (int)
 *   next_brake_pad_mileage (int)
 *   promo_label (text)
 *   promo_price (text)
 *   is_featured (bool)
 *   bluetooth (bool)
 *   smoking_allowed (bool)
 *   aux (bool)
 *   usb (bool)
 *   android_auto (bool)
 *   apple_carplay (bool)
 *   legacy_id (text)
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 *
 * NOTE: make/model come from car_catalog table via catalog_id FK.
 */

const TABLE = 'cars';

const FIELDS = {
  ALL: '*',
  SUMMARY: 'id, plate_number, catalog_id, year, color, status, body_type, daily_price, transmission, fuel_type, seats, images, primary_image_url',
  PRICING: 'id, plate_number, catalog_id, daily_price, weekly_price, monthly_price, price_3_days, body_type',
  MAINTENANCE: 'id, plate_number, catalog_id, insurance_expiry, roadtax_expiry, current_mileage, next_service_mileage',
  AVAILABILITY: 'id, plate_number, catalog_id, status, location, body_type, daily_price',
};

const STATUS = {
  AVAILABLE: 'available',
  RENTED: 'rented',
  MAINTENANCE: 'maintenance',
  INACTIVE: 'inactive',
  WEBSITE_DISPLAY: 'website-display-only',
};

module.exports = { TABLE, FIELDS, STATUS };
