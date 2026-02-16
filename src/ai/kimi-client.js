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
 *
 * Robustness: Circuit breaker, null-safe parsing, timeouts, retries.
 */

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];
const REQUEST_TIMEOUT = 30000;
const CIRCUIT_BREAKER_THRESHOLD = 5;    // consecutive failures to trip
const CIRCUIT_BREAKER_RESET_MS = 60000; // 1 min before retry after tripped

class KimiClient {
  constructor() {
    this.apiUrl = config.kimi.apiUrl;
    this.apiKey = config.kimi.apiKey;
    this.model = config.kimi.model;
    this.thinkingModel = config.kimi.thinkingModel || 'kimi-k2-thinking';
    this.stats = { calls: 0, tokens: 0, errors: 0, toolCalls: 0 };

    // Circuit breaker state
    this._consecutiveFailures = 0;
    this._circuitOpen = false;
    this._circuitOpenedAt = 0;
  }

  /**
   * Check if circuit breaker allows requests through.
   */
  _checkCircuit() {
    if (!this._circuitOpen) return true;
    // Check if enough time passed to allow a retry
    if (Date.now() - this._circuitOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
      this._circuitOpen = false;
      this._consecutiveFailures = 0;
      console.log('[Kimi] Circuit breaker reset — retrying');
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
      console.warn(`[Kimi] Circuit breaker OPEN after ${this._consecutiveFailures} failures — pausing for ${CIRCUIT_BREAKER_RESET_MS / 1000}s`);
    }
  }

  /**
   * Safely extract response from API data.
   * Never throws on malformed response — returns fallback instead.
   */
  _parseResponse(data) {
    if (!data) {
      console.warn('[Kimi] Empty response data');
      return { content: null, error: 'Empty response from Kimi API' };
    }

    if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
      console.warn('[Kimi] No choices in response:', JSON.stringify(data).slice(0, 300));
      // Check for error in response body
      if (data.error) {
        return { content: null, error: `Kimi API error: ${data.error.message || JSON.stringify(data.error).slice(0, 200)}` };
      }
      return { content: null, error: 'Kimi returned empty choices' };
    }

    const choice = data.choices[0];
    if (!choice || !choice.message) {
      console.warn('[Kimi] Choice has no message:', JSON.stringify(choice).slice(0, 200));
      return { content: null, error: 'Kimi returned choice without message' };
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

    // Circuit breaker check
    if (!this._checkCircuit()) {
      throw new Error('Kimi circuit breaker open — too many consecutive failures');
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
          console.warn(`[Kimi] Rate limited, waiting ${waitMs}ms (attempt ${attempt + 1})`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errText = await response.text().catch(() => 'unknown error');
          throw new Error(`Kimi API ${response.status}: ${errText.slice(0, 200)}`);
        }

        let data;
        try {
          data = await response.json();
        } catch (parseErr) {
          throw new Error(`Kimi response not valid JSON: ${parseErr.message}`);
        }

        const result = this._parseResponse(data);

        // If parsing found an error in the response body, throw to trigger retry
        if (result.error && !result.content) {
          throw new Error(result.error);
        }

        // Success path
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
          console.warn(`[Kimi] Error: ${err.message}, retrying in ${waitMs}ms (${attempt + 1}/${MAX_RETRIES})`);
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
   * Guarded: tool parse failures don't crash, tool timeouts handled.
   */
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
        // If chat itself fails mid-tool-loop, return what we have
        console.error(`[Kimi] chatWithTools round ${round} failed:`, err.message);
        if (round > 0) {
          // Try one more time without tools to get a text response
          try {
            return await this.chat(currentMessages, { ...options, tools: null });
          } catch {
            return { content: `Sorry, I encountered an error: ${err.message}`, error: err.message };
          }
        }
        throw err;
      }

      if (!result.toolCalls) return result;

      // Build assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls,
      });

      // Execute each tool with timeout protection
      for (const toolCall of result.toolCalls) {
        let toolResult;
        try {
          // Parse arguments safely
          let args = {};
          if (toolCall.function && toolCall.function.arguments) {
            try {
              args = JSON.parse(toolCall.function.arguments);
            } catch (parseErr) {
              console.warn(`[Kimi] Bad tool args for ${toolCall.function?.name}: ${parseErr.message}`);
              args = {};
            }
          }

          const toolName = toolCall.function?.name || 'unknown';

          // Execute with 15s timeout
          toolResult = await Promise.race([
            toolExecutor(toolName, args),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool ${toolName} timed out after 15s`)), 15000)),
          ]);
        } catch (err) {
          console.warn(`[Kimi] Tool ${toolCall.function?.name} error:`, err.message);
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

    // Exceeded max rounds — get final text response without tools
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

module.exports = new KimiClient();
