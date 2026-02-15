const supabase = require('../client');
const { agreements } = require('../schemas');
const { ACTIVE_STATUSES } = agreements;
const { EXCLUDED_AGREEMENT_STATUSES } = require('../../utils/validators');
const { todayMYT, daysFromNowMYT, formatMYT } = require('../../utils/time');

/**
 * Agreements Service
 * DB columns: plate_number, mobile, date_start, date_end, total_price, car_type
 * Excludes Deleted + Cancelled by default.
 */
class AgreementsService {
  // ─── Base query (excludes Deleted + Cancelled) ───────

  _baseQuery(fields = agreements.FIELDS.ALL) {
    return supabase
      .from(agreements.TABLE)
      .select(fields)
      .not('status', 'in', `(${EXCLUDED_AGREEMENT_STATUSES.join(',')})`);
  }

  /**
   * Fetch all rows from a query (bypasses Supabase 1000-row default limit).
   */
  async _fetchAll(query) {
    const PAGE = 1000;
    let all = [];
    let offset = 0;
    while (true) {
      const { data, error } = await query.range(offset, offset + PAGE - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  // ─── Booking Queries ──────────────────────────────────

  async getActiveAgreements() {
    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', ACTIVE_STATUSES)
      .order('date_end');
    if (error) throw error;
    return data;
  }

  async getAllAgreements() {
    return this._fetchAll(
      this._baseQuery(agreements.FIELDS.SUMMARY)
        .order('created_at', { ascending: false })
    );
  }

  async getOverdueAgreements() {
    const today = todayMYT();
    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', ACTIVE_STATUSES)
      .lt('date_end', today)
      .order('date_end');
    if (error) throw error;
    return data;
  }

  async getExpiringAgreements(daysAhead = 3) {
    const today = todayMYT();
    const cutoff = daysFromNowMYT(daysAhead);

    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', ACTIVE_STATUSES)
      .gte('date_end', today)
      .lte('date_end', cutoff)
      .order('date_end');
    if (error) throw error;
    return data;
  }

  async getAgreementsByPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    const { data, error } = await this._baseQuery()
      .or(`mobile.ilike.%${clean}%,mobile.ilike.%${phone}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getAgreementsByPlate(plate) {
    const { data, error } = await this._baseQuery()
      .ilike('plate_number', plate)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getAgreementsByCustomerName(name) {
    const { data, error } = await this._baseQuery(agreements.FIELDS.SUMMARY)
      .ilike('customer_name', `%${name}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getAgreementById(id) {
    const { data, error } = await this._baseQuery()
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  // ─── Financial ────────────────────────────────────────

  async getEarnings(startDate, endDate) {
    let query = this._baseQuery(agreements.FIELDS.FINANCIAL)
      .in('status', [...ACTIVE_STATUSES, agreements.STATUS.COMPLETED]);

    if (startDate) query = query.gte('date_start', startDate);
    if (endDate) query = query.lte('date_start', endDate);

    const { data, error } = await query;
    if (error) throw error;

    const total = data.reduce((sum, a) => sum + (parseFloat(a.total_price) || 0), 0);
    const collected = data.reduce((sum, a) => sum + (parseFloat(a.paid) || 0), 0);
    const pending = total - collected;

    return { total, collected, pending, count: data.length, agreements: data };
  }

  async getTodayEarnings() {
    const today = todayMYT();
    return this.getEarnings(today, today);
  }

  async getMonthEarnings() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = new Date(year, month, 1).toISOString().split('T')[0];
    const end = new Date(year, month + 1, 0).toISOString().split('T')[0];
    return this.getEarnings(start, end);
  }

  // ─── Status Updates ───────────────────────────────────

  async updateStatus(id, status) {
    if (EXCLUDED_AGREEMENT_STATUSES.includes(status)) {
      throw new Error('Cannot set status to deleted/cancelled via this method');
    }
    const updates = { status, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from(agreements.TABLE)
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ─── Customer Queries (from agreements data) ──────────

  async getUniqueCustomers() {
    const data = await this._fetchAll(
      this._baseQuery('customer_name, mobile')
        .order('customer_name')
    );

    const seen = new Map();
    for (const row of data) {
      if (row.mobile && !seen.has(row.mobile)) {
        seen.set(row.mobile, row);
      }
    }
    return Array.from(seen.values());
  }

  async getCustomerHistory(phone) {
    const clean = phone.replace(/\D/g, '');
    const { data, error } = await this._baseQuery()
      .or(`mobile.ilike.%${clean}%,mobile.ilike.%${phone}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (data.length === 0) return null;

    const totalSpent = data
      .filter(a => a.status !== agreements.STATUS.CANCELLED)
      .reduce((sum, a) => sum + (parseFloat(a.total_price) || 0), 0);

    return {
      name: data[0].customer_name,
      phone: data[0].mobile,
      totalRentals: data.length,
      totalSpent,
      activeRentals: data.filter(a => ACTIVE_STATUSES.includes(a.status)),
      pastRentals: data.filter(a => a.status === agreements.STATUS.COMPLETED),
      agreements: data,
    };
  }

  async getTopCustomers(limit = 10) {
    const data = await this._fetchAll(
      this._baseQuery('customer_name, mobile, total_price, status')
        .in('status', [...ACTIVE_STATUSES, agreements.STATUS.COMPLETED])
    );

    const map = new Map();
    for (const row of data) {
      const key = row.mobile || row.customer_name;
      if (!map.has(key)) {
        map.set(key, { name: row.customer_name, phone: row.mobile, totalSpent: 0, rentals: 0 });
      }
      const entry = map.get(key);
      entry.totalSpent += parseFloat(row.total_price) || 0;
      entry.rentals++;
    }

    return Array.from(map.values())
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }

  // ─── Stats ────────────────────────────────────────────

  async getStats() {
    const active = await this.getActiveAgreements();
    const overdue = await this.getOverdueAgreements();
    const expiring = await this.getExpiringAgreements();
    const monthEarnings = await this.getMonthEarnings();
    const customers = await this.getUniqueCustomers();

    return {
      activeCount: active.length,
      overdueCount: overdue.length,
      expiringCount: expiring.length,
      monthRevenue: monthEarnings.total,
      monthCollected: monthEarnings.collected,
      totalCustomers: customers.length,
    };
  }
}

module.exports = new AgreementsService();
