const config = require('../config');

/**
 * Display Manager - Shows dashboard on Jetson HDMI output.
 * In laptop mode, outputs to console.
 */
class DisplayManager {
  constructor() {
    this.mode = config.mode;
  }

  show(title, data) {
    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  ${title.padEnd(36)}║`);
    console.log(`╠══════════════════════════════════════╣`);
    if (typeof data === 'string') {
      data.split('\n').forEach(line => {
        console.log(`║  ${line.padEnd(36)}║`);
      });
    } else if (typeof data === 'object') {
      Object.entries(data).forEach(([key, val]) => {
        console.log(`║  ${key}: ${String(val).padEnd(36 - key.length - 2)}║`);
      });
    }
    console.log(`╚══════════════════════════════════════╝\n`);
  }

  showStatus(status) {
    this.show('JARVIS Status', status);
  }

  clear() {
    if (this.mode === 'laptop') {
      console.clear();
    }
  }
}

module.exports = new DisplayManager();
