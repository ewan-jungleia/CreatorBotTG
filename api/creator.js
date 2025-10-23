import JSZip from "jszip";
import OpenAI from "openai";
import { getJSON, setJSON } from "./_kv.js";

const TG = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TG}`;
const FILE_API = `https://api.telegram.org/file/bot${TG}`;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function j(x){ return JSON.stringify(x); }
async function tg(m,p){ const r=await fetch(`${API}/${m}`,{method:"POST",headers:{"Content-Type":"application/json"},body:j(p)}); return r.json().catch(()=>({})); }
async function sendMessage(chat_id,text,opts={}){ return tg("sendMessage",{chat_id,text,parse_mode:"Markdown",...opts}); }
async function answerCb(id,text){ return tg("answerCallbackQuery",{callback_query_id:id,text,show_alert:false}); }
async function sendDocument(chat_id,filename,buffer,caption=""){ const f=new FormData(); f.append("chat_id",String(chat_id)); f.append("caption",caption); f.append("document",new Blob([buffer]),filename); const r=await fetch(`${API}/sendDocument`,{method:"POST",body:f}); return r.json(); }

async function getState(chatId){ return (await getJSON(`chat:${chatId}`,{phase:"idle"})) || {phase:"idle"}; }
async function setState(chatId,st){ return setJSON(`chat:${chatId}`,st); }

const MODEL = process.env.CREATOR_MODEL || "gpt-4o-mini";
const PRICE = { "gpt-4o-mini": 0.15, "gpt-3.5-turbo": 0.02 };
function costEUR(chars,model=MODEL){ const per1k = PRICE[model] ?? 0.15; const tokens = Math.max(1, Math.round(chars/4)); return Number(((tokens/1000)*per1k).toFixed(4)); }
async function addSpend(projectId, amount){ const key=`budget:${projectId}`; const cur=(await getJSON(key,{spent:0,cap:10,step:1}))||{spent:0,cap:10,step:1}; cur.spent=Number((cur.spent+amount).toFixed(4)); await setJSON(key,cur); return cur; }
async function budgetText(projectId){ const b=await getJSON(`budget:${projectId}`,{spent:0,cap:10,step:1}); return `Budget *${projectId}*\n- Dépensé: *${b.spent} €*\n- Plafond: *${b.cap} €*\n- Alerte: *${b.step} €*`; }

async function ensureProject(chatId){ const st=await getState(chatId); if(!st.project) st.project={id:`p${Date.now()}`,title:null,brief:null,files:[]}; await setState(chatId,st); return st; }
async function pushProjectMeta(chatId, meta){ const key=`projects:${chatId}`; const list=(await getJSON(key,[]))||[]; list.push(meta); await setJSON(key,list); }
async function listProjects(chatId){ return (await getJSON(`projects:${chatId}`,[]))||[]; }

function kb(rows){ return { reply_markup:{ inline_keyboard: rows } }; }

async function generateTargetZip(project){
  const zip = new JSZip();
  const readme = `# ${project.title || "Bot Telegram"} (généré par CreatorBot-TG)

## Installation
1) Crée un projet Vercel.
2) Ajoute TELEGRAM_BOT_TOKEN en Production.
3) Déploie.
4) Configure le webhook:
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<ton-domaine>/api/bot
5) Test: /start

## Brief
${project.brief || "(non fourni)"}
`;
  const botJs = `export default async function handler(req,res){
  if(req.method!=="POST") return res.status(200).send("OK");
  try{
    const u=req.body; const m=u.message||u.edited_message||null; if(!m) return res.status(200).json({ok:true});
    const chatId=m.chat.id; const t=(m.text||"").trim();
    const token=process.env.TELEGRAM_BOT_TOKEN; const api="https://api.telegram.org/bot"+token;
    async function tg(x,p){ const r=await fetch(api+"/"+x,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)}); return r.json(); }
    if(t==="/start"){ await tg("sendMessage",{chat_id:chatId,text:"Bot en ligne. /help"}); return res.status(200).json({ok:true}); }
    if(t==="/help"){ await tg("sendMessage",{chat_id:chatId,text:"Commandes: /start, /help"}); return res.status(200).json({ok:true}); }
    await tg("sendMessage",{chat_id:chatId,text:"Reçu: "+(t||"(non-texte)")}); return res.status(200).json({ok:true});
  }catch(e){ return res.status(200).json({ok:true,error:String(e)}); }
}`;
  const vercelTgt = `{"version":2,"routes":[{"src":"/api/bot","dest":"/api/bot.js"}]}`
  const pkgTgt = `{"name":"bot-cible-genere","version":"1.0.0","private":true,"type":"module"}`;
  zip.file("README.md", readme);
  zip.file("package.json", pkgTgt);
  zip.folder("api").file("bot.js", botJs);
  zip.file("vercel.json", vercelTgt);
  const buffer = await zip.generateAsync({ type:"uint8array" });
  return buffer;
}

