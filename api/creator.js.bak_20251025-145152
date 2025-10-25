/**
 * CreatorBotTG — handler complet (ESM, Vercel)
 * Flow:
 *  /start -> menu
 *  🆕 Nouveau projet -> Titre -> 💰 Budget -> Prompt
 *  -> Résumé (Valider/Modifier) -> Plan IA
 *  -> Secrets -> Générer le projet (ZIP)
 */

const API = "https://api.telegram.org/bot" + (process.env.TELEGRAM_BOT_TOKEN || "");
const ADMIN = String(process.env.ADMIN_TELEGRAM_ID || "").trim();

function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }
function esc(s){ return String(s||"").replace(/[<&>]/g, c => ({ "<":"&lt;","&":"&amp;",">":"&gt;" }[c])); }
function isAdmin(uid){ return ADMIN ? String(uid)===ADMIN : true; }

async function tgSend(chatId, text, extra){
  await fetch(API+"/sendMessage",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id:chatId, text, parse_mode:"HTML", ...(extra||{}) })
  });
}

async function tgSendDoc(chatId, filename, buf){
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([buf]), filename);
  await fetch(API+"/sendDocument",{ method:"POST", body: form });
}

/* Mémoire simple */
const TMP = new Map(); // uid -> { step,title,capCents,alertStepCents,prompt,summary,plan,echoTok }

/* UI */
async function showMenu(chatId){
  await tgSend(chatId,
    "CreatorBot-TG en ligne ✅\nChoisis une action :",
    kb([
      [ {text:"🆕 Nouveau projet",callback_data:"act:new"}, {text:"📁 Projets",callback_data:"act:list"} ],
      [ {text:"💰 Budget",callback_data:"act:budget"}, {text:"🔑 Secrets",callback_data:"act:secrets"} ],
      [ {text:"♻️ Reset",callback_data:"act:reset"} ]
    ])
  );
}

async function askTitle(chatId, uid){
  TMP.set(uid,{ step:"title" });
  await tgSend(chatId,"Titre du projet ?", kb([[{text:"⬅ Retour menu",callback_data:"act:menu"}]]));
}

async function askBudget(chatId, uid){
  const st = TMP.get(uid)||{};
  const title = st.title || "";
  TMP.set(uid,{ ...st, step:"budget" });
  await tgSend(chatId, "💰 Budget pour <b>"+esc(title)+"</b>", kb([
    [ {text:"Cap 10€",callback_data:"b:cap:1000"}, {text:"Cap 20€",callback_data:"b:cap:2000"} ],
    [ {text:"Alerte 1€",callback_data:"b:alert:100"}, {text:"Alerte 2€",callback_data:"b:alert:200"} ],
    [ {text:"OK",callback_data:"b:ok"}, {text:"⬅ Annuler",callback_data:"act:menu"} ]
  ]));
}

async function askPrompt(chatId, uid){
  const st = TMP.get(uid)||{};
  TMP.set(uid,{ ...st, step:"prompt" });
  await tgSend(chatId,"Envoie le prompt principal (objectif, contraintes, livrables, etc.)", kb([[{text:"⬅ Annuler",callback_data:"act:menu"}]]));
}

/* Résumé: IA si clé présente, sinon fallback local */
function summarizeLocally(title,prompt){
  const lines = String(prompt||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const bullets = lines.map(l=>"- "+l).join("\n") || "- (vide)";
  return "Titre: "+(title||"Projet")+"\nBrief utilisateur:\n"+bullets;
}
async function summarizeSmart(title,prompt){
  if (!process.env.OPENAI_API_KEY) return summarizeLocally(title,prompt);
  try{
    const sys = "Résume en français, concis, en listes à puces claires. Ne répète pas mot à mot, reformule.";
    const usr = `Titre: ${title||"Projet"}\nBrief utilisateur:\n${prompt||""}`;
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature:0.3,
        messages:[ {role:"system",content:sys}, {role:"user",content:usr} ] })
    });
    const j = await r.json();
    const out = j?.choices?.[0]?.message?.content?.trim();
    return out || summarizeLocally(title,prompt);
  }catch{ return summarizeLocally(title,prompt); }
}

async function showConfirm(chatId, uid){
  const st = TMP.get(uid)||{};
  const sum = st.summary || summarizeLocally(st.title, st.prompt);
  TMP.set(uid,{ ...st, step:"confirm", summary: sum });
  await tgSend(chatId, "Résumé compris :\n\n"+esc(sum)+"\n\nValider ?", kb([
    [ {text:"✅ Valider",callback_data:"sum:ok"}, {text:"✏️ Modifier",callback_data:"sum:edit"} ],
    [ {text:"⬅ Annuler",callback_data:"act:menu"} ]
  ]));
}

