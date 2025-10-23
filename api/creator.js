import JSZip from "jszip";
import OpenAI from "openai";
import { getJSON, setJSON } from "./_kv.js";

const TG = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TG}`;
const FILE_API = `https://api.telegram.org/file/bot${TG}`;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function j(x){return JSON.stringify(x);}
async function tg(m,p){const r=await fetch(`${API}/${m}`,{method:"POST",headers:{"Content-Type":"application/json"},body:j(p)});return r.json().catch(()=>({}));}
async function sendText(id,t,ex={}){return tg("sendMessage",{chat_id:id,text:t,...ex});}
async function answerCb(cid,t="OK"){return tg("answerCallbackQuery",{callback_query_id:cid,text,show_alert:false});}
async function sendDoc(id,fname,buf,cap=""){const fd=new FormData();fd.append("chat_id",String(id));if(cap)fd.append("caption",cap);fd.append("document",new Blob([buf]),fname);return fetch(`${API}/sendDocument`,{method:"POST",body:fd});}

async function getState(cid){return (await getJSON(`chat:${cid}`,{phase:"idle"}))||{phase:"idle"};}
async function setState(cid,st){return setJSON(`chat:${cid}`,st);}
async function pushMeta(cid,m){const k=`projects:${cid}`;const l=(await getJSON(k,[]))||[];l.push(m);await setJSON(k,l);}
async function listProjects(cid){return (await getJSON(`projects:${cid}`,[]))||[];}

const MODEL = process.env.CREATOR_MODEL || "gpt-4o-mini";
const PRICE = { "gpt-4o-mini": 0.15, "gpt-3.5-turbo": 0.02 };
function costEUR(chars,model=MODEL){const per1k=PRICE[model]??0.15;const tokens=Math.max(1,Math.round(chars/4));return Number(((tokens/1000)*per1k).toFixed(4));}
async function ensureBudget(){const k=`budget:global`;const b=(await getJSON(k,null));if(!b){await setJSON(k,{spent:0,cap:10,step:1});return {spent:0,cap:10,step:1};}return b;}
async function addSpend(amount){const k=`budget:global`;const b=await ensureBudget();b.spent=Number((b.spent+amount).toFixed(4));await setJSON(k,b);return b;}
async function setCap(v){const k=`budget:global`;const b=await ensureBudget();b.cap=Math.max(0,Number(v)||0);await setJSON(k,b);return b;}
async function setStep(v){const k=`budget:global`;const b=await ensureBudget();b.step=Math.max(0,Number(v)||0);await setJSON(k,b);return b;}
async function resetSpent(){const k=`budget:global`;const b=await ensureBudget();b.spent=0;await setJSON(k,b);return b;}
async function getBudget(){return ensureBudget();}
function budgetText(b){return `Budget global\n- Dépensé: ${b.spent} €\n- Plafond: ${b.cap} €\n- Alerte: ${b.step} €`;}

// UI
function mainMenu(){return{reply_markup:{inline_keyboard:[
[{text:"🆕 Nouveau projet",callback_data:"act:new"},{text:"📦 ZIP",callback_data:"act:zip"}],
[{text:"📂 Projets",callback_data:"act:projects"}],
[{text:"🔑 Secrets",callback_data:"act:secrets"},{text:"💶 Dépenses",callback_data:"act:budget"}],
[{text:"🔄 Reset",callback_data:"act:reset"}]
]}};}
function confirmKb(){return{reply_markup:{inline_keyboard:[
[{text:"✅ Valider",callback_data:"act:confirm"}],
[{text:"✏️ Corriger le brief",callback_data:"act:edit"}],
[{text:"⬅️ Menu",callback_data:"act:menu"}]
]}};}
function budgetMenu(b){return{reply_markup:{inline_keyboard:[
[{text:"➕ Cap +1€",callback_data:"budg:cap+1"},{text:"➕ Cap +5€",callback_data:"budg:cap+5"}],
[{text:"➖ Cap -1€",callback_data:"budg:cap-1"},{text:"🔁 RAZ dépensé",callback_data:"budg:spent0"}],
[{text:"⏰ Alerte +1€",callback_data:"budg:step+1"},{text:"⏰ Alerte -1€",callback_data:"budg:step-1"}],
[{text:"✍️ Saisir Cap",callback_data:"budg:setcap"},{text:"✍️ Saisir Alerte",callback_data:"budg:setstep"}],
[{text:"⬅️ Retour",callback_data:"act:menu"}]
]}};}

