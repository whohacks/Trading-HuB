import { createClient } from "@supabase/supabase-js";
import { fetchSymbolPrice } from "../../../lib/marketPrice";

function normalizeSymbol(symbol) {
  return String(symbol || "").toUpperCase().replace(/\s+/g, "");
}

function isHit({ direction, currentPrice, targetPrice }) {
  if (direction === "below") return currentPrice <= targetPrice;
  return currentPrice >= targetPrice;
}

function isCronAuthorized(req) {
  const cronSecret = process.env.ALERTS_CRON_SECRET;
  const incomingSecret =
    String(req.query?.key || "") ||
    String(req.headers["x-alerts-cron-secret"] || "");

  if (cronSecret) {
    return incomingSecret === cronSecret;
  }

  return Boolean(req.headers["x-vercel-cron"]);
}

function buildTelegramText(alertRow, currentPrice) {
  return [
    `PRICE ALERT [${String(alertRow.severity || "medium").toUpperCase()}]`,
    `${alertRow.title}`,
    `Symbol: ${alertRow.symbol}`,
    `Target: ${Number(alertRow.target_price || 0).toFixed(6)} (${alertRow.trigger_direction || "above"})`,
    `Current: ${Number(currentPrice || 0).toFixed(6)}`,
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({
      error: "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.",
    });
  }

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: alerts, error: alertsError } = await admin
    .from("alerts")
    .select(
      "id, user_id, title, severity, symbol, target_price, trigger_direction, frequency_seconds, last_checked_at",
    )
    .eq("alert_type", "price")
    .eq("is_active", true)
    .eq("sent_to_telegram", false)
    .order("created_at", { ascending: false });

  if (alertsError) {
    return res.status(500).json({ error: alertsError.message });
  }

  if (!alerts?.length) {
    return res.status(200).json({
      checked: 0,
      triggered: 0,
      skipped: 0,
      timestamp: new Date().toISOString(),
    });
  }

  const userIds = Array.from(new Set(alerts.map((row) => row.user_id).filter(Boolean)));

  const { data: settingsRows, error: settingsError } = await admin
    .from("user_settings")
    .select("user_id, telegram_bot_token, telegram_chat_id, alerts_auto_sync")
    .in("user_id", userIds);

  if (settingsError) {
    return res.status(500).json({ error: settingsError.message });
  }

  const settingsMap = new Map(
    (settingsRows || []).map((row) => [row.user_id, row]),
  );
  const envTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const envTelegramChatId = process.env.TELEGRAM_CHAT_ID || "";

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const priceCache = new Map();
  let checked = 0;
  let triggered = 0;
  let skipped = 0;

  for (const alertRow of alerts) {
    const settings = settingsMap.get(alertRow.user_id);
    const telegramBotToken =
      settings?.telegram_bot_token || envTelegramBotToken;
    const telegramChatId = settings?.telegram_chat_id || envTelegramChatId;

    if (
      settings?.alerts_auto_sync === false ||
      !telegramBotToken ||
      !telegramChatId
    ) {
      skipped += 1;
      continue;
    }

    const lastCheckedMs = alertRow.last_checked_at
      ? new Date(alertRow.last_checked_at).getTime()
      : 0;
    const frequencyMs =
      Math.max(5, Number(alertRow.frequency_seconds || 60)) * 1000;

    if (nowMs - lastCheckedMs < frequencyMs) {
      continue;
    }

    checked += 1;

    const symbol = normalizeSymbol(alertRow.symbol);
    if (!symbol) {
      skipped += 1;
      await admin
        .from("alerts")
        .update({ last_checked_at: nowIso })
        .eq("id", alertRow.id);
      continue;
    }

    let currentPrice = null;
    if (priceCache.has(symbol)) {
      currentPrice = priceCache.get(symbol);
    } else {
      try {
        const market = await fetchSymbolPrice(symbol);
        currentPrice = Number(market.price || 0);
        priceCache.set(symbol, currentPrice);
      } catch (_error) {
        currentPrice = null;
      }
    }

    if (!Number.isFinite(currentPrice) || currentPrice === null) {
      await admin
        .from("alerts")
        .update({ last_checked_at: nowIso })
        .eq("id", alertRow.id);
      continue;
    }

    const targetPrice = Number(alertRow.target_price || 0);
    const direction = alertRow.trigger_direction || "above";
    const hit = targetPrice > 0 && isHit({ direction, currentPrice, targetPrice });

    if (!hit) {
      await admin
        .from("alerts")
        .update({ last_checked_at: nowIso })
        .eq("id", alertRow.id);
      continue;
    }

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: buildTelegramText(alertRow, currentPrice),
        }),
      },
    );

    if (!telegramRes.ok) {
      await admin
        .from("alerts")
        .update({ last_checked_at: nowIso })
        .eq("id", alertRow.id);
      continue;
    }

    triggered += 1;
    await admin
      .from("alerts")
      .update({
        sent_to_telegram: true,
        sent_at: nowIso,
        triggered_at: nowIso,
        triggered_price: currentPrice,
        is_active: false,
        last_checked_at: nowIso,
      })
      .eq("id", alertRow.id);
  }

  return res.status(200).json({
    checked,
    triggered,
    skipped,
    timestamp: new Date().toISOString(),
  });
}
