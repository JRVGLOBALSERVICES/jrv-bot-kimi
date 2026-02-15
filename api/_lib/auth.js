/**
 * Auth middleware for dashboard API.
 * Checks Authorization header against DASHBOARD_SECRET env var.
 *
 * Usage in API route:
 *   const { auth } = require('./_lib/auth');
 *   if (!auth(req, res)) return;
 */

function auth(req, res) {
  const secret = process.env.DASHBOARD_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'DASHBOARD_SECRET not configured' });
    return false;
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;

  if (token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

module.exports = { auth };