// ZIP généré
async function genZip(project){
  const zip=new JSZip();
  const readme=`# ${project.title||"Bot Telegram"} (généré par CreatorBot-TG)

## Installation
1) Crée un projet Vercel.
2) Ajoute TELEGRAM_BOT_TOKEN (Production).
3) Déploie.
4) Webhook:
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<ton-domaine>/api/bot
5) Test: /start

## Brief
${project.brief||"(non fourni)"}
`;
  const bot=`export default async function handler(req,res){
  if(req.method!=="POST") return res.status(200).send("OK");
  try{
    const u=req.body; const m=u.message||u.edited_message||null; if(!m) return res.status(200).json({ok:true});
    const chatId=m.chat.id; const t=(m.text||"").trim();
    const token=process.env.TELEGRAM_BOT_TOKEN; const api="https://api.telegram.org/bot"+token;
    async function tg(x,p){const r=await fetch(api+"/"+x,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(p)});return r.json();}
    if(t==="/start"){await tg("sendMessage",{chat_id:chatId,text:"Bot en ligne. /help"});return res.status(200).json({ok:true});}
    if(t==="/help"){await tg("sendMessage",{chat_id:chatId,text:"Commandes: /start, /help"});return res.status(200).json({ok:true});}
    await tg("sendMessage",{chat_id:chatId,text:"Reçu: "+(t||"(non-texte)")});return res.status(200).json({ok:true});
  }catch(e){return res.status(200).json({ok:true,error:String(e)});}
}`;
  zip.file("README.md",readme);
  zip.file("package.json",`{"name":"bot-cible-genere","version":"1.0.0","private":true,"type":"module"}`);
  zip.folder("api").file("bot.js",bot);
  zip.file("vercel.json",`{"version":2,"routes":[{"src":"/api/bot","dest":"/api/bot.js"}]}`);
  return await zip.generateAsync({type:"uint8array"});
}
async function refineReadme(brief,base){
  if(!process.envOPENAI_API_KEY && !process.env.OPENAI_API_KEY) return base;
  const resp=await openai.chat.completions.create({model:MODEL,temperature:0.2,messages:[
    {role:"system",content:"Tu écris des README concis et actionnables pour bots Telegram sur Vercel."},
    {role:"user",content:`Brief:\n${brief}\n\nREADME:\n${base}\n\nAméliore sans rallonger inutilement.`}
  ]});
  const out=resp.choices?.[0]?.message?.content||base;
  await addSpend(costEUR(out.length,MODEL));
  return out;
}

// Flux
async function onStart(id){await sendText(id,"CreatorBot-TG en ligne ✅\nChoisis une action :",mainMenu());}
async function onNew(id){const st=await getState(id);st.project={id:`p${Date.now()}`,title:null,brief:null,files:[]};st.phase="ask_title";await setState(id,st);await sendText(id,"Titre du projet ?");}

async function onText(id,txt){
  const st=await getState(id);

  if(txt==="/start"||txt==="/menu") return onStart(id);

  if(st.phase==="ask_title"){
    st.project.title=txt.trim().slice(0,120);
    st.phase="ask_brief";await setState(id,st);
    return sendText(id,"Brief du projet ? (tu peux être concis)");
  }
  if(st.phase==="ask_brief"){
    st.project.brief=txt.trim();
    st.phase="confirm";await setState(id,st);
    const s=`Résumé :\n- Titre : ${st.project.title}\n- Brief : ${st.project.brief}\n\nValider pour générer le ZIP.`;
    return sendText(id,s,confirmKb());
  }
  if(st.phase==="set_cap"){
    const b=await setCap(txt.trim());
    const t=budgetText(b); st.phase="idle"; await setState(id,st);
    return sendText(id,t,budgetMenu(b));
  }
  if(st.phase==="set_step"){
    const b=await setStep(txt.trim());
    const t=budgetText(b); st.phase="idle"; await setState(id,st);
    return sendText(id,t,budgetMenu(b));
  }

  return sendText(id,"Utilise le menu ci-dessous.",mainMenu());
}

async function onDoc(id,doc){
  const st=await getState(id);
  if(st.phase!=="confirm" && st.phase!=="ask_brief" && st.phase!=="ask_title")
    return sendText(id,"Document reçu (hors flux). Lance un nouveau projet.",mainMenu());
  const r=await tg("getFile",{file_id:doc.file_id}); const fp=r?.result?.file_path;
  if(!fp) return sendText(id,"Impossible de récupérer le fichier.",confirmKb());
  const url=`${FILE_API}/${fp}`; st.project.files=st.project.files||[]; st.project.files.push({name:doc.file_name||"fichier",url}); await setState(id,st);
  return sendText(id,"Pièce jointe ajoutée: "+(doc.file_name||"fichier"),confirmKb());
}

