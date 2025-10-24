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
    // Valeur stocke via setJSON(JSON.stringify(val)) -> j est dj lobjet unwrapped par _kv.js
    return typeof j.value === 'string' ? JSON.parse(j.value) : j.value || j;
  }catch{ return null; }
}
async function setTMP(uid, obj, ttl=1800){
  const k = keysFor(uid).tmp;
  await setJSON(k, obj, ttl);
}

/* ==== UI ==== */
async function showMenu(chatId){
  await reply(chatId, 'CreatorBot-TG en ligne \nChoisis une action :', kb([
    [{ text:' Nouveau projet', callback_data:'act:new' }, { text:' Projets', callback_data:'act:list' }],
    [{ text:' Budget', callback_data:'act:budget' }, { text:' Secrets', callback_data:'act:secrets' }],
    [{ text:' ZIP', callback_data:'act:zip' }, { text:' Reset', callback_data:'act:reset' }]
  ]));
}

async function askTitle(chatId, uid){
  await setTMP(uid, { step:'title' });
  await reply(chatId, 'Titre du projet ?', kb([[{ text:' Retour menu', callback_data:'act:menu' }]]));
}

async function askBudget(chatId, uid){
  const tmp = await getTMP(uid) || {};
  const title = tmp.title || '';
  await setTMP(uid, { step:'budget', title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0 });
  await reply(chatId, `Budget pour <b>${esc(title)}</b>`, kb([
    [{ text:'Cap 10', callback_data:'b:cap:1000' }, { text:'Cap 20', callback_data:'b:cap:2000' }],
    [{ text:'Alerte 1', callback_data:'b:alert:100' }, { text:'Alerte 2', callback_data:'b:alert:200' }],
    [{ text:'OK', callback_data:'b:ok' }, { text:' Annuler', callback_data:'act:menu' }]
  ]));
}

async function askPrompt(chatId, uid){
  const tmp = await getTMP(uid) || {};
  await setTMP(uid, { step:'prompt', title: tmp.title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0 });
  await reply(chatId, 'Envoie le prompt principal (objectif, contraintes, livrables, etc.)', kb([[{ text:' Annuler', callback_data:'act:menu' }]]));
}

async function showConfirm(chatId, uid){
  const tmp = await getTMP(uid) || {};
  const summary = tmp.summary || '';
  await setTMP(uid, { ...tmp, step:'confirm' });
  await reply(chatId, `Rsum compris :\n\n${esc(summary)}\n\nValider ?`, kb([
    [{ text:' Valider', callback_data:'sum:ok' }, { text:' Modifier', callback_data:'sum:edit' }],
    [{ text:' Annuler', callback_data:'act:menu' }]
  ]));
}

/* ==== OpenAI (plan/faisabilit) ==== */
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
Rponds en franais, format clair avec titres **gras** et listes.
Tu dois fournir: Faisabilit, Plan stratgique (phases), Plan d'action (tches), Besoins (inputs & secrets), Livrables (code, README, dploiement).
Sois concret, pas verbeux.`;

  const usr = `Titre: ${title}
