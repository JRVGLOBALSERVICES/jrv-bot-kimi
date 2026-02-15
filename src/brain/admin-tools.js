/**
 * Admin Power Tools - Restricted capabilities for RJ only (+60138606455).
 *
 * These are MCP-style tools that ONLY the boss (RJ) can access:
 * - Site generation (HTML/CSS)
 * - Direct Supabase queries
 * - System configuration
 * - AI model switching
 * - Broadcast messages
 * - Data export
 * - Reminder management for all users
 */

const policies = require('./policies');
const reminders = require('./reminders');
const { syncEngine, dataStoreService, fleetService, agreementsService } = require('../supabase/services');
const fileSafety = require('../utils/file-safety');
const cloudinary = require('../media/cloudinary');

const BOSS_PHONE = '60138606455';

class AdminTools {
  constructor() {
    this.whatsapp = null;
  }

  init(whatsappChannel) {
    this.whatsapp = whatsappChannel;
  }

  /**
   * Check if phone has boss-level access.
   */
  isBoss(phone) {
    const clean = phone.replace(/\D/g, '');
    return clean.includes(BOSS_PHONE) || BOSS_PHONE.includes(clean);
  }

  /**
   * Parse and execute admin tool commands.
   * Format: /tool <command> [args]
   */
  async execute(command, args, phone, name) {
    if (!this.isBoss(phone)) {
      return { error: 'Access denied. Boss-only command.' };
    }

    switch (command) {
      case 'site':
      case 'generate-site':
        return this._generateSite(args);

      case 'broadcast':
        return this._broadcast(args);

      case 'export':
        return this._exportData(args);

      case 'config':
        return this._showConfig();

      case 'set':
        return this._setConfig(args);

      case 'sql':
      case 'query':
        return this._queryData(args);

      case 'reminder-all':
        return this._listAllReminders();

      case 'clear-reminders':
        return this._clearReminders(args);

      case 'backups':
        return this._listBackups(args);

      case 'trash':
        return this._listTrash();

      case 'restore':
        return this._restoreFile(args);

      case 'delete':
        return this._deleteFromTrash(args);

      case 'purge-trash':
        return this._purgeTrash();

      case 'safety-log':
        return this._safetyLog();

      case 'pc':
      case 'performance':
        return this._pcPerformance();

      case 'system':
        return this._systemInfo();

      // Cloudinary media tools
      case 'cloud':
      case 'cloudinary':
        return this._cloudinaryInfo();

      case 'cloud-voice':
        return this._cloudList('jrv/voice', 'video');

      case 'cloud-images':
        return this._cloudList('jrv/images', 'image');

      case 'cloud-videos':
        return this._cloudList('jrv/videos', 'video');

      case 'cloud-delete':
        return this._cloudDelete(args);

      case 'generate-image':
      case 'gen-image':
        return this._generateImage(args);

      case 'generate-video':
      case 'gen-video':
        return this._generateVideo(args);

      case 'upload':
        return this._uploadInfo();

      case 'tools':
      case 'help':
        return this._toolsHelp();

      default:
        return { error: `Unknown tool: ${command}`, help: 'Use /tool help for available commands' };
    }
  }

  /**
   * Generate a simple site/page (HTML).
   */
  async _generateSite(args) {
    const description = args.join(' ') || 'JRV Car Rental landing page';

    // Use AI to generate the site
    const aiRouter = require('../ai/router');
    const prompt = `Generate a complete, modern, responsive HTML page with inline CSS and JavaScript for: "${description}".
Requirements:
- Single HTML file with all CSS/JS inline
- Mobile-responsive design
- Professional look with dark/modern theme
- JRV Car Rental branding (Seremban, Malaysia)
- WhatsApp link: +60126565477
- Include only the HTML code, no explanations`;

    const result = await aiRouter.route(prompt, [], { forceCloud: true, isAdmin: true });

    // Extract HTML from response
    let html = result.content;
    const htmlMatch = html.match(/```html\n([\s\S]*?)```/);
    if (htmlMatch) html = htmlMatch[1];

    return {
      type: 'site',
      html,
      description,
      note: 'HTML generated. Save as .html file or host on any server.',
    };
  }

