const config = require('../config');

/**
 * Kimi K2 API Client - Cloud AI for complex tasks.
 *
 * API: OpenAI-compatible (https://api.moonshot.ai/v1)
 * Models:
 *   kimi-k2-0905-preview  — Fast general model
 *   kimi-k2.5             — Most powerful
 *   kimi-k2-thinking      — Deep reasoning with thinking traces
 *
 * Features: Chat, Tool Calling, Vision
 * Recommended: temperature=0.6, top_p=0.95
 */

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

class KimiClient {
  constructor() {
    this.apiUrl = config.kimi.apiUrl;
    this.apiKey = config.kimi.apiKey;
    this.model = config.kimi.model;
    this.thinkingModel = config.kimi.thinkingModel || 'kimi-k2-thinking';
    this.stats = { calls: 0, tokens: 0, errors: 0, toolCalls: 0 };
  }

  async chat(messages, options = {}) {
    const {
      temperature = 0.6,
      maxTokens = 4096,
      systemPrompt = null,
      tools = null,
      model = null,
    } = options;

    const fullMessages = [];
    if (systemPrompt) {
      fullMessages.push({ role: 'system', content: systemPrompt });
    }
    fullMessages.push(...messages);

    const body = {
      model: model || this.model,
      messages: fullMessages,
      temperature,
      top_p: 0.95,
      max_tokens: maxTokens,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (response.status === 429) {
          const waitMs = RETRY_DELAYS[attempt] || 4000;
          console.warn(`[Kimi] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Kimi API ${response.status}: ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        this.stats.calls++;
        if (data.usage) {
          this.stats.tokens += (data.usage.total_tokens || 0);
        }

        const choice = data.choices[0];

        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
          this.stats.toolCalls += choice.message.tool_calls.length;
          return {
            content: choice.message.content || '',
            toolCalls: choice.message.tool_calls,
            usage: data.usage,
            model: data.model,
          };
        }

        return {
          content: choice.message.content,
          usage: data.usage,
          model: data.model,
        };

      } catch (err) {
        lastError = err;
        this.stats.errors++;

        if (attempt < MAX_RETRIES && (err.message.includes('429') || err.message.includes('ECONNRESET') || err.message.includes('fetch failed'))) {
          const waitMs = RETRY_DELAYS[attempt] || 4000;
          console.warn(`[Kimi] Error: ${err.message}, retrying in ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  /**
   * Chat with tool calling — executes tools and returns final response.
   */
  async chatWithTools(messages, tools, toolExecutor, options = {}) {
    const { systemPrompt, maxRounds = 5 } = options;

    let currentMessages = [...messages];
    let round = 0;

    while (round < maxRounds) {
      const result = await this.chat(currentMessages, {
        ...options,
        systemPrompt: round === 0 ? systemPrompt : undefined,
        tools,
      });

      if (!result.toolCalls) return result;

      currentMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      for (const toolCall of result.toolCalls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          const toolResult = await toolExecutor(toolCall.function.name, args);
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        } catch (err) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: err.message }),
          });
        }
      }
      round++;
    }

    return this.chat(currentMessages, { ...options, tools: null });
  }

  async ask(prompt, systemPrompt = null, options = {}) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { ...options, systemPrompt }
    );
  }

  async think(prompt, systemPrompt = null) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { systemPrompt, model: this.thinkingModel, temperature: 0.6 }
    );
  }

  async analyzeImage(imageBase64, prompt, mimeType = 'image/jpeg') {
    return this.chat([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    }], {
      systemPrompt: 'You are a vision assistant for JRV Car Rental. Analyze images accurately. Read car plates if visible.',
    });
  }

  async isAvailable() {
    if (!this.apiKey || this.apiKey === 'placeholder') return false;
    try {
      const res = await fetch(`${this.apiUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  getStats() {
    return this.stats;
  }
}

module.exports = new KimiClient();