async function refineReadme(brief, base){
  if(!process.env.OPENAI_API_KEY) return base;
  const chat = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {role:"system",content:"Tu écris des README concis et actionnables pour bots Telegram sur Vercel."},
      {role:"user",content:`Brief:\n${brief}\n\nREADME:\n${base}\n\nAméliore la clarté, garde les étapes et évite le blabla.`}
    ],
    temperature:0.2
  });
  const out = chat.choices?.[0]?.message?.content || base;
  await addSpend("global", costEUR(out.length, MODEL));
  return out;
}

async function onStart(chatId){
  const admin = process.env.ADMIN_TELEGRAM_ID ? `\nAdmin: ${process.env.ADMIN_TELEGRAM_ID}` : "";
  const txt = ["CreatorBot-TG en ligne ✅","Commandes:","/nouveau_projet","/projets","/zip","/secrets","/budget 10 1","/dépenses","/reset"].join("\n")+admin;
  await sendMessage(chatId, txt);
}
async function onNewProject(chatId){ const st=await ensureProject(chatId); st.phase="ask_title"; await setState(chatId,st); await sendMessage(chatId,"Titre du projet ?"); }

async function onText(chatId,text){
  const st=await getState(chatId);

  if(text==="/start") return onStart(chatId);
  if(text==="/nouveau_projet") return onNewProject(chatId);

  if(text==="/projets"){
    const list = await listProjects(chatId);
    if(!list.length) return sendMessage(chatId,"Aucun projet enregistré pour l’instant.");
    const lines = list.map((p,i)=>`${i+1}. ${p.title} — ${new Date(p.ts).toLocaleString()}`);
    return sendMessage(chatId, "*Projets:*\n"+lines.join("\n"));
  }

  if(text==="/zip"){
    const list = await listProjects(chatId);
    const last = list[list.length-1];
    const proj = last ? { title:last.title, brief:last.brief||"", files:last.files||[] } : (st.project||null);
    if(!proj || !proj.title) return sendMessage(chatId,"Aucun projet disponible. Lance /nouveau_projet.");
    let zipBuffer = await generateTargetZip(proj);
    const refined = await refineReadme(proj.brief||"", "README généré.");
    const z2=new JSZip(), z1=await JSZip.loadAsync(zipBuffer);
    for(const e of Object.keys(z1.files)){ const f=z1.files[e]; const c=await f.async("uint8array"); if(e==="README.md") z2.file(e,new TextEncoder().encode(refined)); else z2.file(e,c); }
    zipBuffer = await z2.generateAsync({ type:"uint8array" });
    await sendDocument(chatId, `${proj.title||"projet"}-squelette.zip`, zipBuffer, "Archive régénérée.");
    return;
  }

  if(text==="/secrets"){
    const names=Object.keys(process.env).filter(k=>k.endsWith("_API_KEY")||k.endsWith("_BOT_TOKEN"));
    return sendMessage(chatId,"Noms de secrets: "+(names.join(", ")||"(aucun)"));
  }

  if(text.startsWith("/budget")){
    const p=text.split(/\s+/); const cap=Number(p[1]||"10"), step=Number(p[2]||"1");
    await setJSON("budget:global",{spent:0,cap,step});
    return sendMessage(chatId, await budgetText("global"));
  }

  if(text==="/dépenses"){
    return sendMessage(chatId, await budgetText("global"));
  }

  if(text==="/reset"){
    await setJSON(`chat:${chatId}`, { phase:"idle" });
    return sendMessage(chatId,"Contexte réinitialisé.");
  }

  if(st.phase==="ask_title"){
    st.project=st.project||{id:`p${Date.now()}`};
    st.project.title=text.trim().slice(0,120);
    st.phase="ask_brief"; await setState(chatId,st);
    return sendMessage(chatId,"Brief du projet ? (texte)");
  }

  if(st.phase==="ask_brief"){
    st.project.brief=text.trim();
    st.phase="await_files_or_confirm"; await setState(chatId,st);
    const sum=["Résumé:","- Titre: "+st.project.title,"- Brief: "+(st.project.brief.substring(0,400))+(st.project.brief.length>400?"…":""),"Ajoute des fichiers si besoin puis valide."].join("\n");
    return sendMessage(chatId,sum, kb([[{text:"Valider",callback_data:"confirm_project"}],[{text:"Corriger le brief",callback_data:"edit_brief"}]]));
  }

  return sendMessage(chatId,"Reçu.");
}

