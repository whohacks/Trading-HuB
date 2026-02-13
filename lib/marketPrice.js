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

const coingeckoIdMap = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  TRX: "tron",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  MATIC: "matic-network",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  UNI: "uniswap",
  APT: "aptos",
  SUI: "sui",
  ARB: "arbitrum",
  OP: "optimism",
  NEAR: "near",
  ATOM: "cosmos",
  FIL: "filecoin",
};

function parsePair(symbol) {
  const quotes = ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"];
  for (const quote of quotes) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return {
        base: symbol.slice(0, symbol.length - quote.length),
        quote,
      };
    }
  }
  return { base: symbol, quote: "USD" };
}

function quoteToVsCurrency(quote) {
  if (quote === "USDT" || quote === "USDC" || quote === "BUSD") return "usd";
  return quote.toLowerCase();
}

async function fetchFromCoinGecko(symbol) {
  const { base, quote } = parsePair(symbol);
  const coinId = coingeckoIdMap[base];
  if (!coinId) {
    throw new Error(`CoinGecko mapping missing for ${base}`);
  }
  const vsCurrency = quoteToVsCurrency(quote);
  const apiKey = process.env.COINGECKO_DEMO_API_KEY || "";
  const query = `ids=${encodeURIComponent(coinId)}&vs_currencies=${encodeURIComponent(vsCurrency)}`;
  const url = `https://api.coingecko.com/api/v3/simple/price?${query}`;

  const response = await fetch(url, {
    headers: apiKey ? { "x-cg-demo-api-key": apiKey } : {},
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `CoinGecko failed (${response.status})`);
  }

  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error("CoinGecko invalid JSON");
  }

  const price = parseNumber(payload?.[coinId]?.[vsCurrency]);
  if (price === null) {
    throw new Error(`CoinGecko price missing for ${coinId}/${vsCurrency}`);
  }

  return { symbol, price, source: "coingecko" };
}

export async function fetchSymbolPrice(symbolInput) {
  const symbol = normalizeMarketSymbol(symbolInput);
  if (!symbol) throw new Error("Missing symbol");

  const attempts = [];
  const providers = [
    fetchFromBybitLinear,
    fetchFromBybitSpot,
    fetchFromBinance,
    fetchFromCoinGecko,
  ];

  for (const provider of providers) {
    try {
      return await provider(symbol);
    } catch (error) {
      attempts.push(error?.message || "Price provider failed");
    }
  }

  throw new Error(attempts.join(" | "));
}
