const config = require('../config');
const fs = require('fs');
const path = require('path');

/**
 * Image Generator - Creates images from text prompts.
 *
 * Priority:
 * 1. Local Stable Diffusion (on Jetson via ComfyUI/A1111) — FREE but slower
 * 2. Cloud API (Flux, DALL-E 3, etc.) — fast, paid
 *
 * Use cases for JRV:
 * - Generate promotional images
 * - Create visual quotes with car images
 * - Marketing material
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
   * @returns {{ filePath: string, engine: string }}
   */
  async generate(prompt, options = {}) {
    const { width = 512, height = 512, steps = 20 } = options;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const outputPath = path.join(this.outputDir, `gen_${Date.now()}.png`);

    try {
      return await this._localGenerate(prompt, outputPath, { width, height, steps });
    } catch (localErr) {
      console.warn('[ImageGen] Local SD failed:', localErr.message);
      try {
        return await this._cloudGenerate(prompt, outputPath, { width, height });
      } catch (cloudErr) {
        console.error('[ImageGen] All generators failed:', cloudErr.message);
        throw new Error('Image generation failed: no engines available');
      }
    }
  }

  async _localGenerate(prompt, outputPath, { width, height, steps }) {
    // Stable Diffusion API (AUTOMATIC1111 or ComfyUI)
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
    fs.writeFileSync(outputPath, imageBuffer);

    return { filePath: outputPath, engine: 'stable-diffusion-local' };
  }

  async _cloudGenerate(prompt, outputPath, { width, height }) {
    // Use Kimi K2 to generate HTML/SVG as an alternative
    // Or integrate with a cloud image API here
    const kimiClient = require('../ai/kimi-client');

    const result = await kimiClient.ask(
      `Create an SVG image for: "${prompt}". Return ONLY the SVG code, no explanation.`,
      'You are a graphic designer. Create clean, professional SVG images.'
    );

    // If we got SVG, save it
    const svgMatch = result.content.match(/<svg[\s\S]*<\/svg>/i);
    if (svgMatch) {
      const svgPath = outputPath.replace('.png', '.svg');
      fs.writeFileSync(svgPath, svgMatch[0]);
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
