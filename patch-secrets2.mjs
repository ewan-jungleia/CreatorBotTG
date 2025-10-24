import { readFile, writeFile } from "node:fs/promises";

const FILE = "api/creator.js";
let s = await readFile(FILE, "utf8");

// Ajoute un mini util kb() si absent (par sécurité)
if (!/function\s+kb\s*\(/.test(s)) {
  s = s.replace(/(module\.exports\s*=|exports\.)/,
`function kb(rows){return{reply_markup:{inline_keyboard:rows}};}
$1`);
}

// Ajoute une fonction echoReady() de secours si absente (affiche juste le bouton)
if (!/function\s+echoReady\s*\(/.test(s)) {
  s += `
async function echoReady(chatId, title, token){
  await reply(chatId,
    "✅ Token reçu. Prêt à générer « "+(title||"EchoBot")+" ». ",
    kb([[{text:"🚀 Générer le projet", callback_data:"echo:gen"}]])
  );
}
`;
}

// 1) Hook utilitaire (si pas présent)
if (!/async\s+function\s+_hookTokenOnly\s*\(/.test(s)) {
  s += `
async function _hookTokenOnly(chatId, text, state){
  const m = (text||"").match(/\\bTELEGRAM_BOT_TOKEN\\s*=\\s*(\\S+)/i);
  if(!m) return false;
  const tok = m[1].trim();
  state.tmp = state.tmp || {};
  state.tmp.echoTok = tok;
  await echoReady(chatId, state?.tmp?.title || state?.title || "EchoBot", tok);
  // On reste dans le flow, pas de retour menu :
  state.step = "secrets"; 
  return true;
}
`;
}

// 2) Remplace le contenu du case "secrets" par une version robuste
s = s.replace(
  /case\s+['"]secrets['"]\s*:[\s\S]*?break\s*;/,
`case 'secrets':
case "secrets": {
  try {
    if (await _hookTokenOnly(chatId, text, state)) {
      await saveState(uid, state);
      return; // NE PAS revenir au menu
    }
  } catch(e){ console.error("_hookTokenOnly error", e); }

  // Reprompt clair si le format n'est pas bon :
  await reply(chatId,
    "Envoie le token sous la forme :\\n\\n" +
    "TELEGRAM_BOT_TOKEN=123456789:AA...\\n\\n" +
    "💡 Seul ce token est nécessaire pour l’écho-bot de test.",
    kb([
      [{text:"❓ Où trouver les tokens ?", callback_data:"sec:help"}],
      [{text:"⬅ Retour", callback_data:"act:menu"}]
    ])
  );
  await saveState(uid, state);
  return; // on reste sur cette étape
}
break;`
);

// 3) Si un handler callback n'existe pas pour "echo:gen", on en ajoute un minimal
if (!/echo:gen/.test(s)) {
  // Ajoute un minihandler dans le onCallbackQuery si possible
  s = s.replace(
    /(switch\s*\(.*callback.*\)\s*{)/,
`$1
    case "echo:gen":
      try {
        const tok = state?.tmp?.echoTok;
        if(!tok){
          await reply(chatId,"❗ Token absent. Réenvoie :\\nTELEGRAM_BOT_TOKEN=123:AA...");
          break;
        }
        // Ici : déclenchement génération (ex: endpoint interne existant)
        await reply(chatId,"🧩 Génération en cours… (echo-bot)");
        // TODO: si tu as déjà un endpoint de génération ZIP, appelle-le ici.
      } catch(e){ console.error("echo:gen error", e); }
      break;`
  );
}

await writeFile(FILE, s, "utf8");
console.log("✅ patch applied to", FILE);
