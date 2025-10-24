/**
 * CreatorBotTG – minimal clean handler (CJS, ASCII only)
 * Objectif: remettre le webhook en etat de repondre /start et de gerer un flow titre -> prompt -> resume.
 */

const API = "https://api.telegram.org/bot" + (process.env.TELEGRAM_BOT_TOKEN || "");
const ADMIN = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

// Simple memoire volatile (suffisant pour tester la conversation en cours)
const TMP = new Map(); // key: userId -> { step, title, prompt, summary }

async function tgSend(chatId, text, extra){
  await fetch(API + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      ...(extra || {})
    })
  });
}

function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }
function esc(s){ return String(s||"").replace(/[<&>]/g, c => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;" }[c])); }
function isAdmin(uid){ return ADMIN ? String(uid) === ADMIN : true; }

async function showMenu(chatId){
  await tgSend(chatId,
    "CreatorBot-TG en ligne\nChoisis une action :",
    kb([
      [ { text:"Nouveau projet", callback_data:"act:new" }, { text:"Projets", callback_data:"act:list" } ],
      [ { text:"Budget", callback_data:"act:budget" }, { text:"Secrets", callback_data:"act:secrets" } ],
      [ { text:"Reset", callback_data:"act:reset" } ]
    ])
  );
}

async function askTitle(chatId, uid){
  TMP.set(uid, { step:"title" });
  await tgSend(chatId, "Titre du projet ?", kb([[ { text:"Annuler", callback_data:"act:menu" } ]]));
}

async function askPrompt(chatId, uid){
  const st = TMP.get(uid) || {};
  TMP.set(uid, { step:"prompt", title: st.title || "" });
  await tgSend(chatId, "Envoie le prompt principal (objectif, contraintes, livrables, etc.)",
    kb([[ { text:"Annuler", callback_data:"act:menu" } ]])
  );
}

async function showConfirm(chatId, uid){
  const st = TMP.get(uid) || {};
  const summary = st.summary || "(resume non disponible)";
  await tgSend(chatId,
    "Resume compris :\n\n" + esc(summary) + "\n\nValider ?",
    kb([
      [ { text:"Valider", callback_data:"sum:ok" }, { text:"Modifier", callback_data:"sum:edit" } ],
      [ { text:"Annuler", callback_data:"act:menu" } ]
    ])
  );
}

async function handleText(chatId, uid, text){
  const st = TMP.get(uid);
  if (!st){ await showMenu(chatId); return; }

  if (st.step === "title"){
    const title = String(text||"").trim();
    if (!title){ await tgSend(chatId, "Envoie un titre valide."); return; }
    TMP.set(uid, { step:"prompt", title:title });
    await tgSend(chatId, "Titre enregistre : <b>" + esc(title) + "</b>");
    await askPrompt(chatId, uid);
    return;
  }

  if (st.step === "prompt"){
    const prompt = String(text||"").trim();
    // Resume minimal deterministe pour test (pas d appel OpenAI ici)
    const summary = "Titre: " + (st.title || "Projet") + "\nBrief utilisateur:\n" + prompt;
    TMP.set(uid, { step:"confirm", title: st.title || "", prompt: prompt, summary: summary });
    await showConfirm(chatId, uid);
    return;
  }

  await showMenu(chatId);
}

async function handleCallback(chatId, uid, data){
  const st = TMP.get(uid) || {};

  if (data === "act:menu"){ TMP.delete(uid); await showMenu(chatId); return; }
  if (data === "act:reset"){ TMP.delete(uid); await tgSend(chatId, "Etat reinitialise."); await showMenu(chatId); return; }

  if (data === "act:new"){ await askTitle(chatId, uid); return; }
  if (data === "act:list"){ await tgSend(chatId, "Projets (a venir)."); return; }
  if (data === "act:budget"){ await tgSend(chatId, "Budget (a venir)."); return; }
  if (data === "act:secrets"){ await tgSend(chatId, "Secrets (a venir)."); return; }

  if (data === "sum:ok"){
    await tgSend(chatId, "OK, on continue (etape suivante a brancher).");
    TMP.set(uid, { step:"done", title: st.title || "", prompt: st.prompt || "", summary: st.summary || "" });
    return;
  }
  if (data === "sum:edit"){
    await askPrompt(chatId, uid);
    return;
  }

  await showMenu(chatId);
}

// HTTP handler (Vercel)
export default async function handler(req, res){
  if (req.method === "GET"){ res.status(200).send("OK"); return; }
  if (req.method !== "POST"){ res.status(405).json({ ok:false }); return; }

  try{
    const u = req.body || {};
    const msg = u.message;
    const cb  = u.callback_query;

    if (msg && msg.text){
      const chatId = msg.chat && msg.chat.id;
      const fromId = msg.from && msg.from.id;
      if (!isAdmin(fromId)){ await tgSend(chatId, "Acces refuse."); return res.json({ ok:true }); }
      if (msg.text === "/start"){ await showMenu(chatId); return res.json({ ok:true }); }
      await handleText(chatId, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message && cb.message.chat && cb.message.chat.id;
      const fromId = cb.from && cb.from.id;
      if (!isAdmin(fromId)){ await tgSend(chatId, "Acces refuse."); return res.json({ ok:true }); }
      await handleCallback(chatId, fromId, cb.data || "");
      await fetch(API + "/answerCallbackQuery", {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ callback_query_id: cb.id })
      });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:false, error: String(e) });
  }
}
