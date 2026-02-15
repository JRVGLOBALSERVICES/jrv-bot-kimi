/**
 * Test Location Service — Google Maps, zones, reverse geocoding.
 * Run: npm run test:location
 */
require('dotenv').config();
const location = require('./utils/location');

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  JARVIS Location Service Test');
  console.log('═══════════════════════════════════════\n');

  // ─── 1. Google Maps Links ────────────────────────
  console.log('1. Google Maps Links\n');

  const jrv = location.jrvLocation();
  console.log(`  JRV Office: ${jrv}`);
  console.log(`  KL Link:    ${location.mapsLink(3.1390, 101.6869, 'Kuala Lumpur')}`);
  console.log(`  Directions: ${location.directionsToJrv(3.1390, 101.6869)}`);
  console.log('  ✓ Maps links generated\n');

  // ─── 2. Distance Calculation ─────────────────────
  console.log('2. Distance Calculation (Haversine)\n');

  const tests = [
    { name: 'Seremban (JRV)', lat: 2.7258, lng: 101.9424, expectedZone: 'free' },
    { name: 'Senawang',       lat: 2.6839, lng: 101.9513, expectedZone: 'free' },
    { name: 'Nilai',          lat: 2.8162, lng: 101.7967, expectedZone: 'zone1' },
    { name: 'Port Dickson',   lat: 2.5228, lng: 101.7966, expectedZone: 'zone1' },
    { name: 'KLIA',           lat: 2.7456, lng: 101.7099, expectedZone: 'zone2' },
    { name: 'Kuala Lumpur',   lat: 3.1390, lng: 101.6869, expectedZone: 'zone3' },
    { name: 'Melaka',         lat: 2.1896, lng: 102.2501, expectedZone: 'zone3' },
  ];

  let allPassed = true;
  for (const t of tests) {
    const dist = location.distanceToJrv(t.lat, t.lng);
    const zone = location.matchDeliveryZone(t.lat, t.lng);
    const pass = zone.zone === t.expectedZone;
    if (!pass) allPassed = false;
    const icon = pass ? '✓' : '✗';
    const feeStr = zone.fee === 0 ? 'FREE' : `RM${zone.fee}`;
    console.log(`  ${icon} ${t.name.padEnd(15)} ${dist.toFixed(1).padStart(5)}km  zone=${zone.zone.padEnd(6)} fee=${feeStr.padEnd(6)} ${!pass ? `EXPECTED ${t.expectedZone}` : ''}`);
  }
  console.log(`  ${allPassed ? '✓ All zone matches correct' : '✗ Some zone matches WRONG'}\n`);

  // ─── 3. Reverse Geocoding ────────────────────────
  console.log('3. Reverse Geocoding (Nominatim — needs internet)\n');

  try {
    const geo = await location.reverseGeocode(2.7258, 101.9424);
    if (geo.fullAddress) {
      console.log(`  ✓ Seremban: ${geo.fullAddress.slice(0, 100)}`);
      console.log(`    Area: ${geo.area}, City: ${geo.city}, State: ${geo.state}`);
    } else {
      console.log('  ⚠ No address returned (network issue?)');
    }
  } catch (err) {
    console.log(`  ⚠ Reverse geocode failed: ${err.message}`);
    console.log('    This requires internet access to Nominatim API.');
  }

  // ─── 4. Location Message Parsing ─────────────────
  console.log('\n4. Location Message Parsing\n');

  // Simulate WhatsApp location message
  const mockMsg = {
    location: { latitude: 2.7456, longitude: 101.7099, description: 'KLIA', address: '' },
    body: '',
  };
  const parsed = location.parseLocationMessage(mockMsg);
  if (parsed) {
    console.log(`  ✓ Parsed: lat=${parsed.lat}, lng=${parsed.lng}`);
    console.log(`    Maps: ${parsed.mapsLink}`);
    console.log(`    Directions: ${parsed.directionsLink}`);
  } else {
    console.log('  ✗ Failed to parse location message');
  }

  // Text with coordinates
  const textMsg = { body: 'I am at 3.139, 101.6869' };
  const textParsed = location.parseLocationMessage(textMsg);
  if (textParsed) {
    console.log(`  ✓ Text coords: lat=${textParsed.lat}, lng=${textParsed.lng}`);
  }

  // ─── 5. Full Location Response ───────────────────
  console.log('\n5. Full Location Response (what customer sees)\n');

  try {
    const response = await location.formatLocationResponse(2.7456, 101.7099, 'Test Customer', false);
    console.log('  --- Customer View ---');
    response.split('\n').forEach(line => console.log(`  ${line}`));
  } catch (err) {
    console.log(`  ⚠ Response format failed: ${err.message}`);
  }

  try {
    const adminResp = await location.formatLocationResponse(3.1390, 101.6869, 'Test Admin', true);
    console.log('\n  --- Admin View ---');
    adminResp.split('\n').forEach(line => console.log(`  ${line}`));
  } catch (err) {
    console.log(`  ⚠ Admin response failed: ${err.message}`);
  }

  // ─── 6. Admin Notification Format ────────────────
  console.log('\n6. Admin Notification Format\n');

  const zone = location.matchDeliveryZone(2.7456, 101.7099);
  const notif = location.formatLocationNotification('60123456789', 'Ahmad', 2.7456, 101.7099, zone, { area: 'Sepang' });
  notif.split('\n').forEach(line => console.log(`  ${line}`));

  // ─── Summary ─────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  Location Test Complete');
  console.log('═══════════════════════════════════════\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
