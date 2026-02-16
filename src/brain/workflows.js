/**
 * JARVIS Auto-Actions / Workflows — Autonomous Behavior Engine
 *
 * Makes JARVIS act WITHOUT being asked. Triggered by events:
 *
 *   - after_hours: Auto-reply when messages come after business hours
 *   - new_customer: Greet first-time customers differently
 *   - payment_received: Auto-thank and update records
 *   - rental_expiring: Auto-remind customer before expiry
 *   - overdue_return: Escalating reminders for late returns
 *   - customer_inactive: Follow up with customers who haven't replied
 *   - booking_confirmed: Send agreement summary and payment details
 *
 * Workflows can be:
 *   - Built-in (hardcoded, always available)
 *   - Custom (boss creates via chat, stored in Supabase)
 *
 * Storage: Custom workflows in "workflow:" prefix
 */

const { dataStoreService } = require('../supabase/services');
const { todayMYT } = require('../utils/time');

class WorkflowEngine {
  constructor() {
    this._workflows = [];
    this._executionLog = []; // Last 100 executions
    this._loaded = false;
  }

  async load() {
    try {
      const data = await dataStoreService.getByKeyPrefix('workflow:');
      this._workflows = (data || []).map(entry => ({
        id: entry.key.replace('workflow:', ''),
        ...(typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value),
      }));
      this._loaded = true;
      console.log(`[Workflows] Loaded ${this._workflows.length} custom workflows`);
    } catch (err) {
      console.error('[Workflows] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Check if any workflow should trigger for this event.
   * Returns actions to take, or null.
   */
  async evaluate(event, context = {}) {
    const actions = [];

    // Check built-in workflows
    const builtin = this._evaluateBuiltin(event, context);
    if (builtin) actions.push(...builtin);

    // Check custom workflows
    for (const wf of this._workflows) {
      if (!wf.enabled) continue;
      if (wf.trigger !== event) continue;

      // Check conditions
      if (this._meetsConditions(wf.conditions, context)) {
        actions.push({
          source: `workflow:${wf.id}`,
          type: wf.actionType || 'reply',
          message: this._interpolate(wf.message || '', context),
          data: wf.data || {},
        });
      }
    }

    // Log execution
    if (actions.length > 0) {
      this._logExecution(event, actions);
    }

    return actions.length > 0 ? actions : null;
  }

  /**
   * Create a custom workflow.
   */
  async create({
    name,
    trigger,
    conditions = {},
    actionType = 'reply',
    message = '',
    data = {},
    createdBy = 'boss',
  }) {
    const id = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    const workflow = {
      name,
      trigger,
      conditions,
      actionType,  // reply, notify_admin, create_task, escalate
      message,
      data,
      enabled: true,
      createdBy,
      createdAt: new Date().toISOString(),
      executions: 0,
    };

    await dataStoreService.setValue(`workflow:${id}`, workflow);

    const existing = this._workflows.findIndex(w => w.id === id);
    if (existing >= 0) {
      this._workflows[existing] = { id, ...workflow };
    } else {
      this._workflows.push({ id, ...workflow });
    }

    console.log(`[Workflows] Created: ${id} (trigger: ${trigger})`);
    return { id, ...workflow };
  }

  /**
   * Toggle a workflow on/off.
   */
  async toggle(id, enabled) {
    const wf = this._workflows.find(w => w.id === id);
    if (!wf) return null;

    wf.enabled = enabled;
    await dataStoreService.setValue(`workflow:${id}`, wf);
    return wf;
  }

  /**
   * Delete a custom workflow.
   */
  async delete(id) {
    const idx = this._workflows.findIndex(w => w.id === id);
    if (idx === -1) return false;

    this._workflows[idx].enabled = false;
    await dataStoreService.setValue(`workflow:${id}`, this._workflows[idx]);
    this._workflows.splice(idx, 1);
    return true;
  }

  /**
   * List all workflows (built-in + custom).
   */
  list() {
    return {
      builtin: [
        { id: 'after_hours', trigger: 'after_hours', name: 'After-hours auto-reply', enabled: true },
        { id: 'new_customer', trigger: 'new_customer', name: 'First-time customer greeting', enabled: true },
        { id: 'long_wait', trigger: 'long_wait', name: 'Follow-up after 30min no reply from admin', enabled: true },
      ],
      custom: this._workflows.filter(w => w.enabled),
    };
  }

  // ─── Built-in Workflows ───────────────────────────────

  _evaluateBuiltin(event, ctx) {
    switch (event) {
      case 'after_hours': {
        // Check if current time is outside business hours (8am-10pm MYT)
        const hour = new Date().getUTCHours() + 8; // MYT = UTC+8
        const normalizedHour = hour >= 24 ? hour - 24 : hour;
        if (normalizedHour < 8 || normalizedHour >= 22) {
          return [{
            source: 'builtin:after_hours',
            type: 'context',
            message: 'Note: This customer is messaging outside business hours (before 8am or after 10pm MYT). Be helpful but mention that for urgent matters, they can call +60126565477.',
          }];
        }
        return null;
      }

      case 'new_customer': {
        if (ctx.isFirstInteraction) {
          return [{
            source: 'builtin:new_customer',
            type: 'context',
            message: 'This is a FIRST-TIME customer. Be extra welcoming. Introduce JRV briefly. Ask how you can help.',
          }];
        }
        return null;
      }

      case 'returning_customer': {
        if (ctx.totalBookings > 3) {
          return [{
            source: 'builtin:returning_customer',
            type: 'context',
            message: `Loyal returning customer (${ctx.totalBookings} bookings). Be warm, recognize their loyalty. May offer priority service.`,
          }];
        }
        return null;
      }

      case 'long_wait': {
        if (ctx.waitMinutes > 30) {
          return [{
            source: 'builtin:long_wait',
            type: 'notify_admin',
            message: `Customer ${ctx.customerName || ctx.phone} has been waiting ${ctx.waitMinutes}min for a reply.`,
          }];
        }
        return null;
      }

      default:
        return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────

  _meetsConditions(conditions, context) {
    if (!conditions || Object.keys(conditions).length === 0) return true;

    for (const [key, expected] of Object.entries(conditions)) {
      const actual = context[key];
      if (actual === undefined) return false;

      // Simple equality
      if (typeof expected !== 'object') {
        if (actual !== expected) return false;
        continue;
      }

      // Comparison operators
      if (expected.$gt && !(actual > expected.$gt)) return false;
      if (expected.$lt && !(actual < expected.$lt)) return false;
      if (expected.$gte && !(actual >= expected.$gte)) return false;
      if (expected.$in && !expected.$in.includes(actual)) return false;
      if (expected.$contains && !String(actual).includes(expected.$contains)) return false;
    }

    return true;
  }

  _interpolate(template, ctx) {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return ctx[key] !== undefined ? String(ctx[key]) : match;
    });
  }

  _logExecution(event, actions) {
    this._executionLog.push({
      event,
      actions: actions.map(a => a.source),
      at: new Date().toISOString(),
    });
    // Keep last 100
    if (this._executionLog.length > 100) {
      this._executionLog = this._executionLog.slice(-100);
    }
  }

  getStats() {
    return {
      customWorkflows: this._workflows.filter(w => w.enabled).length,
      recentExecutions: this._executionLog.length,
      lastExecution: this._executionLog.length > 0
        ? this._executionLog[this._executionLog.length - 1]
        : null,
    };
  }
}

module.exports = new WorkflowEngine();
