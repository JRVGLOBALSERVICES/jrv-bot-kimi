const fs = require('fs');
const path = require('path');

/**
 * File Safety Protocol — Prevents accidental deletion, auto-backups on edit.
 *
 * Rules:
 * 1. Files cannot be deleted — they are moved to .trash/ instead
 * 2. Before overwriting a file, a backup is created in .backups/
 * 3. Only the boss can permanently delete or restore files
 * 4. Temp files (tmp/, cache/) are exempt from safety (auto-cleanup OK)
 *
 * Usage:
 *   const fileSafety = require('./utils/file-safety');
 *   fileSafety.safeWrite(path, data);   // backup + write
 *   fileSafety.safeDelete(path);        // move to trash
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(PROJECT_ROOT, '.backups');
const TRASH_DIR = path.join(PROJECT_ROOT, '.trash');

// Paths exempt from safety (temp/disposable files)
const EXEMPT_DIRS = ['tmp', 'cache', 'node_modules', '.wwebjs_auth', '.wwebjs_cache'];

class FileSafety {
  constructor() {
    this.auditLog = [];
    this.maxLogEntries = 200;
    this._ensureDirs();
  }

  _ensureDirs() {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    if (!fs.existsSync(TRASH_DIR)) fs.mkdirSync(TRASH_DIR, { recursive: true });
  }

  /**
   * Check if a file path is exempt from safety (temp files).
   */
  isExempt(filePath) {
    const rel = path.relative(PROJECT_ROOT, path.resolve(filePath));
    return EXEMPT_DIRS.some(dir => rel.startsWith(dir + path.sep) || rel.startsWith(dir + '/'));
  }

  /**
   * Write a file with automatic backup of the previous version.
   * If the file already exists and is not exempt, backs it up first.
   */
  safeWrite(filePath, data) {
    const resolved = path.resolve(filePath);

    if (!this.isExempt(resolved) && fs.existsSync(resolved)) {
      this.createBackup(resolved);
    }

    // Ensure parent directory exists
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(resolved, data);
    this._log('write', resolved);
  }

  /**
   * Delete a file safely — moves to .trash/ instead of deleting.
   * Exempt files (tmp/cache) are deleted normally.
   */
  safeDelete(filePath) {
    const resolved = path.resolve(filePath);

    if (!fs.existsSync(resolved)) return;

    if (this.isExempt(resolved)) {
      fs.unlinkSync(resolved);
      return;
    }

    // Move to trash instead of deleting
    const basename = path.basename(resolved);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashName = `${timestamp}_${basename}`;
    const trashPath = path.join(TRASH_DIR, trashName);

    fs.copyFileSync(resolved, trashPath);
    fs.unlinkSync(resolved);
    this._log('trash', resolved, `→ ${trashName}`);
    console.log(`[Safety] Moved to trash: ${basename} → .trash/${trashName}`);
  }

  /**
   * Create a timestamped backup of a file.
   */
  createBackup(filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return null;

    const rel = path.relative(PROJECT_ROOT, resolved);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, timestamp, rel);
    const backupDir = path.dirname(backupPath);

    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    fs.copyFileSync(resolved, backupPath);
    this._log('backup', resolved, `→ .backups/${timestamp}/${rel}`);
    console.log(`[Safety] Backup: ${rel} → .backups/${timestamp}/${rel}`);
    return backupPath;
  }

  /**
   * Restore the most recent backup of a file.
   * Boss-only — caller must verify permission.
   */
  restore(filePath) {
    const resolved = path.resolve(filePath);
    const rel = path.relative(PROJECT_ROOT, resolved);

    // Find all backups for this file
    const backups = this._findBackups(rel);
    if (backups.length === 0) {
      return { success: false, error: `No backups found for ${rel}` };
    }

    // Most recent backup (last in sorted list)
    const latest = backups[backups.length - 1];

    // Backup current version before restoring
    if (fs.existsSync(resolved)) {
      this.createBackup(resolved);
    }

    fs.copyFileSync(latest.path, resolved);
    this._log('restore', resolved, `← ${latest.timestamp}`);
    console.log(`[Safety] Restored: ${rel} from ${latest.timestamp}`);

    return { success: true, file: rel, restoredFrom: latest.timestamp };
  }

  /**
   * List all backups, optionally filtered by file path.
   */
  listBackups(filePath) {
    if (filePath) {
      const rel = path.relative(PROJECT_ROOT, path.resolve(filePath));
      return this._findBackups(rel);
    }

    // List all backup timestamps
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter(name => fs.statSync(path.join(BACKUP_DIR, name)).isDirectory())
      .sort()
      .map(name => ({
        timestamp: name,
        path: path.join(BACKUP_DIR, name),
      }));
  }

  /**
   * List all files in .trash/.
   */
  listTrash() {
    if (!fs.existsSync(TRASH_DIR)) return [];
    return fs.readdirSync(TRASH_DIR)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const filePath = path.join(TRASH_DIR, name);
        const stat = fs.statSync(filePath);
        // Parse timestamp from name: 2026-02-15T10-30-00-000Z_filename.ext
        const parts = name.match(/^(\d{4}-\d{2}-\d{2}T[\d-]+Z?)_(.+)$/);
        return {
          name,
          originalName: parts ? parts[2] : name,
          trashedAt: parts ? parts[1].replace(/-/g, (m, i) => i > 9 ? ':' : m) : 'unknown',
          size: stat.size,
          path: filePath,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Permanently delete a file from .trash/.
   * Boss-only — caller must verify permission.
   */
  permanentDelete(trashFileName) {
    const filePath = path.join(TRASH_DIR, trashFileName);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `Not found in trash: ${trashFileName}` };
    }

    fs.unlinkSync(filePath);
    this._log('permanent-delete', filePath);
    return { success: true, deleted: trashFileName };
  }

  /**
   * Purge all files from .trash/.
   * Boss-only — caller must verify permission.
   */
  purgeTrash() {
    const files = this.listTrash();
    let count = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(file.path);
        count++;
      } catch {}
    }
    this._log('purge-trash', TRASH_DIR, `${count} files`);
    return { success: true, purged: count };
  }

  /**
   * Get audit log.
   */
  getLog(limit = 50) {
    return this.auditLog.slice(-limit);
  }

  // ─── Internal ──────────────────────────────────────

  _findBackups(relativePath) {
    if (!fs.existsSync(BACKUP_DIR)) return [];

    const results = [];
    const timestamps = fs.readdirSync(BACKUP_DIR).filter(name => {
      const p = path.join(BACKUP_DIR, name);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    });

    for (const ts of timestamps.sort()) {
      const backupFile = path.join(BACKUP_DIR, ts, relativePath);
      if (fs.existsSync(backupFile)) {
        results.push({
          timestamp: ts,
          path: backupFile,
          size: fs.statSync(backupFile).size,
        });
      }
    }

    return results;
  }

  _log(action, filePath, detail = '') {
    const entry = {
      action,
      file: path.relative(PROJECT_ROOT, filePath),
      detail,
      timestamp: new Date().toISOString(),
    };
    this.auditLog.push(entry);

    if (this.auditLog.length > this.maxLogEntries) {
      this.auditLog = this.auditLog.slice(-this.maxLogEntries);
    }
  }
}

module.exports = new FileSafety();
