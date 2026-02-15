/**
 * Test AI providers connectivity.
 * Run: npm run test:ai
 */
require('dotenv').config();
const config = require('./config');

const TIMEOUT = 15000;

async function testKimi() {
  console.log('\n1. Testing Kimi K2...\n');

  if (!config.kimi.apiKey || config.kimi.apiKey === 'placeholder') {
    console.log('  ⚠ KIMI_API_KEY not set. Skipping.');
    return false;
  }

  try {
    const res = await fetch(`${config.kimi.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.kimi.apiKey}`,
      },
      body: JSON.stringify({
        model: config.kimi.model,
        messages: [{ role: 'user', content: 'Say "JARVIS online" in exactly 2 words.' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '(no content)';
    console.log(`  ✓ Kimi K2 (${config.kimi.model})`);
    console.log(`    Reply: ${reply.slice(0, 100)}`);
    console.log(`    Tokens: ${data.usage?.total_tokens || 'N/A'}`);
    return true;
  } catch (err) {
    console.log(`  ✗ Kimi K2: ${err.message}`);
    return false;
  }
}

async function testGemini() {
  console.log('\n2. Testing Google Gemini...\n');

  if (!config.gemini.apiKey) {
    console.log('  ⚠ GEMINI_API_KEY not set. Skipping.');
    return false;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.model}:generateContent?key=${config.gemini.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say "Gemini online" in exactly 2 words.' }] }],
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '(no content)';
    console.log(`  ✓ Gemini (${config.gemini.model})`);
    console.log(`    Reply: ${reply.slice(0, 100)}`);
    return true;
  } catch (err) {
    console.log(`  ✗ Gemini: ${err.message}`);
    return false;
  }
}

async function testOllama() {
  console.log('\n3. Testing Ollama (local AI)...\n');

  try {
    // Check if Ollama is running
    const tagsRes = await fetch(`${config.localAI.url}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!tagsRes.ok) throw new Error(`HTTP ${tagsRes.status}`);

    const tags = await tagsRes.json();
    const models = tags.models || [];
    console.log(`  ✓ Ollama is running at ${config.localAI.url}`);
    console.log(`    Models: ${models.map(m => m.name).join(', ') || '(none)'}`);

    // Check if target model is available
    const hasModel = models.some(m => m.name.startsWith(config.localAI.model.split(':')[0]));
    if (!hasModel) {
      console.log(`  ⚠ Model "${config.localAI.model}" not found. Run: ollama pull ${config.localAI.model}`);
      return true; // Ollama is running, just missing model
    }

    // Test generation
    const genRes = await fetch(`${config.localAI.url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.localAI.model,
        prompt: 'Say "Local AI online" in exactly 3 words.',
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!genRes.ok) throw new Error(`Generate HTTP ${genRes.status}`);

    const genData = await genRes.json();
    console.log(`  ✓ ${config.localAI.model} responding`);
    console.log(`    Reply: ${(genData.response || '').slice(0, 100)}`);
    return true;
  } catch (err) {
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
      console.log(`  ✗ Ollama not running. Start with: ollama serve`);
    } else {
      console.log(`  ✗ Ollama: ${err.message}`);
    }
    return false;
  }
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  JARVIS AI Provider Test');
  console.log('═══════════════════════════════════════');

  const results = {};

  results.kimi = await testKimi();
  results.gemini = await testGemini();
  results.ollama = await testOllama();

  console.log('\n═══════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════\n');

  const icons = { true: '✓', false: '✗' };
  console.log(`  Kimi K2:  ${icons[results.kimi]} ${results.kimi ? 'OK' : 'FAIL'}`);
  console.log(`  Gemini:   ${icons[results.gemini]} ${results.gemini ? 'OK' : 'FAIL'}`);
  console.log(`  Ollama:   ${icons[results.ollama]} ${results.ollama ? 'OK' : 'FAIL'}`);

  const anyPass = Object.values(results).some(v => v);
  if (!anyPass) {
    console.log('\n  ⚠ No AI providers available! Set API keys in .env or start Ollama.');
  } else {
    console.log('\n  At least one AI provider is working.');
  }

  console.log('\n═══════════════════════════════════════\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