async function onCb(cb){
  const id=cb.message.chat.id; const data=cb.data||""; const st=await getState(id);
  if(data.startsWith("act:")){
    const a=data.slice(4);
    if(a==="menu"){await answerCb(cb.id,"Menu");return onStart(id);}
    if(a==="new"){await answerCb(cb.id,"Nouveau projet");return onNew(id);}
    if(a==="projects"){await answerCb(cb.id,"Projets");const l=await listProjects(id);if(!l.length)return sendText(id,"Aucun projet pour l’instant.",mainMenu());return sendText(id,l.map((p,i)=>`${i+1}. ${p.title}`).join("\n"),mainMenu());}
    if(a==="secrets"){await answerCb(cb.id,"Secrets");const names=Object.keys(process.env).filter(k=>k.endsWith("_API_KEY")||k.endsWith("_BOT_TOKEN"));return sendText(id,"Noms de secrets:\n"+(names.join("\n")||"(aucun)"),mainMenu());}
    if(a==="budget"){await answerCb(cb.id,"Budget");const b=await getBudget();return sendText(id,budgetText(b),budgetMenu(b));}
    if(a==="reset"){await answerCb(cb.id,"Reset");await setJSON(`chat:${id}`,{phase:"idle"});return sendText(id,"Réinitialisé.",mainMenu());}
    if(a==="zip"){
      await answerCb(cb.id,"ZIP");
      const l=await listProjects(id);const last=l[l.length-1]||st.project;
      if(!last||!last.title) return sendText(id,"Aucun projet disponible.",mainMenu());
      let buf=await genZip(last);
      const z1=await JSZip.loadAsync(buf);const z2=new JSZip();
      for(const n of Object.keys(z1.files)){const f=z1.files[n];const c=await f.async("uint8array");z2.file(n,c);}
      buf=await z2.generateAsync({type:"uint8array"});
      await sendDoc(id,`${last.title||"projet"}-squelette.zip`,buf,"Archive prête à déployer.");
      return;
    }
  }
  if(data==="act:confirm"||data==="act:edit"){} // compat
  if(data.startsWith("budg:")){
    const op=data.slice(5);
    if(op==="setcap"){await answerCb(cb.id,"Saisir Cap");st.phase="set_cap";await setState(id,st);return sendText(id,"Envoie la nouvelle valeur du *Plafond* en euros (nombre).");}
    if(op==="setstep"){await answerCb(cb.id,"Saisir Alerte");st.phase="set_step";await setState(id,st);return sendText(id,"Envoie la nouvelle valeur de *l'alerte* en euros (nombre).");}
    if(op==="spent0"){await answerCb(cb.id,"RAZ dépensé");const b=await resetSpent();return sendText(id,budgetText(b),budgetMenu(b));}
    if(/^cap[+\-]\d+$/.test(op)){const delta=Number(op.replace("cap",""));const b=await getBudget();b.cap=Math.max(0,Number((b.cap+delta).toFixed(2)));await setJSON(`budget:global`,b);await answerCb(cb.id,"Cap modifié");return sendText(id,budgetText(b),budgetMenu(b));}
    if(/^step[+\-]\d+$/.test(op)){const delta=Number(op.replace("step",""));const b=await getBudget();b.step=Math.max(0,Number((b.step+delta).toFixed(2)));await setJSON(`budget:global`,b);await answerCb(cb.id,"Alerte modifiée");return sendText(id,budgetText(b),budgetMenu(b));}
  }
  if(data==="act:confirm"||data==="confirm"||data==="act:confirm_project"){
    await answerCb(cb.id,"Validation…");
    const proj=st.project; if(!proj?.title) return sendText(id,"Projet incomplet.",mainMenu());
    let buf=await genZip(proj);
    const refined=await refineReadme(proj.brief||"","README généré.");
    const z1=await JSZip.loadAsync(buf);const z2=new JSZip();
    for(const n of Object.keys(z1.files)){
      const f=z1.files[n];const c=await f.async("uint8array");
      if(n==="README.md") z2.file(n,new TextEncoder().encode(refined)); else z2.file(n,c);
    }
    buf=await z2.generateAsync({type:"uint8array"});
    await sendDoc(id,`${proj.title||"projet"}-squelette.zip`,buf,"Archive prête à déployer.");
    await pushMeta(id,{title:proj.title,brief:proj.brief,files:proj.files||[],ts:Date.now()});
    st.phase="idle";await setState(id,st);
    return sendText(id,"Projet livré ✅",mainMenu());
  }
  if(data==="act:edit"||data==="edit"){
    await answerCb(cb.id,"Corriger");
    st.phase="ask_brief";await setState(id,st);
    return sendText(id,"Envoie le nouveau brief.");
  }
  await answerCb(cb.id,"OK");
}

export default async function handler(req,res){
  try{
    if(req.method!=="POST") return res.status(200).send("OK");
    const u=req.body||{};
    const m=u.message||u.edited_message||null;
    if(m){
      const id=m.chat.id;
      if(m.text){await onText(id,m.text.trim());return res.status(200).json({ok:true});}
      if(m.document){await onDoc(id,m.document);return res.status(200).json({ok:true});}
      await sendText(id,"Message non géré.",mainMenu());return res.status(200).json({ok:true});
    }
    if(u.callback_query){await onCb(u.callback_query);return res.status(200).json({ok:true});}
    return res.status(200).json({ok:true});
  }catch(e){return res.status(200).json({ok:true,error:String(e)});}
}
