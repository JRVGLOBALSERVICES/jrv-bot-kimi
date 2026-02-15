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
    const { data, error } = await query;
    if (error) throw error;
    console.log(`  ✓ ${name}: ${data.length} rows`);
    return data;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch all rows from a Supabase query (bypasses default 1000-row limit).
 */
async function fetchAllRows(baseQuery) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await baseQuery.range(offset, offset + PAGE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  JARVIS Connection Test');
  console.log(`  Time (MYT): ${formatMYT(new Date(), 'full')}`);
  console.log(`  Today (MYT): ${todayMYT()}`);
  console.log('═══════════════════════════════════════\n');

  // ─── 1. Test each table ──────────────────────────────
  console.log('1. Testing table access...\n');

  const cars = await testTable('cars',
    supabase.from('cars').select('*').in('status', VALID_CAR_STATUSES));

  // Fetch ALL agreements (no 1000-row cap)
  let agreements = null;
  try {
    agreements = await fetchAllRows(
      supabase.from('agreements').select('*').neq('status', EXCLUDED_AGREEMENT_STATUS)
    );
    console.log(`  ✓ agreements: ${agreements.length} rows`);
  } catch (err) {
    console.log(`  ✗ agreements: ${err.message}`);
  }

  // bot_data_store — key/value store (no is_active column)
  const dataStore = await testTable('bot_data_store',
    supabase.from('bot_data_store').select('*'));

  // ─── 2. Time validation ──────────────────────────────
  console.log('\n2. Time validation...\n');
  console.log(`  UTC now:     ${new Date().toISOString()}`);
  console.log(`  MYT now:     ${formatMYT(new Date(), 'datetime')}`);
  console.log(`  Today (MYT): ${todayMYT()}`);

  // ─── 3. Cross-validate car status with agreements ────
  if (cars && agreements) {
    console.log('\n3. Cross-validating car status with agreements...\n');

    const activeAgreements = agreements.filter(a => ['New', 'Editted', 'Extended'].includes(a.status));
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
        const label = m.plate || m.carLabel || '(unknown)';
        console.log(`    ${label}: DB="${m.dbStatus}" → actual="${m.actualStatus}"`);
        console.log(`      ${m.reason}`);
      });
    } else {
      console.log('  ✓ No status mismatches');
    }
  }

  // ─── 4. Inspect bot_data_store ───────────────────────
  if (dataStore && dataStore.length > 0) {
    console.log('\n4. Inspecting bot_data_store...\n');

    // Show actual columns from first row
    const columns = Object.keys(dataStore[0]);
    console.log(`  Columns: ${columns.join(', ')}`);
    console.log(`  Total entries: ${dataStore.length}`);

    // Show sample keys (first 10)
    const keys = dataStore.map(d => d.key).filter(Boolean).slice(0, 10);
    if (keys.length > 0) {
      console.log(`\n  Sample keys:`);
      keys.forEach(k => console.log(`    - ${k}`));
      if (dataStore.length > 10) console.log(`    ... and ${dataStore.length - 10} more`);
    }

    // If category column exists, show categories
    if (dataStore[0].category !== undefined) {
      const categories = [...new Set(dataStore.map(d => d.category).filter(Boolean))];
      if (categories.length > 0) {
        console.log(`\n  Categories: ${categories.join(', ')}`);
        categories.forEach(cat => {
          const count = dataStore.filter(d => d.category === cat).length;
          console.log(`    ${cat}: ${count} entries`);
        });
      }
    }
  }

  // ─── 5. Agreement status distribution ────────────────
  if (agreements) {
    console.log('\n5. Agreement status distribution...\n');

    const statusCounts = {};
    agreements.forEach(a => {
      const s = a.status || '(null)';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
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
