const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const ADMIN = String(process.env.ADMIN_TELEGRAM_ID || "").trim();
import { getJSON, setJSON } from './_kv.js';
import { summarizePrompt } from './_ai.js';

function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }
function esc(s){ return String(s||'').replace(/[<&>]/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c])); }

async function reply(chatId, text, extra){
  await fetch(`${API}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text, parse_mode:'HTML', ...extra })
  });
}

function keysFor(uid){
  const base = 'creatorbottg';
  return {
    tmp: `${base}:tmp:${uid}`,
    projects: `${base}:projects:${uid}`
  };
}

async function getTMP(uid){
  const k = keysFor(uid).tmp;
  const j = await getJSON(k);
  try{
    if (!j) return null;
    const v = typeof j.value === 'string' ? JSON.parse(j.value) : j.value;
    return v || null;
  }catch{ return null; }
}

async function setTMP(uid, obj){
  const k = keysFor(uid).tmp;
  await setJSON(k, obj, 1800);
}

function isAdmin(uid){ return ADMIN ? String(uid)===ADMIN : true; }

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
  await setTMP(uid, { step:'budget', title });
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
    [{ text:'✅ Valider', callback_data:'confirm:ok' }, { text:'✏️ Modifier', callback_data:'confirm:edit' }],
    [{ text:'⬅ Annuler', callback_data:'act:menu' }]
  ]));
}


async function handleText(chatId, uid, text){
  // PATCH anti-bug: fallback par défaut sur 'title', puis enchaîne vers Budget
  try {
    const { keysForUser, getJSON, setJSON } = await import('./_kv.js');
    const keys = keysForUser(String(userId));
    let tmp = (await getJSON(keys.tmp)) || {};
    if (!tmp.step) { tmp.step = 'title'; await setJSON(keys.tmp, tmp, 1800); }

    if (tmp.step === 'title') {
      const title = String(text || '').trim();
      if (!title) { await reply(chatId, 'Envoie un titre valide.'); return; }
      tmp.title = title;
      tmp.step = 'budget';
      await setJSON(keys.tmp, tmp, 1800);

      const kb = kbInline([
        [{ text:'Cap 10€',  callback_data:'bud:cap:1000' }, { text:'Cap 20€',  callback_data:'bud:cap:2000' }],
        [{ text:'Alerte 1€',callback_data:'bud:alert:100' }, { text:'Alerte 2€',callback_data:'bud:alert:200' }],
        [{ text:'OK',      callback_data:'bud:ok'        }, { text:'⬅️ Annuler', callback_data:'act:menu' }]
      ]);
      await reply(chatId, `Budget pour <b>${esc(title)}</b>`, kb);
      return;
    }
  } catch(e) {
    try { await reply(chatId, 'Erreur: ' + String(e)); } catch {}
  }
{
    const { keysForUser, getJSON, setJSON } = await import('./_kv.js');
    const keys = keysForUser(String(userId));
    const tmp = (await getJSON(keys.tmp)) || {};
    if (tmp.step === 'secrets') {
      const lines = String(text||'').split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
      const envs = {};
      for (const l of lines){
        const m = l.match(/^([A-Z0-9_]+)s*=s*(.+)$/);
        if (m) envs[m[1]] = m[2];
      }
      tmp.secrets = Object.assign({}, tmp.secrets||{}, envs);
      await setJSON(keys.tmp, tmp, 1800);

      const need = ['TELEGRAM_BOT_TOKEN','OPENAI_API_KEY','KV_REST_API_URL','KV_REST_API_TOKEN'];
      const missing = need.filter(k=>!tmp.secrets?.[k]);

      if (missing.length){
        await reply(chatId, "Reçu. Il manque encore : " + missing.join(', ') + ". Ajoute-les (même format KEY=VALUE).");
      }else{
        const kb = kbInline([
          [{ text:'🚀 Générer le projet', callback_data:'gen:go' }],
          [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
        ]);
        await reply(chatId, "Parfait, j’ai tout. Prêt à **générer le projet** (code + README).", kb);
      }
      return;
    }
  }
const tmp = await getTMP(uid);
  if (!tmp) return showMenu(chatId);

  if (tmp.step === 'title'){
    const title = text.trim();
    await setTMP(uid, { step:'budget', title });
    await reply(chatId, `Titre enregistré : <b>${esc(title)}</b>`);
    await askBudget(chatId, uid);
    return;
  }

  if (tmp.step === 'prompt'){
    const userPrompt = text.trim();
    await reply(chatId, 'Je réfléchis au résumé…');
    let summary = '';
    try{ summary = await summarizePrompt(userPrompt); }
    catch(e){ summary = `Impossible de résumer: ${String(e)}`; }
    await setTMP(uid, { step:'confirm', title: tmp.title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0, prompt:userPrompt, summary });
    await showConfirm(chatId, uid);
    return;
  }

  await showMenu(chatId);
}

async function handleCallback(chatId, uid, data){
  
  
  
  
  if (data && data.startsWith('gen:go')) {
    const { keysForUser, getJSON } = await import('./_kv.js');
    const keys = keysForUser(String(userId));
    const tmp = (await getJSON(keys.tmp)) || {};
    await reply(chatId, "OK, je génère les fichiers du projet (code + README)…");
    // Ici, tu brancheras la vraie génération ZIP/Git. Pour l’instant on confirme.
    await reply(chatId, "✅ Projet généré (brouillon). Étape suivante: packaging ZIP et déploiement automatique.");
    return;
  }
if (data && data.startsWith('sec:help')) {
    await reply(chatId, "• TELEGRAM_BOT_TOKEN : @BotFather → /newbot → Copier le token.\n• OPENAI_API_KEY : https://platform.openai.com/\n• KV (Upstash) : créer une base REST et récupérer URL & TOKEN.");
    return;
  }
if (data && data.startsWith('plan:ok')) {
    const { keysForUser, getJSON, setJSON } = await import('./_kv.js');
    const keys = keysForUser(String(userId));
    const tmp = (await getJSON(keys.tmp)) || {};
    tmp.step = 'secrets';
    await setJSON(keys.tmp, tmp, 1800);
    const kb = kbInline([
      [{ text:'❓ Où trouver les tokens ?', callback_data:'sec:help' }],
      [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
    ]);
    await reply(chatId,
      "Parfait. Maintenant, envoie-moi les **secrets** nécessaires dans ce format :\n\n" +
      "TELEGRAM_BOT_TOKEN=xxxx\nOPENAI_API_KEY=xxxx\nKV_REST_API_URL=xxxx\nKV_REST_API_TOKEN=xxxx\n\n" +
      "Tu peux ne fournir que ceux dont tu disposes, je te dirai s’il en manque.",
      kb
    );
    return;
  }
// Suite après validation du résumé
  if (data && data.startsWith('sum:ok')) {
    await onSummaryOk(chatId, userId);
    return;
  }
  if (data && data.startsWith('sum:edit')) {
    const { keysForUser, getJSON, setJSON } = await import('./_kv.js');
    const keys = keysForUser(String(userId));
    const tmp = (await getJSON(keys.tmp)) || {};
    tmp.step = 'prompt';
    await setJSON(keys.tmp, tmp, 1800);
    await reply(chatId, 'Ok, renvoie le prompt principal (objectif, contraintes, livrables, etc.).');
    return;
  }
const tmp = await getTMP(uid) || {};

  if (data === 'act:menu'){ await setTMP(uid, null); await showMenu(chatId); return; }
  if (data === 'act:new'){ await askTitle(chatId, uid); return; }

  if (data.startsWith('b:')){
    const [_, kind, val] = data.split(':');
    if (tmp.step!=='budget'){ await askBudget(chatId, uid); return; }
    if (kind==='cap'){ await setTMP(uid, { ...tmp, capCents:Number(val) }); await reply(chatId, `Cap défini: ${(Number(val)/100).toFixed(2)} €`); }
    if (kind==='alert'){ await setTMP(uid, { ...tmp, alertStepCents:Number(val) }); await reply(chatId, `Alerte: ${(Number(val)/100).toFixed(2)} €`); }
    if (kind==='ok'){ await askPrompt(chatId, uid); }
    return;
  }

  if (data === 'confirm:edit'){
    await askPrompt(chatId, uid);
    return;
  }

  if (data === 'confirm:ok'){
    await setTMP(uid, { ...tmp, step:'done' });
    await reply(chatId, '✅ Validé. Étapes suivantes : faisabilité, plan stratégique, plan d’action, besoins et livrables. (On les génère juste après.)');
    return;
  }

  if (data === 'act:list'){ await reply(chatId,'Projets (à venir).'); return; }
  if (data === 'act:budget'){ await reply(chatId,'Budget global (à venir).'); return; }
  if (data === 'act:secrets'){ await reply(chatId,'Secrets (à venir).'); return; }
  if (data === 'act:zip'){ await reply(chatId,'ZIP (à venir).'); return; }
  if (data === 'act:reset'){ await setTMP(uid, null); await reply(chatId,'État réinitialisé.'); await showMenu(chatId); return; }

  await showMenu(chatId);
}

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


async function askOpenAI(messages){
  const api = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+api },
    body: JSON.stringify({ model, messages, temperature:0.3 })
  });
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content?.trim() || '';
  return txt;
}

async function onSummaryOk(chatId, userId){
  const { keysForUser, getJSON, setJSON } = await import('./_kv.js');
  const keys = keysForUser(String(userId));
  const tmp  = (await getJSON(keys.tmp)) || {};
  const title = tmp.title || 'Projet';
  const prompt = tmp.prompt || '';

  const sys = `Tu es un architecte logiciel Telegram ultra rigoureux.
Réponds en français, format clair avec titres **gras** et listes.
Tu dois fournir: Faisabilité, Plan stratégique (phases), Plan d'action (tâches), Besoins (inputs & secrets), Livrables (code, README, déploiement).
Sois concret, pas verbeux.`;

  const usr = `Titre: ${title}
Brief utilisateur:
${prompt}`;

  // Message d'attente
  await reply(chatId, 'Je prépare la faisabilité et le plan…');

  const plan = await askOpenAI([
    { role:'system', content: sys },
    { role:'user', content: usr }
  ]);

  // Mémorise et propose la suite
  tmp.step = 'plan';
  tmp.plan = plan;
  await setJSON(keys.tmp, tmp, 1800);

  const kb = kbInline([
    [{ text:'✅ Continuer', callback_data:'plan:ok' }],
    [{ text:'✏️ Modifier le brief', callback_data:'sum:edit' }],
    [{ text:'⬅️ Annuler', callback_data:'act:menu' }]
  ]);

  await reply(chatId, `**Faisabilité & Plan pour ${esc(title)}**\n\n${plan}`, kb);
}
