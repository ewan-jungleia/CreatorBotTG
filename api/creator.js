import { getJSON, setJSON, del, keysForUser, estimateTokens, addUsage, pricePer1k, now } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }
function kb(rows){ return { inline_keyboard: rows }; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function fmtEurosCents(c){ return `${((c||0)/100).toFixed(2).replace('.',',')} €`; }

async function reply(chatId, text, keyboard){
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`${API}/sendMessage`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

function mainMenu(){
  return kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP', callback_data:'act:zip' }, { text:'♻️ Reset', callback_data:'act:reset' }]
  ]);
}

async function ensureGlobalDefaults(){
  const keys = keysForUser();
  const b = await getJSON(keys.budgetGlobal);
  if (!b){
    await setJSON(keys.budgetGlobal, { capCents:1000, alertStepCents:100, pPer1k: pricePer1k() });
  }
}

/* ========== /start ========== */
async function handleStart(chatId){
  await ensureGlobalDefaults();
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

/* ========== Assistant Nouveau projet ========== */
async function askNewProjectTitle(chatId){
  const keys = keysForUser();
  await setJSON(keys.project('tmp'), { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', kb([[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
}

async function afterTitleAskBudget(chatId, tmp){
  const keys = keysForUser();
  tmp.step = 'budget';
  tmp.capCents = tmp.capCents ?? 1000;
  tmp.alertCents = tmp.alertCents ?? 100;
  await setJSON(keys.project('tmp'), tmp, 900);
  const rows = [
    [{ text:'Cap +1€', callback_data:'np:cap:+100' }, { text:'Cap -1€', callback_data:'np:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'np:alert:+100' }, { text:'Alerte -1€', callback_data:'np:alert:-100' }],
    [{ text:'Continuer', callback_data:'np:budget:ok' }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
  ];
  await reply(chatId, `Budget pour <b>${escapeHtml(tmp.title)}</b>\nCap: ${fmtEurosCents(tmp.capCents)}\nAlerte: ${fmtEurosCents(tmp.alertCents)}`, kb(rows));
}

async function askMainPrompt(chatId, tmp){
  const keys = keysForUser();
  tmp.step = 'prompt';
  await setJSON(keys.project('tmp'), tmp, 900);
  await reply(chatId, 'Envoie le prompt principal du projet (détails, objectifs, contraintes).', kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
}

function summarizePrompt(p){
  const lines = String(p||'').split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,12).join('\n').slice(0,900);
}

async function confirmSummary(chatId, tmp){
  const summary = summarizePrompt(tmp.prompt);
  const rows = [
    [{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier', callback_data:'np:confirm:no' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ];
  await reply(chatId, `Résumé compris :\n\n${escapeHtml(summary)}\n\nValider ?`, kb(rows));
}

async function finalizeProject(chatId, tmp){
  const keys = keysForUser();
  const pid = String(Date.now());
  const proj = {
    id: pid, title: tmp.title, version:'v1', status:'draft',
    capCents: tmp.capCents||0, alertCents: tmp.alertCents||0,
    prompt: tmp.prompt||'', createdAt: now()
  };
  await setJSON(keys.project(pid), proj);
  const list = (await getJSON(keys.projectsList)) || [];
  list.push({ id: pid, title: tmp.title, createdAt: proj.createdAt });
  await setJSON(keys.projectsList, list);
  await del(keys.project('tmp'));
  await openProject(chatId, pid);
}

/* ========== Projets ========== */
async function listProjects(chatId){
  const keys = keysForUser();
  const list = (await getJSON(keys.projectsList)) || [];
  if (!list.length){
    await reply(chatId, 'Aucun projet. Lance un nouveau projet.', kb([[{ text:'🆕 Nouveau projet', callback_data:'act:new' }],[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
    return;
  }
  const rows = list.map(p => [{ text:`📁 ${p.title}`, callback_data:`prj:open:${p.id}` }]);
  rows.push([{ text:'⬅️ Retour', callback_data:'act:menu' }]);
  await reply(chatId, 'Projets :', kb(rows));
}

async function openProject(chatId, pid){
  const keys = keysForUser();
  const p = await getJSON(keys.project(pid));
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]])); return; }
  const rows = [
    [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'📦 ZIP', callback_data:`prj:zip:${pid}` }],
    [{ text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }, { text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
    [{ text:'⬅️ Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b>\nVersion: ${p.version}\nCap: ${fmtEurosCents(p.capCents)}  •  Alerte: ${fmtEurosCents(p.alertCents)}`, kb(rows));
}

async function deleteProject(chatId, pid){
  const keys = keysForUser();
  await del(keys.project(pid));
  const list = (await getJSON(keys.projectsList)) || [];
  await setJSON(keys.projectsList, list.filter(p => p.id !== pid));
  await listProjects(chatId);
}

/* ========== ZIP ========== */
async function makeZipForProject(project){
  const zip = new AdmZip();
  const readme = `# ${project.title}\n\nVersion: ${project.version}\n\n## Déploiement (Vercel)\n1) Crée un projet Vercel\n2) Ajoute les variables d'environnement\n3) Déploie\n`;
  zip.addFile('README.md', Buffer.from(readme,'utf-8'));
  const botjs = `export default async function handler(req,res){res.status(200).json({ok:true,message:"${project.title} ready"})}`;
  zip.addFile('api/bot.js', Buffer.from(botjs,'utf-8'));
  return zip.toBuffer();
}

async function sendZip(chatId, buffer, filename){
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([buffer]), filename);
  await fetch(`${API}/sendDocument`, { method:'POST', body: form });
}

async function buildZip(chatId, pid){
  const p = await getJSON(`creatorbottg:project:${pid}`);
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]])); return; }
  const buf = await makeZipForProject(p);
  await sendZip(chatId, buf, `${p.title.replace(/\s+/g,'_')}_${p.version||'v1'}.zip`);
  const tokens = 300;
  const { euros } = await addUsage({ projectId: pid, tokens });
  await reply(chatId, `ZIP généré ✅\nCoût estimé: ${euros.toFixed(4)} €`, kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
}

/* ========== Budget global ========== */
async function handleBudgetMenu(chatId){
  const keys = keysForUser();
  const u = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = `Budget global\n- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)\n- Plafond: ${fmtEurosCents(b.capCents)}\n- Alerte: ${fmtEurosCents(b.alertStepCents)}\n- Prix/1k tokens: ${pricePer1k()} €`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépensé', callback_data:'bdg:raz' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ];
  await reply(chatId, txt, kb(rows));
}

async function adjustBudget(chatId, kind, delta){
  const keys = keysForUser();
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  if (kind === 'cap') b.capCents = Math.max(0,(b.capCents||0)+delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0,(b.alertStepCents||0)+delta);
  await setJSON(keys.budgetGlobal, b);
  await handleBudgetMenu(chatId);
}

async function resetSpent(chatId){
  await setJSON('creatorbottg:usage:global', { tokens:0, euros:0, history:[] });
  await handleBudgetMenu(chatId);
}

/* ========== Router Texte ========== */
async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;
  const keys = keysForUser();
  const tmp = await getJSON(keys.project('tmp'));

  if (tmp && tmp.step === 'title'){
    tmp.title = text.trim();
    await afterTitleAskBudget(chatId, tmp);
    return;
  }
  if (tmp && tmp.step === 'prompt'){
    tmp.prompt = text;
    await setJSON(keys.project('tmp'), tmp, 900);
    await confirmSummary(chatId, tmp);
    return;
  }
}

/* ========== Router Callbacks ========== */
async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;

  // menu
  if (data === 'act:menu')   return handleStart(chatId);
  if (data === 'act:new')    return askNewProjectTitle(chatId);
  if (data === 'act:list')   return listProjects(chatId);
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset')  { await ensureGlobalDefaults(); return handleStart(chatId); }

  // ZIP (sélection projet)
  if (data === 'act:zip'){
    const keys = keysForUser();
    const list = (await getJSON(keys.projectsList)) || [];
    if (!list.length) return reply(chatId,'Aucun projet.', kb([[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
    const rows = list.map(p => [{ text:`📦 ${p.title}`, callback_data:`prj:zip:${p.id}` }]);
    rows.push([{ text:'⬅️ Retour', callback_data:'act:menu' }]);
    return reply(chatId,'Choisis un projet pour générer un ZIP :', kb(rows));
  }

  // assistant nouveau projet
  if (data.startsWith('np:')){
    const keys = keysForUser();
    const tmp = (await getJSON(keys.project('tmp'))) || {};
    if (data.startsWith('np:cap:')){
      const d = Number(data.split(':')[2]||0);
      tmp.capCents = Math.max(0,(tmp.capCents||0)+d);
      await afterTitleAskBudget(chatId, tmp);
      return;
    }
    if (data.startsWith('np:alert:')){
      const d = Number(data.split(':')[2]||0);
      tmp.alertCents = Math.max(0,(tmp.alertCents||0)+d);
      await afterTitleAskBudget(chatId, tmp);
      return;
    }
    if (data === 'np:budget:ok'){
      await askMainPrompt(chatId, tmp);
      return;
    }
    if (data === 'np:confirm:yes'){
      await finalizeProject(chatId, tmp);
      return;
    }
    if (data === 'np:confirm:no'){
      tmp.step = 'prompt';
      await setJSON(keys.project('tmp'), tmp, 900);
      await reply(chatId, 'Renvoie le prompt principal corrigé.', kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
      return;
    }
  }

  // projets
  if (data.startsWith('prj:')){
    const [_, act, pid] = data.split(':');
    if (act === 'open')   return openProject(chatId, pid);
    if (act === 'zip')    return buildZip(chatId, pid);
    if (act === 'del')    return deleteProject(chatId, pid);
    if (act === 'resume') return openProject(chatId, pid);
  }

  // budget
  if (data.startsWith('bdg:')){
    const [_, kind, delta] = data.split(':');
    if (kind === 'raz') return resetSpent(chatId);
    if (kind === 'cap') return adjustBudget(chatId,'cap', Number(delta||0));
    if (kind === 'al')  return adjustBudget(chatId,'al',  Number(delta||0));
  }
}

/* ========== Handler ========== */
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
