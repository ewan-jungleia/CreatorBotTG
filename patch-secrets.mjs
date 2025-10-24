import { readFileSync, writeFileSync } from 'fs';

const FILE = 'api/creator.js';
let s = readFileSync(FILE, 'utf8');

// 1) Nettoyage des lignes parasites éventuelles
s = s.replace(/^\s*\\n\s*$/mg, '').replace(/^\s*%\s*$/mg, '');

// 2) Injection de l'étape "secrets" si absente
if (!s.includes("tmp.step === 'secrets'")) {
  s = s.replace(
    /(\n\s*if\s*\(tmp\.step === 'prompt'\)[\s\S]*?return;\s*\n\s*\})/,
    `$1

  if (tmp.step === 'secrets'){
    try {
      if (await _hookTokenOnly(chatId, text, tmp)) {
        await setTMP(uid, tmp);
        return;
      }
    } catch(e) { console.error('_hookTokenOnly error', e); }
    await reply(chatId, "Envoie le token sous la forme :\\nTELEGRAM_BOT_TOKEN=123456789:AA...");
    return;
  }
`
  );
}

writeFileSync(FILE, s, 'utf8');
console.log('OK: patch applied');