Brief utilisateur:
${prompt}`;

  await reply(chatId, 'Je prpare la faisabilit et le plan');
  const plan = await askOpenAI([
    { role:'system', content: sys },
    { role:'user', content: usr }
  ]);

  tmp.step = 'plan';
  tmp.plan = plan;
  await setTMP(uid, tmp);

  await reply(chatId, `**Faisabilit & Plan pour ${esc(title)}**\n\n${plan}`, kb([
    [{ text:' Continuer', callback_data:'plan:ok' }],
    [{ text:' Modifier le brief', callback_data:'sum:edit' }],
    [{ text:' Annuler', callback_data:'act:menu' }]
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
    await reply(chatId, `Titre enregistr : <b>${esc(title)}</b>`);
    await askBudget(chatId, uid);
    return;
  }

  
    if (tmp.step === 'prompt'){
    const userPrompt = String(text||'').trim();
    await reply(chatId, 'Je rflchis au rsum');
    let summary = '';
    try { summary = await summarizePrompt(userPrompt); }
    catch(e){ summary = `Impossible de rsumer: ${String(e)}`; }

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

  
    "
  if (tmp.step === 'secrets'){
" .
    "    const tok = (function(t){ const m=/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S+)\s*i.exec(t||""); return m?m[1].trim():null; })(text);
" .
    "    if (!tok){ await reply(chatId, "Envoie le token au format :\nTELEGRAM_BOT_TOKEN=123456:ABC...\n(ou clique sur  O trouver les tokens ?)"); return; }
" .
    "    const title = tmp.title || 'EchoBot';
" .
    "    await setTMP(uid, { ...tmp, step:'secrets', echoTok: tok });
" .
    "    await echoReady(chatId, title, tok);
" .
    "    return;
" .
    "  }

"
    . "  await showMenu(chatId);
"
  
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
    if (kind==='cap'){ await setTMP(uid, { ...tmp, capCents:Number(val) }); await reply(chatId, `Cap dfini: ${(Number(val)/100).toFixed(2)} `); }
    if (kind==='alert'){ await setTMP(uid, { ...tmp, alertStepCents:Number(val) }); await reply(chatId, `Alerte: ${(Number(val)/100).toFixed(2)} `); }
    if (kind==='ok'){ await askPrompt(chatId, uid); }
    return;
  }

  // Rsum valid / modifi
  if (data === 'sum:ok'){ await onSummaryOk(chatId, uid); return; }
  if (data === 'sum:edit'){ await setTMP(uid, { ...tmp, step:'prompt' }); await reply(chatId, 'Ok, renvoie le prompt principal (objectif, contraintes, livrables, etc.).'); return; }

  // Aprs plan : demander secrets
  if (data === 'plan:ok'){
    await setTMP(uid, { ...tmp, step:'secrets' });
    await reply(chatId,
  "Parfait. Maintenant, envoie-moi les **secrets** ncessaires dans ce format :\n\n" +
  "TELEGRAM_BOT_TOKEN=xxxx\n\n" +
  " Pour lcho-bot de test : seul ce token est ncessaire.\n" +
  "Si tu veux en savoir plus, clique sur le bouton ci-dessous.",
  kb([
    [{ text:" O trouver les tokens ?", callback_data:"sec:help" }],
    [{ text:" Annuler", callback_data:"act:menu" }]
  ])
);
    return;
  }

  if (data === 'sec:help'){
    await reply(chatId,
  " *GUIDE DTAILL : O trouver les tokens ?*\n\n" +
  " *1) TELEGRAM_BOT_TOKEN (obligatoire)*\n" +
  "  1. Ouvre Telegram.\n" +
  "  2. Recherche *@BotFather* et dmarre la conversation.\n" +
  "  3. Tape /newbot puis choisis un nom (ex : MonBotTest).\n" +
  "  4. Choisis un identifiant unique (ex : monbottest_bot).\n" +
  "  5. Copie le token affich (ex : 123456789:AA...).\n" +
  "  6. Colle-le ici sous la forme :\n" +
  "     TELEGRAM_BOT_TOKEN=123456789:AA...\n\n" +
  " Ce token suffit pour lcho-bot minimal.\n\n" +
  " *2) OPENAI_API_KEY (optionnelle)*\n" +
  "  - Sert uniquement si ton projet ncessite lIA.\n" +
  "  - Cre-la sur https://platform.openai.com/ (profil  View API Keys).\n\n" +
  " *3) Upstash KV (optionnel)*\n" +
  "  - Sert uniquement si ton projet a besoin de stockage persistant.\n" +
  "  - Cre une base sur https://upstash.com (Redis REST API).\n\n" +
  " *Pour le bot de test, tu peux ignorer tout sauf TELEGRAM_BOT_TOKEN.*"
);
    return;
  }

  // Divers (placeholders)
  if (data === 'act:list'){ await reply(chatId,'Projets ( venir).'); return; }
  if (data === 'act:budget'){ await reply(chatId,'Budget global ( venir).'); return; }
  if (data === 'act:secrets'){ await reply(chatId,'Secrets ( venir).'); return; }
  if (data === 'act:zip'){ await reply(chatId,'ZIP ( venir).'); return; }
  if (data === 'act:reset'){ await setTMP(uid, null); await reply(chatId,'tat rinitialis.'); await showMenu(chatId); return; }

  await showMenu(chatId);
}

/* ==== HTTP entry ==== */

/* GUIDE_TOKENS_START */

const TOKENS_GUIDE = [
  ' *GUIDE DTAILL : O trouver les tokens ?*\n',
  '',
  ' *1) TELEGRAM_BOT_TOKEN (obligatoire)*',
  '  1. Ouvre Telegram.',
  '  2. Cherche le compte *@BotFather* et dmarre la conversation.',
  '  3. Tape /newbot puis choisis un nom pour ton bot (ex: "Mon Bot Test").',
  '  4. Choisis un identifiant unique (doit finir par "bot", ex: monbottest_bot).',
  '  5. Copie le token affich (format : 123456789:AA... ).',
  '  6. Colle-le ici sous la forme :',
  '     TELEGRAM_BOT_TOKEN=123456789:AA... ',
  '',
  ' *Ce token permet de lier ton projet au bot Telegram.*',
  '',
  ' *2) OPENAI_API_KEY (optionnelle)*',
  '  - Sert uniquement si ton futur projet utilise lIA (ChatGPT, gnration de texte, etc.).',
  '  1. Va sur https://platform.openai.com/',
  '  2. Connecte-toi ou cre un compte.',
  '  3. Clique sur ton profil (en haut  droite)  *View API Keys*.',
  '  4. Clique sur *Create new secret key*.',
  '  5. Copie la cl (format : sk-proj-... ).',
  '  6. Colle-la ici sous la forme :',
  '     OPENAI_API_KEY=sk-proj-... ',
  '',
  ' *3) Upstash KV (optionnel)*',
  '  - Sert uniquement pour stocker ou partager des donnes entre bots.',
  '  1. Va sur https://upstash.com/',
  '  2. Cre un compte (Google, GitHub ou e-mail).',
  '  3. Clique sur *Create Database*  choisis *Redis REST API*.',
  '  4. Une fois la base cre, clique sur *REST API*.',
  '  5. Copie :',
  '     - REST URL    coller ici : KV_REST_API_URL=...',
  '     - REST TOKEN   coller ici : KV_REST_API_TOKEN=...',
  '',
  ' *Pour lcho-bot de test : seul TELEGRAM_BOT_TOKEN est ncessaire.*'
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
      if (!isAdmin(fromId)){ await reply(chatId,' Accs refus  bot priv.'); return res.json({ok:true}); }
      if (msg.text === '/start'){ await showMenu(chatId); return res.json({ok:true}); }
      await handleText(chatId, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await reply(chatId,' Accs refus  bot priv.'); return res.json({ok:true}); }
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


async function _hookKvEcho(chatId, text, title) {
  if (!text) return false;
  const m = text.match(/\bTELEGRAM_BOT_TOKEN\s*=\s*(\S+)/i);
  if (!m) return false;
  const userTok = m[1].trim();

  if (typeof echoReady === "function") {
    await echoReady(chatId, title || "EchoBot", userTok);
  } else {
    await reply(
      chatId,
      " Token reu. Cliquez sur  Gnrer le projet .",
      kb([[{ text:" Gnrer le projet", callback_data:"echo:gen" }]])
    );
  }
  return true;
}


async function echoReady(chatId, title, token){
  await reply(chatId,
    " Token reu. Prt  gnrer  "+(title||"EchoBot")+" . ",
    kb([[{text:" Gnrer le projet", callback_data:"echo:gen"}]])
  );
}

async function _hookTokenOnly(chatId, text, state){
  const m = (text||"").match(/\bTELEGRAM_BOT_TOKEN\s*=\s*(\S+)/i);
  if(!m) return false;
  const tok = m[1].trim();
  state.tmp = state.tmp || {};
  state.tmp.echoTok = tok;
  await echoReady(chatId, state?.tmp?.title || state?.title || "EchoBot", tok);
  // On reste dans le flow, pas de retour menu :
  state.step = "secrets"; 
  return true;
}

function __eatTelegramToken(text) {
  const m = /^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S+)\s*$/i.exec(text || '');
  return m ? m[1].trim() : null;
}
