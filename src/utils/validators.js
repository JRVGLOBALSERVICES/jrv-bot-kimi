const { todayMYT, isOverdue, daysFromNowMYT } = require('./time');

/**
 * Cross-reference car status with agreements.
 *
 * DB column mapping:
 *   cars:       plate_number, body_type, daily_price, status
 *   agreements: plate_number, car_type, date_start, date_end, mobile, total_price, status
 *
 * Simple date-based logic (no status guessing):
 * - A car is RENTED if it has any agreement where date_end >= today
 *   and status is NOT Completed, Cancelled, or Deleted.
 * - Only checks agreements from the past month for performance.
 * - A car is AVAILABLE if no such agreement exists.
 * - Maintenance cars are never overridden.
 */

const VALID_CAR_STATUSES = ['available', 'rented', 'maintenance'];
const EXCLUDED_AGREEMENT_STATUSES = ['Deleted', 'Cancelled'];

// Statuses that mean the agreement is finished (car returned)
const FINISHED_STATUSES = ['Completed', 'Cancelled', 'Deleted'];

/**
 * Get date_end from an agreement (handles both column name conventions).
 */
function getEndDate(agreement) {
  // Actual DB uses date_end; legacy code used end_date
  return agreement.date_end || agreement.end_date;
}

/**
 * Get date_start from an agreement.
 */
function getStartDate(agreement) {
  return agreement.date_start || agreement.start_date;
}

/**
 * Get plate number from a car or agreement row.
 */
function getPlate(row) {
  return row.plate_number || row.car_plate;
}

/**
 * Check if an agreement means the car is currently rented.
 * Pure date-based: date_end >= today AND not finished.
 */
function isAgreementActive(agreement, today) {
  // If agreement is finished, car is not rented
  if (FINISHED_STATUSES.includes(agreement.status)) return false;

  const endDate = getEndDate(agreement);
  if (!endDate) return false;

  // Normalize: date_end may be ISO timestamp "2026-02-20 00:00:00+00"
  // Compare just the date portion
  const endDateStr = endDate.slice(0, 10);
  return endDateStr >= today;
}

/**
 * Filter agreements to only recent ones (past month + future).
 * Avoids scanning thousands of old agreements.
 */
function getRecentAgreements(agreements) {
  const oneMonthAgo = daysFromNowMYT(-30);
  return agreements.filter(a => {
    const endDate = getEndDate(a);
    if (!endDate) return false;
    const endDateStr = endDate.slice(0, 10);
    return endDateStr >= oneMonthAgo && !FINISHED_STATUSES.includes(a.status);
  });
}

/**
 * Validate and reconcile car statuses against agreements.
 * @param {Array} cars - All cars from DB
 * @param {Array} agreements - Agreements (ideally recent/active only)
 * @returns {{ validated: Array, mismatches: Array }}
 */
function validateFleetStatus(cars, agreements) {
  const today = todayMYT();
  const mismatches = [];

  // Filter to recent agreements only
  const recent = getRecentAgreements(agreements);

  // Build map: plate_number → active agreements
  const activePlates = new Map(); // plate → agreement
  const overduePlates = new Set();

  for (const agreement of recent) {
    if (isAgreementActive(agreement, today)) {
      const plate = getPlate(agreement)?.toUpperCase();
      if (plate) {
        activePlates.set(plate, agreement);

        // Overdue: date_end has passed
        const endDate = getEndDate(agreement);
        if (endDate && isOverdue(endDate.slice(0, 10))) {
          overduePlates.add(plate);
        }
      }
    }
  }

  const validated = cars.map(car => {
    const plate = getPlate(car)?.toUpperCase();
    const copy = { ...car };

    // Skip maintenance cars — don't override manual maintenance status
    if (car.status === 'maintenance') return copy;

    const activeAgreement = activePlates.get(plate);
    const hasActiveAgreement = !!activeAgreement;
    const isOverdueReturn = overduePlates.has(plate);

    // Build a label: plate, or car_type/body_type, or year, or ID
    const carLabel = plate || car.car_type || car.body_type || car.year || `ID:${car.id}`;

    if (car.status === 'available' && hasActiveAgreement) {
      const endDate = getEndDate(activeAgreement);
      mismatches.push({
        plate,
        carLabel,
        dbStatus: 'available',
        actualStatus: 'rented',
        reason: `Has agreement (${activeAgreement.status}) ending ${endDate?.slice(0, 10)}`,
        agreement: activeAgreement,
      });
      copy._validatedStatus = 'rented';
      copy._overdue = isOverdueReturn;
    } else if (car.status === 'rented' && !hasActiveAgreement) {
      mismatches.push({
        plate,
        carLabel,
        dbStatus: 'rented',
        actualStatus: 'available',
        reason: 'No active agreement found in past month',
      });
      copy._validatedStatus = 'available';
    } else {
      copy._validatedStatus = car.status;
    }

    if (isOverdueReturn) {
      copy._overdue = true;
    }

    return copy;
  });

  return { validated, mismatches };
}

