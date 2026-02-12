import { createHmac } from "crypto";
import { requireApiAuth } from "../../../lib/apiAuth";

function signQuery(query, apiSecret) {
  return createHmac("sha256", apiSecret).update(query).digest("hex");
}

async function signedRequest({ baseUrl, path, apiKey, apiSecret, method = "GET" }) {
  const timestamp = Date.now();
  const recvWindow = 5000;
  const query = `timestamp=${timestamp}&recvWindow=${recvWindow}`;
  const signature = signQuery(query, apiSecret);
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;

  const response = await fetch(url, {
    method,
    headers: {
      "X-MBX-APIKEY": apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const failBody = await response.text();
    throw new Error(failBody || `Binance request failed (${response.status})`);
  }

  return response.json();
}

function nonZeroNumber(value) {
  return Number(value || 0) > 0;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  try {
    const { data: settings, error: settingsError } = await auth.supabase
      .from("user_settings")
      .select("exchange_api_key, exchange_api_secret")
      .eq("user_id", auth.user.id)
      .single();

    if (settingsError) {
      return res.status(400).json({ error: settingsError.message });
    }

    const apiKey = settings?.exchange_api_key;
    const apiSecret = settings?.exchange_api_secret;

    if (!apiKey || !apiSecret) {
      return res
        .status(400)
        .json({ error: "Missing Binance API credentials in Settings." });
    }

    const [spotResult, futuresBalanceResult, fundingResult, positionResult] =
      await Promise.allSettled([
        signedRequest({
          baseUrl: "https://api.binance.com",
          path: "/api/v3/account",
          apiKey,
          apiSecret,
        }),
        signedRequest({
          baseUrl: "https://fapi.binance.com",
          path: "/fapi/v2/balance",
          apiKey,
          apiSecret,
        }),
        signedRequest({
          baseUrl: "https://api.binance.com",
          path: "/sapi/v1/asset/get-funding-asset",
          method: "POST",
          apiKey,
          apiSecret,
        }),
        signedRequest({
          baseUrl: "https://fapi.binance.com",
          path: "/fapi/v2/positionRisk",
          apiKey,
          apiSecret,
        }),
      ]);

    const errors = [];

    const spotBalances =
      spotResult.status === "fulfilled"
        ? (spotResult.value.balances || []).filter(
            (row) => nonZeroNumber(row.free) || nonZeroNumber(row.locked),
          )
        : [];

    if (spotResult.status === "rejected") {
      errors.push(`Spot: ${spotResult.reason?.message || "Unavailable"}`);
    }

    const futuresBalances =
      futuresBalanceResult.status === "fulfilled"
        ? (futuresBalanceResult.value || []).filter(
            (row) => nonZeroNumber(row.balance) || nonZeroNumber(row.availableBalance),
          )
        : [];

    if (futuresBalanceResult.status === "rejected") {
      errors.push(`Futures Balance: ${futuresBalanceResult.reason?.message || "Unavailable"}`);
    }

    const fundingBalances =
      fundingResult.status === "fulfilled"
        ? (fundingResult.value || []).filter(
            (row) =>
              nonZeroNumber(row.free) ||
              nonZeroNumber(row.locked) ||
              nonZeroNumber(row.freeze) ||
              nonZeroNumber(row.withdrawing),
          )
        : [];

    if (fundingResult.status === "rejected") {
      errors.push(`Funding: ${fundingResult.reason?.message || "Unavailable"}`);
    }

    const runningTrades =
      positionResult.status === "fulfilled"
        ? (positionResult.value || []).filter((row) => Number(row.positionAmt || 0) !== 0)
        : [];

    if (positionResult.status === "rejected") {
      errors.push(`Running Trades: ${positionResult.reason?.message || "Unavailable"}`);
    }

    return res.status(200).json({
      spotBalances,
      futuresBalances,
      fundingBalances,
      runningTrades,
      errors,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to fetch Binance account data",
    });
  }
}
