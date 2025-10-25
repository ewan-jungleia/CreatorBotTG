import JSZip from "jszip";

/**
 * Construit un ZIP avec un echo-bot minimal (index.js + package.json + README.md).
 * Pas de template string ici pour éviter tout backtick.
 */
export async function buildEchoBotZip(token = "") {
  const zip = new JSZip();

  const indexJs =
"import fetch from \"node-fetch\";\n" +
"const TOKEN = \"" + token + "\";\n" +
"const API = \"https://api.telegram.org/bot\" + TOKEN;\n" +
"export async function handler(req, res) {\n" +
"  try {\n" +
"    if (req.method !== \"POST\") return res.status(200).send(\"OK\");\n" +
"    const update = req.body || {};\n" +
"    const msg = update.message;\n" +
"    if (!msg || !msg.text) return res.status(200).send(\"OK\");\n" +
"    const chatId = msg.chat.id;\n" +
"    const text = msg.text;\n" +
"    await fetch(API + \"/sendMessage\", {\n" +
"      method: \"POST\",\n" +
"      headers: { \"Content-Type\": \"application/json\" },\n" +
"      body: JSON.stringify({ chat_id: chatId, text })\n" +
"    });\n" +
"    return res.status(200).send(\"OK\");\n" +
"  } catch (e) {\n" +
"    console.error(e);\n" +
"    return res.status(200).send(\"OK\");\n" +
"  }\n" +
"}\n";

  const packageJson =
"{\n" +
"  \"name\": \"echo-bot\",\n" +
"  \"version\": \"1.0.0\",\n" +
"  \"private\": true,\n" +
"  \"type\": \"module\",\n" +
"  \"dependencies\": { \"node-fetch\": \"^3.3.2\" }\n" +
"}\n";

  const readme =
"# Echo Bot\n\n" +
"Bot Telegram d echo minimal.\n\n" +
"Local:\n" +
" 1) npm install\n" +
" 2) (optionnel) fichier .env avec TELEGRAM_BOT_TOKEN\n" +
" 3) node index.js\n\n" +
"Vercel:\n" +
" - creer un projet\n" +
" - ajouter variable TELEGRAM_BOT_TOKEN\n" +
" - deploie\n" +
" - poser le webhook vers /api/handler\n";

  zip.file("index.js", indexJs);
  zip.file("package.json", packageJson);
  zip.file("README.md", readme);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}
