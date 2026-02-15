/**
 * Test Supabase connection and validate all tables.
 * Run: node src/test-connection.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { todayMYT, formatMYT, nowMYT } = require('./utils/time');
const { validateFleetStatus, VALID_CAR_STATUSES, EXCLUDED_AGREEMENT_STATUS } = require('./utils/validators');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function testTable(name, query) {
  try {
    const { data, error, count } = await query;
    if (error) throw error;
    console.log(`  ✓ ${name}: ${data.length} rows`);
    return data;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    return null;
  }
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  JARVIS Connection Test');
  console.log(`  Time (MYT): ${formatMYT(new Date(), 'full')}`);
  console.log(`  Today (MYT): ${todayMYT()}`);
  console.log('═══════════════════════════════════════\n');

  // Test each table
  console.log('1. Testing table access...\n');

  const cars = await testTable('cars',
    supabase.from('cars').select('*').in('status', VALID_CAR_STATUSES));

  const catalog = await testTable('catalog',
    supabase.from('catalog').select('*').eq('is_active', true));

  const agreements = await testTable('agreements',
    supabase.from('agreements').select('*').neq('status', EXCLUDED_AGREEMENT_STATUS));

  const dataStore = await testTable('bot_data_store',
    supabase.from('bot_data_store').select('*').eq('is_active', true));

  // Test time conversion
  console.log('\n2. Time validation...\n');
  console.log(`  UTC now:     ${new Date().toISOString()}`);
  console.log(`  MYT now:     ${formatMYT(new Date(), 'datetime')}`);
  console.log(`  Today (MYT): ${todayMYT()}`);

  // Cross-validate car status with agreements
  if (cars && agreements) {
    console.log('\n3. Cross-validating car status with agreements...\n');

    const activeAgreements = agreements.filter(a => ['active', 'extended'].includes(a.status));
    const { validated, mismatches } = validateFleetStatus(cars, activeAgreements);

    const available = validated.filter(c => (c._validatedStatus || c.status) === 'available');
    const rented = validated.filter(c => (c._validatedStatus || c.status) === 'rented');
    const maintenance = validated.filter(c => (c._validatedStatus || c.status) === 'maintenance');

    console.log(`  Fleet: ${validated.length} cars`);
    console.log(`  Available: ${available.length}`);
    console.log(`  Rented: ${rented.length}`);
    console.log(`  Maintenance: ${maintenance.length}`);

    if (mismatches.length > 0) {
      console.log(`\n  ⚠ ${mismatches.length} STATUS MISMATCHES:`);
      mismatches.forEach(m => {
        console.log(`    ${m.plate}: DB="${m.dbStatus}" → actual="${m.actualStatus}"`);
        console.log(`      ${m.reason}`);
      });
    } else {
      console.log('  ✓ No status mismatches');
    }
  }

  // Check admin config
  if (dataStore) {
    console.log('\n4. Checking admin config from bot_data_store...\n');

    const adminEntries = dataStore.filter(d => d.category === 'admin');
    console.log(`  Admin entries: ${adminEntries.length}`);
    adminEntries.forEach(entry => {
      console.log(`    ${entry.key}: ${JSON.stringify(entry.value).slice(0, 100)}`);
    });

    const categories = [...new Set(dataStore.map(d => d.category))];
    console.log(`\n  Data store categories: ${categories.join(', ')}`);
    categories.forEach(cat => {
      const count = dataStore.filter(d => d.category === cat).length;
      console.log(`    ${cat}: ${count} entries`);
    });
  }

  // Check agreements status distribution
  if (agreements) {
    console.log('\n5. Agreement status distribution...\n');

    const statusCounts = {};
    agreements.forEach(a => {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    });
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  Test complete.');
  console.log('═══════════════════════════════════════\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
