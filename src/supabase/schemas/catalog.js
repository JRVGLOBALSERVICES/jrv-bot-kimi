/**
 * Schema: car_catalog table
 * Master list of car makes and models offered by JRV.
 *
 * Actual DB Columns:
 *   id (uuid)              - Primary key
 *   make (text)            - e.g. "Perodua", "Proton", "Toyota"
 *   model (text)           - e.g. "Axia", "Saga", "Vios"
 *   variant (text)
 *   year (text)
 *   category (text)
 *   seats (int)
 *   transmission (text)
 *   fuel_type (text)
 *   features (text)
 *   default_images (text)  - Default image URL
 *   is_active (bool)
 *   legacy_id (text)
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 */

const TABLE = 'car_catalog';

const FIELDS = {
  ALL: '*',
  LIST: 'id, make, model, category, default_images',
};

module.exports = { TABLE, FIELDS };
