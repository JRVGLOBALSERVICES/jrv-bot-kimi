const config = require('../config');

/**
 * Kimi K2 API Client - Cloud AI for complex tasks.
 * Used for: deep reasoning, business reports, code generation, site design.
 * OpenAI-compatible API.
 */
class KimiClient {
  constructor() {
    this.apiUrl = config.kimi.apiUrl;
    this.apiKey = config.kimi.apiKey;
    this.model = config.kimi.model;
  }

  async chat(messages, options = {}) {
    const {
      temperature = 0.7,
      maxTokens = 4096,
      systemPrompt = null,
    } = options;

    const fullMessages = [];
    if (systemPrompt) {
      fullMessages.push({ role: 'system', content: systemPrompt });
    }
    fullMessages.push(...messages);

    const response = await fetch(`${this.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: fullMessages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Kimi API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
      model: data.model,
    };
  }

  async ask(prompt, systemPrompt = null, options = {}) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { ...options, systemPrompt }
    );
  }

  async analyzeImage(imageUrl, prompt) {
    // Kimi K2.5 vision endpoint (when available)
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ];

    return this.chat(messages, {
      systemPrompt: 'You are a helpful vision assistant for JRV Car Rental. Analyze images accurately.',
    });
  }

  async isAvailable() {
    try {
      const res = await fetch(`${this.apiUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

module.exports = new KimiClient();
