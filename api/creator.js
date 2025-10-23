import { getJSON, setJSON, del, keysForUser, addUsage, pricePer1k } from './_kv.js';
import AdmZip from 'adm-zip';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_TELEGRAM_ID || '0');
const API = `https://api.telegram.org/bot${TOKEN}`;

function isAdmin(id){ return Number(id) === ADMIN_ID; }
function kb(rows){ return { inline_keyboard: rows }; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

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

async function ensureGlobalDefaults(){
  const keys = keysForUser();
  const b = await getJSON(keys.budgetGlobal);
  if (!b){
    await setJSON(keys.budgetGlobal, { capCents:1000, alertStepCents:100, pPer1k: pricePer1k() });
  }
}

async function handleStart(chatId){
  await ensureGlobalDefaults();
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', mainMenu());
}

/* Assistant Nouveau projet */

function backToMenuKB(){ return kb([[{ text:'⬅️ Retour menu', callback_data:'act:menu' }]]); }

async function safeSetTmp(uid, obj, ttl=900){
  const keys = keysForUser();
  try{
    await setJSON(keys.tmp(uid), obj, ttl);
    return true;
  }catch(e){
    return false;
  }
}
async function safeGetTmp(uid){
  const keys = keysForUser();
  try{
    return await getJSON(keys.tmp(uid));
  }catch(e){
    return null;
  }
}

async function askTitle(chatId, uid){
  const ok = await safeSetTmp(uid, { step:'title' }, 900);
  if (!ok) return reply(chatId, '⚠️ Erreur KV (init). Réessaie.', backToMenuKB());
  await reply(chatId, 'Titre du projet ?', backToMenuKB());
}

async function askBudget(chatId, uid, title){
  const ok = await safeSetTmp(uid, { step:'budget', title }, 900);
  if (!ok) return reply(chatId, '⚠️ Erreur KV (budget). Réessaie.', backToMenuKB());
  const m = kb([
    [{ text:'Cap 10€', callback_data:'np:cap:1000' }, { text:'Cap 20€', callback_data:'np:cap:2000' }],
    [{ text:'Alerte 1€', callback_data:'np:alert:100' }, { text:'Alerte 2€', callback_data:'np:alert:200' }],
    [{ text:'OK', callback_data:'np:budget:ok' }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);
  await reply(chatId, `Reçu ✅  <b>${escapeHtml(title)}</b>\n\nDéfinis le budget :`, m);
}

async function askPrompt(chatId, uid){
  const tmp = await safeGetTmp(uid);
  if (!tmp || !tmp.title) return reply(chatId,'⚠️ Session expirée. Relance “Nouveau projet”.', backToMenuKB());
  await safeSetTmp(uid, { ...tmp, step:'prompt' }, 900);
  await reply(chatId, 'Envoie le <b>prompt principal</b> du projet.', backToMenuKB());
}

async function askConfirm(chatId, uid, promptText){
  const tmp = await safeGetTmp(uid);
  if (!tmp || !tmp.title) return reply(chatId,'⚠️ Session expirée. Relance “Nouveau projet”.', backToMenuKB());
  const summary = String(promptText).split('\n').map(l=>l.trim()).filter(Boolean).slice(0,10).join('\n').slice(0,700);
  await safeSetTmp(uid, { ...tmp, step:'confirm', prompt: promptText }, 900);
  const m = kb([
    [{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier', callback_data:'np:confirm:no' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);
  await reply(chatId, `Résumé compris :\n\n${escapeHtml(summary)}\n\nValider ?`, m);
}

async function createProjectFromTmp(chatId, uid){
  const keys = keysForUser();
  const tmp = await safeGetTmp(uid);
  if (!tmp || !tmp.title || !tmp.prompt) return reply(chatId,'⚠️ Session incomplète.', backToMenuKB());

  const list = (await getJSON(keys.projectsList)) || [];
  const pid = String(Date.now());
  const proj = {
    id: pid,
    title: tmp.title,
    version: 'v1',
    status: 'draft',
    budget: { capCents: tmp.capCents || 0, alertStepCents: tmp.alertCents || 0 },
    prompt: tmp.prompt,
    createdAt: Date.now()
  };
  await setJSON(keys.project(pid), proj);
  list.unshift({ id: pid, title: proj.title, version: proj.version, createdAt: proj.createdAt });
  await setJSON(keys.projectsList, list);
  await del(keys.tmp(uid));

  await reply(chatId, `Projet <b>${escapeHtml(proj.title)}</b> créé ✅\nVersion: ${proj.version}\nCap: ${(proj.budget.capCents/100).toFixed(2)} € – Alerte: ${(proj.budget.alertStepCents/100).toFixed(2)} €`, 
    kb([
      [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'📦 ZIP', callback_data:`prj:zip:${pid}` }],
      [{ text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }, { text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
      [{ text:'⬅️ Menu', callback_data:'act:menu' }]
    ]));
}

/* Projets & Budget */

async function listProjects(chatId){
  const keys = keysForUser();
  const list = (await getJSON(keys.projectsList)) || [];
  if (!list.length){
    return reply(chatId, 'Aucun projet. Lance un nouveau projet.',
      kb([[{ text:'🆕 Nouveau projet', callback_data:'act:new' }],[{ text:'⬅️ Retour', callback_data:'act:menu' }]]));
  }
  const rows = list.map(p => [{ text:`📁 ${p.title} (${p.id})`, callback_data:`prj:open:${p.id}` }]);
  rows.push([{ text:'⬅️ Retour', callback_data:'act:menu' }]);
  await reply(chatId, 'Projets :', kb(rows));
}

async function openProject(chatId, pid){
  const keys = keysForUser();
  const p = await getJSON(keys.project(pid));
  if (!p) return reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]]));
  const rows = [
    [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'📦 ZIP', callback_data:`prj:zip:${pid}` }],
    [{ text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }, { text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
    [{ text:'⬅️ Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b>\nVersion: ${p.version || 'v1'}\nStatus: ${p.status || 'draft'}`, kb(rows));
}

function fmtEurosCents(c){ return `${(c/100).toFixed(2).replace('.',',')} €`; }

async function handleBudgetMenu(chatId){
  const keys = keysForUser();
  const u = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = `Budget global\n- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)\n- Cap: ${fmtEurosCents(b.capCents||0)}\n- Alerte: ${fmtEurosCents(b.alertStepCents||0)}\n- Prix/1k: ${pricePer1k()} €`;
  await reply(chatId, txt, kb([
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense', callback_data:'bdg:raz' }],
    [{ text:'⬅️ Retour', callback_data:'act:menu' }]
  ]));
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
  await reply(chatId, 'Dépense globale remise à zéro.', kb([[{ text:'⬅️ Retour', callback_data:'act:budget' }]]));
}

/* ZIP (stub) */

async function makeZipForProject(project){
  const zip = new AdmZip();
  const readme = `# ${project.title}\n\nVersion: ${project.version}\n\n## Déploiement rapide (Vercel)\n1) Crée un projet Vercel\n2) Ajoute les variables d'environnement\n3) Déploie\n`;
  zip.addFile('README.md', Buffer.from(readme,'utf-8'));
  const botjs = `export default async function handler(req,res){res.status(200).json({ok:true,message:"${project.title} bot ready"})}`;
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
  if (!p) return reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]]));
  const buf = await makeZipForProject(p);
  await sendZip(chatId, buf, `${p.title.replace(/\s+/g,'_')}_${p.version||'v1'}.zip`);
  const tokens = 300;
  const { euros } = await addUsage({ projectId: pid, tokens });
  await reply(chatId, `ZIP généré ✅\nCoût estimé: ${euros.toFixed(4)} €`, kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
}

/* Router */

async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;

  // Commande debug (admin only)
  if (text.trim() === '/debug'){
    const keys = keysForUser();
    const tmp = await getJSON(keys.tmp(fromId));
    await reply(chatId, `<b>DEBUG TMP</b>\n<code>${escapeHtml(JSON.stringify(tmp,null,2))}</code>`, backToMenuKB());
    return;
  }

  const tmp = await safeGetTmp(fromId);

  if (tmp?.step === 'title'){
    const title = text.trim();
    return askBudget(chatId, fromId, title);
  }

  if (tmp?.step === 'prompt'){
    return askConfirm(chatId, fromId, text);
  }
}

async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;

  if (data === 'act:menu') return handleStart(chatId);
  if (data === 'act:new')  return askTitle(chatId, fromId);
  if (data === 'act:list') return listProjects(chatId);
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset') { await ensureGlobalDefaults(); return handleStart(chatId); }

  if (data.startsWith('np:')){
    const tmp = (await safeGetTmp(fromId)) || {};
    const [, sub, val] = data.split(':');

    if (sub === 'cap'){ await safeSetTmp(fromId, { ...tmp, capCents:Number(val)||0, step:'budget' }, 900); return; }
    if (sub === 'alert'){ await safeSetTmp(fromId, { ...tmp, alertCents:Number(val)||0, step:'budget' }, 900); return; }
    if (sub === 'budget' && val === 'ok'){ return askPrompt(chatId, fromId); }
    if (sub === 'confirm' && val === 'yes'){ return createProjectFromTmp(chatId, fromId); }
    if (sub === 'confirm' && val === 'no'){ return askPrompt(chatId, fromId); }
  }

  if (data.startsWith('prj:')){
    const [, act, pid] = data.split(':');
    if (act === 'open')   return openProject(chatId, pid);
    if (act === 'zip')    return buildZip(chatId, pid);
    if (act === 'resume') return reply(chatId, 'Mode assistant de reprise à venir.', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
    if (act === 'secrets')return reply(chatId, 'Secrets par projet (édition à venir).', kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
  }

  if (data.startsWith('bdg:')){
    const [, kind, delta] = data.split(':');
    if (kind === 'raz') return resetSpent(chatId);
    if (kind === 'cap' || kind === 'al') return adjustBudget(chatId, kind, Number(delta));
  }
}

/* Webhook */

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
    // surface l'erreur pour debuggage rapide dans Telegram
    try{ await reply(process.env.ADMIN_TELEGRAM_ID, `⚠️ Webhook error: <code>${escapeHtml(String(e))}</code>`); }catch{}
    return res.status(200).json({ ok:true, error: String(e) });
  }
}