  /**
   * Broadcast message to all admins or specific groups.
   */
  async _broadcast(args) {
    if (args.length === 0) {
      return { error: 'Usage: /tool broadcast <message>' };
    }

    const message = args.join(' ');
    const sent = [];

    for (const admin of policies.admins.list) {
      if (this.whatsapp && this.whatsapp.isConnected && this.whatsapp.isConnected()) {
        try {
          await this.whatsapp.sendText(`${admin.phone}@c.us`, `*Broadcast from Boss:*\n${message}`);
          sent.push(admin.name);
        } catch (err) {
          console.error(`[AdminTools] Broadcast to ${admin.name} failed:`, err.message);
        }
      } else {
        console.log(`[AdminTools → ${admin.name}] ${message}`);
        sent.push(`${admin.name} (logged)`);
      }
    }

    return { sent, message, count: sent.length };
  }

  /**
   * Export data as formatted text.
   */
  async _exportData(args) {
    const type = args[0] || 'all';

    switch (type) {
      case 'cars':
      case 'fleet': {
        const cache = syncEngine.getCache();
        return {
          type: 'fleet',
          count: cache.cars.length,
          data: cache.cars.map(c => ({
            plate: c.plate_number,
            car_name: c._carName || c.body_type || '',
            status: c.status,
            daily_price: c.daily_price,
          })),
        };
      }
      case 'bookings':
      case 'agreements': {
        const active = await agreementsService.getActiveAgreements();
        return {
          type: 'agreements',
          count: active.length,
          data: active,
        };
      }
      case 'store': {
        const cache = syncEngine.getCache();
        return {
          type: 'bot_data_store',
          count: cache.store?.length || 0,
          data: cache.store || [],
        };
      }
      default: {
        const cache = syncEngine.getCache();
        return {
          fleet: cache.cars.length,
          agreements: cache.agreements.length,
          store: cache.store?.length || 0,
          lastSync: cache.lastSync,
        };
      }
    }
  }

  /**
   * Show current system configuration.
   */
  _showConfig() {
    const config = require('../config');
    return {
      mode: config.mode,
      kimi: { model: config.kimi.model, url: config.kimi.apiUrl },
      gemini: { model: config.gemini?.model || 'not configured' },
      localAI: { model: config.localAI.model, url: config.localAI.url },
      tts: { voice: config.tts.edgeVoice },
      admins: policies.admins.list.map(a => `${a.name}(${a.phone})`),
    };
  }

  /**
   * Set runtime configuration.
   */
  _setConfig(args) {
    if (args.length < 2) {
      return { error: 'Usage: /tool set <key> <value>\nKeys: voice, model, mode' };
    }

    const [key, ...valueParts] = args;
    const value = valueParts.join(' ');
    const config = require('../config');

    switch (key) {
      case 'voice':
        config.tts.edgeVoice = value;
        return { set: 'tts.edgeVoice', value };
      case 'model':
        config.kimi.model = value;
        return { set: 'kimi.model', value };
      case 'mode':
        config.mode = value;
        return { set: 'mode', value };
      default:
        return { error: `Unknown config key: ${key}` };
    }
  }

  /**
   * Query Supabase data.
   */
  async _queryData(args) {
    const query = args.join(' ').toLowerCase();

    if (query.includes('car') || query.includes('fleet')) {
      const stats = await fleetService.getFleetStats();
      return stats;
    }
    if (query.includes('expir')) {
      const expiring = await agreementsService.getExpiringAgreements(7);
      return { expiring: expiring.length, data: expiring };
    }
    if (query.includes('overdue')) {
      const overdue = await agreementsService.getOverdueAgreements();
      return { overdue: overdue.length, data: overdue };
    }
    if (query.includes('store') || query.includes('data')) {
      const cache = syncEngine.getCache();
      return { store_entries: cache.store?.length || 0 };
    }

    return { error: `Unknown query: "${args.join(' ')}"`, hint: 'Try: cars, fleet, expiring, overdue, store' };
  }

  /**
   * List all reminders (across all users).
   */
  _listAllReminders() {
    const all = reminders.listAll();
    return {
      total: all.length,
      reminders: all.map(r => ({
        id: r.id,
        text: r.text,
        phone: r.phone,
        name: r.name,
        dueAt: r.dueAt,
        repeat: r.repeat,
      })),
    };
  }

