// Adaptateur KV tolérant (Upstash REST) + fallback mémoire.
const useMem = !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN;

let mem = null;
if (useMem) mem = new Map();

async function httpKV(method, key, value) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (method === "GET") {
    const r = await fetch(`${base}/get/${encodeURIComponent(key)}`, { headers });
    if (!r.ok) return null;
    const data = await r.json();
    return data.result ?? null;
  }
  if (method === "SET") {
    const r = await fetch(`${base}/set/${encodeURIComponent(key)}`, {
      method: "POST", headers, body: JSON.stringify({ value })
    });
    return r.ok;
  }
  if (method === "DEL") {
    const r = await fetch(`${base}/del/${encodeURIComponent(key)}`, { method: "POST", headers });
    return r.ok;
  }
  if (method === "INCRBY") {
    const r = await fetch(`${base}/incrby/${encodeURIComponent(key)}`, {
      method: "POST", headers, body: JSON.stringify({ value })
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.result ?? null;
  }
  return null;
}

export const kv = {
  async get(key) {
    if (useMem) return mem.has(key) ? mem.get(key) : null;
    return await httpKV("GET", key);
  },
  async set(key, val) {
    if (useMem) { mem.set(key, val); return true; }
    return await httpKV("SET", key, val);
  },
  async del(key) {
    if (useMem) { mem.delete(key); return true; }
    return await httpKV("DEL", key);
  },
  async incrBy(key, value) {
    if (useMem) {
      const cur = mem.get(key) || 0;
      const nxt = cur + value;
      mem.set(key, nxt);
      return nxt;
    }
    return await httpKV("INCRBY", key, value);
  }
};

export async function getJSON(key, fallback = null) {
  const raw = await kv.get(key);
  if (raw == null) return fallback;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return fallback; }
}
export async function setJSON(key, obj) {
  const val = typeof obj === "string" ? obj : JSON.stringify(obj);
  return await kv.set(key, val);
}
export async function delJSON(key) {
  return await kv.del(key);
}
