/**
 * GET/POST /api/config — Bot configuration (model switching, etc).
 * Reads/writes to bot_data_store key 'bot_config'.
 *
 * GET  — Returns current config
 * POST — Updates config: { kimiModel, localModel, aiMode, geminiModel }
 */
const { getClient } = require('./_lib/supabase');
const { auth } = require('./_lib/auth');

const CONFIG_KEY = 'bot_config';

const VALID_KIMI_MODELS = [
  'kimi-k2.5',
  'kimi-k2-0905-preview',
  'kimi-k2-thinking',
];

const VALID_GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

const VALID_LOCAL_MODELS = [
  'llama3.1:8b',
  'llama3.2:3b',
  'llama3.2:1b',
  'mistral:7b',
  'phi3:mini',
  'qwen2:7b',
];

const VALID_AI_MODES = ['auto', 'cloud-only', 'local-only'];

module.exports = async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const supabase = getClient();

    if (req.method === 'GET') {
      const { data } = await supabase
        .from('bot_data_store')
        .select('value, updated_at')
        .eq('key', CONFIG_KEY)
        .single();

      return res.json({
        config: data?.value || {},
        updatedAt: data?.updated_at || null,
        options: {
          kimiModels: VALID_KIMI_MODELS,
          geminiModels: VALID_GEMINI_MODELS,
          localModels: VALID_LOCAL_MODELS,
          aiModes: VALID_AI_MODES,
        },
      });
    }

    if (req.method === 'POST') {
      const { kimiModel, localModel, geminiModel, aiMode } = req.body || {};
      const updates = {};

      if (kimiModel) {
        if (!VALID_KIMI_MODELS.includes(kimiModel)) {
          return res.status(400).json({ error: `Invalid Kimi model. Valid: ${VALID_KIMI_MODELS.join(', ')}` });
        }
        updates.kimiModel = kimiModel;
      }

      if (localModel) {
        if (!VALID_LOCAL_MODELS.includes(localModel)) {
          return res.status(400).json({ error: `Invalid local model. Valid: ${VALID_LOCAL_MODELS.join(', ')}` });
        }
        updates.localModel = localModel;
      }

      if (geminiModel) {
        if (!VALID_GEMINI_MODELS.includes(geminiModel)) {
          return res.status(400).json({ error: `Invalid Gemini model. Valid: ${VALID_GEMINI_MODELS.join(', ')}` });
        }
        updates.geminiModel = geminiModel;
      }

      if (aiMode) {
        if (!VALID_AI_MODES.includes(aiMode)) {
          return res.status(400).json({ error: `Invalid AI mode. Valid: ${VALID_AI_MODES.join(', ')}` });
        }
        updates.aiMode = aiMode;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid updates provided' });
      }

      // Read current config, merge updates
      const { data: existing } = await supabase
        .from('bot_data_store')
        .select('value')
        .eq('key', CONFIG_KEY)
        .single();

      const merged = { ...(existing?.value || {}), ...updates, updatedAt: new Date().toISOString() };

      const { error } = await supabase
        .from('bot_data_store')
        .upsert({
          key: CONFIG_KEY,
          value: merged,
          created_by: 'dashboard',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });

      if (error) throw error;

      return res.json({ success: true, config: merged });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
