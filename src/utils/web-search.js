/**
 * Web Search & URL Fetch Utility
 *
 * Gives JARVIS access to the internet — search, read pages, get current info.
 *
 * Search providers (in priority order):
 *   1. Tavily  — AI-optimized search, 1000 free searches/month
 *   2. Brave   — Privacy-focused, 2000 free queries/month
 *   3. DuckDuckGo — No API key needed (fallback, less reliable)
 *
 * Set TAVILY_API_KEY or BRAVE_API_KEY in .env
 */

const axios = require('axios');
const config = require('../config');

class WebSearch {
  constructor() {
    this.tavilyKey = process.env.TAVILY_API_KEY || null;
    this.braveKey = process.env.BRAVE_API_KEY || null;
    this.stats = { searches: 0, fetches: 0, errors: 0 };
  }

  /**
   * Search the web. Returns top results with titles, URLs, and snippets.
   */
  async search(query, options = {}) {
    const { maxResults = 5, searchDepth = 'basic' } = options;
    this.stats.searches++;

    // Try Tavily first (best for AI agents)
    if (this.tavilyKey) {
      try {
        return await this._tavilySearch(query, maxResults, searchDepth);
      } catch (err) {
        console.warn('[WebSearch] Tavily failed:', err.message);
      }
    }

    // Try Brave Search
    if (this.braveKey) {
      try {
        return await this._braveSearch(query, maxResults);
      } catch (err) {
        console.warn('[WebSearch] Brave failed:', err.message);
      }
    }

    // Fallback: DuckDuckGo instant answers (no key needed, limited)
    try {
      return await this._ddgSearch(query, maxResults);
    } catch (err) {
      console.warn('[WebSearch] DuckDuckGo failed:', err.message);
      this.stats.errors++;
      return { error: 'All search providers failed. Set TAVILY_API_KEY or BRAVE_API_KEY in .env for reliable search.' };
    }
  }

  /**
   * Fetch and extract text content from a URL.
   */
  async fetchUrl(url, options = {}) {
    const { maxLength = 5000 } = options;
    this.stats.fetches++;

    try {
      // Use Tavily extract if available (better at extracting clean content)
      if (this.tavilyKey) {
        try {
          const resp = await axios.post('https://api.tavily.com/extract', {
            api_key: this.tavilyKey,
            urls: [url],
          }, { timeout: 15000 });

          if (resp.data?.results?.[0]) {
            const result = resp.data.results[0];
            const content = (result.raw_content || result.content || '').slice(0, maxLength);
            return {
              url,
              title: result.title || url,
              content,
              source: 'tavily',
            };
          }
        } catch (e) {
          // Fall through to direct fetch
        }
      }

      // Direct fetch with HTML stripping
      const resp = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'JARVIS-Bot/1.0 (JRV Car Rental AI Assistant)',
          'Accept': 'text/html,application/json,text/plain',
        },
        maxRedirects: 3,
        responseType: 'text',
      });

      const contentType = resp.headers['content-type'] || '';
      let text = resp.data;

      if (contentType.includes('text/html')) {
        text = this._stripHtml(text);
      }

      // Truncate
      text = text.slice(0, maxLength);

      return {
        url,
        title: this._extractTitle(resp.data) || url,
        content: text,
        source: 'direct',
      };
    } catch (err) {
      this.stats.errors++;
      return { error: `Failed to fetch ${url}: ${err.message}` };
    }
  }

  // ─── Tavily Search ────────────────────────────────────

  async _tavilySearch(query, maxResults, searchDepth) {
    const resp = await axios.post('https://api.tavily.com/search', {
      api_key: this.tavilyKey,
      query,
      max_results: maxResults,
      search_depth: searchDepth,
      include_answer: true,
    }, { timeout: 15000 });

    const data = resp.data;
    return {
      answer: data.answer || null,
      results: (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: (r.content || '').slice(0, 300),
      })),
      source: 'tavily',
    };
  }

  // ─── Brave Search ─────────────────────────────────────

  async _braveSearch(query, maxResults) {
    const resp = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: query, count: maxResults },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.braveKey,
      },
      timeout: 10000,
    });

    const results = (resp.data?.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: (r.description || '').slice(0, 300),
    }));

    return { answer: null, results, source: 'brave' };
  }

  // ─── DuckDuckGo (no API key, limited) ────────────────

  async _ddgSearch(query, maxResults) {
    // DDG instant answer API — gives quick facts, not full search results
    const resp = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_redirect: 1, no_html: 1 },
      timeout: 8000,
    });

    const data = resp.data;
    const results = [];

    // Extract abstract
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText.slice(0, 300),
      });
    }

    // Extract related topics
    for (const topic of (data.RelatedTopics || []).slice(0, maxResults - 1)) {
      if (topic.Text) {
        results.push({
          title: topic.Text.split(' - ')[0] || '',
          url: topic.FirstURL || '',
          snippet: topic.Text.slice(0, 300),
        });
      }
    }

    // If nothing found, return a helpful message
    if (results.length === 0) {
      return {
        answer: data.Answer || null,
        results: [],
        source: 'duckduckgo',
        note: 'DuckDuckGo instant answers are limited. Set TAVILY_API_KEY or BRAVE_API_KEY for full search.',
      };
    }

    return { answer: data.Answer || null, results, source: 'duckduckgo' };
  }

  // ─── Helpers ──────────────────────────────────────────

  _stripHtml(html) {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  }

  isAvailable() {
    return !!(this.tavilyKey || this.braveKey);
  }

  getProvider() {
    if (this.tavilyKey) return 'Tavily';
    if (this.braveKey) return 'Brave';
    return 'DuckDuckGo (fallback)';
  }

  getStats() {
    return {
      ...this.stats,
      provider: this.getProvider(),
      available: this.isAvailable(),
    };
  }
}

module.exports = new WebSearch();
