import { getJSON, setJSON, del, keysForUser, addUsage, pricePer1k, now, k } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;
const memFSM = new Map(); // cache mémoire d’état

function isAdmin(id){ return Number(id) === ADMIN_ID; }
function kb(rows){ return { inline_keyboard: rows }; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function fmtEurosCents(c){ return `${((c||0)/100).toFixed(2).replace('.',',')} €`; }

async function reply(chatId, text, markup){
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (markup) body.reply_markup = markup;
  await fetch(`${API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'📦 ZIP', callback_data:'act:zip-hint' }],
    [{ text:'🔑 Secrets', callback_data:'act:secrets' }, { text:'Reset', callback_data:'act:reset' }]
  ]);
}

async function ensureGlobalDefaults(){
  const keys = keysForUser();
  const b = await getJSON(keys.budgetGlobal);
  if (!b) await setJSON(keys.budgetGlobal, { capCents: 1000, alertStepCents: 100, pPer1k: pricePer1k() });
  const u = await getJSON(k('usage','global'));
  if (!u) await setJSON(k('usage','global'), { tokens:0, euros:0, history:[] });
}

async function handleStart(chatId){
  await ensureGlobalDefaults();
  memFSM.delete(chatId);
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

/* ===== BUDGET GLOBAL ===== */
async function handleBudgetMenu(chatId){
  const keys = keysForUser();
  const u = (await getJSON(k('usage','global'))) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = [
    'Budget global',
    `- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)`,
    `- Cap: ${fmtEurosCents(Number(b.capCents||0))}`,
    `- Alerte: ${fmtEurosCents(Number(b.alertStepCents||0))}`,
    `- Prix/1k tokens: ${pricePer1k()} €`
  ].join('\n');
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense', callback_data:'bdg:raz' }],
    [{ text:'Retour', callback_data:'act:menu' }]
  ];
  await reply(chatId, txt, kb(rows));
}

/* ===== FSM / Nouveau projet ===== */
function fsmKey(chatId){ return `fsm:${chatId}`; }

async function saveFSM(chatId, data){
  memFSM.set(chatId, data);
  await setJSON(fsmKey(chatId), data, 900);
}
async function loadFSM(chatId){
  if (memFSM.has(chatId)) return memFSM.get(chatId);
  const kv = await getJSON(fsmKey(chatId));
  if (kv) memFSM.set(chatId, kv);
  return kv;
}

async function askNewProjectTitle(chatId){
  await saveFSM(chatId, { step:'title' });
  await reply(chatId, 'Titre du projet ?', kb([[{ text:'Retour', callback_data:'act:menu' }]]));
}

async function askBudget(chatId, tmp){
  tmp.step = 'budget';
  tmp.capCents = tmp.capCents ?? 1000;
  tmp.alertStepCents = tmp.alertStepCents ?? 100;
  await saveFSM(chatId, tmp);
  const txt = `Budget pour <b>${escapeHtml(tmp.title||'')}</b>\nCap: ${fmtEurosCents(tmp.capCents)}\nAlerte: ${fmtEurosCents(tmp.alertStepCents)}`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'np:cap:+100' }, { text:'Cap -1€', callback_data:'np:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'np:al:+100' }, { text:'Alerte -1€', callback_data:'np:al:-100' }],
    [{ text:'OK', callback_data:'np:budget:ok' }]
  ];
  await reply(chatId, txt, kb(rows));
}

async function askPrompt(chatId, tmp){
  tmp.step = 'prompt';
  await saveFSM(chatId, tmp);
  await reply(chatId, 'Envoie le <b>prompt principal</b> (besoins, contraintes, livrables)…');
}

function summarizePrompt(p){
  const lines = String(p||'').split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,12).join('\n').slice(0,900);
}

async function confirmProject(chatId, tmp){
  tmp.step = 'confirm';
  await saveFSM(chatId, tmp);
  const summary = summarizePrompt(tmp.prompt||'');
  const rows = [
    [{ text:'Valider ✅', callback_data:'np:confirm:yes' }, { text:'Relire ✏️', callback_data:'np:confirm:no' }]
  ];
  await reply(chatId, `Résumé compris pour <b>${escapeHtml(tmp.title||'')}</b>:\n\n${escapeHtml(summary)}\n\nValider ?`, kb(rows));
}

async function persistProject(chatId, tmp){
  const keys = keysForUser();
  const id = Date.now().toString(36);
  const p = {
    id, title: tmp.title, version: 'v1', status: 'draft',
    budget: { capCents: tmp.capCents, alertStepCents: tmp.alertStepCents },
    prompt: tmp.prompt, created: now()
  };
  await setJSON(keys.project(id), p);
  const list = (await getJSON(keys.projectsList)) || [];
  list.unshift({ id, title: p.title, created: p.created });
  await setJSON(keys.projectsList, list);
  memFSM.delete(chatId);
  await del(fsmKey(chatId));
  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b> créé ✅`, kb([
    [{ text:'Ouvrir 📁', callback_data:`prj:open:${id}` }],
    [{ text:'Menu', callback_data:'act:menu' }]
  ]));
}

/* ===== ROUTEURS ===== */
async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;
  const tmp = await loadFSM(chatId);
  if (!tmp) return;

  if (tmp.step === 'title'){
    tmp.title = String(text||'').trim();
    await askBudget(chatId, tmp);
    return;
  }

  if (tmp.step === 'prompt'){
    tmp.prompt = text;
    await saveFSM(chatId, tmp);
    await confirmProject(chatId, tmp);
    return;
  }
}

async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;
  const tmp = await loadFSM(chatId) || {};

  if (data === 'act:menu') return handleStart(chatId);
  if (data === 'act:new')  return askNewProjectTitle(chatId);

  if (data.startsWith('np:')){
    const m = data.match(/^np:(cap|al):([+-]\d+)$/);
    if (m){
      const [_, kind, val] = m;
      tmp.capCents = tmp.capCents ?? 1000;
      tmp.alertStepCents = tmp.alertStepCents ?? 100;
      const delta = Number(val);
      if (kind==='cap') tmp.capCents += delta;
      if (kind==='al') tmp.alertStepCents += delta;
      await askBudget(chatId, tmp);
      return;
    }
    if (data==='np:budget:ok') return askPrompt(chatId, tmp);
    if (data==='np:confirm:yes') return persistProject(chatId, tmp);
    if (data==='np:confirm:no'){ tmp.step='prompt'; await saveFSM(chatId,tmp); return reply(chatId,'Renvoie ton prompt corrigé.'); }
  }

  if (data==='act:list') return listProjects(chatId);
}

export default async function handler(req,res){
  if (req.method==='GET') return res.status(200).send('OK');
  try{
    const upd = req.body||{};
    const msg=upd.message; const cb=upd.callback_query;
    if (msg && msg.text){
      const chatId=msg.chat.id, fromId=msg.from.id;
      if (!isAdmin(fromId)){ await reply(chatId,'Accès refusé'); return res.json({ok:true}); }
      if (msg.text==='/start') await handleStart(chatId);
      else await handleText(chatId,fromId,msg.text);
      return res.json({ok:true});
    }
    if (cb){
      const chatId=cb.message.chat.id, fromId=cb.from.id;
      if (!isAdmin(fromId)){ await reply(chatId,'Accès refusé'); return res.json({ok:true}); }
      await handleCallback(chatId,fromId,cb.data||'');
      await fetch(`${API}/answerCallbackQuery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callback_query_id:cb.id})});
      return res.json({ok:true});
    }
    return res.json({ok:true});
  }catch(e){ return res.status(200).json({ok:true,error:String(e)}); }
}
