import { getJSON, setJSON, del, keysForUser, pricePer1k } from './_kv.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '7587681603');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }
function kb(rows){ return { inline_keyboard: rows }; }
function esc(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

async function reply(chatId, text, keyboard){
  const body = { chat_id: chatId, text, parse_mode:'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`${API}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
}

function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget',         callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP',            callback_data:'act:zip' },    { text:'♻️ Reset',   callback_data:'act:reset'  }]
  ]);
}

async function ensureGlobalDefaults(){
  const keys = keysForUser();
  const b = await getJSON(keys.budgetGlobal);
  if (!b){
    await setJSON(keys.budgetGlobal, { capCents: 0, alertStepCents: 0, pPer1k: pricePer1k() });
  }
}

async function handleStart(chatId){
  await ensureGlobalDefaults();
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

/* ===== NOUVEAU PROJET (FSM par utilisateur) ===== */

async function askNewProjectTitle(chatId, uid){
  const keys = keysForUser();
  await setJSON(keys.tmp(uid), { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', kb([[{ text:'⬅️ Retour menu', callback_data:'act:menu' }]]));
}

async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;
  const keys = keysForUser();
  const tmp = await getJSON(keys.tmp(fromId));

  // 1) Titre -> Budget preset
  if (tmp?.step === 'title'){
    const title = text.trim();
    const next = { step:'budget', title, capCents: 0, alertCents: 0 };
    await setJSON(keys.tmp(fromId), next, 1200);
    const kbBudget = kb([
      [{ text:'Cap +1€', callback_data:'np:cap:+100' }, { text:'Cap -1€', callback_data:'np:cap:-100' }],
      [{ text:'Alerte +1€', callback_data:'np:alert:+100' }, { text:'Alerte -1€', callback_data:'np:alert:-100' }],
      [{ text:'Valider budget', callback_data:'np:budget:ok' }],
      [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
    ]);
    await reply(chatId, `Budget pour <b>${esc(title)}</b>\nAjuste puis “Valider budget”.`, kbBudget);
    return;
  }

  // 2) Prompt -> Confirm
  if (tmp?.step === 'prompt'){
    const next = { ...tmp, step:'confirm', prompt: text };
    await setJSON(keys.tmp(fromId), next, 1800);
    const kbConfirm = kb([
      [{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier le prompt', callback_data:'np:confirm:no' }],
      [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
    ]);
    await reply(chatId, `Résumé compris (aperçu) :\n\n${esc(String(text).slice(0,700))}\n\nValider ?`, kbConfirm);
    return;
  }
}

async function listProjects(chatId){
  const keys = keysForUser();
  const list = (await getJSON(keys.projectsList)) || [];
  if (!list.length){
    await reply(chatId, 'Aucun projet. Lance un nouveau projet.',
      kb([[{ text:'🆕 Nouveau projet', callback_data:'act:new' }],[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
    return;
  }
  const rows = list.map(p => [{ text:`📁 ${p.title} (${p.id})`, callback_data:`prj:open:${p.id}` }]);
  rows.push([{ text:'⬅️ Retour', callback_data:'act:menu' }]);
  await reply(chatId, 'Projets :', kb(rows));
}

async function openProject(chatId, pid){
  const keys = keysForUser();
  const p = await getJSON(keys.project(pid));
  if (!p){
    await reply(chatId, 'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]]));
    return;
  }
  const rows = [
    [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }],
    [{ text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
    [{ text:'⬅️ Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${esc(p.title)}</b>\nVersion: ${p.version || 'v1'}\nStatus: ${p.status || 'draft'}`, kb(rows));
}

/* ===== BUDGET GLOBAL ===== */

function fmtEuro(cents){ return (cents/100).toFixed(2).replace('.',',') + ' €'; }

async function showBudget(chatId){
  const keys = keysForUser();
  const usage = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = `Budget global
- Dépensé: ${(usage.euros||0).toFixed(4)} €  (${usage.tokens||0} tokens)
- Cap: ${fmtEuro(b.capCents||0)}
- Alerte: ${fmtEuro(b.alertStepCents||0)}
- Prix/1k: ${pricePer1k()} €`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense', callback_data:'bdg:raz' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ];
  await reply(chatId, txt, kb(rows));
}

async function adjustBudget(chatId, kind, delta){
  const keys = keysForUser();
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  if (kind === 'cap') b.capCents = Math.max(0, (b.capCents||0) + delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0, (b.alertStepCents||0) + delta);
  await setJSON(keys.budgetGlobal, b);
  await showBudget(chatId);
}

async function resetSpent(chatId){
  await setJSON('creatorbottg:usage:global', { tokens:0, euros:0, history:[] });
  await showBudget(chatId);
}

/* ===== CALLBACKS ===== */

async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;

  if (data === 'act:menu')   return handleStart(chatId);
  if (data === 'act:new')    return askNewProjectTitle(chatId, fromId);
  if (data === 'act:list')   return listProjects(chatId);
  if (data === 'act:budget') return showBudget(chatId);
  if (data === 'act:reset')  { await ensureGlobalDefaults(); return handleStart(chatId); }

  // Budget adjustments
  if (data.startsWith('bdg:')){
    const [, kind, deltaStr] = data.split(':'); // e.g. bdg:cap:+100
    if (kind === 'raz') return resetSpent(chatId);
    const delta = Number(deltaStr);
    return adjustBudget(chatId, kind, delta);
  }

  // Nouveau projet - budget step
  if (data.startsWith('np:')){
    const tmpKey = keysForUser().tmp(fromId);
    const tmp = (await getJSON(tmpKey)) || {};
    const parts = data.split(':'); // np:cap:+100 / np:alert:-100 / np:budget:ok / np:confirm:yes
    if (parts[1] === 'cap'){
      tmp.capCents = Math.max(0, (tmp.capCents || 0) + Number(parts[2]));
      await setJSON(tmpKey, tmp, 1200);
      return askBudgetRefresh(chatId, tmp);
    }
    if (parts[1] === 'alert'){
      tmp.alertCents = Math.max(0, (tmp.alertCents || 0) + Number(parts[2]));
      await setJSON(tmpKey, tmp, 1200);
      return askBudgetRefresh(chatId, tmp);
    }
    if (parts[1] === 'budget' && parts[2] === 'ok'){
      tmp.step = 'prompt';
      await setJSON(tmpKey, tmp, 1800);
      return reply(chatId, 'Envoie maintenant le prompt principal (description complète du projet).',
        kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
    }
    if (parts[1] === 'confirm'){
      if (parts[2] === 'yes'){
        // crée le projet
        const keys = keysForUser();
        const id = String(Date.now());
        const proj = {
          id, title: tmp.title, prompt: tmp.prompt,
          capCents: tmp.capCents || 0, alertCents: tmp.alertCents || 0,
          version: 'v1', status: 'draft', createdAt: Date.now()
        };
        const list = (await getJSON(keys.projectsList)) || [];
        list.unshift({ id, title: proj.title, createdAt: proj.createdAt });
        await setJSON(keys.projectsList, list);
        await setJSON(keys.project(id), proj);
        await del(tmpKey);
        await reply(chatId, `✅ Projet <b>${esc(proj.title)}</b> créé.\nTu peux le retrouver dans “📁 Projets”.`, kb([[{ text:'📁 Ouvrir mes projets', callback_data:'act:list' }],[{ text:'⬅️ Menu', callback_data:'act:menu' }]]));
        return;
      } else {
        // retour à prompt
        tmp.step = 'prompt';
        await setJSON(keysForUser().tmp(fromId), tmp, 1200);
        return reply(chatId, 'Ré-envoie le prompt principal.', kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
      }
    }
    return;
  }

  // Projets
  if (data.startsWith('prj:')){
    const [, act, pid] = data.split(':');
    if (act === 'open')   return openProject(chatId, pid);
    if (act === 'del')    { await del(keysForUser().project(pid)); return listProjects(chatId); }
    if (act === 'resume') return reply(chatId, 'Mode assistant de reprise à venir.', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
    if (act === 'secrets')return reply(chatId, 'Secrets par projet (édition à venir).', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
  }
}

async function askBudgetRefresh(chatId, tmp){
  const kbBudget = kb([
    [{ text:`Cap ${fmtEuro(tmp.capCents||0)}`, callback_data:'np:noop' }],
    [{ text:'Cap +1€', callback_data:'np:cap:+100' }, { text:'Cap -1€', callback_data:'np:cap:-100' }],
    [{ text:`Alerte ${fmtEuro(tmp.alertCents||0)}`, callback_data:'np:noop' }],
    [{ text:'Alerte +1€', callback_data:'np:alert:+100' }, { text:'Alerte -1€', callback_data:'np:alert:-100' }],
    [{ text:'Valider budget', callback_data:'np:budget:ok' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);
  await reply(chatId, `Budget pour <b>${esc(tmp.title||'')}</b>`, kbBudget);
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
