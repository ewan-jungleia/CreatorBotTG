import { getJSON, setJSON, del, keysForUser, addUsage, pricePer1k, now, k } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

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

async function adjustBudget(chatId, kind, delta){
  const keys = keysForUser();
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  if (kind === 'cap') b.capCents = Math.max(0, Number(b.capCents||0) + delta);
  if (kind === 'al')  b.alertStepCents = Math.max(0, Number(b.alertStepCents||0) + delta);
  await setJSON(keys.budgetGlobal, b);
  await handleBudgetMenu(chatId);
}

async function resetSpent(chatId){
  await setJSON(k('usage','global'), { tokens:0, euros:0, history:[] });
  await handleBudgetMenu(chatId);
}

/* ===== NOUVEAU PROJET (FSM par chatId) ===== */
function fsmKey(chatId){ return keysForUser().tmp(`chat:${chatId}`); }

async function askNewProjectTitle(chatId){
  await setJSON(fsmKey(chatId), { step:'title' }, 900);
  await reply(chatId, 'Titre du projet ?', kb([[{ text:'Retour', callback_data:'act:menu' }]]));
}

async function askBudget(chatId, tmp){
  tmp.step = 'budget';
  tmp.capCents = tmp.capCents ?? 1000;
  tmp.alertStepCents = tmp.alertStepCents ?? 100;
  await setJSON(fsmKey(chatId), tmp, 900);

  const rows = [
    [{ text:'Cap +1€', callback_data:'np:cap:+100' }, { text:'Cap -1€', callback_data:'np:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'np:al:+100' }, { text:'Alerte -1€', callback_data:'np:al:-100' }],
    [{ text:'OK', callback_data:'np:budget:ok' }, { text:'Retour', callback_data:'act:menu' }]
  ];
  const txt = `Budget pour <b>${escapeHtml(tmp.title||'')}</b>\nCap: ${fmtEurosCents(tmp.capCents)}\nAlerte: ${fmtEurosCents(tmp.alertStepCents)}`;
  await reply(chatId, txt, kb(rows));
}

async function askPrompt(chatId, tmp){
  tmp.step = 'prompt';
  await setJSON(fsmKey(chatId), tmp, 900);
  await reply(chatId, 'Envoie le <b>prompt principal</b> (besoins, contraintes, livrables)…', kb([[{ text:'Retour', callback_data:'act:menu' }]]));
}

function summarizePrompt(p){
  const lines = String(p||'').split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,12).join('\n').slice(0,900);
}

async function confirmProject(chatId, tmp){
  tmp.step = 'confirm';
  await setJSON(fsmKey(chatId), tmp, 900);
  const summary = summarizePrompt(tmp.prompt||'');
  const rows = [
    [{ text:'Valider ✅', callback_data:'np:confirm:yes' }, { text:'Relire ✏️', callback_data:'np:confirm:no' }],
    [{ text:'Retour', callback_data:'act:menu' }]
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
  await del(fsmKey(chatId));

  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b> créé ✅`, kb([
    [{ text:'Ouvrir 📁', callback_data:`prj:open:${id}` }],
    [{ text:'Menu', callback_data:'act:menu' }]
  ]));
}

/* ===== PROJETS ===== */
async function listProjects(chatId){
  const keys = keysForUser();
  const list = (await getJSON(keys.projectsList)) || [];
  if (!list.length){
    await reply(chatId, 'Aucun projet. Lance un nouveau projet.',
      kb([[{ text:'Nouveau projet', callback_data:'act:new' }],[{ text:'Menu', callback_data:'act:menu' }]]));
    return;
  }
  const rows = list.map(p => [{ text:`📁 ${p.title}`, callback_data:`prj:open:${p.id}` }]);
  rows.push([{ text:'Menu', callback_data:'act:menu' }]);
  await reply(chatId, 'Projets :', kb(rows));
}

async function openProject(chatId, pid){
  const p = await getJSON(keysForUser().project(pid));
  if (!p){
    await reply(chatId, 'Projet introuvable.', kb([[{ text:'Retour', callback_data:'act:list' }]]));
    return;
  }
  const rows = [
    [{ text:'Reprendre ▶️', callback_data:`prj:resume:${pid}` }, { text:'ZIP 📦', callback_data:`prj:zip:${pid}` }],
    [{ text:'Secrets 🔑', callback_data:`prj:secrets:${pid}` }, { text:'Supprimer 🗑️', callback_data:`prj:del:${pid}` }],
    [{ text:'Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b>\nVersion: ${p.version}\nStatus: ${p.status}`, kb(rows));
}

async function deleteProject(chatId, pid){
  const keys = keysForUser();
  const list = (await getJSON(keys.projectsList)) || [];
  const idx = list.findIndex(x => x.id === pid);
  if (idx >= 0) list.splice(idx,1);
  await setJSON(keys.projectsList, list);
  await del(keys.project(pid));
  await reply(chatId, 'Projet supprimé ✅', kb([[{ text:'Retour', callback_data:'act:list' }]]));
}

/* ===== ZIP ===== */
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

async function buildZip(chatId, pid){
  const p = await getJSON(keysForUser().project(pid));
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'Retour', callback_data:'act:list' }]])); return; }
  const buf = await makeZipForProject(p);
  await sendZip(chatId, buf, `${p.title.replace(/\s+/g,'_')}_${p.version}.zip`);
  const tokens = 300;
  const { euros } = await addUsage({ projectId: pid, tokens });
  await reply(chatId, `ZIP généré ✅\nCoût estimé: ${euros.toFixed(4)} €`, kb([[{ text:'Retour', callback_data:`prj:open:${pid}` }]]));
}

