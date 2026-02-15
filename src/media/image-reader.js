const config = require('../config');
const fs = require('fs');
const path = require('path');
const geminiClient = require('../ai/gemini-client');

/**
 * Image Reader - Analyzes images using AI vision.
 *
 * Priority:
 * 1. Gemini Vision (cloud) — primary for all media/vision
 * 2. Local LLaVA (Ollama on Jetson) — FREE, fast, private
 * 3. Kimi K2.5 Vision (cloud) — fallback
 * 4. Tesseract.js (OCR only) — last resort, text extraction only
 */
class ImageReader {
  constructor() {
    this.localUrl = config.localAI.url;
    this.tmpDir = config.paths.tmp;
  }

  /**
   * Analyze an image with a prompt.
   * @param {Buffer|string} image - Image buffer or file path
   * @param {string} prompt - What to analyze (e.g., "Read the text in this image")
   * @returns {{ description: string, text: string, engine: string }}
   */
  async analyze(image, prompt = 'Describe this image in detail.') {
    let imagePath;
    let cleanup = false;

    if (Buffer.isBuffer(image)) {
      if (!fs.existsSync(this.tmpDir)) fs.mkdirSync(this.tmpDir, { recursive: true });
      imagePath = path.join(this.tmpDir, `img_${Date.now()}.jpg`);
      fs.writeFileSync(imagePath, image);
      cleanup = true;
    } else {
      imagePath = image;
    }

    try {
      // Try Gemini Vision first (primary media engine)
      return await this._geminiVision(imagePath, prompt);
    } catch (geminiErr) {
      console.warn('[ImageReader] Gemini vision failed:', geminiErr.message);
      try {
        // Fallback to local LLaVA
        return await this._localVision(imagePath, prompt);
      } catch (localErr) {
        console.warn('[ImageReader] Local vision failed:', localErr.message);
        try {
          // Fallback to Kimi Vision
          return await this._kimiVision(imagePath, prompt);
        } catch (cloudErr) {
          console.warn('[ImageReader] Kimi vision failed:', cloudErr.message);
          // Last resort: OCR only
          return await this._ocrOnly(imagePath);
        }
      }
    } finally {
      if (cleanup && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
  }

  async _geminiVision(imagePath, prompt) {
    if (!geminiClient.apiKey || geminiClient.apiKey === 'placeholder') {
      throw new Error('Gemini API key not configured');
    }
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const result = await geminiClient.analyzeImage(imageBase64, prompt, mimeType);
    return {
      description: result.content,
      text: result.text || this._extractText(result.content),
      engine: 'gemini-vision',
    };
  }

  async _localVision(imagePath, prompt) {
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');

    const response = await fetch(`${this.localUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llava:7b',
        messages: [
          {
            role: 'user',
            content: prompt,
            images: [imageBase64],
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) throw new Error(`LLaVA error ${response.status}`);
    const data = await response.json();

    return {
      description: data.message.content,
      text: this._extractText(data.message.content),
      engine: 'llava-local',
    };
  }

  async _kimiVision(imagePath, prompt) {
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const response = await fetch(`${config.kimi.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.kimi.apiKey}`,
      },
      body: JSON.stringify({
        model: config.kimi.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`Kimi vision error ${response.status}`);
    const data = await response.json();

    return {
      description: data.choices[0].message.content,
      text: this._extractText(data.choices[0].message.content),
      engine: 'kimi-vision',
    };
  }

  async _ocrOnly(imagePath) {
    try {
      const Tesseract = require('tesseract.js');
      const { data } = await Tesseract.recognize(imagePath, 'eng+msa');

      return {
        description: `OCR extracted text from image.`,
        text: data.text || '',
        engine: 'tesseract-ocr',
      };
    } catch (err) {
      return {
        description: 'Could not analyze image.',
        text: '',
        engine: 'none',
      };
    }
  }

  _extractText(content) {
    // Try to extract just the readable text portion from AI response
    const textMatch = content.match(/text.*?[:\-]\s*["']?([\s\S]*?)["']?\s*$/i);
    return textMatch ? textMatch[1].trim() : '';
  }

  /**
   * Read a car plate from an image.
   * Tries Gemini dedicated plate reader first, falls back to generic analyze.
   */
  async readPlate(image) {
    const imageBase64 = Buffer.isBuffer(image)
      ? image.toString('base64')
      : fs.readFileSync(image).toString('base64');

    // Try Gemini plate reader first (purpose-built)
    if (geminiClient.apiKey && geminiClient.apiKey !== 'placeholder') {
      try {
        return await geminiClient.readPlate(imageBase64);
      } catch (err) {
        console.warn('[ImageReader] Gemini plate read failed:', err.message);
      }
    }

    // Fallback to generic analyze chain
    const result = await this.analyze(image,
      'Read the car license plate number in this image. Return ONLY the plate number, nothing else.');
    return {
      plate: result.description.replace(/[^A-Z0-9\s]/gi, '').trim(),
      engine: result.engine,
    };
  }

  /**
   * Analyze car damage from an image.
   * Tries Gemini dedicated damage analyzer first, falls back to generic analyze.
   */
  async analyzeDamage(image) {
    const imageBase64 = Buffer.isBuffer(image)
      ? image.toString('base64')
      : fs.readFileSync(image).toString('base64');

    // Try Gemini damage analyzer first (purpose-built)
    if (geminiClient.apiKey && geminiClient.apiKey !== 'placeholder') {
      try {
        return await geminiClient.analyzeDamage(imageBase64);
      } catch (err) {
        console.warn('[ImageReader] Gemini damage analysis failed:', err.message);
      }
    }

    // Fallback to generic analyze chain
    return this.analyze(image,
      'Analyze this car image for any visible damage, scratches, dents, or issues. Describe the severity and location of each issue found.');
  }
}

module.exports = new ImageReader();
