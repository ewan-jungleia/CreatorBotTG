import fs from "fs";

const FILE = "api/creator.js";
let s = fs.readFileSync(FILE, "utf8");
const before = s;

// Réparation syntaxique de base
s = s
  .replace(/\r/g, "")
  .replace(/\u00A0/g, " ")
  .replace(/^\s*%\s*$/gm, "");

// Injection du step secrets si manquant
if (!/tmp\.step\s*===\s*["']secrets["']/.test(s)) {
  const anchor = /if\s*\(!tmp\)\s*\{\s*await\s+showMenu\(chatId\);\s*return;\s*\}/;
  s = s.replace(anchor, `$&
  // Étape 'secrets' : capture du TELEGRAM_BOT_TOKEN
  if (tmp.step === "secrets") {
    const match = (text || "").match(/\\bTELEGRAM_BOT_TOKEN\\s*=\\s*(\\S+)/i);
    if (match) {
      const tok = match[1].trim();
      try {
        await echoReady(chatId, tmp.title || "EchoBot", tok);
      } catch {
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
  }`);
}

fs.writeFileSync(FILE, s, "utf8");
console.log("✅ Fichier api/creator.js corrigé et patché proprement.");
