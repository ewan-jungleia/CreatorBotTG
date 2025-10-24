/**
 * CreatorBotTG — handler complet stable (ESM)
 * Flow:
 *  /start -> menu
 *  🆕 Nouveau projet -> Titre -> 💰 Budget -> Prompt -> Résumé (Valider / Modifier)
 *  Après "Valider" -> demande des secrets -> parse TELEGRAM_BOT_TOKEN -> bouton 🚀 Générer le projet
 *  (echo:gen renvoie "ZIP (à venir)" pour l’instant)
 */

const API = "https://api.telegram.org/bot" + (process.env.TELEGRAM_BOT_TOKEN || "");
const ADMIN = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }
function esc(s){ return String(s||"").replace(/[<&>]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[c])); }
function isAdmin(uid){ return ADMIN ? String(uid)===ADMIN : true; }

async function tgSend(chatId, text, extra){
  await fetch(API + "/sendMessage", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode:"HTML", ...(extra||{}) })
  });
}

/* ==== Mémoire volatile par utilisateur (KV pourra remplacer ensuite) ==== */
const TMP = new Map(); // uid -> { step, title, capCents, alertStepCents, prompt, summary, echoTok }

/* ==== UI ==== */
async function showMenu(chatId){
  await tgSend(chatId,
    "CreatorBot-TG en ligne ✅\nChoisis une action :",
    kb([
      [ { text:"🆕 Nouveau projet", callback_data:"act:new" }, { text:"📁 Projets", callback_data:"act:list" } ],
      [ { text:"💰 Budget", callback_data:"act:budget" }, { text:"🔑 Secrets", callback_data:"act:secrets" } ],
      [ { text:"♻️ Reset", callback_data:"act:reset" } ]
    ])
  );
}

async function askTitle(chatId, uid){
  TMP.set(uid, { step:"title" });
  await tgSend(chatId, "Titre du projet ?", kb([[ { text:"⬅ Retour menu", callback_data:"act:menu" } ]]));
}

async function askBudget(chatId, uid){
  const st = TMP.get(uid) || {};
  const title = st.title || "";
  TMP.set(uid, { ...st, step:"budget" });
  await tgSend(chatId,
    "💰 Budget pour <b>"+esc(title)+"</b>",
    kb([
      [ { text:"Cap 10€", callback_data:"b:cap:1000" }, { text:"Cap 20€", callback_data:"b:cap:2000" } ],
      [ { text:"Alerte 1€", callback_data:"b:alert:100" }, { text:"Alerte 2€", callback_data:"b:alert:200" } ],
      [ { text:"OK", callback_data:"b:ok" }, { text:"⬅ Annuler", callback_data:"act:menu" } ]
    ])
  );
}

async function askPrompt(chatId, uid){
  const st = TMP.get(uid) || {};
  TMP.set(uid, { ...st, step:"prompt" });
  await tgSend(chatId,
    "Envoie le prompt principal (objectif, contraintes, livrables, etc.)",
    kb([[ { text:"⬅ Annuler", callback_data:"act:menu" } ]])
  );
}

