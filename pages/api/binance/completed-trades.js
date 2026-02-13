import { createHmac } from "crypto";
import { requireApiAuth } from "../../../lib/apiAuth";
import { applyCors } from "../../../lib/apiCors";

function signQuery(query, apiSecret) {
  return createHmac("sha256", apiSecret).update(query).digest("hex");
}

async function signedRequest({ baseUrl, path, query, apiKey, apiSecret }) {
  const signature = signQuery(query, apiSecret);
  const url = `${baseUrl}${path}?${query}&signature=${signature}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
  });

  if (!response.ok) {
    const failText = await response.text();
    throw new Error(failText || `Binance request failed (${response.status})`);
  }

  return response.json();
}

async function fetchUserTradesByChunks({
  apiKey,
  apiSecret,
  startTime,
  endTime,
  recvWindow,
  limit,
}) {
  const maxWindowMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const fallbackStart = now - maxWindowMs;
  const safeStart = Number.isFinite(Number(startTime))
    ? Number(startTime)
    : fallbackStart;
  const safeEnd = Number.isFinite(Number(endTime)) ? Number(endTime) : now;

  const rows = [];
  let cursor = safeStart;

  while (cursor <= safeEnd) {
    const chunkEnd = Math.min(cursor + maxWindowMs - 1, safeEnd);
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("timestamp", String(Date.now()));
    params.set("recvWindow", String(recvWindow));
    params.set("startTime", String(cursor));
    params.set("endTime", String(chunkEnd));

    const chunkRows = await signedRequest({
      baseUrl: "https://fapi.binance.com",
      path: "/fapi/v1/userTrades",
      query: params.toString(),
      apiKey,
      apiSecret,
    });

    if (Array.isArray(chunkRows) && chunkRows.length) {
      rows.push(...chunkRows);
    }

    cursor = chunkEnd + 1;
  }

  return rows;
}

function extractOrderNo(row) {
  if (row?.tradeId) return String(row.tradeId);
  if (row?.orderId) return String(row.orderId);
  const info = String(row?.info || "");
  const match = info.match(/order(?:id)?[:=\s-]*([0-9]+)/i);
  if (match?.[1]) return match[1];
  return String(row?.tranId || "");
}

function resolveSide(row) {
  const pos = String(row?.positionSide || "").toUpperCase();
  if (pos === "SHORT") return "short";
  if (pos === "LONG") return "long";
  const side = String(row?.side || "").toUpperCase();
  if (side === "SELL") return "short";
  return "long";
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireApiAuth(req, res);
  if (!auth) return;

  try {
    const { startTime, endTime } = req.body || {};

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

    const timestamp = Date.now();
    const recvWindow = 5000;
    const limit = 1000;
    const userTradesRows = await fetchUserTradesByChunks({
      apiKey,
      apiSecret,
      startTime,
      endTime,
      recvWindow,
      limit,
    });

    const rawRows = (userTradesRows || [])
      .filter((row) => Number(row.realizedPnl || 0) !== 0)
      .map((row) => {
        const symbol = String(row.symbol || "UNKNOWN").toUpperCase();
        const pnl = Number(row.realizedPnl || 0);
        const commission = Math.abs(Number(row.commission || 0));
        const timeMs = Number(row.time || Date.now());
        const orderNo = extractOrderNo(row) || `${symbol}-${row.time || Date.now()}`;
        const side = resolveSide(row);
        return {
          symbol,
          pnl,
          commission,
          timeMs,
          info: `orderId=${row.orderId || "-"} tradeId=${row.id || "-"} side=${row.side || "-"} positionSide=${row.positionSide || "BOTH"}`,
          orderNo,
          side,
          isMaker: Boolean(row.maker),
          qty: Number(row.qty || 0),
          price: Number(row.price || 0),
          orderId: row.orderId || null,
          tradeId: row.id || null,
        };
      })
      .sort((a, b) => a.timeMs - b.timeMs);

    // Merge by symbol + side + orderNo so split fills of same closing order become one record.
    const grouped = {};
    for (const row of rawRows) {
      const key = `${row.symbol}:${row.side}:${row.orderNo}`;
      if (!grouped[key]) {
        grouped[key] = {
          symbol: row.symbol,
          side: row.side,
          realizedPnl: row.pnl,
          makerFee: row.isMaker ? row.commission : 0,
          takerFee: row.isMaker ? 0 : row.commission,
          qty: row.qty,
          weightedNotional: row.price * row.qty,
          lastTimeMs: row.timeMs,
          orderNo: row.orderNo,
          infos: new Set([row.info]),
          components: [
            {
              orderId: row.orderId,
              tradeId: row.tradeId,
              realizedPnl: row.pnl,
              commission: row.commission,
              maker: row.isMaker,
              time: row.timeMs,
            },
          ],
        };
      } else {
        const g = grouped[key];
        g.realizedPnl += row.pnl;
        if (row.isMaker) g.makerFee += row.commission;
        else g.takerFee += row.commission;
        g.qty += row.qty;
        g.weightedNotional += row.price * row.qty;
        if (row.timeMs > g.lastTimeMs) g.lastTimeMs = row.timeMs;
        g.infos.add(row.info);
        g.components.push({
          orderId: row.orderId,
          tradeId: row.tradeId,
          realizedPnl: row.pnl,
          commission: row.commission,
          maker: row.isMaker,
          time: row.timeMs,
        });
      }
    }

    const completedTrades = Object.values(grouped).map((row) => {
      const info = Array.from(row.infos).join(" | ");
      const feeTotal = row.makerFee + row.takerFee;
      const pnlNet = row.realizedPnl - feeTotal;
      const avgPrice = row.qty > 0 ? row.weightedNotional / row.qty : null;
      const roi =
        avgPrice && row.qty
          ? (pnlNet / (avgPrice * row.qty)) * 100
          : null;
      return {
        external_ref: `position:${row.symbol}:${row.side}:${row.orderNo}`,
        symbol: row.symbol,
        order_no: row.orderNo || null,
        side: row.side,
        realized_pnl: row.realizedPnl,
        fee: feeTotal,
        maker_fee: row.makerFee,
        taker_fee: row.takerFee,
        pnl_net: pnlNet,
        entry_price: avgPrice,
        quantity: row.qty,
        roi,
        closed_at: new Date(row.lastTimeMs).toISOString(),
        info,
        debug_components: row.components,
      };
    });

    return res.status(200).json({
      trades: completedTrades,
      count: completedTrades.length,
      source: "binance_futures_position_history",
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Failed to fetch completed trades",
    });
  }
}
