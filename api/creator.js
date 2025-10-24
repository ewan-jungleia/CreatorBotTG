import { getJSON, setJSON, del, keysForUser, estimateTokens, addUsage, pricePer1k, now } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }

async function reply(chatId, text, kb){
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (kb) body.reply_markup = kb;
  await fetch(`${API}/sendMessage`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
}

function kb(rows){ return { inline_keyboard: rows }; }

function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP', callback_data:'act:zip' }, { text:'♻️ Reset', callback_data:'act:reset' }]
  ]);
}

async function ensureGlobalDefaults(){
  const keys = keysForUser('global');
  const b = await getJSON(keys.budgetGlobal);
  if (!b || typeof b !== 'object' || b.capCents == null || b.alertStepCents == null) {
    await setJSON(keys.budgetGlobal, { capCents:1000, alertStepCents:100, pPer1k: pricePer1k() });
  }
}

async function handleStart(chatId){
  await ensureGlobalDefaults();
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

function askTitleKB(){ return kb([[{ text:'⬅️ Retour menu', callback_data:'act:menu' }]]); }

async function askNewProjectTitle(chatId, userId){
  const keys = keysForUser(userId);
  await setJSON(keys.tmp, { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', askTitleKB());
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function summarizePrompt(p){
  const lines = String(p).split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,10).join('\n').slice(0,700);
}

async function listProjects(chatId){
  const keys = keysForUser('global');
  const list = (await getJSON(keys.projectsList)) || [];
  if (!list.length){
    await reply(chatId, 'Aucun projet. Lance un nouveau projet.',
      kb([[{ text:'🆕 Nouveau projet', callback_data:'act:new' }],
          [{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
    return;
  }
  const rows = list.map(p => [{ text:`📁 ${p.title} (${p.id})`, callback_data:`prj:open:${p.id}` }]);
  rows.push([{ text:'⬅️ Retour', callback_data:'act:menu' }]);
  await reply(chatId, 'Projets :', kb(rows));
}

function fmtEurosCents(cents){ return `${(cents/100).toFixed(2).replace('.',',')} €`; }

async function handleBudgetMenu(chatId){
  await ensureGlobalDefaults();
  const keys = keysForUser('global');
  const u = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0, pPer1k: pricePer1k() };
  const txt = `Budget global
- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)
- Cap: ${fmtEurosCents(b.capCents||0)}
- Alerte: ${fmtEurosCents(b.alertStepCents||0)}
- Prix/1k tokens: ${b.pPer1k ?? pricePer1k()} €`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense (manuelle)', callback_data:'bdg:raz' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ];
  await reply(chatId, txt, kb(rows));
}

async function adjustBudget(chatId, kind, delta){
  const keys = keysForUser('global');
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0, pPer1k: pricePer1k() };
  if (kind === 'cap') b.capCents = Math.max(0, (b.capCents||0) + delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0, (b.alertStepCents||0) + delta);
  await setJSON(keys.budgetGlobal, b);
  await handleBudgetMenu(chatId);
}

async function resetSpent(chatId){
  await setJSON('creatorbottg:usage:global', { tokens:0, euros:0, history:[] });
  await reply(chatId, 'Dépense globale remise à zéro.', kb([[{ text:'⬅️ Retour', callback_data:'act:budget' }]]));
}

/* ===== Flow Nouveau Projet (étapes: title -> budget -> prompt -> confirm) ===== */

async function handleText(chatId, userId, text){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);

  if (!tmp || !tmp.step) {
    await reply(chatId, 'Utilise le menu ci-dessous.', mainMenu());
    return;
  }

  if (tmp.step === 'title'){
    const title = text.trim();
    const next = { step:'budget', title };
    await setJSON(keys.tmp, next, 900);

    const kbBudget = kb([
      [{ text:'Cap 10€', callback_data:'np:cap:1000' }, { text:'Cap 20€', callback_data:'np:cap:2000' }],
      [{ text:'Alerte 1€', callback_data:'np:alert:100' }, { text:'Alerte 2€', callback_data:'np:alert:200' }],
      [{ text:'OK', callback_data:'np:budget:ok' }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
    ]);
    await reply(chatId, `Budget pour <b>${escapeHtml(title)}</b>`, kbBudget);
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
  if (data === 'act:list') return listProjects(chatId);
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset') { await ensureGlobalDefaults(); return handleStart(chatId); }

  // Budget global
  if (data.startsWith('bdg:')){
    const [, kind, deltaStr] = data.split(':'); // kind in {cap,al}
    if (kind === 'raz') return resetSpent(chatId);
    const delta = Number(deltaStr);
    return adjustBudget(chatId, kind, delta);
  }

  // Nouveau projet: budget step
  if (data.startsWith('np:')){
    const keys = keysForUser(userId);
    const tmp = (await getJSON(keys.tmp)) || {};
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
      await fetch(`${API}/answerCallbackQuery`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ callback_query_id: cb.id })
      });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:true, error: String(e) });
  }
}
