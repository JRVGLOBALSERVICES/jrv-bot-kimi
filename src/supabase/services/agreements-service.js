const supabase = require('../client');
const { agreements } = require('../schemas');
const { EXCLUDED_AGREEMENT_STATUS } = require('../../utils/validators');
const { todayMYT, daysFromNowMYT, formatMYT } = require('../../utils/time');

/**
 * Agreements Service
 * All statuses are valid EXCEPT 'deleted'.
 * All dates in DB are UTC — converted to MYT for queries and display.
 */
class AgreementsService {
  // ─── Base query (excludes deleted) ────────────────────

  _baseQuery(fields = agreements.FIELDS.ALL) {
    return supabase
      .from(agreements.TABLE)
      .select(fields)
      .neq('status', EXCLUDED_AGREEMENT_STATUS);
  }

  // ─── Booking Queries ──────────────────────────────────

  async getActiveAgreements() {
    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', [agreements.STATUS.ACTIVE, agreements.STATUS.EXTENDED])
      .order('end_date');
    if (error) throw error;
    return data;
  }

  async getAllAgreements() {
    const { data, error } = await this._baseQuery(agreements.FIELDS.SUMMARY)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getOverdueAgreements() {
    const today = todayMYT();
    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', [agreements.STATUS.ACTIVE, agreements.STATUS.EXTENDED])
      .lt('end_date', today)
      .order('end_date');
    if (error) throw error;
    return data;
  }

  async getExpiringAgreements(daysAhead = 3) {
    const today = todayMYT();
    const cutoff = daysFromNowMYT(daysAhead);

    const { data, error } = await this._baseQuery(agreements.FIELDS.ACTIVE)
      .in('status', [agreements.STATUS.ACTIVE, agreements.STATUS.EXTENDED])
      .gte('end_date', today)
      .lte('end_date', cutoff)
      .order('end_date');
    if (error) throw error;
    return data;
  }

  async getAgreementsByPhone(phone) {
    const clean = phone.replace(/\D/g, '');
    const { data, error } = await this._baseQuery()
      .or(`customer_phone.ilike.%${clean}%,customer_phone.ilike.%${phone}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async getAgreementsByPlate(plate) {
    const { data, error } = await this._baseQuery()
      .ilike('car_plate', plate)
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
      .in('status', [agreements.STATUS.ACTIVE, agreements.STATUS.COMPLETED, agreements.STATUS.EXTENDED]);

    if (startDate) query = query.gte('start_date', startDate);
    if (endDate) query = query.lte('start_date', endDate);

    const { data, error } = await query;
    if (error) throw error;

    const total = data.reduce((sum, a) => sum + (parseFloat(a.total_amount) || 0), 0);
    const collected = data.filter(a => a.payment_status === 'paid')
      .reduce((sum, a) => sum + (parseFloat(a.total_amount) || 0), 0);
    const pending = data.filter(a => a.payment_status !== 'paid')
      .reduce((sum, a) => sum + (parseFloat(a.total_amount) || 0), 0);

    return { total, collected, pending, count: data.length, agreements: data };
  }

  async getTodayEarnings() {
    const today = todayMYT();
    return this.getEarnings(today, today);
  }

  async getMonthEarnings() {
    const now = new Date();
    // Use MYT for month boundaries
    const year = now.getFullYear();
    const month = now.getMonth();
    const start = new Date(year, month, 1).toISOString().split('T')[0];
    const end = new Date(year, month + 1, 0).toISOString().split('T')[0];
    return this.getEarnings(start, end);
  }

  // ─── Status Updates ───────────────────────────────────

  async updateStatus(id, status) {
    if (status === EXCLUDED_AGREEMENT_STATUS) {
      throw new Error('Cannot set status to deleted via this method');
    }
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === agreements.STATUS.COMPLETED) {
      updates.actual_return_date = todayMYT();
    }
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
    const { data, error } = await this._baseQuery('customer_name, customer_phone')
      .order('customer_name');
    if (error) throw error;

    const seen = new Map();
    for (const row of data) {
      if (row.customer_phone && !seen.has(row.customer_phone)) {
        seen.set(row.customer_phone, row);
      }
    }
    return Array.from(seen.values());
  }

  async getCustomerHistory(phone) {
    const clean = phone.replace(/\D/g, '');
    const { data, error } = await this._baseQuery()
      .or(`customer_phone.ilike.%${clean}%,customer_phone.ilike.%${phone}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (data.length === 0) return null;

    const totalSpent = data
      .filter(a => a.status !== agreements.STATUS.CANCELLED)
      .reduce((sum, a) => sum + (parseFloat(a.total_amount) || 0), 0);

    return {
      name: data[0].customer_name,
      phone: data[0].customer_phone,
      totalRentals: data.length,
      totalSpent,
      activeRentals: data.filter(a => ['active', 'extended'].includes(a.status)),
      pastRentals: data.filter(a => a.status === agreements.STATUS.COMPLETED),
      agreements: data,
    };
  }

  async getTopCustomers(limit = 10) {
    const { data, error } = await this._baseQuery('customer_name, customer_phone, total_amount, status')
      .in('status', [agreements.STATUS.ACTIVE, agreements.STATUS.COMPLETED, agreements.STATUS.EXTENDED]);
    if (error) throw error;

    const map = new Map();
    for (const row of data) {
      const key = row.customer_phone || row.customer_name;
      if (!map.has(key)) {
        map.set(key, { name: row.customer_name, phone: row.customer_phone, totalSpent: 0, rentals: 0 });
      }
      const entry = map.get(key);
      entry.totalSpent += parseFloat(row.total_amount) || 0;
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