  /**
   * Clear reminders for a specific phone.
   */
  _clearReminders(args) {
    const phone = args[0];
    if (!phone) {
      return { error: 'Usage: /tool clear-reminders <phone>' };
    }
    const count = reminders.deleteAll(phone);
    return { cleared: count, phone };
  }

  // ─── File Safety Commands ──────────────────────────

  /**
   * List backups (optionally for a specific file).
   */
  _listBackups(args) {
    if (args.length > 0) {
      const filePath = args.join(' ');
      const backups = fileSafety.listBackups(filePath);
      return {
        file: filePath,
        backups: backups.map(b => ({
          timestamp: b.timestamp,
          size: `${Math.round(b.size / 1024)}KB`,
        })),
        count: backups.length,
      };
    }

    const all = fileSafety.listBackups();
    return {
      snapshots: all.map(b => b.timestamp),
      count: all.length,
      location: '.backups/',
    };
  }

  /**
   * List files in .trash/.
   */
  _listTrash() {
    const files = fileSafety.listTrash();
    return {
      files: files.map(f => ({
        name: f.name,
        original: f.originalName,
        trashedAt: f.trashedAt,
        size: `${Math.round(f.size / 1024)}KB`,
      })),
      count: files.length,
    };
  }

  /**
   * Restore a file from backup.
   */
  _restoreFile(args) {
    if (args.length === 0) {
      return { error: 'Usage: /tool restore <file-path>' };
    }
    const filePath = args.join(' ');
    return fileSafety.restore(filePath);
  }

  /**
   * Permanently delete a file from .trash/.
   */
  _deleteFromTrash(args) {
    if (args.length === 0) {
      return { error: 'Usage: /tool delete <trash-filename>' };
    }
    const trashFile = args.join(' ');
    return fileSafety.permanentDelete(trashFile);
  }

  /**
   * Purge all files from .trash/.
   */
  _purgeTrash() {
    return fileSafety.purgeTrash();
  }

  /**
   * Show recent file safety audit log.
   */
  _safetyLog() {
    const log = fileSafety.getLog(20);
    return {
      entries: log.map(e => ({
        action: e.action,
        file: e.file,
        detail: e.detail,
        time: e.timestamp,
      })),
      count: log.length,
    };
  }

  // ─── PC Performance Monitor ─────────────────────────

