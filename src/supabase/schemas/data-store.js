/**
 * Schema: bot_data_store table
 * Key-value store for all bot configuration, pricing, zones, FAQ, logs.
 *
 * Actual DB columns:
 *   id (int8)             - Primary key
 *   key (text)            - e.g. "car_prices:summary", "admin_name:60138606455"
 *   value (jsonb)         - The actual data (flexible JSON)
 *   created_by (text)     - Who created the entry
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 *
 * Key prefixes (used instead of categories):
 *   "car_prices:"     - Rate cards, pricing tiers
 *   "delivery_zone"   - Delivery locations with fees
 *   "faq"             - Frequently asked questions + answers
 *   "admin_name:"     - Admin names and phones
 *   "config"          - Bot configuration values
 *   "template"        - Message templates
 *   "escalation:"     - Escalation logs
 *   "jarvis_error_"   - Error logs
 *   "car_media:"      - Car media URLs
 */

const TABLE = 'bot_data_store';

const FIELDS = {
  ALL: '*',
  CONFIG: 'id, key, value',
};

const CATEGORIES = {
  PRICING: 'pricing',
  DELIVERY_ZONES: 'delivery_zones',
  FAQ: 'faq',
  TESTIMONIALS: 'testimonials',
  ADMIN: 'admin',
  CONFIG: 'config',
  TEMPLATES: 'templates',
  LOGS: 'logs',
};

module.exports = { TABLE, FIELDS, CATEGORIES };
