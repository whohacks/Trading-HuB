import { requireApiAuth } from "../../../lib/apiAuth";
import { applyCors } from "../../../lib/apiCors";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  const alertId = String(req.body?.alertId || "").trim();
  const currentPrice = Number(req.body?.currentPrice || 0);
  if (!alertId || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { data: alertRow, error: alertError } = await auth.supabase
    .from("alerts")
    .select("*")
    .eq("id", alertId)
    .eq("user_id", auth.user.id)
    .eq("alert_type", "price")
    .eq("is_active", true)
    .eq("sent_to_telegram", false)
    .single();

  if (alertError || !alertRow) {
    return res.status(404).json({ error: "Alert not found or already triggered" });
  }

  const targetPrice = Number(alertRow.target_price || 0);
  const direction = String(alertRow.trigger_direction || "above");
  const hit =
    direction === "below" ? currentPrice <= targetPrice : currentPrice >= targetPrice;

  if (!hit) {
    return res.status(409).json({ error: "Condition not matched yet" });
  }

  const { data: settings } = await auth.supabase
    .from("user_settings")
    .select("telegram_bot_token, telegram_chat_id")
    .eq("user_id", auth.user.id)
    .single();

  const botToken = process.env.TELEGRAM_BOT_TOKEN || settings?.telegram_bot_token || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || settings?.telegram_chat_id || "";
  if (!botToken || !chatId) {
    return res.status(400).json({ error: "Telegram not configured" });
  }

  const text = [
    `PRICE ALERT [${String(alertRow.severity || "medium").toUpperCase()}]`,
    `${alertRow.title}`,
    `Symbol: ${alertRow.symbol}`,
    `Target: ${targetPrice.toFixed(6)} (${direction})`,
    `Current: ${currentPrice.toFixed(6)}`,
  ].join("\n");

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );

  if (!telegramResponse.ok) {
    const failText = await telegramResponse.text();
    return res.status(502).json({ error: failText || "Telegram send failed" });
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await auth.supabase
    .from("alerts")
    .update({
      sent_to_telegram: true,
      sent_at: nowIso,
      triggered_at: nowIso,
      triggered_price: currentPrice,
      is_active: false,
      last_checked_at: nowIso,
    })
    .eq("id", alertId)
    .eq("user_id", auth.user.id);

  if (updateError) {
    return res.status(500).json({ error: updateError.message });
  }

  return res.status(200).json({ ok: true, alertId, triggeredPrice: currentPrice });
}
