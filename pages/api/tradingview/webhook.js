import { applyCors } from "../../../lib/apiCors";

function formatFromPayload(payload) {
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  const symbol = String(payload?.symbol || payload?.ticker || "UNKNOWN");
  const signal = String(payload?.signal || payload?.side || "ALERT").toUpperCase();
  const price = payload?.price ?? payload?.close ?? "-";
  const timeframe = payload?.timeframe || payload?.interval || "-";
  const sourceTime = payload?.time || payload?.timenow || new Date().toISOString();

  return [
    `TRADINGVIEW ${signal}`,
    `Symbol: ${symbol}`,
    `Price: ${price}`,
    `Timeframe: ${timeframe}`,
    `Time: ${sourceTime}`,
  ].join("\n");
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "tradingview-webhook" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const webhookSecret = String(process.env.TV_WEBHOOK_SECRET || "").trim();
    const telegramBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    const telegramChatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();

    if (!webhookSecret) {
      return res.status(500).json({ error: "Missing TV_WEBHOOK_SECRET" });
    }

    if (!telegramBotToken || !telegramChatId) {
      return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
    }

    const payload = req.body || {};
    const incomingSecret = String(payload.secret || req.headers["x-tv-secret"] || "").trim();
    if (!incomingSecret || incomingSecret !== webhookSecret) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }

    const text = formatFromPayload(payload);
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text,
        }),
      },
    );

    if (!telegramResponse.ok) {
      const failBody = await telegramResponse.text();
      return res.status(502).json({
        error: "Telegram send failed",
        details: failBody || `HTTP ${telegramResponse.status}`,
      });
    }

    return res.status(200).json({
      ok: true,
      sent: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Webhook processing failed",
    });
  }
}
