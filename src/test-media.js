/**
 * Test Media Pipeline — Cloudinary, image gen, TTS, media forwarding.
 * Run: npm run test:media
 */
require('dotenv').config();
const config = require('./config');
const cloudinary = require('./media/cloudinary');

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  JARVIS Media Pipeline Test');
  console.log('═══════════════════════════════════════\n');

  const results = {};

  // ─── 1. Cloudinary Config ────────────────────────
  console.log('1. Cloudinary Configuration\n');

  if (cloudinary.isAvailable()) {
    console.log(`  ✓ Cloudinary configured`);
    console.log(`    Cloud name: ${config.cloudinary.cloudName}`);
    console.log(`    API Key:    ${config.cloudinary.apiKey?.slice(0, 6)}...`);
    console.log(`    Preset:     ${config.cloudinary.uploadPreset}`);
    results.config = true;
  } else {
    console.log('  ✗ Cloudinary NOT configured');
    console.log('    Add to .env:');
    console.log('      CLOUDINARY_CLOUD_NAME=your-cloud-name');
    console.log('      CLOUDINARY_API_KEY=your-api-key');
    console.log('      CLOUDINARY_API_SECRET=your-api-secret');
    results.config = false;
  }

  // ─── 2. Cloudinary Connection ────────────────────
  console.log('\n2. Cloudinary Connection\n');

  if (cloudinary.isAvailable()) {
    try {
      const usage = await cloudinary.getUsage();
      console.log('  ✓ Connected to Cloudinary');
      console.log(`    Storage:    ${usage.storage.used} / ${usage.storage.limit}`);
      console.log(`    Bandwidth:  ${usage.bandwidth.used} / ${usage.bandwidth.limit}`);
      console.log(`    Resources:  ${usage.resources}`);
      results.connection = true;
    } catch (err) {
      console.log(`  ✗ Connection failed: ${err.message}`);
      results.connection = false;
    }
  } else {
    console.log('  ⚠ Skipped (not configured)');
    results.connection = false;
  }

  // ─── 3. Upload Test (small buffer) ───────────────
  console.log('\n3. Buffer Upload Test\n');

  if (cloudinary.isAvailable()) {
    try {
      // Create a tiny test PNG (1x1 red pixel)
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
        'base64'
      );

      const upload = await cloudinary.uploadBuffer(pngBuffer, 'test_pixel.png', {
        folder: 'jrv/test',
        resourceType: 'image',
        publicId: `test_${Date.now()}`,
      });

      console.log('  ✓ Upload successful');
      console.log(`    URL:       ${upload.secureUrl}`);
      console.log(`    Public ID: ${upload.publicId}`);
      console.log(`    Format:    ${upload.format}`);
      console.log(`    Size:      ${upload.bytes} bytes`);
      results.upload = true;

      // Clean up test file
      try {
        await cloudinary.delete(upload.publicId, 'image');
        console.log('  ✓ Test file cleaned up');
      } catch {
        console.log('  ⚠ Could not clean up test file');
      }
    } catch (err) {
      console.log(`  ✗ Upload failed: ${err.message}`);
      results.upload = false;
    }
  } else {
    console.log('  ⚠ Skipped (not configured)');
    results.upload = false;
  }

  // ─── 4. List Folders ─────────────────────────────
  console.log('\n4. Cloud Folders\n');

  if (cloudinary.isAvailable()) {
    const folders = [
      { name: 'jrv/voice', type: 'video', label: 'Voice Notes' },
      { name: 'jrv/images', type: 'image', label: 'Images' },
      { name: 'jrv/videos', type: 'video', label: 'Videos' },
      { name: 'jrv/payments', type: 'image', label: 'Payment Proofs' },
    ];

    for (const f of folders) {
      try {
        const files = await cloudinary.listFolder(f.name, f.type, 5);
        console.log(`  ${f.label.padEnd(16)} ${files.length} files`);
        results[f.name] = true;
      } catch (err) {
        console.log(`  ${f.label.padEnd(16)} error: ${err.message.slice(0, 60)}`);
        results[f.name] = false;
      }
    }
  } else {
    console.log('  ⚠ Skipped (not configured)');
  }

  // ─── 5. TTS Engine Check ─────────────────────────
  console.log('\n5. TTS Engine Check\n');

  try {
    const { execSync } = require('child_process');
    const findCmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${findCmd} edge-tts`, { stdio: 'pipe' });
    console.log('  ✓ edge-tts CLI installed');
    results.edgeTts = true;
  } catch {
    try {
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      require('child_process').execSync(`${pyCmd} -c "import edge_tts"`, { stdio: 'pipe' });
      console.log('  ✓ edge-tts Python module installed');
      results.edgeTts = true;
    } catch {
      console.log('  ✗ edge-tts not found');
      console.log('    Install: pip install edge-tts');
      results.edgeTts = false;
    }
  }

  // Piper TTS local
  try {
    const res = await fetch(`${config.tts.localUrl}/api/voices`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      console.log(`  ✓ Piper TTS running at ${config.tts.localUrl}`);
      results.piperTts = true;
    } else {
      console.log(`  ⚠ Piper TTS responded with ${res.status}`);
      results.piperTts = false;
    }
  } catch {
    console.log(`  ⚠ Piper TTS not running at ${config.tts.localUrl}`);
    results.piperTts = false;
  }

  // ─── 6. Image Analysis Engines ───────────────────
  console.log('\n6. Image Analysis Engines\n');

  // Gemini Vision
  if (config.gemini.apiKey) {
    console.log('  ✓ Gemini Vision available (API key set)');
    results.geminiVision = true;
  } else {
    console.log('  ⚠ Gemini Vision unavailable (no GEMINI_API_KEY)');
    results.geminiVision = false;
  }

  // Ollama LLaVA
  try {
    const res = await fetch(`${config.localAI.url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const tags = await res.json();
      const hasLlava = (tags.models || []).some(m => m.name.includes('llava'));
      if (hasLlava) {
        console.log('  ✓ LLaVA available on Ollama');
        results.llava = true;
      } else {
        console.log('  ⚠ Ollama running but no LLaVA model');
        console.log('    Install: ollama pull llava');
        results.llava = false;
      }
    }
  } catch {
    console.log('  ⚠ Ollama not running (no local vision)');
    results.llava = false;
  }

  // Tesseract OCR
  try {
    require('tesseract.js');
    console.log('  ✓ Tesseract.js installed (OCR fallback)');
    results.tesseract = true;
  } catch {
    console.log('  ⚠ Tesseract.js not installed');
    results.tesseract = false;
  }

  // ─── Summary ─────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════\n');

  const icon = v => v ? '✓' : '✗';
  console.log(`  Cloudinary Config:   ${icon(results.config)} ${results.config ? 'OK' : 'MISSING'}`);
  console.log(`  Cloudinary Connect:  ${icon(results.connection)} ${results.connection ? 'OK' : 'FAIL'}`);
  console.log(`  Cloudinary Upload:   ${icon(results.upload)} ${results.upload ? 'OK' : 'FAIL'}`);
  console.log(`  Edge TTS:            ${icon(results.edgeTts)} ${results.edgeTts ? 'OK' : 'NOT INSTALLED'}`);
  console.log(`  Piper TTS:           ${icon(results.piperTts)} ${results.piperTts ? 'OK' : 'NOT RUNNING'}`);
  console.log(`  Gemini Vision:       ${icon(results.geminiVision)} ${results.geminiVision ? 'OK' : 'NO KEY'}`);
  console.log(`  LLaVA (local):       ${icon(results.llava)} ${results.llava ? 'OK' : 'NOT AVAILABLE'}`);
  console.log(`  Tesseract OCR:       ${icon(results.tesseract)} ${results.tesseract ? 'OK' : 'NOT INSTALLED'}`);

  const criticalPass = results.config && results.connection;
  if (criticalPass) {
    console.log('\n  Media pipeline ready!');
  } else if (!results.config) {
    console.log('\n  ⚠ Add Cloudinary credentials to .env first.');
  } else {
    console.log('\n  ⚠ Some services unavailable. Check above for details.');
  }

  console.log('\n═══════════════════════════════════════\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
