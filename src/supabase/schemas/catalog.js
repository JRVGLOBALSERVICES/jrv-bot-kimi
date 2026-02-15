/**
 * Schema: catalog table
 * Master list of car makes and models offered by JRV.
 *
 * Columns:
 *   id (int8)              - Primary key
 *   make (text)            - e.g. "Perodua", "Proton", "Toyota"
 *   model (text)           - e.g. "Axia", "Saga", "Vios"
 *   category (text)        - "economy", "standard", "premium", "suv", "mpv"
 *   base_daily_rate (numeric)
 *   description (text)     - Marketing description
 *   image_url (text)       - Catalog image
 *   is_active (bool)
 *   created_at (timestamptz)
 */

const TABLE = 'catalog';

const FIELDS = {
  ALL: '*',
  LIST: 'id, make, model, category, base_daily_rate, image_url',
};

module.exports = { TABLE, FIELDS };