function summarizeLocally(title, prompt){
  const lines = String(prompt||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const bullets = lines.map(l=>"- " + l).join("\n");
  return (
    "Titre: " + (title || "Projet") + "\n" +
    "Brief utilisateur:\n" + (bullets || "- (vide)")
  );
}

async function showConfirm(chatId, uid){
  const st = TMP.get(uid) || {};
  const sum = st.summary || summarizeLocally(st.title, st.prompt);
  TMP.set(uid, { ...st, step:"confirm", summary: sum });
  await tgSend(chatId,
    "Résumé compris :\n\n" + esc(sum) + "\n\nValider ?",
    kb([
      [ { text:"✅ Valider", callback_data:"sum:ok" }, { text:"✏️ Modifier", callback_data:"sum:edit" } ],
      [ { text:"⬅ Annuler", callback_data:"act:menu" } ]
    ])
  );
}

/* ==== Étape Secrets ==== */
async function askSecrets(chatId, uid){
  const txt =
    "Parfait. Maintenant, envoie-moi les <b>secrets</b> nécessaires dans ce format :\n\n" +
    "TELEGRAM_BOT_TOKEN=xxxx\n\n" +
    "💡 Pour l’écho-bot de test : <i>seul ce token est nécessaire</i>.\n" +
    "Si tu veux en savoir plus, clique sur le bouton ci-dessous.";
  TMP.set(uid, { ...(TMP.get(uid)||{}), step:"secrets" });
  await tgSend(chatId, txt, kb([
    [ { text:"❓ Où trouver les tokens ?", callback_data:"sec:help" } ],
    [ { text:"⬅️ Annuler", callback_data:"act:menu" } ]
  ]));
}

function parseTelegramTokenFromText(text){
  const m = /\bTELEGRAM_BOT_TOKEN\s*=\s*(\S+)/i.exec(String(text||""));
  return m ? m[1].trim() : null;
}

async function onTokenReceived(chatId, uid, tok){
  const st = TMP.get(uid) || {};
  TMP.set(uid, { ...st, echoTok: tok, step:"secrets" }); // on reste dans l’étape
  await tgSend(
    chatId,
    "✅ Token reçu. Prêt à générer « " + esc(st.title || "EchoBot") + " ». ",
    kb([[ { text:"🚀 Générer le projet", callback_data:"echo:gen" } ]])
  );
}

/* ==== Handlers texte & callbacks ==== */
async function handleText(chatId, uid, text){
  const st = TMP.get(uid);

  if (!st){ await showMenu(chatId); return; }

  if (st.step === "title"){
    const title = String(text||"").trim();
    if (!title){ await tgSend(chatId, "Envoie un titre valide."); return; }
    TMP.set(uid, { step:"budget", title });
    await tgSend(chatId, "Titre enregistré : <b>"+esc(title)+"</b>");
    await askBudget(chatId, uid);
    return;
  }

  if (st.step === "prompt"){
    const userPrompt = String(text||"").trim();
    const summary = summarizeLocally(st.title, userPrompt);
    TMP.set(uid, { ...st, step:"confirm", prompt: userPrompt, summary });
    await showConfirm(chatId, uid);
    return;
  }

  if (st.step === "secrets"){
    const tok = parseTelegramTokenFromText(text);
    if (tok){ await onTokenReceived(chatId, uid, tok); return; }
    await tgSend(chatId, "Format attendu :\nTELEGRAM_BOT_TOKEN=123:AA...");
    return;
  }

  await showMenu(chatId);
}

async function handleCallback(chatId, uid, data){
  const st = TMP.get(uid) || {};

  if (data === "act:menu"){ TMP.delete(uid); await showMenu(chatId); return; }
  if (data === "act:reset"){ TMP.delete(uid); await tgSend(chatId, "État réinitialisé."); await showMenu(chatId); return; }

  if (data === "act:new"){ await askTitle(chatId, uid); return; }
  if (data === "act:list"){ await tgSend(chatId, "📁 Projets (à venir)."); return; }
  if (data === "act:budget"){
    if (!st.title){ await askTitle(chatId, uid); return; }
    await askBudget(chatId, uid); return;
  }
  if (data === "act:secrets"){ await askSecrets(chatId, uid); return; }

  // Budget callbacks
  if (data.startsWith("b:")){
    const [,kind,val] = data.split(":");
    if (kind === "cap"){ TMP.set(uid, { ...st, capCents:Number(val) }); await tgSend(chatId,"Cap défini: "+(Number(val)/100).toFixed(2)+" €"); return; }
    if (kind === "alert"){ TMP.set(uid, { ...st, alertStepCents:Number(val) }); await tgSend(chatId,"Alerte par étape: "+(Number(val)/100).toFixed(2)+" €"); return; }
    if (kind === "ok"){ await askPrompt(chatId, uid); return; }
  }

  // Après résumé validé
  if (data === "sum:ok"){ await askSecrets(chatId, uid); return; }
  if (data === "sum:edit"){ await askPrompt(chatId, uid); return; }

  // Aide secrets
  if (data === "sec:help"){
    const guide =
      "🔑 <b>GUIDE DÉTAILLÉ : Où trouver les tokens ?</b>\n\n" +
      "1) <b>TELEGRAM_BOT_TOKEN</b> (obligatoire)\n" +
      " - Ouvre Telegram, parle à <i>@BotFather</i>\n" +
      " - /newbot -> nom -> identifiant -> copie le token (ex: 123:AA...)\n" +
      " - Colle ici : TELEGRAM_BOT_TOKEN=123:AA...\n\n" +
      "2) <b>OPENAI_API_KEY</b> (optionnelle) – si ton projet nécessite l’IA\n" +
      "3) <b>Upstash KV</b> (optionnel) – pour stockage persistant";
    await tgSend(chatId, guide); return;
  }

  // Génération (placeholder)
  if (data === "echo:gen"){
    await tgSend(chatId, "📦 ZIP (à venir). Le token saisi sera utilisé pour générer le projet d’écho-bot.");
    return;
  }

  await showMenu(chatId);
}

/* ==== Webhook (Vercel) ==== */
export default async function handler(req, res){
  if (req.method === "GET"){ res.status(200).send("OK"); return; }
  if (req.method !== "POST"){ res.status(405).json({ ok:false }); return; }

  try{
    const u = req.body || {};
    const msg = u.message;
    const cb  = u.callback_query;

    if (msg && msg.text){
      const chatId = msg.chat?.id;
      const fromId = msg.from?.id;
      if (!isAdmin(fromId)){ await tgSend(chatId,"❌ Accès refusé – bot privé."); return res.json({ok:true}); }
      if (msg.text === "/start"){ await showMenu(chatId); return res.json({ok:true}); }
      await handleText(chatId, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await tgSend(chatId,"❌ Accès refusé – bot privé."); return res.json({ok:true}); }
      await handleCallback(chatId, fromId, cb.data||"");
      await fetch(API + "/answerCallbackQuery", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ callback_query_id: cb.id })
      });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:false, error: String(e) });
  }
}
