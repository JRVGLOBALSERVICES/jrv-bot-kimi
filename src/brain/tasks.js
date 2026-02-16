/**
 * JARVIS Task Manager — Create, Assign & Track Tasks for the Team
 *
 * Boss or admins can create tasks and assign them:
 *   "Create task: Clean Proton X50 WCD1234 — assign to Vir Uncle — due tomorrow"
 *   "What tasks are pending?"
 *   "Mark task #3 as done"
 *
 * Task lifecycle: pending → in_progress → completed / cancelled
 *
 * Features:
 *   - Assign to team members (by name or phone)
 *   - Due dates with overdue detection
 *   - Priority levels (low, normal, high, urgent)
 *   - Categories (maintenance, delivery, cleaning, paperwork, followup, other)
 *   - Auto-reminder when tasks are overdue
 *   - Linked to cars or customers (optional)
 *
 * Storage: Supabase bot_data_store with key prefix "task:"
 */

const { dataStoreService } = require('../supabase/services');
const { todayMYT, formatMYT } = require('../utils/time');

class TaskManager {
  constructor() {
    this._tasks = [];
    this._loaded = false;
  }

  async load() {
    try {
      const data = await dataStoreService.getByKeyPrefix('task:');
      this._tasks = (data || []).map(entry => ({
        id: entry.key.replace('task:', ''),
        ...(typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value),
      }));
      this._loaded = true;
      console.log(`[Tasks] Loaded ${this._tasks.length} tasks`);
    } catch (err) {
      console.error('[Tasks] Failed to load:', err.message);
      this._loaded = true;
    }
  }

  /**
   * Create a new task.
   */
  async create({
    title,
    description = '',
    assignedTo = null,
    assignedName = null,
    dueDate = null,
    priority = 'normal',
    category = 'other',
    linkedCar = null,
    linkedCustomer = null,
    createdBy = 'boss',
  }) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

    const task = {
      title,
      description,
      status: 'pending',
      assignedTo,     // phone number
      assignedName,   // display name
      dueDate,        // ISO string or "today", "tomorrow"
      priority,
      category,
      linkedCar,      // plate number
      linkedCustomer, // phone
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      notes: [],
    };

    // Parse relative due dates
    if (task.dueDate) {
      task.dueDate = this._parseDueDate(task.dueDate);
    }

    await dataStoreService.setValue(`task:${id}`, task);
    this._tasks.push({ id, ...task });

    console.log(`[Tasks] Created: ${id} — "${title}" (${priority})`);
    return { id, ...task };
  }

  /**
   * Update task status.
   */
  async updateStatus(id, status) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return null;

    task.status = status;
    task.updatedAt = new Date().toISOString();
    if (status === 'completed') task.completedAt = new Date().toISOString();

    await dataStoreService.setValue(`task:${id}`, task);
    console.log(`[Tasks] ${id} → ${status}`);
    return task;
  }

  /**
   * Add a note to a task.
   */
  async addNote(id, note, addedBy = 'admin') {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return null;

    task.notes.push({ text: note, addedBy, addedAt: new Date().toISOString() });
    task.updatedAt = new Date().toISOString();

    await dataStoreService.setValue(`task:${id}`, task);
    return task;
  }

  /**
   * List tasks with filters.
   */
  list(filters = {}) {
    let tasks = [...this._tasks];

    if (filters.status) {
      tasks = tasks.filter(t => t.status === filters.status);
    } else {
      // By default, exclude completed/cancelled unless explicitly requested
      tasks = tasks.filter(t => !['completed', 'cancelled'].includes(t.status));
    }

    if (filters.assignedTo) {
      tasks = tasks.filter(t =>
        t.assignedTo === filters.assignedTo ||
        (t.assignedName || '').toLowerCase().includes(filters.assignedTo.toLowerCase())
      );
    }

    if (filters.category) {
      tasks = tasks.filter(t => t.category === filters.category);
    }

    if (filters.priority) {
      tasks = tasks.filter(t => t.priority === filters.priority);
    }

    if (filters.linkedCar) {
      tasks = tasks.filter(t => t.linkedCar === filters.linkedCar);
    }

    // Sort: urgent first, then by due date
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    tasks.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      if (a.dueDate) return -1;
      return 1;
    });

    return tasks;
  }

  /**
   * Get overdue tasks.
   */
  getOverdue() {
    const now = new Date();
    return this._tasks.filter(t =>
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      t.dueDate &&
      new Date(t.dueDate) < now
    );
  }

  /**
   * Get tasks due today.
   */
  getDueToday() {
    const today = todayMYT();
    return this._tasks.filter(t =>
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      t.dueDate &&
      t.dueDate.startsWith(today)
    );
  }

  /**
   * Delete a task.
   */
  async delete(id) {
    const idx = this._tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;

    this._tasks[idx].status = 'cancelled';
    await dataStoreService.setValue(`task:${id}`, this._tasks[idx]);
    console.log(`[Tasks] Cancelled: ${id}`);
    return true;
  }

  /**
   * Build summary for daily reports or system prompt.
   */
  buildSummary() {
    const pending = this.list({ status: 'pending' });
    const inProgress = this.list({ status: 'in_progress' });
    const overdue = this.getOverdue();

    if (pending.length === 0 && inProgress.length === 0) return '';

    const parts = ['=== ACTIVE TASKS ==='];

    if (overdue.length > 0) {
      parts.push(`⚠️ OVERDUE (${overdue.length}):`);
      for (const t of overdue) {
        parts.push(`  - [${t.priority.toUpperCase()}] ${t.title}${t.assignedName ? ` → ${t.assignedName}` : ''} (due: ${t.dueDate})`);
      }
    }

    if (inProgress.length > 0) {
      parts.push(`IN PROGRESS (${inProgress.length}):`);
      for (const t of inProgress) {
        parts.push(`  - ${t.title}${t.assignedName ? ` → ${t.assignedName}` : ''}`);
      }
    }

    if (pending.length > 0) {
      parts.push(`PENDING (${pending.length}):`);
      for (const t of pending.slice(0, 10)) { // Cap at 10 to keep prompt compact
        parts.push(`  - ${t.title}${t.assignedName ? ` → ${t.assignedName}` : ''}`);
      }
      if (pending.length > 10) parts.push(`  ... and ${pending.length - 10} more`);
    }

    parts.push('');
    return parts.join('\n');
  }

  // ─── Helpers ──────────────────────────────────────────

  _parseDueDate(input) {
    if (!input) return null;

    const str = String(input).toLowerCase().trim();

    if (str === 'today') {
      return todayMYT() + 'T23:59:00+08:00';
    }
    if (str === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10) + 'T23:59:00+08:00';
    }
    if (str.match(/^in (\d+) days?$/)) {
      const days = parseInt(str.match(/\d+/)[0]);
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10) + 'T23:59:00+08:00';
    }

    // If it looks like ISO, use as-is
    if (str.match(/^\d{4}-\d{2}-\d{2}/)) return input;

    return input; // Return as-is, AI will format it
  }

  getStats() {
    const active = this._tasks.filter(t => !['completed', 'cancelled'].includes(t.status));
    return {
      total: this._tasks.length,
      pending: active.filter(t => t.status === 'pending').length,
      inProgress: active.filter(t => t.status === 'in_progress').length,
      completed: this._tasks.filter(t => t.status === 'completed').length,
      overdue: this.getOverdue().length,
    };
  }
}

module.exports = new TaskManager();
