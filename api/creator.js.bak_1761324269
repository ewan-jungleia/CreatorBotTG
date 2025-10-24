const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ADMIN = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

import { getJSON, setJSON } from './_kv.js';
import { buildEchoBotZip } from './builder.js';
import { summarizePrompt } from './_ai.js';

/* ==== Utils ==== */
function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }
function esc(s){ return String(s||'').replace(/[<&>]/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c])); }
function isAdmin(uid){ return ADMIN ? String(uid)===ADMIN : true; }

async function reply(chatId, text, extra){
  await fetch(`${API}/sendMessage`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML', ...extra })
  });
}

/* ==== TMP storage (par utilisateur) ==== */
function keysFor(uid){
  const base = 'creatorbottg';
  return { tmp: `${base}:tmp:${uid}` };
}
async function getTMP(uid){
  const k = keysFor(uid).tmp;
  const j = await getJSON(k);
  try{
    if (!j) return null;
    // Valeur stockée via setJSON(JSON.stringify(val)) -> j est déjà l’objet unwrapped par _kv.js
    return typeof j.value === 'string' ? JSON.parse(j.value) : j.value || j;
  }catch{ return null; }
}
async function setTMP(uid, obj, ttl=1800){
  const k = keysFor(uid).tmp;
  await setJSON(k, obj, ttl);
}

/* ==== UI ==== */
async function showMenu(chatId){
  await reply(chatId, 'CreatorBot-TG en ligne ✅\nChoisis une action :', kb([
    [{ text:'🆕 Nouveau projet', callback_data:'act:new' }, { text:'📁 Projets', callback_data:'act:list' }],
    [{ text:'💰 Budget', callback_data:'act:budget' }, { text:'🔑 Secrets', callback_data:'act:secrets' }],
    [{ text:'📦 ZIP', callback_data:'act:zip' }, { text:'♻️ Reset', callback_data:'act:reset' }]
  ]));
}

async function askTitle(chatId, uid){
  await setTMP(uid, { step:'title' });
  await reply(chatId, 'Titre du projet ?', kb([[{ text:'⬅ Retour menu', callback_data:'act:menu' }]]));
}

async function askBudget(chatId, uid){
  const tmp = await getTMP(uid) || {};
  const title = tmp.title || '';
  await setTMP(uid, { step:'budget', title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0 });
  await reply(chatId, `Budget pour <b>${esc(title)}</b>`, kb([
    [{ text:'Cap 10€', callback_data:'b:cap:1000' }, { text:'Cap 20€', callback_data:'b:cap:2000' }],
    [{ text:'Alerte 1€', callback_data:'b:alert:100' }, { text:'Alerte 2€', callback_data:'b:alert:200' }],
    [{ text:'OK', callback_data:'b:ok' }, { text:'⬅ Annuler', callback_data:'act:menu' }]
  ]));
}

async function askPrompt(chatId, uid){
  const tmp = await getTMP(uid) || {};
  await setTMP(uid, { step:'prompt', title: tmp.title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0 });
  await reply(chatId, 'Envoie le prompt principal (objectif, contraintes, livrables, etc.)', kb([[{ text:'⬅ Annuler', callback_data:'act:menu' }]]));
}

async function showConfirm(chatId, uid){
  const tmp = await getTMP(uid) || {};
  const summary = tmp.summary || '';
  await setTMP(uid, { ...tmp, step:'confirm' });
  await reply(chatId, `Résumé compris :\n\n${esc(summary)}\n\nValider ?`, kb([
    [{ text:'✅ Valider', callback_data:'sum:ok' }, { text:'✏️ Modifier', callback_data:'sum:edit' }],
    [{ text:'⬅ Annuler', callback_data:'act:menu' }]
  ]));
}

/* ==== OpenAI (plan/faisabilité) ==== */
async function askOpenAI(messages){
  const api = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+api },
    body: JSON.stringify({ model, messages, temperature:0.3 })
  });
  const j = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() || '';
}

