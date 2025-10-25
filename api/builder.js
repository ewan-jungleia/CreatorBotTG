import JSZip from "jszip";

export async function buildEchoBotZip(token = "") {
  const zip = new JSZip();
  const indexJs = [
    'import fetch from "node-fetch";',
    'const TOKEN = "' + token + '";',
    'const API = "https://api.telegram.org/bot" + TOKEN;',
    'export async function handler(req, res) {',
    '  try {',
    '    if (req.method !== "POST") return res.status(200).send("OK");',
    '    const update = req.body || {};',
    '    const msg = update.message;',
    '    if (!msg || !msg.text) return res.status(200).send("OK");',
    '    const chatId = msg.chat.id;',
    '    const text = msg.text;',
    '    await fetch(API + "/sendMessage", {',
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json" },',
    '      body: JSON.stringify({ chat_id: chatId, text })',
    '    });',
    '    return res.status(200).send("OK");',
    '  } catch (e) {',
    '    console.error(e);',
    '    return res.status(200).send("OK");',
    '  }',
    '}'
  ].join("\n");

  const packageJson = [
    "{",
    '  "name": "echo-bot",',
    '  "version": "1.0.0",',
    '  "private": true,',
    '  "type": "module",',
    '  "dependencies": { "node-fetch": "^3.3.2" }',
    "}"
  ].join("\n");

  const readme = [
    "# Echo Bot",
    "",
    "Bot Telegram d'echo minimal.",
    "",
    "## Local",
    "1. npm install",
    "2. creer .env avec TELEGRAM_BOT_TOKEN",
    "3. node index.js",
    "",
    "## Vercel",
    "Ajouter TELEGRAM_BOT_TOKEN dans les variables d'environnement",
    "Deployer",
    "Configurer le webhook Telegram vers /api/handler"
  ].join("\n");

  zip.file("index.js", indexJs);
  zip.file("package.json", packageJson);
  zip.file("README.md", readme);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}
