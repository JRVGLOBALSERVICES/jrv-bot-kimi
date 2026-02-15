/**
 * Time utilities — all times stored as UTC in Supabase,
 * converted to Malaysia Time (MYT = UTC+8) for display.
 */

const MYT_OFFSET_HOURS = 8;
const MYT_TIMEZONE = 'Asia/Kuala_Lumpur';

/**
 * Convert a UTC date/string to Malaysia Time Date object.
 */
function toMYT(utcDate) {
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);
  return new Date(d.getTime() + MYT_OFFSET_HOURS * 60 * 60 * 1000);
}

/**
 * Format a UTC date to Malaysia Time string.
 * @param {Date|string} utcDate
 * @param {string} format - 'date', 'time', 'datetime', 'short', 'full'
 */
function formatMYT(utcDate, format = 'datetime') {
  if (!utcDate) return 'N/A';
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);

  const options = { timeZone: MYT_TIMEZONE };

  switch (format) {
    case 'date':
      return d.toLocaleDateString('en-MY', { ...options, day: '2-digit', month: 'short', year: 'numeric' });
    case 'time':
      return d.toLocaleTimeString('en-MY', { ...options, hour: '2-digit', minute: '2-digit', hour12: true });
    case 'datetime':
      return d.toLocaleString('en-MY', { ...options, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    case 'short':
      return d.toLocaleDateString('en-MY', { ...options, day: 'numeric', month: 'short' });
    case 'full':
      return d.toLocaleString('en-MY', { ...options, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    case 'iso':
      return toMYT(d).toISOString().replace('T', ' ').slice(0, 19);
    default:
      return d.toLocaleString('en-MY', options);
  }
}

/**
 * Get current date/time in MYT.
 */
function nowMYT() {
  return toMYT(new Date());
}

/**
 * Get today's date string in YYYY-MM-DD (MYT).
 */
function todayMYT() {
  return nowMYT().toISOString().split('T')[0];
}

/**
 * Check if a date (MYT) is today.
 */
function isTodayMYT(utcDate) {
  return formatMYT(utcDate, 'date') === formatMYT(new Date(), 'date');
}

/**
 * Get date N days from now (MYT).
 */
function daysFromNowMYT(days) {
  const d = nowMYT();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate days between two dates.
 */
function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date is overdue (past today in MYT).
 */
function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < todayMYT();
}

module.exports = {
  toMYT,
  formatMYT,
  nowMYT,
  todayMYT,
  isTodayMYT,
  daysFromNowMYT,
  daysBetween,
  isOverdue,
  MYT_TIMEZONE,
};
