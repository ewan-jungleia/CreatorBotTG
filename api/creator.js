import { getJSON, setJSON, del, keysForUser, estimateTokens, addUsage, pricePer1k, now } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }
function kb(rows){ return { inline_keyboard: rows }; }
function esc(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function reply(chatId, text, markup){
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (markup) body.reply_markup = markup;
  await fetch(`${API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP', callback_data:'act:zip' }, { text:'♻️ Reset', callback_data:'act:reset' }]
  ]);
}

/* ===== Budget global ===== */
function fmtCents(c){ return `${(c/100).toFixed(2).replace('.',',')} €`; }

async function ensureBudgetDefaults(userId){
  const keys = keysForUser(userId);
  const b = await getJSON(keys.budgetGlobal);
  if (!b) await setJSON(keys.budgetGlobal, { capCents: 0, alertStepCents: 0, pPer1k: pricePer1k() });
}

async function showBudget(chatId, userId){
  const keys = keysForUser(userId);
  const u = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = `Budget global
- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)
- Cap: ${fmtCents(b.capCents||0)}
- Alerte: ${fmtCents(b.alertStepCents||0)}
- Prix/1k: ${pricePer1k()} €`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense', callback_data:'bdg:raz' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ];
  await reply(chatId, txt, kb(rows));
}

async function budgetAdjust(userId, kind, delta){
  const keys = keysForUser(userId);
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  if (kind === 'cap') b.capCents = Math.max(0, (b.capCents||0) + delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0, (b.alertStepCents||0) + delta);
  await setJSON(keys.budgetGlobal, b);
}

async function budgetResetSpend(){
  await setJSON('creatorbottg:usage:global', { tokens:0, euros:0, history:[] });
}

/* ===== Assistant Nouveau Projet ===== */
function askTitleKB(){ return kb([[{ text:'⬅️ Retour menu', callback_data:'act:menu' }]]); }

async function askNewProjectTitle(chatId, userId){
  const keys = keysForUser(userId);
  await setJSON(keys.tmp, { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', askTitleKB());
}

function npBudgetKB(){
  return kb([
    [{ text:'Cap 10€', callback_data:'np:cap:1000' }, { text:'Cap 20€', callback_data:'np:cap:2000' }],
    [{ text:'Alerte 1€', callback_data:'np:al:100' }, { text:'Alerte 2€', callback_data:'np:al:200' }],
    [{ text:'Valider budget', callback_data:'np:budget:ok' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);
}

async function afterTitleShowBudget(chatId, userId){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);
  const cap = tmp?.capCents || 0;
  const al  = tmp?.alertStepCents || 0;
  const txt = `Budget pour <b>${esc(tmp?.title||'')}</b>
- Cap provisoire: ${fmtCents(cap)}
- Alerte provisoire: ${fmtCents(al)}`;
  await reply(chatId, txt, npBudgetKB());
}

async function askPrompt(chatId, userId){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);
  tmp.step = 'prompt';
  await setJSON(keys.tmp, tmp, 1800);
  await reply(chatId, `Envoie le <b>prompt principal</b> pour <i>${esc(tmp.title)}</i>.`, kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
}

function summarizePrompt(p){
  const lines = String(p).split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,10).join('\n').slice(0,700);
}

async function confirmPrompt(chatId, userId){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);
  const summary = summarizePrompt(tmp.prompt || '');
  tmp.step = 'confirm';
  await setJSON(keys.tmp, tmp, 1800);
  await reply(
    chatId,
    `Résumé compris :\n\n${esc(summary)}\n\nValider ?`,
    kb([
      [{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier', callback_data:'np:confirm:no' }],
      [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
    ])
  );
}

async function createProjectFromTmp(chatId, userId){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);
  const list = (await getJSON(keys.projectsList)) || [];

  const pid = String(Date.now());
  const project = {
    id: pid,
    title: tmp.title,
    version: 'v1',
    status: 'draft',
    budget: { capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0 },
    prompt: tmp.prompt || ''
  };

  await setJSON(keys.project(pid), project);
  list.unshift({ id: pid, title: project.title, createdAt: now(), version: project.version });
  await setJSON(keys.projectsList, list);
  await del(keys.tmp);

  await reply(chatId, `✅ Projet <b>${esc(project.title)}</b> créé.\nRetrouve-le dans 📁 Projets.`, kb([[{ text:'📁 Projets', callback_data:'act:list' }],[{ text:'⬅️ Menu', callback_data:'act:menu' }]]));
}

/* ===== Projets ===== */
async function listProjects(chatId, userId){
  const keys = keysForUser(userId);
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

async function openProject(chatId, userId, pid){
  const keys = keysForUser(userId);
  const p = await getJSON(keys.project(pid));
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]])); return; }
  const rows = [
    [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'📦 ZIP', callback_data:`prj:zip:${pid}` }],
    [{ text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }, { text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
    [{ text:'⬅️ Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${esc(p.title)}</b>\nVersion: ${p.version || 'v1'}\nStatus: ${p.status || 'draft'}`, kb(rows));
}

