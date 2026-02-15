/**
 * Schema: bot_data_store table
 * Key-value store for all bot configuration, pricing, zones, FAQ, logs.
 *
 * Columns (actual DB — no is_active column):
 *   id (int8)             - Primary key
 *   key (text)            - e.g. "economy_daily", "zone_klcc", "faq_deposit"
 *   value (jsonb)         - The actual data (flexible JSON)
 *   category (text)       - May or may not exist; e.g. "pricing", "delivery_zones", "faq"
 *   description (text)    - Human-readable description (may not exist)
 *   created_at (timestamptz)
 *   updated_at (timestamptz)
 *
 * Known categories:
 *   "pricing"         - Rate cards, discounts, seasonal pricing
 *   "delivery_zones"  - Delivery locations with fees
 *   "faq"             - Frequently asked questions + answers
 *   "testimonials"    - Customer testimonials
 *   "admin"           - Admin names, phones, permissions
 *   "config"          - Bot configuration values
 *   "templates"       - Message templates (booking confirm, reminder, etc.)
 *   "logs"            - Interaction logs, error logs
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
