import fs from "fs";

const FILE = "api/creator.js";
let s = fs.readFileSync(FILE, "utf8");

/* /diag */
s = s.replace(
/if\s*\(msg\.text\s*===\s*'\/start'\)\s*\{\s*await showMenu\(chatId\);\s*return res\.json\(\{ok:true\}\);\s*\}/,
m => m + `
else if (msg.text === '/diag') {
  const key = process.env.OPENAI_API_KEY;
  const has = !!key;
  const len = (key||'').length;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  await reply(chatId, '🔍 Diag OpenAI → clé='+(has?'✅ OK':'❌ absente')+' (len='+len+'), model='+model);
  return res.json({ ok:true });
}`
);

/* Résumé fallback */
s = s.replace(
/let\s+summary\s*=\s*'';[\s\S]*?await\s+showConfirm/,
`let summary = '';
try { summary = await summarizePrompt(userPrompt); } catch (e) { summary = ''; }
if (!summary) {
  const lines = (userPrompt||'').split(/\\n+/).map(l => l.replace(/^[-•\\s]+/, '').trim()).filter(Boolean);
  const head = lines[0] ? '- Objectif: ' + lines[0] : '- Objectif: (non précisé)';
  const rest = lines.slice(1,6).map(x => '- ' + x).join('\\n');
  summary = ['Résumé :', head, rest].filter(Boolean).join('\\n');
}
await showConfirm`
);

/* Plan fallback */
s = s.replace(/const\s+plan\s*=\s*await\s+askOpenAI\(/, "let plan = await askOpenAI(");
s = s.replace(
/tmp\.step\s*=\s*'plan';/,
`if (!(plan && String(plan).trim())) {
  const bullets = (prompt||'').split(/\\n+/).map(l => l.replace(/^[-•\\s]+/, '').trim()).filter(Boolean).slice(0,6).map(x => ' - ' + x).join('\\n');
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

fs.writeFileSync(FILE, s, "utf8");
console.log("✅ Patch appliqué proprement à", FILE);
