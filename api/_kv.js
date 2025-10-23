const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;

async function kvFetch(path, method = 'GET', body) {
  const url = `${KV_REST_API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`KV ${method} ${path} -> ${res.status}`);
  return res.json();
}

const NS = 'creatorbottg';
function k(...parts){ return [NS, ...parts].join(':'); }

export async function getJSON(key, fallback=null){
  const r = await kvFetch(`/get/${encodeURIComponent(key)}`);
  if (!r || !('result' in r) || r.result === null) return fallback;
  try { return JSON.parse(r.result); } catch { return fallback; }
}

export async function setJSON(key, val, ttlSec){
  const body = { value: JSON.stringify(val) };
  if (ttlSec) body.ttl = ttlSec;
  await kvFetch(`/set/${encodeURIComponent(key)}`, 'POST', body);
  return true;
}

export async function del(key){
  await kvFetch(`/del/${encodeURIComponent(key)}`, 'POST');
  return true;
}

export function keysForUser(){
  return {
    budgetGlobal: k('budget','global'),
    projectsList: k('projects','list'),
    project: (pid) => k('project', pid),
    tmp: (uid) => k('tmp', uid),
    secretsGlobal: k('secrets','global'),
    secretsProject: (pid) => k('secrets','project', pid),
    usageGlobal: k('usage','global'),
    usageProject: (pid) => k('usage','project', pid)
  };
}

export function now(){ return Math.floor(Date.now()/1000); }

export function pricePer1k(){
  const envP = process.env.PRICE_PER_1K;
  if (envP) return Number(envP);
  return 0.005;
}

export function estimateTokens(str){
  if (!str) return 0;
  const chars = [...String(str)].length;
  return Math.max(1, Math.round(chars/4));
}

export async function addUsage({ projectId, tokens }){
  const userUsageKey = k('usage','global');
  const projUsageKey = k('usage','project', projectId || 'none');
  const p = pricePer1k();
  const euros = (tokens/1000)*p;

  const u = (await getJSON(userUsageKey)) || { tokens:0, euros:0, history:[] };
  u.tokens += tokens;
  u.euros = Number((u.euros + euros).toFixed(4));
  u.history.push({ ts: now(), projectId: projectId || null, tokens, euros: Number(euros.toFixed(4)) });
  await setJSON(userUsageKey, u);

  const up = (await getJSON(projUsageKey)) || { tokens:0, euros:0, history:[] };
  up.tokens += tokens;
  up.euros = Number((up.euros + euros).toFixed(4));
  up.history.push({ ts: now(), tokens, euros: Number(euros.toFixed(4)) });
  await setJSON(projUsageKey, up);

  return { euros: Number(euros.toFixed(4)) };
}
