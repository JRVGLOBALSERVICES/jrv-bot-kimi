/**
 * Schema: agreements table
 * Every rental booking/agreement.
 *
 * Columns:
 *   id (int8)                - Primary key
 *   agreement_number (text)  - e.g. "JRV-2024-001"
 *   customer_id (int8)       - FK to customers
 *   customer_name (text)     - Denormalized for quick access
 *   customer_phone (text)    - Denormalized
 *   car_id (int8)            - FK to cars
 *   car_plate (text)         - Denormalized
 *   car_description (text)   - e.g. "Perodua Axia 2023 White"
 *   start_date (date)
 *   end_date (date)
 *   actual_return_date (date)
 *   pickup_location (text)
 *   return_location (text)
 *   daily_rate (numeric)     - Agreed rate
 *   total_amount (numeric)   - Total rental amount
 *   deposit_amount (numeric) - Deposit collected
 *   deposit_status (text)    - "collected", "refunded", "partial", "forfeited"
 *   payment_method (text)    - "cash", "bank_transfer", "card"
 *   payment_status (text)    - "pending", "paid", "partial", "overdue"
 *   status (text)            - "active", "completed", "cancelled", "overdue", "extended"
 *   notes (text)
 *   created_by (text)        - Admin who created
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 */

const TABLE = 'agreements';

const FIELDS = {
  ALL: '*',
  ACTIVE: 'id, agreement_number, customer_name, customer_phone, car_plate, car_description, start_date, end_date, status, daily_rate, total_amount',
  SUMMARY: 'id, agreement_number, customer_name, car_plate, start_date, end_date, status, total_amount',
  FINANCIAL: 'id, agreement_number, customer_name, daily_rate, total_amount, deposit_amount, deposit_status, payment_status, payment_method',
};

const STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  OVERDUE: 'overdue',
  EXTENDED: 'extended',
};

module.exports = { TABLE, FIELDS, STATUS };
