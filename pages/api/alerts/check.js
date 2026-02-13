import { requireApiAuth } from "../../../lib/apiAuth";
import { applyCors } from "../../../lib/apiCors";
import { fetchSymbolPrice } from "../../../lib/marketPrice";

function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/\s+/g, "");
}

function isHit({ direction, currentPrice, targetPrice }) {
  if (direction === "below") return currentPrice <= targetPrice;
  return currentPrice >= targetPrice;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  const { data: settings, error: settingsError } = await auth.supabase
    .from("user_settings")
    .select("telegram_bot_token, telegram_chat_id")
    .eq("user_id", auth.user.id)
    .single();

  if (settingsError) {
    return res.status(400).json({ error: settingsError.message });
  }

  if (!settings?.telegram_bot_token || !settings?.telegram_chat_id) {
    return res.status(400).json({
      error: "Add Telegram bot token and chat id in Settings first.",
    });
  }

  const { data: alerts, error: alertsError } = await auth.supabase
    .from("alerts")
    .select("*")
    .eq("user_id", auth.user.id)
    .eq("alert_type", "price")
    .eq("is_active", true)
    .eq("sent_to_telegram", false)
    .order("created_at", { ascending: false });

  if (alertsError) {
    return res.status(400).json({ error: alertsError.message });
  }

  let checked = 0;
  let triggered = 0;

  for (const alertRow of alerts || []) {
    const now = Date.now();
    const lastChecked = alertRow.last_checked_at
      ? new Date(alertRow.last_checked_at).getTime()
      : 0;
    const frequencyMs = Math.max(5, Number(alertRow.frequency_seconds || 30)) * 1000;

    if (now - lastChecked < frequencyMs) continue;

    checked += 1;
    const symbol = normalizeSymbol(alertRow.symbol);
    if (!symbol) continue;

    let currentPrice = 0;
    try {
      const market = await fetchSymbolPrice(symbol);
      currentPrice = Number(market.price || 0);
    } catch (_error) {
      await auth.supabase
        .from("alerts")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", alertRow.id)
        .eq("user_id", auth.user.id);
      continue;
    }

    const targetPrice = Number(alertRow.target_price || 0);
    const direction = alertRow.trigger_direction || "above";

    if (targetPrice > 0 && isHit({ direction, currentPrice, targetPrice })) {
      const text = [
        `PRICE ALERT [${String(alertRow.severity || "medium").toUpperCase()}]`,
        `${alertRow.title}`,
        `Symbol: ${alertRow.symbol}`,
        `Target: ${Number(alertRow.target_price).toFixed(6)} (${alertRow.trigger_direction})`,
        `Current: ${Number(currentPrice).toFixed(6)}`,
      ].join("\n");

      const telegramRes = await fetch(
        `https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: settings.telegram_chat_id,
            text,
          }),
        },
      );

      if (telegramRes.ok) {
        triggered += 1;
        await auth.supabase
          .from("alerts")
          .update({
            sent_to_telegram: true,
            sent_at: new Date().toISOString(),
            triggered_at: new Date().toISOString(),
            triggered_price: currentPrice,
            is_active: false,
            last_checked_at: new Date().toISOString(),
          })
          .eq("id", alertRow.id)
          .eq("user_id", auth.user.id);
      } else {
        await auth.supabase
          .from("alerts")
          .update({ last_checked_at: new Date().toISOString() })
          .eq("id", alertRow.id)
          .eq("user_id", auth.user.id);
      }
    } else {
      await auth.supabase
        .from("alerts")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", alertRow.id)
        .eq("user_id", auth.user.id);
    }
  }

  return res.status(200).json({
    checked,
    triggered,
    timestamp: new Date().toISOString(),
  });
}
