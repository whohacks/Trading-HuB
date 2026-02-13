/* eslint-disable no-console */
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

const SUPABASE_URL = env("SUPABASE_URL", env("NEXT_PUBLIC_SUPABASE_URL"));
const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = env("TELEGRAM_CHAT_ID");
const POLL_INTERVAL_MS = Number(env("ALERT_WORKER_SYNC_MS", "15000"));

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeSymbol(symbol) {
  let value = String(symbol || "").toUpperCase().trim();
  if (!value) return "";
  if (value.includes(":")) value = value.split(":").pop() || value;
  value = value.replace(/\.P$/, "");
  value = value.replace(/[\/\-_]/g, "");
  return value;
}

function crossedTarget(direction, previousPrice, currentPrice, targetPrice) {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(currentPrice)) return false;
  if (direction === "below") return previousPrice > targetPrice && currentPrice <= targetPrice;
  return previousPrice < targetPrice && currentPrice >= targetPrice;
}

function toLinearSymbols(symbols) {
  return symbols.filter((s) => s.endsWith("USDT") || s.endsWith("USDC"));
}

function isLinearSymbol(symbol) {
  return symbol.endsWith("USDT") || symbol.endsWith("USDC");
}

class BybitStream {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.ws = null;
    this.subscribedTopics = new Set();
    this.onPrice = null;
    this.reconnectTimer = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      console.log(`[${this.name}] connected`);
      this.resubscribeAll();
    });

    this.ws.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString());
        if (!payload || !payload.topic || !payload.data) return;
        if (!payload.topic.startsWith("tickers.")) return;
        const symbol = payload.topic.replace("tickers.", "");
        const lastPrice = Number(payload?.data?.lastPrice || 0);
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) return;
        if (typeof this.onPrice === "function") {
          this.onPrice(symbol, lastPrice, this.name);
        }
      } catch (_error) {
        // ignore malformed frame
      }
    });

    this.ws.on("close", () => {
      console.log(`[${this.name}] disconnected`);
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      console.error(`[${this.name}] error`, error?.message || error);
    });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  subscribeSymbols(symbols) {
    const nextTopics = new Set(symbols.map((symbol) => `tickers.${symbol}`));
    const toAdd = [];
    for (const topic of nextTopics) {
      if (!this.subscribedTopics.has(topic)) toAdd.push(topic);
    }
    const toRemove = [];
    for (const topic of this.subscribedTopics) {
      if (!nextTopics.has(topic)) toRemove.push(topic);
    }

    this.subscribedTopics = nextTopics;

    if (toRemove.length) {
      this.send({ op: "unsubscribe", args: toRemove });
    }
    if (toAdd.length) {
      this.send({ op: "subscribe", args: toAdd });
    }
  }

  resubscribeAll() {
    const topics = Array.from(this.subscribedTopics);
    if (topics.length) this.send({ op: "subscribe", args: topics });
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

const linearStream = new BybitStream("wss://stream.bybit.com/v5/public/linear", "bybit-linear");

const state = {
  alerts: [],
  settingsByUser: new Map(),
  inFlight: new Set(),
  lastPriceBySymbol: new Map(),
};

function keyForAlert(alertId) {
  return String(alertId || "");
}

async function loadState() {
  const { data: alerts, error: alertsError } = await supabase
    .from("alerts")
    .select("id, user_id, title, severity, symbol, target_price, trigger_direction, is_active, sent_to_telegram")
    .eq("alert_type", "price")
    .eq("is_active", true)
    .eq("sent_to_telegram", false);

  if (alertsError) {
    console.error("alerts load failed", alertsError.message);
    return;
  }

  const userIds = Array.from(new Set((alerts || []).map((a) => a.user_id).filter(Boolean)));

  let settingsRows = [];
  if (userIds.length) {
    const { data: settings, error: settingsError } = await supabase
      .from("user_settings")
      .select("user_id, telegram_bot_token, telegram_chat_id, alerts_auto_sync")
      .in("user_id", userIds);

    if (settingsError) {
      console.error("user_settings load failed", settingsError.message);
    } else {
      settingsRows = settings || [];
    }
  }

  state.alerts = alerts || [];
  state.settingsByUser = new Map((settingsRows || []).map((row) => [row.user_id, row]));

  const symbols = Array.from(
    new Set(
      state.alerts
        .map((row) => normalizeSymbol(row.symbol))
        .filter((symbol) => isLinearSymbol(symbol))
        .filter(Boolean),
    ),
  );

  linearStream.subscribeSymbols(symbols);
  console.log(`synced alerts=${state.alerts.length} symbols=${symbols.length}`);
}

async function sendTelegram(botToken, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return response.ok;
}

async function triggerAlert(alertRow, currentPrice) {
  const lockKey = keyForAlert(alertRow.id);
  if (state.inFlight.has(lockKey)) return;
  state.inFlight.add(lockKey);

  try {
    const settings = state.settingsByUser.get(alertRow.user_id);
    if (settings?.alerts_auto_sync === false) return;

    const botToken = settings?.telegram_bot_token || TELEGRAM_BOT_TOKEN;
    const chatId = settings?.telegram_chat_id || TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) return;

    const text = [
      `PRICE ALERT [${String(alertRow.severity || "medium").toUpperCase()}]`,
      `${alertRow.title}`,
      `Symbol: ${alertRow.symbol}`,
      `Target: ${Number(alertRow.target_price || 0).toFixed(6)} (${alertRow.trigger_direction || "above"})`,
      `Current: ${Number(currentPrice || 0).toFixed(6)}`,
    ].join("\n");

    const ok = await sendTelegram(botToken, chatId, text);
    if (!ok) return;

    const nowIso = new Date().toISOString();
    const { error } = await supabase
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

    if (!error) {
      state.alerts = state.alerts.filter((row) => row.id !== alertRow.id);
      console.log(`triggered ${alertRow.symbol} alert=${alertRow.id}`);
    }
  } finally {
    state.inFlight.delete(lockKey);
  }
}

function evaluateSymbolPrice(symbol, currentPrice) {
  const normalized = normalizeSymbol(symbol);
  const previousPrice = state.lastPriceBySymbol.get(normalized);
  state.lastPriceBySymbol.set(normalized, currentPrice);

  if (!Number.isFinite(previousPrice)) return;

  const matching = state.alerts.filter(
    (row) => normalizeSymbol(row.symbol) === normalized,
  );
  for (const alertRow of matching) {
    const target = Number(alertRow.target_price || 0);
    if (!target || !Number.isFinite(target)) continue;
    const direction = alertRow.trigger_direction || "above";
    if (crossedTarget(direction, previousPrice, currentPrice, target)) {
      triggerAlert(alertRow, currentPrice);
    }
  }
}

linearStream.onPrice = evaluateSymbolPrice;

async function start() {
  console.log("starting live alert worker");
  await loadState();
  linearStream.connect();
  setInterval(loadState, POLL_INTERVAL_MS);
}

start().catch((error) => {
  console.error("worker failed to start", error?.message || error);
  process.exit(1);
});
