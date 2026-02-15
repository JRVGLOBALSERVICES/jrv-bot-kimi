const config = require('../config');

/**
 * Local AI Client - Ollama on Jetson (or laptop for dev).
 * Used for: simple chat, FAQ, quick lookups — FREE, fast, private.
 * Runs Llama 3.1 8B or similar small model.
 */
class LocalClient {
  constructor() {
    this.baseUrl = config.localAI.url;
    this.model = config.localAI.model;
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: fullMessages,
        stream: false,
        options: { temperature },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Local AI error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return {
      content: data.message.content,
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
      },
      model: data.model,
      local: true,
    };
  }

  async ask(prompt, systemPrompt = null) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { systemPrompt }
    );
  }

  // Generate embeddings for semantic search
  async embed(text) {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) throw new Error('Embedding failed');
    const data = await response.json();
    return data.embedding;
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  }
}

module.exports = new LocalClient();