async function onDocument(chatId,doc){
  const st=await getState(chatId);
  if(st.phase!=="await_files_or_confirm") return sendMessage(chatId,"Document reçu (hors flux). Utilise /nouveau_projet.");
  const r=await tg("getFile",{file_id:doc.file_id}); const fp=r?.result?.file_path; if(!fp) return sendMessage(chatId,"Impossible de récupérer le fichier.");
  const url = `${FILE_API}/${fp}`; st.project.files=st.project.files||[]; st.project.files.push({name:doc.file_name||"fichier",url}); await setState(chatId,st);
  return sendMessage(chatId,"Pièce jointe ajoutée: "+(doc.file_name||"fichier"));
}

async function onCallbackQuery(cb){
  const id=cb.id; const data=cb.data; const chatId=cb.message?.chat?.id; const st=await getState(chatId);

  if(data==="edit_brief"){ st.phase="ask_brief"; await setState(chatId,st); await answerCb(id,"Modifie le brief."); return sendMessage(chatId,"Envoie le nouveau brief."); }

  if(data==="confirm_project"){
    await answerCb(id,"Validation…");
    let zipBuffer = await generateTargetZip(st.project);
    const refined = await refineReadme(st.project.brief||"", "README généré.");
    const z2=new JSZip(), z1=await JSZip.loadAsync(zipBuffer);
    for(const e of Object.keys(z1.files)){ const f=z1.files[e]; const c=await f.async("uint8array"); if(e==="README.md") z2.file(e,new TextEncoder().encode(refined)); else z2.file(e,c); }
    zipBuffer = await z2.generateAsync({ type:"uint8array" });
    await sendDocument(chatId, `${st.project.title||"projet"}-squelette.zip`, zipBuffer, "Archive prête à déployer.");
    await pushProjectMeta(chatId, { title: st.project.title, brief: st.project.brief, files: st.project.files||[], ts: Date.now() });
    st.phase="idle"; await setState(chatId,st);
    return;
  }

  return answerCb(id,"OK");
}

export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(200).send("OK");
    const u=req.body;
    const m=u.message||u.edited_message||null;
    if(m){
      const chatId=m.chat.id;
      if(m.text){ await onText(chatId, m.text.trim()); return res.status(200).json({ok:true}); }
      if(m.document){ await onDocument(chatId, m.document); return res.status(200).json({ok:true}); }
      await sendMessage(chatId,"Type non géré."); return res.status(200).json({ok:true});
    }
    const cb=u.callback_query||null;
    if(cb){ await onCallbackQuery(cb); return res.status(200).json({ok:true}); }
    return res.status(200).json({ok:true});
  }catch(e){ return res.status(200).json({ok:true,error:String(e)}); }
}
