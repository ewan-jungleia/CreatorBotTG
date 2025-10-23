import { getJSON, setJSON } from "./_kv.js";
export default async function handler(req, res) {
  const okEnv = {
    TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN
  };
  let kvOk = false;
  try { await setJSON("diag:pong",{t:Date.now()}); kvOk = !!(await getJSON("diag:pong",null)); } catch { kvOk=false; }
  res.status(200).json({ ok:true, okEnv, kvOk, ts: Date.now() });
}
