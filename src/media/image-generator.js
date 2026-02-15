const config = require('../config');
const fs = require('fs');
const path = require('path');
const fileSafety = require('../utils/file-safety');
const cloudinary = require('./cloudinary');

/**
 * Image Generator - Creates images from text prompts.
 *
 * Priority:
 * 1. Local Stable Diffusion (on Jetson via ComfyUI/A1111) — FREE but slower
 * 2. Kimi K2 SVG generation — fallback
 *
 * All generated images are uploaded to Cloudinary automatically.
 */
class ImageGenerator {
  constructor() {
    this.localUrl = 'http://localhost:7860'; // ComfyUI/A1111 default
    this.outputDir = config.paths.generated;
  }

  /**
   * Generate an image from a text prompt.
   * @param {string} prompt - What to generate
   * @param {object} options
   * @param {number} options.width - Image width (default 512)
   * @param {number} options.height - Image height (default 512)
   * @param {number} options.steps - Inference steps (default 20)
   * @returns {{ filePath: string, engine: string, cloudUrl?: string }}
   */
  async generate(prompt, options = {}) {
    const { width = 512, height = 512, steps = 20 } = options;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const outputPath = path.join(this.outputDir, `gen_${Date.now()}.png`);
    let result;

    try {
      result = await this._localGenerate(prompt, outputPath, { width, height, steps });
    } catch (localErr) {
      console.warn('[ImageGen] Local SD failed:', localErr.message);
      try {
        result = await this._cloudGenerate(prompt, outputPath, { width, height });
      } catch (cloudErr) {
        console.error('[ImageGen] All generators failed:', cloudErr.message);
        throw new Error('Image generation failed: no engines available');
      }
    }

    // Upload to Cloudinary
    if (cloudinary.isAvailable() && result.filePath) {
      try {
        const upload = await cloudinary.uploadImage(result.filePath, 'generated');
        result.cloudUrl = upload.secureUrl;
        result.publicId = upload.publicId;
        console.log(`[ImageGen] Uploaded to Cloudinary: ${upload.secureUrl}`);
        try { fs.unlinkSync(result.filePath); } catch {}
      } catch (err) {
        console.warn('[ImageGen] Cloudinary upload failed, keeping local:', err.message);
      }
    }

    return result;
  }

  async _localGenerate(prompt, outputPath, { width, height, steps }) {
    const response = await fetch(`${this.localUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative_prompt: 'blurry, bad quality, distorted',
        width,
        height,
        steps,
        sampler_name: 'DPM++ 2M Karras',
        cfg_scale: 7,
      }),
    });

    if (!response.ok) throw new Error(`SD API error ${response.status}`);

    const data = await response.json();
    if (!data.images || data.images.length === 0) throw new Error('No image generated');

    const imageBuffer = Buffer.from(data.images[0], 'base64');
    fileSafety.safeWrite(outputPath, imageBuffer);

    return { filePath: outputPath, engine: 'stable-diffusion-local' };
  }

  async _cloudGenerate(prompt, outputPath, { width, height }) {
    const kimiClient = require('../ai/kimi-client');

    const result = await kimiClient.ask(
      `Create an SVG image for: "${prompt}". Return ONLY the SVG code, no explanation.`,
      'You are a graphic designer. Create clean, professional SVG images.'
    );

    const svgMatch = result.content.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) {
      const svgPath = outputPath.replace('.png', '.svg');
      fileSafety.safeWrite(svgPath, svgMatch[0]);
      return { filePath: svgPath, engine: 'kimi-svg' };
    }

    throw new Error('Cloud generation did not produce an image');
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.localUrl}/sdapi/v1/sd-models`);
      return res.ok;
    } catch {
      return false;
    }
  }
}

module.exports = new ImageGenerator();
