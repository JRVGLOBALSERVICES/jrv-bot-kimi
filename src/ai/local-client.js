const config = require('../config');

/**
 * Local AI Client - Ollama on Jetson (or laptop for dev).
 * Used for: simple chat, FAQ, quick lookups — FREE, fast, private.
 * Runs Llama 3.1 8B or similar small model.
 *
 * Robustness: Timeout, null-safe parsing, retry on transient errors.
 */

const REQUEST_TIMEOUT = 60000; // Ollama can be slow on first load
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 3000];

class LocalClient {
  constructor() {
    this.baseUrl = config.localAI.url;
    this.model = config.localAI.model;
  }

  /**
   * Safely parse Ollama response.
   */
  _parseResponse(data) {
    if (!data) {
      return { content: null, error: 'Empty response from Ollama' };
    }

    // Ollama format: { message: { content: "..." }, model: "...", ... }
    if (!data.message) {
      console.warn('[Local] Response has no message field:', JSON.stringify(data).slice(0, 300));
      // Some Ollama versions use different format
      if (data.response) {
        return {
          content: data.response,
          usage: { prompt_tokens: 0, completion_tokens: 0 },
          model: data.model || this.model,
          local: true,
        };
      }
      if (data.error) {
        return { content: null, error: `Ollama error: ${data.error}` };
      }
      return { content: null, error: 'Ollama returned no message' };
    }

    return {
      content: data.message.content || '',
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
      },
      model: data.model || this.model,
      local: true,
    };
  }

  async chat(messages, options = {}) {
    const {
      temperature = 0.7,
      systemPrompt = null,
    } = options;

    const fullMessages = [];
    if (systemPrompt) {
      fullMessages.push({ role: 'system', content: systemPrompt });
    }
    fullMessages.push(...messages);

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        let response;
        try {
          response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.model,
              messages: fullMessages,
              stream: false,
              options: { temperature },
            }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          const err = await response.text().catch(() => 'unknown error');
          throw new Error(`Local AI error ${response.status}: ${err.slice(0, 200)}`);
        }

        let data;
        try {
          data = await response.json();
        } catch (parseErr) {
          throw new Error(`Ollama response not valid JSON: ${parseErr.message}`);
        }

        const result = this._parseResponse(data);

        if (result.error && !result.content) {
          throw new Error(result.error);
        }

        return result;

      } catch (err) {
        lastError = err;

        const isRetryable = err.name === 'AbortError' ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('fetch failed') ||
          err.message.includes('socket');

        if (attempt < MAX_RETRIES && isRetryable) {
          const waitMs = RETRY_DELAYS[attempt] || 3000;
          console.warn(`[Local] Error: ${err.message}, retrying in ${waitMs}ms (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async ask(prompt, systemPrompt = null) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { systemPrompt }
    );
  }

  // Generate embeddings for semantic search
  async embed(text) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Embedding failed');
      const data = await response.json();
      return data.embedding;
    } finally {
      clearTimeout(timeout);
    }
  }

  async isAvailable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return [];
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  }
}

module.exports = new LocalClient();