/* Plan IA: si pas de clé -> fallback structuré */
async function buildPlan(title, prompt){
  if (!process.env.OPENAI_API_KEY){
    const bullets = String(prompt||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,6).map(x=>"– "+x).join("\n") || "– (aucun point saisi)";
    return [
      "**Faisabilité**",
      "• Tech : Node.js + Telegram Bot API (fetch).",
      "• Hébergement : Vercel.",
      "• Risques : quotas API, secrets, droits du bot.",
      "",
      "**Plan stratégique (phases)**",
      "1) Init (repo, env, secrets)",
      "2) Webhook Telegram",
      "3) Écho minimal",
      "4) Déploiement & test",
      "5) README + ZIP",
      "",
      "**Besoins (secrets)**",
      "• TELEGRAM_BOT_TOKEN",
      "• (optionnel) OPENAI_API_KEY",
      "",
      "**Brief compressé**",
      bullets
    ].join("\n");
  }
  const sys = "Tu es un architecte logiciel Telegram. Réponds en français, clair, avec titres en **gras** et listes. Donne: Faisabilité, Plan stratégique (phases), Plan d'action (tâches), Besoins (inputs & secrets), Livrables (code, README, déploiement).";
  const usr = `Titre: ${title||"Projet"}\nBrief utilisateur:\n${prompt||""}`;
  try{
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature:0.3,
        messages:[ {role:"system",content:sys}, {role:"user",content:usr} ] })
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || "Plan non disponible.";
  }catch{
    return "Plan non disponible (fallback).";
  }
}

/* Étape secrets */
async function askSecrets(chatId, uid){
  TMP.set(uid,{ ...(TMP.get(uid)||{}), step:"secrets" });
  const txt = [
    "Parfait. Maintenant, envoie-moi les <b>secrets</b> dans ce format :",
    "",
    "TELEGRAM_BOT_TOKEN=xxxx",
    "",
    "💡 Pour l’écho-bot de test : <i>seul ce token est nécessaire</i>.",
    "Si tu veux en savoir plus, clique ci-dessous."
  ].join("\n");
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
  const st = TMP.get(uid)||{};
  TMP.set(uid,{ ...st, echoTok:tok, step:"secrets" });
  await tgSend(chatId,
    "✅ Token reçu. Prêt à générer « "+esc(st.title||"EchoBot")+" ». ",
    kb([[ { text:"🚀 Générer le projet", callback_data:"echo:gen" } ]])
  );
}

/* Génération ZIP */
import { buildEchoBotZip } from "./builder.js";

/* Handlers */
async function handleText(chatId, uid, text){
  const st = TMP.get(uid);
  if (!st){ await showMenu(chatId); return; }

  if (st.step==="title"){
    const title = String(text||"").trim();
    if (!title){ await tgSend(chatId,"Envoie un titre valide."); return; }
    TMP.set(uid,{ step:"budget", title });
    await tgSend(chatId,"Titre enregistré : <b>"+esc(title)+"</b>");
    await askBudget(chatId, uid);
    return;
  }

  if (st.step==="prompt"){
    const userPrompt = String(text||"").trim();
    await tgSend(chatId,"Je rédige un résumé…");
    const summary = await summarizeSmart(st.title, userPrompt);
    TMP.set(uid,{ ...st, step:"confirm", prompt:userPrompt, summary });
    await showConfirm(chatId, uid);
    return;
  }

  if (st.step==="secrets"){
    const tok = parseTelegramTokenFromText(text);
    if (tok){ await onTokenReceived(chatId, uid, tok); return; }
    await tgSend(chatId,"Format attendu :\nTELEGRAM_BOT_TOKEN=123:AA...");
    return;
  }

  await showMenu(chatId);
}

