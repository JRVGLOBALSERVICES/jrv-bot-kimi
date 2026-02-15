/**
 * Cloudinary Service — Cloud media storage for JARVIS.
 *
 * Handles: voice notes, images, videos, generated content.
 * Uses Cloudinary REST API directly (no SDK dependency).
 *
 * Upload flow:
 *   1. Generate file locally (TTS audio, AI image, etc.)
 *   2. Upload to Cloudinary → get secure URL
 *   3. Use URL for WhatsApp sending / storage
 *   4. Clean up local temp file
 *
 * Folders:
 *   jrv/voice/    — TTS voice notes
 *   jrv/images/   — Generated/uploaded images
 *   jrv/videos/   — Generated videos
 *   jrv/sites/    — Generated HTML/websites
 *   jrv/documents/ — Customer documents
 */

const config = require('../config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CloudinaryService {
  constructor() {
    this.cloudName = config.cloudinary.cloudName;
    this.apiKey = config.cloudinary.apiKey;
    this.apiSecret = config.cloudinary.apiSecret;
    this.uploadPreset = config.cloudinary.uploadPreset;
    this.enabled = config.cloudinary.enabled;
    this.baseUrl = `https://api.cloudinary.com/v1_1/${this.cloudName}`;
  }

  /**
   * Check if Cloudinary is configured and available.
   */
  isAvailable() {
    return this.enabled && this.cloudName && this.apiKey && this.apiSecret;
  }

  /**
   * Generate auth signature for signed uploads.
   */
  _generateSignature(params) {
    const sorted = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');
    return crypto
      .createHash('sha256')
      .update(sorted + this.apiSecret)
      .digest('hex');
  }

  /**
   * Upload a local file to Cloudinary.
   * @param {string} filePath - Local file path
   * @param {object} options
   * @param {string} options.folder - Cloudinary folder (e.g., 'jrv/voice')
   * @param {string} options.resourceType - 'image', 'video', 'raw', 'auto' (default: 'auto')
   * @param {string} options.publicId - Custom public ID (optional)
   * @param {object} options.transformation - Cloudinary transformation (optional)
   * @returns {{ url: string, secureUrl: string, publicId: string, format: string, bytes: number, duration?: number }}
   */
  async uploadFile(filePath, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Cloudinary not configured');
    }

    const {
      folder = 'jrv',
      resourceType = 'auto',
      publicId = null,
      transformation = null,
    } = options;

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder, timestamp };
    if (publicId) params.public_id = publicId;
    if (transformation) params.transformation = JSON.stringify(transformation);

    const signature = this._generateSignature(params);

    // Build multipart form
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const blob = new Blob([fileBuffer]);
    formData.append('file', blob, fileName);
    formData.append('api_key', this.apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('folder', folder);
    if (publicId) formData.append('public_id', publicId);
    if (transformation) formData.append('transformation', JSON.stringify(transformation));

    const url = `${this.baseUrl}/${resourceType}/upload`;
    const res = await fetch(url, { method: 'POST', body: formData });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudinary upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return {
      url: data.url,
      secureUrl: data.secure_url,
      publicId: data.public_id,
      format: data.format,
      bytes: data.bytes,
      width: data.width,
      height: data.height,
      duration: data.duration,
      resourceType: data.resource_type,
      createdAt: data.created_at,
    };
  }

  /**
   * Upload a Buffer directly to Cloudinary (no temp file needed).
   * @param {Buffer} buffer - File content
   * @param {string} fileName - Original filename
   * @param {object} options - Same as uploadFile options
   */
  async uploadBuffer(buffer, fileName, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Cloudinary not configured');
    }

    const {
      folder = 'jrv',
      resourceType = 'auto',
      publicId = null,
    } = options;

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder, timestamp };
    if (publicId) params.public_id = publicId;

    const signature = this._generateSignature(params);

    const formData = new FormData();
    const blob = new Blob([buffer]);
    formData.append('file', blob, fileName);
    formData.append('api_key', this.apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);
    formData.append('folder', folder);
    if (publicId) formData.append('public_id', publicId);

    const url = `${this.baseUrl}/${resourceType}/upload`;
    const res = await fetch(url, { method: 'POST', body: formData });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudinary upload failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return {
      url: data.url,
      secureUrl: data.secure_url,
      publicId: data.public_id,
      format: data.format,
      bytes: data.bytes,
      width: data.width,
      height: data.height,
      duration: data.duration,
      resourceType: data.resource_type,
      createdAt: data.created_at,
    };
  }

  /**
   * Upload voice note to Cloudinary.
   * @param {string} filePath - Local audio file path
   * @param {string} label - Optional label (e.g., customer name)
   */
  async uploadVoice(filePath, label = null) {
    const publicId = label
      ? `voice_${label.replace(/\s+/g, '_')}_${Date.now()}`
      : `voice_${Date.now()}`;

    return this.uploadFile(filePath, {
      folder: 'jrv/voice',
      resourceType: 'video', // Cloudinary treats audio as 'video' type
      publicId,
    });
  }

  /**
   * Upload image to Cloudinary.
   * @param {string} filePath - Local image file path
   * @param {string} label - Optional label
   */
  async uploadImage(filePath, label = null) {
    const publicId = label
      ? `img_${label.replace(/\s+/g, '_')}_${Date.now()}`
      : `img_${Date.now()}`;

    return this.uploadFile(filePath, {
      folder: 'jrv/images',
      resourceType: 'image',
      publicId,
    });
  }

  /**
   * Upload video to Cloudinary.
   * @param {string} filePath - Local video file path
   * @param {string} label - Optional label
   */
  async uploadVideo(filePath, label = null) {
    const publicId = label
      ? `vid_${label.replace(/\s+/g, '_')}_${Date.now()}`
      : `vid_${Date.now()}`;

    return this.uploadFile(filePath, {
      folder: 'jrv/videos',
      resourceType: 'video',
      publicId,
    });
  }

  /**
   * Upload raw file (HTML, PDF, etc.) to Cloudinary.
   */
  async uploadRaw(filePath, folder = 'jrv/documents') {
    return this.uploadFile(filePath, {
      folder,
      resourceType: 'raw',
    });
  }

  /**
   * Delete a resource from Cloudinary.
   * @param {string} publicId - The public ID to delete
   * @param {string} resourceType - 'image', 'video', 'raw'
   */
  async delete(publicId, resourceType = 'image') {
    if (!this.isAvailable()) throw new Error('Cloudinary not configured');

    const timestamp = Math.floor(Date.now() / 1000);
    const params = { public_id: publicId, timestamp };
    const signature = this._generateSignature(params);

    const formData = new FormData();
    formData.append('public_id', publicId);
    formData.append('api_key', this.apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);

    const url = `${this.baseUrl}/${resourceType}/destroy`;
    const res = await fetch(url, { method: 'POST', body: formData });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudinary delete failed: ${errText.slice(0, 200)}`);
    }

    return res.json();
  }

  /**
   * List resources in a folder.
   * @param {string} folder - Cloudinary folder path
   * @param {string} resourceType - 'image', 'video', 'raw'
   * @param {number} maxResults - Max results (default 30)
   */
  async listFolder(folder = 'jrv', resourceType = 'image', maxResults = 30) {
    if (!this.isAvailable()) throw new Error('Cloudinary not configured');

    const url = `${this.baseUrl}/resources/${resourceType}?prefix=${folder}&type=upload&max_results=${maxResults}`;
    const auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');

    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudinary list failed: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return (data.resources || []).map(r => ({
      publicId: r.public_id,
      url: r.secure_url,
      format: r.format,
      bytes: r.bytes,
      createdAt: r.created_at,
      resourceType: r.resource_type,
    }));
  }

  /**
   * Get storage usage stats.
   */
  async getUsage() {
    if (!this.isAvailable()) throw new Error('Cloudinary not configured');

    const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/usage`;
    const auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');

    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloudinary usage failed: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    return {
      storage: {
        used: `${(data.storage?.usage || 0 / 1024 / 1024).toFixed(1)}MB`,
        limit: `${(data.storage?.limit || 0 / 1024 / 1024).toFixed(0)}MB`,
      },
      bandwidth: {
        used: `${(data.bandwidth?.usage || 0 / 1024 / 1024).toFixed(1)}MB`,
        limit: `${(data.bandwidth?.limit || 0 / 1024 / 1024).toFixed(0)}MB`,
      },
      transformations: data.transformations?.usage || 0,
      resources: data.resources || 0,
    };
  }

  /**
   * Generate a transformation URL for an existing image.
   * Useful for on-the-fly resizing, cropping, effects.
   */
  transformUrl(publicId, transformations, resourceType = 'image') {
    // transformations: e.g., 'w_500,h_500,c_fill' or 'w_1200,q_80'
    return `https://res.cloudinary.com/${this.cloudName}/${resourceType}/upload/${transformations}/${publicId}`;
  }

  /**
   * Generate video thumbnail URL.
   */
  videoThumbnail(publicId, options = {}) {
    const { width = 400, height = 300, time = '0' } = options;
    return `https://res.cloudinary.com/${this.cloudName}/video/upload/w_${width},h_${height},c_fill,so_${time}/${publicId}.jpg`;
  }
}

module.exports = new CloudinaryService();
