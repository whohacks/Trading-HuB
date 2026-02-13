export function normalizeMarketSymbol(symbol) {
  let value = String(symbol || "").toUpperCase().trim();
  if (!value) return "";

  // Accept common formats: BINANCE:BTCUSDT, BTCUSDT.P, BTC/USDT, BTC-USDT
  if (value.includes(":")) {
    value = value.split(":").pop() || value;
  }
  value = value.replace(/\.P$/, "");
  value = value.replace(/[\/\-_]/g, "");
  value = value.replace(/\s+/g, "");

  return value;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = null;
  }

  return { response, payload, text };
}

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchFromBinance(symbol) {
  const { response, payload, text } = await fetchJson(
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
  );

  if (!response.ok) {
    throw new Error(text || `Binance failed (${response.status})`);
  }

  const price = parseNumber(payload?.price);
  if (price === null) {
    throw new Error("Binance returned invalid price");
  }

  return { symbol, price, source: "binance" };
}

async function fetchFromBybitLinear(symbol) {
  const { response, payload, text } = await fetchJson(
    `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`,
  );

  if (!response.ok) {
    throw new Error(text || `Bybit linear failed (${response.status})`);
  }

  const row = payload?.result?.list?.[0];
  const price = parseNumber(row?.lastPrice);

  if (price === null) {
    throw new Error("Bybit linear returned invalid price");
  }

  return { symbol, price, source: "bybit-linear" };
}

async function fetchFromBybitSpot(symbol) {
  const { response, payload, text } = await fetchJson(
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`,
  );

  if (!response.ok) {
    throw new Error(text || `Bybit spot failed (${response.status})`);
  }

  const row = payload?.result?.list?.[0];
  const price = parseNumber(row?.lastPrice);

  if (price === null) {
    throw new Error("Bybit spot returned invalid price");
  }

  return { symbol, price, source: "bybit-spot" };
}

export async function fetchSymbolPrice(symbolInput) {
  const symbol = normalizeMarketSymbol(symbolInput);
  if (!symbol) throw new Error("Missing symbol");

  const attempts = [];
  const providers = [fetchFromBybitLinear, fetchFromBybitSpot, fetchFromBinance];

  for (const provider of providers) {
    try {
      return await provider(symbol);
    } catch (error) {
      attempts.push(error?.message || "Price provider failed");
    }
  }

  throw new Error(attempts.join(" | "));
}
