import { applyCors } from "../../../lib/apiCors";
import { fetchSymbolPrice } from "../../../lib/marketPrice";

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const symbol = String(req.query.symbol || "").toUpperCase().trim();

    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    const payload = await fetchSymbolPrice(symbol);
    return res.status(200).json({
      symbol: payload.symbol || symbol,
      price: Number(payload.price || 0),
      source: payload.source || "unknown",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || "Unable to fetch price",
    });
  }
}
