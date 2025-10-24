import fs from "fs";

const FILE = "api/creator.js";
let s = fs.readFileSync(FILE, "utf8");
const before = s;

// Nettoyage de lignes/char parasites éventuels
s = s.replace(/^\s*%\s*$/gm, "");
s = s.replace(/\u0000|\u0001|\u0002|\u0003/g, "");

// Ancre : on ajoute la gestion du step "secrets" juste après
//   if (!tmp) { await showMenu(chatId); return; }
const anchor = /if\s*\(\s*!tmp\s*\)\s*\{\s*await\s+showMenu\(\s*chatId\s*\);\s*return;\s*\}/;

if (anchor.test(s) && !/tmp\.step\s*===\s*["']secrets["']/.test(s)) {
  s = s.replace(anchor, (m) => m + `

  // Step 'secrets' : attendre TELEGRAM_BOT_TOKEN=xxxx et afficher "Générer le projet"
  if (tmp.step === "secrets") {
    const mTok = String(text||"").match(/\\bTELEGRAM_BOT_TOKEN\\s*=\\s*(\\S+)/i);
    if (mTok) {
      const tok = mTok[1].trim();
      try {
        // si echoReady existe on l'utilise
        await echoReady(chatId, tmp.title || "EchoBot", tok);
      } catch {
        // sinon on envoie un bouton "Générer le projet"
        await reply(
          chatId,
          "✅ Token reçu. Cliquez sur « Générer le projet ».",
          { reply_markup: { inline_keyboard: [[{ text: "🚀 Générer le projet", callback_data: "echo:gen" }]] } }
        );
      }
      await setTMP(uid, { ...tmp, echoTok: tok, step: "secrets" });
      return;
    }
    await reply(chatId, "Format attendu :\\nTELEGRAM_BOT_TOKEN=123456789:AA...");
    return;
  }
`);
}

if (s !== before) {
  fs.writeFileSync(FILE, s, "utf8");
  console.log("✅ Patch appliqué à api/creator.js");
} else {
  console.log("ℹ️ Aucun changement (déjà patché)");
}
