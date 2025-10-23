// --- version corrigée flux assistant complet ---
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
async function answerCb(id,t){return tg("answerCallbackQuery",{callback_query_id:id,text,show_alert:false});}
async function sendDoc(id,fname,buf,cap=""){const fd=new FormData();fd.append("chat_id",id);if(cap)fd.append("caption",cap);fd.append("document",new Blob([buf]),fname);return fetch(`${API}/sendDocument`,{method:"POST",body:fd});}

async function getState(cid){return (await getJSON(`chat:${cid}`,{phase:"idle"}))||{phase:"idle"};}
async function setState(cid,st){return setJSON(`chat:${cid}`,st);}
async function pushMeta(cid,m){const k=`projects:${cid}`;const l=(await getJSON(k,[]))||[];l.push(m);await setJSON(k,l);}
async function listProjects(cid){return (await getJSON(`projects:${cid}`,[]))||[];}

function menu(){return{reply_markup:{inline_keyboard:[
[{text:"🆕 Nouveau projet",callback_data:"new"},{text:"📦 ZIP",callback_data:"zip"}],
[{text:"📂 Projets",callback_data:"projects"}],
[{text:"🔑 Secrets",callback_data:"secrets"},{text:"💶 Dépenses",callback_data:"expenses"}],
[{text:"🔄 Reset",callback_data:"reset"}]]}};}
function confirmKb(){return{reply_markup:{inline_keyboard:[
[{text:"✅ Valider",callback_data:"confirm"}],
[{text:"✏️ Corriger le brief",callback_data:"edit"}],
[{text:"⬅️ Menu",callback_data:"menu"}]]}};}

async function onStart(id){await sendText(id,"CreatorBot-TG en ligne ✅\nChoisis une action :",menu());}
async function onNew(id){const st=await getState(id);st.project={id:`p${Date.now()}`};st.phase="ask_title";await setState(id,st);await sendText(id,"Titre du projet ?");}

async function onText(cid,txt){
  const st=await getState(cid);
  if(txt==="/start"||txt==="/menu")return onStart(cid);

  if(st.phase==="ask_title"){
    st.project.title=txt.trim().slice(0,120);
    st.phase="ask_brief";await setState(cid,st);
    return sendText(cid,"Brief du projet ? (décris le concept ou ce que tu veux créer)");
  }

  if(st.phase==="ask_brief"){
    st.project.brief=txt.trim();
    st.phase="confirm";await setState(cid,st);
    const s=`Résumé du projet :\n- Titre : ${st.project.title}\n- Brief : ${st.project.brief}\n\nValide pour générer le ZIP.`;
    return sendText(cid,s,confirmKb());
  }

  return sendText(cid,"Commande non reconnue. Utilise le menu :",menu());
}

async function onCb(cb){
  const id=cb.message.chat.id;const data=cb.data;const st=await getState(id);
  if(data==="menu")return onStart(id);
  if(data==="new")return onNew(id);
  if(data==="projects"){const l=await listProjects(id);if(!l.length)return sendText(id,"Aucun projet pour l’instant.",menu());return sendText(id,l.map((p,i)=>`${i+1}. ${p.title}`).join("\n"),menu());}
  if(data==="zip"){const l=await listProjects(id);if(!l.length)return sendText(id,"Aucun projet.",menu());return sendText(id,"ZIP: pas encore implémenté (OK).",menu());}
  if(data==="reset"){await setJSON(`chat:${id}`,{phase:"idle"});return sendText(id,"Réinitialisé.",menu());}
  if(data==="edit"){st.phase="ask_brief";await setState(id,st);return sendText(id,"Envoie le nouveau brief.");}
  if(data==="confirm"){await sendText(id,`Projet “${st.project.title}” validé ✅\nZIP en préparation...`,menu());await pushMeta(id,{title:st.project.title,brief:st.project.brief,ts:Date.now()});st.phase="idle";await setState(id,st);}
}

export default async function handler(req,res){
  if(req.method!=="POST")return res.status(200).send("OK");
  const u=req.body;
  if(u.message){const m=u.message;const id=m.chat.id;if(m.text)return onText(id,m.text.trim());}
  if(u.callback_query)return onCb(u.callback_query);
  res.status(200).json({ok:true});
}
