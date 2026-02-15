const { todayMYT, isOverdue, daysFromNowMYT } = require('./time');

/**
 * Cross-reference car status with agreements.
 *
 * Simple date-based logic (no status guessing):
 * - A car is RENTED if it has any agreement where end_date >= today
 *   and status is NOT Completed, Cancelled, or Deleted.
 * - Only checks agreements from the past month for performance.
 * - A car is AVAILABLE if no such agreement exists.
 * - Maintenance cars are never overridden.
 */

const VALID_CAR_STATUSES = ['available', 'rented', 'maintenance'];
const EXCLUDED_AGREEMENT_STATUS = 'Deleted';

// Statuses that mean the agreement is finished (car returned)
const FINISHED_STATUSES = ['Completed', 'Cancelled', 'Deleted'];

/**
 * Check if an agreement means the car is currently rented.
 * Pure date-based: end_date >= today AND not finished.
 */
function isAgreementActive(agreement, today) {
  // If agreement is finished, car is not rented
  if (FINISHED_STATUSES.includes(agreement.status)) return false;

  // If end_date >= today, the rental is still ongoing
  return agreement.end_date >= today;
}

/**
 * Filter agreements to only recent ones (past month + future).
 * Avoids scanning thousands of old agreements.
 */
function getRecentAgreements(agreements) {
  const oneMonthAgo = daysFromNowMYT(-30);
  return agreements.filter(a =>
    a.end_date >= oneMonthAgo &&
    !FINISHED_STATUSES.includes(a.status)
  );
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

  // Build map: car_plate → active agreements
  const activePlates = new Map(); // plate → agreement
  const overduePlates = new Set();

  for (const agreement of recent) {
    if (isAgreementActive(agreement, today)) {
      const plate = agreement.car_plate?.toUpperCase();
      if (plate) {
        activePlates.set(plate, agreement);

        // Overdue: end_date has passed
        if (isOverdue(agreement.end_date)) {
          overduePlates.add(plate);
        }
      }
    }
  }

  const validated = cars.map(car => {
    const plate = car.car_plate?.toUpperCase();
    const copy = { ...car };

    // Skip maintenance cars — don't override manual maintenance status
    if (car.status === 'maintenance') return copy;

    const activeAgreement = activePlates.get(plate);
    const hasActiveAgreement = !!activeAgreement;
    const isOverdueReturn = overduePlates.has(plate);

    const carLabel = plate || [car.make, car.model, car.year].filter(Boolean).join(' ') || `ID:${car.id}`;

    if (car.status === 'available' && hasActiveAgreement) {
      mismatches.push({
        plate,
        carLabel,
        dbStatus: 'available',
        actualStatus: 'rented',
        reason: `Has agreement (${activeAgreement.status}) ending ${activeAgreement.end_date}`,
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
 * Filter agreements — exclude deleted.
 */
function filterValidAgreements(agreements) {
  return agreements.filter(a => a.status !== EXCLUDED_AGREEMENT_STATUS);
}

module.exports = {
  validateFleetStatus,
  isAgreementActive,
  getRecentAgreements,
  filterValidCars,
  filterValidAgreements,
  VALID_CAR_STATUSES,
  EXCLUDED_AGREEMENT_STATUS,
  FINISHED_STATUSES,
};
