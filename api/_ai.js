export async function summarizePrompt(userText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Tu es un assistant qui résume efficacement une demande de création de bot. Reformule en français avec tes mots, sans copier-coller le texte d’origine. Donne un résumé structuré: Objectif, Contraintes, Livrables, Critères de réussite. 6 à 10 lignes max." },
      { role: "user", content: userText }
    ],
    temperature: 0.2
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error("OpenAI error: " + r.status + " " + t);
  }

  const j = await r.json();
  const content = j.choices?.[0]?.message?.content?.trim() || "";
  return content;
}
