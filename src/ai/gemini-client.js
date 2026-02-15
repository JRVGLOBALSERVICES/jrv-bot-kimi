/**
 * Google Gemini Client - Media/Vision AI for JARVIS.
 *
 * API: Google AI Studio (generativelanguage.googleapis.com)
 * Model: gemini-2.0-flash
 *
 * ROLE: Media processing ONLY — NOT used for text chat.
 *   - Image analysis (car plates, damage, payment receipts)
 *   - Document OCR
 *   - Video frame analysis
 *
 * Text chat uses: Kimi K2 (primary) -> Ollama (fallback)
 */

const config = require('../config');

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

class GeminiClient {
  constructor() {
    this.apiKey = config.gemini?.apiKey;
    this.model = config.gemini?.model || 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.stats = { calls: 0, tokens: 0, errors: 0 };
  }

  /**
   * Analyze image with Gemini Vision.
   * This is the primary use case for Gemini in JARVIS.
   */
  async analyzeImage(imageBase64, prompt, mimeType = 'image/jpeg') {
    return this._request([{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: prompt },
      ],
    }], {
      systemPrompt: 'You are a vision assistant for JRV Car Rental, Seremban, Malaysia. Analyze images accurately. If you see a car license plate, read it precisely. If you see a receipt or payment proof, extract the amount and reference number.',
    });
  }

  /**
   * Analyze document image (IC, license, receipts).
   */
  async analyzeDocument(imageBase64, mimeType = 'image/jpeg') {
    return this.analyzeImage(
      imageBase64,
      'Extract all text from this document. If it is an IC/MyKad, extract the name, IC number, and address. If it is a driving license, extract the name, license number, and expiry date. If it is a receipt, extract the amount, date, and reference number.',
      mimeType
    );
  }

  /**
   * Read car plate from image.
   */
  async readPlate(imageBase64, mimeType = 'image/jpeg') {
    const result = await this.analyzeImage(
      imageBase64,
      'Read the car license plate number in this image. Return ONLY the plate number text, nothing else. Malaysian plates format: ABC 1234 or W 1234 ABC.',
      mimeType
    );
    return {
      plate: (result.content || '').replace(/[^A-Z0-9\s]/gi, '').trim(),
      raw: result.content,
      engine: 'gemini-vision',
    };
  }

  /**
   * Analyze car damage from image.
   */
  async analyzeDamage(imageBase64, mimeType = 'image/jpeg') {
    return this.analyzeImage(
      imageBase64,
      'Analyze this car image for any visible damage, scratches, dents, or issues. Describe the severity (minor/moderate/severe) and exact location of each issue found. If no damage is visible, say so.',
      mimeType
    );
  }

  /**
   * Low-level Gemini API request.
   */
  async _request(contents, options = {}) {
    const { systemPrompt = null, temperature = 0.4, maxTokens = 2048 } = options;

    const body = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          const waitMs = RETRY_DELAYS[attempt] || 3000;
          console.warn(`[Gemini] Rate limited, waiting ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        this.stats.calls++;

        if (data.usageMetadata) {
          this.stats.tokens += (data.usageMetadata.totalTokenCount || 0);
        }

        const candidate = data.candidates?.[0];
        if (!candidate || !candidate.content) {
          throw new Error('Gemini returned no content');
        }

        const content = candidate.content.parts
          .map(p => p.text || '')
          .join('')
          .trim();

        return {
          content,
          description: content,
          text: this._extractText(content),
          usage: data.usageMetadata,
          model: this.model,
          engine: 'gemini-vision',
        };
      } catch (err) {
        lastError = err;
        this.stats.errors++;

        if (attempt < MAX_RETRIES && (err.message.includes('429') || err.message.includes('ECONNRESET'))) {
          const waitMs = RETRY_DELAYS[attempt] || 3000;
          console.warn(`[Gemini] Error: ${err.message}, retrying in ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * Extract plate/reference text from AI response.
   */
  _extractText(content) {
    const textMatch = content.match(/text.*?[:\-]\s*["']?([\s\S]*?)["']?\s*$/i);
    return textMatch ? textMatch[1].trim() : '';
  }

  async isAvailable() {
    if (!this.apiKey || this.apiKey === 'placeholder') return false;
    try {
      const url = `${this.baseUrl}/models/${this.model}?key=${this.apiKey}`;
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  getStats() {
    return this.stats;
  }
}

module.exports = new GeminiClient();
