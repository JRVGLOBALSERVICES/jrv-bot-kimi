const { todayMYT, isOverdue } = require('./time');

/**
 * Cross-reference car status with active agreements.
 * Ensures car status reflects reality.
 *
 * Business rules:
 * - Car is RENTED when agreement status is: New, Editted (end_date >= today), Extended
 * - Car is AVAILABLE when agreement status is: Completed, Editted (end_date < today), Cancelled, Deleted
 * - Only car statuses: available, rented, maintenance
 * - Agreements excluded: "Deleted"
 */

const VALID_CAR_STATUSES = ['available', 'rented', 'maintenance'];
const EXCLUDED_AGREEMENT_STATUS = 'Deleted';

/**
 * Check if an agreement means the car is currently rented.
 * @param {object} agreement
 * @param {string} today - today's date in YYYY-MM-DD format
 * @returns {boolean}
 */
function isAgreementActive(agreement, today) {
  const status = agreement.status;

  // New or Extended = car is rented (if dates overlap)
  if (status === 'New' || status === 'Extended') {
    return agreement.start_date <= today && agreement.end_date >= today;
  }

  // Editted = check end_date to determine if still active
  if (status === 'Editted') {
    return agreement.end_date >= today;
  }

  // Completed, Cancelled, Deleted = car is NOT rented
  return false;
}

/**
 * Validate and reconcile car statuses against agreements.
 * @param {Array} cars - All cars from DB
 * @param {Array} agreements - All non-deleted agreements
 * @returns {{ validated: Array, mismatches: Array }}
 */
function validateFleetStatus(cars, agreements) {
  const today = todayMYT();
  const mismatches = [];

  // Build a set of car plates with currently active agreements
  const activePlates = new Set();
  const overduePlates = new Set();

  for (const agreement of agreements) {
    if (agreement.status === EXCLUDED_AGREEMENT_STATUS) continue;

    if (isAgreementActive(agreement, today)) {
      activePlates.add(agreement.car_plate?.toUpperCase());

      // Overdue: end_date has passed but agreement still considered active
      if (isOverdue(agreement.end_date)) {
        overduePlates.add(agreement.car_plate?.toUpperCase());
      }
    }
  }

  const validated = cars.map(car => {
    const plate = car.car_plate?.toUpperCase();
    const copy = { ...car };

    // Skip maintenance cars — don't override manual maintenance status
    if (car.status === 'maintenance') return copy;

    const hasActiveAgreement = activePlates.has(plate);
    const isOverdueReturn = overduePlates.has(plate);

    const carLabel = plate || [car.make, car.model, car.year].filter(Boolean).join(' ') || `ID:${car.id}`;

    if (car.status === 'available' && hasActiveAgreement) {
      mismatches.push({
        plate,
        carLabel,
        dbStatus: 'available',
        actualStatus: 'rented',
        reason: 'Has active agreement but marked available',
      });
      copy._validatedStatus = 'rented';
      copy._overdue = isOverdueReturn;
    } else if (car.status === 'rented' && !hasActiveAgreement) {
      mismatches.push({
        plate,
        carLabel,
        dbStatus: 'rented',
        actualStatus: 'available',
        reason: 'No active agreement but marked rented',
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
 * Filter agreements — exclude deleted.
 */
function filterValidAgreements(agreements) {
  return agreements.filter(a => a.status !== EXCLUDED_AGREEMENT_STATUS);
}

module.exports = {
  validateFleetStatus,
  isAgreementActive,
  filterValidCars,
  filterValidAgreements,
  VALID_CAR_STATUSES,
  EXCLUDED_AGREEMENT_STATUS,
};