  /**
   * Full PC performance report: CPU, RAM, disk, temp, battery, GPU, network.
   */
  async _pcPerformance() {
    const si = require('systeminformation');

    const [cpu, cpuLoad, cpuTemp, mem, disk, battery, gpu, net, osInfo, processes] = await Promise.all([
      si.cpu().catch(() => null),
      si.currentLoad().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.mem().catch(() => null),
      si.fsSize().catch(() => null),
      si.battery().catch(() => null),
      si.graphics().catch(() => null),
      si.networkStats().catch(() => null),
      si.osInfo().catch(() => null),
      si.processes().catch(() => null),
    ]);

    const GB = 1024 * 1024 * 1024;
    const MB = 1024 * 1024;

    const report = {};

    // OS
    if (osInfo) {
      report.os = `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`;
      report.hostname = osInfo.hostname;
    }

    // CPU
    if (cpu) {
      report.cpu = `${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores, ${cpu.speedMax || cpu.speed}GHz)`;
    }
    if (cpuLoad) {
      report.cpuUsage = `${Math.round(cpuLoad.currentLoad)}%`;
    }

    // Temperature
    if (cpuTemp && cpuTemp.main > 0) {
      report.cpuTemp = `${Math.round(cpuTemp.main)}°C`;
      if (cpuTemp.max > 0) report.cpuTempMax = `${Math.round(cpuTemp.max)}°C`;
    } else {
      report.cpuTemp = 'N/A (sensor not available)';
    }

    // RAM
    if (mem) {
      const usedGB = (mem.used / GB).toFixed(1);
      const totalGB = (mem.total / GB).toFixed(1);
      const pct = Math.round((mem.used / mem.total) * 100);
      report.ram = `${usedGB}GB / ${totalGB}GB (${pct}% used)`;
      report.ramFree = `${(mem.free / GB).toFixed(1)}GB free`;
      if (mem.swaptotal > 0) {
        report.swap = `${(mem.swapused / GB).toFixed(1)}GB / ${(mem.swaptotal / GB).toFixed(1)}GB`;
      }
    }

    // Disk
    if (disk && disk.length > 0) {
      report.disks = disk.map(d => ({
        mount: d.mount,
        size: `${(d.size / GB).toFixed(0)}GB`,
        used: `${(d.used / GB).toFixed(0)}GB`,
        free: `${((d.size - d.used) / GB).toFixed(0)}GB`,
        usage: `${Math.round(d.use)}%`,
      }));
    }

    // Battery
    if (battery && battery.hasBattery) {
      report.battery = {
        level: `${Math.round(battery.percent)}%`,
        charging: battery.isCharging ? 'Yes' : 'No',
        health: battery.maxCapacity > 0 ? `${Math.round((battery.maxCapacity / battery.designCapacity) * 100)}%` : 'N/A',
        timeRemaining: battery.timeRemaining > 0 ? `${Math.round(battery.timeRemaining)}min` : 'Calculating...',
        cycles: battery.cycleCount > 0 ? battery.cycleCount : 'N/A',
        type: battery.type || 'Unknown',
      };
    } else {
      report.battery = 'No battery (desktop/plugged in)';
    }

    // GPU
    if (gpu && gpu.controllers && gpu.controllers.length > 0) {
      report.gpu = gpu.controllers.map(g => {
        const info = { name: g.model };
        if (g.vram > 0) info.vram = `${g.vram}MB`;
        if (g.temperatureGpu > 0) info.temp = `${Math.round(g.temperatureGpu)}°C`;
        if (g.utilizationGpu >= 0) info.usage = `${g.utilizationGpu}%`;
        return info;
      });
    }

    // Network
    if (net && net.length > 0) {
      const active = net.filter(n => n.tx_bytes > 0 || n.rx_bytes > 0);
      if (active.length > 0) {
        report.network = active.slice(0, 3).map(n => ({
          interface: n.iface,
          sent: `${(n.tx_bytes / MB).toFixed(1)}MB`,
          received: `${(n.rx_bytes / MB).toFixed(1)}MB`,
          speed: n.tx_sec > 0 ? `↑${(n.tx_sec / 1024).toFixed(0)}KB/s ↓${(n.rx_sec / 1024).toFixed(0)}KB/s` : 'idle',
        }));
      }
    }

    // Top processes
    if (processes && processes.list) {
      const top5 = processes.list
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5)
        .map(p => ({
          name: p.name,
          cpu: `${p.cpu.toFixed(1)}%`,
          mem: `${(p.mem).toFixed(1)}%`,
        }));
      report.topProcesses = top5;
      report.totalProcesses = processes.all;
    }

    // Uptime
    const uptimeSec = require('os').uptime();
    const hours = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    report.uptime = `${hours}h ${mins}m`;