/* ===== ZIP minimal (placeholder) ===== */
async function makeZipForProject(project){
  const zip = new AdmZip();
  const readme = `# ${project.title}\n\nVersion: ${project.version}\n\n## Déploiement rapide (Vercel)\n1) Crée un projet Vercel\n2) Ajoute les variables d'environnement\n3) Déploie\n`;
  zip.addFile('README.md', Buffer.from(readme, 'utf-8'));
  const botjs = `export default async function handler(req,res){res.status(200).json({ok:true,message:"${project.title} bot ready"})}`;
  zip.addFile('api/bot.js', Buffer.from(botjs, 'utf-8'));
  return zip.toBuffer();
}

async function sendZip(chatId, buffer, filename){
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([buffer]), filename);
  await fetch(`${API}/sendDocument`, { method:'POST', body: form });
}

/* ===== Entrées utilisateur ===== */
async function handleStart(chatId, userId){
  await ensureBudgetDefaults(userId);
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

async function handleText(chatId, userId, text){
  const keys = keysForUser(userId);
  const tmp = await getJSON(keys.tmp);

  if (tmp && tmp.step === 'title'){
    tmp.title = text.trim();
    tmp.step  = 'budget';
    await setJSON(keys.tmp, tmp, 1800);
    await afterTitleShowBudget(chatId, userId);
    return;
  }

  if (tmp && tmp.step === 'prompt'){
    tmp.prompt = text;
    await setJSON(keys.tmp, tmp, 1800);
    await confirmPrompt(chatId, userId);
    return;
  }

  await reply(chatId, 'Utilise le menu ci-dessous.', mainMenu());
}

async function handleCallback(chatId, userId, data){
  if (data === 'act:menu')   return handleStart(chatId, userId);
  if (data === 'act:new')    return askNewProjectTitle(chatId, userId);
  if (data === 'act:list')   return listProjects(chatId, userId);
  if (data === 'act:budget') return showBudget(chatId, userId);
  if (data === 'act:reset')  { await ensureBudgetDefaults(userId); return handleStart(chatId, userId); }

  if (data.startsWith('bdg:')){
    const [, kind, deltaStr] = data.split(':');
    if (kind === 'raz'){ await budgetResetSpend(); return showBudget(chatId, userId); }
    const delta = Number(deltaStr);
    if (kind === 'cap' || kind === 'al'){
      await budgetAdjust(userId, kind, delta);
      return showBudget(chatId, userId);
    }
  }

  if (data.startsWith('np:')){
    const keys = keysForUser(userId);
    const tmp = (await getJSON(keys.tmp)) || {};
    const [, kind, valStr] = data.split(':');

    if (kind === 'cap'){ tmp.capCents = Number(valStr); await setJSON(keys.tmp, tmp, 1800); return afterTitleShowBudget(chatId, userId); }
    if (kind === 'al'){  tmp.alertStepCents = Number(valStr); await setJSON(keys.tmp, tmp, 1800); return afterTitleShowBudget(chatId, userId); }
    if (kind === 'budget' && valStr === 'ok'){ return askPrompt(chatId, userId); }
    if (kind === 'confirm'){
      if (valStr === 'yes') return createProjectFromTmp(chatId, userId);
      if (valStr === 'no'){ tmp.step='prompt'; await setJSON(keys.tmp, tmp, 1800); return reply(chatId,'OK, renvoie le prompt modifié.', kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]])); }
    }
  }

  if (data.startsWith('prj:')){
    const [, act, pid] = data.split(':');
    if (act === 'open')   return openProject(chatId, userId, pid);
    if (act === 'resume') return reply(chatId, 'Mode assistant de reprise à venir.', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
    if (act === 'secrets')return reply(chatId, 'Secrets par projet (édition à venir).', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
  }
}

/* ===== HTTP entry ===== */
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
      if (msg.text === '/start') await handleStart(msg.chat.id, fromId);
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
