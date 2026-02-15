const config = require('../config');

/**
 * Camera Manager - Jetson USB/CSI camera for plate detection.
 * In laptop mode, this is a stub.
 */
class CameraManager {
  constructor() {
    this.mode = config.mode;
    this.active = false;
  }

  async init() {
    if (this.mode === 'laptop') {
      console.log('[Camera] Laptop mode — camera disabled');
      return;
    }

    try {
      // On Jetson, use GStreamer or OpenCV to capture from USB camera
      console.log('[Camera] Initializing USB camera...');
      this.active = true;
    } catch (err) {
      console.error('[Camera] Init failed:', err.message);
    }
  }

  async capture() {
    if (!this.active) return null;
    // Return captured frame as buffer
    console.log('[Camera] Capturing frame...');
    return null; // Stub — real implementation uses GStreamer
  }

  isActive() {
    return this.active;
  }

  async destroy() {
    this.active = false;
  }
}

module.exports = new CameraManager();
