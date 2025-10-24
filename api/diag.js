import { getJSON, setJSON, keysForUser } from './_kv.js';
export default async function handler(req, res) {
  try {
    if (req.query?.dump === '1') {
      const uid = String(req.query.uid || '').trim();
      const keys = keysForUser(uid || 'debug');
      const state = {
        uid,
        tmp: uid ? await getJSON(keys.tmp) : null,
        budgetGlobal: await getJSON(keys.budgetGlobal),
        projectsList: await getJSON(keys.projectsList),
      };
      return res.status(200).json({ ok: true, state });
    }
    if (req.query?.kvtest === '1') {
      const key = String(req.query.key || 'creatorbottg:test');
      const val = String(req.query.val || 'hello');
      await setJSON(key, { v: val, ts: Date.now() });
      const back = await getJSON(key);
      return res.status(200).json({ ok: true, set: { key, val }, get: back });
    }
    return res.status(200).json({ ok:true, ts: Date.now() });
  } catch (e) {
    return res.status(200).json({ ok:false, error: String(e) });
  }
}
