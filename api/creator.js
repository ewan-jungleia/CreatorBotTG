import { getJSON, setJSON, del, keysForUser, pricePer1k } from './_kv.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }

async function reply(chatId, text, kb){
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (kb) body.reply_markup = kb;
  await fetch(`${API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

function kb(rows){ return { inline_keyboard: rows }; }
function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP', callback_data:'act:zip' }, { text:'♻️ Reset', callback_data:'act:reset' }]
  ]);
}
function askTitleKB(){ return kb([[{ text:'⬅️ Retour menu', callback_data:'act:menu' }]]); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function summarizePrompt(p){ const lines = String(p).split('\n').map(l=>l.trim()).filter(Boolean); return lines.slice(0,10).join('\n').slice(0,700); }

// --- Normalisations défensives ---
function normTmp(v){
  // Accepte {}, {step:"..."}, ou vieilles formes {value:"{...}"}
  if (!v) return null;
  if (typeof v === 'string') {
    try { const x = JSON.parse(v); return normTmp(x); } catch { return null; }
  }
  if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'string') {
    try { const x = JSON.parse(v.value); return normTmp(x); } catch { return null; }
  }
  if (v && typeof v === 'object') return v;
  return null;
}
function normBudget(v){
  const def = { capCents:1000, alertStepCents:100, pPer1k: pricePer1k() };
  if (!v) return def;
  if (typeof v === 'string') { try { return normBudget(JSON.parse(v)); } catch { return def; } }
  if (v && typeof v === 'object' && 'value' in v) { try { return normBudget(JSON.parse(v.value)); } catch { return def; } }
  return {
    capCents: Math.max(0, Number(v.capCents||0)),
    alertStepCents: Math.max(0, Number(v.alertStepCents||0)),
    pPer1k: Number(v.pPer1k ?? pricePer1k())
  };
}

async function ensureGlobalDefaults(){
  const keys = keysForUser('global');
  const b0 = await getJSON(keys.budgetGlobal);
  const b = normBudget(b0);
  await setJSON(keys.budgetGlobal, b);
}

async function handleStart(chatId){
  await ensureGlobalDefaults();
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

async function askNewProjectTitle(chatId, userId){
  const keys = keysForUser(userId);
  await setJSON(keys.tmp, { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', askTitleKB());
}

function budgetStepKB(title){
  return kb([
    [{ text:'Cap 10€', callback_data:'np:cap:1000' }, { text:'Cap 20€', callback_data:'np:cap:2000' }],
    [{ text:'Alerte 1€', callback_data:'np:alert:100' }, { text:'Alerte 2€', callback_data:'np:alert:200' }],
    [{ text:'OK', callback_data:'np:budget:ok' }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);
}

async function handleBudgetMenu(chatId){
  const keys = keysForUser('global');
  const b = normBudget(await getJSON(keys.budgetGlobal));
  await setJSON(keys.budgetGlobal, b);
  const txt = `Budget global
- Cap: ${(b.capCents/100).toFixed(2)} €
- Alerte: ${(b.alertStepCents/100).toFixed(2)} €
- Prix/1k tokens: ${b.pPer1k.toFixed(3)} €`;
  await reply(chatId, txt, kb([
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ]));
}

async function adjustBudget(chatId, kind, delta){
  const keys = keysForUser('global');
  const b = normBudget(await getJSON(keys.budgetGlobal));
  if (kind === 'cap') b.capCents = Math.max(0, (b.capCents||0) + delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0, (b.alertStepCents||0) + delta);
  await setJSON(keys.budgetGlobal, b);
  await handleBudgetMenu(chatId);
}

/* ===== FSM Nouveau Projet ===== */

async function handleText(chatId, userId, text){
  const keys = keysForUser(userId);
  const tmp = normTmp(await getJSON(keys.tmp));

  if (!tmp || !tmp.step) {
    await reply(chatId, 'Utilise le menu ci-dessous.', mainMenu());
    return;
  }

  if (tmp.step === 'title'){
    const title = String(text || '').trim();
    const next = { step:'budget', title };
    await setJSON(keys.tmp, next, 900);
    await reply(chatId, `Budget pour <b>${escapeHtml(title)}</b>`, budgetStepKB(title));
    return;
  }

  if (tmp.step === 'prompt'){
    const next = { ...tmp, prompt: text, step:'confirm' };
    await setJSON(keys.tmp, next, 900);
    const summary = summarizePrompt(text);
    await reply(chatId, `Résumé compris :\n\n${escapeHtml(summary)}\n\nValider ?`,
      kb([[{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier', callback_data:'np:confirm:no' }],
          [{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
    return;
  }

  await reply(chatId, 'Utilise le menu ci-dessous.', mainMenu());
}

async function handleCallback(chatId, userId, data){
  if (data === 'act:menu') return handleStart(chatId);
  if (data === 'act:new')  return askNewProjectTitle(chatId, userId);
  if (data === 'act:list') return reply(chatId, 'Bientôt.', kb([[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset') { await ensureGlobalDefaults(); return handleStart(chatId); }

  // Budget global
  if (data.startsWith('bdg:')){
    const [, kind, deltaStr] = data.split(':');
    const delta = Number(deltaStr);
    return adjustBudget(chatId, kind, delta);
  }

  // Nouveau projet - étape budget
  if (data.startsWith('np:')){
    const keys = keysForUser(userId);
    const tmp = normTmp(await getJSON(keys.tmp)) || {};
    const [, act, val] = data.split(':');

    if (act === 'cap')   { tmp.capCents = Number(val); tmp.step = 'budget'; await setJSON(keys.tmp, tmp, 900); return reply(chatId, `Cap défini: ${(tmp.capCents/100).toFixed(2)} €`); }
    if (act === 'alert') { tmp.alertStepCents = Number(val); tmp.step = 'budget'; await setJSON(keys.tmp, tmp, 900); return reply(chatId, `Alerte: ${(tmp.alertStepCents/100).toFixed(2)} €`); }
    if (act === 'budget' && val === 'ok') {
      tmp.step = 'prompt';
      await setJSON(keys.tmp, tmp, 900);
      return reply(chatId, 'Envoie le prompt principal (objectif, contraintes, livrables, etc.)', kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
    }
  }
}

/* ===== HTTP ENTRY ===== */

export default async function handler(req,res){
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ ok:false });

  try{
    const update = req.body || {};
    const msg = update.message;
    const cb  = update.callback_query;

    if (msg && msg.text){
      const fromId = msg.from?.id || msg.chat?.id;
      if (!isAdmin(fromId)){ await reply(msg.chat.id,'❌ Accès refusé – bot privé.'); return res.json({ok:true}); }
      if (msg.text === '/start') await handleStart(msg.chat.id);
      else await handleText(msg.chat.id, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await reply(chatId,'❌ Accès refusé – bot privé.'); return res.json({ok:true}); }
      await handleCallback(chatId, fromId, cb.data || '');
      await fetch(`${API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ callback_query_id: cb.id }) });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:true, error: String(e) });
  }
}
