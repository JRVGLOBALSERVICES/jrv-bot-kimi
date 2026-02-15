/**
 * Google Gemini Client - Secondary AI provider for JARVIS.
 *
 * API: Google AI Studio (generativelanguage.googleapis.com)
 * Models: gemini-2.0-flash (fast), gemini-2.0-flash-thinking (reasoning)
 *
 * Used as fallback when Kimi K2 is unavailable, or for specific tasks
 * like vision analysis, code generation, and multi-modal queries.
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
   * Chat completion with Gemini.
   */
  async chat(messages, options = {}) {
    const {
      temperature = 0.7,
      maxTokens = 4096,
      systemPrompt = null,
      model = null,
    } = options;

    // Convert OpenAI-style messages to Gemini format
    const geminiMessages = [];
    const systemParts = [];

    if (systemPrompt) {
      systemParts.push({ text: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content });
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (typeof msg.content === 'string') {
        geminiMessages.push({ role, parts: [{ text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        const parts = msg.content.map(c => {
          if (c.type === 'text') return { text: c.text };
          if (c.type === 'image_url') {
            const url = c.image_url?.url || '';
            if (url.startsWith('data:')) {
              const [meta, data] = url.split(',');
              const mimeType = meta.match(/data:(.*?);/)?.[1] || 'image/jpeg';
              return { inline_data: { mime_type: mimeType, data } };
            }
          }
          return { text: JSON.stringify(c) };
        });
        geminiMessages.push({ role, parts });
      }
    }

    const body = {
      contents: geminiMessages,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        topP: 0.95,
      },
    };

    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts };
    }

    const useModel = model || this.model;

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `${this.baseUrl}/models/${useModel}:generateContent?key=${this.apiKey}`;
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
          usage: data.usageMetadata,
          model: useModel,
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
   * Simple ask interface.
   */
  async ask(prompt, systemPrompt = null) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { systemPrompt }
    );
  }

  /**
   * Analyze image with Gemini Vision.
   */
  async analyzeImage(imageBase64, prompt, mimeType = 'image/jpeg') {
    return this.chat([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    }], {
      systemPrompt: 'You are a vision assistant for JRV Car Rental. Analyze images accurately.',
    });
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
