const fs = require('fs');

const FILE = 'api/creator.js';
let s = fs.readFileSync(FILE, 'utf8');

// 1) Injecter un petit helper si absent
if (!s.includes('function __eatTelegramToken')) {
  const helper = `
function __eatTelegramToken(text) {
  const m = /^\\s*TELEGRAM_BOT_TOKEN\\s*=\\s*(\\S+)\\s*$/i.exec(text || '');
  return m ? m[1].trim() : null;
}
`;
  // insère avant module.exports ou à la fin
  if (/\\nmodule\\.exports\\s*=/.test(s)) {
    s = s.replace(/\\nmodule\\.exports\\s*=/, `\\n${helper}\\nmodule.exports =`);
  } else {
    s += `\\n${helper}\\n`;
  }
}

// 2) Dans le gros switch/routeur, on veut accrocher le case "secrets"
// On cherche un "case 'secrets':" (ou "case \\"secrets\\":") et on insère au début du case
const caseRe = /(case\\s+['"]secrets['"]\\s*:\\s*)([\\s\\S]*?)(?=\\bcase\\s+['"]|\\bdefault\\s*:|\\})/m;

if (caseRe.test(s) && !s.includes('__eatTelegramToken__HOOK')) {
  s = s.replace(caseRe, (whole, head, body) => {
    const hook = `
      // __eatTelegramToken__HOOK : consommer TELEGRAM_BOT_TOKEN=... à l'étape "secrets"
      try {
        if (state && state.step === 'secrets') {
          const tok = __eatTelegramToken(text);
          if (tok) {
            // >>>> adapte ICI le passage à l'étape suivante <<<<
            // Si tu as déjà une fonction utilitaire p.ex. echoReady(chatId, title, tok)
            // appelle-la; sinon stocke puis enchaîne.
            if (typeof echoReady === 'function') {
              await echoReady(chatId, (state.tmp?.title || state?.title || "EchoBot"), tok);
            } else if (typeof next === 'function') {
              // Exemple de fallback: stocker et appeler next
              state.tmp = state.tmp || {};
              state.tmp.telegramToken = tok;
              await next();
            }
            break; // on a consommé le message, on sort du case
          }
        }
      } catch (e) { console.error('secrets hook error', e); }
    `;
    return head + hook + '\n' + body;
  });
} else if (!caseRe.test(s)) {
  console.error("⚠️  Patch: impossible de localiser `case 'secrets':` dans api/creator.js");
}

// 3) Ajoute un petit log d’observation (optionnel, idempotent)
if (!s.includes('console.log("[DBG] step=", state?.step')) {
  s = s.replace(/(async\\s+function\\s+handleUpdate\\s*\\([^)]*\\)\\s*{)/, `$1
  try { console.log("[DBG] step=", state?.step, "text sample=", (text||"").slice(0,64)); } catch {}
`);
}

fs.writeFileSync(FILE, s, 'utf8');
console.log('✅ Patch appliqué à', FILE);
