export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(200).send("OK");
    const update = req.body || {};
    const msg = update.message || update.edited_message || null;
    if (msg && msg.text === "/start") {
      const chatId = msg.chat.id;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const api = "https://api.telegram.org/bot" + token;
      await fetch(api + "/sendMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "CreatorBot-TG en ligne ✅" })
      });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(200).json({ ok: true, error: String(e) });
  }
}
