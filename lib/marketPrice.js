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

function isSupportedLinearSymbol(symbol) {
  return symbol.endsWith("USDT") || symbol.endsWith("USDC");
}

export async function fetchSymbolPrice(symbolInput) {
  const symbol = normalizeMarketSymbol(symbolInput);
  if (!symbol) throw new Error("Missing symbol");
  if (!isSupportedLinearSymbol(symbol)) {
    throw new Error("Bybit futures only: use USDT/USDC perpetual symbol (example BTCUSDT).");
  }

  return fetchFromBybitLinear(symbol);
}
