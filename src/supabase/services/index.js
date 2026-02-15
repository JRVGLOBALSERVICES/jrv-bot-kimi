const fleetService = require('./fleet-service');
const agreementsService = require('./agreements-service');
const dataStoreService = require('./data-store-service');
const syncEngine = require('./sync');

module.exports = {
  fleetService,
  agreementsService,
  dataStoreService,
  syncEngine,
};
