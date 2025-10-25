import fs from "fs";
const FILE = "api/creator.js";
let s = fs.readFileSync(FILE, "utf8");

s = s.replace(
/if\s*\(\s*msg\.text\s*===\s*['"]\/start['"]\s*\)\s*\{[\s\S]*?return\s+res\.json\(\{ok:true\}\);\s*\}/,
m => m + `
else if (msg.text === '/diag') {
  const k = process.env.OPENAI_API_KEY || '';
  const has = !!k;
  const len = k.length;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  await reply(chatId, '🔍 Diag OpenAI → clé='+(has?'✅ OK':'❌ absente')+' (len='+len+'), model='+model);
  return res.json({ ok:true });
}`
);

s = s.replace(
/if\s*\(\s*tmp\.step\s*===\s*['"]prompt['"]\s*\)\s*\{[\s\S]*?return;\s*\}/,
`if (tmp.step === 'prompt') {
  const userPrompt = String(text||'').trim();
  await reply(chatId, 'Je prépare un résumé clair…');
  let summary = '';
  try { summary = await summarizePrompt(userPrompt); } catch(e) { summary = ''; }
  if (!summary || summary.length < 20) {
    const lines = (userPrompt||'').split(/\\n+/).map(l => l.replace(/^[-•\\s]+/,'').trim()).filter(Boolean);
    const head = lines[0] ? 'Objectif: ' + lines[0] : 'Objectif: (non précisé)';
    const rest = lines.slice(1,6).map(x => '- ' + x).join('\\n');
    summary = ['Résumé :', head, rest].filter(Boolean).join('\\n');
  }
  await setTMP(uid, { step:'confirm', title: tmp.title, capCents: tmp.capCents||0, alertStepCents: tmp.alertStepCents||0, prompt: userPrompt, summary });
  await showConfirm(chatId, uid);
  return;
}`
);

s = s.replace(
/const\s+plan\s*=\s*await\s+askOpenAI\(\s*\[[\s\S]*?\]\s*\);\s*[\r\n]+[\t ]*tmp\.step\s*=\s*['"]plan['"];/,
`let plan = await askOpenAI([{ role:'system', content: sys },{ role:'user', content: usr }]);
if (!plan || String(plan).trim().length < 40) {
  const bullets = (prompt||'').split(/\\n+/).map(l => l.replace(/^[-•\\s]+/,'').trim()).filter(Boolean).slice(0,6).map(x => ' - ' + x).join('\\n');
  plan = [
    '**Faisabilité**',
    '- Tech: Node.js + Telegram Bot API (fetch).',
    '- Hébergement: Vercel.',
    '- Risques: quotas API, secrets, droits du bot.',
    '',
    '**Plan stratégique (phases)**',
    '1) Init (repo, env, secrets)',
    '2) Webhook Telegram',
    '3) Écho minimal',
    '4) Déploiement & test',
    '5) README + ZIP',
    '',
    '**Besoins (secrets)**',
    '- TELEGRAM_BOT_TOKEN',
    '- (optionnel) OPENAI_API_KEY',
    '',
    '**Brief compressé**',
    bullets || ' - (aucun point saisi)'
  ].join('\\n');
}
tmp.step = 'plan';`
);

s = s.replace(
/callback_data:\s*["']sec:help["']\s*\}\]\]\)[\s\S]*?return;\s*\}/,
`callback_data:"sec:help"}]]));
  await reply(chatId,
"🔑 GUIDE DÉTAILLÉ — Obtenir les tokens\\n\\n"+
"1) TELEGRAM_BOT_TOKEN (obligatoire)\\n"+
"   • Ouvre Telegram → @BotFather\\n"+
"   • /newbot → choisis un nom et un identifiant (finissant par _bot)\\n"+
"   • Copie le token affiché (ex: 123456789:AA...)\\n"+
"   • Colle ici : TELEGRAM_BOT_TOKEN=123:AA...\\n\\n"+
"2) OPENAI_API_KEY (optionnelle)\\n"+
"   • https://platform.openai.com/ → View API Keys → Create new secret key\\n"+
"   • Colle : OPENAI_API_KEY=sk-...\\n\\n"+
"3) Upstash KV (optionnelle)\\n"+
"   • https://upstash.com/ → Redis REST → crée une DB → récupère URL + TOKEN",
  kb([[{ text:'⬅️ Annuler', callback_data:'act:menu' }]]));
  return; }`
);

fs.writeFileSync(FILE, s, "utf8");
console.log("✅ Patch appliqué proprement à", FILE);
