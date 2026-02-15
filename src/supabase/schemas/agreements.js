/**
 * Schema: agreements table
 * Every rental booking/agreement.
 *
 * Actual DB Columns:
 *   id (uuid)               - Primary key
 *   car_id (uuid)           - FK to cars
 *   plate_number (text)     - Denormalized car plate
 *   car_type (text)         - e.g. "Perodua Bezza", "Toyota Vios"
 *   catalog_id (uuid)       - FK to car_catalog
 *   customer_name (text)
 *   mobile (text)           - Customer phone number
 *   id_number (text)        - IC/Passport number
 *   date_start (timestamptz)
 *   date_end (timestamptz)
 *   booking_duration_days (int)
 *   total_price (numeric)   - Total rental amount
 *   deposit_price (numeric) - Deposit collected
 *   deposit_refunded (bool)
 *   paid (numeric)          - Amount paid
 *   booking_payment (text)
 *   status (text)           - "New", "Editted", "Extended", "Completed", "Cancelled", "Deleted"
 *   creator_email (text)
 *   editor_email (text)
 *   agreement_url (text)    - PDF URL
 *   whatsapp_url (text)
 *   ic_url (text)
 *   remarks (text)
 *   start_mileage (int)
 *   eligible_for_event (bool)
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 */

const TABLE = 'agreements';

const FIELDS = {
  ALL: '*',
  ACTIVE: 'id, customer_name, mobile, plate_number, car_type, date_start, date_end, status, total_price',
  SUMMARY: 'id, customer_name, plate_number, date_start, date_end, status, total_price',
  FINANCIAL: 'id, customer_name, total_price, deposit_price, paid, booking_payment',
};

// Status values match DB (capitalized)
const STATUS = {
  NEW: 'New',
  EDITTED: 'Editted',
  EXTENDED: 'Extended',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DELETED: 'Deleted',
};

// Statuses that mean car is currently rented (before checking date_end)
const ACTIVE_STATUSES = ['New', 'Editted', 'Extended'];

module.exports = { TABLE, FIELDS, STATUS, ACTIVE_STATUSES };