    return report;
  }

  /**
   * System information.
   */
  _systemInfo() {
    const os = require('os');
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
      freeMemory: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
      uptime: `${Math.round(os.uptime() / 3600)}h`,
      nodeVersion: process.version,
    };
  }

  // ─── Cloudinary Media Commands ──────────────────────

  /**
   * Show Cloudinary storage info and usage.
   */
  async _cloudinaryInfo() {
    if (!cloudinary.isAvailable()) {
      return { error: 'Cloudinary not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to .env' };
    }

    try {
      const usage = await cloudinary.getUsage();
      return {
        status: 'connected',
        cloudName: cloudinary.cloudName,
        ...usage,
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  /**
   * List files in a Cloudinary folder.
   */
  async _cloudList(folder, resourceType) {
    if (!cloudinary.isAvailable()) return { error: 'Cloudinary not configured' };
    try {
      const files = await cloudinary.listFolder(folder, resourceType);
      return { folder, count: files.length, files };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Delete a file from Cloudinary by public ID.
   */
  async _cloudDelete(args) {
    if (!cloudinary.isAvailable()) return { error: 'Cloudinary not configured' };
    if (args.length === 0) return { error: 'Usage: /tool cloud-delete <public_id> [resource_type]' };
    const publicId = args[0];
    const resourceType = args[1] || 'image';
    try {
      const result = await cloudinary.delete(publicId, resourceType);
      return { deleted: publicId, result };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Generate an image via AI and upload to Cloudinary.
   */
  async _generateImage(args) {
    if (args.length === 0) return { error: 'Usage: /tool generate-image <description>' };
    const prompt = args.join(' ');
    try {
      const { imageGenerator } = require('../media');
      const result = await imageGenerator.generate(prompt);
      return {
        prompt,
        engine: result.engine,
        cloudUrl: result.cloudUrl || null,
        localPath: result.filePath || null,
      };
    } catch (err) {
      return { error: `Image generation failed: ${err.message}` };
    }
  }

  /**
   * Generate a video (Cloudinary video transformations or AI).
   * Creates a slideshow/animation from existing Cloudinary images.
   */
  async _generateVideo(args) {
    if (!cloudinary.isAvailable()) return { error: 'Cloudinary not configured' };
    if (args.length === 0) {
      return {
        error: 'Usage: /tool generate-video <type> [args]',
        types: {
          'slideshow': 'Create slideshow from jrv/images folder',
          'promo': 'Generate JRV promo video with text overlay',
        },
      };
    }

    const type = args[0];

    if (type === 'slideshow') {
      // List images and create a Cloudinary slideshow URL
      try {
        const images = await cloudinary.listFolder('jrv/images', 'image', 10);
        if (images.length === 0) return { error: 'No images in jrv/images. Upload some first.' };

        return {
          type: 'slideshow',
          note: 'Cloudinary can create slideshows via their Video API. Use the URLs below.',
          images: images.map(img => img.url),
          count: images.length,
        };
      } catch (err) {
        return { error: err.message };
      }
    }

    if (type === 'promo') {
      const text = args.slice(1).join(' ') || 'JRV Car Rental - Seremban';
      return {
        type: 'promo',
        note: 'Video generation requires Cloudinary Video API or external service.',
        text,
        suggestion: 'Upload a base video to jrv/videos, then use Cloudinary transformations for text overlays.',
      };
    }

    return { error: `Unknown video type: ${type}. Use 'slideshow' or 'promo'.` };
  }

  /**
   * Info about uploading media to Cloudinary.
   */
  _uploadInfo() {
    return {
      note: 'Media is auto-uploaded to Cloudinary when generated.',
      folders: {
        'jrv/voice': 'TTS voice notes (auto-uploaded)',
        'jrv/images': 'Generated/uploaded images (auto-uploaded)',
        'jrv/videos': 'Uploaded videos',
        'jrv/sites': 'Generated website HTML',
        'jrv/documents': 'Customer documents',
      },
      commands: {
        '/tool cloud': 'Storage usage stats',
        '/tool cloud-voice': 'List voice notes',
        '/tool cloud-images': 'List images',
        '/tool cloud-videos': 'List videos',
        '/tool cloud-delete <id>': 'Delete from cloud',
        '/tool generate-image <desc>': 'AI image generation',
        '/tool generate-video <type>': 'Video generation',
      },
    };
  }

  /**
   * Help text for admin tools.
   */
  _toolsHelp() {
    return {
      commands: {
        '/tool site <description>': 'Generate HTML site',
        '/tool broadcast <message>': 'Message all admins',
        '/tool export <cars|bookings|store|all>': 'Export data',
        '/tool config': 'Show configuration',
        '/tool set <key> <value>': 'Change setting',
        '/tool query <type>': 'Query Supabase data',
        '/tool reminder-all': 'List all reminders',
        '/tool clear-reminders <phone>': 'Clear reminders',
        '/tool backups [file]': 'List backup snapshots',
        '/tool trash': 'List trashed files',
        '/tool restore <file>': 'Restore file from backup',
        '/tool delete <trash-file>': 'Permanently delete from trash',
        '/tool purge-trash': 'Empty trash permanently',
        '/tool safety-log': 'File safety audit log',
        '/tool pc': 'Full PC performance (CPU, RAM, temp, battery, GPU)',
        '/tool system': 'System info (basic)',
        '/tool cloud': 'Cloudinary storage usage',
        '/tool cloud-voice': 'List cloud voice notes',
        '/tool cloud-images': 'List cloud images',
        '/tool cloud-videos': 'List cloud videos',
        '/tool cloud-delete <id> [type]': 'Delete from Cloudinary',
        '/tool generate-image <desc>': 'AI generate image',
        '/tool generate-video <type>': 'Video generation',
        '/tool upload': 'Upload/cloud info',
      },
      note: 'Boss-only commands. Access restricted to +60138606455.',
    };
  }
}

module.exports = new AdminTools();
