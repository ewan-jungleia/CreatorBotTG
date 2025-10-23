import { getJSON } from './_kv.js';

export default async function handler(req, res) {
  try {
    const okEnv = {
      TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      KV_REST_API_URL: !!process.env.KV_REST_API_URL,
      KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN
    };
    let kvOk = false;
    try { await getJSON('creatorbottg:ping:test'); kvOk = true; } catch { kvOk = false; }
    return res.status(200).json({ ok: true, okEnv, kvOk, ts: Date.now() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
}