/* ===== ROUTERS ===== */
async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;
  const tmp = await getJSON(fsmKey(chatId));

  if (tmp && tmp.step === 'title'){
    tmp.title = String(text||'').trim();
    return askBudget(chatId, tmp);
  }

  if (tmp && tmp.step === 'prompt'){
    tmp.prompt = text;
    await setJSON(fsmKey(chatId), tmp, 900);
    return confirmProject(chatId, tmp);
  }
}

async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;

  if (data === 'act:menu') return handleStart(chatId);
  if (data === 'act:new')  return askNewProjectTitle(chatId);
  if (data === 'act:list') return listProjects(chatId);
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset') { await ensureGlobalDefaults(); return handleStart(chatId); }
  if (data === 'act:zip-hint') return reply(chatId, 'Ouvre un projet (Projets) puis clique ZIP.', kb([[{ text:'Projets', callback_data:'act:list' }]]));

  const m1 = data.match(/^bdg:(cap|al):([+-]\d+)$/);
  if (m1) return adjustBudget(chatId, m1[1], Number(m1[2]));
  if (data === 'bdg:raz') return resetSpent(chatId);

  const tmp = (await getJSON(fsmKey(chatId))) || {};
  if (data === 'np:budget:ok'){
    if (!tmp.title) return askNewProjectTitle(chatId);
    return askPrompt(chatId, tmp);
  }
  const mb = data.match(/^np:(cap|al):([+-]\d+)$/);
  if (mb){
    const kind = mb[1], delta = Number(mb[2]);
    tmp.capCents = tmp.capCents ?? 1000;
    tmp.alertStepCents = tmp.alertStepCents ?? 100;
    if (kind === 'cap') tmp.capCents = Math.max(0, tmp.capCents + delta);
    if (kind === 'al')  tmp.alertStepCents = Math.max(0, tmp.alertStepCents + delta);
    await setJSON(fsmKey(chatId), tmp, 900);
    return askBudget(chatId, tmp);
  }
  if (data === 'np:confirm:yes'){
    if (!tmp.title || !tmp.prompt) return askNewProjectTitle(chatId);
    return persistProject(chatId, tmp);
  }
  if (data === 'np:confirm:no'){
    tmp.step = 'prompt';
    await setJSON(fsmKey(chatId), tmp, 900);
    return reply(chatId, 'Modifie/renvoie le prompt principal :', kb([[{ text:'Retour', callback_data:'act:menu' }]]));
  }

  const mo = data.match(/^prj:(open|zip|del|resume|secrets):([a-z0-9]+)$/);
  if (mo){
    const act = mo[1], pid = mo[2];
    if (act === 'open')   return openProject(chatId, pid);
    if (act === 'zip')    return buildZip(chatId, pid);
    if (act === 'del')    return deleteProject(chatId, pid);
    if (act === 'resume') return reply(chatId, 'Mode assistant de reprise à venir.', kb([[{ text:'Retour', callback_data:`prj:open:${pid}` }]]));
    if (act === 'secrets')return reply(chatId, 'Secrets par projet (édition à venir).', kb([[{ text:'Retour', callback_data:`prj:open:${pid}` }]]));
  }
}

export default async function handler(req,res){
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ ok:false });

  try{
    const update = req.body || {};
    const msg = update.message;
    const cb  = update.callback_query;

    if (msg && msg.text){
      const fromId = msg.from?.id || msg.chat?.id;
      if (!isAdmin(fromId)){ await reply(msg.chat.id,'Accès refusé – bot privé.'); return res.json({ok:true}); }
      if (msg.text === '/start') await handleStart(msg.chat.id);
      else await handleText(msg.chat.id, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await reply(chatId,'Accès refusé – bot privé.'); return res.json({ok:true}); }
      await handleCallback(chatId, fromId, cb.data || '');
      await fetch(`${API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ callback_query_id: cb.id }) });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:true, error: String(e) });
  }
}
