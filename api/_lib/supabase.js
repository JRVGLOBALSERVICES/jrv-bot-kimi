/**
 * Shared Supabase client for Vercel serverless functions.
 * Uses SUPABASE_URL and SUPABASE_KEY from Vercel env vars.
 */
const { createClient } = require('@supabase/supabase-js');

let client = null;

function getClient() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY required');
    client = createClient(url, key);
  }
  return client;
}

module.exports = { getClient };
