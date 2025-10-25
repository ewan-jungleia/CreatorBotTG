import fs from "fs";
const F="api/creator.js"; let s=fs.readFileSync(F,"utf8");

s=s.replace(
/if\s*\(\s*tmp\.step\s*===\s*['"]prompt['"]\s*\)\s*\{[\s\S]*?return;\s*\}/,
`if (tmp.step === 'prompt') {
  const userPrompt = String(text||'').trim();
  await reply(chatId, 'Je prépare un résumé…');
  let summary = '';
  try { summary = await summarizePrompt(userPrompt); } catch {}
  if (!summary || summary.trim().length < 20) {
    const lines = userPrompt.split(/\\n+/).map(l=>l.replace(/^[-•\\s]+/,'').trim()).filter(Boolean);
    const title = tmp.title || 'Projet';
    const bullets = lines.slice(0,6).map(x=>'– '+x).join('\\n') || '– (aucun point saisi)';
    summary = [
      'Titre: '+title,
      'Brief utilisateur:',
      bullets
    ].join('\\n');
  }
  await setTMP(uid, {
    step:'confirm',
    title: tmp.title,
    capCents: tmp.capCents||0,
    alertStepCents: tmp.alertStepCents||0,
    prompt: userPrompt,
    summary
  });
  await showConfirm(chatId, uid);
  return;
}`
);

s=s.replace(
/let\s+plan\s*=\s*await\s+askOpenAI\(\s*\[[\s\S]*?\]\s*\);\s*[\r\n]+\s*tmp\.step\s*=\s*['"]plan['"]\s*;/,
`let plan = await askOpenAI([{role:'system',content:sys},{role:'user',content:usr}]);
if (!plan || String(plan).trim().length < 40) {
  const bullets = (prompt||'').split(/\\n+/).map(l=>l.replace(/^[-•\\s]+/,'').trim()).filter(Boolean).slice(0,6).map(x=>' - '+x).join('\\n');
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

fs.writeFileSync(F,s,"utf8");
console.log("OK");