/**
 * Filter cars by valid statuses only (available, rented, maintenance).
 */
function filterValidCars(cars) {
  return cars.filter(c => VALID_CAR_STATUSES.includes(c.status));
}

/**
 * Filter agreements — exclude deleted and cancelled.
 */
function filterValidAgreements(agreements) {
  return agreements.filter(a => !EXCLUDED_AGREEMENT_STATUSES.includes(a.status));
}

/**
 * Convert hex color codes to readable color names.
 * Handles: #hex, hex, and already-named colors.
 */
const HEX_COLORS = {
  '#000000': 'Black', '#ffffff': 'White', '#ff0000': 'Red',
  '#00ff00': 'Green', '#0000ff': 'Blue', '#ffff00': 'Yellow',
  '#ff00ff': 'Magenta', '#00ffff': 'Cyan', '#808080': 'Grey',
  '#c0c0c0': 'Silver', '#800000': 'Maroon', '#800080': 'Purple',
  '#008000': 'Dark Green', '#000080': 'Navy', '#ffa500': 'Orange',
  '#ffc0cb': 'Pink', '#a52a2a': 'Brown', '#f5f5dc': 'Beige',
  '#d4af37': 'Gold', '#e5e4e2': 'Platinum',
};

function colorName(input) {
  if (!input) return '';
  const val = input.trim();

  // Already a readable name (no # and no hex pattern)
  if (!/^#?[0-9a-f]{3,8}$/i.test(val)) return val;

  const hex = val.startsWith('#') ? val.toLowerCase() : `#${val.toLowerCase()}`;

  // Exact match
  if (HEX_COLORS[hex]) return HEX_COLORS[hex];

  // Parse RGB and find closest named color by hue/saturation/lightness
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  if (isNaN(r)) return val;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const diff = max - min;

  // Very dark → Black
  if (l < 30) return 'Black';
  // Very light → White
  if (l > 235 && diff < 20) return 'White';
  // Low saturation → Grey/Silver
  if (diff < 25) return l > 160 ? 'Silver' : 'Grey';

  // Determine hue
  let h = 0;
  if (diff > 0) {
    if (max === r) h = 60 * (((g - b) / diff) % 6);
    else if (max === g) h = 60 * ((b - r) / diff + 2);
    else h = 60 * ((r - g) / diff + 4);
  }
  if (h < 0) h += 360;

  // Map hue ranges to color names
  if (h < 15 || h >= 345) return l < 100 ? 'Maroon' : 'Red';
  if (h < 45) return l > 100 ? 'Orange' : 'Brown';
  if (h < 70) return 'Yellow';
  if (h < 160) return 'Green';
  if (h < 200) return 'Teal';
  if (h < 260) return 'Blue';
  if (h < 300) return 'Purple';
  return 'Pink';
}

module.exports = {
  validateFleetStatus,
  isAgreementActive,
  getRecentAgreements,
  getEndDate,
  getStartDate,
  getPlate,
  filterValidCars,
  filterValidAgreements,
  colorName,
  VALID_CAR_STATUSES,
  EXCLUDED_AGREEMENT_STATUSES,
  FINISHED_STATUSES,
};
