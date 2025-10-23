import { getJSON, setJSON, keysForUser } from './_kv.js';

export default async function handler(req, res) {
  try {
    const okEnv = {
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      KV_REST_API_URL: !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN
    };

    // ?dump=1&uid=123  -> affiche l'état assistant/budget/projets
    if (req.query?.dump === '1') {
      const uid = String(req.query.uid || '').trim();
      const keys = keysForUser(uid || 'debug');
      const state = {
        uid,
        tmp: uid ? await getJSON(keys.tmp) : null,
        budgetGlobal: await getJSON(keys.budgetGlobal),
        projectsList: await getJSON(keys.projectsList),
      };
      return res.status(200).json({ ok: true, okEnv, state });
    }

    // ?kvtest=1&key=creatorbottg:test&val=hello
    if (req.query?.kvtest === '1') {
      const key = String(req.query.key || 'creatorbottg:test');
      const val = String(req.query.val || 'hello');
      await setJSON(key, { v: val, ts: Date.now() });
      const back = await getJSON(key);
      return res.status(200).json({ ok: true, set: { key, val }, get: back });
    }

    return res.status(200).json({ ok: true, okEnv, ts: Date.now() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