async function handleCallback(chatId, uid, data){
  const st = TMP.get(uid)||{};
  if (data==="act:menu"){ await showMenu(chatId); return; }
  if (data==="act:new"){ await askTitle(chatId, uid); return; }
  if (data==="act:reset"){ TMP.delete(uid); await tgSend(chatId,"État réinitialisé."); await showMenu(chatId); return; }
  if (data==="act:list"){ await tgSend(chatId,"Projets (à venir)."); return; }
  if (data==="act:budget"){ await askBudget(chatId, uid); return; }
  if (data==="act:secrets"){ await askSecrets(chatId, uid); return; }

  if (data.startsWith("b:")){
    const [, kind, val] = data.split(":");
    if (kind==="cap"){ TMP.set(uid,{ ...st, capCents:Number(val) }); await tgSend(chatId,"Cap défini: "+(Number(val)/100).toFixed(2)+" €"); }
    if (kind==="alert"){ TMP.set(uid,{ ...st, alertStepCents:Number(val) }); await tgSend(chatId,"Alerte par étape: "+(Number(val)/100).toFixed(2)+" €"); }
    if (kind==="ok"){ await askPrompt(chatId, uid); }
    return;
  }

  if (data==="sum:edit"){ TMP.set(uid,{ ...st, step:"prompt" }); await askPrompt(chatId, uid); return; }

  if (data==="sum:ok"){
    await tgSend(chatId,"Je prépare la faisabilité et le plan…");
    const plan = await buildPlan(st.title, st.prompt);
    TMP.set(uid,{ ...st, step:"plan", plan });
    await tgSend(chatId, `**Faisabilité & Plan pour ${esc(st.title||"Projet")}**\n\n${plan}`, kb([
      [ { text:"✅ Continuer", callback_data:"plan:ok" } ],
      [ { text:"✏️ Modifier le brief", callback_data:"sum:edit" } ],
      [ { text:"⬅️ Annuler", callback_data:"act:menu" } ]
    ]));
    return;
  }

  if (data==="plan:ok"){ await askSecrets(chatId, uid); return; }

  if (data==="sec:help"){
    await tgSend(chatId, [
      "🔑 <b>Où trouver les tokens ?</b>",
      "",
      "1) <b>TELEGRAM_BOT_TOKEN</b> (obligatoire)",
      "   • Ouvre Telegram et parle à <a href=\"https://t.me/BotFather\">@BotFather</a>.",
      "   • Envoie <code>/newbot</code> → choisis un nom → un identifiant unique.",
      "   • Copie le token affiché (ex: <code>123456789:AA...</code>).",
      "   • Colle ici sous la forme : <code>TELEGRAM_BOT_TOKEN=123456789:AA...</code>",
      "",
      "2) <b>OPENAI_API_KEY</b> (optionnel, pour résumé/plan IA)",
      "   • Va sur <a href=\"https://platform.openai.com/\">platform.openai.com</a> → View API Keys.",
      "   • Copie la clé → (tu peux l’enregistrer plus tard côté Vercel).",
      "",
      "3) <b>Upstash KV</b> (optionnel, stockage)",
      "   • <a href=\"https://upstash.com/\">upstash.com</a> → Redis REST API → copie l’URL & le Token.",
      "",
      "📌 Pour l’écho-bot de test : seul <b>TELEGRAM_BOT_TOKEN</b> suffit."
    ].join("\n"), kb([[{text:"⬅️ Annuler",callback_data:"act:menu"}]]));
    return;
  }

  if (data==="echo:gen"){
    try{
      const buf = await buildEchoBotZip(TMP.get(uid)?.echoTok || "");
      await tgSendDoc(chatId, "echo-bot.zip", buf);
    }catch(e){
      await tgSend(chatId, "📦 ZIP (à venir). Le token saisi sera utilisé pour générer le projet d’écho-bot.");
    }
    return;
  }

  await showMenu(chatId);
}

/* === Webhook handler === */
export default async function handler(req, res){
  try{
    if (req.method !== "POST"){ return res.status(200).json({ ok:true }); }
    const u = req.body || {};
    const msg = u.message;
    const cb  = u.callback_query;

    if (msg && msg.text){
      const chatId = msg.chat?.id;
      const fromId = msg.from?.id;
      if (!isAdmin(fromId)){ await tgSend(chatId,"❌ Accès refusé – bot privé."); return res.json({ok:true}); }
      if (msg.text === "/start"){ await showMenu(chatId); return res.json({ok:true}); }
      if (msg.text === "/diag"){ await showMenu(chatId); return res.json({ok:true}); }
      await handleText(chatId, fromId, msg.text);
      return res.json({ ok:true });
    }

    if (cb){
      const chatId = cb.message?.chat?.id;
      const fromId = cb.from?.id;
      if (!isAdmin(fromId)){ await tgSend(chatId,"❌ Accès refusé – bot privé."); return res.json({ok:true}); }
      await handleCallback(chatId, fromId, cb.data||"");
      await fetch(API+"/answerCallbackQuery",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ callback_query_id: cb.id }) });
      return res.json({ ok:true });
    }

    return res.json({ ok:true });
  }catch(e){
    return res.status(200).json({ ok:false, error:String(e) });
  }
}
