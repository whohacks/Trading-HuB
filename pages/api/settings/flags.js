import { requireApiAuth } from "../../../lib/apiAuth";
import { applyCors } from "../../../lib/apiCors";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  const { data, error } = await auth.supabase
    .from("user_settings")
    .select(
      "exchange_api_key, exchange_api_secret, telegram_bot_token, telegram_chat_id, alerts_auto_sync",
    )
    .eq("user_id", auth.user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return res.status(400).json({ error: error.message });
  }

  const row = data || {};
  return res.status(200).json({
    binanceConfigured: Boolean(
      row.exchange_api_key && row.exchange_api_secret,
    ),
    telegramConfigured: Boolean(
      row.telegram_bot_token && row.telegram_chat_id,
    ),
    alertsAutoSync:
      typeof row.alerts_auto_sync === "boolean" ? row.alerts_auto_sync : true,
  });
}
