import { requireApiAuth } from "../../../lib/apiAuth";

function nextOrExisting(nextValue, existingValue) {
  if (typeof nextValue !== "string") return existingValue || "";
  const trimmed = nextValue.trim();
  return trimmed.length ? trimmed : existingValue || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  const { data: existingRow } = await auth.supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", auth.user.id)
    .single();

  const body = req.body || {};
  const payload = {
    user_id: auth.user.id,
    exchange_api_key: nextOrExisting(
      body.exchange_api_key,
      existingRow?.exchange_api_key,
    ),
    exchange_api_secret: nextOrExisting(
      body.exchange_api_secret,
      existingRow?.exchange_api_secret,
    ),
    telegram_bot_token: nextOrExisting(
      body.telegram_bot_token,
      existingRow?.telegram_bot_token,
    ),
    telegram_chat_id: nextOrExisting(
      body.telegram_chat_id,
      existingRow?.telegram_chat_id,
    ),
    alerts_auto_sync:
      typeof body.alerts_auto_sync === "boolean"
        ? body.alerts_auto_sync
        : typeof existingRow?.alerts_auto_sync === "boolean"
          ? existingRow.alerts_auto_sync
          : true,
    updated_at: new Date().toISOString(),
  };

  const { error } = await auth.supabase
    .from("user_settings")
    .upsert(payload, { onConflict: "user_id" });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  return res.status(200).json({
    ok: true,
    binanceConfigured: Boolean(
      payload.exchange_api_key && payload.exchange_api_secret,
    ),
    telegramConfigured: Boolean(
      payload.telegram_bot_token && payload.telegram_chat_id,
    ),
  });
}
