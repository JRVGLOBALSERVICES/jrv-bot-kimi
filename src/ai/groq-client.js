const config = require('../config');

/**
 * Groq API Client - Fast cloud AI with free tier.
 *
 * API: OpenAI-compatible (https://api.groq.com/openai/v1)
 * Models:
 *   llama-3.3-70b-versatile — Best all-round (300+ tok/s)
 *   llama-3.1-8b-instant    — Ultra fast, lighter
 *   mixtral-8x7b-32768      — Good for long context
 *
 * Features: Chat, Tool Calling
 * Free tier: ~500K tokens/day
 * Get key: https://console.groq.com
 *
 * Robustness: Circuit breaker, null-safe parsing, timeouts, retries.
 */

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 30000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60000;

class GroqClient {
  constructor() {
    this.apiUrl = config.groq.apiUrl;
    this.apiKey = config.groq.apiKey;
    this.model = config.groq.model;
    this.stats = { calls: 0, tokens: 0, errors: 0, toolCalls: 0 };

    // Circuit breaker state
    this._consecutiveFailures = 0;
    this._circuitOpen = false;
    this._circuitOpenedAt = 0;
  }

  _checkCircuit() {
    if (!this._circuitOpen) return true;
    if (Date.now() - this._circuitOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
      this._circuitOpen = false;
      this._consecutiveFailures = 0;
      console.log('[Groq] Circuit breaker reset — retrying');
      return true;
    }
    return false;
  }

  _onSuccess() {
    this._consecutiveFailures = 0;
    this._circuitOpen = false;
  }

  _onFailure() {
    this._consecutiveFailures++;
    if (this._consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this._circuitOpen = true;
      this._circuitOpenedAt = Date.now();
      console.warn(`[Groq] Circuit breaker OPEN after ${this._consecutiveFailures} failures — pausing for ${CIRCUIT_BREAKER_RESET_MS / 1000}s`);
    }
  }

  /**
   * Safely extract response from API data.
   */
  _parseResponse(data) {
    if (!data) {
      console.warn('[Groq] Empty response data');
      return { content: null, error: 'Empty response from Groq API' };
    }

    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.warn('[Groq] No choices in response:', JSON.stringify(data).slice(0, 300));
      if (data.error) {
        return { content: null, error: `Groq API error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}` };
      }
      return { content: null, error: 'Groq returned empty choices' };
    }

    const choice = data.choices[0];
    if (!choice || !choice.message) {
      console.warn('[Groq] Choice has no message:', JSON.stringify(choice).slice(0, 200));
      return { content: null, error: 'Groq returned choice without message' };
    }

    const msg = choice.message;
    const result = {
      content: msg.content || '',
      usage: data.usage || null,
      model: data.model || this.model,
    };

    if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      result.toolCalls = msg.tool_calls;
    }

    return result;
  }

  async chat(messages, options = {}) {
    const {
      temperature = 0.6,
      maxTokens = 4096,
      systemPrompt = null,
      tools = null,
      model = null,
    } = options;

    if (!this._checkCircuit()) {
      throw new Error('Groq circuit breaker open — too many consecutive failures');
    }

    const fullMessages = [];
    if (systemPrompt) {
      fullMessages.push({ role: 'system', content: systemPrompt });
    }
    fullMessages.push(...messages);

    const body = {
      model: model || this.model,
      messages: fullMessages,
      temperature,
      max_tokens: maxTokens,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        let response;
        try {
          response = await fetch(`${this.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.status === 429) {
          const waitMs = RETRY_DELAYS[attempt] || 4000;
          console.warn(`[Groq] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => 'unknown error');
          throw new Error(`Groq API ${response.status}: ${errText.slice(0, 200)}`);
        }

        let data;
        try {
          data = await response.json();
        } catch (parseErr) {
          throw new Error(`Groq response not valid JSON: ${parseErr.message}`);
        }

        const result = this._parseResponse(data);

        if (result.error && !result.content) {
          throw new Error(result.error);
        }

        this.stats.calls++;
        this._onSuccess();

        if (data.usage) {
          this.stats.tokens += (data.usage.total_tokens || 0);
        }

        if (result.toolCalls) {
          this.stats.toolCalls += result.toolCalls.length;
        }

        return result;

      } catch (err) {
        lastError = err;
        this.stats.errors++;
        this._onFailure();

        const isRetryable = err.name === 'AbortError' ||
          err.message.includes('429') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('fetch failed') ||
          err.message.includes('network') ||
          err.message.includes('socket') ||
          err.message.includes('502') ||
          err.message.includes('503') ||
          err.message.includes('504');

        if (attempt < MAX_RETRIES && isRetryable) {
          const waitMs = RETRY_DELAYS[attempt] || 4000;
          console.warn(`[Groq] Error: ${err.message}, retrying in ${waitMs}ms (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async chatWithTools(messages, tools, toolExecutor, options = {}) {
    const { systemPrompt, maxRounds = 5 } = options;

    let currentMessages = [...messages];
    let round = 0;

    while (round < maxRounds) {
      let result;
      try {
        result = await this.chat(currentMessages, {
          ...options,
          systemPrompt: round === 0 ? systemPrompt : undefined,
          tools,
        });
      } catch (err) {
        console.error(`[Groq] chatWithTools round ${round} failed:`, err.message);
        if (round > 0) {
          try {
            return await this.chat(currentMessages, { ...options, tools: null });
          } catch {
            return { content: `Sorry, I encountered an error: ${err.message}`, error: err.message };
          }
        }
        throw err;
      }

      if (!result.toolCalls) return result;

      currentMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      for (const toolCall of result.toolCalls) {
        let toolResult;
        try {
          let args = {};
          if (toolCall.function && toolCall.function.arguments) {
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch (parseErr) {
              console.warn(`[Groq] Bad tool args for ${toolCall.function?.name}: ${parseErr.message}`);
              args = {};
            }
          }

          const toolName = toolCall.function?.name || 'unknown';

          toolResult = await Promise.race([
            toolExecutor(toolName, args),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool ${toolName} timed out after 45s`)), 45000)),
          ]);
        } catch (err) {
          console.warn(`[Groq] Tool ${toolCall.function?.name} error:`, err.message);
          toolResult = { error: err.message };
        }

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id || `call_${Date.now()}`,
          content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult || { error: 'no result' }),
        });
      }
      round++;
    }

    try {
      return await this.chat(currentMessages, { ...options, tools: null });
    } catch {
      return { content: 'I processed your request but ran into complexity. Please try a simpler question.' };
    }
  }

  async ask(prompt, systemPrompt = null, options = {}) {
    return this.chat(
      [{ role: 'user', content: prompt }],
      { ...options, systemPrompt }
    );
  }

  async isAvailable() {
    if (!this.apiKey) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.apiUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  getStats() {
    return {
      ...this.stats,
      circuitOpen: this._circuitOpen,
      consecutiveFailures: this._consecutiveFailures,
    };
  }
}

module.exports = new GroqClient();
