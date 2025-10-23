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

function askTitleKB(){ return kb([[{ text:'⬅️ Retour', callback_data:'act:menu' }]]); }

async function askNewProjectTitle(chatId){
  const keys = keysForUser();
  await setJSON(keys.project('tmp'), { step:'title' }, 600);
  await reply(chatId, 'Titre du projet ?', askTitleKB());
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

function summarizePrompt(p){
  const lines = String(p).split('\n').map(l=>l.trim()).filter(Boolean);
  return lines.slice(0,10).join('\n').slice(0,700);
}

async function handleText(chatId, fromId, text){
  if (!isAdmin(fromId)) return;
  const keys = keysForUser();
  const tmp = await getJSON(keys.project('tmp'));
  if (tmp && tmp.step === 'title'){
    tmp.title = text.trim(); tmp.step='budget';
    await setJSON(keys.project('tmp'), tmp, 900);
    const kbBudget = kb([
      [{ text:'Cap 10€', callback_data:'np:cap:1000' }, { text:'Cap 20€', callback_data:'np:cap:2000' }],
      [{ text:'Alerte 1€', callback_data:'np:alert:100' }, { text:'Alerte 2€', callback_data:'np:alert:200' }],
      [{ text:'OK', callback_data:'np:budget:ok' }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
    ]);
    await reply(chatId, `Budget pour <b>${escapeHtml(tmp.title)}</b> ?`, kbBudget);
    return;
  }
  if (tmp && tmp.step === 'prompt'){
    tmp.prompt = text; tmp.step='confirm';
    await setJSON(keys.project('tmp'), tmp, 900);
    const summary = summarizePrompt(text);
    await reply(chatId, `Résumé compris :\n\n${escapeHtml(summary)}\n\nValider ?`,
      kb([[{ text:'✅ Valider', callback_data:'np:confirm:yes' }, { text:'✏️ Modifier', callback_data:'np:confirm:no' }],
          [{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
    return;
  }
}

async function listProjects(chatId){
  const keys = keysForUser();
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

async function openProject(chatId, pid){
  const keys = keysForUser();
  const p = await getJSON(keys.project(pid));
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]])); return; }
  const rows = [
    [{ text:'▶️ Reprendre', callback_data:`prj:resume:${pid}` }, { text:'📦 ZIP', callback_data:`prj:zip:${pid}` }],
    [{ text:'🔑 Secrets', callback_data:`prj:secrets:${pid}` }, { text:'🗑️ Supprimer', callback_data:`prj:del:${pid}` }],
    [{ text:'⬅️ Retour', callback_data:'act:list' }]
  ];
  await reply(chatId, `Projet <b>${escapeHtml(p.title)}</b>\nVersion: ${p.version || 'v1'}\nStatus: ${p.status || 'draft'}`, kb(rows));
}

function fmtEurosCents(cents){ return `${(cents/100).toFixed(2).replace('.',',')} €`; }

async function handleBudgetMenu(chatId){
  const keys = keysForUser();
  const u = (await getJSON('creatorbottg:usage:global')) || { tokens:0, euros:0 };
  const b = (await getJSON(keys.budgetGlobal)) || { capCents:0, alertStepCents:0 };
  const txt = `Budget global\n- Dépensé: ${(u.euros||0).toFixed(4)} €  (${u.tokens||0} tokens)\n- Cap: ${fmtEurosCents(b.capCents)}\n- Alerte: ${fmtEurosCents(b.alertStepCents)}\n- Prix/1k tokens: ${pricePer1k()} €`;
  const rows = [
    [{ text:'Cap +1€', callback_data:'bdg:cap:+100' }, { text:'Cap -1€', callback_data:'bdg:cap:-100' }],
    [{ text:'Alerte +1€', callback_data:'bdg:al:+100' }, { text:'Alerte -1€', callback_data:'bdg:al:-100' }],
    [{ text:'RAZ dépense (manuelle)', callback_data:'bdg:raz' }],
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
  await handleBudgetMenu(chatId);
}

async function resetSpent(chatId){
  await setJSON('creatorbottg:usage:global', { tokens:0, euros:0, history:[] });
  await reply(chatId, 'Dépense globale remise à zéro.', kb([[{ text:'⬅️ Retour', callback_data:'act:budget' }]]));
}

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
  const p = await getJSON(`creatorbottg:project:${pid}`);
  if (!p){ await reply(chatId,'Projet introuvable.', kb([[{ text:'⬅️ Retour', callback_data:'act:list' }]])); return; }
  const buf = await makeZipForProject(p);
  await sendZip(chatId, buf, `${p.title.replace(/\s+/g,'_')}_${p.version||'v1'}.zip`);
  const tokens = 300;
  const { euros } = await addUsage({ projectId: pid, tokens });
  await reply(chatId, `ZIP généré ✅\nCoût estimé: ${euros.toFixed(4)} €`, kb([[{ text:'⬅️ Retour', callback_data:`prj:open:${pid}` }]]));
}

async function handleCallback(chatId, fromId, data){
  if (!isAdmin(fromId)) return;

  if (data === 'act:menu') return handleStart(chatId);
  if (data === 'act:new')  return askNewProjectTitle(chatId);
  if (data === 'act:list') return listProjects(chatId);
  if (data === 'act:budget') return handleBudgetMenu(chatId);
  if (data === 'act:reset') { await ensureGlobalDefaults(); return handleStart(chatId); }
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
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ callback_query_id: cb.id })
      });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:true, error: String(e) });
  }
}