async function onSummaryOk(chatId, uid){
  const tmp  = (await getTMP(uid)) || {};
  const title = tmp.title || 'Projet';
  const prompt = tmp.prompt || '';

  const sys = `Tu es un architecte logiciel Telegram ultra rigoureux.
Réponds en français, format clair avec titres **gras** et listes.
Tu dois fournir: Faisabilité, Plan stratégique (phases), Plan d'action (tâches), Besoins (inputs & secrets), Livrables (code, README, déploiement).
Sois concret, pas verbeux.`;

  const usr = `Titre: ${title}
Brief utilisateur:
${prompt}`;

  await reply(chatId, 'Je prépare la faisabilité et le plan…');
  const plan = await askOpenAI([
    { role:'system', content: sys },
    { role:'user', content: usr }
  ]);

  tmp.step = 'plan';
  tmp.plan = plan;
  await setTMP(uid, tmp);

  await reply(chatId, `**Faisabilité & Plan pour ${esc(title)}**\n\n${plan}`, kb([
    [{ text:'✅ Continuer', callback_data:'plan:ok' }],
    [{ text:'✏️ Modifier le brief', callback_data:'sum:edit' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]));
}

/* ==== Handlers ==== */
async function handleText(chatId, uid, text){
  const tmp = await getTMP(uid);

  if (!tmp) { await showMenu(chatId); return; }

  if (tmp.step === 'title'){
    const title = String(text||'').trim();
    if (!title) { await reply(chatId, 'Envoie un titre valide.'); return; }
    await setTMP(uid, { ...tmp, step:'budget', title });
    await reply(chatId, `Titre enregistré : <b>${esc(title)}</b>`);
    await askBudget(chatId, uid);
    return;
  }

  if (tmp.step === 'prompt'){
    const userPrompt = String(text||'').trim();
    await reply(chatId, 'Je réfléchis au résumé…');
    let summary = '';
    try { summary = await summarizePrompt(userPrompt); }
    catch(e){ summary = `Impossible de résumer: ${String(e)}`; }

    await setTMP(uid, {
      step:'confirm',
      title: tmp.title,
      capCents: tmp.capCents||0,
      alertStepCents: tmp.alertStepCents||0,
      prompt: userPrompt,
      summary
    });
    await showConfirm(chatId, uid);
    return;
  }

  await showMenu(chatId);
}

async function handleCallback(chatId, uid, data){
  if (data === 'help:tokens') { await reply(chatId, TOKENS_GUIDE); return; }
const tmp = (await getTMP(uid)) || {};

  if (data === 'act:menu'){ await setTMP(uid, null); await showMenu(chatId); return; }
  if (data === 'act:new'){ await askTitle(chatId, uid); return; }

  // Budget
  if (data.startsWith('b:')){
    const [_, kind, val] = data.split(':');
    if (tmp.step!=='budget'){ await askBudget(chatId, uid); return; }
    if (kind==='cap'){ await setTMP(uid, { ...tmp, capCents:Number(val) }); await reply(chatId, `Cap défini: ${(Number(val)/100).toFixed(2)} €`); }
    if (kind==='alert'){ await setTMP(uid, { ...tmp, alertStepCents:Number(val) }); await reply(chatId, `Alerte: ${(Number(val)/100).toFixed(2)} €`); }
    if (kind==='ok'){ await askPrompt(chatId, uid); }
    return;
  }

  // Résumé validé / modifié
  if (data === 'sum:ok'){ await onSummaryOk(chatId, uid); return; }
  if (data === 'sum:edit'){ await setTMP(uid, { ...tmp, step:'prompt' }); await reply(chatId, 'Ok, renvoie le prompt principal (objectif, contraintes, livrables, etc.).'); return; }

  // Après plan : demander secrets
  if (data === 'plan:ok'){
    await setTMP(uid, { ...tmp, step:'secrets' });
    await reply(chatId,
  "Parfait. Maintenant, envoie-moi les **secrets** nécessaires dans ce format :\n\n" +
  "TELEGRAM_BOT_TOKEN=xxxx\n\n" +
  "💡 Pour l’écho-bot de test : seul ce token est nécessaire.\n" +
  "Si tu veux en savoir plus, clique sur le bouton ci-dessous.",
  kb([
    [{ text:"❓ Où trouver les tokens ?", callback_data:"sec:help" }],
    [{ text:"⬅️ Annuler", callback_data:"act:menu" }]
  ])
);
    return;
  }

  if (data === 'sec:help'){
    await reply(chatId,
  "🔑 *GUIDE DÉTAILLÉ : Où trouver les tokens ?*\n\n" +
  "📘 *1) TELEGRAM_BOT_TOKEN (obligatoire)*\n" +
  "  1. Ouvre Telegram.\n" +
  "  2. Recherche *@BotFather* et démarre la conversation.\n" +
  "  3. Tape /newbot puis choisis un nom (ex : MonBotTest).\n" +
  "  4. Choisis un identifiant unique (ex : monbottest_bot).\n" +
  "  5. Copie le token affiché (ex : 123456789:AA...).\n" +
  "  6. Colle-le ici sous la forme :\n" +
  "     TELEGRAM_BOT_TOKEN=123456789:AA...\n\n" +
  "💡 Ce token suffit pour l’écho-bot minimal.\n\n" +
  "🤖 *2) OPENAI_API_KEY (optionnelle)*\n" +
  "  - Sert uniquement si ton projet nécessite l’IA.\n" +
  "  - Crée-la sur https://platform.openai.com/ (profil → View API Keys).\n\n" +
  "🗄️ *3) Upstash KV (optionnel)*\n" +
  "  - Sert uniquement si ton projet a besoin de stockage persistant.\n" +
  "  - Crée une base sur https://upstash.com (Redis REST API).\n\n" +
  "📌 *Pour le bot de test, tu peux ignorer tout sauf TELEGRAM_BOT_TOKEN.*"
);
    return;
  }

  // Divers (placeholders)
  if (data === 'act:list'){ await reply(chatId,'Projets (à venir).'); return; }
  if (data === 'act:budget'){ await reply(chatId,'Budget global (à venir).'); return; }
  if (data === 'act:secrets'){ await reply(chatId,'Secrets (à venir).'); return; }
  if (data === 'act:zip'){ await reply(chatId,'ZIP (à venir).'); return; }
  if (data === 'act:reset'){ await setTMP(uid, null); await reply(chatId,'État réinitialisé.'); await showMenu(chatId); return; }

  await showMenu(chatId);
}

/* ==== HTTP entry ==== */

/* GUIDE_TOKENS_START */

const TOKENS_GUIDE = [
  '🔑 *GUIDE DÉTAILLÉ : Où trouver les tokens ?*\n',
  '',
  '📘 *1) TELEGRAM_BOT_TOKEN (obligatoire)*',
  '  1. Ouvre Telegram.',
  '  2. Cherche le compte *@BotFather* et démarre la conversation.',
  '  3. Tape /newbot puis choisis un nom pour ton bot (ex: "Mon Bot Test").',
  '  4. Choisis un identifiant unique (doit finir par "bot", ex: monbottest_bot).',
  '  5. Copie le token affiché (format : 123456789:AA... ).',
  '  6. Colle-le ici sous la forme :',
  '     TELEGRAM_BOT_TOKEN=123456789:AA... ',
  '',
  '💡 *Ce token permet de lier ton projet au bot Telegram.*',
  '',
  '🤖 *2) OPENAI_API_KEY (optionnelle)*',
  '  - Sert uniquement si ton futur projet utilise l’IA (ChatGPT, génération de texte, etc.).',
  '  1. Va sur https://platform.openai.com/',
  '  2. Connecte-toi ou crée un compte.',
  '  3. Clique sur ton profil (en haut à droite) → *View API Keys*.',
  '  4. Clique sur *Create new secret key*.',
  '  5. Copie la clé (format : sk-proj-... ).',
  '  6. Colle-la ici sous la forme :',
  '     OPENAI_API_KEY=sk-proj-... ',
  '',
  '🗄️ *3) Upstash KV (optionnel)*',
  '  - Sert uniquement pour stocker ou partager des données entre bots.',
  '  1. Va sur https://upstash.com/',
  '  2. Crée un compte (Google, GitHub ou e-mail).',
  '  3. Clique sur *Create Database* → choisis *Redis REST API*.',
  '  4. Une fois la base créée, clique sur *REST API*.',
  '  5. Copie :',
  '     - REST URL  → à coller ici : KV_REST_API_URL=...',
  '     - REST TOKEN → à coller ici : KV_REST_API_TOKEN=...',
  '',
  '📌 *Pour l’écho-bot de test : seul TELEGRAM_BOT_TOKEN est nécessaire.*'
].join('\n');

/* GUIDE_TOKENS_END */

export default async function handler(req,res){
  if (req.method === 'GET') return res.status(200).send('OK');
  if (req.method !== 'POST') return res.status(405).json({ ok:false });

  try{
    const u = req.body || {};
    const msg = u.message;
    const cb  = u.callback_query;

    if (msg && msg.text){
      const chatId = msg.chat?.id;
      const fromId = msg.from?.id;
      if (!isAdmin(fromId)){ await reply(chatId,'❌ Accès refusé – bot privé.'); return res.json({ok:true}); }
      if (msg.text === '/start'){ await showMenu(chatId); return res.json({ok:true}); }
      await handleText(chatId, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await reply(chatId,'❌ Accès refusé – bot privé.'); return res.json({ok:true}); }
      await handleCallback(chatId, fromId, cb.data||'');
      await fetch(`${API}/answerCallbackQuery`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ callback_query_id: cb.id }) });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:false, error: String(e) });
  }
}


function parseSecrets(text){
  const out = {};
  String(text||'').split(/\r?\n/).forEach(line=>{
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/i);
    if(m) out[m[1].toUpperCase()] = m[2];
  });
  return out;
}
