const config = require('../config');

/**
 * GPIO Manager - LED indicators and buzzer on Jetson.
 * In laptop mode, outputs to console.
 *
 * Pins (Jetson 40-pin header):
 * - Green LED: Online/ready
 * - Red LED: Error/alert
 * - Buzzer: New booking notification
 */
class GPIOManager {
  constructor() {
    this.mode = config.mode;
  }

  async init() {
    if (this.mode === 'laptop') {
      console.log('[GPIO] Laptop mode — GPIO simulated');
      return;
    }

    try {
      console.log('[GPIO] Initializing Jetson GPIO pins...');
      // Real implementation: require('jetson-gpio') or similar
    } catch (err) {
      console.error('[GPIO] Init failed:', err.message);
    }
  }

  setStatus(status) {
    const indicators = {
      ready: '🟢',
      busy: '🟡',
      error: '🔴',
      alert: '🔵',
    };
    console.log(`[GPIO] Status: ${indicators[status] || '⚪'} ${status}`);
  }

  buzz(pattern = 'short') {
    console.log(`[GPIO] Buzz: ${pattern}`);
  }

  async destroy() {
    console.log('[GPIO] Cleanup');
  }
}

module.exports = new GPIOManager();
