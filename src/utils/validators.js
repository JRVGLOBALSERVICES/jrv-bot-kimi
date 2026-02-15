const { todayMYT, isOverdue } = require('./time');

/**
 * Cross-reference car status with active agreements.
 * Ensures car status reflects reality.
 *
 * Rules:
 * - A car marked "available" but has an active agreement → should be "rented"
 * - A car marked "rented" but no active agreement → should be "available"
 * - Only statuses used: available, rented, maintenance
 * - Agreements: all statuses EXCEPT "deleted"
 */

const VALID_CAR_STATUSES = ['available', 'rented', 'maintenance'];
const EXCLUDED_AGREEMENT_STATUS = 'deleted';

/**
 * Validate and reconcile car statuses against active agreements.
 * @param {Array} cars - All cars from DB
 * @param {Array} agreements - All non-deleted agreements
 * @returns {{ validated: Array, mismatches: Array }}
 */
function validateFleetStatus(cars, agreements) {
  const today = todayMYT();
  const mismatches = [];

  // Build a set of car plates with active (non-deleted, not completed, not cancelled) agreements
  const activePlates = new Set();
  const overdueePlates = new Set();

  for (const agreement of agreements) {
    if (agreement.status === EXCLUDED_AGREEMENT_STATUS) continue;

    // An agreement is "currently active" if status is active/extended and dates overlap today
    if (['active', 'extended'].includes(agreement.status)) {
      if (agreement.start_date <= today && agreement.end_date >= today) {
        activePlates.add(agreement.car_plate?.toUpperCase());
      }
      // Overdue: end_date has passed but status still active
      if (isOverdue(agreement.end_date) && agreement.status === 'active') {
        overdueePlates.add(agreement.car_plate?.toUpperCase());
      }
    }
  }

  const validated = cars.map(car => {
    const plate = car.car_plate?.toUpperCase();
    const copy = { ...car };

    // Skip maintenance cars — don't override manual maintenance status
    if (car.status === 'maintenance') return copy;

    const hasActiveAgreement = activePlates.has(plate);
    const isOverdueReturn = overdueePlates.has(plate);

    if (car.status === 'available' && hasActiveAgreement) {
      mismatches.push({
        plate,
        dbStatus: 'available',
        actualStatus: 'rented',
        reason: 'Has active agreement but marked available',
      });
      copy._validatedStatus = 'rented';
      copy._overdue = isOverdueReturn;
    } else if (car.status === 'rented' && !hasActiveAgreement) {
      mismatches.push({
        plate,
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
  filterValidCars,
  filterValidAgreements,
  VALID_CAR_STATUSES,
  EXCLUDED_AGREEMENT_STATUS,
};
